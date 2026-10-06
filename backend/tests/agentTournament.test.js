const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../config/jwt');

// Mock rate limiter to always pass through
jest.mock('express-rate-limit', () => {
  return () => (req, res, next) => next();
});

const agentTournamentRouter = require('../routes/agentTournament');

// Mock database module
jest.mock('../db', () => ({
  getAgentTournaments: jest.fn(),
  getAgentTournamentById: jest.fn(),
  createAgentTournament: jest.fn(),
  registerForAgentTournament: jest.fn(),
  unregisterFromAgentTournament: jest.fn(),
  checkInForAgentTournament: jest.fn(),
  getAgentTournamentCheckInStatus: jest.fn(),
  getAgentTournamentParticipants: jest.fn(),
  getAgentTournamentMatches: jest.fn(),
  generateAgentTournamentBracket: jest.fn(),
  updateAgentTournamentStatus: jest.fn(),
  isUserRegisteredForAgentTournament: jest.fn(),
  getUpcomingAgentTournaments: jest.fn(),
  getUserPendingAgentTournamentMatches: jest.fn()
}));

// Mock logger
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

// Mock authentication middleware
jest.mock('../routes/auth', () => ({
  authMiddleware: (req, res, next) => {
    // Only allow if user was set by the token middleware
    if (!req.testUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = { sub: req.testUserId, username: req.testUsername || 'testuser' };
    next();
  }
}));

const db = require('../db');

// Helper to create auth token
const createToken = (userId, username = 'testuser') => {
  return jwt.sign({ sub: userId, username }, SECRET, { expiresIn: '7d' });
};

// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    // Extract user ID from token if present
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      try {
        const decoded = jwt.verify(token, SECRET);
        req.testUserId = decoded.sub;
        req.testUsername = decoded.username;
      } catch (err) {
        // Invalid token
      }
    }
    next();
  });
  app.use('/api/agent/tournaments', agentTournamentRouter);
  return app;
}

