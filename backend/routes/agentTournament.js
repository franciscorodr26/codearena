const express = require('express');
const { authMiddleware } = require('./auth');
const db = require('../db');
const logger = require('../utils/logger');

const router = express.Router();

// Helper function to safely parse integers with fallback
const safeParseInt = (value, defaultValue = 0) => {
  const parsed = parseInt(value);
  return isNaN(parsed) ? defaultValue : parsed;
};

/**
 * GET /api/agent/tournaments
 * List agent tournaments with optional filters
 */
router.get('/', async (req, res, next) => {
  try {
    const { status, limit = 20, offset = 0 } = req.query;

    // Parse status - can be comma-separated
    let statusFilter = status;
    if (status && status.includes(',')) {
      statusFilter = status.split(',');
    }

    const parsedLimit = Math.min(safeParseInt(limit, 20), 50);
    const parsedOffset = safeParseInt(offset, 0);

    const tournaments = await db.getAgentTournaments({
      status: statusFilter,
      limit: parsedLimit,
      offset: parsedOffset
    });

    res.json({
      success: true,
      tournaments,
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: tournaments.length === parsedLimit
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agent/tournaments/upcoming
 * Get upcoming agent tournaments for quick display
 */
router.get('/upcoming', async (req, res, next) => {
  try {
    const limit = Math.min(safeParseInt(req.query.limit, 5), 10);
    const tournaments = await db.getUpcomingAgentTournaments(limit);

    res.json({
      success: true,
      tournaments
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agent/tournaments/user/matches
 * Get user's pending agent tournament matches
 */
router.get('/user/matches', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const matches = await db.getUserPendingAgentTournamentMatches(userId);

    res.json({
      success: true,
      matches
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agent/tournaments/:id
 * Get agent tournament details
 */
router.get('/:id', async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }

    const tournament = await db.getAgentTournamentById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Check if user is registered (if authenticated)
    let isRegistered = false;
    let userParticipant = null;
    if (req.user) {
      const userId = req.user.sub;
      isRegistered = await db.isUserRegisteredForAgentTournament(tournamentId, userId);
      if (isRegistered) {
        const participants = await db.getAgentTournamentParticipants(tournamentId);
        userParticipant = participants.find(p => p.user_id === userId);
      }
    }

    res.json({
      success: true,
      tournament,
      isRegistered,
      userParticipant
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agent/tournaments/:id/participants
 * Get agent tournament participants
 */
router.get('/:id/participants', async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }

    const participants = await db.getAgentTournamentParticipants(tournamentId);

    res.json({
      success: true,
      participants
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agent/tournaments/:id/bracket
 * Get agent tournament bracket/matches
 */
router.get('/:id/bracket', async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }

    const tournament = await db.getAgentTournamentById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const matches = await db.getAgentTournamentMatches(tournamentId);

    // Organize matches by round for easier frontend rendering
    const bracket = {};
    for (const match of matches) {
      if (!bracket[match.round]) {
        bracket[match.round] = [];
      }
      bracket[match.round].push(match);
    }

    res.json({
      success: true,
      bracket,
      matches,
      totalRounds: tournament.total_rounds,
      currentRound: tournament.current_round
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agent/tournaments
 * Create a new agent tournament (admin only for now)
 */
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const {
      name,
      description,
      startTime,
      registrationDeadline,
      format = 'single_elimination',
      maxParticipants = 32,
      entryFee = 0,
      prizePool = 0
    } = req.body;

    // Validation
    if (!name || !startTime) {
      return res.status(400).json({
        error: 'Name and start time are required'
      });
    }

    // Validate format
    const validFormats = ['single_elimination', 'double_elimination', 'round_robin'];
    if (!validFormats.includes(format)) {
      return res.status(400).json({
        error: `Invalid format. Must be one of: ${validFormats.join(', ')}`
      });
    }

    // Validate max participants (must be power of 2 for single elimination)
    if (format === 'single_elimination' && !isPowerOfTwo(maxParticipants)) {
      return res.status(400).json({
        error: 'Max participants must be a power of 2 for single elimination (2, 4, 8, 16, 32, etc.)'
      });
    }

    const result = await db.createAgentTournament({
      name,
      description,
      startTime,
      registrationDeadline: registrationDeadline || startTime,
      format,
      maxParticipants,
      entryFee,
      prizePool,
      createdBy: userId
    });

    res.json({
      success: true,
      tournamentId: result.id,
      message: 'Agent tournament created successfully'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agent/tournaments/:id/join
 * Join an agent tournament with a loadout
 */
router.post('/:id/join', authMiddleware, async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }

    const userId = req.user.sub;
    const { loadoutId } = req.body;

    if (!loadoutId) {
      return res.status(400).json({ error: 'Loadout ID is required' });
    }

    // Get tournament details
    const tournament = await db.getAgentTournamentById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Check registration is open
    if (tournament.status !== 'upcoming' && tournament.status !== 'registration_open') {
      return res.status(400).json({ error: 'Registration is not open for this tournament' });
    }

    // Check if registration deadline has passed
    if (tournament.registration_deadline) {
      const deadline = new Date(tournament.registration_deadline);
      if (new Date() > deadline) {
        return res.status(400).json({ error: 'Registration deadline has passed' });
      }
    }

    const result = await db.registerForAgentTournament(tournamentId, userId, loadoutId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      message: 'Successfully registered for agent tournament'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/agent/tournaments/:id/join
 * Leave an agent tournament
 */
router.delete('/:id/join', authMiddleware, async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }

    const userId = req.user.sub;

    // Get tournament details
    const tournament = await db.getAgentTournamentById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Can only leave before tournament starts
    if (tournament.status === 'in_progress' || tournament.status === 'completed') {
      return res.status(400).json({ error: 'Cannot leave an active tournament' });
    }

    const result = await db.unregisterFromAgentTournament(tournamentId, userId);

    if (!result.success) {
      return res.status(400).json({ error: 'Not registered for this tournament' });
    }

    res.json({
      success: true,
      message: 'Successfully left the tournament'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agent/tournaments/:id/check-in
 * Check in for an agent tournament (player confirms attendance)
 */
router.post('/:id/check-in', authMiddleware, async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }

    const userId = req.user.sub;

    // Get tournament details
    const tournament = await db.getAgentTournamentById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Check-in is only available shortly before tournament starts
    // For now, allow check-in when status is 'registration_open' or 'check_in_open'
    if (tournament.status !== 'registration_open' && tournament.status !== 'check_in_open') {
      return res.status(400).json({ error: 'Check-in is not available yet' });
    }

    const result = await db.checkInForAgentTournament(tournamentId, userId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Get updated check-in status
    const checkInStatus = await db.getAgentTournamentCheckInStatus(tournamentId);

    res.json({
      success: true,
      message: 'Successfully checked in for tournament',
      checkIn: checkInStatus
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agent/tournaments/:id/check-in
 * Get check-in status for an agent tournament
 */
router.get('/:id/check-in', async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }

    const tournament = await db.getAgentTournamentById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const checkInStatus = await db.getAgentTournamentCheckInStatus(tournamentId);

    res.json({
      success: true,
      tournament: {
        id: tournament.id,
        name: tournament.name,
        status: tournament.status,
        start_time: tournament.start_time
      },
      checkIn: checkInStatus
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agent/tournaments/:id/start
 * Start an agent tournament (generates bracket, sets status to in_progress)
 * Admin/Creator only
 */
router.post('/:id/start', authMiddleware, async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }

    const userId = req.user.sub;

    const tournament = await db.getAgentTournamentById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Check if user is the creator
    if (tournament.created_by !== userId) {
      return res.status(403).json({ error: 'Only the tournament creator can start it' });
    }

    // Check minimum participants (at least 2)
    const checkInStatus = await db.getAgentTournamentCheckInStatus(tournamentId);
    if (checkInStatus.checkedInCount < 2) {
      return res.status(400).json({
        error: `Need at least 2 checked-in participants to start (currently ${checkInStatus.checkedInCount})`
      });
    }

    // Generate bracket
    const bracketInfo = await db.generateAgentTournamentBracket(tournamentId);

    // Update status
    await db.updateAgentTournamentStatus(tournamentId, 'in_progress');

    res.json({
      success: true,
      message: 'Tournament started',
      bracket: bracketInfo
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/agent/tournaments/:id/status
 * Update agent tournament status
 * Admin/Creator only
 */
router.put('/:id/status', authMiddleware, async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }

    const userId = req.user.sub;
    const { status } = req.body;

    const tournament = await db.getAgentTournamentById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Check if user is the creator
    if (tournament.created_by !== userId) {
      return res.status(403).json({ error: 'Only the tournament creator can update status' });
    }

    const validStatuses = ['upcoming', 'registration_open', 'check_in_open', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await db.updateAgentTournamentStatus(tournamentId, status);

    res.json({
      success: true,
      message: `Tournament status updated to ${status}`
    });
  } catch (err) {
    next(err);
  }
});

// Helper function to check if a number is a power of 2
function isPowerOfTwo(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

module.exports = router;
