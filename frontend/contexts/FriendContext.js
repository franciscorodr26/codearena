import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { config } from '../config/env';
import { useAuth } from './AuthContext';
import {
  trackFriendRequestSent,
  trackFriendRequestAccepted,
  trackFriendRequestDeclined,
  trackFriendRemoved
} from '../utils/analytics';

const FriendContext = createContext(null);

export function FriendProvider({ children }) {
  const { token, user } = useAuth();

  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  // Ref for socket to avoid stale closures
  const socketRef = useRef(null);
  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  // Friends list
  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(true);

  // Friend requests
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [outgoingRequests, setOutgoingRequests] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);

  // Latest incoming request (for modal notification)
  const [latestRequest, setLatestRequest] = useState(null);

  // Error handling
  const [friendError, setFriendError] = useState(null);
  const errorTimeoutRef = useRef(null);

  // Ref for user to avoid stale closures in socket handlers
  const userRef = useRef(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Fetch friends and requests from API
  const fetchFriends = useCallback(async () => {
    if (!token) return;

    try {
      setFriendsLoading(true);
      setFriendError(null);

      const response = await fetch(`${config.backend_url}/api/friends`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Handle auth errors and rate limits silently
      if (response.status === 401 || response.status === 403 || response.status === 429) {
        return;
      }

      if (!response.ok) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[friends] Friends endpoint returned ${response.status}; using empty friends list`);
        }
        setFriends([]);
        return;
      }

      const data = await response.json();
      setFriends(data.friends || []);
    } catch (_) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[friends] Friends endpoint unavailable; using empty friends list');
      }
      setFriends([]);
    } finally {
      setFriendsLoading(false);
    }
  }, [token]);

  const fetchIncomingRequests = useCallback(async () => {
    if (!token) return;

    try {
      const response = await fetch(`${config.backend_url}/api/friends/requests/incoming`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Handle auth errors and rate limits silently
      if (response.status === 401 || response.status === 403 || response.status === 429) {
        return;
      }

      if (!response.ok) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[friends] Incoming requests endpoint returned ${response.status}; using empty requests`);
        }
        setIncomingRequests([]);
        setPendingCount(0);
        return;
      }

      const data = await response.json();
      setIncomingRequests(data.requests || []);
      setPendingCount(data.requests?.length || 0);
    } catch (_) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[friends] Incoming requests endpoint unavailable; using empty requests');
      }
      setIncomingRequests([]);
      setPendingCount(0);
    }
  }, [token]);

  const fetchOutgoingRequests = useCallback(async () => {
    if (!token) return;

    try {
      const response = await fetch(`${config.backend_url}/api/friends/requests/outgoing`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Handle auth errors and rate limits silently
      if (response.status === 401 || response.status === 403 || response.status === 429) {
        return;
      }

      if (!response.ok) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[friends] Outgoing requests endpoint returned ${response.status}; using empty requests`);
        }
        setOutgoingRequests([]);
        return;
      }

      const data = await response.json();
      setOutgoingRequests(data.requests || []);
    } catch (_) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[friends] Outgoing requests endpoint unavailable; using empty requests');
      }
      setOutgoingRequests([]);
    }
  }, [token]);

  const refreshFriends = useCallback(async () => {
    await Promise.all([
      fetchFriends(),
      fetchIncomingRequests(),
      fetchOutgoingRequests()
    ]);
  }, [fetchFriends, fetchIncomingRequests, fetchOutgoingRequests]);

  // Connect to socket when authenticated
  useEffect(() => {
    if (!token || !user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        setSocket(null);
        setConnected(false);
      }
      setFriends([]);
      setIncomingRequests([]);
      setOutgoingRequests([]);
      setPendingCount(0);
      return;
    }

    // Fetch initial data
    refreshFriends();

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
      console.error('Friend auth error:', data.error);
      setConnected(false);
    });

    // Someone sent us a friend request
    newSocket.on('friend-request-received', (data) => {
      let wasNew = false;
      setIncomingRequests(prev => {
        // Prevent duplicates
        if (prev.some(r => r.id === data.id)) return prev;
        wasNew = true;
        return [...prev, {
          id: data.id,
          requester_id: data.requester.id,
          requester_username: data.requester.username,
          requester_avatar: data.requester.avatar,
          requester_avatar_url: data.requester.avatar_url,
          requester_rating: data.requester.rating,
          requester_wins: data.requester.wins,
          requester_losses: data.requester.losses,
          created_at: data.created_at
        }];
      });
      // L4 fix: only bump pendingCount when the request was actually new.
      // Duplicate socket events would otherwise drift the badge upward.
      if (wasNew) {
        setPendingCount(prev => prev + 1);
        setLatestRequest(data);
      }
    });

    // Our friend request was sent
    newSocket.on('friend-request-sent', (data) => {
      const currentUser = userRef.current;
      trackFriendRequestSent({
        targetUserId: data.targetUser.id,
        targetUsername: data.targetUser.username,
        source: 'socket'
      }, currentUser);
      setOutgoingRequests(prev => {
        // Prevent duplicates
        if (prev.some(r => r.id === data.requestId)) return prev;
        return [...prev, {
          id: data.requestId,
          requested_id: data.targetUser.id,
          requested_username: data.targetUser.username,
          requested_avatar: data.targetUser.avatar,
          requested_avatar_url: data.targetUser.avatar_url
        }];
      });
      setFriendError(null);
    });

    // Friend request was accepted
    newSocket.on('friend-request-accepted', (data) => {
      const currentUser = userRef.current;
      trackFriendRequestAccepted({
        fromUserId: data.friend.id,
        fromUsername: data.friend.username
      }, currentUser);
      // Remove from outgoing requests
      setOutgoingRequests(prev => prev.filter(r => r.id !== data.requestId));
      // Remove from incoming requests
      setIncomingRequests(prev => prev.filter(r => r.id !== data.requestId));
      // Add to friends list (with duplicate prevention)
      setFriends(prev => {
        if (prev.some(f => f.id === data.friend.id)) return prev;
        return [...prev, {
          id: data.friend.id,
          username: data.friend.username,
          avatar: data.friend.avatar,
          avatar_url: data.friend.avatar_url,
          rating: data.friend.rating,
          wins: data.friend.wins,
          losses: data.friend.losses
        }];
      });
      // Update pending count
      setPendingCount(prev => Math.max(0, prev - 1));
    });

    // Friend request was declined
    newSocket.on('friend-request-declined', (data) => {
      const currentUser = userRef.current;
      trackFriendRequestDeclined({
        fromUserId: data.declinedBy || null,
        fromUsername: null
      }, currentUser);
      setOutgoingRequests(prev => prev.filter(r => r.id !== data.requestId));
      setIncomingRequests(prev => {
        const filtered = prev.filter(r => r.id !== data.requestId);
        // Schedule count update outside setter to avoid nested setState
        queueMicrotask(() => setPendingCount(filtered.length));
        return filtered;
      });
    });

    // Friend request was cancelled
    newSocket.on('friend-request-cancelled', (data) => {
      setOutgoingRequests(prev => prev.filter(r => r.id !== data.requestId));
      setIncomingRequests(prev => {
        const filtered = prev.filter(r => r.id !== data.requestId);
        // Schedule count update outside setter to avoid nested setState
        queueMicrotask(() => setPendingCount(filtered.length));
        return filtered;
      });
    });

    // Friend was removed
    newSocket.on('friend-removed', (data) => {
      const currentUser = userRef.current;
      trackFriendRemoved({
        friendUserId: data.userId,
        friendUsername: null
      }, currentUser);
      setFriends(prev => prev.filter(f => f.id !== data.userId));
    });

    // Error handling
    newSocket.on('friend-request-error', (data) => {
      console.error('Friend request error:', data.error);
      setFriendError(data.error);
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = setTimeout(() => setFriendError(null), 5000);
    });

    // Friend online status (optional enhancement)
    newSocket.on('friend-online', (data) => {
      setFriends(prev => prev.map(f =>
        f.id === data.friendId ? { ...f, is_online: true } : f
      ));
    });

    newSocket.on('friend-offline', (data) => {
      setFriends(prev => prev.map(f =>
        f.id === data.friendId ? { ...f, is_online: false } : f
      ));
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
    });

    setSocket(newSocket);

    return () => {
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
      newSocket.disconnect();
    };
    // Depend on user?.id (stable) instead of user (new object on every
    // setUser, e.g. after a rating bump) so we don't tear down + reconnect
    // the socket on unrelated user state changes. refreshFriends is omitted
    // because its identity is already keyed on token.
  }, [token, user?.id]);

  // Send a friend request
  const sendFriendRequest = useCallback((targetUserId) => {
    if (!socket || !connected) {
      setFriendError('Not connected');
      return false;
    }

    socket.emit('send-friend-request', { targetUserId });
    return true;
  }, [socket, connected]);

  // Accept a friend request
  const acceptRequest = useCallback((requestId) => {
    if (!socket || !connected) return false;

    socket.emit('accept-friend-request', { requestId });
    return true;
  }, [socket, connected]);

  // Decline a friend request
  const declineRequest = useCallback((requestId) => {
    if (!socket || !connected) return false;

    socket.emit('decline-friend-request', { requestId });
    return true;
  }, [socket, connected]);

  // Cancel a sent friend request
  const cancelRequest = useCallback((requestId) => {
    if (!socket || !connected) return false;

    socket.emit('cancel-friend-request', { requestId });
    return true;
  }, [socket, connected]);

  // Remove a friend
  const removeFriend = useCallback((friendId) => {
    if (!socket || !connected) return false;

    socket.emit('remove-friend', { friendId });
    return true;
  }, [socket, connected]);

  // Get friendship status with a user
  const getFriendshipStatus = useCallback(async (userId) => {
    if (!token) return { status: 'none' };

    try {
      const response = await fetch(`${config.backend_url}/api/friends/status/${userId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        return await response.json();
      }
      return { status: 'none' };
    } catch (error) {
      console.error('Error getting friendship status:', error);
      return { status: 'none' };
    }
  }, [token]);

  // Clear latest request (after showing modal)
  const clearLatestRequest = useCallback(() => {
    setLatestRequest(null);
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    setFriendError(null);
  }, []);

  // Check if user is a friend
  const isFriend = useCallback((userId) => {
    return friends.some(f => f.id === userId);
  }, [friends]);

  // Check if we have a pending request to a user
  const hasPendingRequestTo = useCallback((userId) => {
    return outgoingRequests.some(r => r.requested_id === userId);
  }, [outgoingRequests]);

  // Check if we have a pending request from a user
  const hasPendingRequestFrom = useCallback((userId) => {
    return incomingRequests.some(r => r.requester_id === userId);
  }, [incomingRequests]);

  // Get pending request for a user
  const getPendingRequest = useCallback((userId) => {
    const outgoing = outgoingRequests.find(r => r.requested_id === userId);
    if (outgoing) return { type: 'outgoing', request: outgoing };

    const incoming = incomingRequests.find(r => r.requester_id === userId);
    if (incoming) return { type: 'incoming', request: incoming };

    return null;
  }, [outgoingRequests, incomingRequests]);

  const value = {
    connected,
    friends,
    friendsLoading,
    incomingRequests,
    outgoingRequests,
    pendingCount,
    latestRequest,
    friendError,
    sendFriendRequest,
    acceptRequest,
    declineRequest,
    cancelRequest,
    removeFriend,
    getFriendshipStatus,
    refreshFriends,
    clearLatestRequest,
    clearError,
    isFriend,
    hasPendingRequestTo,
    hasPendingRequestFrom,
    getPendingRequest
  };

  return (
    <FriendContext.Provider value={value}>
      {children}
    </FriendContext.Provider>
  );
}

export function useFriends() {
  const context = useContext(FriendContext);
  if (!context) {
    throw new Error('useFriends must be used within a FriendProvider');
  }
  return context;
}

export default FriendContext;
