import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import {
  Trophy,
  Users,
  Calendar,
  Clock,
  Loader2,
  AlertCircle,
  CheckCircle,
  LogIn,
  Home,
  Lock
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useTournaments } from '../../../contexts/TournamentContext';
import { withAuth } from '../../../components/withAuth';
import FloatingOrbs from '../../../components/ui/FloatingOrbs';

const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
};

const getTimeUntil = (dateString) => {
  const date = new Date(dateString);
  const now = new Date();
  const diff = date - now;

  if (diff < 0) return 'Started';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days} day${days > 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''}`;
  if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''}, ${minutes} minute${minutes !== 1 ? 's' : ''}`;
  return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
};

function JoinTournamentPage() {
  const router = useRouter();
  const { code } = router.query;
  const { user, loading: authLoading } = useAuth();
  const { fetchTournamentByInviteCode, registerForPrivateTournament } = useTournaments();

  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinSuccess, setJoinSuccess] = useState(false);
  // Client-side only time display to avoid SSR hydration mismatch
  const [timeUntil, setTimeUntil] = useState(null);

  const loadTournament = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    setError('');

    try {
      const data = await fetchTournamentByInviteCode(code);
      setTournament(data.tournament);
      setIsRegistered(data.isRegistered);
    } catch (err) {
      setError(err.message || 'Tournament not found or invite link expired');
    } finally {
      setLoading(false);
    }
  }, [code, fetchTournamentByInviteCode]);

  useEffect(() => {
    if (code) {
      loadTournament();
    }
  }, [code, loadTournament]);

  // Update time display client-side only
  useEffect(() => {
    if (!tournament?.start_time) return;

    const updateTime = () => {
      setTimeUntil(getTimeUntil(tournament.start_time));
    };

    updateTime();
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, [tournament?.start_time]);

  const handleJoin = async () => {
    if (!user) {
      // Redirect to login with return URL
      router.push(`/login?redirect=/tournaments/join/${code}`);
      return;
    }

    setJoining(true);
    setError('');

    try {
      const result = await registerForPrivateTournament(tournament.id, code, 'python');

      if (result.success) {
        setJoinSuccess(true);
        setIsRegistered(true);
        // Redirect to tournament page after a short delay
        setTimeout(() => {
          router.push(`/tournaments/${tournament.id}`);
        }, 2000);
      } else {
        setError(result.error || 'Failed to join tournament');
      }
    } catch (err) {
      setError(err.message || 'Failed to join tournament');
    } finally {
      setJoining(false);
    }
  };

  const canJoin = tournament &&
    (tournament.status === 'registration_open' || tournament.status === 'upcoming') &&
    tournament.participant_count < tournament.max_players &&
    !isRegistered;

  return (
    <>
      <Head>
        <title>{tournament ? `Join ${tournament.name}` : 'Join Tournament'} - CodeArena</title>
      </Head>

      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <FloatingOrbs variant="secondary" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          {/* Loading state */}
          {loading && (
            <div className="bg-surface-800/50 backdrop-blur-xl border border-surface-700/50 rounded-2xl p-8 text-center">
              <Loader2 className="w-12 h-12 text-primary-400 animate-spin mx-auto mb-4" />
              <p className="text-surface-300">Loading tournament...</p>
            </div>
          )}

          {/* Error state */}
          {!loading && error && !tournament && (
            <div className="bg-surface-800/50 backdrop-blur-xl border border-surface-700/50 rounded-2xl p-8 text-center">
              <div className="w-16 h-16 bg-danger/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8 text-danger" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Invalid Invite Link</h2>
              <p className="text-surface-400 mb-6">{error}</p>
              <Link
                href="/tournaments"
                className="inline-flex items-center gap-2 px-4 py-2 bg-surface-700 hover:bg-surface-600 text-white rounded-xl transition-colors"
              >
                <Home className="w-4 h-4" />
                Browse Tournaments
              </Link>
            </div>
          )}

          {/* Tournament found */}
          {!loading && tournament && (
            <div className="bg-surface-800/50 backdrop-blur-xl border border-surface-700/50 rounded-2xl overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-r from-primary-500/20 to-secondary-500/20 p-6 border-b border-surface-700/50">
                <div className="flex items-center gap-2 text-primary-400 text-sm mb-3">
                  <Lock className="w-4 h-4" />
                  <span>Private Tournament Invite</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-gradient-to-br from-primary-500/30 to-secondary-500/30 rounded-xl flex items-center justify-center">
                    <Trophy className="w-7 h-7 text-primary-400" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold text-white">{tournament.name}</h1>
                    <p className="text-surface-400 text-sm">
                      Hosted by {tournament.creator_username}
                    </p>
                  </div>
                </div>
              </div>

              {/* Tournament details */}
              <div className="p-6 space-y-4">
                {tournament.description && (
                  <p className="text-surface-300">{tournament.description}</p>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-surface-700/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-surface-400 text-sm mb-1">
                      <Users className="w-4 h-4" />
                      <span>Players</span>
                    </div>
                    <div className="text-lg font-semibold text-white">
                      {tournament.participant_count} / {tournament.max_players}
                    </div>
                  </div>

                  <div className="bg-surface-700/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-surface-400 text-sm mb-1">
                      <Clock className="w-4 h-4" />
                      <span>Starts In</span>
                    </div>
                    <div className="text-lg font-semibold text-white">
                      {timeUntil || '...'}
                    </div>
                  </div>
                </div>

                <div className="bg-surface-700/30 rounded-xl p-4">
                  <div className="flex items-center gap-2 text-surface-400 text-sm mb-1">
                    <Calendar className="w-4 h-4" />
                    <span>Start Time</span>
                  </div>
                  <div className="text-white font-medium">
                    {formatDate(tournament.start_time)}
                  </div>
                </div>

                {/* Error message */}
                {error && tournament && (
                  <div className="bg-danger/10 border border-danger/30 rounded-xl p-3">
                    <p className="text-sm text-danger">{error}</p>
                  </div>
                )}

                {/* Success message */}
                {joinSuccess && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-success/10 border border-success/30 rounded-xl p-4 text-center"
                  >
                    <CheckCircle className="w-8 h-8 text-success mx-auto mb-2" />
                    <p className="text-success font-medium">Successfully joined!</p>
                    <p className="text-success/70 text-sm">Redirecting to tournament...</p>
                  </motion.div>
                )}

                {/* Action buttons */}
                {!joinSuccess && (
                  <div className="space-y-3 pt-2">
                    {isRegistered ? (
                      <Link
                        href={`/tournaments/${tournament.id}`}
                        className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gradient-to-r from-primary-500 to-secondary-500 hover:from-primary-400 hover:to-secondary-400 text-white font-semibold rounded-xl transition-all"
                      >
                        <CheckCircle className="w-5 h-5" />
                        Already Joined - View Tournament
                      </Link>
                    ) : canJoin ? (
                      <>
                        {!user && !authLoading ? (
                          <button
                            onClick={handleJoin}
                            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gradient-to-r from-primary-500 to-secondary-500 hover:from-primary-400 hover:to-secondary-400 text-white font-semibold rounded-xl transition-all"
                          >
                            <LogIn className="w-5 h-5" />
                            Login to Join
                          </button>
                        ) : (
                          <button
                            onClick={handleJoin}
                            disabled={joining}
                            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gradient-to-r from-primary-500 to-secondary-500 hover:from-primary-400 hover:to-secondary-400 text-white font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {joining ? (
                              <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Joining...
                              </>
                            ) : (
                              <>
                                <Trophy className="w-5 h-5" />
                                Join Tournament
                              </>
                            )}
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="text-center py-3 px-4 bg-surface-700/50 text-surface-400 rounded-xl">
                        {tournament.participant_count >= tournament.max_players
                          ? 'Tournament is full'
                          : tournament.status === 'in_progress'
                          ? 'Tournament already in progress'
                          : tournament.status === 'completed'
                          ? 'Tournament has ended'
                          : 'Registration is closed'}
                      </div>
                    )}

                    <Link
                      href="/tournaments"
                      className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-surface-700 hover:bg-surface-600 text-white font-medium rounded-xl transition-colors"
                    >
                      Browse All Tournaments
                    </Link>
                  </div>
                )}
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </>
  );
}

export default withAuth(JoinTournamentPage);
