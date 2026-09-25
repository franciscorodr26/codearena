const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();
const db = require('../db');
const activityService = require('../services/activityService');

// Import auth middleware from auth routes
const { authMiddleware } = require('./auth');

// Rate limiting for friend requests (max 10 requests per minute per user)
const friendRequestLimits = new Map();
const FRIEND_REQUEST_LIMIT = 10;
const FRIEND_REQUEST_WINDOW = 60 * 1000; // 1 minute

function checkFriendRequestRateLimit(userId) {
  const now = Date.now();
  const userLimits = friendRequestLimits.get(userId);

  if (!userLimits || now - userLimits.windowStart > FRIEND_REQUEST_WINDOW) {
    friendRequestLimits.set(userId, { windowStart: now, count: 1 });
    return { allowed: true };
  }

  if (userLimits.count >= FRIEND_REQUEST_LIMIT) {
    const retryAfter = Math.ceil((userLimits.windowStart + FRIEND_REQUEST_WINDOW - now) / 1000);
    return { allowed: false, retryAfter };
  }

  userLimits.count++;
  return { allowed: true };
}

// Clean up old rate limit entries every 5 minutes
const rateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [userId, limits] of friendRequestLimits) {
    if (now - limits.windowStart > FRIEND_REQUEST_WINDOW * 2) {
      friendRequestLimits.delete(userId);
    }
  }
}, 5 * 60 * 1000);

// Export cleanup function for graceful shutdown
function cleanupFriendsInterval() {
  if (rateLimitCleanupInterval) {
    clearInterval(rateLimitCleanupInterval);
    logger.info('[FRIENDS] Rate limit cleanup interval cleared');
  }
}

// ============================================
// FRIENDS LIST
// ============================================

// GET /api/friends - Get user's friends list
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const friends = await db.getUserFriends(userId, limit, offset);
    const total = await db.getFriendCount(userId);

    res.json({
      friends,
      total,
      limit,
      offset
    });
  } catch (error) {
    logger.error('Error fetching friends:', error);
    res.status(500).json({ error: 'Failed to fetch friends' });
  }
});

// ============================================
// FRIEND REQUESTS
// ============================================

// GET /api/friends/requests/incoming - Get pending incoming friend requests
router.get('/requests/incoming', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const requests = await db.getPendingFriendRequests(userId);

    res.json({ requests });
  } catch (error) {
    logger.error('Error fetching incoming friend requests:', error);
    res.status(500).json({ error: 'Failed to fetch friend requests' });
  }
});

// GET /api/friends/requests/outgoing - Get pending outgoing friend requests
router.get('/requests/outgoing', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const requests = await db.getSentFriendRequests(userId);

    res.json({ requests });
  } catch (error) {
    logger.error('Error fetching outgoing friend requests:', error);
    res.status(500).json({ error: 'Failed to fetch friend requests' });
  }
});

// GET /api/friends/requests/count - Get pending friend request count
router.get('/requests/count', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const count = await db.getPendingFriendRequestCount(userId);

    res.json({ count });
  } catch (error) {
    logger.error('Error fetching friend request count:', error);
    res.status(500).json({ error: 'Failed to fetch count' });
  }
});

// POST /api/friends/request/:userId - Send friend request
router.post('/request/:userId', authMiddleware, async (req, res) => {
  try {
    const requesterId = req.user.sub;
    const requestedId = parseInt(req.params.userId);

    // Rate limit check
    const rateCheck = checkFriendRequestRateLimit(requesterId);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: 'Too many friend requests. Please slow down.',
        retryAfter: rateCheck.retryAfter
      });
    }

    if (isNaN(requestedId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    if (requesterId === requestedId) {
      return res.status(400).json({ error: 'Cannot send friend request to yourself' });
    }

    // Check if target user exists
    const targetUser = await db.getUserById(requestedId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if either user has blocked the other
    const isBlocked = await db.isBlockedEitherWay(requesterId, requestedId);
    if (isBlocked) {
      return res.status(403).json({ error: 'Cannot send friend request to this user' });
    }

    const request = await db.sendFriendRequest(requesterId, requestedId);

    res.json({
      success: true,
      request,
      message: 'Friend request sent'
    });
  } catch (error) {
    logger.error('Error sending friend request:', error);
    res.status(400).json({ error: error.message || 'Failed to send friend request' });
  }
});

