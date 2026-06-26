const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const db = require('../db');
const authRouter = require('./auth');
const { containsProfanity } = require('../utils/contentFilter');
const emailService = require('../services/email');
const { verifyGeneratedGame } = require('../services/gameVerification');
const { getConsumerFairUseLimit } = require('../../shared/codearenaProductMode');

// CreatorArena like-count milestones that trigger an email to the game's creator
const CREATOR_ARENA_LIKE_MILESTONES = [10, 50, 100];

// Fire CreatorArena milestone email if pref is on and dedup row was inserted.
// Errors are logged but never thrown, milestone emails are best-effort.
async function sendCreatorArenaMilestone(creatorId, milestoneType, game, milestone) {
  try {
    const fresh = await db.tryRecordOneTimeNotification(creatorId, milestoneType, { gameId: game.id });
    if (!fresh) return;
    const prefs = await db.getEmailPreferences(creatorId);
    if (prefs && prefs.creator_arena_emails === 0) return;
    const creator = await db.getUserById(creatorId);
    if (!creator?.email) return;
    await emailService.sendCreatorMilestoneEmail({
      to: creator.email,
      username: creator.username,
      game: { id: game.id, title: game.title },
      milestone
    });
  } catch (err) {
    logger.warn(`[GAMES] Milestone email failed (${milestoneType}):`, err.message);
  }
}

const router = express.Router();
const authMiddleware = authRouter.authMiddleware;

// Optional auth, sets req.user if token present, doesn't block if missing
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();
  try {
    const jwt = require('jsonwebtoken');
    const { SECRET } = require('../config/jwt');
    const token = authHeader.split(' ')[1];
    req.user = jwt.verify(token, SECRET);
  } catch (e) { /* ignore invalid token */ }
  next();
}

const createLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 10,
  keyGenerator: req => String(req.user.sub),
  message: { error: 'Daily game creation limit reached. Try again tomorrow.' }
});
const updateLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 60,
  keyGenerator: req => String(req.user.sub),
  message: { error: 'Daily game save limit reached. Try again tomorrow.' }
});
const commentLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'Too many comments. Please slow down.' } });
const verificationInFlight = new Map();

function serializeVerification(verification) {
  if (!verification) return null;
  return {
    id: verification.id,
    gameId: verification.game_id,
    versionId: verification.version_id,
    staticStatus: verification.static_status,
    runtimeStatus: verification.runtime_status,
    accuracyStatus: verification.accuracy_status,
    overallStatus: verification.overall_status,
    accuracyScore: verification.accuracy_score,
    findings: verification.findings_json || [],
    artifacts: verification.artifacts_json || {},
    spec: verification.spec_json || null,
    verifierVersion: verification.verifier_version,
    createdAt: verification.created_at
  };
}

// ============================================
// GAME CRUD
// ============================================

/** POST /: Create a new draft game */
router.post('/', authMiddleware, createLimiter, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { title, description, gameType, htmlContent, tags, promptUsed } = req.body;
    if (!title || !htmlContent) return res.status(400).json({ error: 'title and htmlContent are required' });
    if (typeof title !== 'string' || title.length > 120) return res.status(400).json({ error: 'Title must be 120 characters or fewer' });
    if (description != null && (typeof description !== 'string' || description.length > 1000)) return res.status(400).json({ error: 'Description must be 1,000 characters or fewer' });
    if (promptUsed != null && (typeof promptUsed !== 'string' || promptUsed.length > 4000)) return res.status(400).json({ error: 'Prompt history is too large' });
    if (tags != null && (!Array.isArray(tags) || tags.length > 10 || tags.some(tag => typeof tag !== 'string' || tag.length > 30))) return res.status(400).json({ error: 'Use at most 10 tags of 30 characters each' });
    if (htmlContent.length > 500000) return res.status(400).json({ error: 'Game content too large (max 500KB)' });
    if (containsProfanity(title) || containsProfanity(description)) {
      return res.status(400).json({ error: 'Your game title or description contains inappropriate content. Please revise and try again.' });
    }

    const result = await db.createGame(userId, { title, description, gameType, htmlContent, tags, promptUsed });
    res.json({ success: true, gameId: result.id });
  } catch (err) {
    logger.error('[GAMES] Create error:', err.message);
    res.status(500).json({ error: 'Failed to create game' });
  }
});

