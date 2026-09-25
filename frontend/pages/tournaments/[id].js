import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Loader2,
  Users,
  Calendar,
  Clock,
  Check,
  X,
  Play,
  UserPlus,
  UserMinus,
  ChevronRight,
  Copy,
  Share2,
  Lock
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTournaments } from '../../contexts/TournamentContext';
import { withAuth } from '../../components/withAuth';
import { config } from '../../config/env';
import { trackViewTournament, trackTournamentRegister, trackTournamentUnregister } from '../../utils/analytics';
import Button from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { FadeIn } from '../../components/ui/Motion';
import { LANGUAGES, LAUNCH_LANGUAGES } from '../../utils/languages';

const STATUS_CONFIG = {
  upcoming: { label: 'Upcoming', color: 'text-blue-400', dot: 'bg-blue-400' },
  registration_open: { label: 'Registration Open', color: 'text-success', dot: 'bg-success' },
  registration_closed: { label: 'Registration Closed', color: 'text-warning', dot: 'bg-warning' },
  in_progress: { label: 'In Progress', color: 'text-danger', dot: 'bg-danger' },
  completed: { label: 'Completed', color: 'text-surface-400', dot: 'bg-surface-400' }
};

// LANGUAGES imported from shared utility

const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
};

// Bracket Match Component
function BracketMatch({ match, isUserMatch, onReady, readyPlayers, userId }) {
  const isPlayer1Ready = readyPlayers?.includes(match.player1_id);
  const isPlayer2Ready = readyPlayers?.includes(match.player2_id);
  const canReady = isUserMatch && match.status === 'pending' && match.player1_id && match.player2_id;
  const isReady = userId && readyPlayers?.includes(userId);

  return (
    <div className={`bg-surface-800/50 rounded-xl border p-3 min-w-[200px] ${
      isUserMatch ? 'border-primary-500/50' : 'border-surface-700/50'
    }`}>
      {/* Player 1 */}
      <div className={`flex items-center justify-between p-2 rounded-lg ${
        match.winner_id === match.player1_id ? 'bg-success/10' : 'bg-surface-900/50'
      }`}>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${
            match.winner_id === match.player1_id ? 'text-success' : 'text-white'
          }`}>
            {match.player1_username || 'TBD'}
          </span>
        </div>
        {match.status === 'pending' && isPlayer1Ready && (
          <Check className="w-4 h-4 text-success" />
        )}
      </div>

      <div className="text-center text-xs text-surface-500 my-1">vs</div>

      {/* Player 2 */}
      <div className={`flex items-center justify-between p-2 rounded-lg ${
        match.winner_id === match.player2_id ? 'bg-success/10' : 'bg-surface-900/50'
      }`}>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${
            match.winner_id === match.player2_id ? 'text-success' : 'text-white'
          }`}>
            {match.player2_username || 'TBD'}
          </span>
        </div>
        {match.status === 'pending' && isPlayer2Ready && (
          <Check className="w-4 h-4 text-success" />
        )}
      </div>

      {/* Ready button for user's match */}
      {canReady && (
        <div className="mt-3 pt-3 border-t border-surface-700/50">
          <Button
            size="sm"
            variant={isReady ? 'secondary' : 'primary'}
            className="w-full"
            onClick={() => onReady(match.id)}
            disabled={isReady}
          >
            {isReady ? (
              <>
                <Check className="w-4 h-4 mr-1" />
                Ready!
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-1" />
                Ready Up
              </>
            )}
          </Button>
        </div>
      )}

      {/* Match status */}
      {match.status === 'in_progress' && (
        <div className="mt-2 text-center">
          <span className="text-xs text-danger animate-pulse">Match in progress...</span>
        </div>
      )}
    </div>
  );
}

