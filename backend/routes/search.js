const express = require('express');
const logger = require('../utils/logger');
const db = require('../db');
const problemsLoader = require('../problemsLoader');

const router = express.Router();

/**
 * GET /api/search?q=term
 * Search across users, gallery games, and practice problems
 */
router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.json({ users: [], games: [], problems: [] });
    }

    const term = q.trim();
    const likeTerm = `%${term}%`;

    // Search users by username
    const users = await db.all(`
      SELECT u.id, u.username, u.avatar, COALESCE(s.rating, 1000) as rating
      FROM users u LEFT JOIN user_stats s ON u.id = s.user_id
      WHERE u.username LIKE ? AND u.is_banned = 0
      ORDER BY rating DESC
      LIMIT 5
    `, [likeTerm]);

    // Search published games
    const games = await db.all(`
      SELECT g.id, g.title, g.game_type, g.vote_score, g.play_count,
             u.username as creator_username
      FROM games g JOIN users u ON g.creator_id = u.id
      WHERE g.status = 'published' AND (g.title LIKE ? OR g.description LIKE ?)
      ORDER BY g.vote_score DESC
      LIMIT 5
    `, [likeTerm, likeTerm]);

    // Search practice problems
    const allProblems = problemsLoader.getAll ? problemsLoader.getAll() : [];
    const termLower = term.toLowerCase();
    const problems = allProblems
      .filter(p => p && (
        (p.title && p.title.toLowerCase().includes(termLower)) ||
        (p.id && p.id.toLowerCase().includes(termLower)) ||
        (p.category && p.category.toLowerCase().includes(termLower)) ||
        (p.difficulty && p.difficulty.toLowerCase().includes(termLower)) ||
        (p.description && p.description.toLowerCase().includes(termLower))
      ))
      .slice(0, 5)
      .map(p => ({ id: p.id, title: p.title, difficulty: p.difficulty, category: p.category }));

    res.json({ users, games, problems });
  } catch (err) {
    logger.error('[SEARCH] Error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
