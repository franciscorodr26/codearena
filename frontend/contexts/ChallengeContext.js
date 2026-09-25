import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { useRouter } from 'next/router';
import { config } from '../config/env';
import { useAuth } from './AuthContext';

const ChallengeContext = createContext(null);

export function ChallengeProvider({ children }) {
  const router = useRouter();
  const { token, user } = useAuth();

  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  // Refs for stable references in socket handlers
  const socketRef = useRef(null);
  const routerRef = useRef(router);
  const userRef = useRef(user);

  // Keep refs updated
  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Incoming challenge (someone challenged us)
  const [incomingChallenge, setIncomingChallenge] = useState(null);

  // Outgoing challenge (we challenged someone)
  const [outgoingChallenge, setOutgoingChallenge] = useState(null);
  const [challengeError, setChallengeError] = useState(null);

  // Mirror the active challenges into refs so the socket handlers (registered
  // once) can read the current value without going stale.
  const incomingChallengeRef = useRef(null);
  const outgoingChallengeRef = useRef(null);
  useEffect(() => { incomingChallengeRef.current = incomingChallenge; }, [incomingChallenge]);
  useEffect(() => { outgoingChallengeRef.current = outgoingChallenge; }, [outgoingChallenge]);

  // Countdown timer for challenges
  const [timeRemaining, setTimeRemaining] = useState(0);
  const timerRef = useRef(null);
  const errorTimeoutRef = useRef(null);

  // Countdown timer functions - declared before socket useEffect that uses them
  const clearCountdown = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setTimeRemaining(0);
  }, []);

  const startCountdown = useCallback((expiresAt) => {
    clearCountdown();
    const expiryTime = new Date(expiresAt).getTime();

    // Validate the expiry time - if invalid, don't start countdown
    if (isNaN(expiryTime)) {
      console.error('Invalid expiresAt timestamp:', expiresAt);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((expiryTime - now) / 1000));
      setTimeRemaining(remaining);

      if (remaining <= 0) {
        clearCountdown();
        setIncomingChallenge(null);
        setOutgoingChallenge(null);
      }
    };

    updateTimer();
    timerRef.current = setInterval(updateTimer, 1000);
  }, [clearCountdown]);

  // Connect to socket when authenticated
  useEffect(() => {
    if (!token || !user?.id) {
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
      console.log('[Challenge] Socket connected, id:', newSocket.id);
      newSocket.emit('auth-for-messaging', { token });
    });

    newSocket.on('auth-success', () => {
      console.log('[Challenge] Auth success, socket ready');
      setConnected(true);
    });

    newSocket.on('auth-error', (data) => {
      console.error('[Challenge] Auth error:', data.error);
      setConnected(false);
    });

    newSocket.on('connect_error', (err) => {
      console.error('[Challenge] Connect error:', err.message);
    });

    // Someone challenged us
    newSocket.on('challenge-received', (data) => {
      console.log('[Challenge] Received challenge from:', data.challenger?.username, 'id:', data.id);
      // Show one challenge interaction at a time. If a challenge modal is already
      // up (incoming or outgoing), ignore the new one instead of clobbering the
      // modal the user is about to act on: the new challenger's request expires
      // server-side. (Prevents the modal swapping out from under an Accept click.)
      if (incomingChallengeRef.current || outgoingChallengeRef.current) {
        console.log('[Challenge] Ignoring concurrent challenge, one is already active');
        return;
      }
      setIncomingChallenge(data);
      startCountdown(data.expires_at);
    });

    // Our challenge was sent successfully
    newSocket.on('challenge-sent', (data) => {
      console.log('[Challenge] Sent to:', data.challenged?.username, 'challengeId:', data.challengeId);
      setOutgoingChallenge(data);
      setChallengeError(null);
      startCountdown(data.expires_at);
    });

    // Challenge was accepted - redirect to battle
    newSocket.on('challenge-accepted', (data) => {
      clearCountdown();
      setIncomingChallenge(null);
      setOutgoingChallenge(null);

      // Determine which playerId to use based on whether we're challenger or challenged
      // Use userRef to avoid stale closure
      // Use Number() for type-safe comparison (user.id may be string from JWT, data IDs are numbers from server)
      const currentUser = userRef.current;
      const isChallenger = currentUser && Number(currentUser.id) === Number(data.challenger.id);
      const myPlayerId = isChallenger ? data.challengerPlayerId : data.challengedPlayerId;
      const opponentName = isChallenger ? data.challenged.username : data.challenger.username;

      console.log(`[Challenge] Accepted: isChallenger=${isChallenger}, myPlayerId=${myPlayerId}, battleId=${data.battleId}`);

      // Redirect to battle page with correct params
      const myName = isChallenger ? data.challenger.username : data.challenged.username;
      routerRef.current.push(`/battle?id=${data.battleId}&playerId=${myPlayerId}&opponent=${encodeURIComponent(opponentName)}&yourName=${encodeURIComponent(myName)}&skipLanguageSelection=true`);
    });

    // Challenge was declined
    newSocket.on('challenge-declined', (data) => {
      clearCountdown();
      setOutgoingChallenge(null);
      setChallengeError(`${data.declined_by.username} declined your challenge`);
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = setTimeout(() => setChallengeError(null), 5000);
    });

    // Challenge was cancelled
    newSocket.on('challenge-cancelled', (data) => {
      clearCountdown();
      setIncomingChallenge(null);
      setOutgoingChallenge(null);
    });

    // Challenge error
    newSocket.on('challenge-error', (data) => {
      console.error('Challenge error:', data.error);
      setChallengeError(data.error);
      setOutgoingChallenge(null);
      clearCountdown();
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = setTimeout(() => setChallengeError(null), 5000);
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
    });

    setSocket(newSocket);

    return () => {
      clearCountdown();
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
      newSocket.disconnect();
    };
  }, [token, user?.id, clearCountdown, startCountdown]);

  // Send a challenge
  const sendChallenge = useCallback((challengedId, { ranked = false } = {}) => {
    if (!socket || !connected) {
      setChallengeError('Not connected');
      return false;
    }

    socket.emit('send-challenge', { challengedId, ranked });
    return true;
  }, [socket, connected]);

  // Accept incoming challenge
  const acceptChallenge = useCallback((challengeId) => {
    if (!socket || !connected) return false;

    socket.emit('accept-challenge', { challengeId });
    return true;
  }, [socket, connected]);

  // Decline incoming challenge
  const declineChallenge = useCallback((challengeId) => {
    if (!socket || !connected) return false;

    socket.emit('decline-challenge', { challengeId });
    setIncomingChallenge(null);
    clearCountdown();
    return true;
  }, [socket, connected, clearCountdown]);

  // Cancel outgoing challenge
  const cancelChallenge = useCallback((challengeId) => {
    if (!socket || !connected) return false;

    socket.emit('cancel-challenge', { challengeId });
    setOutgoingChallenge(null);
    clearCountdown();
    return true;
  }, [socket, connected, clearCountdown]);

  // Clear error
  const clearError = useCallback(() => {
    setChallengeError(null);
  }, []);

  const value = {
    connected,
    incomingChallenge,
    outgoingChallenge,
    challengeError,
    timeRemaining,
    sendChallenge,
    acceptChallenge,
    declineChallenge,
    cancelChallenge,
    clearError
  };

  return (
    <ChallengeContext.Provider value={value}>
      {children}
    </ChallengeContext.Provider>
  );
}

export function useChallenge() {
  const context = useContext(ChallengeContext);
  if (!context) {
    throw new Error('useChallenge must be used within a ChallengeProvider');
  }
  return context;
}

export default ChallengeContext;
