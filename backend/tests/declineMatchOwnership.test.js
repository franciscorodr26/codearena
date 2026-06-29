/**
 * Authorization-bypass regression test for the `decline-match-stay-in-queue`
 * socket handler.
 *
 * Bug: The handler in server.js called `battles.delete(battleId)` on a
 * client-supplied battleId with NO ownership check and NO state check. Sibling
 * handlers all call `verifyPlayerOwnership(socket, player)` first — this one
 * did not. Because battleIds are broadcast to tournament rooms, any user
 * knowing a battleId could grief by evicting in-progress matches.
 *
 * Fix: Before any state mutation, verify
 *   (1) the battle is in a pre-coding state (waiting / ready / matched), and
 *   (2) the caller's socket.userId matches a player in battle.players,
 *       via `verifyPlayerOwnership`.
 *
 * These tests replicate the relevant handler body inline (the same pattern
 * used by `forfeitBattle.ownership.test.js` and other socket-flow tests in
 * this directory, since server.js is not structured to be required in
 * isolation). The handler logic is kept in sync with the real implementation
 * in backend/server.js (search: 'decline-match-stay-in-queue').
 */

// Replicates the verifyPlayerOwnership helper from server.js (line ~1413).
function verifyPlayerOwnership(socket, player, emitError = true) {
  if (!player) {
    if (emitError) socket.emit('error', 'Player not found');
    return false;
  }
  if (!player.userId) {
    if (emitError) socket.emit('error', 'Not authorized to perform this action');
    return false;
  }
  if (String(player.userId) !== String(socket.userId)) {
    if (emitError) socket.emit('error', 'Not authorized to perform this action');
    return false;
  }
  return true;
}

/**
 * Factory that builds a decline-match-stay-in-queue handler mirroring the
 * guarded portion of server.js. We only need the eviction segment that
 * mutates `battles`/notifies the opponent — the queue-rejoin tail is
 * unaffected by the ownership/state guard and is not relevant to this test.
 */
function makeDeclineHandler({ battles, matchmakingQueue, io }) {
  return async function onDeclineMatchStayInQueue(socket, {
    playerId,
    playerName,
    battleId
  }) {
    try {
      if (!battleId) return;
      const battle = battles.get(battleId);
      if (!battle || !battle.players) return;

      // State guard: only pre-coding states are evictable.
      const PRE_CODING_STATES = new Set(['waiting', 'ready', 'matched']);
      if (!PRE_CODING_STATES.has(battle.state)) return;

      // Ownership guard: caller must be a participant in this battle.
      const callerPlayer = battle.players.find(
        p => String(p.userId) === String(socket.userId)
      );
      if (!verifyPlayerOwnership(socket, callerPlayer)) return;

      const opponent = battle.players.find(p => p.id !== playerId);
      if (opponent) {
        let opponentSocketId = opponent.socketId;
        if (!opponentSocketId) {
          const queueEntry = matchmakingQueue.get(opponent.id);
          opponentSocketId = queueEntry?.socketId;
        }
        if (opponentSocketId) {
          const opponentSocket = io.sockets.sockets.get(opponentSocketId);
          if (opponentSocket && opponentSocket.connected) {
            opponentSocket.emit('opponent-declined-match', {
              declinerName: playerName,
              message: `${playerName || 'Your opponent'} chose to skip this match.`
            });
          }
        }
      }

      if (battle.botSubmitTimeout) {
        clearTimeout(battle.botSubmitTimeout);
        battle.botSubmitTimeout = null;
      }

      battles.delete(battleId);
    } catch (_err) {
      // mirror server.js: swallow + log; nothing to assert here
    }
  };
}

function makeSocket(userId) {
  return {
    id: `socket-${userId}`,
    userId,
    emit: jest.fn(),
    connected: true
  };
}

function makeBattle(state = 'matched') {
  // Player A has userId 'user-A' (legit participant).
  // Player B has userId 'user-B' (the other legit participant).
  // Attacker in tests uses userId 'user-C' (not a participant).
  return {
    id: 'battle-1',
    state,
    startedAt: Date.now() - 1_000,
    players: [
      { id: 'pA', name: 'Alice', userId: 'user-A', socketId: 'socket-user-A' },
      { id: 'pB', name: 'Bob',   userId: 'user-B', socketId: 'socket-user-B' }
    ],
    matchmade: true,
    isAgainstBot: false
  };
}

