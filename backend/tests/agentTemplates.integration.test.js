/**
 * Integration tests for Agent Loadout Templates
 * These tests run against a real database
 */
const db = require('../db');

describe('Agent Templates - Database Integration', () => {
  beforeAll(async () => {
    // Ensure database is initialized
    await db.init();
  });

  describe('Template Table Schema', () => {
    it('should have agent_loadout_templates table', async () => {
      const result = await db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_loadout_templates'"
      );
      expect(result).toBeTruthy();
      expect(result.name).toBe('agent_loadout_templates');
    });

    it('should have indexes on agent_loadout_templates', async () => {
      const indexes = await db.all(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agent_loadout_templates'"
      );
      const indexNames = indexes.map(i => i.name);
      expect(indexNames).toContain('idx_agent_templates_official');
      expect(indexNames).toContain('idx_agent_templates_sort');
    });
  });

  describe('Seeded Templates', () => {
    it('should have 5 seeded official templates', async () => {
      const templates = await db.all(
        'SELECT * FROM agent_loadout_templates WHERE is_official = 1 AND is_active = 1'
      );
      expect(templates.length).toBe(5);
    });

    it('should have Speed Demon template', async () => {
      const template = await db.get(
        "SELECT * FROM agent_loadout_templates WHERE id = 'template-speed-demon'"
      );
      expect(template).toBeTruthy();
      expect(template.name).toBe('Speed Demon');
      expect(template.strategy).toBe('aggressive');
      expect(template.model).toBe('haiku');
      expect(template.language).toBe('python');
      expect(template.win_rate).toBe(52.3);
    });

    it('should have Careful Coder template', async () => {
      const template = await db.get(
        "SELECT * FROM agent_loadout_templates WHERE id = 'template-careful-coder'"
      );
      expect(template).toBeTruthy();
      expect(template.name).toBe('Careful Coder');
      expect(template.strategy).toBe('defensive');
      expect(template.model).toBe('sonnet');
    });

    it('should have Grandmaster template with Opus model', async () => {
      const template = await db.get(
        "SELECT * FROM agent_loadout_templates WHERE id = 'template-grandmaster'"
      );
      expect(template).toBeTruthy();
      expect(template.name).toBe('Grandmaster');
      expect(template.strategy).toBe('elite');
      expect(template.model).toBe('opus');
      expect(template.win_rate).toBe(67.8);
    });

    it('should have valid JSON for tools field', async () => {
      const templates = await db.all(
        'SELECT id, tools FROM agent_loadout_templates WHERE is_official = 1'
      );

      for (const template of templates) {
        expect(() => JSON.parse(template.tools)).not.toThrow();
        const tools = JSON.parse(template.tools);
        expect(Array.isArray(tools)).toBe(true);
      }
    });

    it('should have templates ordered by sort_order', async () => {
      const templates = await db.all(
        'SELECT id, sort_order FROM agent_loadout_templates WHERE is_official = 1 ORDER BY sort_order'
      );

      expect(templates[0].id).toBe('template-speed-demon');
      expect(templates[0].sort_order).toBe(1);
      expect(templates[4].id).toBe('template-grandmaster');
      expect(templates[4].sort_order).toBe(5);
    });
  });

  describe('Template Cloning Logic', () => {
    it('should be able to increment times_used counter', async () => {
      const before = await db.get(
        "SELECT times_used FROM agent_loadout_templates WHERE id = 'template-speed-demon'"
      );

      await db.run(
        "UPDATE agent_loadout_templates SET times_used = times_used + 1 WHERE id = 'template-speed-demon'"
      );

      const after = await db.get(
        "SELECT times_used FROM agent_loadout_templates WHERE id = 'template-speed-demon'"
      );

      expect(after.times_used).toBe(before.times_used + 1);

      // Reset for other tests
      await db.run(
        "UPDATE agent_loadout_templates SET times_used = ? WHERE id = 'template-speed-demon'",
        [before.times_used]
      );
    });
  });
});

