const express = require('express');
const db = require('../db');
const authRouter = require('./auth');
const elo = require('../elo');
const paymentRouter = require('./payment');

const problemsLoader = require('../problemsLoader');

const router = express.Router();
const authMiddleware = authRouter.authMiddleware;

// In-memory cache for leaderboard (reduces DB load)
// Uses LRU eviction with max size limit
const leaderboardCache = {
  data: new Map(),
  ttl: 30000, // 30 seconds
  maxSize: 50, // Maximum cache entries
  getKey: (limit, offset) => `${limit}:${offset}`,
  get(limit, offset) {
    const key = this.getKey(limit, offset);
    const cached = this.data.get(key);
    if (cached && Date.now() < cached.expires) {
      // Move to end for LRU (delete and re-add)
      this.data.delete(key);
      this.data.set(key, cached);
      return cached.value;
    }
    this.data.delete(key);
    return null;
  },
  set(limit, offset, value) {
    const key = this.getKey(limit, offset);
    // Delete first to ensure it goes to end of Map (LRU)
    this.data.delete(key);
    this.data.set(key, { value, expires: Date.now() + this.ttl });
    // Evict oldest entries (first in Map) if over max size
    while (this.data.size > this.maxSize) {
      const oldestKey = this.data.keys().next().value;
      this.data.delete(oldestKey);
    }
  },
  invalidate() {
    this.data.clear();
  }
};

// IMPORTANT: Static routes must come BEFORE dynamic /:username routes

// Search users (requires authentication to prevent email enumeration)
router.get('/search', authMiddleware, async (req, res, next) => {
  try {
    const { q } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50); // Bound: 1-50

    if (!q || q.length < 2) {
      return res.json({ success: true, users: [] });
    }

    // Prevent DoS with very long search strings
    if (q.length > 100) {
      return res.status(400).json({ error: 'Search query too long' });
    }

    // Only search by username, never by email to prevent email enumeration.
    // db.searchUsers ORs on email as well; we bypass that by calling the DB
    // directly with a username-only query built here.
    const searchTerm = `%${q}%`;
    const users = await db.all(
      `SELECT u.id, u.username, u.avatar, u.avatar_url, u.is_online,
              s.rating, s.wins, s.losses
         FROM users u
         LEFT JOIN user_stats s ON u.id = s.user_id
        WHERE u.username IS NOT NULL
          AND u.username LIKE ?
        ORDER BY s.rating DESC
        LIMIT ?`,
      [searchTerm, limit]
    );

    res.json({
      success: true,
      users: users.map(u => ({
        id: u.id,
        username: u.username,
        avatar: u.avatar,
        avatar_url: u.avatar_url || null,
        is_online: !!u.is_online,
        rating: u.rating || 1000,
        wins: u.wins || 0,
        losses: u.losses || 0
      }))
    });
  } catch (err) {
    next(err);
  }
});

// Get online users (for battle invites)
router.get('/online', authMiddleware, async (req, res, next) => {
  try {
    const search = req.query.search || '';
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const users = await db.getOnlineUsers(req.user.sub, search, limit);

    res.json({
      success: true,
      users: users.map(u => ({
        id: u.id,
        username: u.username,
        avatar: u.avatar,
        avatar_url: u.avatar_url || null,
        is_online: !!u.is_online,
        rating: u.rating || 1000,
        wins: u.wins || 0,
        losses: u.losses || 0,
        is_friend: !!u.is_friend
      }))
    });
  } catch (err) {
    next(err);
  }
});

