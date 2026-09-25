const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const db = require('../db');
const authRouter = require('./auth');
const { sendReportNotification } = require('../services/email');
const { Analytics } = require('../analytics');
const { chains } = require('../middleware/validation');
const { BACKEND_URL } = require('../config/appUrls');

// Magic bytes for image validation (prevents MIME spoofing)
const IMAGE_MAGIC_BYTES = {
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]]
};

// Verify file magic bytes match declared MIME type
function verifyImageMagicBytes(filePath, declaredMimeType) {
  try {
    const buffer = Buffer.alloc(12);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 12, 0);
    fs.closeSync(fd);

    const signatures = IMAGE_MAGIC_BYTES[declaredMimeType];
    if (!signatures) return false;

    return signatures.some(sig => {
      for (let i = 0; i < sig.length; i++) {
        if (buffer[i] !== sig[i]) return false;
      }
      return true;
    });
  } catch (err) {
    logger.error('[MODERATION] Error verifying magic bytes:', err);
    return false;
  }
}

// Configure multer for report screenshot uploads
const uploadsDir = path.join(__dirname, '../uploads/reports');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'));
    }
  }
});

// Create analytics instance for moderation tracking
const analytics = new Analytics();

const router = express.Router();
const authMiddleware = authRouter.authMiddleware;

// Rate limiter for report/block actions (prevent spam abuse)
const moderationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 reports/blocks per 15 minutes
  message: { error: 'Too many moderation actions. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub || ipKeyGenerator(req.ip),
});

// Stricter rate limiter for sensitive admin actions (ban/unban)
const adminActionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 ban/unban actions per hour
  message: { error: 'Too many admin actions. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub || ipKeyGenerator(req.ip),
});

// Middleware to check if user is admin
// SECURITY: Only uses database is_admin flag - email-based bypass removed to prevent
// attackers from registering with admin emails to gain unauthorized access
const adminMiddleware = async (req, res, next) => {
  try {
    const user = await db.getUserById(req.user.sub);
    if (!user) {
      return res.status(403).json({ error: 'User not found' });
    }

    // Only allow users with is_admin flag set in database
    if (user.is_admin === 1) {
      return next();
    }

    return res.status(403).json({ error: 'Admin access required' });
  } catch (err) {
    next(err);
  }
};

// Report reasons
const REPORT_REASONS = [
  'harassment',
  'spam',
  'cheating',
  'inappropriate_content',
  'impersonation',
  'other'
];

// ============================================
// USER REPORTS (any authenticated user)
// ============================================

// Report a user
router.post('/report', authMiddleware, moderationLimiter, chains.report, async (req, res, next) => {
  try {
    const reporterId = req.user.sub;
    const { userId, reason, description, screenshots } = req.body;

    if (!userId || !reason) {
      return res.status(400).json({ error: 'User ID and reason are required' });
    }

    if (!REPORT_REASONS.includes(reason)) {
      return res.status(400).json({ error: 'Invalid report reason', validReasons: REPORT_REASONS });
    }

    // Can't report yourself
    if (reporterId === userId) {
      return res.status(400).json({ error: 'Cannot report yourself' });
    }

    // Validate screenshots if provided
    let screenshotUrls = null;
    if (screenshots && Array.isArray(screenshots) && screenshots.length > 0) {
      if (screenshots.length > 3) {
        return res.status(400).json({ error: 'Maximum 3 screenshots allowed' });
      }
      screenshotUrls = JSON.stringify(screenshots);
    }

    // Check if user exists
    const targetUser = await db.getUserById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if already reported (pending)
    const alreadyReported = await db.hasUserReported(reporterId, userId);
    if (alreadyReported) {
      return res.status(400).json({ error: 'You have already reported this user' });
    }

    const report = await db.createUserReport(reporterId, userId, reason, description, screenshotUrls);

    // Send email notification to support
    const reporter = await db.getUserById(reporterId);
    sendReportNotification({
      reportId: report.id,
      reporterUsername: reporter.username,
      reportedUsername: targetUser.username,
      reportedUserId: userId,
      reason,
      description
    }).catch(err => {
      logger.error('[MODERATION] Failed to send report notification email:', err);
    });

    // Track report in analytics
    analytics.trackEvent('user-reported', reporterId, {
      reportId: report.id,
      reportedUserId: userId,
      reason
    });

    res.json({
      success: true,
      message: 'Report submitted successfully',
      reportId: report.id
    });
  } catch (err) {
    next(err);
  }
});