describe('Agent Tournament API', () => {
  let app;
  let testUserId = 1;
  let testToken;
  let testTournamentId = 1;
  let testLoadoutId = 'loadout-123';

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
    testToken = createToken(testUserId, 'testuser');
  });

  describe('GET /api/agent/tournaments', () => {
    it('should return list of tournaments', async () => {
      const mockTournaments = [
        {
          id: 1,
          name: 'Test Tournament',
          description: 'A test tournament',
          status: 'upcoming',
          format: 'single_elimination',
          max_participants: 16,
          participant_count: 5,
          start_time: new Date().toISOString(),
          creator_username: 'admin'
        }
      ];

      db.getAgentTournaments.mockResolvedValue(mockTournaments);

      const response = await request(app)
        .get('/api/agent/tournaments')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.tournaments).toHaveLength(1);
      expect(response.body.tournaments[0].name).toBe('Test Tournament');
    });

    it('should filter tournaments by status', async () => {
      db.getAgentTournaments.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/agent/tournaments?status=upcoming')
        .expect(200);

      expect(db.getAgentTournaments).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'upcoming'
        })
      );
    });

    it('should support pagination', async () => {
      db.getAgentTournaments.mockResolvedValue([]);

      await request(app)
        .get('/api/agent/tournaments?limit=10&offset=20')
        .expect(200);

      expect(db.getAgentTournaments).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
          offset: 20
        })
      );
    });
  });

  describe('GET /api/agent/tournaments/:id', () => {
    it('should return tournament details', async () => {
      const mockTournament = {
        id: testTournamentId,
        name: 'Test Tournament',
        status: 'upcoming',
        participant_count: 5,
        max_participants: 16
      };

      db.getAgentTournamentById.mockResolvedValue(mockTournament);
      db.isUserRegisteredForAgentTournament.mockResolvedValue(false);

      const response = await request(app)
        .get(`/api/agent/tournaments/${testTournamentId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.tournament.id).toBe(testTournamentId);
      expect(response.body.isRegistered).toBe(false);
    });

    it('should return 404 for non-existent tournament', async () => {
      db.getAgentTournamentById.mockResolvedValue(null);

      await request(app)
        .get('/api/agent/tournaments/9999')
        .expect(404);
    });

    it('should return 400 for invalid tournament ID', async () => {
      await request(app)
        .get('/api/agent/tournaments/invalid')
        .expect(400);
    });
  });

  describe('POST /api/agent/tournaments', () => {
    it('should create a new tournament', async () => {
      db.createAgentTournament.mockResolvedValue({ id: testTournamentId });

      const tournamentData = {
        name: 'New Tournament',
        description: 'Test description',
        startTime: new Date(Date.now() + 86400000).toISOString(),
        format: 'single_elimination',
        maxParticipants: 16
      };

      const response = await request(app)
        .post('/api/agent/tournaments')
        .set('Authorization', `Bearer ${testToken}`)
        .send(tournamentData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.tournamentId).toBe(testTournamentId);
      expect(db.createAgentTournament).toHaveBeenCalledWith(
        expect.objectContaining({
          name: tournamentData.name,
          format: tournamentData.format
        })
      );
    });

    it('should require authentication', async () => {
      await request(app)
        .post('/api/agent/tournaments')
        .send({ name: 'Test', startTime: new Date().toISOString() })
        .expect(401);
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/agent/tournaments')
        .set('Authorization', `Bearer ${testToken}`)
        .send({})
        .expect(400);

      expect(response.body.error).toContain('required');
    });

    it('should validate tournament format', async () => {
      const response = await request(app)
        .post('/api/agent/tournaments')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          name: 'Test',
          startTime: new Date().toISOString(),
          format: 'invalid_format'
        })
        .expect(400);

      expect(response.body.error).toContain('Invalid format');
    });

    it('should validate max participants for single elimination', async () => {
      const response = await request(app)
        .post('/api/agent/tournaments')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          name: 'Test',
          startTime: new Date().toISOString(),
          format: 'single_elimination',
          maxParticipants: 15 // Not a power of 2
        })
        .expect(400);

      expect(response.body.error).toContain('power of 2');
    });
  });

  describe('POST /api/agent/tournaments/:id/join', () => {
    beforeEach(() => {
      db.getAgentTournamentById.mockResolvedValue({
        id: testTournamentId,
        name: 'Test Tournament',
        status: 'registration_open',
        registration_deadline: new Date(Date.now() + 86400000).toISOString(),
        participant_count: 5,
        max_participants: 16
      });
    });

    it('should allow user to join tournament', async () => {
      db.registerForAgentTournament.mockResolvedValue({ success: true });

      const response = await request(app)
        .post(`/api/agent/tournaments/${testTournamentId}/join`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({ loadoutId: testLoadoutId })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(db.registerForAgentTournament).toHaveBeenCalledWith(
        testTournamentId,
        testUserId,
        testLoadoutId
      );
    });

    it('should require authentication', async () => {
      await request(app)
        .post(`/api/agent/tournaments/${testTournamentId}/join`)
        .send({ loadoutId: testLoadoutId })
        .expect(401);
    });

    it('should require loadout ID', async () => {
      await request(app)
        .post(`/api/agent/tournaments/${testTournamentId}/join`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({})
        .expect(400);
    });

    it('should reject if registration is closed', async () => {
      db.getAgentTournamentById.mockResolvedValue({
        id: testTournamentId,
        status: 'in_progress'
      });

      const response = await request(app)
        .post(`/api/agent/tournaments/${testTournamentId}/join`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({ loadoutId: testLoadoutId })
        .expect(400);

      expect(response.body.error).toContain('not open');
    });

    it('should reject if registration deadline passed', async () => {
      db.getAgentTournamentById.mockResolvedValue({
        id: testTournamentId,
        status: 'registration_open',
        registration_deadline: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
      });

      const response = await request(app)
        .post(`/api/agent/tournaments/${testTournamentId}/join`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({ loadoutId: testLoadoutId })
        .expect(400);

      expect(response.body.error).toContain('deadline');
    });

    it('should handle database errors gracefully', async () => {
      db.registerForAgentTournament.mockResolvedValue({
        success: false,
        error: 'Already registered'
      });

      const response = await request(app)
        .post(`/api/agent/tournaments/${testTournamentId}/join`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({ loadoutId: testLoadoutId })
        .expect(400);

      expect(response.body.error).toBe('Already registered');
    });
  });

  describe('DELETE /api/agent/tournaments/:id/join', () => {
    beforeEach(() => {
      db.getAgentTournamentById.mockResolvedValue({
        id: testTournamentId,
        status: 'registration_open'
      });
    });

    it('should allow user to leave tournament', async () => {
      db.unregisterFromAgentTournament.mockResolvedValue({ success: true });

      const response = await request(app)
        .delete(`/api/agent/tournaments/${testTournamentId}/join`)
        .set('Authorization', `Bearer ${testToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(db.unregisterFromAgentTournament).toHaveBeenCalledWith(
        testTournamentId,
        testUserId
      );
    });

    it('should not allow leaving active tournament', async () => {
      db.getAgentTournamentById.mockResolvedValue({
        id: testTournamentId,
        status: 'in_progress'
      });

      const response = await request(app)
        .delete(`/api/agent/tournaments/${testTournamentId}/join`)
        .set('Authorization', `Bearer ${testToken}`)
        .expect(400);

      expect(response.body.error).toContain('active');
    });
  });

  describe('POST /api/agent/tournaments/:id/check-in', () => {
    beforeEach(() => {
      db.getAgentTournamentById.mockResolvedValue({
        id: testTournamentId,
        status: 'check_in_open'
      });
    });

    it('should allow user to check in', async () => {
      db.checkInForAgentTournament.mockResolvedValue({ success: true });
      db.getAgentTournamentCheckInStatus.mockResolvedValue({
        totalRegistered: 10,
        checkedInCount: 8
      });

      const response = await request(app)
        .post(`/api/agent/tournaments/${testTournamentId}/check-in`)
        .set('Authorization', `Bearer ${testToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.checkIn).toBeDefined();
      expect(db.checkInForAgentTournament).toHaveBeenCalledWith(
        testTournamentId,
        testUserId
      );
    });

    it('should reject check-in when not available', async () => {
      db.getAgentTournamentById.mockResolvedValue({
        id: testTournamentId,
        status: 'upcoming'
      });

      const response = await request(app)
        .post(`/api/agent/tournaments/${testTournamentId}/check-in`)
        .set('Authorization', `Bearer ${testToken}`)
        .expect(400);

      expect(response.body.error).toContain('not available');
    });

    it('should handle already checked in', async () => {
      db.checkInForAgentTournament.mockResolvedValue({
        success: false,
        error: 'Already checked in'
      });

      const response = await request(app)
        .post(`/api/agent/tournaments/${testTournamentId}/check-in`)
        .set('Authorization', `Bearer ${testToken}`)
        .expect(400);

      expect(response.body.error).toBe('Already checked in');
    });
  });

  describe('GET /api/agent/tournaments/:id/participants', () => {
    it('should return tournament participants', async () => {
      const mockParticipants = [
        {
          id: 1,
          user_id: 1,
          username: 'user1',
          loadout_id: 'loadout-1',
          loadout_name: 'My Agent',
          loadout_elo: 1200,
          status: 'registered'
        },
        {
          id: 2,
          user_id: 2,
          username: 'user2',
          loadout_id: 'loadout-2',
          loadout_name: 'Pro Agent',
          loadout_elo: 1500,
          status: 'checked_in'
        }
      ];

      db.getAgentTournamentParticipants.mockResolvedValue(mockParticipants);

      const response = await request(app)
        .get(`/api/agent/tournaments/${testTournamentId}/participants`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.participants).toHaveLength(2);
      expect(response.body.participants[0].username).toBe('user1');
    });
  });

  describe('GET /api/agent/tournaments/:id/bracket', () => {
    it('should return tournament bracket', async () => {
      const mockTournament = {
        id: testTournamentId,
        total_rounds: 3,
        current_round: 1
      };

      const mockMatches = [
        {
          id: 1,
          tournament_id: testTournamentId,
          round: 1,
          match_number: 1,
          player1_id: 1,
          player2_id: 2,
          winner_id: null
        },
        {
          id: 2,
          tournament_id: testTournamentId,
          round: 1,
          match_number: 2,
          player1_id: 3,
          player2_id: 4,
          winner_id: 3
        }
      ];

      db.getAgentTournamentById.mockResolvedValue(mockTournament);
      db.getAgentTournamentMatches.mockResolvedValue(mockMatches);

      const response = await request(app)
        .get(`/api/agent/tournaments/${testTournamentId}/bracket`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.bracket).toBeDefined();
      expect(response.body.bracket[1]).toHaveLength(2); // 2 matches in round 1
      expect(response.body.totalRounds).toBe(3);
      expect(response.body.currentRound).toBe(1);
    });
  });

  describe('POST /api/agent/tournaments/:id/start', () => {
    beforeEach(() => {
      db.getAgentTournamentById.mockResolvedValue({
        id: testTournamentId,
        created_by: testUserId,
        status: 'registration_open'
      });

      db.getAgentTournamentCheckInStatus.mockResolvedValue({
        checkedInCount: 8
      });

      db.generateAgentTournamentBracket.mockResolvedValue({
        success: true,
        totalRounds: 3,
        participantCount: 8
      });
    });

    it('should start tournament and generate bracket', async () => {
      const response = await request(app)
        .post(`/api/agent/tournaments/${testTournamentId}/start`)
        .set('Authorization', `Bearer ${testToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.bracket).toBeDefined();
      expect(db.generateAgentTournamentBracket).toHaveBeenCalledWith(testTournamentId);
      expect(db.updateAgentTournamentStatus).toHaveBeenCalledWith(testTournamentId, 'in_progress');
    });

    it('should only allow creator to start tournament', async () => {
      db.getAgentTournamentById.mockResolvedValue({
        id: testTournamentId,
        created_by: 999, // Different user
        status: 'registration_open'
      });

      const response = await request(app)
        .post(`/api/agent/tournaments/${testTournamentId}/start`)
        .set('Authorization', `Bearer ${testToken}`)
        .expect(403);

      expect(response.body.error).toContain('creator');
    });

    it('should require minimum participants', async () => {
      db.getAgentTournamentCheckInStatus.mockResolvedValue({
        checkedInCount: 1 // Only 1 participant
      });

      const response = await request(app)
        .post(`/api/agent/tournaments/${testTournamentId}/start`)
        .set('Authorization', `Bearer ${testToken}`)
        .expect(400);

      expect(response.body.error).toContain('at least 2');
    });
  });

  describe('PUT /api/agent/tournaments/:id/status', () => {
    beforeEach(() => {
      db.getAgentTournamentById.mockResolvedValue({
        id: testTournamentId,
        created_by: testUserId
      });
    });

    it('should update tournament status', async () => {
      const response = await request(app)
        .put(`/api/agent/tournaments/${testTournamentId}/status`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({ status: 'check_in_open' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(db.updateAgentTournamentStatus).toHaveBeenCalledWith(
        testTournamentId,
        'check_in_open'
      );
    });

    it('should only allow creator to update status', async () => {
      db.getAgentTournamentById.mockResolvedValue({
        id: testTournamentId,
        created_by: 999
      });

      await request(app)
        .put(`/api/agent/tournaments/${testTournamentId}/status`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({ status: 'check_in_open' })
        .expect(403);
    });

    it('should validate status value', async () => {
      const response = await request(app)
        .put(`/api/agent/tournaments/${testTournamentId}/status`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({ status: 'invalid_status' })
        .expect(400);

      expect(response.body.error).toContain('Invalid status');
    });
  });
});
