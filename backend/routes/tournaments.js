const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { authMiddleware } = require('./auth');
const { SECRET } = require('../config/jwt');
const { FRONTEND_URL } = require('../config/appUrls');
const { CODEARENA_PRODUCT_MODE } = require('../../shared/codearenaProductMode');

const router = express.Router();

const normalizeTournamentForConsumer = (tournament) => ({
  ...tournament,
  is_pro_only: CODEARENA_PRODUCT_MODE.consumer.paidSubscriptionsEnabled
    ? tournament.is_pro_only
    : 0
});

// Rate limiter for invite code lookups: 20 requests per minute per IP
// Prevents brute-force guessing of invite codes
const inviteCodeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: 'Too many invite code attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Helper function to safely parse integers with fallback
const safeParseInt = (value, defaultValue = 0) => {
  const parsed = parseInt(value);
  return isNaN(parsed) ? defaultValue : parsed;
};

// Optional auth middleware - parses token if present but doesn't require it
const optionalAuthMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
  } catch (err) {
    req.user = null;
  }
  next();
};

/**
 * GET /api/tournaments
 * List tournaments with optional filters
 */
router.get('/', optionalAuthMiddleware, async (req, res, next) => {
  try {
    const { status, pro_only, limit = 20, offset = 0 } = req.query;

    // Parse status - can be comma-separated
    let statusFilter = status;
    if (status && status.includes(',')) {
      statusFilter = status.split(',');
    }

    const parsedLimit = Math.min(safeParseInt(limit, 20), 50);
    const parsedOffset = safeParseInt(offset, 0);

    const tournaments = await db.getTournaments({
      status: statusFilter,
      isProOnly: CODEARENA_PRODUCT_MODE.consumer.paidSubscriptionsEnabled
        ? (pro_only === 'true' ? true : (pro_only === 'false' ? false : undefined))
        : undefined,
      limit: parsedLimit,
      offset: parsedOffset
    });

    res.json({
      success: true,
      tournaments: tournaments.map(normalizeTournamentForConsumer),
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
 * GET /api/tournaments/upcoming
 * Get upcoming tournaments for quick display
 */
router.get('/upcoming', async (req, res, next) => {
  try {
    const limit = Math.min(safeParseInt(req.query.limit, 5), 10);
    const tournaments = await db.getUpcomingTournaments(limit);

    res.json({
      success: true,
      tournaments: tournaments.map(normalizeTournamentForConsumer)
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tournaments/invite/:code
 * Get tournament details by invite code (for private tournaments)
 */
router.get('/invite/:code', inviteCodeLimiter, optionalAuthMiddleware, async (req, res, next) => {
  try {
    const { code } = req.params;

    if (!code || code.length !== 8) {
      return res.status(400).json({ error: 'Invalid invite code' });
    }

    const tournament = await db.getTournamentByInviteCode(code.toUpperCase());

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found or invite link expired' });
    }

    // Check if user is already registered
    let isRegistered = false;
    if (req.user) {
      isRegistered = await db.isUserRegistered(tournament.id, req.user.sub);
    }

    res.json({
      success: true,
      tournament: {
        id: tournament.id,
        name: tournament.name,
        description: tournament.description,
        status: tournament.status,
        format: tournament.format,
        max_players: tournament.max_players,
        participant_count: tournament.participant_count,
        start_time: tournament.start_time,
        registration_deadline: tournament.registration_deadline,
        creator_username: tournament.creator_username,
        is_private: tournament.is_private,
        invite_code: tournament.invite_code
      },
      isRegistered
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tournaments/user/history
 * Get current user's tournament history
 */
router.get('/user/history', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const limit = Math.min(safeParseInt(req.query.limit, 20), 50);

    const history = await db.getUserTournamentHistory(userId, limit);
    const stats = await db.getUserTournamentStats(userId);

    res.json({
      success: true,
      history,
      stats
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tournaments/user/matches
 * Get user's pending tournament matches
 */
router.get('/user/matches', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const matches = await db.getUserPendingMatches(userId);

    res.json({
      success: true,
      matches
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tournaments/:id
 * Get tournament details
 */
router.get('/:id', optionalAuthMiddleware, async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }
    const userId = req.user?.sub;

    const tournament = await db.getTournamentById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Check if user is registered
    let isRegistered = false;
    let userParticipant = null;
    if (userId) {
      isRegistered = await db.isUserRegistered(tournamentId, userId);
      if (isRegistered) {
        const participants = await db.getTournamentParticipants(tournamentId);
        userParticipant = participants.find(p => p.user_id === userId);
      }
    }

    res.json({
      success: true,
      tournament: normalizeTournamentForConsumer(tournament),
      isRegistered,
      userParticipant
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tournaments/:id/participants
 * Get tournament participants
 */
router.get('/:id/participants', async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }
    const participants = await db.getTournamentParticipants(tournamentId);

    res.json({
      success: true,
      participants
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tournaments/:id/bracket
 * Get tournament bracket/matches
 */
router.get('/:id/bracket', async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }

    const tournament = await db.getTournamentById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const matches = await db.getTournamentMatches(tournamentId);

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
 * POST /api/tournaments/:id/register
 * Register for a tournament
 */
router.post('/:id/register', authMiddleware, async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }
    const userId = req.user.sub;
    const { language = 'python', inviteCode } = req.body;

    // Get tournament details
    const tournament = await db.getTournamentById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Check invite code for private tournaments
    if (tournament.is_private) {
      if (!inviteCode || inviteCode.toUpperCase() !== tournament.invite_code) {
        return res.status(403).json({ error: 'Valid invite code required for private tournaments' });
      }
    }

    // Check registration is open
    if (tournament.status !== 'registration_open' && tournament.status !== 'upcoming') {
      return res.status(400).json({ error: 'Registration is not open for this tournament' });
    }

    // Check if tournament is full
    if (tournament.participant_count >= tournament.max_players) {
      return res.status(400).json({ error: 'Tournament is full' });
    }

    // Validate language is a supported language
    const validLanguages = ['python', 'javascript', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'typescript', 'sql'];
    if (!validLanguages.includes(language)) {
      return res.status(400).json({ error: 'Invalid programming language' });
    }

    // Historical Pro-only tournaments become open when consumer billing is disabled.
    if (CODEARENA_PRODUCT_MODE.consumer.paidSubscriptionsEnabled && tournament.is_pro_only) {
      const isProUser = await db.isUserPro(userId);
      if (!isProUser) {
        return res.status(403).json({ error: 'This tournament is for Pro members only' });
      }
    }

    // All languages free during beta testing

    const result = await db.registerForTournament(tournamentId, userId, language);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      message: 'Successfully registered for tournament'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/tournaments/:id/register
 * Unregister from a tournament
 */
router.delete('/:id/register', authMiddleware, async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }
    const userId = req.user.sub;

    // Get tournament details
    const tournament = await db.getTournamentById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Can only unregister before tournament starts
    if (tournament.status === 'in_progress' || tournament.status === 'completed') {
      return res.status(400).json({ error: 'Cannot unregister from an active tournament' });
    }

    const result = await db.unregisterFromTournament(tournamentId, userId);

    if (!result.success) {
      return res.status(400).json({ error: 'Not registered for this tournament' });
    }

    res.json({
      success: true,
      message: 'Successfully unregistered from tournament'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tournaments
 * Create a new tournament
 * - Public tournaments: Admin/CodeArena hosted
 * - Private tournaments: Any authenticated user can create
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
      maxPlayers = 32,
      minPlayers = 2,
      prizeDescription,
      isProOnly = false,
      isPrivate = false
    } = req.body;

    // Validation
    if (!name || !startTime || !registrationDeadline) {
      return res.status(400).json({
        error: 'Name, start time, and registration deadline are required'
      });
    }

    // Public tournaments are CodeArena/admin hosted (they appear in the global listing and
    // can be access-restricted if paid consumer plans are enabled). A non-admin must create
    // a PRIVATE tournament instead so authenticated users cannot spam the public list.
    if (!isPrivate) {
      const creator = await db.getUserById(userId);
      if (!creator || creator.is_admin !== 1) {
        return res.status(403).json({
          error: 'Public tournaments are hosted by CodeArena. Create a private tournament instead.'
        });
      }
    }

    // Private tournament specific logic
    if (isPrivate) {
      // Limit max players to 64 for private tournaments
      const privateMaxPlayers = Math.min(maxPlayers, 64);

      const result = await db.createTournament({
        name,
        description,
        startTime,
        registrationDeadline,
        format,
        maxPlayers: privateMaxPlayers,
        minPlayers: Math.max(minPlayers, 2),
        prizeDescription,
        isProOnly: false, // Private tournaments are not pro-only
        isPrivate: true,
        createdBy: userId
      });

      const frontendUrl = FRONTEND_URL;

      return res.json({
        success: true,
        tournamentId: result.id,
        inviteCode: result.inviteCode,
        inviteUrl: `${frontendUrl}/tournaments/join/${result.inviteCode}`,
        message: 'Private tournament created successfully'
      });
    }

    // Public tournament creation (existing flow)
    const result = await db.createTournament({
      name,
      description,
      startTime,
      registrationDeadline,
      format,
      maxPlayers,
      minPlayers,
      prizeDescription,
      isProOnly: CODEARENA_PRODUCT_MODE.consumer.paidSubscriptionsEnabled && isProOnly,
      isPrivate: false,
      createdBy: userId
    });

    res.json({
      success: true,
      tournamentId: result.id,
      message: 'Tournament created successfully'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tournaments/:id/start
 * Start a tournament (generates bracket, sets status to in_progress)
 */
router.post('/:id/start', authMiddleware, async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }
    const userId = req.user.sub;

    const tournament = await db.getTournamentById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Check if user is the creator (simple admin check)
    if (tournament.created_by !== userId) {
      return res.status(403).json({ error: 'Only the tournament creator can start it' });
    }

    // Eligible players: when check-in is open, only those who actually checked in count toward the
    // minimum AND get bracketed; otherwise all registered. Mirrors the auto-start scheduler so a
    // manual start can't bracket no-shows into bye/stall matches.
    const isCheckInOpen = tournament.status === 'check_in_open';
    const eligibleCount = isCheckInOpen
      ? await db.getCheckedInParticipantCount(tournamentId)
      : tournament.participant_count;

    if (eligibleCount < tournament.min_players) {
      return res.status(400).json({
        error: `Need at least ${tournament.min_players} ${isCheckInOpen ? 'checked-in ' : ''}participants to start (currently ${eligibleCount})`
      });
    }

    // Drop players who did not check in before bracketing (only when check-in was open).
    if (isCheckInOpen) {
      await db.startTournamentWithCheckedIn(tournamentId);
    }

    // Generate bracket
    const bracketInfo = await db.generateBracket(tournamentId);

    // Update status
    await db.updateTournamentStatus(tournamentId, 'in_progress');

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
 * PUT /api/tournaments/:id/status
 * Update tournament status
 */
router.put('/:id/status', authMiddleware, async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }
    const userId = req.user.sub;
    const { status } = req.body;

    const tournament = await db.getTournamentById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (tournament.created_by !== userId) {
      return res.status(403).json({ error: 'Only the tournament creator can update status' });
    }

    const validStatuses = ['upcoming', 'registration_open', 'registration_closed', 'check_in_open', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await db.updateTournamentStatus(tournamentId, status);

    res.json({
      success: true,
      message: `Tournament status updated to ${status}`
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tournaments/:id/check-in
 * Get check-in status for a tournament
 */
router.get('/:id/check-in', async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }

    const tournament = await db.getTournamentById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const checkInStatus = await db.getTournamentCheckInStatus(tournamentId);
    const canCheckInResult = await db.canCheckIn(tournamentId);

    res.json({
      success: true,
      tournament: {
        id: tournament.id,
        name: tournament.name,
        status: tournament.status,
        start_time: tournament.start_time
      },
      checkIn: {
        isOpen: canCheckInResult.canCheckIn,
        ...checkInStatus
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tournaments/:id/check-in
 * Check in for a tournament (player confirms attendance)
 */
router.post('/:id/check-in', authMiddleware, async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }
    const userId = req.user.sub;

    // First verify check-in is allowed
    const canCheckInResult = await db.canCheckIn(tournamentId);
    if (!canCheckInResult.canCheckIn) {
      return res.status(400).json({
        error: canCheckInResult.reason || 'Check-in is not available'
      });
    }

    const result = await db.checkInForTournament(tournamentId, userId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Get updated check-in status
    const checkInStatus = await db.getTournamentCheckInStatus(tournamentId);

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
 * POST /api/tournaments/:id/cancel
 * Cancel a tournament (creator only)
 */
router.post('/:id/cancel', authMiddleware, async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (isNaN(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }
    const userId = req.user.sub;
    const { reason } = req.body;

    const tournament = await db.getTournamentById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (tournament.created_by !== userId) {
      return res.status(403).json({ error: 'Only the tournament creator can cancel it' });
    }

    if (tournament.status === 'completed' || tournament.status === 'cancelled') {
      return res.status(400).json({ error: 'Tournament is already finished or cancelled' });
    }

    const result = await db.cancelTournament(tournamentId, reason || 'Cancelled by organizer');

    res.json({
      success: true,
      message: 'Tournament cancelled successfully',
      notifiedParticipants: result.participants.length
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