// Get report reasons (for UI dropdown)
router.get('/report-reasons', (req, res) => {
  res.json({
    success: true,
    reasons: REPORT_REASONS.map(r => ({
      value: r,
      label: r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    }))
  });
});

// Upload screenshots for report (max 3 images)
router.post('/report/upload', authMiddleware, moderationLimiter, upload.array('screenshots', 3), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded', success: false });
    }

    // Verify magic bytes for each uploaded file
    const validFiles = [];
    const invalidFiles = [];

    for (const file of req.files) {
      if (verifyImageMagicBytes(file.path, file.mimetype)) {
        validFiles.push(file);
      } else {
        invalidFiles.push(file);
        try {
          fs.unlinkSync(file.path);
          logger.warn(`[MODERATION] Rejected file with invalid magic bytes: ${file.originalname}`);
        } catch (unlinkErr) {
          logger.error('[MODERATION] Failed to delete invalid file:', unlinkErr);
        }
      }
    }

    if (validFiles.length === 0) {
      return res.status(400).json({
        error: 'No valid image files uploaded. Files must be actual JPEG, PNG, GIF, or WebP images.',
        success: false
      });
    }

    // Return the URLs for the valid uploaded files
    const baseUrl = BACKEND_URL;
    const urls = validFiles.map(file => `${baseUrl}/uploads/reports/${file.filename}`);

    logger.info(`[MODERATION] ${validFiles.length} screenshot(s) uploaded for report` +
      (invalidFiles.length > 0 ? `, ${invalidFiles.length} rejected` : ''));

    res.json({
      success: true,
      urls,
      rejected: invalidFiles.length
    });
  } catch (err) {
    logger.error('[MODERATION] Error uploading screenshots:', err);
    res.status(500).json({ error: 'Failed to upload screenshots', success: false });
  }
});

// ============================================
// USER BLOCKING (any authenticated user)
// ============================================

// Block a user
router.post('/block', authMiddleware, moderationLimiter, async (req, res, next) => {
  try {
    const blockerId = req.user.sub;
    // Parse to an integer so the self-block guard can't be bypassed by sending a string
    // (5 === "5" is false) and so the stored blocked_id is numeric (string ids make later
    // isBlockedEitherWay(int,int) checks miss the row under SQLite's loose typing).
    const userId = parseInt(req.body.userId, 10);

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (blockerId === userId) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }

    const targetUser = await db.getUserById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    await db.blockUser(blockerId, userId);

    // Also remove friendship if exists
    const areFriends = await db.areFriends(blockerId, userId);
    if (areFriends) {
      await db.removeFriend(blockerId, userId);
    }

    // Track block in analytics
    analytics.trackEvent('user-blocked', blockerId, {
      blockedUserId: userId,
      hadFriendship: areFriends
    });

    res.json({
      success: true,
      message: 'User blocked successfully'
    });
  } catch (err) {
    next(err);
  }
});

// Unblock a user
router.delete('/block/:userId', authMiddleware, async (req, res, next) => {
  try {
    const blockerId = req.user.sub;
    const userId = parseInt(req.params.userId);

    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    await db.unblockUser(blockerId, userId);

    // Track unblock in analytics
    analytics.trackEvent('user-unblocked', blockerId, {
      unblockedUserId: userId
    });

    res.json({
      success: true,
      message: 'User unblocked successfully'
    });
  } catch (err) {
    next(err);
  }
});

// Get blocked users list
router.get('/blocked', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const blockedUsers = await db.getBlockedUsers(userId);

    res.json({
      success: true,
      blockedUsers
    });
  } catch (err) {
    next(err);
  }
});