// Bracket Visualization
function TournamentBracket({ matches, bracket, userId, onReady, readyPlayers }) {
  if (!matches || matches.length === 0) {
    return (
      <Card className="p-8 text-center">
        <h3 className="text-lg font-semibold text-white mb-2">Bracket not generated</h3>
        <p className="text-surface-400">The bracket will be generated when the tournament starts.</p>
      </Card>
    );
  }

  const rounds = Object.keys(bracket).map(Number).sort((a, b) => a - b);

  // Separate the 3rd place match from the regular bracket
  const thirdPlaceMatch = matches.find(m => m.is_third_place_match);

  // Build a filtered bracket with the 3rd place match removed from its round column
  const filteredBracket = {};
  for (const round of rounds) {
    filteredBracket[round] = (bracket[round] || []).filter(m => !m.is_third_place_match);
  }

  return (
    <div className="space-y-6">
      {/* Main elimination bracket */}
      <div className="overflow-x-auto">
        <div className="flex gap-8 p-4 min-w-max">
          {rounds.map((round, roundIndex) => {
            const roundMatches = filteredBracket[round] || [];
            if (roundMatches.length === 0) return null;
            const roundName = roundIndex === rounds.length - 1 ? 'Final' :
                             roundIndex === rounds.length - 2 ? 'Semi-Finals' :
                             roundIndex === rounds.length - 3 ? 'Quarter-Finals' :
                             `Round ${round}`;

            return (
              <div key={round} className="flex flex-col">
                <h3 className="text-sm font-medium text-surface-400 mb-4 text-center">{roundName}</h3>
                <div className="flex flex-col gap-4 justify-around flex-1">
                  {roundMatches.map((match) => {
                    const isUserMatch = userId && (match.player1_id === userId || match.player2_id === userId);
                    return (
                      <BracketMatch
                        key={match.id}
                        match={match}
                        isUserMatch={isUserMatch}
                        onReady={onReady}
                        readyPlayers={readyPlayers[match.id] || []}
                        userId={userId}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3rd Place Match: runs in parallel with the final */}
      {thirdPlaceMatch && (
        <div className="pt-4 border-t border-surface-700/50">
          <h3 className="text-sm font-medium text-surface-400 mb-4 text-center">3rd Place Match</h3>
          <div className="flex justify-center">
            <BracketMatch
              match={thirdPlaceMatch}
              isUserMatch={userId && (thirdPlaceMatch.player1_id === userId || thirdPlaceMatch.player2_id === userId)}
              onReady={onReady}
              readyPlayers={readyPlayers[thirdPlaceMatch.id] || []}
              userId={userId}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Participant List
function ParticipantsList({ participants }) {
  if (!participants || participants.length === 0) {
    return (
      <Card className="p-6 text-center">
        <Users className="w-8 h-8 text-surface-500 mx-auto mb-2" />
        <p className="text-surface-400">No participants yet</p>
      </Card>
    );
  }

  return (
    <Card className="divide-y divide-surface-700/50">
      {participants.map((participant, index) => (
        <div key={participant.user_id} className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <span className="w-6 h-6 flex items-center justify-center text-sm font-medium text-surface-400">
              {participant.seed || index + 1}
            </span>
            <Link href={`/profile/${participant.username}`} className="hover:text-primary-400 transition-colors">
              <span className="font-medium text-white">{participant.username}</span>
            </Link>
          </div>
          <div className="flex items-center gap-4 text-sm text-surface-400">
            <span>{participant.rating || 1000} ELO</span>
            <span className="text-xs uppercase">{participant.language}</span>
          </div>
        </div>
      ))}
    </Card>
  );
}

function TournamentDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { user, token } = useAuth();
  const {
    fetchTournament,
    fetchBracket,
    registerForTournament,
    unregisterFromTournament,
    joinTournamentRoom,
    leaveTournamentRoom,
    readyForMatch,
    matchReadyPlayers
  } = useTournaments();

  const [tournament, setTournament] = useState(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [bracket, setBracket] = useState({});
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('python');
  const [activeTab, setActiveTab] = useState('bracket');
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const loadRequestRef = React.useRef(0);

  const loadTournament = useCallback(async () => {
    if (!id) return;

    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setTournament(null);
    setParticipants([]);
    setBracket({});
    setMatches([]);
    setError(null);
    try {
      // Direct fetch to avoid context dependency issues
      const backendUrl = config.backend_url;
      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const tournamentResponse = await fetch(`${backendUrl}/api/tournaments/${id}`, { headers });
      if (!tournamentResponse.ok) throw new Error('Failed to load tournament');
      if (requestId !== loadRequestRef.current) return;
      const data = await tournamentResponse.json();
      if (requestId !== loadRequestRef.current) return;
      setTournament(data.tournament);
      setIsRegistered(data.isRegistered);
      if (data.userParticipant) {
        setSelectedLanguage(data.userParticipant.language);
      }

      // Fetch participants
      const response = await fetch(`${backendUrl}/api/tournaments/${id}/participants`);
      if (response.ok) {
        const participantsData = await response.json();
        if (requestId !== loadRequestRef.current) return;
        setParticipants(participantsData.participants || []);
      }

      // Fetch bracket
      const bracketData = await fetchBracket(id);
      if (requestId !== loadRequestRef.current) return;
      if (bracketData) {
        setBracket(bracketData.bracket);
        setMatches(bracketData.matches);
      }
    } catch (err) {
      if (requestId !== loadRequestRef.current) return;
      console.error('Error loading tournament:', err);
      setError('Failed to load tournament');
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [id, token, fetchBracket]);

  useEffect(() => {
    loadTournament();
    return () => { loadRequestRef.current += 1; };
  }, [loadTournament]);

  // Track page view when tournament loads
  useEffect(() => {
    if (tournament) {
      trackViewTournament({
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        status: tournament.status
      }, user);
    }
  }, [tournament, user]);

  // Join socket room for real-time updates
  useEffect(() => {
    if (id) {
      joinTournamentRoom(parseInt(id));
      return () => leaveTournamentRoom(parseInt(id));
    }
  }, [id, joinTournamentRoom, leaveTournamentRoom]);

  const handleRegister = async () => {
    if (!user) {
      router.push('/login');
      return;
    }

    setRegistering(true);
    setError(null);

    const result = await registerForTournament(parseInt(id), selectedLanguage);

    if (result.success) {
      setIsRegistered(true);
      trackTournamentRegister({
        tournamentId: parseInt(id),
        tournamentName: tournament?.name,
        participantCount: (tournament?.participant_count || 0) + 1
      }, user);
      loadTournament(); // Refresh data
    } else {
      setError(result.error);
    }

    setRegistering(false);
  };

  const handleUnregister = async () => {
    setRegistering(true);
    setError(null);

    const result = await unregisterFromTournament(parseInt(id));

    if (result.success) {
      setIsRegistered(false);
      trackTournamentUnregister({
        tournamentId: parseInt(id),
        tournamentName: tournament?.name
      }, user);
      loadTournament();
    } else {
      setError(result.error);
    }

    setRegistering(false);
  };

  const handleReady = (matchId) => {
    readyForMatch(matchId, parseInt(id));
  };

  const getInviteUrl = () => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    return `${baseUrl}/tournaments/join/${tournament?.invite_code}`;
  };

  const handleCopyInviteLink = async () => {
    const inviteUrl = getInviteUrl();
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleShareInviteLink = async () => {
    const inviteUrl = getInviteUrl();
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join my CodeArena Tournament: ${tournament?.name}`,
          text: 'I\'m hosting a coding battle! Join me at CodeArena.',
          url: inviteUrl
        });
      } catch (err) {
        // User cancelled or share failed, fallback to copy
        handleCopyInviteLink();
      }
    } else {
      handleCopyInviteLink();
    }
  };

  const isCreator = user && tournament && tournament.created_by === user.id;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary-400 animate-spin" />
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="p-8 text-center">
          <h2 className="text-xl font-bold text-white mb-2">{error || 'Tournament not found'}</h2>
          <Link href="/tournaments">
            <Button variant="ghost">Back to Tournaments</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[tournament.status] || STATUS_CONFIG.upcoming;
  const canRegister = ['upcoming', 'registration_open'].includes(tournament.status) &&
                      tournament.participant_count < tournament.max_players;

  // All languages free during beta testing
  const availableLanguages = LAUNCH_LANGUAGES;

  return (
    <>
      <Head>
        <title>{tournament.name} - CodeArena Tournament</title>
      </Head>

      <div className="min-h-screen bg-background">

        {/* Header */}
        <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-surface-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="text-surface-400 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-3">
                <div>
                  <h1 className="text-xl font-bold text-white">{tournament.name}</h1>
                  <div className="flex items-center gap-2">
                    {tournament.is_private && (
                      <span className="px-2 py-0.5 bg-surface-700/50 border border-surface-600 rounded text-xs font-medium text-surface-300 flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        Private
                      </span>
                    )}
                    <span className={`flex items-center gap-1.5 text-xs font-medium ${statusConfig.color}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`} />
                      {statusConfig.label}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Tournament Info */}
              <Card className="p-6">
                <div className="flex flex-wrap items-center gap-6 mb-6">
                  <div className="flex items-center gap-2 text-surface-400">
                    <Users className="w-5 h-5" />
                    <span>{tournament.participant_count}/{tournament.max_players} participants</span>
                  </div>
                  <div className="flex items-center gap-2 text-surface-400">
                    <Calendar className="w-5 h-5" />
                    <span>Starts {formatDate(tournament.start_time)}</span>
                  </div>
                  {tournament.prize_description && (
                    <div className="flex items-center gap-2 text-surface-300">
                      <span>Prize: {tournament.prize_description}</span>
                    </div>
                  )}
                </div>

                {tournament.description && (
                  <p className="text-surface-300">{tournament.description}</p>
                )}

                {tournament.status === 'completed' && tournament.winner_username && (
                  <div className="mt-6 p-4 bg-surface-800/50 border border-surface-700 rounded-xl space-y-2">
                    <div className="text-sm text-surface-400 mb-3 font-medium">Final Results</div>
                    {/* 1st place: champion */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-yellow-400 w-6">1st</span>
                      <span className="text-white font-semibold">{tournament.winner_username}</span>
                    </div>
                    {/* 2nd place: derive from final match loser */}
                    {(() => {
                      const finalRound = Math.max(...Object.keys(bracket).map(Number));
                      const finalMatch = (bracket[finalRound] || []).find(m => !m.is_third_place_match && m.winner_id);
                      const runnerUp = finalMatch
                        ? (finalMatch.winner_id === finalMatch.player1_id ? finalMatch.player2_username : finalMatch.player1_username)
                        : null;
                      return runnerUp ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-surface-300 w-6">2nd</span>
                          <span className="text-surface-300">{runnerUp}</span>
                        </div>
                      ) : null;
                    })()}
                    {/* 3rd place: from 3rd place match winner */}
                    {(() => {
                      const thirdMatch = matches.find(m => m.is_third_place_match && m.winner_id);
                      return thirdMatch ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-amber-600 w-6">3rd</span>
                          <span className="text-surface-400">{thirdMatch.winner_username}</span>
                        </div>
                      ) : null;
                    })()}
                  </div>
                )}
              </Card>

              {/* Tabs */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab('bracket')}
                  className={`px-4 py-2 rounded-xl font-medium transition-all ${
                    activeTab === 'bracket'
                      ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                      : 'text-surface-400 hover:text-white hover:bg-surface-800/50'
                  }`}
                >
                  Bracket
                </button>
                <button
                  onClick={() => setActiveTab('participants')}
                  className={`px-4 py-2 rounded-xl font-medium transition-all ${
                    activeTab === 'participants'
                      ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                      : 'text-surface-400 hover:text-white hover:bg-surface-800/50'
                  }`}
                >
                  Participants ({tournament.participant_count})
                </button>
              </div>

              {/* Tab Content */}
              {activeTab === 'bracket' ? (
                <TournamentBracket
                  matches={matches}
                  bracket={bracket}
                  userId={user?.id}
                  onReady={handleReady}
                  readyPlayers={matchReadyPlayers}
                />
              ) : (
                <ParticipantsList participants={participants} />
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Registration Card */}
              <Card className="p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Registration</h3>

                {error && (
                  <div className="mb-4 p-3 bg-danger/10 border border-danger/30 rounded-lg text-danger text-sm">
                    {error}
                  </div>
                )}

                {!user ? (
                  <div className="text-center">
                    <p className="text-surface-400 mb-4">Sign in to register for tournaments</p>
                    <Link href="/login">
                      <Button className="w-full">Sign In</Button>
                    </Link>
                  </div>
                ) : isRegistered ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-success">
                      <Check className="w-5 h-5" />
                      <span className="font-medium">You're registered!</span>
                    </div>
                    <p className="text-sm text-surface-400">
                      Language: <span className="text-white capitalize">{selectedLanguage}</span>
                    </p>
                    {canRegister && (
                      <Button
                        variant="ghost"
                        className="w-full text-danger hover:bg-danger/10"
                        onClick={handleUnregister}
                        disabled={registering}
                      >
                        {registering ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <UserMinus className="w-4 h-4 mr-2" />
                            Unregister
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                ) : canRegister ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-surface-300 mb-2">
                        Select Language
                      </label>
                      <select
                        value={selectedLanguage}
                        onChange={(e) => setSelectedLanguage(e.target.value)}
                        className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        {availableLanguages.map((lang) => (
                          <option key={lang.id} value={lang.id}>
                            {lang.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      className="w-full"
                      onClick={handleRegister}
                      disabled={registering}
                    >
                      {registering ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <UserPlus className="w-4 h-4 mr-2" />
                          Register
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <p className="text-surface-400 text-center">
                    {tournament.status === 'completed'
                      ? 'This tournament has ended.'
                      : tournament.status === 'in_progress'
                      ? 'This tournament is in progress.'
                      : 'Registration is currently closed.'}
                  </p>
                )}
              </Card>

              {/* Invite Link Card for Private Tournaments */}
              {tournament.is_private && tournament.invite_code && (isCreator || isRegistered) && (
                <Card className="p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Lock className="w-5 h-5 text-primary-400" />
                    <h3 className="text-lg font-semibold text-white">Invite Link</h3>
                  </div>
                  <p className="text-sm text-surface-400 mb-4">
                    Share this link to invite friends to join this private tournament.
                  </p>
                  <div className="bg-surface-900/50 rounded-lg p-3 mb-4">
                    <p className="text-xs text-surface-500 mb-1">Invite URL</p>
                    <p className="text-sm text-white break-all font-mono">{getInviteUrl()}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={handleCopyInviteLink}
                      className="flex items-center justify-center gap-2 py-2 px-3 bg-surface-700 hover:bg-surface-600 text-white rounded-lg transition-colors text-sm"
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4 text-success" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          Copy
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleShareInviteLink}
                      className="flex items-center justify-center gap-2 py-2 px-3 bg-primary-500 hover:bg-primary-400 text-white rounded-lg transition-colors text-sm"
                    >
                      <Share2 className="w-4 h-4" />
                      Share
                    </button>
                  </div>
                </Card>
              )}

              {/* Tournament Details */}
              <Card className="p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Details</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-surface-400">Format</span>
                    <span className="text-white">Single Elimination</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-surface-400">Min Players</span>
                    <span className="text-white">{tournament.min_players}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-surface-400">Max Players</span>
                    <span className="text-white">{tournament.max_players}</span>
                  </div>
                  {tournament.total_rounds > 0 && (
                    <div className="flex justify-between">
                      <span className="text-surface-400">Total Rounds</span>
                      <span className="text-white">{tournament.total_rounds}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-surface-400">Registration Deadline</span>
                    <span className="text-white">{formatDate(tournament.registration_deadline)}</span>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

export default withAuth(TournamentDetailPage);
