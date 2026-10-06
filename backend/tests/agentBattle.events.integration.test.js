/**
 * Integration tests for agent battle event recording
 * Tests the database layer for event recording during battles
 */

const { v4: uuidv4 } = require('uuid');

// Mock logger BEFORE any imports
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const os = require('os');
const path = require('path');
const fs = require('fs');
// Isolate this suite's DB. db.js reads DB_PATH at require time, so set a unique
// temp path BEFORE requiring db. Otherwise this suite runs against the shared
// backend/data.sqlite and fails with "no such table" when it happens to run
// before any DB-initializing test (a pre-existing, order-dependent flake).
process.env.DB_PATH = path.join(os.tmpdir(), `agentbattle-events-${Date.now()}-${process.pid}.sqlite`);

// Import db after mocking logger
const db = require('../db');

describe('Agent Battle Event Recording Integration', () => {
  let userId1;
  let userId2;
  let loadout1Id;
  let loadout2Id;
  let testId;

  beforeAll(async () => {
    await db.init();
  });

  afterAll(() => {
    try { fs.unlinkSync(process.env.DB_PATH); } catch (_) { /* best-effort temp cleanup */ }
  });

  beforeEach(async () => {
    // Use unique test ID for each test run to avoid conflicts
    testId = uuidv4().slice(0, 8);

    // Create test users with unique emails
    const user1 = await db.run(
      `INSERT INTO users (username, email, password, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [`event_test_user1_${testId}`, `event1_${testId}@test.com`, 'hash']
    );
    userId1 = user1.lastID;

    const user2 = await db.run(
      `INSERT INTO users (username, email, password, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [`event_test_user2_${testId}`, `event2_${testId}@test.com`, 'hash']
    );
    userId2 = user2.lastID;

    // Create loadouts
    loadout1Id = uuidv4();
    await db.run(
      `INSERT INTO agent_loadouts (id, user_id, name, model, system_prompt, language, tools, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [loadout1Id, userId1, 'Test Loadout 1', 'haiku', 'Solve coding problems', 'python', JSON.stringify(['run_code'])]
    );

    loadout2Id = uuidv4();
    await db.run(
      `INSERT INTO agent_loadouts (id, user_id, name, model, system_prompt, language, tools, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [loadout2Id, userId2, 'Test Loadout 2', 'sonnet', 'Solve coding problems', 'python', JSON.stringify(['run_code'])]
    );
  });

  afterEach(async () => {
    // Clean up test data
    await db.run('DELETE FROM agent_battle_events WHERE battle_id IN (SELECT id FROM agent_battles WHERE player1_id = ? OR player2_id = ?)', [userId1, userId2]);
    await db.run('DELETE FROM agent_battles WHERE player1_id = ? OR player2_id = ?', [userId1, userId2]);
    await db.run('DELETE FROM agent_loadouts WHERE id IN (?, ?)', [loadout1Id, loadout2Id]);
    await db.run('DELETE FROM users WHERE id IN (?, ?)', [userId1, userId2]);
  });

  describe('Battle Start Events', () => {
    test('should record battle_start event when battle begins', async () => {
      const battleId = uuidv4();
      await db.run(
        `INSERT INTO agent_battles (id, player1_id, player2_id, loadout1_id, loadout2_id,
          problem_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [battleId, userId1, userId2, loadout1Id, loadout2Id, 'two-sum', 'in_progress', new Date().toISOString()]
      );

      // Simulate recording battle_start event
      await db.run(
        `INSERT INTO agent_battle_events (battle_id, event_type, player_id, event_data, timestamp_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [
          battleId,
          'battle_start',
          0,
          JSON.stringify({
            problem: {
              id: 'two-sum',
              title: 'Two Sum',
              description: 'Test problem',
              examples: [{ input: [1, 2], output: [0, 1] }]
            }
          }),
          0
        ]
      );

      // Verify event was recorded
      const events = await db.all(
        'SELECT * FROM agent_battle_events WHERE battle_id = ? AND event_type = ?',
        [battleId, 'battle_start']
      );

      expect(events.length).toBe(1);
      expect(events[0].player_id).toBe(0); // System event
      expect(events[0].timestamp_ms).toBe(0);

      const eventData = JSON.parse(events[0].event_data);
      expect(eventData.problem).toBeDefined();
      expect(eventData.problem.id).toBe('two-sum');
    });
  });

  describe('Coding Events', () => {
    test('should record coding_started events for both players', async () => {
      const battleId = uuidv4();
      await db.run(
        `INSERT INTO agent_battles (id, player1_id, player2_id, loadout1_id, loadout2_id,
          problem_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [battleId, userId1, userId2, loadout1Id, loadout2Id, 'two-sum', 'in_progress', new Date().toISOString()]
      );

      // Record coding_started for both players
      await db.run(
        `INSERT INTO agent_battle_events (battle_id, event_type, player_id, event_data, timestamp_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [
          battleId,
          'coding_started',
          userId1,
          JSON.stringify({ loadout: { model: 'haiku', language: 'python' } }),
          100
        ]
      );

      await db.run(
        `INSERT INTO agent_battle_events (battle_id, event_type, player_id, event_data, timestamp_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [
          battleId,
          'coding_started',
          userId2,
          JSON.stringify({ loadout: { model: 'sonnet', language: 'python' } }),
          150
        ]
      );

      // Verify events
      const events = await db.all(
        'SELECT * FROM agent_battle_events WHERE battle_id = ? AND event_type = ? ORDER BY timestamp_ms',
        [battleId, 'coding_started']
      );

      expect(events.length).toBe(2);
      expect(events[0].player_id).toBe(userId1);
      expect(events[1].player_id).toBe(userId2);
      expect(events[0].timestamp_ms).toBeLessThan(events[1].timestamp_ms);
    });

    test('should record code_chunk events in sequence', async () => {
      const battleId = uuidv4();
      await db.run(
        `INSERT INTO agent_battles (id, player1_id, player2_id, loadout1_id, loadout2_id,
          problem_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [battleId, userId1, userId2, loadout1Id, loadout2Id, 'two-sum', 'in_progress', new Date().toISOString()]
      );

      // Simulate code generation with multiple chunks
      const codeChunks = [
        'def twoSum(',
        'nums, target',
        '):\n    ',
        'return [0, 1]'
      ];

      let timestamp = 500;
      for (const chunk of codeChunks) {
        await db.run(
          `INSERT INTO agent_battle_events (battle_id, event_type, player_id, event_data, timestamp_ms)
           VALUES (?, ?, ?, ?, ?)`,
          [battleId, 'code_chunk', userId1, JSON.stringify({ chunk }), timestamp]
        );
        timestamp += 100;
      }

      // Verify events
      const events = await db.all(
        'SELECT * FROM agent_battle_events WHERE battle_id = ? AND event_type = ? ORDER BY timestamp_ms',
        [battleId, 'code_chunk']
      );

      expect(events.length).toBe(4);

      // Reconstruct code from chunks
      let reconstructedCode = '';
      events.forEach(event => {
        const data = JSON.parse(event.event_data);
        reconstructedCode += data.chunk;
      });

      expect(reconstructedCode).toBe('def twoSum(nums, target):\n    return [0, 1]');
    });

    test('should maintain timestamp order for interleaved code chunks', async () => {
      const battleId = uuidv4();
      await db.run(
        `INSERT INTO agent_battles (id, player1_id, player2_id, loadout1_id, loadout2_id,
          problem_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [battleId, userId1, userId2, loadout1Id, loadout2Id, 'two-sum', 'in_progress', new Date().toISOString()]
      );

      // Simulate interleaved code generation
      const chunks = [
        { player: userId1, chunk: 'def ', timestamp: 100 },
        { player: userId2, chunk: 'def ', timestamp: 150 },
        { player: userId1, chunk: 'twoSum', timestamp: 200 },
        { player: userId2, chunk: 'twoSum', timestamp: 220 },
        { player: userId1, chunk: '():', timestamp: 300 },
        { player: userId2, chunk: '():', timestamp: 350 }
      ];

      for (const { player, chunk, timestamp } of chunks) {
        await db.run(
          `INSERT INTO agent_battle_events (battle_id, event_type, player_id, event_data, timestamp_ms)
           VALUES (?, ?, ?, ?, ?)`,
          [battleId, 'code_chunk', player, JSON.stringify({ chunk }), timestamp]
        );
      }

      // Verify chronological order
      const events = await db.all(
        'SELECT * FROM agent_battle_events WHERE battle_id = ? AND event_type = ? ORDER BY timestamp_ms',
        [battleId, 'code_chunk']
      );

      expect(events.length).toBe(6);

      for (let i = 1; i < events.length; i++) {
        expect(events[i].timestamp_ms).toBeGreaterThanOrEqual(events[i - 1].timestamp_ms);
      }
    });
  });

  describe('Tool Usage Events', () => {
    test('should record tool_use events with input and output', async () => {
      const battleId = uuidv4();
      await db.run(
        `INSERT INTO agent_battles (id, player1_id, player2_id, loadout1_id, loadout2_id,
          problem_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [battleId, userId1, userId2, loadout1Id, loadout2Id, 'two-sum', 'in_progress', new Date().toISOString()]
      );

      // Record tool usage
      await db.run(
        `INSERT INTO agent_battle_events (battle_id, event_type, player_id, event_data, timestamp_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [
          battleId,
          'tool_use',
          userId1,
          JSON.stringify({
            tool: 'run_code',
            input: { code: 'print("test")' },
            output: { success: true, output: 'test\n', stderr: '' }
          }),
          1500
        ]
      );

      // Verify event
      const events = await db.all(
        'SELECT * FROM agent_battle_events WHERE battle_id = ? AND event_type = ?',
        [battleId, 'tool_use']
      );

      expect(events.length).toBe(1);

      const eventData = JSON.parse(events[0].event_data);
      expect(eventData.tool).toBe('run_code');
      expect(eventData.input).toBeDefined();
      expect(eventData.output).toBeDefined();
      expect(eventData.output.success).toBe(true);
    });

    test('should record tool errors', async () => {
      const battleId = uuidv4();
      await db.run(
        `INSERT INTO agent_battles (id, player1_id, player2_id, loadout1_id, loadout2_id,
          problem_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [battleId, userId1, userId2, loadout1Id, loadout2Id, 'two-sum', 'in_progress', new Date().toISOString()]
      );

      // Record tool error
      await db.run(
        `INSERT INTO agent_battle_events (battle_id, event_type, player_id, event_data, timestamp_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [
          battleId,
          'tool_use',
          userId1,
          JSON.stringify({
            tool: 'run_code',
            input: { code: 'invalid syntax(' },
            output: { success: false, error: 'SyntaxError: invalid syntax' }
          }),
          1500
        ]
      );

      // Verify event
      const events = await db.all(
        'SELECT * FROM agent_battle_events WHERE battle_id = ? AND event_type = ?',
        [battleId, 'tool_use']
      );

      expect(events.length).toBe(1);

      const eventData = JSON.parse(events[0].event_data);
      expect(eventData.output.success).toBe(false);
      expect(eventData.output.error).toContain('SyntaxError');
    });
  });

  describe('Submission and Result Events', () => {
    test('should record submission events', async () => {
      const battleId = uuidv4();
      await db.run(
        `INSERT INTO agent_battles (id, player1_id, player2_id, loadout1_id, loadout2_id,
          problem_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [battleId, userId1, userId2, loadout1Id, loadout2Id, 'two-sum', 'in_progress', new Date().toISOString()]
      );

      const finalCode = 'def twoSum(nums, target):\n    return [0, 1]';

      await db.run(
        `INSERT INTO agent_battle_events (battle_id, event_type, player_id, event_data, timestamp_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [
          battleId,
          'submission',
          userId1,
          JSON.stringify({ code: finalCode, success: true }),
          2000
        ]
      );

      // Verify event
      const events = await db.all(
        'SELECT * FROM agent_battle_events WHERE battle_id = ? AND event_type = ?',
        [battleId, 'submission']
      );

      expect(events.length).toBe(1);

      const eventData = JSON.parse(events[0].event_data);
      expect(eventData.code).toBe(finalCode);
      expect(eventData.success).toBe(true);
    });

    test('should record result events with complete metrics', async () => {
      const battleId = uuidv4();
      await db.run(
        `INSERT INTO agent_battles (id, player1_id, player2_id, loadout1_id, loadout2_id,
          problem_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [battleId, userId1, userId2, loadout1Id, loadout2Id, 'two-sum', 'in_progress', new Date().toISOString()]
      );

      await db.run(
        `INSERT INTO agent_battle_events (battle_id, event_type, player_id, event_data, timestamp_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [
          battleId,
          'result',
          userId1,
          JSON.stringify({
            status: 'completed',
            passedCount: 10,
            totalTests: 10,
            executionTime: 45,
            tokensUsed: 256,
            generationTimeMs: 1450,
            toolCalls: 2
          }),
          2500
        ]
      );

      // Verify event
      const events = await db.all(
        'SELECT * FROM agent_battle_events WHERE battle_id = ? AND event_type = ?',
        [battleId, 'result']
      );

      expect(events.length).toBe(1);

      const eventData = JSON.parse(events[0].event_data);
      expect(eventData.status).toBe('completed');
      expect(eventData.passedCount).toBe(10);
      expect(eventData.totalTests).toBe(10);
      expect(eventData.executionTime).toBe(45);
      expect(eventData.tokensUsed).toBe(256);
      expect(eventData.generationTimeMs).toBe(1450);
      expect(eventData.toolCalls).toBe(2);
    });

    test('should record failed results', async () => {
      const battleId = uuidv4();
      await db.run(
        `INSERT INTO agent_battles (id, player1_id, player2_id, loadout1_id, loadout2_id,
          problem_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [battleId, userId1, userId2, loadout1Id, loadout2Id, 'two-sum', 'in_progress', new Date().toISOString()]
      );

      await db.run(
        `INSERT INTO agent_battle_events (battle_id, event_type, player_id, event_data, timestamp_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [
          battleId,
          'result',
          userId2,
          JSON.stringify({
            status: 'failed',
            passedCount: 3,
            totalTests: 10,
            executionTime: 30,
            tokensUsed: 180,
            generationTimeMs: 1200,
            toolCalls: 0
          }),
          2600
        ]
      );

      // Verify event
      const events = await db.all(
        'SELECT * FROM agent_battle_events WHERE battle_id = ? AND event_type = ?',
        [battleId, 'result']
      );

      expect(events.length).toBe(1);

      const eventData = JSON.parse(events[0].event_data);
      expect(eventData.status).toBe('failed');
      expect(eventData.passedCount).toBeLessThan(eventData.totalTests);
    });
  });

  describe('Complete Battle Flow', () => {
    test('should record all events for a complete battle', async () => {
      const battleId = uuidv4();
      await db.run(
        `INSERT INTO agent_battles (id, player1_id, player2_id, loadout1_id, loadout2_id,
          problem_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [battleId, userId1, userId2, loadout1Id, loadout2Id, 'two-sum', 'finished', new Date().toISOString()]
      );

      // Record complete battle flow
      const events = [
        { type: 'battle_start', player: 0, data: { problem: { id: 'two-sum' } }, time: 0 },
        { type: 'coding_started', player: userId1, data: { loadout: { model: 'haiku' } }, time: 100 },
        { type: 'coding_started', player: userId2, data: { loadout: { model: 'sonnet' } }, time: 150 },
        { type: 'code_chunk', player: userId1, data: { chunk: 'def ' }, time: 200 },
        { type: 'code_chunk', player: userId2, data: { chunk: 'def ' }, time: 250 },
        { type: 'tool_use', player: userId1, data: { tool: 'run_code' }, time: 1000 },
        { type: 'submission', player: userId1, data: { code: 'def twoSum(): pass' }, time: 2000 },
        { type: 'submission', player: userId2, data: { code: 'def twoSum(): pass' }, time: 2100 },
        { type: 'result', player: userId1, data: { status: 'completed', passedCount: 10, totalTests: 10 }, time: 2500 },
        { type: 'result', player: userId2, data: { status: 'failed', passedCount: 5, totalTests: 10 }, time: 2600 }
      ];

      for (const event of events) {
        await db.run(
          `INSERT INTO agent_battle_events (battle_id, event_type, player_id, event_data, timestamp_ms)
           VALUES (?, ?, ?, ?, ?)`,
          [battleId, event.type, event.player, JSON.stringify(event.data), event.time]
        );
      }

      // Verify complete event sequence
      const recordedEvents = await db.all(
        'SELECT * FROM agent_battle_events WHERE battle_id = ? ORDER BY timestamp_ms',
        [battleId]
      );

      expect(recordedEvents.length).toBe(10);

      // Verify event types in order
      expect(recordedEvents[0].event_type).toBe('battle_start');
      expect(recordedEvents[1].event_type).toBe('coding_started');
      expect(recordedEvents[2].event_type).toBe('coding_started');
      expect(recordedEvents[recordedEvents.length - 2].event_type).toBe('result');
      expect(recordedEvents[recordedEvents.length - 1].event_type).toBe('result');

      // Verify timestamps are monotonically increasing
      for (let i = 1; i < recordedEvents.length; i++) {
        expect(recordedEvents[i].timestamp_ms).toBeGreaterThanOrEqual(recordedEvents[i - 1].timestamp_ms);
      }
    });
  });

  describe('Event Data Validation', () => {
    test('should handle JSON serialization of complex data', async () => {
      const battleId = uuidv4();
      await db.run(
        `INSERT INTO agent_battles (id, player1_id, player2_id, loadout1_id, loadout2_id,
          problem_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [battleId, userId1, userId2, loadout1Id, loadout2Id, 'two-sum', 'in_progress', new Date().toISOString()]
      );

      const complexData = {
        tool: 'run_code',
        input: {
          code: 'def test():\n\treturn {"key": "value"}',
          nested: {
            array: [1, 2, 3],
            object: { a: 1, b: 2 }
          }
        },
        output: {
          success: true,
          result: { data: [{ id: 1 }, { id: 2 }] }
        }
      };

      await db.run(
        `INSERT INTO agent_battle_events (battle_id, event_type, player_id, event_data, timestamp_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [battleId, 'tool_use', userId1, JSON.stringify(complexData), 1000]
      );

      // Retrieve and verify
      const events = await db.all(
        'SELECT * FROM agent_battle_events WHERE battle_id = ?',
        [battleId]
      );

      const retrievedData = JSON.parse(events[0].event_data);
      expect(retrievedData).toEqual(complexData);
    });

    test('should preserve special characters in event data', async () => {
      const battleId = uuidv4();
      await db.run(
        `INSERT INTO agent_battles (id, player1_id, player2_id, loadout1_id, loadout2_id,
          problem_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [battleId, userId1, userId2, loadout1Id, loadout2Id, 'two-sum', 'in_progress', new Date().toISOString()]
      );

      const specialChars = 'Code with "quotes", \'apostrophes\', <tags>, &ampersands, \\backslashes, and emoji 🔥';

      await db.run(
        `INSERT INTO agent_battle_events (battle_id, event_type, player_id, event_data, timestamp_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [battleId, 'code_chunk', userId1, JSON.stringify({ chunk: specialChars }), 500]
      );

      const events = await db.all(
        'SELECT * FROM agent_battle_events WHERE battle_id = ?',
        [battleId]
      );

      const eventData = JSON.parse(events[0].event_data);
      expect(eventData.chunk).toBe(specialChars);
    });
  });
});