describe('decline-match-stay-in-queue ownership + state guard', () => {
  let battles;
  let matchmakingQueue;
  let io;
  let opponentSocket;
  let handler;

  beforeEach(() => {
    battles = new Map();
    matchmakingQueue = new Map();
    opponentSocket = {
      id: 'socket-user-B',
      connected: true,
      emit: jest.fn()
    };
    io = {
      sockets: {
        sockets: new Map([['socket-user-B', opponentSocket]])
      }
    };
    handler = makeDeclineHandler({ battles, matchmakingQueue, io });
  });

  test('attacker: non-participant socket cannot evict a live battle', async () => {
    const battle = makeBattle('matched');
    battles.set(battle.id, battle);

    // user-C is logged in but is NOT a player in this battle. They've learned
    // the battleId from a tournament room broadcast and try to grief it.
    const attackerSocket = makeSocket('user-C');
    await handler(attackerSocket, {
      playerId: 'pA',
      playerName: 'NotAlice',
      battleId: battle.id
    });

    // Battle must still exist and be untouched.
    expect(battles.has(battle.id)).toBe(true);
    expect(battles.get(battle.id)).toBe(battle);
    expect(battle.state).toBe('matched');

    // Opponent (the legit participant Bob) was NOT notified — there's no
    // legitimate decline happening.
    expect(opponentSocket.emit).not.toHaveBeenCalled();

    // Attacker received an error from verifyPlayerOwnership. Since they are
    // not a participant, `callerPlayer` is undefined and the helper emits
    // 'Player not found' (vs. 'Not authorized...' for a wrong-userId player).
    expect(attackerSocket.emit).toHaveBeenCalledWith(
      'error',
      expect.stringMatching(/Player not found|Not authorized/)
    );
  });

  test('coding state: even a legit participant cannot evict via decline-match', async () => {
    // A user who's already coding shouldn't be evictable by a decline-match event.
    const battle = makeBattle('coding');
    battles.set(battle.id, battle);

    const aliceSocket = makeSocket('user-A');
    await handler(aliceSocket, {
      playerId: 'pA',
      playerName: 'Alice',
      battleId: battle.id
    });

    // Battle must remain — decline-match-stay-in-queue is not the right
    // mechanism to terminate an in-progress coding battle.
    expect(battles.has(battle.id)).toBe(true);
    expect(battle.state).toBe('coding');
    expect(opponentSocket.emit).not.toHaveBeenCalled();
  });

  test('legit: participant declining a pre-coding match evicts the battle', async () => {
    const battle = makeBattle('matched');
    battles.set(battle.id, battle);

    const aliceSocket = makeSocket('user-A');
    await handler(aliceSocket, {
      playerId: 'pA',
      playerName: 'Alice',
      battleId: battle.id
    });

    // Battle was deleted as expected.
    expect(battles.has(battle.id)).toBe(false);

    // Opponent was notified.
    expect(opponentSocket.emit).toHaveBeenCalledWith(
      'opponent-declined-match',
      expect.objectContaining({ declinerName: 'Alice' })
    );

    // No error sent to the legit caller.
    expect(aliceSocket.emit).not.toHaveBeenCalledWith(
      'error',
      expect.anything()
    );
  });

  test('legit: works for the other participant too (waiting state)', async () => {
    const battle = makeBattle('waiting');
    battles.set(battle.id, battle);

    // Bob declines. The opponent-notify branch resolves via Alice's socketId,
    // so wire up an Alice socket on the io map.
    const aliceListenerSocket = { id: 'socket-user-A', connected: true, emit: jest.fn() };
    io.sockets.sockets.set('socket-user-A', aliceListenerSocket);

    const bobSocket = makeSocket('user-B');
    await handler(bobSocket, {
      playerId: 'pB',
      playerName: 'Bob',
      battleId: battle.id
    });

    expect(battles.has(battle.id)).toBe(false);
    expect(aliceListenerSocket.emit).toHaveBeenCalledWith(
      'opponent-declined-match',
      expect.objectContaining({ declinerName: 'Bob' })
    );
    expect(bobSocket.emit).not.toHaveBeenCalledWith('error', expect.anything());
  });
});
