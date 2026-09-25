const express = require('express');
const logger = require('../utils/logger');
const db = require('../db');
const authRouter = require('./auth');

const router = express.Router();
const authMiddleware = authRouter.authMiddleware;

// Get all conversations for current user
router.get('/conversations', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    logger.info('[MESSAGES API] Fetching conversations for userId:', userId);
    const conversations = await db.getUserConversations(userId, limit, offset);
    logger.info('[MESSAGES API] Found', conversations.length, 'conversations:', JSON.stringify(conversations.map(c => ({
      other_user_id: c.other_user_id,
      other_username: c.other_username,
      last_message: c.last_message_content?.substring(0, 20)
    }))));

    res.json({
      success: true,
      conversations
    });
  } catch (err) {
    logger.error('[MESSAGES API] Error fetching conversations:', err.message);
    next(err);
  }
});

// Get unread message count - MUST be before /:userId route
router.get('/unread/count', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const count = await db.getUnreadMessageCount(userId);

    res.json({
      success: true,
      count
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// GROUP CHAT ROUTES (must be before /:userId)
// ============================================

// Get all group conversations for current user
router.get('/groups', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const groups = await db.getGroupConversations(userId);

    res.json({
      success: true,
      groups
    });
  } catch (err) {
    next(err);
  }
});

// Create a new group
router.post('/groups', authMiddleware, async (req, res, next) => {
  try {
    const creatorId = req.user.sub;
    const { name, memberIds } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    if (name.length > 50) {
      return res.status(400).json({ error: 'Group name too long (max 50 characters)' });
    }

    // Validate memberIds array - must be friends with creator
    const validMemberIds = [];
    const notFriends = [];
    if (Array.isArray(memberIds)) {
      const candidateMembers = await db.getGroupMemberValidationDetails(creatorId, memberIds);
      for (const member of candidateMembers) {
        if (member.is_friend) {
          validMemberIds.push(member.id);
        } else {
          notFriends.push(member.username);
        }
      }
    }

    // Return error if any members are not friends
    if (notFriends.length > 0) {
      return res.status(400).json({
        error: `You can only add friends to group chats. Not friends with: ${notFriends.join(', ')}`
      });
    }

    // Limit to 10 members max (including creator)
    if (validMemberIds.length > 9) {
      return res.status(400).json({ error: 'Maximum 10 members per group' });
    }

    const group = await db.createGroupConversation(name.trim(), creatorId, validMemberIds);

    // Get full member list to return
    const members = await db.getGroupMembers(group.id);
    const groupPayload = {
      ...group,
      members,
      member_count: members.length
    };

    if (typeof global.emitToUser === 'function') {
      validMemberIds.forEach(memberId => {
        global.emitToUser(memberId, 'group-created', { group: groupPayload });
      });
    }

    res.json({
      success: true,
      group: groupPayload
    });
  } catch (err) {
    next(err);
  }
});

// Get a specific group with messages
router.get('/groups/:groupId', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const groupId = parseInt(req.params.groupId);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);

    if (isNaN(groupId) || groupId <= 0) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    // Check if user is a member
    const isMember = await db.isGroupMember(groupId, userId);
    if (!isMember) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    const group = await db.getGroupById(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const members = await db.getGroupMembers(groupId);
    const messages = await db.getGroupMessages(groupId, limit, 0, userId);

    res.json({
      success: true,
      group: {
        ...group,
        members
      },
      messages
    });
  } catch (err) {
    next(err);
  }
});

// Send a message to a group
router.post('/groups/:groupId/messages', authMiddleware, async (req, res, next) => {
  try {
    const senderId = req.user.sub;
    const groupId = parseInt(req.params.groupId);
    const { content } = req.body;

    if (isNaN(groupId) || groupId <= 0) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    if (content.length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
    }

    // Check if user is a member
    const isMember = await db.isGroupMember(groupId, senderId);
    if (!isMember) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    const message = await db.createGroupMessage(groupId, senderId, content.trim());

    // Get sender info
    const sender = await db.getUserById(senderId);

    res.json({
      success: true,
      message: {
        ...message,
        sender_username: sender.username,
        sender_avatar: sender.avatar,
        sender_avatar_url: sender.avatar_url
      }
    });
  } catch (err) {
    next(err);
  }
});

