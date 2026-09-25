const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const logger = require('../utils/logger');
const { SECRET } = require('../config/jwt');

// ============================================
// MIDDLEWARE
// ============================================

// Optional auth middleware - extracts user if token present, but doesn't require it
const optionalAuthMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, SECRET);
      req.user = decoded;
    } catch (err) {
      // Invalid token, but continue without user
    }
  }
  next();
};

// Required auth middleware
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Admin middleware
const adminMiddleware = async (req, res, next) => {
  try {
    const user = await db.getUserById(req.user.sub);
    if (!user) {
      return res.status(403).json({ error: 'User not found' });
    }

    if (user.is_admin === 1) {
      return next();
    }

    return res.status(403).json({ error: 'Admin access required' });
  } catch (err) {
    next(err);
  }
};

// ============================================
// PUBLIC ROUTES
// ============================================

// Submit a feature request (anyone can submit, logged-in users auto-fill info)
// Rate limited to 5 requests per 24h per IP/user
router.post('/', optionalAuthMiddleware, async (req, res) => {
  try {
    const { title, description, email, category, priority } = req.body;

    // Rate limiting: 5 feature requests per day per user/IP
    const userId = req.user?.sub || null;
    const submitterIp = req.ip;
    const todayCount = await db.getFeatureRequestCountToday(userId, submitterIp);
    if (todayCount >= 5) {
      return res.status(429).json({
        error: 'Daily limit reached. You can submit up to 5 feature requests per day.',
        success: false
      });
    }

    // Validate required fields
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required', success: false });
    }

    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Description is required', success: false });
    }

    if (title.length > 200) {
      return res.status(400).json({ error: 'Title must be 200 characters or less', success: false });
    }

    if (description.length > 5000) {
      return res.status(400).json({ error: 'Description must be 5000 characters or less', success: false });
    }

    // Validate category if provided
    const validCategories = ['practice', 'battles', 'ui', 'social', 'creator', 'other'];
    const normalizedCategory = category ? category.toLowerCase() : category;
    if (normalizedCategory && !validCategories.includes(normalizedCategory)) {
      return res.status(400).json({ error: 'Invalid category', success: false });
    }

    // Validate priority if provided
    const validPriorities = ['low', 'medium', 'high'];
    if (priority && !validPriorities.includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority', success: false });
    }

    // Get user info if logged in
    let username = null;
    let userEmail = email || null;

    if (req.user) {
      username = req.user.username;
      if (!userEmail) {
        userEmail = req.user.email;
      }
    }

    // Validate email format if provided
    if (userEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
      return res.status(400).json({ error: 'Invalid email format', success: false });
    }

    // Save feature request
    const requestId = uuidv4();
    await db.createFeatureRequest({
      id: requestId,
      userId,
      username,
      email: userEmail,
      title: title.trim(),
      description: description.trim(),
      category: normalizedCategory || 'other',
      priority: priority || 'medium',
      submitterIp: req.ip
    });

    logger.info(`[FEATURE REQUEST] New request submitted: ${requestId} by ${username || 'anonymous'}`);

    res.json({
      success: true,
      message: 'Feature request submitted successfully. Thank you for your feedback!',
      requestId
    });

  } catch (err) {
    logger.error('[FEATURE REQUEST] Error submitting request:', err);
    res.status(500).json({ error: 'Failed to submit feature request', success: false });
  }
});

// ============================================
// ADMIN ROUTES
// ============================================

// Get all feature requests (admin only)
router.get('/admin', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status, category } = req.query;
    const requests = await db.getFeatureRequests({ status: status || null, category: category || null });
    const counts = await db.getFeatureRequestCounts();

    res.json({
      success: true,
      featureRequests: requests,
      newCount: counts.new || 0,
      counts
    });
  } catch (err) {
    logger.error('[FEATURE REQUEST] Error fetching requests:', err);
    res.status(500).json({ error: 'Failed to fetch feature requests', success: false });
  }
});

// Get feature request counts (admin only)
router.get('/admin/count', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const counts = await db.getFeatureRequestCounts();

    res.json({
      success: true,
      ...counts
    });
  } catch (err) {
    logger.error('[FEATURE REQUEST] Error fetching counts:', err);
    res.status(500).json({ error: 'Failed to fetch counts', success: false });
  }
});

// Update feature request (admin only)
router.put('/admin/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes, priority } = req.body;

    const validStatuses = ['new', 'planned', 'in_progress', 'completed', 'declined'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status', success: false });
    }

    const validPriorities = ['low', 'medium', 'high'];
    if (priority && !validPriorities.includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority', success: false });
    }

    const request = await db.getFeatureRequestById(id);
    if (!request) {
      return res.status(404).json({ error: 'Feature request not found', success: false });
    }

    await db.updateFeatureRequest(id, { status, adminNotes, priority });

    logger.info(`[FEATURE REQUEST] Request ${id} updated by admin ${req.user.sub}`);

    res.json({
      success: true,
      message: 'Feature request updated successfully'
    });
  } catch (err) {
    logger.error('[FEATURE REQUEST] Error updating request:', err);
    res.status(500).json({ error: 'Failed to update feature request', success: false });
  }
});

// Delete feature request (admin only)
router.delete('/admin/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const request = await db.getFeatureRequestById(id);
    if (!request) {
      return res.status(404).json({ error: 'Feature request not found', success: false });
    }

    await db.deleteFeatureRequest(id);

    logger.info(`[FEATURE REQUEST] Request ${id} deleted by admin ${req.user.sub}`);

    res.json({
      success: true,
      message: 'Feature request deleted successfully'
    });
  } catch (err) {
    logger.error('[FEATURE REQUEST] Error deleting request:', err);
    res.status(500).json({ error: 'Failed to delete feature request', success: false });
  }
});

module.exports = router;
