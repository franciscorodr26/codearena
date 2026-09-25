/**
 * Test helpers for agent battle tests
 * Provides utilities for creating test users and loadouts
 */

const db = require('../db');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';

// Track created test data for cleanup
const createdUsers = [];
const createdLoadouts = [];

/**
 * Create a test user with authentication token
 */
async function createTestUser(overrides = {}) {
  const timestamp = Date.now();
  const userData = {
    username: `testuser_${timestamp}`,
    email: `test_${timestamp}@example.com`,
    password_hash: 'test-hash',
    elo: 1200,
    ...overrides
  };

  const result = await db.run(
    `INSERT INTO users (username, email, password_hash, elo, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [userData.username, userData.email, userData.password_hash, userData.elo]
  );

  const userId = result.lastID;
  createdUsers.push(userId);

  const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
  const token = jwt.sign({ userId: user.id, sub: user.id }, JWT_SECRET, { expiresIn: '1h' });

  return { user, token };
}

/**
 * Create a test loadout for a user
 */
async function createTestLoadout(userId, overrides = {}) {
  const timestamp = Date.now();
  const loadoutData = {
    name: `Test Loadout ${timestamp}`,
    description: 'A test loadout',
    model: 'sonnet',
    system_prompt: 'You are a test agent',
    language: 'python',
    tools: JSON.stringify(['test-runner']),
    is_public: 0,
    elo: 1200,
    ...overrides
  };

  const result = await db.run(
    `INSERT INTO agent_loadouts (user_id, name, description, model, system_prompt, language, tools, is_public, elo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [userId, loadoutData.name, loadoutData.description, loadoutData.model, loadoutData.system_prompt, loadoutData.language, loadoutData.tools, loadoutData.is_public, loadoutData.elo]
  );

  const loadoutId = result.lastID;
  createdLoadouts.push(loadoutId);

  const loadout = await db.get('SELECT * FROM agent_loadouts WHERE id = ?', [loadoutId]);
  return loadout;
}

/**
 * Clean up all test data created during tests
 */
async function cleanupTestData() {
  // Delete loadouts first (foreign key constraint)
  for (const loadoutId of createdLoadouts) {
    try {
      await db.run('DELETE FROM agent_loadout_versions WHERE loadout_id = ?', [loadoutId]);
      await db.run('DELETE FROM agent_loadouts WHERE id = ?', [loadoutId]);
    } catch (e) {
      // Ignore errors - table might not exist or data already deleted
    }
  }
  createdLoadouts.length = 0;

  // Delete users
  for (const userId of createdUsers) {
    try {
      await db.run('DELETE FROM agent_rate_limits WHERE user_id = ?', [userId]);
      await db.run('DELETE FROM users WHERE id = ?', [userId]);
    } catch (e) {
      // Ignore errors
    }
  }
  createdUsers.length = 0;
}

module.exports = {
  createTestUser,
  createTestLoadout,
  cleanupTestData
};