// Get leaderboard with rank tiers (cached for 30s)
router.get('/leaderboard', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100); // Bound: 1-100
    const offset = Math.max(parseInt(req.query.offset) || 0, 0); // Ensure non-negative

    // Check cache first
    const cached = leaderboardCache.get(limit, offset);
    if (cached) {
      return res.json(cached);
    }

    const leaderboard = await db.getLeaderboard(limit, offset);

    const response = {
      success: true,
      leaderboard: leaderboard.map((u, index) => {
        const rating = u.rating || 1000;
        const rankInfo = elo.getRankDivision(rating);
        return {
          rank: offset + index + 1,
          id: u.id,
          username: u.username,
          avatar: u.avatar,
          avatar_url: u.avatar_url || null,
          is_online: !!u.is_online,
          rating: rating,
          rankTier: rankInfo.tier.name,
          rankDivision: rankInfo.division,
          rankDisplay: rankInfo.display,
          rankIcon: rankInfo.tier.icon,
          rankColor: rankInfo.tier.color,
          wins: u.wins || 0,
          losses: u.losses || 0,
          total_battles: u.total_battles || 0,
          best_win_streak: u.best_win_streak || 0
        };
      })
    };

    // Cache the response
    leaderboardCache.set(limit, offset, response);

    res.json(response);
  } catch (err) {
    next(err);
  }
});

// Get rank tiers info
router.get('/ranks', async (req, res, next) => {
  try {
    res.json({
      success: true,
      tiers: Object.entries(elo.RANK_TIERS).map(([key, tier]) => ({
        key,
        name: tier.name,
        min: tier.min,
        max: tier.max === Infinity ? null : tier.max,
        color: tier.color,
        icon: tier.icon
      })),
      matchmaking: {
        initialRange: elo.MATCHMAKING.INITIAL_RANGE,
        maxRange: elo.MATCHMAKING.MAX_RANGE,
        rangeIncrement: elo.MATCHMAKING.RANGE_INCREMENT,
        incrementInterval: elo.MATCHMAKING.RANGE_INCREMENT_INTERVAL
      }
    });
  } catch (err) {
    next(err);
  }
});

// Get all public usernames for sitemap (cached, limited)
router.get('/sitemap-usernames', async (req, res, next) => {
  try {
    // Get usernames of active users (had activity in last 90 days) for sitemap
    // Limited to 10,000 to keep sitemap reasonable size
    const users = await db.all(`
      SELECT username, created_at
      FROM users
      WHERE username IS NOT NULL
        AND is_banned = 0
      ORDER BY created_at DESC
      LIMIT 10000
    `);

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.json({
      success: true,
      usernames: users.map(u => ({
        username: u.username,
        created_at: u.created_at
      }))
    });
  } catch (err) {
    next(err);
  }
});

// Dynamic routes come AFTER static routes

// Get user performance data: language and difficulty breakdown
router.get('/:username/performance', async (req, res, next) => {
  try {
    const { username } = req.params;

    const user = await db.getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Language stats: wins and losses per language
    const [langWins, langLosses] = await Promise.all([
      db.all(`
        SELECT winner_language as language, COUNT(*) as count
        FROM battles_history
        WHERE winner_id = ? AND winner_language IS NOT NULL
        GROUP BY winner_language
      `, [user.id]),
      db.all(`
        SELECT loser_language as language, COUNT(*) as count
        FROM battles_history
        WHERE loser_id = ? AND loser_language IS NOT NULL
        GROUP BY loser_language
      `, [user.id])
    ]);

    const languageStats = {};
    for (const w of langWins) {
      if (!languageStats[w.language]) languageStats[w.language] = { wins: 0, losses: 0 };
      languageStats[w.language].wins = w.count;
    }
    for (const l of langLosses) {
      if (!languageStats[l.language]) languageStats[l.language] = { wins: 0, losses: 0 };
      languageStats[l.language].losses = l.count;
    }

    // Difficulty stats: aggregate wins/losses by difficulty
    const recentBattles = await db.getUserBattleHistory(user.id, 200, 0);
    const difficultyStats = {
      Easy: { wins: 0, losses: 0 },
      Medium: { wins: 0, losses: 0 },
      Hard: { wins: 0, losses: 0 }
    };

    for (const battle of recentBattles) {
      const problem = problemsLoader.getByIdForFrontend(battle.problem_id);
      const difficulty = problem?.difficulty;

      if (difficulty && difficultyStats[difficulty]) {
        if (battle.winner_id === user.id) {
          difficultyStats[difficulty].wins++;
        } else {
          difficultyStats[difficulty].losses++;
        }
      }
    }

    res.json({
      success: true,
      languageStats,
      difficultyStats
    });
  } catch (err) {
    next(err);
  }
});