// Check if a user is blocked
router.get('/blocked/:userId', authMiddleware, async (req, res, next) => {
  try {
    const blockerId = req.user.sub;
    const userId = parseInt(req.params.userId);

    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const isBlocked = await db.isUserBlocked(blockerId, userId);

    res.json({
      success: true,
      isBlocked
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// ADMIN ROUTES
// ============================================

// Get all reports (admin only)
router.get('/admin/reports', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { status } = req.query;
    const reports = await db.getUserReports(status || null);

    res.json({
      success: true,
      reports
    });
  } catch (err) {
    next(err);
  }
});

// Get single report details (admin only)
router.get('/admin/reports/:reportId', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const reportId = parseInt(req.params.reportId);
    if (isNaN(reportId)) {
      return res.status(400).json({ error: 'Invalid report ID' });
    }

    const report = await db.getReportById(reportId);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Get additional context
    const reportCount = await db.getReportCountForUser(report.reported_user_id);
    const banHistory = await db.getUserBanHistory(report.reported_user_id);

    res.json({
      success: true,
      report,
      context: {
        totalReportsAgainstUser: reportCount,
        banHistory
      }
    });
  } catch (err) {
    next(err);
  }
});

// Helper to get client IP from request
const getClientIp = (req) => {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.connection?.remoteAddress ||
         req.ip;
};

// Review a report (admin only)
router.put('/admin/reports/:reportId', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const adminId = req.user.sub;
    const reportId = parseInt(req.params.reportId);
    const { status, resolution } = req.body;

    if (isNaN(reportId)) {
      return res.status(400).json({ error: 'Invalid report ID' });
    }

    if (!['reviewed', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const report = await db.getReportById(reportId);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    await db.updateReportStatus(reportId, status, adminId, resolution);

    // Audit log: report reviewed
    await db.logAdminAction(adminId, 'review_report', {
      targetType: 'report',
      targetId: reportId,
      details: { status, resolution, reportedUserId: report.reported_user_id },
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent']
    });

    res.json({
      success: true,
      message: 'Report updated successfully'
    });
  } catch (err) {
    next(err);
  }
});

// Ban a user (admin only)
router.post('/admin/ban', authMiddleware, adminMiddleware, adminActionLimiter, async (req, res, next) => {
  try {
    const adminId = req.user.sub;
    const { userId, reason, duration, isPermanent } = req.body;

    if (!userId || !reason) {
      return res.status(400).json({ error: 'User ID and reason are required' });
    }

    const targetUser = await db.getUserById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if target is also admin
    const targetIsAdmin = await db.isUserAdmin(userId);
    if (targetIsAdmin) {
      return res.status(400).json({ error: 'Cannot ban an admin' });
    }

    let expiresAt = null;
    if (!isPermanent && duration) {
      // Duration in hours
      expiresAt = new Date(Date.now() + duration * 60 * 60 * 1000).toISOString();
    }

    await db.banUser(userId, adminId, reason, expiresAt, isPermanent);

    // Audit log: user banned
    await db.logAdminAction(adminId, 'ban_user', {
      targetType: 'user',
      targetId: userId,
      details: { username: targetUser.username, reason, duration, isPermanent, expiresAt },
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent']
    });

    logger.warn(`[ADMIN] User ${targetUser.username} (ID: ${userId}) banned by admin ${adminId}. Reason: ${reason}`);

    res.json({
      success: true,
      message: `User ${targetUser.username} has been banned`
    });
  } catch (err) {
    next(err);
  }
});

// Unban a user (admin only)
router.post('/admin/unban', authMiddleware, adminMiddleware, adminActionLimiter, async (req, res, next) => {
  try {
    const adminId = req.user.sub;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const targetUser = await db.getUserById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    await db.unbanUser(userId);

    // Audit log: user unbanned
    await db.logAdminAction(adminId, 'unban_user', {
      targetType: 'user',
      targetId: userId,
      details: { username: targetUser.username },
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent']
    });

    logger.info(`[ADMIN] User ${targetUser.username} (ID: ${userId}) unbanned by admin ${adminId}`);

    res.json({
      success: true,
      message: `User ${targetUser.username} has been unbanned`
    });
  } catch (err) {
    next(err);
  }
});

// Get admin dashboard stats (admin only)
router.get('/admin/stats', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const stats = await db.getAdminStats();

    res.json({
      success: true,
      stats
    });
  } catch (err) {
    next(err);
  }
});

// Get user details for admin (admin only)
router.get('/admin/users/:userId', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const user = await db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const reports = await db.getReportsForUser(userId);
    const banHistory = await db.getUserBanHistory(userId);
    const isBanned = await db.isUserBanned(userId);

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        created_at: user.created_at,
        is_banned: !!user.is_banned,
        is_admin: !!user.is_admin
      },
      reports,
      banHistory,
      currentBan: isBanned || null
    });
  } catch (err) {
    next(err);
  }
});

// Get recent users (admin only)
router.get('/admin/users/recent', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const users = await db.getRecentUsers(limit);
    res.json({ success: true, users });
  } catch (err) {
    next(err);
  }
});

