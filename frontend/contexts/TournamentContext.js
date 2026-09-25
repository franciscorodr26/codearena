import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { config } from '../config/env';
import { useAuth } from './AuthContext';

const TournamentContext = createContext(null);

export function TournamentProvider({ children }) {
  const { token, user } = useAuth();

  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  // Ref for socket to avoid stale closures
  const socketRef = useRef(null);
  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  // Current tournament state
  const [currentTournament, setCurrentTournament] = useState(null);
  const [bracket, setBracket] = useState({});
  const [matches, setMatches] = useState([]);

  // Ref for currentTournament to avoid stale closures
  const currentTournamentRef = useRef(null);
  useEffect(() => {
    currentTournamentRef.current = currentTournament;
  }, [currentTournament]);

  // Match ready state
  const [matchReadyPlayers, setMatchReadyPlayers] = useState({});

  // Loading states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const errorTimeoutRef = useRef(null);

  // Connect to socket when authenticated
  useEffect(() => {
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

    // Mirror FriendContext: don't trust raw `connect`: wait for server auth ack.
    // The tournament server gates writes on a valid handshake JWT, so we use the
    // existing `auth-for-messaging`/`auth-success` handshake (the only one the
    // backend implements) to confirm the token before flipping `connected`.
    newSocket.on('connect', () => {
      newSocket.emit('auth-for-messaging', { token });
    });

    newSocket.on('auth-success', () => {
      setConnected(true);
    });

    newSocket.on('auth-error', (data) => {
      console.error('Tournament auth error:', data?.error);
      setConnected(false);
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
    });

    // Tournament bracket updates
    newSocket.on('tournament-bracket-update', (data) => {
      setMatches(prev => prev.map(match =>
        match.id === data.matchId
          ? { ...match, winner_id: data.winnerId, status: 'completed' }
          : match
      ));
    });

    // Match ready updates
    newSocket.on('tournament-match-ready-update', (data) => {
      setMatchReadyPlayers(prev => ({
        ...prev,
        [data.matchId]: data.readyPlayers
      }));
    });

    // Match started
    newSocket.on('tournament-match-started', (data) => {
      setMatchReadyPlayers(prev => {
        const next = { ...prev };
        delete next[data.matchId];
        return next;
      });
    });

    // Tournament completed
    newSocket.on('tournament-completed', (data) => {
      if (currentTournamentRef.current && currentTournamentRef.current.id === data.tournamentId) {
        setCurrentTournament(prev => ({
          ...prev,
          status: 'completed',
          winner_id: data.winnerId
        }));
      }
    });

    // Error handling
    newSocket.on('tournament-error', (data) => {
      console.error('Tournament error:', data.error);
      setError(data.error);
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = setTimeout(() => setError(null), 5000);
    });

    setSocket(newSocket);

    return () => {
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
      newSocket.disconnect();
    };
  }, [token, user]);

  // Join tournament room for real-time updates
  const joinTournamentRoom = useCallback((tournamentId) => {
    if (!socket || !connected) return;
    socket.emit('join-tournament-room', { tournamentId });
  }, [socket, connected]);

  // Leave tournament room
  const leaveTournamentRoom = useCallback((tournamentId) => {
    if (!socket || !connected) return;
    socket.emit('leave-tournament-room', { tournamentId });
  }, [socket, connected]);

  // Ready up for a match
  const readyForMatch = useCallback((matchId, tournamentId) => {
    if (!socket || !connected) return false;
    socket.emit('tournament-match-ready', { matchId, tournamentId });
    return true;
  }, [socket, connected]);

  // Fetch tournament details
  const fetchTournament = useCallback(async (tournamentId) => {
    setLoading(true);
    setError(null);

    try {
      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${config.backend_url}/api/tournaments/${tournamentId}`, {
        headers
      });

      if (!response.ok) throw new Error('Failed to fetch tournament');

      const data = await response.json();
      setCurrentTournament(data.tournament);
      return data;
    } catch (err) {
      console.error('Error fetching tournament:', err);
      setError('Failed to load tournament');
      return null;
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Fetch bracket
  const fetchBracket = useCallback(async (tournamentId) => {
    try {
      const response = await fetch(`${config.backend_url}/api/tournaments/${tournamentId}/bracket`);

      if (!response.ok) throw new Error('Failed to fetch bracket');

      const data = await response.json();
      setBracket(data.bracket);
      setMatches(data.matches);
      return data;
    } catch (err) {
      console.error('Error fetching bracket:', err);
      return null;
    }
  }, []);

  // Register for tournament
  const registerForTournament = useCallback(async (tournamentId, language = 'python') => {
    if (!token) return { success: false, error: 'Not authenticated' };

    try {
      const response = await fetch(`${config.backend_url}/api/tournaments/${tournamentId}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ language })
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error };
      }

      return { success: true };
    } catch (err) {
      console.error('Error registering:', err);
      return { success: false, error: 'Failed to register' };
    }
  }, [token]);

  // Unregister from tournament
  const unregisterFromTournament = useCallback(async (tournamentId) => {
    if (!token) return { success: false, error: 'Not authenticated' };

    try {
      const response = await fetch(`${config.backend_url}/api/tournaments/${tournamentId}/register`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error };
      }

      return { success: true };
    } catch (err) {
      console.error('Error unregistering:', err);
      return { success: false, error: 'Failed to unregister' };
    }
  }, [token]);

  // Fetch upcoming tournaments
  const fetchUpcomingTournaments = useCallback(async (limit = 5) => {
    try {
      const response = await fetch(`${config.backend_url}/api/tournaments/upcoming?limit=${limit}`);

      if (!response.ok) throw new Error('Failed to fetch tournaments');

      const data = await response.json();
      return data.tournaments;
    } catch (err) {
      console.error('Error fetching upcoming tournaments:', err);
      return [];
    }
  }, []);

  // Fetch all tournaments with filters
  const fetchTournaments = useCallback(async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.append('status', filters.status);
    if (filters.proOnly !== undefined) params.append('pro_only', filters.proOnly);
    if (filters.limit) params.append('limit', filters.limit);
    if (filters.offset) params.append('offset', filters.offset);

    try {
      const response = await fetch(`${config.backend_url}/api/tournaments?${params.toString()}`);

      if (!response.ok) throw new Error('Failed to fetch tournaments');

      const data = await response.json();
      return data;
    } catch (err) {
      console.error('Error fetching tournaments:', err);
      return { tournaments: [], pagination: {} };
    }
  }, []);

  // Fetch user's tournament history
  const fetchUserHistory = useCallback(async () => {
    if (!token) return { history: [], stats: {} };

    try {
      const response = await fetch(`${config.backend_url}/api/tournaments/user/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to fetch history');

      return await response.json();
    } catch (err) {
      console.error('Error fetching tournament history:', err);
      return { history: [], stats: {} };
    }
  }, [token]);

  // Fetch user's pending matches
  const fetchPendingMatches = useCallback(async () => {
    if (!token) return [];

    try {
      const response = await fetch(`${config.backend_url}/api/tournaments/user/matches`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to fetch matches');

      const data = await response.json();
      return data.matches;
    } catch (err) {
      console.error('Error fetching pending matches:', err);
      return [];
    }
  }, [token]);

  // Create a new tournament (private)
  const createTournament = useCallback(async (tournamentData) => {
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(`${config.backend_url}/api/tournaments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(tournamentData)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create tournament');
    }

    return data;
  }, [token]);

  // Fetch tournament by invite code
  const fetchTournamentByInviteCode = useCallback(async (inviteCode) => {
    try {
      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${config.backend_url}/api/tournaments/invite/${inviteCode}`, {
        headers
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Tournament not found');
      }

      return data;
    } catch (err) {
      // An unknown or expired invite code is a normal user path; the page shows it.
      throw err;
    }
  }, [token]);

  // Register for private tournament with invite code
  const registerForPrivateTournament = useCallback(async (tournamentId, inviteCode, language = 'python') => {
    if (!token) return { success: false, error: 'Not authenticated' };

    try {
      const response = await fetch(`${config.backend_url}/api/tournaments/${tournamentId}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ language, inviteCode })
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error };
      }

      return { success: true };
    } catch (err) {
      console.error('Error registering:', err);
      return { success: false, error: 'Failed to register' };
    }
  }, [token]);

  const value = {
    connected,
    currentTournament,
    bracket,
    matches,
    matchReadyPlayers,
    loading,
    error,
    joinTournamentRoom,
    leaveTournamentRoom,
    readyForMatch,
    fetchTournament,
    fetchBracket,
    registerForTournament,
    unregisterFromTournament,
    fetchUpcomingTournaments,
    fetchTournaments,
    fetchUserHistory,
    fetchPendingMatches,
    createTournament,
    fetchTournamentByInviteCode,
    registerForPrivateTournament
  };

  return (
    <TournamentContext.Provider value={value}>
      {children}
    </TournamentContext.Provider>
  );
}

export function useTournaments() {
  const context = useContext(TournamentContext);
  if (!context) {
    throw new Error('useTournaments must be used within a TournamentProvider');
  }
  return context;
}

export default TournamentContext;