// Get public profile by username
router.get('/:username', async (req, res, next) => {
  try {
    const { username } = req.params;

    const user = await db.getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [stats, privateStats, battles, isPro] = await Promise.all([
      db.getUserStats(user.id),
      db.getPrivateBattleStats(user.id),
      db.getUserBattleHistory(user.id, 10, 0),
      db.isUserPro(user.id)
    ]);
    // Note: We intentionally do NOT call syncProStatusFromStripe here.
    // That Stripe API call takes 2-5s and was making the profile page very slow.
    // Pro status is synced via Stripe webhooks and on subscription-sensitive endpoints instead.

    const rating = stats?.rating || 1000;
    const rankInfo = elo.getRankDivision(rating);

    // Combine ranked + unranked stats for total counts
    const rankedWins = stats?.wins || 0;
    const rankedLosses = stats?.losses || 0;
    const rankedTies = stats?.ties || 0;
    const privateWins = privateStats?.private_wins || 0;
    const privateLosses = privateStats?.private_losses || 0;
    const privateTies = privateStats?.private_ties || 0;

    const totalWins = rankedWins + privateWins;
    const totalLosses = rankedLosses + privateLosses;
    const totalTies = rankedTies + privateTies;

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        avatar_url: user.avatar_url || null,
        bio: user.bio,
        github_url: user.github_url,
        linkedin_url: user.linkedin_url,
        twitter_url: user.twitter_url,
        is_online: !!user.is_online,
        is_pro: isPro,
        last_seen: user.last_seen,
        created_at: user.created_at
      },
      stats: {
        wins: totalWins,
        losses: totalLosses,
        ties: totalTies,
        total_battles: totalWins + totalLosses + totalTies,
        ranked_wins: rankedWins,
        ranked_losses: rankedLosses,
        avg_solve_time: stats?.avg_solve_time || 0,
        fastest_solve: stats?.fastest_solve || null,
        win_streak: stats?.win_streak || 0,
        best_win_streak: stats?.best_win_streak || 0,
        rating: rating,
        rankTier: rankInfo.tier.name,
        rankDivision: rankInfo.division,
        rankDisplay: rankInfo.display,
        rankIcon: rankInfo.tier.icon,
        rankColor: rankInfo.tier.color,
        rankProgress: rankInfo.progress
      },
      battles
    });
  } catch (err) {
    next(err);
  }
});

// Get user stats by username
router.get('/:username/stats', async (req, res, next) => {
  try {
    const { username } = req.params;

    const user = await db.getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const stats = await db.getUserStats(user.id);
    const privateStats = await db.getPrivateBattleStats(user.id);
    const rating = stats?.rating || 1000;
    const rankInfo = elo.getRankDivision(rating);

    const rankedWins = stats?.wins || 0;
    const rankedLosses = stats?.losses || 0;
    const rankedTies = stats?.ties || 0;
    const privateWins = privateStats?.private_wins || 0;
    const privateLosses = privateStats?.private_losses || 0;
    const privateTies = privateStats?.private_ties || 0;

    const totalWins = rankedWins + privateWins;
    const totalLosses = rankedLosses + privateLosses;
    const totalTies = rankedTies + privateTies;

    res.json({
      success: true,
      stats: {
        wins: totalWins,
        losses: totalLosses,
        ties: totalTies,
        total_battles: totalWins + totalLosses + totalTies,
        ranked_wins: rankedWins,
        ranked_losses: rankedLosses,
        avg_solve_time: stats?.avg_solve_time || 0,
        fastest_solve: stats?.fastest_solve || null,
        win_streak: stats?.win_streak || 0,
        best_win_streak: stats?.best_win_streak || 0,
        rating: rating,
        rankTier: rankInfo.tier.name,
        rankDivision: rankInfo.division,
        rankDisplay: rankInfo.display,
        rankIcon: rankInfo.tier.icon,
        rankColor: rankInfo.tier.color,
        rankProgress: rankInfo.progress
      }
    });
  } catch (err) {
    next(err);
  }
});

