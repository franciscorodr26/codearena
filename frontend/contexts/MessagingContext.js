import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { config } from '../config/env';
import { useAuth } from './AuthContext';
import { fetchWithTimeout } from '../utils/fetch';

const MessagingContext = createContext(null);

function mergeReactionUpdate(currentReactions = [], update, currentUserId) {
  const existingByEmoji = new Map(currentReactions.map(reaction => [reaction.emoji, reaction]));
  const updateUserId = Number(update?.userId);
  const viewerUserId = Number(currentUserId);

  return (update?.reactions || []).map(reaction => {
    const existing = existingByEmoji.get(reaction.emoji);
    const actorIsViewer = updateUserId && viewerUserId && updateUserId === viewerUserId && update.emoji === reaction.emoji;
    return {
      ...reaction,
      reacted_by_me: actorIsViewer ? update.action === 'added' : !!existing?.reacted_by_me
    };
  });
}

export function MessagingProvider({ children }) {
  const { token, user } = useAuth();

  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [typingUsers, setTypingUsers] = useState(new Set());
  const typingTimeoutRef = useRef(null);

  // Group chat state
  const [groupConversations, setGroupConversations] = useState([]);
  const [activeGroupChat, setActiveGroupChat] = useState(null);
  const [groupMessages, setGroupMessages] = useState([]);
  const [groupTypingUsers, setGroupTypingUsers] = useState(new Map()); // Map of groupId -> Set of userIds

  // Refs to track current values for socket handlers (avoid stale closures)
  const activeChatRef = useRef(null);
  const activeGroupChatRef = useRef(null);
  const userRef = useRef(null);
  const socketRef = useRef(null);
  // A single sequence covers both DM and group selection. Responses from a
  // previous selection must never replace the thread the user chose next.
  const chatRequestRef = useRef(0);
  const sessionRef = useRef(0);

  // Keep refs in sync with state
  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    activeGroupChatRef.current = activeGroupChat;
  }, [activeGroupChat]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  // Connect to socket when authenticated
  useEffect(() => {
    // Messaging lives above individual pages. Clear every account-owned value
    // when credentials change, including direct account switches without logout.
    sessionRef.current += 1;
    chatRequestRef.current += 1;
    activeChatRef.current = null;
    activeGroupChatRef.current = null;
    setActiveChat(null);
    setMessages([]);
    setConversations([]);
    setUnreadCount(0);
    setTypingUsers(new Set());
    setActiveGroupChat(null);
    setGroupMessages([]);
    setGroupConversations([]);
    setGroupTypingUsers(new Map());
    setConnected(false);
    if (!token || !user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        setSocket(null);
        setConnected(false);
      }
      return;
    }

    const newSocket = io(config.backend_url, {
      transports: ['websocket', 'polling'],
      auth: { token }
    });

    newSocket.on('connect', () => {
      newSocket.emit('auth-for-messaging', { token });
    });

    newSocket.on('auth-success', () => {
      setConnected(true);
    });

    newSocket.on('auth-error', (data) => {
      console.error('Messaging auth error:', data.error);
      setConnected(false);
    });

    newSocket.on('new-message', ({ message }) => {
      const currentActiveChat = activeChatRef.current;
      const currentUser = userRef.current;

      // Add to messages if it's from/to active chat (with duplicate check)
      if (currentActiveChat && (message.sender_id === currentActiveChat.id || message.receiver_id === currentActiveChat.id)) {
        setMessages(prev => {
          // Avoid duplicates
          if (prev.some(m => m.id === message.id)) return prev;
          return [...prev, message];
        });
      }

      // Update conversations list
      setConversations(prev => {
        const updated = [...prev];
        const otherUserId = message.sender_id === currentUser?.id ? message.receiver_id : message.sender_id;
        const idx = updated.findIndex(c => c.other_user_id === otherUserId);

        if (idx >= 0) {
          // Update existing conversation
          const shouldIncrementUnread = message.sender_id !== currentUser?.id &&
            (!currentActiveChat || currentActiveChat.id !== message.sender_id);

          updated[idx] = {
            ...updated[idx],
            last_message_content: message.content,
            last_message_time: message.created_at,
            last_message_sender_id: message.sender_id,
            unread_count: shouldIncrementUnread ? (updated[idx].unread_count || 0) + 1 : updated[idx].unread_count
          };
          // Move to top
          const conv = updated.splice(idx, 1)[0];
          updated.unshift(conv);
        } else {
          // NEW CONVERSATION - add it to the list
          const newConv = {
            other_user_id: otherUserId,
            other_username: message.sender_username || 'Unknown',
            other_avatar: message.sender_avatar || null,
            other_avatar_url: message.sender_avatar_url || null,
            other_online: true, // They just sent a message, so they're online
            last_message_content: message.content,
            last_message_time: message.created_at,
            last_message_sender_id: message.sender_id,
            unread_count: message.sender_id !== currentUser?.id ? 1 : 0
          };
          updated.unshift(newConv);
        }

        return updated;
      });

      // Update unread count if message is from someone else and not in active chat with them
      if (message.sender_id !== currentUser?.id &&
          (!currentActiveChat || message.sender_id !== currentActiveChat.id)) {
        setUnreadCount(prev => prev + 1);
      }
    });

    newSocket.on('message-sent', ({ message }) => {
      const currentActiveChat = activeChatRef.current;
      const currentUser = userRef.current;

      // An acknowledgement can arrive after the user switches conversations.
      // Keep its preview up to date, but never put it in another user's thread.
      if (currentActiveChat && currentActiveChat.id === message.receiver_id) {
        setMessages(prev => {
          if (prev.some(m => m.id === message.id)) return prev;
          return [...prev, message];
        });
      }

      // Update conversations list (for when you send to someone new)
      setConversations(prev => {
        const updated = [...prev];
        const otherUserId = message.receiver_id;
        const idx = updated.findIndex(c => c.other_user_id === otherUserId);

        if (idx >= 0) {
          // Update existing conversation
          updated[idx] = {
            ...updated[idx],
            last_message_content: message.content,
            last_message_time: message.created_at,
            last_message_sender_id: message.sender_id
          };
          // Move to top
          const conv = updated.splice(idx, 1)[0];
          updated.unshift(conv);
        } else if (currentActiveChat && currentActiveChat.id === otherUserId) {
          // NEW CONVERSATION - add it to the list using activeChat info
          const newConv = {
            other_user_id: otherUserId,
            other_username: currentActiveChat.username || 'Unknown',
            other_avatar: currentActiveChat.avatar || null,
            other_avatar_url: currentActiveChat.avatar_url || null,
            other_online: currentActiveChat.is_online || false,
            last_message_content: message.content,
            last_message_time: message.created_at,
            last_message_sender_id: message.sender_id,
            unread_count: 0
          };
          updated.unshift(newConv);
        }

        return updated;
      });
    });

    newSocket.on('user-typing', ({ userId }) => {
      setTypingUsers(prev => new Set([...prev, userId]));
    });

    newSocket.on('user-stopped-typing', ({ userId }) => {
      setTypingUsers(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    });

    newSocket.on('messages-read', ({ readerId }) => {
      const currentActiveChat = activeChatRef.current;
      const currentUser = userRef.current;

      // Update message read status
      if (currentActiveChat && currentActiveChat.id === readerId) {
        setMessages(prev => prev.map(m =>
          m.sender_id === currentUser?.id && !m.read_at
            ? { ...m, read_at: new Date().toISOString() }
            : m
        ));
      }
    });

    newSocket.on('message-reaction-updated', (update) => {
      const currentUser = userRef.current;
      setMessages(prev => prev.map(message =>
        message.id === update.messageId
          ? {
              ...message,
              reactions: mergeReactionUpdate(message.reactions, update, currentUser?.id)
            }
          : message
      ));
    });

    newSocket.on('message-deleted', ({ messageId, senderId, receiverId, lastMessage }) => {
      const currentUser = userRef.current;
      // Hard delete: drop the message from the thread entirely.
      setMessages(prev => prev.filter(message => message.id !== messageId));
      // Repoint the conversation preview to the new last message (matched by the
      // stable other_user_id, since the client doesn't keep last_message_id in sync).
      const otherUserId = currentUser && String(senderId) === String(currentUser.id) ? receiverId : senderId;
      setConversations(prev => prev.map(c =>
        c.other_user_id === otherUserId
          ? {
              ...c,
              last_message_id: lastMessage ? lastMessage.id : null,
              last_message_content: lastMessage ? lastMessage.content : null,
              last_message_sender_id: lastMessage ? lastMessage.sender_id : null,
              last_message_time: lastMessage ? lastMessage.created_at : c.last_message_time
            }
          : c
      ));
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
    });

    // Group chat socket events
    newSocket.on('group-created', ({ group }) => {
      if (!group) return;
      setGroupConversations(prev => {
        if (prev.some(existingGroup => existingGroup.id === group.id)) {
          return prev;
        }
        return [group, ...prev];
      });
    });

    newSocket.on('new-group-message', ({ groupId, group, message }) => {
      const currentActiveGroupChat = activeGroupChatRef.current;
      const currentUser = userRef.current;
      const isActiveGroup = currentActiveGroupChat && currentActiveGroupChat.id === groupId;

      // Add to messages if viewing this group
      if (isActiveGroup) {
        setGroupMessages(prev => {
          if (prev.some(m => m.id === message.id)) return prev;
          return [...prev, message];
        });
      }

      // Update group conversations list
      setGroupConversations(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(g => g.id === groupId);
        if (idx >= 0) {
          const shouldIncrementUnread = message.sender_id !== currentUser?.id && !isActiveGroup;
          updated[idx] = {
            ...updated[idx],
            last_message_content: message.content,
            last_message_time: message.created_at,
            last_message_sender_id: message.sender_id,
            last_message_sender_username: message.sender_username,
            unread_count: isActiveGroup
              ? 0
              : shouldIncrementUnread
                ? (updated[idx].unread_count || 0) + 1
                : updated[idx].unread_count
          };
          // Move to top
          const existingGroup = updated.splice(idx, 1)[0];
          updated.unshift(existingGroup);
        } else if (group) {
          updated.unshift({
            ...group,
            id: groupId,
            last_message_content: message.content,
            last_message_time: message.created_at,
            last_message_sender_id: message.sender_id,
            last_message_sender_username: message.sender_username,
            unread_count: message.sender_id !== currentUser?.id && !isActiveGroup ? 1 : 0
          });
        }
        return updated;
      });
    });

    newSocket.on('group-user-typing', ({ groupId, userId }) => {
      setGroupTypingUsers(prev => {
        const next = new Map(prev);
        const groupUsers = next.get(groupId) || new Set();
        groupUsers.add(userId);
        next.set(groupId, groupUsers);
        return next;
      });
    });

    newSocket.on('group-user-stopped-typing', ({ groupId, userId }) => {
      setGroupTypingUsers(prev => {
        const next = new Map(prev);
        const groupUsers = next.get(groupId);
        if (groupUsers) {
          groupUsers.delete(userId);
          if (groupUsers.size === 0) {
            next.delete(groupId);
          } else {
            next.set(groupId, groupUsers);
          }
        }
        return next;
      });
    });

    newSocket.on('group-message-reaction-updated', (update) => {
      const currentUser = userRef.current;
      setGroupMessages(prev => prev.map(message =>
        message.id === update.messageId
          ? {
              ...message,
              reactions: mergeReactionUpdate(message.reactions, update, currentUser?.id)
            }
          : message
      ));
    });

    newSocket.on('group-message-deleted', ({ groupId, messageId, lastMessage }) => {
      // Hard delete: drop the message from the thread entirely.
      setGroupMessages(prev => prev.filter(message => message.id !== messageId));
      // Repoint the group preview to the recomputed last message (matched by the
      // stable group id; lastMessage is always the group's true current latest).
      setGroupConversations(prev => prev.map(g =>
        g.id === groupId
          ? {
              ...g,
              last_message_id: lastMessage ? lastMessage.id : null,
              last_message_content: lastMessage ? lastMessage.content : null,
              last_message_sender_id: lastMessage ? lastMessage.sender_id : null,
              last_message_sender_username: lastMessage ? lastMessage.sender_username : null,
              last_message_time: lastMessage ? lastMessage.created_at : g.last_message_time
            }
          : g
      ));
    });

    newSocket.on('joined-group-room', ({ groupId }) => {
      console.log('Joined group room:', groupId);
    });

    newSocket.on('group-error', ({ error }) => {
      console.error('Group chat error:', error);
    });

    setSocket(newSocket);

    return () => {
      sessionRef.current += 1;
      chatRequestRef.current += 1;
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      newSocket.removeAllListeners();
      newSocket.disconnect();
    };
    // Depend on user?.id, not user: re-rendering with a new user object
    // (rating update, stats refresh, etc.) shouldn't tear down the socket.
  }, [token, user?.id]);

  // Fetch conversations
  const fetchConversations = useCallback(async () => {
    if (!token) return;
    const session = sessionRef.current;

    try {
      const response = await fetchWithTimeout(`${config.backend_url}/api/messages/conversations`, {
        headers: { 'Authorization': `Bearer ${token}` }
      }, 15000);
      const data = await response.json();
      if (session !== sessionRef.current) return;
      if (data.success) {
        setConversations(data.conversations || []);
      }
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    }
  }, [token]);

  // Fetch messages with a user
  const fetchMessages = useCallback(async (userId, requestId = ++chatRequestRef.current) => {
    if (!token) return null;

    try {
      const response = await fetchWithTimeout(`${config.backend_url}/api/messages/${userId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      }, 15000);
      const data = await response.json();
      if (data.success && requestId === chatRequestRef.current) {
        setMessages(data.messages?.slice().reverse() || []); // Reverse to show oldest first
        return data.user;
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
    return null;
  }, [token]);

  // Fetch unread count
  const fetchUnreadCount = useCallback(async () => {
    if (!token) return;
    const session = sessionRef.current;

    try {
      const response = await fetchWithTimeout(`${config.backend_url}/api/messages/unread/count`, {
        headers: { 'Authorization': `Bearer ${token}` }
      }, 10000);
      const data = await response.json();
      if (session !== sessionRef.current) return;
      if (data.success) {
        setUnreadCount(data.count || 0);
      }
    } catch (err) {
      console.error('Failed to fetch unread count:', err);
    }
  }, [token]);

  // Send a message
  const sendMessage = useCallback((receiverId, content) => {
    if (!socket || !connected) return false;

    socket.emit('send-message', { receiverId, content });
    return true;
  }, [socket, connected]);

  const toggleMessageReaction = useCallback((messageId, emoji) => {
    if (!socket || !connected) return false;

    socket.emit('toggle-message-reaction', { messageId, emoji });
    return true;
  }, [socket, connected]);

  const deleteMessage = useCallback((messageId) => {
    if (!socket || !connected) return false;

    socket.emit('delete-message', { messageId });
    return true;
  }, [socket, connected]);

  // Start/stop typing
  const startTyping = useCallback((receiverId) => {
    if (!socket || !connected) return;

    socket.emit('typing-start', { receiverId });

    // Auto-stop after 3 seconds
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing-stop', { receiverId });
    }, 3000);
  }, [socket, connected]);

  const stopTyping = useCallback((receiverId) => {
    if (!socket || !connected) return;

    socket.emit('typing-stop', { receiverId });
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
  }, [socket, connected]);

  // Mark messages as read
  const markAsRead = useCallback((fromUserId) => {
    if (!socket || !connected) return;

    socket.emit('mark-read', { fromUserId });

    // Get the unread count to subtract before updating state
    setConversations(prev => {
      const conv = prev.find(c => c.other_user_id === fromUserId);
      const countToSubtract = conv?.unread_count || 0;

      // Schedule unread count update outside this setter to avoid nested setState
      if (countToSubtract > 0) {
        queueMicrotask(() => {
          setUnreadCount(prevCount => Math.max(0, prevCount - countToSubtract));
        });
      }

      return prev.map(c =>
        c.other_user_id === fromUserId ? { ...c, unread_count: 0 } : c
      );
    });
  }, [socket, connected]);

  // Open a chat
  const openChat = useCallback(async (userId) => {
    const requestId = ++chatRequestRef.current;
    if (activeGroupChatRef.current && socketRef.current) {
      socketRef.current.emit('leave-group-room', { groupId: activeGroupChatRef.current.id });
    }
    activeChatRef.current = null;
    activeGroupChatRef.current = null;
    setActiveChat(null);
    setMessages([]);
    setActiveGroupChat(null);
    setGroupMessages([]);
    const chatUser = await fetchMessages(userId, requestId);
    if (chatUser && requestId === chatRequestRef.current) {
      activeChatRef.current = chatUser;
      setActiveChat(chatUser);
      markAsRead(userId);
      // Clear any stale "typing" entry for this user so reopening a chat doesn't
      // show a phantom indicator (the sender may have disconnected without ever
      // emitting typing-stop).
      setTypingUsers(prev => {
        if (!prev.has(chatUser.id)) return prev;
        const next = new Set(prev);
        next.delete(chatUser.id);
        return next;
      });
    }
    return chatUser;
  }, [fetchMessages, markAsRead]);

  // Close chat
  const closeChat = useCallback(() => {
    chatRequestRef.current += 1;
    activeChatRef.current = null;
    setActiveChat(null);
    setMessages([]);
    // Drop typing indicators: none are shown without an active chat, and a
    // stale entry would otherwise resurface as a phantom on the next open.
    setTypingUsers(new Set());
  }, []);

  // ============================================
  // GROUP CHAT FUNCTIONS
  // ============================================

  // Fetch group conversations
  const fetchGroupConversations = useCallback(async () => {
    if (!token) return;
    const session = sessionRef.current;

    try {
      const response = await fetchWithTimeout(`${config.backend_url}/api/messages/groups`, {
        headers: { 'Authorization': `Bearer ${token}` }
      }, 15000);
      const data = await response.json();
      if (session !== sessionRef.current) return;
      if (data.success) {
        setGroupConversations(data.groups || []);
      }
    } catch (err) {
      console.error('Failed to fetch group conversations:', err);
    }
  }, [token]);

  // Fetch messages for a group
  const fetchGroupMessages = useCallback(async (groupId, requestId = ++chatRequestRef.current) => {
    if (!token) return null;

    try {
      const response = await fetchWithTimeout(`${config.backend_url}/api/messages/groups/${groupId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      }, 15000);
      const data = await response.json();
      if (data.success && requestId === chatRequestRef.current) {
        setGroupMessages(data.messages?.slice().reverse() || []);
        return data.group;
      }
    } catch (err) {
      console.error('Failed to fetch group messages:', err);
    }
    return null;
  }, [token]);

  // Create a new group
  const createGroup = useCallback(async (name, memberIds) => {
    if (!token) return null;
    const session = sessionRef.current;

    try {
      const response = await fetchWithTimeout(`${config.backend_url}/api/messages/groups`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, memberIds })
      }, 15000);
      const data = await response.json();
      if (session !== sessionRef.current) return null;
      if (data.success) {
        // Add to group conversations
        setGroupConversations(prev => [data.group, ...prev]);
        return data.group;
      } else {
        throw new Error(data.error || 'Failed to create group');
      }
    } catch (err) {
      console.error('Failed to create group:', err);
      throw err;
    }
  }, [token]);

  // Send a message to a group
  const sendGroupMessage = useCallback((groupId, content) => {
    if (!socket || !connected) return false;

    socket.emit('send-group-message', { groupId, content });
    return true;
  }, [socket, connected]);

  const toggleGroupMessageReaction = useCallback((messageId, emoji) => {
    if (!socket || !connected) return false;

    socket.emit('toggle-group-message-reaction', { messageId, emoji });
    return true;
  }, [socket, connected]);

  const deleteGroupMessage = useCallback((groupId, messageId) => {
    if (!socket || !connected) return false;

    socket.emit('delete-group-message', { groupId, messageId });
    return true;
  }, [socket, connected]);

  // Start/stop typing in group
  const startGroupTyping = useCallback((groupId) => {
    if (!socket || !connected) return;
    socket.emit('group-typing-start', { groupId });
  }, [socket, connected]);

  const stopGroupTyping = useCallback((groupId) => {
    if (!socket || !connected) return;
    socket.emit('group-typing-stop', { groupId });
  }, [socket, connected]);

  // Open a group chat
  const openGroupChat = useCallback(async (groupId) => {
    const requestId = ++chatRequestRef.current;
    // Leave previous group room if any
    if (activeGroupChatRef.current && socket) {
      socket.emit('leave-group-room', { groupId: activeGroupChatRef.current.id });
    }

    activeChatRef.current = null;
    activeGroupChatRef.current = null;
    setActiveChat(null);
    setMessages([]);
    setActiveGroupChat(null);
    setGroupMessages([]);
    const group = await fetchGroupMessages(groupId, requestId);
    if (group && requestId === chatRequestRef.current) {
      activeGroupChatRef.current = group;
      setActiveGroupChat(group);
      // Close any active DM chat
      setActiveChat(null);
      setMessages([]);
      // Join the group room for real-time updates
      if (socket) {
        socket.emit('join-group-room', { groupId });
      }
    }
    return group;
  }, [fetchGroupMessages, socket]);

  // Close group chat
  const closeGroupChat = useCallback(() => {
    chatRequestRef.current += 1;
    if (activeGroupChatRef.current && socket) {
      socket.emit('leave-group-room', { groupId: activeGroupChatRef.current.id });
    }
    activeGroupChatRef.current = null;
    setActiveGroupChat(null);
    setGroupMessages([]);
  }, [socket]);

  // Add member to group
  const addGroupMember = useCallback(async (groupId, memberId) => {
    if (!token) return null;
    const session = sessionRef.current;

    try {
      const response = await fetchWithTimeout(`${config.backend_url}/api/messages/groups/${groupId}/members`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ memberId })
      }, 15000);
      const data = await response.json();
      if (session !== sessionRef.current) return null;
      if (data.success) {
        return data.member;
      } else {
        throw new Error(data.error || 'Failed to add member');
      }
    } catch (err) {
      console.error('Failed to add group member:', err);
      throw err;
    }
  }, [token]);

  // Leave group
  const leaveGroup = useCallback(async (groupId) => {
    if (!token) return;
    const session = sessionRef.current;

    try {
      const response = await fetchWithTimeout(`${config.backend_url}/api/messages/groups/${groupId}/leave`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      }, 15000);
      const data = await response.json();
      if (session !== sessionRef.current) return;
      if (data.success) {
        // Remove from group conversations
        setGroupConversations(prev => prev.filter(g => g.id !== groupId));
        // Close if this was the active group
        if (activeGroupChatRef.current?.id === groupId) {
          closeGroupChat();
        }
        return data;
      } else {
        throw new Error(data.error || 'Failed to leave group');
      }
    } catch (err) {
      console.error('Failed to leave group:', err);
      throw err;
    }
  }, [token, closeGroupChat]);

  // Delete group (creator only)
  const deleteGroup = useCallback(async (groupId) => {
    if (!token) return;
    const session = sessionRef.current;

    try {
      const response = await fetchWithTimeout(`${config.backend_url}/api/messages/groups/${groupId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      }, 15000);
      const data = await response.json();
      if (session !== sessionRef.current) return;
      if (data.success) {
        // Remove from group conversations
        setGroupConversations(prev => prev.filter(g => g.id !== groupId));
        // Close if this was the active group
        if (activeGroupChatRef.current?.id === groupId) {
          closeGroupChat();
        }
        return data;
      } else {
        throw new Error(data.error || 'Failed to delete group');
      }
    } catch (err) {
      console.error('Failed to delete group:', err);
      throw err;
    }
  }, [token, closeGroupChat]);

  // Load initial data when connected
  useEffect(() => {
    if (connected) {
      fetchConversations();
      fetchUnreadCount();
      fetchGroupConversations();
    }
  }, [connected, fetchConversations, fetchUnreadCount, fetchGroupConversations]);

  const value = {
    connected,
    conversations,
    activeChat,
    messages,
    unreadCount,
    typingUsers,
    fetchConversations,
    fetchMessages,
    fetchUnreadCount,
    sendMessage,
    toggleMessageReaction,
    deleteMessage,
    startTyping,
    stopTyping,
    markAsRead,
    openChat,
    closeChat,
    setActiveChat,
    setMessages,
    // Group chat
    groupConversations,
    activeGroupChat,
    groupMessages,
    groupTypingUsers,
    fetchGroupConversations,
    fetchGroupMessages,
    createGroup,
    sendGroupMessage,
    toggleGroupMessageReaction,
    deleteGroupMessage,
    startGroupTyping,
    stopGroupTyping,
    openGroupChat,
    closeGroupChat,
    addGroupMember,
    leaveGroup,
    deleteGroup,
    setActiveGroupChat,
    setGroupMessages
  };

  return (
    <MessagingContext.Provider value={value}>
      {children}
    </MessagingContext.Provider>
  );
}

export function useMessaging() {
  const context = useContext(MessagingContext);
  if (!context) {
    throw new Error('useMessaging must be used within a MessagingProvider');
  }
  return context;
}

export default MessagingContext;