// Get all users for admin (with sorting options)
router.get('/admin/users', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const filters = {
      proOnly: req.query.proOnly === 'true',
      bannedOnly: req.query.bannedOnly === 'true',
      sortBy: req.query.sortBy || 'rating_desc'
    };
    const users = await db.getAllUsersForAdmin(limit, filters);
    res.json({ success: true, users });
  } catch (err) {
    next(err);
  }
});

const PRO_GRANT_PLANS = {
  monthly: { label: 'Monthly', months: 1 },
  three_month: { label: '3-month', months: 3 },
  annual: { label: 'Annual', years: 1 }
};

// Activate Pro for a user (admin only)
router.post('/admin/users/:userId/activate-pro', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId);
    const { plan = 'monthly' } = req.body; // 'monthly', 'three_month', or 'annual'

    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const grantPlan = PRO_GRANT_PLANS[plan];
    if (!grantPlan) {
      return res.status(400).json({ error: 'Invalid Pro plan' });
    }

    const user = await db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const now = new Date();
    const currentExpiry = user.pro_expires_at ? new Date(user.pro_expires_at) : null;
    const baseDate = currentExpiry && !Number.isNaN(currentExpiry.getTime()) && currentExpiry > now
      ? currentExpiry
      : now;
    const expiresAt = new Date(baseDate.getTime());

    if (grantPlan.years) {
      expiresAt.setFullYear(expiresAt.getFullYear() + grantPlan.years);
    }
    if (grantPlan.months) {
      expiresAt.setMonth(expiresAt.getMonth() + grantPlan.months);
    }

    await db.setUserProStatus(userId, true, expiresAt.toISOString());

    res.json({
      success: true,
      message: `${grantPlan.label} Pro granted for ${user.username} until ${expiresAt.toLocaleDateString()}`,
      expiresAt: expiresAt.toISOString()
    });
  } catch (err) {
    next(err);
  }
});

// Deactivate Pro for a user (admin only)
router.post('/admin/users/:userId/deactivate-pro', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId);

    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const user = await db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await db.setUserProStatus(userId, false);

    res.json({
      success: true,
      message: `Pro deactivated for ${user.username}`
    });
  } catch (err) {
    next(err);
  }
});

// Delete a user (admin only)
router.delete('/admin/users/:userId', authMiddleware, adminMiddleware, adminActionLimiter, async (req, res, next) => {
  try {
    const adminId = req.user.sub;
    const userId = parseInt(req.params.userId);

    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Can't delete yourself
    if (adminId === userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const targetUser = await db.getUserById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if target is also admin
    const targetIsAdmin = await db.isUserAdmin(userId);
    if (targetIsAdmin) {
      return res.status(400).json({ error: 'Cannot delete an admin account' });
    }

    // Delete the user
    await db.deleteUserAccount(userId);

    // Audit log: user deleted
    await db.logAdminAction(adminId, 'delete_user', {
      targetType: 'user',
      targetId: userId,
      details: { username: targetUser.username, email: targetUser.email },
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent']
    });

    logger.warn(`[ADMIN] User ${targetUser.username} (ID: ${userId}) DELETED by admin ${adminId}`);

    res.json({
      success: true,
      message: `User ${targetUser.username} has been permanently deleted`
    });
  } catch (err) {
    next(err);
  }
});

// Reset all reports (admin only - for fresh launch)
router.delete('/admin/reports/all', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const adminId = req.user.sub;

    // Clear all reports
    await db.run('DELETE FROM user_reports');

    // Audit log
    await db.logAdminAction(adminId, 'reset_all_reports', {
      details: { action: 'Cleared all reports for fresh launch' },
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent']
    });

    logger.warn(`[ADMIN] All reports cleared by admin ${adminId}`);

    res.json({ success: true, message: 'All reports have been cleared' });
  } catch (err) {
    next(err);
  }
});

// Get admin audit log (admin only - for security review)
router.get('/admin/audit-log', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const auditLog = await db.getAdminAuditLog(limit, offset);

    // Log that audit log was viewed (for accountability)
    await db.logAdminAction(req.user.sub, 'view_audit_log', {
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent']
    });

    res.json({
      success: true,
      auditLog
    });
  } catch (err) {
    next(err);
  }
});

// Adjust a user's ELO rating (admin key auth)
router.post('/admin/adjust-rating', async (req, res, next) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { username, delta } = req.body;
    if (!username || typeof delta !== 'number') {
      return res.status(400).json({ error: 'username and numeric delta required' });
    }
    const user = await db.getUserByUsername(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const updated = await db.adjustUserRating(user.id, delta);

    res.json({ success: true, username, newRating: updated.rating });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