// Add a member to a group
router.post('/groups/:groupId/members', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const groupId = parseInt(req.params.groupId);
    const { memberId } = req.body;

    if (isNaN(groupId) || groupId <= 0) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    const newMemberId = parseInt(memberId);
    if (isNaN(newMemberId) || newMemberId <= 0) {
      return res.status(400).json({ error: 'Invalid member ID' });
    }

    // Check if user is admin
    const isAdmin = await db.isGroupAdmin(groupId, userId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only group admins can add members' });
    }

    // Check member count
    const members = await db.getGroupMembers(groupId);
    if (members.length >= 10) {
      return res.status(400).json({ error: 'Group is full (max 10 members)' });
    }

    // Verify user exists
    const newMember = await db.getUserById(newMemberId);
    if (!newMember) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify the admin is friends with the new member
    const isFriend = await db.areFriends(userId, newMemberId);
    if (!isFriend) {
      return res.status(400).json({ error: 'You can only add friends to group chats' });
    }

    const result = await db.addGroupMember(groupId, newMemberId);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    const group = await db.getGroupById(groupId);
    const updatedMembers = await db.getGroupMembers(groupId);
    const groupPayload = {
      ...group,
      members: updatedMembers,
      member_count: updatedMembers.length
    };

    if (typeof global.emitToUser === 'function') {
      global.emitToUser(newMemberId, 'group-created', { group: groupPayload });
    }

    res.json({
      success: true,
      member: {
        user_id: newMemberId,
        username: newMember.username,
        avatar: newMember.avatar,
        avatar_url: newMember.avatar_url,
        role: 'member'
      }
    });
  } catch (err) {
    next(err);
  }
});

// Remove a member from a group
router.delete('/groups/:groupId/members/:memberId', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const groupId = parseInt(req.params.groupId);
    const memberId = parseInt(req.params.memberId);

    if (isNaN(groupId) || groupId <= 0) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    if (isNaN(memberId) || memberId <= 0) {
      return res.status(400).json({ error: 'Invalid member ID' });
    }

    // Check if user is admin
    const isAdmin = await db.isGroupAdmin(groupId, userId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only group admins can remove members' });
    }

    // Can't remove yourself this way - use leave endpoint
    if (memberId === userId) {
      return res.status(400).json({ error: 'Use the leave endpoint to leave the group' });
    }

    await db.removeGroupMember(groupId, memberId);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Leave a group
router.delete('/groups/:groupId/leave', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const groupId = parseInt(req.params.groupId);

    if (isNaN(groupId) || groupId <= 0) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    // Check if user is a member
    const isMember = await db.isGroupMember(groupId, userId);
    if (!isMember) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    const result = await db.leaveGroup(groupId, userId);

    res.json({
      success: true,
      groupDeleted: result.groupDeleted || false
    });
  } catch (err) {
    next(err);
  }
});

// Update group name
router.put('/groups/:groupId', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const groupId = parseInt(req.params.groupId);
    const { name } = req.body;

    if (isNaN(groupId) || groupId <= 0) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    if (name.length > 50) {
      return res.status(400).json({ error: 'Group name too long (max 50 characters)' });
    }

    // Check if user is admin
    const isAdmin = await db.isGroupAdmin(groupId, userId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only group admins can update the group' });
    }

    await db.updateGroupName(groupId, name.trim());

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Delete group (creator only)
router.delete('/groups/:groupId', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const groupId = parseInt(req.params.groupId);

    if (isNaN(groupId) || groupId <= 0) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    await db.deleteGroup(groupId, userId);

    res.json({ success: true, message: 'Group deleted successfully' });
  } catch (err) {
    if (err.message === 'Group not found') {
      return res.status(404).json({ error: err.message });
    }
    if (err.message === 'Only the group creator can delete the group') {
      return res.status(403).json({ error: err.message });
    }
    next(err);
  }
});

