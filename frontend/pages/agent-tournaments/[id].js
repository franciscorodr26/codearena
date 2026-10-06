import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import {
  Trophy,
  Calendar,
  Clock,
  Users,
  Award,
  Swords,
  ChevronLeft,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  Play,
  UserPlus,
  UserMinus,
  Eye,
  User
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { config } from '../../config/env';
import { io } from 'socket.io-client';
import FloatingOrbs from '../../components/ui/FloatingOrbs';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import withAuth from '../../components/withAuth';
import TournamentBracket from '../../components/TournamentBracket';
import AgentBattlesGate from '../../components/AgentBattlesGate'

const AgentTournamentDetailsPage = () => {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();

  const [tournament, setTournament] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [userParticipant, setUserParticipant] = useState(null);
  const [activeTab, setActiveTab] = useState('bracket'); // 'bracket', 'participants'
  const [loadouts, setLoadouts] = useState([]);
  const [selectedLoadout, setSelectedLoadout] = useState(null);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (!id) return;

    fetchTournamentDetails();
    fetchParticipants();
    fetchBracket();
    fetchLoadouts();

    // Setup socket connection for live updates
    const token = localStorage.getItem('auth_token');
    const newSocket = io(config.backend_url, {
      auth: { token }
    });

    newSocket.on('connect', () => {
      console.log('Connected to tournament socket');
      newSocket.emit('join-agent-tournament', { tournamentId: parseInt(id) });
    });

    newSocket.on('agent-tournament-update', (data) => {
      console.log('Tournament update:', data);
      // Refresh data on tournament updates
      fetchTournamentDetails();
      fetchParticipants();
      fetchBracket();
    });

    newSocket.on('agent-tournament-match-ready', (data) => {
      console.log('Match ready:', data);
      // Show notification or refresh
      fetchBracket();
    });

    setSocket(newSocket);

    return () => {
      if (newSocket) {
        newSocket.emit('leave-agent-tournament', { tournamentId: parseInt(id) });
        newSocket.disconnect();
      }
    };
  }, [id]);

  const fetchTournamentDetails = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${config.backend_url}/api/agent/tournaments/${id}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch tournament');
      }

      const data = await response.json();
      setTournament(data.tournament);
      setIsRegistered(data.isRegistered);
      setUserParticipant(data.userParticipant);
    } catch (err) {
      console.error('Error fetching tournament:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchParticipants = async () => {
    try {
      const response = await fetch(`${config.backend_url}/api/agent/tournaments/${id}/participants`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setParticipants(data.participants || []);
      }
    } catch (err) {
      console.error('Error fetching participants:', err);
    }
  };

  const fetchBracket = async () => {
    try {
      const response = await fetch(`${config.backend_url}/api/agent/tournaments/${id}/bracket`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setMatches(data.matches || []);
      }
    } catch (err) {
      console.error('Error fetching bracket:', err);
    }
  };

  const fetchLoadouts = async () => {
    try {
      const response = await fetch(`${config.backend_url}/api/agent/loadouts`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setLoadouts(data.loadouts || []);
        if (data.loadouts && data.loadouts.length > 0) {
          setSelectedLoadout(data.loadouts[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching loadouts:', err);
    }
  };

  const handleJoin = async () => {
    if (!selectedLoadout) {
      alert('Please select a loadout');
      return;
    }

    try {
      setActionLoading(true);
      const response = await fetch(`${config.backend_url}/api/agent/tournaments/${id}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ loadoutId: selectedLoadout })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to join tournament');
      }

      // Refresh tournament data
      await fetchTournamentDetails();
      await fetchParticipants();
      setShowJoinModal(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleLeave = async () => {
    if (!confirm('Are you sure you want to leave this tournament?')) {
      return;
    }

    try {
      setActionLoading(true);
      const response = await fetch(`${config.backend_url}/api/agent/tournaments/${id}/join`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to leave tournament');
      }

      // Refresh tournament data
      await fetchTournamentDetails();
      await fetchParticipants();
    } catch (err) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCheckIn = async () => {
    try {
      setActionLoading(true);
      const response = await fetch(`${config.backend_url}/api/agent/tournaments/${id}/check-in`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to check in');
      }

      // Refresh tournament data
      await fetchTournamentDetails();
      await fetchParticipants();
    } catch (err) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const statusConfig = {
      upcoming: { label: 'Upcoming', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
      registration_open: { label: 'Registration Open', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
      check_in_open: { label: 'Check-in Open', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
      in_progress: { label: 'In Progress', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
      completed: { label: 'Completed', color: 'bg-surface-600 text-surface-300 border-surface-500' },
      cancelled: { label: 'Cancelled', color: 'bg-error-500/20 text-error-400 border-error-500/30' }
    };

    const config = statusConfig[status] || statusConfig.upcoming;
    return (
      <span className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${config.color}`}>
        {config.label}
      </span>
    );
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const canJoin = tournament?.status === 'upcoming' || tournament?.status === 'registration_open';
  const canCheckIn = tournament?.status === 'check_in_open' && isRegistered && userParticipant?.status !== 'checked_in';
  const canLeave = isRegistered && (tournament?.status === 'upcoming' || tournament?.status === 'registration_open');

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        <span className="ml-3 text-surface-300">Loading tournament...</span>
      </div>
    );
  }

  if (error || !tournament) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950 flex items-center justify-center">
        <Card className="bg-error-500/10 border-error-500/30 p-6 max-w-md">
          <div className="flex items-center gap-3 text-error-400 mb-4">
            <AlertCircle className="w-5 h-5" />
            <p>{error || 'Tournament not found'}</p>
          </div>
          <Button onClick={() => router.push('/agent-tournaments')}>
            <ChevronLeft className="w-4 h-4 mr-2" />
            Back to Tournaments
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{tournament.name} - Agent Tournament - CodeArena</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950 text-white">
        <FloatingOrbs />

        <div className="container mx-auto px-4 py-8 relative z-10">
          {/* Back Button */}
          <Button
            onClick={() => router.push('/agent-tournaments')}
            variant="ghost"
            className="mb-4"
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            Back to Tournaments
          </Button>

          {/* Tournament Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className="p-6 mb-6">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <Trophy className="w-8 h-8 text-primary-400" />
                    <h1 className="text-3xl font-bold">{tournament.name}</h1>
                    {getStatusBadge(tournament.status)}
                  </div>

                  {tournament.description && (
                    <p className="text-surface-300 mb-4">{tournament.description}</p>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="w-4 h-4 text-surface-400" />
                      <span className="text-surface-200">{formatDate(tournament.start_time)}</span>
                    </div>

                    <div className="flex items-center gap-2 text-sm">
                      <Users className="w-4 h-4 text-surface-400" />
                      <span className="text-surface-200">
                        {tournament.participant_count} / {tournament.max_participants} players
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-sm">
                      <Swords className="w-4 h-4 text-surface-400" />
                      <span className="text-surface-200 capitalize">
                        {tournament.format.replace('_', ' ')}
                      </span>
                    </div>

                    {tournament.prize_pool > 0 && (
                      <div className="flex items-center gap-2 text-sm">
                        <Award className="w-4 h-4 text-yellow-400" />
                        <span className="text-yellow-400">${tournament.prize_pool} Prize</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  {!isRegistered && canJoin && (
                    <Button
                      onClick={() => setShowJoinModal(true)}
                      className="bg-gradient-to-r from-primary-500 to-secondary-500 hover:from-primary-600 hover:to-secondary-600"
                      disabled={actionLoading}
                    >
                      {actionLoading ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <UserPlus className="w-4 h-4 mr-2" />
                      )}
                      Join Tournament
                    </Button>
                  )}

                  {isRegistered && canCheckIn && (
                    <Button
                      onClick={handleCheckIn}
                      className="bg-yellow-500 hover:bg-yellow-600"
                      disabled={actionLoading}
                    >
                      {actionLoading ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <CheckCircle className="w-4 h-4 mr-2" />
                      )}
                      Check In
                    </Button>
                  )}

                  {isRegistered && canLeave && (
                    <Button
                      onClick={handleLeave}
                      variant="danger"
                      disabled={actionLoading}
                    >
                      {actionLoading ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <UserMinus className="w-4 h-4 mr-2" />
                      )}
                      Leave Tournament
                    </Button>
                  )}

                  {isRegistered && userParticipant?.status === 'checked_in' && (
                    <div className="flex items-center gap-2 text-success-400 bg-success-500/10 border border-success-500/30 rounded-lg px-4 py-2">
                      <CheckCircle className="w-4 h-4" />
                      <span className="text-sm font-medium">Checked In</span>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Tabs */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setActiveTab('bracket')}
              className={`px-6 py-3 rounded-lg font-medium transition-all ${
                activeTab === 'bracket'
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
              }`}
            >
              Bracket
            </button>
            <button
              onClick={() => setActiveTab('participants')}
              className={`px-6 py-3 rounded-lg font-medium transition-all ${
                activeTab === 'participants'
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
              }`}
            >
              Participants ({participants.length})
            </button>
          </div>

          {/* Content */}
          {activeTab === 'bracket' ? (
            <Card className="p-6">
              {matches.length > 0 ? (
                <TournamentBracket
                  tournament={tournament}
                  matches={matches}
                  participants={participants}
                  onMatchClick={(match) => {
                    if (match.battle_id) {
                      router.push(`/agent-replay/${match.battle_id}`);
                    }
                  }}
                />
              ) : (
                <div className="text-center py-20">
                  <Trophy className="w-16 h-16 mx-auto mb-4 text-surface-500" />
                  <h3 className="text-xl font-semibold mb-2 text-surface-200">
                    Bracket Not Generated
                  </h3>
                  <p className="text-surface-400">
                    The tournament bracket will be generated once the tournament starts.
                  </p>
                </div>
              )}
            </Card>
          ) : (
            <Card className="p-6">
              <div className="space-y-3">
                {participants.length === 0 ? (
                  <div className="text-center py-12">
                    <Users className="w-12 h-12 mx-auto mb-3 text-surface-500" />
                    <p className="text-surface-400">No participants yet</p>
                  </div>
                ) : (
                  participants.map((participant, index) => (
                    <div
                      key={participant.id}
                      className="flex items-center justify-between p-4 bg-surface-800 rounded-lg hover:bg-surface-700 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <span className="text-surface-500 font-mono text-sm w-8">
                          #{participant.seed || index + 1}
                        </span>
                        <User className="w-5 h-5 text-surface-400" />
                        <div>
                          <p className="font-medium">{participant.username}</p>
                          <p className="text-sm text-surface-400">
                            {participant.loadout_name} ({participant.loadout_model})
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-sm text-surface-400">
                          {participant.loadout_elo} ELO
                        </span>
                        {participant.status === 'checked_in' && (
                          <span className="px-2 py-1 bg-success-500/20 text-success-400 border border-success-500/30 rounded text-xs">
                            Checked In
                          </span>
                        )}
                        {participant.status === 'winner' && (
                          <Trophy className="w-5 h-5 text-yellow-400" />
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          )}
        </div>

        {/* Join Modal */}
        {showJoinModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <Card className="max-w-md w-full p-6">
                <h2 className="text-2xl font-bold mb-4">Join Tournament</h2>
                <p className="text-surface-300 mb-6">
                  Select a loadout to compete with in this tournament
                </p>

                <div className="space-y-3 mb-6">
                  {loadouts.length === 0 ? (
                    <p className="text-error-400 text-sm">
                      You need to create a loadout first
                    </p>
                  ) : (
                    loadouts.map((loadout) => (
                      <div
                        key={loadout.id}
                        onClick={() => setSelectedLoadout(loadout.id)}
                        className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                          selectedLoadout === loadout.id
                            ? 'border-primary-500 bg-primary-500/10'
                            : 'border-surface-700 hover:border-surface-600'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{loadout.name}</p>
                            <p className="text-sm text-surface-400">
                              {loadout.model} • {loadout.language}
                            </p>
                          </div>
                          <span className="text-sm text-surface-400">
                            {loadout.elo} ELO
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={() => setShowJoinModal(false)}
                    variant="ghost"
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleJoin}
                    disabled={!selectedLoadout || actionLoading}
                    className="flex-1 bg-gradient-to-r from-primary-500 to-secondary-500"
                  >
                    {actionLoading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : null}
                    Join
                  </Button>
                </div>
              </Card>
            </motion.div>
          </div>
        )}
      </div>
    </>
  );
};

const AgentPage = withAuth(AgentTournamentDetailsPage);
export default function AgentPageGated(props) {
  return <AgentBattlesGate><AgentPage {...props} /></AgentBattlesGate>
}