/** GET /mine: List authenticated user's games */
router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const games = await db.getUserGames(req.user.sub);
    res.json({ games });
  } catch (err) {
    logger.error('[GAMES] List user games error:', err.message);
    res.status(500).json({ error: 'Failed to load games' });
  }
});

/** GET /leaderboard: Top rated games with most players */
router.get('/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 25);
    const games = await db.getTopRatedGames(limit);
    res.json({ games });
  } catch (err) {
    logger.error('[GAMES] Leaderboard error:', err.message);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

/** GET /gallery: Browse published games */
router.get('/gallery', async (req, res) => {
  try {
    const { sort, type, search, page, limit } = req.query;
    const result = await db.getPublishedGames({
      sort: sort || 'new',
      type: type || 'all',
      search: search || null,
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 20, 50)
    });
    res.json(result);
  } catch (err) {
    logger.error('[GAMES] Gallery error:', err.message);
    res.status(500).json({ error: 'Failed to load gallery' });
  }
});

/** GET /:id: Get a single game */
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const game = await db.getGameById(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    const latestVersion = await db.getLatestGameVersion(game.id);
    const latestVerification = latestVersion
      ? await db.getLatestGameVerificationForVersion(latestVersion.id)
      : null;

    // Increment play count for published games
    if (game.status === 'published') {
      db.incrementPlayCount(game.id).catch(() => {});
    }

    // If draft, only creator can view
    if (game.status === 'draft' && (!req.user || req.user.sub !== game.creator_id)) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Get user's vote and rating if authenticated
    let userVote = null;
    let userRating = null;
    if (req.user) {
      const [vote, ratingRow] = await Promise.all([
        db.getUserVoteForGame(game.id, req.user.sub),
        db.getUserRatingForGame(game.id, req.user.sub)
      ]);
      userVote = vote?.vote || null;
      userRating = ratingRow?.rating || null;
    }

    res.json({
      game,
      userVote,
      userRating,
      latestVersion: latestVersion ? {
        id: latestVersion.id,
        versionNumber: latestVersion.version_number,
        createdAt: latestVersion.created_at
      } : null,
      latestVerification: serializeVerification(latestVerification),
      publishability: {
        isVerified: Boolean(latestVerification && latestVerification.overall_status === 'passed' && latestVerification.version_id === latestVersion?.id),
        needsVerification: !latestVerification || latestVerification.version_id !== latestVersion?.id || latestVerification.overall_status !== 'passed'
      }
    });
  } catch (err) {
    logger.error('[GAMES] Get game error:', err.message);
    res.status(500).json({ error: 'Failed to load game' });
  }
});

/** PUT /:id: Update a game */
router.put('/:id', authMiddleware, updateLimiter, async (req, res) => {
  try {
    const game = await db.getGameById(req.params.id);
    if (!game || game.creator_id !== req.user.sub) return res.status(404).json({ error: 'Game not found' });

    const { title, description, htmlContent, tags, promptUsed } = req.body;
    if (title != null && (typeof title !== 'string' || title.length > 120)) return res.status(400).json({ error: 'Title must be 120 characters or fewer' });
    if (description != null && (typeof description !== 'string' || description.length > 1000)) return res.status(400).json({ error: 'Description must be 1,000 characters or fewer' });
    if (promptUsed != null && (typeof promptUsed !== 'string' || promptUsed.length > 4000)) return res.status(400).json({ error: 'Prompt history is too large' });
    if (tags != null && (!Array.isArray(tags) || tags.length > 10 || tags.some(tag => typeof tag !== 'string' || tag.length > 30))) return res.status(400).json({ error: 'Use at most 10 tags of 30 characters each' });
    if (htmlContent && htmlContent.length > 500000) return res.status(400).json({ error: 'Game content too large' });
    if (containsProfanity(title) || containsProfanity(description)) {
      return res.status(400).json({ error: 'Your game title or description contains inappropriate content. Please revise and try again.' });
    }

    await db.updateGame(game.id, { title, description, htmlContent, tags, promptUsed });
    res.json({ success: true });
  } catch (err) {
    logger.error('[GAMES] Update error:', err.message);
    res.status(500).json({ error: 'Failed to update game' });
  }
});

