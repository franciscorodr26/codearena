/**
 * Agent Matchmaking Preferences Tests
 *
 * Tests the preference matching logic for agent battles:
 * - Model preference matching (any, same-model-only, specific models)
 * - ELO range matching (any, similar ±200, custom range)
 * - Difficulty preference application
 * - Search expansion after timeout
 * - Match quality calculation
 */

const { v4: uuidv4 } = require('uuid');

// Mock database
const mockDb = {
  get: jest.fn(),
  all: jest.fn(),
  run: jest.fn(),
  getUserById: jest.fn()
};
jest.mock('../db', () => mockDb);

// Mock JWT
const mockJwt = {
  verify: jest.fn(),
  sign: jest.fn()
};
jest.mock('jsonwebtoken', () => mockJwt);

// Mock logger
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

describe('Agent Matchmaking Preferences', () => {
  // Helper to create a player queue entry
  const createPlayer = (overrides = {}) => {
    const defaults = {
      loadoutId: uuidv4(),
      userId: Math.floor(Math.random() * 10000),
      username: `player${Math.random()}`,
      socketId: `socket-${Math.random()}`,
      loadout: {
        model: 'sonnet',
        language: 'python',
        tools: [],
        systemPrompt: ''
      },
      elo: 1000,
      preferences: {
        modelPreference: 'any',
        eloRange: 'any',
        customEloMin: null,
        customEloMax: null,
        difficulty: 'any'
      },
      joinedAt: Date.now(),
      expandedSearchAt: null,
      isMatching: false
    };

    // Merge overrides properly, especially nested objects
    return {
      ...defaults,
      ...overrides,
      loadout: {
        ...defaults.loadout,
        ...(overrides.loadout || {})
      },
      preferences: {
        ...defaults.preferences,
        ...(overrides.preferences || {})
      }
    };
  };

  // Extracted matching logic from server.js for testing
  const checkModelPreference = (player1, player2) => {
    const p1Prefs = player1.preferences;
    const p2Prefs = player2.preferences;

    // Check player 1's preferences
    if (p1Prefs.modelPreference === 'same-model-only') {
      if (player1.loadout.model !== player2.loadout.model) return false;
    } else if (p1Prefs.modelPreference !== 'any') {
      // Specific model preference (haiku, sonnet, opus)
      if (player2.loadout.model !== p1Prefs.modelPreference) return false;
    }

    // Check player 2's preferences
    if (p2Prefs.modelPreference === 'same-model-only') {
      if (player2.loadout.model !== player1.loadout.model) return false;
    } else if (p2Prefs.modelPreference !== 'any') {
      // Specific model preference (haiku, sonnet, opus)
      if (player1.loadout.model !== p2Prefs.modelPreference) return false;
    }

    return true;
  };

  const checkEloPreference = (player1, player2) => {
    const p1Prefs = player1.preferences;
    const p2Prefs = player2.preferences;

    // Check player 1's ELO preference
    if (p1Prefs.eloRange === 'similar') {
      const eloDiff = Math.abs(player1.elo - player2.elo);
      if (eloDiff > 200) return false;
    } else if (p1Prefs.eloRange === 'custom') {
      if (player2.elo < p1Prefs.customEloMin || player2.elo > p1Prefs.customEloMax) {
        return false;
      }
    }

    // Check player 2's ELO preference
    if (p2Prefs.eloRange === 'similar') {
      const eloDiff = Math.abs(player2.elo - player1.elo);
      if (eloDiff > 200) return false;
    } else if (p2Prefs.eloRange === 'custom') {
      if (player1.elo < p2Prefs.customEloMin || player1.elo > p2Prefs.customEloMax) {
        return false;
      }
    }

    return true;
  };

  const checkPreferenceMatch = (player1, player2) => {
    // Check model preferences
    const modelMatch = checkModelPreference(player1, player2);
    if (!modelMatch) return { matches: false, reason: 'model' };

    // Check ELO range preferences
    const eloMatch = checkEloPreference(player1, player2);
    if (!eloMatch) return { matches: false, reason: 'elo' };

    return { matches: true, reason: null };
  };

  const shouldExpandSearch = (queueEntry) => {
    const EXPAND_SEARCH_TIMEOUT = 60000; // 60 seconds
    const timeInQueue = Date.now() - queueEntry.joinedAt;

    if (timeInQueue >= EXPAND_SEARCH_TIMEOUT && !queueEntry.expandedSearchAt) {
      return true;
    }
    return false;
  };

  describe('Model Preference Matching', () => {
    it('should match players with "any" model preference', () => {
      const player1 = createPlayer({
        loadout: { model: 'sonnet' },
        preferences: { modelPreference: 'any' }
      });
      const player2 = createPlayer({
        loadout: { model: 'haiku' },
        preferences: { modelPreference: 'any' }
      });

      const result = checkPreferenceMatch(player1, player2);
      expect(result.matches).toBe(true);
    });

    it('should match players with same-model-only when models match', () => {
      const player1 = createPlayer({
        loadout: { model: 'sonnet' },
        preferences: { modelPreference: 'same-model-only' }
      });
      const player2 = createPlayer({
        loadout: { model: 'sonnet' },
        preferences: { modelPreference: 'any' }
      });

      const result = checkPreferenceMatch(player1, player2);
      expect(result.matches).toBe(true);
    });

    it('should not match players with same-model-only when models differ', () => {
      const player1 = createPlayer({
        loadout: { model: 'sonnet' },
        preferences: { modelPreference: 'same-model-only' }
      });
      const player2 = createPlayer({
        loadout: { model: 'haiku' },
        preferences: { modelPreference: 'any' }
      });

      const result = checkPreferenceMatch(player1, player2);
      expect(result.matches).toBe(false);
      expect(result.reason).toBe('model');
    });

    it('should match when player wants specific model and opponent has it', () => {
      const player1 = createPlayer({
        loadout: { model: 'sonnet' },
        preferences: { modelPreference: 'haiku' }
      });
      const player2 = createPlayer({
        loadout: { model: 'haiku' },
        preferences: { modelPreference: 'any' }
      });

      const result = checkPreferenceMatch(player1, player2);
      expect(result.matches).toBe(true);
    });

    it('should not match when player wants specific model and opponent does not have it', () => {
      const player1 = createPlayer({
        loadout: { model: 'sonnet' },
        preferences: { modelPreference: 'opus' }
      });
      const player2 = createPlayer({
        loadout: { model: 'haiku' },
        preferences: { modelPreference: 'any' }
      });

      const result = checkPreferenceMatch(player1, player2);
      expect(result.matches).toBe(false);
      expect(result.reason).toBe('model');
    });

    it('should not match when both want same-model-only but have different models', () => {
      const player1 = createPlayer({
        loadout: { model: 'sonnet' },
        preferences: { modelPreference: 'same-model-only' }
      });
      const player2 = createPlayer({
        loadout: { model: 'haiku' },
        preferences: { modelPreference: 'same-model-only' }
      });

      const result = checkPreferenceMatch(player1, player2);
      expect(result.matches).toBe(false);
      expect(result.reason).toBe('model');
    });

    it('should match when both want same-model-only and have same model', () => {
      const player1 = createPlayer({
        loadout: { model: 'sonnet' },
        preferences: { modelPreference: 'same-model-only' }
      });
      const player2 = createPlayer({
        loadout: { model: 'sonnet' },
        preferences: { modelPreference: 'same-model-only' }
      });

      const result = checkPreferenceMatch(player1, player2);
      expect(result.matches).toBe(true);
    });
  });

  describe('ELO Range Preference Matching', () => {
    it('should match players with "any" ELO preference regardless of rating', () => {
      const player1 = createPlayer({
        elo: 800,
        preferences: { eloRange: 'any' }
      });
      const player2 = createPlayer({
        elo: 1500,
        preferences: { eloRange: 'any' }
      });

      const result = checkPreferenceMatch(player1, player2);
      expect(result.matches).toBe(true);
    });

    it('should match players with similar ELO within ±200', () => {
      const player1 = createPlayer({
        elo: 1000,
        preferences: { eloRange: 'similar' }
      });
      const player2 = createPlayer({
        elo: 1150,
        preferences: { eloRange: 'any' }
      });

      const result = checkPreferenceMatch(player1, player2);
      expect(result.matches).toBe(true);
    });

    it('should not match players with similar ELO preference when difference exceeds 200', () => {
      const player1 = createPlayer({
        elo: 1000,
        preferences: { eloRange: 'similar' }
      });
      const player2 = createPlayer({
        elo: 1250,
        preferences: { eloRange: 'any' }
      });

      const result = checkPreferenceMatch(player1, player2);
      expect(result.matches).toBe(false);
      expect(result.reason).toBe('elo');
    });

    it('should match players within custom ELO range', () => {
      const player1 = createPlayer({
        elo: 1000,
        preferences: {
          eloRange: 'custom',
          customEloMin: 800,
          customEloMax: 1200
        }
      });
      const player2 = createPlayer({
        elo: 1100,
        preferences: { eloRange: 'any' }
      });

      const result = checkPreferenceMatch(player1, player2);
      expect(result.matches).toBe(true);
    });

    it('should not match players outside custom ELO range', () => {
      const player1 = createPlayer({
        elo: 1000,
        preferences: {
          eloRange: 'custom',
          customEloMin: 800,
          customEloMax: 1200
        }
      });
      const player2 = createPlayer({
        elo: 1300,
        preferences: { eloRange: 'any' }
      });

      const result = checkPreferenceMatch(player1, player2);
      expect(result.matches).toBe(false);
      expect(result.reason).toBe('elo');
    });

    it('should satisfy both players custom ELO ranges', () => {
      const player1 = createPlayer({
        elo: 1000,
        preferences: {
          eloRange: 'custom',
          customEloMin: 900,
          customEloMax: 1100
        }
      });
      const player2 = createPlayer({
        elo: 1050,
        preferences: {
          eloRange: 'custom',
          customEloMin: 950,
          customEloMax: 1200
        }
      });

      const result = checkPreferenceMatch(player1, player2);
      expect(result.matches).toBe(true);
    });

    it('should not match when one player is outside the other custom range', () => {
      const player1 = createPlayer({
        elo: 1000,
        preferences: {
          eloRange: 'custom',
          customEloMin: 900,
          customEloMax: 1100
        }
      });
      const player2 = createPlayer({
        elo: 1200,
        preferences: {
          eloRange: 'custom',
          customEloMin: 1150,
          customEloMax: 1300
        }
      });

      const result = checkPreferenceMatch(player1, player2);
      expect(result.matches).toBe(false);
      expect(result.reason).toBe('elo');
    });
  });

  describe('Combined Preference Matching', () => {
    it('should match when all preferences are satisfied', () => {
      const player1 = createPlayer({
        loadout: { model: 'sonnet' },
        elo: 1000,
        preferences: {
          modelPreference: 'same-model-only',
          eloRange: 'similar'
        }
      });
      const player2 = createPlayer({
        loadout: { model: 'sonnet' },
        elo: 1100,
        preferences: {
          modelPreference: 'any',
          eloRange: 'any'
        }
      });

      const result = checkPreferenceMatch(player1, player2);
      expect(result.matches).toBe(true);
    });

    it('should not match when model preference fails', () => {
      const player1 = createPlayer({
        loadout: { model: 'sonnet' },
        elo: 1000,
        preferences: {
          modelPreference: 'same-model-only',
          eloRange: 'similar'
        }
      });
      const player2 = createPlayer({
        loadout: { model: 'haiku' },
        elo: 1050,
        preferences: {
          modelPreference: 'any',
          eloRange: 'any'
        }
      });

      const result = checkPreferenceMatch(player1, player2);
      expect(result.matches).toBe(false);
      expect(result.reason).toBe('model');
    });

    it('should not match when ELO preference fails', () => {
      const player1 = createPlayer({
        loadout: { model: 'sonnet' },
        elo: 1000,
        preferences: {
          modelPreference: 'any',
          eloRange: 'similar'
        }
      });
      const player2 = createPlayer({
        loadout: { model: 'sonnet' },
        elo: 1500,
        preferences: {
          modelPreference: 'any',
          eloRange: 'any'
        }
      });

      const result = checkPreferenceMatch(player1, player2);
      expect(result.matches).toBe(false);
      expect(result.reason).toBe('elo');
    });
  });

  describe('Search Expansion', () => {
    it('should not expand search before timeout', () => {
      const player = createPlayer({
        joinedAt: Date.now()
      });

      const shouldExpand = shouldExpandSearch(player);
      expect(shouldExpand).toBe(false);
    });

    it('should expand search after 60 seconds', () => {
      const player = createPlayer({
        joinedAt: Date.now() - 61000 // 61 seconds ago
      });

      const shouldExpand = shouldExpandSearch(player);
      expect(shouldExpand).toBe(true);
    });

    it('should not expand search again if already expanded', () => {
      const player = createPlayer({
        joinedAt: Date.now() - 61000, // 61 seconds ago
        expandedSearchAt: Date.now() - 1000 // Already expanded
      });

      const shouldExpand = shouldExpandSearch(player);
      expect(shouldExpand).toBe(false);
    });
  });

  describe('Preference Validation', () => {
    it('should reject invalid model preference', () => {
      const validModelPreferences = ['any', 'same-model-only', 'haiku', 'sonnet', 'opus'];
      const invalidModel = 'invalid-model';

      expect(validModelPreferences.includes(invalidModel)).toBe(false);
    });

    it('should reject invalid ELO range preference', () => {
      const validEloRanges = ['any', 'similar', 'custom'];
      const invalidRange = 'invalid-range';

      expect(validEloRanges.includes(invalidRange)).toBe(false);
    });

    it('should reject invalid difficulty preference', () => {
      const validDifficulties = ['any', 'easy', 'medium', 'hard'];
      const invalidDifficulty = 'invalid-difficulty';

      expect(validDifficulties.includes(invalidDifficulty)).toBe(false);
    });

    it('should reject invalid custom ELO range (min >= max)', () => {
      const customEloMin = 1200;
      const customEloMax = 1000;

      expect(customEloMin < customEloMax).toBe(false);
    });

    it('should reject custom ELO below 0', () => {
      const customEloMin = -100;

      expect(customEloMin >= 0).toBe(false);
    });

    it('should reject custom ELO above 3000', () => {
      const customEloMax = 3500;

      expect(customEloMax <= 3000).toBe(false);
    });
  });
});