// ============================================
// DIRECT MESSAGE ROUTES
// ============================================

// Get messages with a specific user
router.get('/:userId', authMiddleware, async (req, res, next) => {
  try {
    const currentUserId = req.user.sub;
    const otherUserId = parseInt(req.params.userId);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100); // Bound: 1-100
    const before = req.query.before; // Message ID for pagination

    if (isNaN(otherUserId) || otherUserId <= 0) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Get the other user's info
    const otherUser = await db.getUserById(otherUserId);
    if (!otherUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const beforeId = before ? parseInt(before) : null;
    const messages = await db.getConversationMessages(currentUserId, otherUserId, limit, 0, beforeId);

    res.json({
      success: true,
      user: {
        id: otherUser.id,
        username: otherUser.username,
        avatar: otherUser.avatar,
        avatar_url: otherUser.avatar_url || null,
        is_online: !!otherUser.is_online,
        last_seen: otherUser.last_seen
      },
      messages
    });
  } catch (err) {
    next(err);
  }
});

// Send a message (REST fallback)
router.post('/:userId', authMiddleware, async (req, res, next) => {
  try {
    const senderId = req.user.sub;
    const receiverId = parseInt(req.params.userId);
    const { content } = req.body;

    if (isNaN(receiverId) || receiverId <= 0) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    if (content.length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
    }

    // Check receiver exists
    const receiver = await db.getUserById(receiverId);
    if (!receiver) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Cannot message yourself
    if (senderId === receiverId) {
      return res.status(400).json({ error: 'Cannot send message to yourself' });
    }

    // Check if either user has blocked the other
    const isBlocked = await db.isBlockedEitherWay(senderId, receiverId);
    if (isBlocked) {
      return res.status(403).json({ error: 'Cannot send message to this user' });
    }

    const message = await db.createMessage(senderId, receiverId, content.trim());

    res.json({
      success: true,
      message
    });
  } catch (err) {
    next(err);
  }
});

// Edit a message (within 1 hour of sending)
router.put('/edit/:messageId', authMiddleware, async (req, res, next) => {
  try {
    const senderId = req.user.sub;
    const messageId = parseInt(req.params.messageId);
    const { content } = req.body;

    if (isNaN(messageId) || messageId <= 0) {
      return res.status(400).json({ error: 'Invalid message ID' });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    if (content.length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
    }

    const result = await db.updateMessage(messageId, senderId, content.trim());

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      message: result.message
    });
  } catch (err) {
    next(err);
  }
});

// Edit a group message (within 15 minutes of sending)
router.put('/groups/:groupId/messages/:messageId/edit', authMiddleware, async (req, res, next) => {
  try {
    const senderId = req.user.sub;
    const groupId = parseInt(req.params.groupId);
    const messageId = parseInt(req.params.messageId);
    const { content } = req.body;

    if (isNaN(groupId) || groupId <= 0) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    if (isNaN(messageId) || messageId <= 0) {
      return res.status(400).json({ error: 'Invalid message ID' });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    if (content.length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
    }

    // Check if user is a member of the group
    const isMember = await db.isGroupMember(groupId, senderId);
    if (!isMember) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    const result = await db.updateGroupMessage(messageId, senderId, content.trim(), groupId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      message: result.message
    });
  } catch (err) {
    next(err);
  }
});

// Mark messages as read
router.put('/:userId/read', authMiddleware, async (req, res, next) => {
  try {
    const currentUserId = req.user.sub;
    const otherUserId = parseInt(req.params.userId);

    if (isNaN(otherUserId) || otherUserId <= 0) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    await db.markMessagesAsRead(currentUserId, otherUserId);

    res.json({
      success: true
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