/** DELETE /:id: Soft-delete a game */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const game = await db.getGameById(req.params.id);
    if (!game || game.creator_id !== req.user.sub) return res.status(404).json({ error: 'Game not found' });
    await db.deleteGame(game.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('[GAMES] Delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete game' });
  }
});

/** POST /:id/publish: Publish game to gallery */
router.post('/:id/publish', authMiddleware, async (req, res) => {
  try {
    const game = await db.getGameById(req.params.id);
    if (!game || game.creator_id !== req.user.sub) return res.status(404).json({ error: 'Game not found' });
    const latestVersion = await db.getLatestGameVersion(game.id);
    const latestVerification = latestVersion
      ? await db.getLatestGameVerificationForVersion(latestVersion.id)
      : null;

    if (!latestVersion) {
      return res.status(400).json({ error: 'This game has no saved version to publish.' });
    }

    if (!latestVerification || latestVerification.overall_status !== 'passed' || latestVerification.version_id !== latestVersion.id) {
      return res.status(409).json({
        error: 'This game must pass verification on the latest saved version before it can be published.',
        code: 'VERIFICATION_REQUIRED',
        latestVersionId: latestVersion.id,
        latestVerification: serializeVerification(latestVerification)
      });
    }

    await db.publishGame(game.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('[GAMES] Publish error:', err.message);
    res.status(500).json({ error: 'Failed to publish game' });
  }
});

/** POST /:id/unpublish: Unpublish game */
router.post('/:id/unpublish', authMiddleware, async (req, res) => {
  try {
    const game = await db.getGameById(req.params.id);
    if (!game || game.creator_id !== req.user.sub) return res.status(404).json({ error: 'Game not found' });
    await db.unpublishGame(game.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('[GAMES] Unpublish error:', err.message);
    res.status(500).json({ error: 'Failed to unpublish game' });
  }
});

// ============================================
// VOTING
// ============================================

/** POST /:id/vote: Upvote or downvote */
router.post('/:id/vote', authMiddleware, async (req, res) => {
  try {
    const { vote } = req.body;
    if (vote !== 1 && vote !== -1) return res.status(400).json({ error: 'vote must be 1 or -1' });

    const game = await db.getGameById(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    await db.upsertGameVote(game.id, req.user.sub, vote);
    const updated = await db.getGameById(game.id);

    // Notify game creator on upvotes (not self-votes)
    if (vote === 1 && game.creator_id !== req.user.sub) {
      db.createNotification(game.creator_id, {
        type: 'game_vote',
        title: `Someone upvoted your game "${game.title}"`,
        link: `/gallery/${game.id}`
      }).catch(() => {});

      // Milestone emails: fire whenever vote_score crosses a threshold (dedup'd per game per threshold)
      const before = game.vote_score || 0;
      const after = updated.vote_score || 0;
      for (const threshold of CREATOR_ARENA_LIKE_MILESTONES) {
        if (before < threshold && after >= threshold) {
          sendCreatorArenaMilestone(
            game.creator_id,
            `creator_arena_likes_${threshold}_game_${game.id}`,
            game,
            { kind: 'likes', threshold }
          );
        }
      }
    }

    res.json({ success: true, voteScore: updated.vote_score });
  } catch (err) {
    logger.error('[GAMES] Vote error:', err.message);
    res.status(500).json({ error: 'Failed to vote' });
  }
});

/** DELETE /:id/vote: Remove vote */
router.delete('/:id/vote', authMiddleware, async (req, res) => {
  try {
    const game = await db.getGameById(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    await db.removeGameVote(game.id, req.user.sub);
    const updated = await db.getGameById(game.id);
    res.json({ success: true, voteScore: updated.vote_score });
  } catch (err) {
    logger.error('[GAMES] Remove vote error:', err.message);
    res.status(500).json({ error: 'Failed to remove vote' });
  }
});

// ============================================
// RATINGS (1-5 stars)
// ============================================

/** POST /:id/rate: Submit or update a star rating */
router.post('/:id/rate', authMiddleware, async (req, res) => {
  try {
    const { rating } = req.body;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'rating must be an integer between 1 and 5' });
    }

    const game = await db.getGameById(req.params.id);
    if (!game || game.status !== 'published') return res.status(404).json({ error: 'Game not found' });

    await db.upsertGameRating(game.id, req.user.sub, rating);
    const updated = await db.getGameById(game.id);
    res.json({ success: true, avgRating: updated.avg_rating, ratingCount: updated.rating_count });
  } catch (err) {
    logger.error('[GAMES] Rate error:', err.message);
    res.status(500).json({ error: 'Failed to submit rating' });
  }
});

/** DELETE /:id/rate: Remove a star rating */
router.delete('/:id/rate', authMiddleware, async (req, res) => {
  try {
    const game = await db.getGameById(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    await db.removeGameRating(game.id, req.user.sub);
    const updated = await db.getGameById(game.id);
    res.json({ success: true, avgRating: updated.avg_rating, ratingCount: updated.rating_count });
  } catch (err) {
    logger.error('[GAMES] Remove rating error:', err.message);
    res.status(500).json({ error: 'Failed to remove rating' });
  }
});

// ============================================
// COMMENTS
// ============================================

/** GET /:id/comments: List comments */
router.get('/:id/comments', optionalAuth, async (req, res) => {
  try {
    const comments = await db.getGameComments(req.params.id, req.user?.sub || null);
    // Thread them: top-level + nested
    const topLevel = comments.filter(c => !c.parent_id);
    const replies = comments.filter(c => c.parent_id);
    const threaded = topLevel.map(c => ({
      ...c,
      replies: replies.filter(r => r.parent_id === c.id)
    }));
    res.json({ comments: threaded });
  } catch (err) {
    logger.error('[GAMES] List comments error:', err.message);
    res.status(500).json({ error: 'Failed to load comments' });
  }
});

/** POST /:id/comments: Add comment */
router.post('/:id/comments', authMiddleware, commentLimiter, async (req, res) => {
  try {
    const { content, parentId } = req.body;
    if (!content || content.trim().length === 0) return res.status(400).json({ error: 'Content is required' });
    if (content.length > 2000) return res.status(400).json({ error: 'Comment too long (max 2000 chars)' });
    if (containsProfanity(content)) {
      return res.status(400).json({ error: 'Your comment contains inappropriate content. Please revise and try again.' });
    }

    const game = await db.getGameById(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    const result = await db.createGameComment(game.id, req.user.sub, content.trim(), parentId);

    // Notify game creator (not self-comments)
    if (game.creator_id !== req.user.sub) {
      const commenter = await db.getUserById(req.user.sub);
      db.createNotification(game.creator_id, {
        type: 'comment_reply',
        title: `${commenter?.username || 'Someone'} commented on your game "${game.title}"`,
        message: content.trim().slice(0, 100),
        link: `/gallery/${game.id}`
      }).catch(() => {});

      // First-comment milestone email (dedup'd per game)
      const commentCount = await db.getGameCommentCount(game.id);
      if (commentCount === 1) {
        sendCreatorArenaMilestone(
          game.creator_id,
          `creator_arena_first_comment_game_${game.id}`,
          game,
          { kind: 'first_comment' }
        );
      }
    }

    res.json({ success: true, commentId: result.id });
  } catch (err) {
    logger.error('[GAMES] Add comment error:', err.message);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

/** DELETE /:id/comments/:commentId: Delete comment */
router.delete('/:id/comments/:commentId', authMiddleware, async (req, res) => {
  try {
    const comment = await db.get('SELECT * FROM game_comments WHERE id = ?', [req.params.commentId]);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.user_id !== req.user.sub) return res.status(403).json({ error: 'Not your comment' });

    await db.deleteGameComment(comment.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('[GAMES] Delete comment error:', err.message);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

/** POST /:id/comments/:commentId/vote: Upvote or downvote a comment */
router.post('/:id/comments/:commentId/vote', authMiddleware, async (req, res) => {
  try {
    const { vote } = req.body;
    if (vote !== 1 && vote !== -1) return res.status(400).json({ error: 'vote must be 1 or -1' });

    const comment = await db.get('SELECT * FROM game_comments WHERE id = ? AND game_id = ?', [req.params.commentId, req.params.id]);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    const existing = await db.getUserVoteForGameComment(comment.id, req.user.sub);
    const userVote = existing?.vote === vote ? 0 : vote;
    if (userVote === 0) {
      await db.removeGameCommentVote(comment.id, req.user.sub);
    } else {
      await db.upsertGameCommentVote(comment.id, req.user.sub, vote);
    }

    const voteScore = await db.getGameCommentVoteScore(comment.id);
    res.json({ success: true, voteScore, userVote });
  } catch (err) {
    logger.error('[GAMES] Comment vote error:', err.message);
    res.status(500).json({ error: 'Failed to vote on comment' });
  }
});

// ============================================
// VERSIONS
// ============================================

/** GET /:id/versions: List version history */
router.get('/:id/versions', authMiddleware, async (req, res) => {
  try {
    const game = await db.getGameById(req.params.id);
    if (!game || game.creator_id !== req.user.sub) return res.status(404).json({ error: 'Game not found' });
    const versions = await db.getGameVersions(game.id);
    res.json({ versions });
  } catch (err) {
    logger.error('[GAMES] List versions error:', err.message);
    res.status(500).json({ error: 'Failed to load versions' });
  }
});

/** POST /:id/verify: Verify latest saved game version for publishability */
router.post('/:id/verify', authMiddleware, async (req, res) => {
  try {
    const game = await db.getGameById(req.params.id);
    if (!game || game.creator_id !== req.user.sub) return res.status(404).json({ error: 'Game not found' });

    const latestVersion = await db.getLatestGameVersion(game.id);
    if (!latestVersion) {
      return res.status(400).json({ error: 'Save the game before verification.' });
    }

    let latestVerification = await db.getLatestGameVerificationForVersion(latestVersion.id);
    let cached = Boolean(latestVerification);

    if (!latestVerification) {
      let verificationPromise = verificationInFlight.get(latestVersion.id);
      if (!verificationPromise) {
        verificationPromise = (async () => {
          const userLimit = getConsumerFairUseLimit('creatorVerificationsPerDay');
          const globalLimit = getConsumerFairUseLimit('globalCreatorVerificationsPerDay');
          const quota = await db.tryConsumeConsumerDailyUsage([
            { metric: 'creator_verification', subjectId: `user:${req.user.sub}`, limit: userLimit },
            { metric: 'creator_verification', subjectId: 'global', limit: globalLimit }
          ]);
          if (!quota.allowed) {
            const quotaError = new Error(quota.reason === 'global_limit'
              ? 'CodeArena has reached today\'s game-verification capacity. Please try again tomorrow.'
              : `Daily fair-use limit reached (${userLimit} game verifications). Try again tomorrow.`);
            quotaError.status = 429;
            quotaError.globalLimitReached = quota.reason === 'global_limit';
            quotaError.dailyLimit = quotaError.globalLimitReached ? globalLimit : userLimit;
            throw quotaError;
          }

          const promptToVerify = latestVersion.prompt_used || game.description || game.title || 'CreatorArena game';
          const verification = await verifyGeneratedGame({
            html: latestVersion.html_content,
            prompt: promptToVerify,
            gameType: game.game_type || 'browser'
          });

          await db.createGameVerification({
            gameId: game.id,
            versionId: latestVersion.id,
            spec: verification.spec,
            staticStatus: verification.staticResult.status,
            runtimeStatus: verification.runtimeResult.status,
            accuracyStatus: verification.accuracyResult.status,
            overallStatus: verification.overallStatus,
            accuracyScore: verification.accuracyResult.score,
            findings: verification.findings,
            artifacts: verification.artifacts,
            verifierVersion: verification.verifierVersion
          });

          return db.getLatestGameVerificationForVersion(latestVersion.id);
        })().finally(() => verificationInFlight.delete(latestVersion.id));
        verificationInFlight.set(latestVersion.id, verificationPromise);
      } else {
        cached = true;
      }
      latestVerification = await verificationPromise;
    }

    res.json({
      success: latestVerification.overall_status === 'passed',
      cached,
      verification: serializeVerification(latestVerification),
      latestVersion: {
        id: latestVersion.id,
        versionNumber: latestVersion.version_number,
        createdAt: latestVersion.created_at
      }
    });
  } catch (err) {
    logger.error('[GAMES] Verify error:', err.message);
    if (err.status === 429) {
      return res.status(429).json({
        error: err.message,
        limitReached: true,
        globalLimitReached: Boolean(err.globalLimitReached),
        dailyLimit: err.dailyLimit
      });
    }
    res.status(500).json({ error: 'Failed to verify game' });
  }
});

// ============================================
// GITHUB PUSH
// ============================================

/** POST /:id/github-push: Push game to user's GitHub repo */
router.post('/:id/github-push', authMiddleware, async (req, res) => {
  try {
    const game = await db.getGameById(req.params.id);
    if (!game || game.creator_id !== req.user.sub) return res.status(404).json({ error: 'Game not found' });

    const token = await db.getUserGitHubToken(req.user.sub);
    if (!token) return res.status(400).json({ error: 'GitHub not connected', needsAuth: true });

    const { repo, path } = req.body;
    const repoName = repo || 'codearena-games';
    const slug = game.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filePath = path || `${slug}/index.html`;

    // Get GitHub username
    const ghUserRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' }
    });
    if (!ghUserRes.ok) return res.status(400).json({ error: 'GitHub token expired. Please reconnect.', needsAuth: true });
    const ghUser = await ghUserRes.json();
    const owner = ghUser.login;

    // Check if repo exists, create if not
    const repoCheckRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' }
    });
    if (repoCheckRes.status === 404) {
      const createRes = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: repoName, description: 'Games created on CodeArena', private: false, auto_init: true })
      });
      if (!createRes.ok) {
        const err = await createRes.json();
        return res.status(500).json({ error: `Failed to create repo: ${err.message}` });
      }
      // Wait a moment for repo to initialize
      await new Promise(r => setTimeout(r, 2000));
    }

    // Check if file exists (to get SHA for update)
    let sha = null;
    const fileCheckRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' }
    });
    if (fileCheckRes.ok) {
      const existing = await fileCheckRes.json();
      sha = existing.sha;
    }

    // Create or update file
    const putBody = {
      message: sha ? `Update ${game.title} via CodeArena` : `Add ${game.title} via CodeArena`,
      content: Buffer.from(game.html_content).toString('base64'),
      ...(sha && { sha })
    };

    const putRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify(putBody)
    });

    if (!putRes.ok) {
      const err = await putRes.json();
      return res.status(500).json({ error: `GitHub push failed: ${err.message}` });
    }

    const putData = await putRes.json();
    const githubUrl = putData.content?.html_url || `https://github.com/${owner}/${repoName}/blob/main/${filePath}`;

    // Store repo info on game
    await db.run(`UPDATE games SET github_repo = ?, github_path = ? WHERE id = ?`, [`${owner}/${repoName}`, filePath, game.id]);

    res.json({ success: true, url: githubUrl, repo: `${owner}/${repoName}`, path: filePath });
  } catch (err) {
    logger.error('[GAMES] GitHub push error:', err.message);
    res.status(500).json({ error: 'Failed to push to GitHub' });
  }
});

module.exports = router;