// POST /api/friends/accept/:requestId - Accept friend request
router.post('/accept/:requestId', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const requestId = parseInt(req.params.requestId);

    if (isNaN(requestId)) {
      return res.status(400).json({ error: 'Invalid request ID' });
    }

    // Get the request to know who sent it
    const request = await db.getFriendRequestById(requestId);
    const result = await db.acceptFriendRequest(requestId, userId);

    // Record activity for both users becoming friends
    if (request) {
      try {
        const user1 = await db.getUserById(request.requester_id);
        const user2 = await db.getUserById(userId);
        if (user1 && user2) {
          await activityService.recordFriendAdded(
            request.requester_id,
            userId,
            user1.username,
            user2.username
          );
        }
      } catch (err) {
        logger.error('Activity recording failed:', err);
      }
    }

    res.json({
      success: true,
      ...result,
      message: 'Friend request accepted'
    });
  } catch (error) {
    logger.error('Error accepting friend request:', error);
    res.status(400).json({ error: error.message || 'Failed to accept friend request' });
  }
});

// POST /api/friends/decline/:requestId - Decline friend request
router.post('/decline/:requestId', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const requestId = parseInt(req.params.requestId);

    if (isNaN(requestId)) {
      return res.status(400).json({ error: 'Invalid request ID' });
    }

    const result = await db.declineFriendRequest(requestId, userId);

    res.json({
      success: true,
      ...result,
      message: 'Friend request declined'
    });
  } catch (error) {
    logger.error('Error declining friend request:', error);
    res.status(400).json({ error: error.message || 'Failed to decline friend request' });
  }
});

// POST /api/friends/cancel/:requestId - Cancel sent friend request
router.post('/cancel/:requestId', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const requestId = parseInt(req.params.requestId);

    if (isNaN(requestId)) {
      return res.status(400).json({ error: 'Invalid request ID' });
    }

    const result = await db.cancelFriendRequest(requestId, userId);

    res.json({
      success: true,
      ...result,
      message: 'Friend request cancelled'
    });
  } catch (error) {
    logger.error('Error cancelling friend request:', error);
    res.status(400).json({ error: error.message || 'Failed to cancel friend request' });
  }
});

// ============================================
// FRIENDSHIP MANAGEMENT
// ============================================

// DELETE /api/friends/:userId - Remove friend
router.delete('/:userId', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const friendId = parseInt(req.params.userId);

    if (isNaN(friendId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    await db.removeFriend(userId, friendId);

    res.json({
      success: true,
      message: 'Friend removed'
    });
  } catch (error) {
    logger.error('Error removing friend:', error);
    res.status(400).json({ error: error.message || 'Failed to remove friend' });
  }
});

// GET /api/friends/status/:userId - Get friendship status with a user
router.get('/status/:userId', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const otherUserId = parseInt(req.params.userId);

    if (isNaN(otherUserId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    if (userId === otherUserId) {
      return res.json({ status: 'self' });
    }

    const status = await db.getFriendshipStatus(userId, otherUserId);

    // If there's a pending request, also return the request ID
    let requestId = null;
    if (status === 'pending_sent' || status === 'pending_received') {
      const request = await db.getFriendRequestBetweenUsers(userId, otherUserId);
      requestId = request?.id;
    }

    res.json({ status, requestId });
  } catch (error) {
    logger.error('Error getting friendship status:', error);
    res.status(500).json({ error: 'Failed to get friendship status' });
  }
});

module.exports = router;
module.exports.cleanupFriendsInterval = cleanupFriendsInterval;
