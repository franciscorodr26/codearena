/**
 * Authorization-bypass regression test for the `forfeit-battle` socket handler.
 *
 * Bug: The handler in server.js trusted the client-supplied playerId without
 * verifying that the socket user owns that player slot. A malicious client
 * could emit forfeit-battle with the opponent's playerId, awarding themselves
 * the ranked win and tanking the victim's ELO.
 *
 * Fix: Call verifyPlayerOwnership(socket, forfeitingPlayer) before any state
 * mutation. The two tests below assert both the attacker (must be blocked)
 * and legit (must succeed) paths.
 *
 * These tests replicate the actual handler body inline (the same pattern used
 * by other socket-flow tests in this directory, since server.js is not
 * structured to be required in isolation). The handler logic is kept in sync
 * with the real implementation in backend/server.js (search: 'forfeit-battle').
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
 * Factory that builds a forfeit-battle handler mirroring server.js. The handler
 * mutates state on the supplied `battles` Map and calls `persistBattleResult`
 * to surface rating-change activity. We only need enough state mutation to
 * observe whether the guard fired.
 */
function makeForfeitHandler({ battles, persistBattleResult, io }) {
  return async function onForfeitBattle(socket, { battleId, playerId }) {
    try {
      const battle = battles.get(battleId);
      if (!battle) return;

      if (battle.state !== 'coding') return;

      const forfeitingPlayer = battle.players.find(p => p.id === playerId);
      const opponent = battle.players.find(p => p.id !== playerId);

      if (!forfeitingPlayer || !opponent) return;
      if (!verifyPlayerOwnership(socket, forfeitingPlayer)) return;

      battle.state = 'finished';
      battle.finishedAt = Date.now();
      battle.winner = opponent.id;

      const timeSpent = battle.startedAt
        ? Math.floor((Date.now() - battle.startedAt) / 1000)
        : 0;

      const battleResult = await persistBattleResult(
        battle, opponent, forfeitingPlayer, null, timeSpent, true
      );

      io.to(battleId).emit('battle-finished', {
        winner: opponent.id,
        loser: forfeitingPlayer.id,
        forfeit: true,
        ratingChanges: {
          winner: { change: battleResult.winnerRatingChange || 0 },
          loser: { change: battleResult.loserRatingChange || 0 }
        }
      });
    } catch (_err) {
      // mirror server.js: swallow + log; nothing to assert here
    }
  };
}

function makeSocket(userId) {
  return {
    id: `socket-${userId}`,
    userId,
    emit: jest.fn()
  };
}

function makeBattle() {
  // Player A has userId 'user-A' (the attacker / would-be victim).
  // Player B has userId 'user-B' (the opponent / would-be cheater).
  return {
    id: 'battle-1',
    state: 'coding',
    startedAt: Date.now() - 60_000,
    players: [
      { id: 'pA', name: 'Alice', userId: 'user-A' },
      { id: 'pB', name: 'Bob',   userId: 'user-B' }
    ],
    matchmade: true,
    isAgainstBot: false
  };
}

describe('forfeit-battle ownership guard', () => {
  let battles;
  let persistBattleResult;
  let io;
  let handler;

  beforeEach(() => {
    battles = new Map();
    persistBattleResult = jest.fn().mockResolvedValue({
      winnerRatingChange: 20,
      loserRatingChange: -20,
      winnerNewRating: 1020,
      loserNewRating: 980
    });
    io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    handler = makeForfeitHandler({ battles, persistBattleResult, io });
  });

  test('attacker: socket authenticated as user-B cannot forfeit as user-A', async () => {
    const battle = makeBattle();
    battles.set(battle.id, battle);

    const attackerSocket = makeSocket('user-B'); // logged in as Bob
    // Bob tries to forfeit *as Alice* (pA), which would award Bob the win.
    await handler(attackerSocket, { battleId: battle.id, playerId: 'pA' });

    // Battle state must be untouched.
    expect(battle.state).toBe('coding');
    expect(battle.winner).toBeUndefined();
    expect(battle.finishedAt).toBeUndefined();

    // No rating persistence.
    expect(persistBattleResult).not.toHaveBeenCalled();

    // No battle-finished broadcast.
    expect(io.to).not.toHaveBeenCalled();
    expect(io.emit).not.toHaveBeenCalled();

    // Attacker received an error.
    expect(attackerSocket.emit).toHaveBeenCalledWith(
      'error',
      'Not authorized to perform this action'
    );
  });

  test('legit: socket authenticated as user-A forfeiting their own slot succeeds', async () => {
    const battle = makeBattle();
    battles.set(battle.id, battle);

    const aliceSocket = makeSocket('user-A');
    await handler(aliceSocket, { battleId: battle.id, playerId: 'pA' });

    // Battle resolved.
    expect(battle.state).toBe('finished');
    expect(battle.winner).toBe('pB'); // Bob wins because Alice forfeited.
    expect(typeof battle.finishedAt).toBe('number');

    // Rating persistence ran with the right winner/loser ordering.
    expect(persistBattleResult).toHaveBeenCalledTimes(1);
    const args = persistBattleResult.mock.calls[0];
    expect(args[1].id).toBe('pB'); // winner = opponent
    expect(args[2].id).toBe('pA'); // loser = forfeiter

    // battle-finished broadcast went out to the battle room.
    expect(io.to).toHaveBeenCalledWith(battle.id);
    expect(io.emit).toHaveBeenCalledWith(
      'battle-finished',
      expect.objectContaining({ winner: 'pB', loser: 'pA', forfeit: true })
    );

    // No error sent to the legit caller.
    expect(aliceSocket.emit).not.toHaveBeenCalledWith(
      'error',
      expect.anything()
    );
  });
});