describe('Prompt Battle History - Database Integration', () => {
  beforeAll(async () => {
    await db.init();
  });

  describe('Table Schema', () => {
    it('should have prompt_battle_history table', async () => {
      const result = await db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='prompt_battle_history'"
      );
      expect(result).toBeTruthy();
      expect(result.name).toBe('prompt_battle_history');
    });

    it('should have indexes on prompt_battle_history', async () => {
      const indexes = await db.all(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='prompt_battle_history'"
      );
      const indexNames = indexes.map(i => i.name);
      expect(indexNames).toContain('idx_prompt_battle_history_player1');
      expect(indexNames).toContain('idx_prompt_battle_history_player2');
      expect(indexNames).toContain('idx_prompt_battle_history_finished');
    });
  });

  describe('Battle History CRUD', () => {
    let testBattleId;

    it('should be able to insert a battle record', async () => {
      const result = await db.run(
        `INSERT INTO prompt_battle_history (
          room_code, player1_id, player1_username, player1_is_guest,
          player2_id, player2_username, player2_is_guest,
          problem_id, problem_title, difficulty, duration_sec,
          player1_prompt, player2_prompt,
          player1_score, player2_score,
          player1_adjusted_score, player2_adjusted_score,
          player1_submit_count, player2_submit_count,
          winner_id, is_tie, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          'TEST123', 'user_1', 'TestUser1', 0,
          'user_2', 'TestUser2', 0,
          'test_problem', 'Test Problem', 'medium', 300,
          'Test prompt 1', 'Test prompt 2',
          80, 60,
          78, 58,
          2, 1,
          'user_1', 0
        ]
      );

      expect(result.lastID).toBeTruthy();
      testBattleId = result.lastID;
    });

    it('should be able to retrieve battle by id', async () => {
      const battle = await db.get(
        'SELECT * FROM prompt_battle_history WHERE id = ?',
        [testBattleId]
      );

      expect(battle).toBeTruthy();
      expect(battle.room_code).toBe('TEST123');
      expect(battle.player1_id).toBe('user_1');
      expect(battle.winner_id).toBe('user_1');
      expect(battle.player1_adjusted_score).toBe(78);
    });

    it('should be able to query battles by player id', async () => {
      const battles = await db.all(
        'SELECT * FROM prompt_battle_history WHERE player1_id = ? OR player2_id = ?',
        ['user_1', 'user_1']
      );

      expect(battles.length).toBeGreaterThanOrEqual(1);
      const testBattle = battles.find(b => b.id === testBattleId);
      expect(testBattle).toBeTruthy();
    });

    it('should support tie outcomes', async () => {
      const result = await db.run(
        `INSERT INTO prompt_battle_history (
          room_code, player1_id, player2_id,
          player1_score, player2_score,
          winner_id, is_tie, finished_at
        ) VALUES (?, ?, ?, ?, ?, NULL, 1, datetime('now'))`,
        ['TIE123', 'user_1', 'user_2', 70, 70]
      );

      const battle = await db.get(
        'SELECT * FROM prompt_battle_history WHERE id = ?',
        [result.lastID]
      );

      expect(battle.is_tie).toBe(1);
      expect(battle.winner_id).toBeNull();

      // Cleanup
      await db.run('DELETE FROM prompt_battle_history WHERE id = ?', [result.lastID]);
    });

    it('should support guest players', async () => {
      const result = await db.run(
        `INSERT INTO prompt_battle_history (
          room_code, player1_id, player1_username, player1_is_guest,
          player2_id, player2_username, player2_is_guest,
          winner_id, is_tie, finished_at
        ) VALUES (?, ?, ?, 0, ?, ?, 1, ?, 0, datetime('now'))`,
        ['GUEST123', 'user_1', 'RealUser', 'guest_xyz', 'Guest Player', 'user_1']
      );

      const battle = await db.get(
        'SELECT * FROM prompt_battle_history WHERE id = ?',
        [result.lastID]
      );

      expect(battle.player2_is_guest).toBe(1);
      expect(battle.player1_is_guest).toBe(0);

      // Cleanup
      await db.run('DELETE FROM prompt_battle_history WHERE id = ?', [result.lastID]);
    });

    // Cleanup test data
    afterAll(async () => {
      if (testBattleId) {
        await db.run('DELETE FROM prompt_battle_history WHERE id = ?', [testBattleId]);
      }
    });
  });

  describe('Token Usage JSON Storage', () => {
    it('should store and retrieve token usage as JSON', async () => {
      const tokenUsage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };

      const result = await db.run(
        `INSERT INTO prompt_battle_history (
          room_code, player1_id, player2_id,
          player1_token_usage,
          winner_id, is_tie, finished_at
        ) VALUES (?, ?, ?, ?, ?, 0, datetime('now'))`,
        ['TOKEN123', 'user_1', 'user_2', JSON.stringify(tokenUsage), 'user_1']
      );

      const battle = await db.get(
        'SELECT player1_token_usage FROM prompt_battle_history WHERE id = ?',
        [result.lastID]
      );

      const parsed = JSON.parse(battle.player1_token_usage);
      expect(parsed.inputTokens).toBe(100);
      expect(parsed.outputTokens).toBe(50);
      expect(parsed.totalTokens).toBe(150);

      // Cleanup
      await db.run('DELETE FROM prompt_battle_history WHERE id = ?', [result.lastID]);
    });
  });
});
