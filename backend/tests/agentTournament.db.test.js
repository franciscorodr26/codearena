const db = require('../db');
const path = require('path');
const fs = require('fs');

// Use in-memory database for testing
const TEST_DB_PATH = ':memory:';

describe('Agent Tournament Database Functions', () => {
  let testUserId1, testUserId2, testUserId3, testUserId4;
  let testLoadoutId1, testLoadoutId2, testLoadoutId3, testLoadoutId4;
  let testTournamentId;

  beforeAll(async () => {
    // Initialize database
    await db.init();

    // Clean up any existing test data
    await db.run('DELETE FROM agent_tournament_participants WHERE user_id IN (SELECT id FROM users WHERE email LIKE "tournament%@test.com")');
    await db.run('DELETE FROM agent_tournaments WHERE name LIKE "Test Tournament%"');
    await db.run('DELETE FROM agent_loadouts WHERE user_id IN (SELECT id FROM users WHERE email LIKE "tournament%@test.com")');
    await db.run('DELETE FROM users WHERE email LIKE "tournament%@test.com"');

    // Create test users - createUser signature is (email, passwordHash, username, avatar)
    const user1 = await db.createUser(
      'tournament1@test.com',
      'password123',
      'tournament_user1'
    );
    testUserId1 = user1.id;

    const user2 = await db.createUser(
      'tournament2@test.com',
      'password123',
      'tournament_user2'
    );
    testUserId2 = user2.id;

    const user3 = await db.createUser(
      'tournament3@test.com',
      'password123',
      'tournament_user3'
    );
    testUserId3 = user3.id;

    const user4 = await db.createUser(
      'tournament4@test.com',
      'password123',
      'tournament_user4'
    );
    testUserId4 = user4.id;

    // Create test loadouts
    const loadout1 = await db.createAgentLoadout({
      userId: testUserId1,
      name: 'Test Loadout 1',
      model: 'haiku',
      language: 'python',
      systemPrompt: 'Test prompt',
      tools: '[]'
    });
    testLoadoutId1 = loadout1.id;

    const loadout2 = await db.createAgentLoadout({
      userId: testUserId2,
      name: 'Test Loadout 2',
      model: 'sonnet',
      language: 'python',
      systemPrompt: 'Test prompt',
      tools: '[]'
    });
    testLoadoutId2 = loadout2.id;

    const loadout3 = await db.createAgentLoadout({
      userId: testUserId3,
      name: 'Test Loadout 3',
      model: 'haiku',
      language: 'javascript',
      systemPrompt: 'Test prompt',
      tools: '[]'
    });
    testLoadoutId3 = loadout3.id;

    const loadout4 = await db.createAgentLoadout({
      userId: testUserId4,
      name: 'Test Loadout 4',
      model: 'sonnet',
      language: 'python',
      systemPrompt: 'Test prompt',
      tools: '[]'
    });
    testLoadoutId4 = loadout4.id;

    // Set different ELOs for seeding test
    await db.run('UPDATE agent_loadouts SET elo = 1500 WHERE id = ?', [testLoadoutId1]);
    await db.run('UPDATE agent_loadouts SET elo = 1200 WHERE id = ?', [testLoadoutId2]);
    await db.run('UPDATE agent_loadouts SET elo = 1400 WHERE id = ?', [testLoadoutId3]);
    await db.run('UPDATE agent_loadouts SET elo = 1100 WHERE id = ?', [testLoadoutId4]);
  });

  describe('createAgentTournament', () => {
    it('should create a new tournament', async () => {
      const result = await db.createAgentTournament({
        name: 'Test Tournament',
        description: 'A test tournament',
        format: 'single_elimination',
        maxParticipants: 16,
        entryFee: 0,
        prizePool: 100,
        startTime: new Date(Date.now() + 86400000).toISOString(),
        registrationDeadline: new Date(Date.now() + 43200000).toISOString(),
        createdBy: testUserId1
      });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      testTournamentId = result.id;
    });

    it('should create tournament with default values', async () => {
      const result = await db.createAgentTournament({
        name: 'Minimal Tournament',
        startTime: new Date().toISOString(),
        createdBy: testUserId1
      });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();

      const tournament = await db.getAgentTournamentById(result.id);
      expect(tournament.format).toBe('single_elimination');
      expect(tournament.max_participants).toBe(32);
      expect(tournament.entry_fee).toBe(0);
    });
  });

  describe('getAgentTournamentById', () => {
    it('should retrieve tournament by ID', async () => {
      const tournament = await db.getAgentTournamentById(testTournamentId);

      expect(tournament).toBeDefined();
      expect(tournament.id).toBe(testTournamentId);
      expect(tournament.name).toBe('Test Tournament');
      expect(tournament.participant_count).toBe(0);
      expect(tournament.creator_username).toBe('tournament_user1');
    });

    it('should return null for non-existent tournament', async () => {
      const tournament = await db.getAgentTournamentById(99999);
      expect(tournament).toBeNull();
    });
  });

  describe('getAgentTournaments', () => {
    it('should return all tournaments', async () => {
      const tournaments = await db.getAgentTournaments({});

      expect(Array.isArray(tournaments)).toBe(true);
      expect(tournaments.length).toBeGreaterThan(0);
    });

    it('should filter by status', async () => {
      const tournaments = await db.getAgentTournaments({
        status: 'upcoming'
      });

      expect(Array.isArray(tournaments)).toBe(true);
      tournaments.forEach(t => {
        expect(t.status).toBe('upcoming');
      });
    });

    it('should support pagination', async () => {
      const page1 = await db.getAgentTournaments({ limit: 1, offset: 0 });
      const page2 = await db.getAgentTournaments({ limit: 1, offset: 1 });

      expect(page1.length).toBeLessThanOrEqual(1);
      expect(page2.length).toBeLessThanOrEqual(1);

      if (page1.length > 0 && page2.length > 0) {
        expect(page1[0].id).not.toBe(page2[0].id);
      }
    });
  });

  describe('registerForAgentTournament', () => {
    it('should register user for tournament', async () => {
      const result = await db.registerForAgentTournament(
        testTournamentId,
        testUserId1,
        testLoadoutId1
      );

      expect(result.success).toBe(true);

      // Verify registration
      const isRegistered = await db.isUserRegisteredForAgentTournament(
        testTournamentId,
        testUserId1
      );
      expect(isRegistered).toBe(true);
    });

    it('should prevent duplicate registration', async () => {
      const result = await db.registerForAgentTournament(
        testTournamentId,
        testUserId1,
        testLoadoutId1
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Already registered');
    });

    it('should prevent registration when tournament is full', async () => {
      // Create a small tournament
      const smallTournament = await db.createAgentTournament({
        name: 'Small Tournament',
        maxParticipants: 2,
        startTime: new Date().toISOString(),
        createdBy: testUserId1
      });

      // Fill it up
      await db.registerForAgentTournament(smallTournament.id, testUserId1, testLoadoutId1);
      await db.registerForAgentTournament(smallTournament.id, testUserId2, testLoadoutId2);

      // Try to register third user
      const result = await db.registerForAgentTournament(
        smallTournament.id,
        testUserId3,
        testLoadoutId3
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('full');
    });

    it('should validate loadout ownership', async () => {
      const result = await db.registerForAgentTournament(
        testTournamentId,
        testUserId2,
        testLoadoutId1 // User 2 trying to use User 1's loadout
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not belong');
    });
  });

  describe('unregisterFromAgentTournament', () => {
    it('should allow user to unregister', async () => {
      // First register
      await db.registerForAgentTournament(testTournamentId, testUserId2, testLoadoutId2);

      // Then unregister
      const result = await db.unregisterFromAgentTournament(testTournamentId, testUserId2);

      expect(result.success).toBe(true);

      // Verify unregistration
      const isRegistered = await db.isUserRegisteredForAgentTournament(
        testTournamentId,
        testUserId2
      );
      expect(isRegistered).toBe(false);
    });
  });

  describe('checkInForAgentTournament', () => {
    beforeEach(async () => {
      // Ensure user2 is registered
      await db.registerForAgentTournament(testTournamentId, testUserId2, testLoadoutId2);
    });

    it('should allow registered user to check in', async () => {
      const result = await db.checkInForAgentTournament(testTournamentId, testUserId2);

      expect(result.success).toBe(true);

      // Verify check-in status
      const participants = await db.getAgentTournamentParticipants(testTournamentId);
      const user2Participant = participants.find(p => p.user_id === testUserId2);
      expect(user2Participant.status).toBe('checked_in');
      expect(user2Participant.checked_in_at).toBeDefined();
    });

    it('should prevent duplicate check-in', async () => {
      await db.checkInForAgentTournament(testTournamentId, testUserId2);

      const result = await db.checkInForAgentTournament(testTournamentId, testUserId2);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Already checked in');
    });

    it('should prevent check-in if not registered', async () => {
      const result = await db.checkInForAgentTournament(testTournamentId, testUserId3);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Not registered');
    });
  });

  describe('getAgentTournamentParticipants', () => {
    it('should return all participants', async () => {
      const participants = await db.getAgentTournamentParticipants(testTournamentId);

      expect(Array.isArray(participants)).toBe(true);
      expect(participants.length).toBeGreaterThan(0);

      const participant = participants[0];
      expect(participant).toHaveProperty('user_id');
      expect(participant).toHaveProperty('username');
      expect(participant).toHaveProperty('loadout_id');
      expect(participant).toHaveProperty('loadout_name');
      expect(participant).toHaveProperty('loadout_elo');
      expect(participant).toHaveProperty('status');
    });
  });

  describe('generateAgentTournamentBracket', () => {
    let bracketTournamentId;

    beforeEach(async () => {
      // Create a new tournament for bracket generation
      const tournament = await db.createAgentTournament({
        name: 'Bracket Test Tournament',
        maxParticipants: 4,
        startTime: new Date().toISOString(),
        createdBy: testUserId1
      });
      bracketTournamentId = tournament.id;

      // Register and check in 4 users
      await db.registerForAgentTournament(bracketTournamentId, testUserId1, testLoadoutId1);
      await db.registerForAgentTournament(bracketTournamentId, testUserId2, testLoadoutId2);
      await db.registerForAgentTournament(bracketTournamentId, testUserId3, testLoadoutId3);
      await db.registerForAgentTournament(bracketTournamentId, testUserId4, testLoadoutId4);

      await db.checkInForAgentTournament(bracketTournamentId, testUserId1);
      await db.checkInForAgentTournament(bracketTournamentId, testUserId2);
      await db.checkInForAgentTournament(bracketTournamentId, testUserId3);
      await db.checkInForAgentTournament(bracketTournamentId, testUserId4);
    });

    it('should generate bracket with correct seeding', async () => {
      const result = await db.generateAgentTournamentBracket(bracketTournamentId);

      expect(result.success).toBe(true);
      expect(result.totalRounds).toBe(2); // 4 participants = 2 rounds
      expect(result.participantCount).toBe(4);

      // Verify seeds were assigned
      const participants = await db.getAgentTournamentParticipants(bracketTournamentId);
      participants.forEach(p => {
        expect(p.seed).toBeDefined();
        expect(p.seed).toBeGreaterThan(0);
      });

      // Verify seeding by ELO (highest ELO gets seed 1)
      const sortedByElo = [...participants].sort((a, b) => b.loadout_elo - a.loadout_elo);
      expect(sortedByElo[0].seed).toBe(1); // Highest ELO should be seed 1
    });

    it('should create first round matches', async () => {
      await db.generateAgentTournamentBracket(bracketTournamentId);

      const matches = await db.getAgentTournamentMatches(bracketTournamentId);

      expect(matches.length).toBe(2); // 4 participants = 2 first round matches
      expect(matches.every(m => m.round === 1)).toBe(true);
      expect(matches.every(m => m.player1_id !== null)).toBe(true);
      expect(matches.every(m => m.player2_id !== null)).toBe(true);
    });

    it('should handle byes correctly', async () => {
      // Create tournament with 3 participants (odd number)
      const oddTournament = await db.createAgentTournament({
        name: 'Odd Participants Tournament',
        maxParticipants: 4,
        startTime: new Date().toISOString(),
        createdBy: testUserId1
      });

      // Register only 3 users
      await db.registerForAgentTournament(oddTournament.id, testUserId1, testLoadoutId1);
      await db.registerForAgentTournament(oddTournament.id, testUserId2, testLoadoutId2);
      await db.registerForAgentTournament(oddTournament.id, testUserId3, testLoadoutId3);

      await db.checkInForAgentTournament(oddTournament.id, testUserId1);
      await db.checkInForAgentTournament(oddTournament.id, testUserId2);
      await db.checkInForAgentTournament(oddTournament.id, testUserId3);

      await db.generateAgentTournamentBracket(oddTournament.id);

      const matches = await db.getAgentTournamentMatches(oddTournament.id);

      // Should have matches with some having null player2 (byes)
      const byeMatches = matches.filter(m => m.player2_id === null);
      expect(byeMatches.length).toBeGreaterThan(0);

      // Bye matches should be auto-completed
      byeMatches.forEach(match => {
        expect(match.winner_id).toBe(match.player1_id);
        expect(match.completed_at).toBeDefined();
      });
    });

    it('should update tournament total_rounds and current_round', async () => {
      await db.generateAgentTournamentBracket(bracketTournamentId);

      const tournament = await db.getAgentTournamentById(bracketTournamentId);

      expect(tournament.total_rounds).toBe(2);
      expect(tournament.current_round).toBe(1);
    });
  });

  describe('updateAgentTournamentMatchResult', () => {
    let matchTournamentId, matchId;

    beforeEach(async () => {
      // Create and set up tournament
      const tournament = await db.createAgentTournament({
        name: 'Match Result Test Tournament',
        maxParticipants: 4,
        startTime: new Date().toISOString(),
        createdBy: testUserId1
      });
      matchTournamentId = tournament.id;

      // Register and check in users
      await db.registerForAgentTournament(matchTournamentId, testUserId1, testLoadoutId1);
      await db.registerForAgentTournament(matchTournamentId, testUserId2, testLoadoutId2);
      await db.registerForAgentTournament(matchTournamentId, testUserId3, testLoadoutId3);
      await db.registerForAgentTournament(matchTournamentId, testUserId4, testLoadoutId4);

      await db.checkInForAgentTournament(matchTournamentId, testUserId1);
      await db.checkInForAgentTournament(matchTournamentId, testUserId2);
      await db.checkInForAgentTournament(matchTournamentId, testUserId3);
      await db.checkInForAgentTournament(matchTournamentId, testUserId4);

      // Generate bracket
      await db.generateAgentTournamentBracket(matchTournamentId);

      // Get first match
      const matches = await db.getAgentTournamentMatches(matchTournamentId);
      matchId = matches[0].id;
    });

    it('should update match with winner', async () => {
      const matches = await db.getAgentTournamentMatches(matchTournamentId);
      const match = matches.find(m => m.id === matchId);
      const winnerId = match.player1_id;
      const battleId = 'test-battle-123';

      const result = await db.updateAgentTournamentMatchResult(matchId, winnerId, battleId);

      expect(result.success).toBe(true);

      // Verify match was updated
      const updatedMatches = await db.getAgentTournamentMatches(matchTournamentId);
      const updatedMatch = updatedMatches.find(m => m.id === matchId);

      expect(updatedMatch.winner_id).toBe(winnerId);
      expect(updatedMatch.battle_id).toBe(battleId);
      expect(updatedMatch.completed_at).toBeDefined();
    });

    it('should mark loser as eliminated', async () => {
      const matches = await db.getAgentTournamentMatches(matchTournamentId);
      const match = matches.find(m => m.id === matchId);
      const winnerId = match.player1_id;
      const loserId = match.player2_id;

      await db.updateAgentTournamentMatchResult(matchId, winnerId, 'battle-123');

      // Check participant status
      const participants = await db.getAgentTournamentParticipants(matchTournamentId);
      const loserParticipant = participants.find(p => p.user_id === loserId);

      expect(loserParticipant.status).toBe('eliminated');
      expect(loserParticipant.eliminated_at).toBeDefined();
    });

    it('should create next round matches when round completes', async () => {
      const matches = await db.getAgentTournamentMatches(matchTournamentId);

      // Complete both round 1 matches
      await db.updateAgentTournamentMatchResult(
        matches[0].id,
        matches[0].player1_id,
        'battle-1'
      );
      await db.updateAgentTournamentMatchResult(
        matches[1].id,
        matches[1].player1_id,
        'battle-2'
      );

      // Check that round 2 match was created
      const allMatches = await db.getAgentTournamentMatches(matchTournamentId);
      const round2Matches = allMatches.filter(m => m.round === 2);

      expect(round2Matches.length).toBe(1);
      expect(round2Matches[0].player1_id).toBe(matches[0].player1_id);
      expect(round2Matches[0].player2_id).toBe(matches[1].player1_id);
    });

    it('should complete tournament when final match is won', async () => {
      const matches = await db.getAgentTournamentMatches(matchTournamentId);

      // Complete round 1
      await db.updateAgentTournamentMatchResult(
        matches[0].id,
        matches[0].player1_id,
        'battle-1'
      );
      await db.updateAgentTournamentMatchResult(
        matches[1].id,
        matches[1].player1_id,
        'battle-2'
      );

      // Get and complete finals
      const allMatches = await db.getAgentTournamentMatches(matchTournamentId);
      const finalMatch = allMatches.find(m => m.round === 2);

      await db.updateAgentTournamentMatchResult(
        finalMatch.id,
        finalMatch.player1_id,
        'final-battle'
      );

      // Check tournament is completed
      const tournament = await db.getAgentTournamentById(matchTournamentId);

      expect(tournament.status).toBe('completed');
      expect(tournament.winner_id).toBe(finalMatch.player1_id);
      expect(tournament.completed_at).toBeDefined();

      // Check winner participant status
      const participants = await db.getAgentTournamentParticipants(matchTournamentId);
      const winner = participants.find(p => p.user_id === finalMatch.player1_id);

      expect(winner.status).toBe('winner');
    });
  });

  describe('getAgentTournamentCheckInStatus', () => {
    it('should return check-in statistics', async () => {
      const status = await db.getAgentTournamentCheckInStatus(testTournamentId);

      expect(status).toHaveProperty('totalRegistered');
      expect(status).toHaveProperty('checkedInCount');
      expect(typeof status.totalRegistered).toBe('number');
      expect(typeof status.checkedInCount).toBe('number');
      expect(status.checkedInCount).toBeLessThanOrEqual(status.totalRegistered);
    });
  });

  describe('updateAgentTournamentStatus', () => {
    it('should update tournament status', async () => {
      await db.updateAgentTournamentStatus(testTournamentId, 'check_in_open');

      const tournament = await db.getAgentTournamentById(testTournamentId);

      expect(tournament.status).toBe('check_in_open');
      expect(tournament.updated_at).toBeDefined();
    });
  });
});
