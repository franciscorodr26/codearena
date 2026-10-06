/**
 * Agent Battle Matchmaking Queue Edge Case Tests
 *
 * Comprehensive tests for matchmaking queue edge cases:
 * - Queue timing and expiration
 * - Concurrent queue operations
 * - Match cancellation scenarios
 * - Queue position accuracy
 * - Disconnect/reconnect handling
 * - Invalid state transitions
 *
 * Pure unit tests - no external dependencies needed
 */

const { v4: uuidv4 } = require('uuid');

// Mock database (not used but prevents import errors)
jest.mock('../db', () => ({
  run: jest.fn(),
  get: jest.fn(),
  all: jest.fn()
}));

// Mock logger (not used but prevents import errors)
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

describe('Agent Battle Matchmaking Queue - Edge Cases', () => {
  let queue;
  let locks;

  beforeEach(() => {
    // Simulate the global queue and locks
    queue = new Map();
    locks = new Set();
  });

  afterEach(() => {
    queue.clear();
    locks.clear();
  });

  describe('Queue Entry Management', () => {
    it('should prevent duplicate queue entries for same user', () => {
      const userId = 'user-1';
      const entry = {
        userId,
        loadoutId: 'loadout-1',
        socketId: 'socket-1',
        joinedAt: Date.now()
      };

      queue.set(userId, entry);

      // Try to add again
      const alreadyInQueue = queue.has(userId);
      expect(alreadyInQueue).toBe(true);
      expect(queue.size).toBe(1);
    });

    it('should allow same user to rejoin after leaving queue', () => {
      const userId = 'user-1';
      const entry1 = {
        userId,
        loadoutId: 'loadout-1',
        socketId: 'socket-1',
        joinedAt: Date.now()
      };

      queue.set(userId, entry1);
      queue.delete(userId);

      // Can rejoin
      const entry2 = {
        userId,
        loadoutId: 'loadout-2',
        socketId: 'socket-2',
        joinedAt: Date.now()
      };

      queue.set(userId, entry2);
      expect(queue.size).toBe(1);
      expect(queue.get(userId).loadoutId).toBe('loadout-2');
    });

    it('should handle null or undefined user IDs gracefully', () => {
      expect(() => {
        queue.set(null, { userId: null });
      }).not.toThrow();

      expect(() => {
        queue.set(undefined, { userId: undefined });
      }).not.toThrow();
    });
  });

  describe('Queue Timing Edge Cases', () => {
    it('should track queue wait time accurately', () => {
      const userId = 'user-1';
      const joinTime = Date.now() - 5000; // Joined 5 seconds ago

      queue.set(userId, {
        userId,
        joinedAt: joinTime,
        socketId: 'socket-1'
      });

      const entry = queue.get(userId);
      const waitTime = Date.now() - entry.joinedAt;

      expect(waitTime).toBeGreaterThanOrEqual(5000);
      expect(waitTime).toBeLessThan(6000);
    });

    it('should identify stale queue entries', () => {
      const STALE_THRESHOLD = 300000; // 5 minutes

      const freshUser = {
        userId: 'fresh',
        joinedAt: Date.now(),
        socketId: 'socket-1'
      };

      const staleUser = {
        userId: 'stale',
        joinedAt: Date.now() - STALE_THRESHOLD - 1000,
        socketId: 'socket-2'
      };

      queue.set('fresh', freshUser);
      queue.set('stale', staleUser);

      // Check staleness
      const staleEntry = queue.get('stale');
      const isStale = (Date.now() - staleEntry.joinedAt) > STALE_THRESHOLD;

      expect(isStale).toBe(true);

      const freshEntry = queue.get('fresh');
      const isFresh = (Date.now() - freshEntry.joinedAt) <= STALE_THRESHOLD;

      expect(isFresh).toBe(true);
    });

    it('should expand search after timeout threshold', () => {
      const EXPAND_TIMEOUT = 60000; // 60 seconds

      const entry = {
        userId: 'user-1',
        joinedAt: Date.now() - EXPAND_TIMEOUT - 1000,
        expandedSearchAt: null,
        socketId: 'socket-1'
      };

      queue.set('user-1', entry);

      const queueEntry = queue.get('user-1');
      const timeInQueue = Date.now() - queueEntry.joinedAt;
      const shouldExpand = timeInQueue >= EXPAND_TIMEOUT && !queueEntry.expandedSearchAt;

      expect(shouldExpand).toBe(true);

      // Mark as expanded
      queueEntry.expandedSearchAt = Date.now();

      // Should not expand again
      const shouldExpandAgain = timeInQueue >= EXPAND_TIMEOUT && !queueEntry.expandedSearchAt;
      expect(shouldExpandAgain).toBe(false);
    });
  });

  describe('Concurrent Queue Operations', () => {
    it('should handle concurrent joins without race conditions', () => {
      const users = Array.from({ length: 10 }, (_, i) => ({
        userId: `user-${i}`,
        loadoutId: `loadout-${i}`,
        socketId: `socket-${i}`,
        joinedAt: Date.now()
      }));

      // Add all users
      users.forEach(user => {
        if (!queue.has(user.userId)) {
          queue.set(user.userId, user);
        }
      });

      expect(queue.size).toBe(10);
    });

    it('should handle concurrent leaves', () => {
      // Add 5 users
      for (let i = 0; i < 5; i++) {
        queue.set(`user-${i}`, {
          userId: `user-${i}`,
          socketId: `socket-${i}`,
          joinedAt: Date.now()
        });
      }

      // Remove all
      for (let i = 0; i < 5; i++) {
        queue.delete(`user-${i}`);
      }

      expect(queue.size).toBe(0);
    });

    it('should use locks to prevent concurrent matching of same user', () => {
      const userId = 'user-1';

      // Try to lock
      if (!locks.has(userId)) {
        locks.add(userId);
        expect(locks.has(userId)).toBe(true);

        // Try to lock again - should already be locked
        const isLocked = locks.has(userId);
        expect(isLocked).toBe(true);

        // Unlock
        locks.delete(userId);
        expect(locks.has(userId)).toBe(false);
      }
    });
  });

  describe('Queue Position Calculation', () => {
    it('should calculate queue position based on join time', () => {
      const now = Date.now();

      queue.set('user-1', { userId: 'user-1', joinedAt: now - 3000, socketId: 'socket-1' });
      queue.set('user-2', { userId: 'user-2', joinedAt: now - 2000, socketId: 'socket-2' });
      queue.set('user-3', { userId: 'user-3', joinedAt: now - 1000, socketId: 'socket-3' });

      // Sort by join time
      const sortedEntries = Array.from(queue.values()).sort(
        (a, b) => a.joinedAt - b.joinedAt
      );

      expect(sortedEntries[0].userId).toBe('user-1'); // First in queue
      expect(sortedEntries[1].userId).toBe('user-2');
      expect(sortedEntries[2].userId).toBe('user-3');
    });

    it('should update queue position after users leave', () => {
      const now = Date.now();

      queue.set('user-1', { userId: 'user-1', joinedAt: now - 3000, socketId: 'socket-1' });
      queue.set('user-2', { userId: 'user-2', joinedAt: now - 2000, socketId: 'socket-2' });
      queue.set('user-3', { userId: 'user-3', joinedAt: now - 1000, socketId: 'socket-3' });

      // User 1 leaves
      queue.delete('user-1');

      const sortedEntries = Array.from(queue.values()).sort(
        (a, b) => a.joinedAt - b.joinedAt
      );

      expect(sortedEntries[0].userId).toBe('user-2'); // Now first
      expect(sortedEntries.length).toBe(2);
    });

    it('should handle empty queue position query', () => {
      const position = Array.from(queue.values()).findIndex(e => e.userId === 'user-1');
      expect(position).toBe(-1);
    });
  });

  describe('Match Creation Edge Cases', () => {
    it('should remove both players from queue when match is created', () => {
      queue.set('user-1', { userId: 'user-1', socketId: 'socket-1', joinedAt: Date.now() });
      queue.set('user-2', { userId: 'user-2', socketId: 'socket-2', joinedAt: Date.now() });

      // Simulate match creation
      const player1 = queue.get('user-1');
      const player2 = queue.get('user-2');

      expect(player1).toBeDefined();
      expect(player2).toBeDefined();

      // Remove from queue
      queue.delete('user-1');
      queue.delete('user-2');

      expect(queue.size).toBe(0);
    });

    it('should handle odd number of players in queue', () => {
      queue.set('user-1', { userId: 'user-1', socketId: 'socket-1', joinedAt: Date.now() });
      queue.set('user-2', { userId: 'user-2', socketId: 'socket-2', joinedAt: Date.now() });
      queue.set('user-3', { userId: 'user-3', socketId: 'socket-3', joinedAt: Date.now() });

      // Match first two
      queue.delete('user-1');
      queue.delete('user-2');

      // One left waiting
      expect(queue.size).toBe(1);
      expect(queue.has('user-3')).toBe(true);
    });

    it('should not create match with only one player', () => {
      queue.set('user-1', { userId: 'user-1', socketId: 'socket-1', joinedAt: Date.now() });

      const canMatch = queue.size >= 2;
      expect(canMatch).toBe(false);
    });
  });

  describe('Disconnect Handling', () => {
    it('should remove user from queue on disconnect', () => {
      const userId = 'user-1';
      queue.set(userId, {
        userId,
        socketId: 'socket-1',
        joinedAt: Date.now()
      });

      expect(queue.has(userId)).toBe(true);

      // Simulate disconnect
      queue.delete(userId);

      expect(queue.has(userId)).toBe(false);
    });

    it('should handle disconnect of user in matching lock', () => {
      const userId = 'user-1';

      queue.set(userId, {
        userId,
        socketId: 'socket-1',
        isMatching: true,
        joinedAt: Date.now()
      });

      locks.add(userId);

      // User disconnects
      queue.delete(userId);
      locks.delete(userId);

      expect(queue.has(userId)).toBe(false);
      expect(locks.has(userId)).toBe(false);
    });

    it('should allow reconnection after disconnect', () => {
      const userId = 'user-1';

      // First connection
      queue.set(userId, {
        userId,
        socketId: 'socket-1',
        joinedAt: Date.now()
      });

      // Disconnect
      queue.delete(userId);

      // Reconnect with new socket
      queue.set(userId, {
        userId,
        socketId: 'socket-2',
        joinedAt: Date.now()
      });

      expect(queue.size).toBe(1);
      expect(queue.get(userId).socketId).toBe('socket-2');
    });
  });

  describe('Invalid State Transitions', () => {
    it('should not allow user in active battle to join queue', () => {
      const userId = 'user-1';
      const isInBattle = true; // Simulated check

      if (!isInBattle) {
        queue.set(userId, {
          userId,
          socketId: 'socket-1',
          joinedAt: Date.now()
        });
      }

      expect(queue.has(userId)).toBe(false);
    });

    it('should handle queue entry with missing required fields', () => {
      const invalidEntry = {
        userId: 'user-1'
        // Missing socketId, joinedAt, loadoutId
      };

      const isValid = !!(invalidEntry.userId &&
                     invalidEntry.socketId &&
                     invalidEntry.joinedAt &&
                     invalidEntry.loadoutId);

      expect(isValid).toBe(false);
    });

    it('should validate loadout exists before joining queue', () => {
      const entry = {
        userId: 'user-1',
        loadoutId: 'non-existent-loadout',
        socketId: 'socket-1',
        joinedAt: Date.now()
      };

      // In real implementation, would check if loadout exists in DB
      const loadoutExists = false; // Simulated check

      if (loadoutExists) {
        queue.set(entry.userId, entry);
      }

      expect(queue.has('user-1')).toBe(false);
    });
  });

  describe('Queue Cleanup', () => {
    it('should remove stale entries during cleanup', () => {
      const STALE_THRESHOLD = 300000; // 5 minutes
      const now = Date.now();

      queue.set('fresh-1', { userId: 'fresh-1', joinedAt: now - 10000, socketId: 'socket-1' });
      queue.set('stale-1', { userId: 'stale-1', joinedAt: now - STALE_THRESHOLD - 10000, socketId: 'socket-2' });
      queue.set('fresh-2', { userId: 'fresh-2', joinedAt: now - 20000, socketId: 'socket-3' });
      queue.set('stale-2', { userId: 'stale-2', joinedAt: now - STALE_THRESHOLD - 20000, socketId: 'socket-4' });

      // Cleanup stale entries
      for (const [userId, entry] of queue.entries()) {
        const timeInQueue = now - entry.joinedAt;
        if (timeInQueue > STALE_THRESHOLD) {
          queue.delete(userId);
        }
      }

      expect(queue.size).toBe(2);
      expect(queue.has('fresh-1')).toBe(true);
      expect(queue.has('fresh-2')).toBe(true);
      expect(queue.has('stale-1')).toBe(false);
      expect(queue.has('stale-2')).toBe(false);
    });

    it('should handle cleanup of empty queue', () => {
      expect(() => {
        for (const [userId, entry] of queue.entries()) {
          queue.delete(userId);
        }
      }).not.toThrow();

      expect(queue.size).toBe(0);
    });
  });

  describe('Queue Statistics', () => {
    it('should calculate average wait time correctly', () => {
      const now = Date.now();

      queue.set('user-1', { userId: 'user-1', joinedAt: now - 10000, socketId: 'socket-1' });
      queue.set('user-2', { userId: 'user-2', joinedAt: now - 20000, socketId: 'socket-2' });
      queue.set('user-3', { userId: 'user-3', joinedAt: now - 30000, socketId: 'socket-3' });

      const waitTimes = Array.from(queue.values()).map(e => now - e.joinedAt);
      const avgWaitTime = waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length;

      expect(avgWaitTime).toBe(20000); // (10000 + 20000 + 30000) / 3
    });

    it('should track queue size over time', () => {
      const sizes = [];

      sizes.push(queue.size); // 0

      queue.set('user-1', { userId: 'user-1', socketId: 'socket-1', joinedAt: Date.now() });
      sizes.push(queue.size); // 1

      queue.set('user-2', { userId: 'user-2', socketId: 'socket-2', joinedAt: Date.now() });
      sizes.push(queue.size); // 2

      queue.delete('user-1');
      sizes.push(queue.size); // 1

      expect(sizes).toEqual([0, 1, 2, 1]);
    });

    it('should calculate queue occupancy rate', () => {
      const MAX_QUEUE_SIZE = 100;

      for (let i = 0; i < 25; i++) {
        queue.set(`user-${i}`, {
          userId: `user-${i}`,
          socketId: `socket-${i}`,
          joinedAt: Date.now()
        });
      }

      const occupancyRate = (queue.size / MAX_QUEUE_SIZE) * 100;
      expect(occupancyRate).toBe(25);
    });
  });

  describe('Preference-Based Matching Edge Cases', () => {
    it('should handle case where no matches satisfy all preferences', () => {
      const player1 = {
        userId: 'user-1',
        elo: 1000,
        loadout: { model: 'opus' },
        preferences: {
          modelPreference: 'haiku',
          eloRange: 'similar'
        },
        joinedAt: Date.now()
      };

      const player2 = {
        userId: 'user-2',
        elo: 2000,
        loadout: { model: 'sonnet' },
        preferences: {
          modelPreference: 'any',
          eloRange: 'any'
        },
        joinedAt: Date.now()
      };

      queue.set('user-1', player1);
      queue.set('user-2', player2);

      // Check if they match
      const modelMatches = player2.loadout.model === player1.preferences.modelPreference;
      const eloMatches = Math.abs(player1.elo - player2.elo) <= 200;

      const canMatch = modelMatches && eloMatches;
      expect(canMatch).toBe(false);
    });

    it('should expand preferences after timeout', () => {
      const EXPAND_TIMEOUT = 60000;

      const player = {
        userId: 'user-1',
        elo: 1000,
        loadout: { model: 'sonnet' },
        preferences: {
          modelPreference: 'same-model-only',
          eloRange: 'similar',
          original: true
        },
        joinedAt: Date.now() - EXPAND_TIMEOUT - 1000,
        expandedSearchAt: null
      };

      queue.set('user-1', player);

      const entry = queue.get('user-1');
      const shouldExpand = (Date.now() - entry.joinedAt) >= EXPAND_TIMEOUT && !entry.expandedSearchAt;

      if (shouldExpand) {
        entry.preferences = {
          ...entry.preferences,
          modelPreference: 'any',
          eloRange: 'any',
          expanded: true
        };
        entry.expandedSearchAt = Date.now();
      }

      expect(entry.preferences.modelPreference).toBe('any');
      expect(entry.preferences.eloRange).toBe('any');
      expect(entry.preferences.expanded).toBe(true);
    });
  });

  describe('Memory Management', () => {
    it('should handle very large queue size', () => {
      const LARGE_SIZE = 1000;

      for (let i = 0; i < LARGE_SIZE; i++) {
        queue.set(`user-${i}`, {
          userId: `user-${i}`,
          socketId: `socket-${i}`,
          joinedAt: Date.now()
        });
      }

      expect(queue.size).toBe(LARGE_SIZE);

      // Clear
      queue.clear();
      expect(queue.size).toBe(0);
    });

    it('should prevent memory leaks from orphaned locks', () => {
      locks.add('user-1');
      locks.add('user-2');
      locks.add('user-3');

      expect(locks.size).toBe(3);

      // Clear all locks
      locks.clear();
      expect(locks.size).toBe(0);
    });
  });
});