// Get user battle history by username
router.get('/:username/battles', async (req, res, next) => {
  try {
    const { username } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50); // Bound: 1-50
    const offset = Math.max(parseInt(req.query.offset) || 0, 0); // Ensure non-negative

    const user = await db.getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const rows = await db.getUserBattleHistory(user.id, limit, offset);
    const totalBattles = await db.getUserBattleCount(user.id);
    // Battles store only the problem id; attach the title and difficulty for display.
    const battles = rows.map(battle => {
      const problem = problemsLoader.getById(battle.problem_id);
      return {
        ...battle,
        problem_title: problem ? problem.title : battle.problem_id,
        problem_difficulty: problem ? problem.difficulty : null
      };
    });

    res.json({
      success: true,
      battles,
      pagination: {
        total: totalBattles,
        limit,
        offset,
        hasMore: offset + battles.length < totalBattles
      }
    });
  } catch (err) {
    next(err);
  }
});

// Get battle detail by UUID (only viewable by participants)
router.get('/battles/:battleUuid', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { battleUuid } = req.params;

    const battle = await db.getBattleByUuid(battleUuid);
    if (!battle) {
      return res.status(404).json({ error: 'Battle not found' });
    }

    // Only participants can view battle details with code
    // Use == for comparison in case of type mismatch between JWT sub and DB integer
    const isParticipant = battle.winner_id == userId || battle.loser_id == userId;
    if (!isParticipant) {
      return res.status(403).json({ error: 'You can only view your own battles' });
    }

    // Get problem details
    const problem = problemsLoader.getByIdForFrontend(battle.problem_id);

    res.json({
      success: true,
      battle: {
        id: battle.id,
        uuid: battle.battle_uuid,
        problem_id: battle.problem_id,
        problem_title: problem?.title || battle.problem_id,
        problem_difficulty: problem?.difficulty || null,
        problem_category: problem?.category || null,
        problem_description: problem?.description || null,
        winner_id: battle.winner_id,
        loser_id: battle.loser_id,
        winner_username: battle.winner_username,
        loser_username: battle.loser_username,
        winner_avatar: battle.winner_avatar,
        loser_avatar: battle.loser_avatar,
        winner_time: battle.winner_time,
        loser_time: battle.loser_time,
        winner_language: battle.winner_language,
        loser_language: battle.loser_language,
        winner_code: battle.winner_code || null,
        loser_code: battle.loser_code || null,
        winner_rating_change: battle.winner_rating_change,
        loser_rating_change: battle.loser_rating_change,
        is_tie: !!battle.is_tie,
        is_forfeit: !!battle.is_forfeit,
        is_matchmade: !!battle.is_matchmade,
        is_partial_credit: !!battle.is_partial_credit,
        winner_tests_passed: battle.winner_tests_passed,
        loser_tests_passed: battle.loser_tests_passed,
        finished_at: battle.finished_at,
        created_at: battle.created_at
      }
    });
  } catch (err) {
    next(err);
  }
});

// Debug endpoint - check raw stats for a user
router.get('/:username/debug-stats', async (req, res, next) => {
  try {
    const { username } = req.params;

    const user = await db.getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get raw stats directly
    const rawStats = await db.getUserStats(user.id);
    const privateStats = await db.getPrivateBattleStats(user.id);

    // Get recent battles from history
    const recentBattles = await db.getUserBattleHistory(user.id, 10, 0);

    // Count matchmade vs private battles
    const matchmadeBattles = recentBattles.filter(b => b.is_matchmade === 1);
    const privateBattles = recentBattles.filter(b => b.is_matchmade === 0);

    res.json({
      success: true,
      userId: user.id,
      username: user.username,
      rawUserStats: rawStats || 'NO_STATS_RECORD',
      privateStats: privateStats || 'NO_PRIVATE_STATS',
      battleCounts: {
        total: recentBattles.length,
        matchmade: matchmadeBattles.length,
        private: privateBattles.length
      },
      recentBattles: recentBattles.map(b => ({
        id: b.id,
        is_matchmade: b.is_matchmade,
        winner_id: b.winner_id,
        loser_id: b.loser_id,
        created_at: b.created_at,
        winner_rating_change: b.winner_rating_change,
        loser_rating_change: b.loser_rating_change
      }))
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.invalidateLeaderboardCache = () => leaderboardCache.invalidate();
