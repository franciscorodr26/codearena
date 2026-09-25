import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Logo from '../../components/Logo';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  Code2,
  Users,
  Calendar,
  Clock,
  ChevronRight,
  Plus,
  ArrowLeft
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTournaments } from '../../contexts/TournamentContext';
import { withAuth } from '../../components/withAuth';
import Button from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { FadeIn } from '../../components/ui/Motion';
import CreateTournamentModal from '../../components/CreateTournamentModal';

const STATUS_CONFIG = {
  upcoming: { label: 'Upcoming', color: 'text-blue-400', dot: 'bg-blue-400' },
  registration_open: { label: 'Open', color: 'text-success', dot: 'bg-success' },
  registration_closed: { label: 'Closed', color: 'text-warning', dot: 'bg-warning' },
  in_progress: { label: 'Live', color: 'text-danger', dot: 'bg-danger' },
  completed: { label: 'Completed', color: 'text-surface-400', dot: 'bg-surface-400' }
};

const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
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

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

function TournamentCard({ tournament }) {
  const router = useRouter();
  const statusConfig = STATUS_CONFIG[tournament.status] || STATUS_CONFIG.upcoming;

  // Client-side only time display to avoid SSR hydration mismatch
  const [timeUntil, setTimeUntil] = useState(null);

  useEffect(() => {
    const updateTime = () => {
      if (tournament.status === 'registration_open') {
        setTimeUntil(getTimeUntil(tournament.registration_deadline));
      } else if (tournament.status === 'upcoming') {
        setTimeUntil(getTimeUntil(tournament.start_time));
      }
    };

    updateTime();
    // Update every minute for accuracy
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, [tournament.status, tournament.registration_deadline, tournament.start_time]);

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => router.push(`/tournaments/${tournament.id}`)}
      className="cursor-pointer"
    >
      <Card className="p-6 hover:border-primary-500/50 transition-all">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div>
              <h3 className="text-lg font-bold text-white">{tournament.name}</h3>
              <p className="text-sm text-surface-400">
                {tournament.format === 'single_elimination' ? 'Single Elimination' : tournament.format}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={`flex items-center gap-1.5 text-xs font-medium ${statusConfig.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`} />
              {statusConfig.label}
            </span>
          </div>
        </div>

        {tournament.description && (
          <p className="text-surface-400 text-sm mb-4 line-clamp-2">{tournament.description}</p>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm text-surface-400">
            <div className="flex items-center gap-1.5">
              <Users className="w-4 h-4" />
              <span>{tournament.participant_count}/{tournament.max_players}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              <span>{formatDate(tournament.start_time)}</span>
            </div>
          </div>

          {tournament.status === 'registration_open' && timeUntil && (
            <div className="flex items-center gap-1.5 text-success text-sm font-medium">
              <Clock className="w-4 h-4" />
              <span>Closes in {timeUntil}</span>
            </div>
          )}

          {tournament.status === 'upcoming' && timeUntil && (
            <div className="flex items-center gap-1.5 text-blue-400 text-sm font-medium">
              <Clock className="w-4 h-4" />
              <span>Starts in {timeUntil}</span>
            </div>
          )}

          {tournament.status === 'completed' && tournament.winner_username && (
            <div className="flex items-center gap-1.5 text-surface-300 text-sm font-medium">
              <span>Winner: {tournament.winner_username}</span>
            </div>
          )}
        </div>

        {tournament.prize_description && (
          <div className="mt-4 pt-4 border-t border-surface-700/50">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-surface-300">Prize: {tournament.prize_description}</span>
            </div>
          </div>
        )}
      </Card>
    </motion.div>
  );
}

function TournamentsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { fetchTournaments, fetchUserHistory } = useTournaments();

  const [activeTab, setActiveTab] = useState('upcoming');
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userStats, setUserStats] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const loadTournaments = useCallback(async () => {
    setLoading(true);
    try {
      let statusFilter;
      if (activeTab === 'upcoming') {
        statusFilter = 'upcoming,registration_open';
      } else if (activeTab === 'live') {
        statusFilter = 'in_progress';
      } else if (activeTab === 'completed') {
        statusFilter = 'completed';
      }

      const data = await fetchTournaments({ status: statusFilter, limit: 20 });
      setTournaments(data.tournaments || []);
    } catch (err) {
      console.error('Failed to load tournaments:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, fetchTournaments]);

  const loadUserStats = useCallback(async () => {
    const data = await fetchUserHistory();
    if (data.stats) {
      setUserStats(data.stats);
    }
  }, [fetchUserHistory]);

  useEffect(() => {
    loadTournaments();
    if (user) {
      loadUserStats();
    }
  }, [loadTournaments, loadUserStats, user]);

  const tabs = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'live', label: 'Live' },
    { id: 'completed', label: 'Completed' }
  ];

  return (
    <>
      <Head>
        <title>Tournaments - CodeArena</title>
      </Head>

      <div className="min-h-screen bg-background">

        {/* Header */}
        <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-surface-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Link href="/modes" className="flex items-center gap-2 text-surface-400 hover:text-white transition-colors group">
                  <ArrowLeft className="h-5 w-5 group-hover:-translate-x-1 transition-transform" />
                  <span className="font-medium">Back</span>
                </Link>
                <Link href="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
                  <Logo />
                </Link>
                <div className="flex items-center gap-3">
                  <div>
                    <h1 className="text-xl font-bold text-white">Tournaments</h1>
                    <p className="text-sm text-surface-400">Compete in bracket-style competitions</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                {user && userStats && (
                  <div className="flex items-center gap-4 px-4 py-2 bg-surface-800/50 rounded-xl border border-surface-700/50">
                    <div className="text-center">
                      <div className="text-lg font-bold text-white">{userStats.tournaments_played || 0}</div>
                      <div className="text-xs text-surface-400">Played</div>
                    </div>
                    <div className="w-px h-8 bg-surface-700" />
                    <div className="text-center">
                      <div className="text-lg font-bold text-warning">{userStats.tournaments_won || 0}</div>
                      <div className="text-xs text-surface-400">Won</div>
                    </div>
                    <div className="w-px h-8 bg-surface-700" />
                    <div className="text-center">
                      <div className="text-lg font-bold text-surface-300">{userStats.finals_reached || 0}</div>
                      <div className="text-xs text-surface-400">Finals</div>
                    </div>
                  </div>
                )}

                {user && (
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-primary-500 hover:bg-primary-400 text-white font-medium rounded-xl transition-colors"
                  >
                    <Plus className="w-5 h-5" />
                    <span className="hidden sm:inline">Create Tournament</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Tabs */}
          <div className="flex items-center gap-2 mb-8">
            {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all ${
                    activeTab === tab.id
                      ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                      : 'text-surface-400 hover:text-white hover:bg-surface-800/50'
                  }`}
                >
                  {tab.label}
                </button>
            ))}
          </div>

          {/* Tournament List */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-primary-400 animate-spin" />
            </div>
          ) : tournaments.length === 0 ? (
            <Card className="p-12 text-center">
              <h3 className="text-lg font-semibold text-white mb-2">No tournaments found</h3>
              <p className="text-surface-400">
                {activeTab === 'upcoming'
                  ? 'Check back soon for upcoming tournaments!'
                  : activeTab === 'live'
                  ? 'No tournaments are currently in progress.'
                  : 'No completed tournaments yet.'}
              </p>
            </Card>
          ) : (
            <div className="grid gap-4">
              <AnimatePresence mode="popLayout">
                {tournaments.map((tournament, index) => (
                  <FadeIn key={tournament.id} delay={index * 0.05}>
                    <TournamentCard tournament={tournament} />
                  </FadeIn>
                ))}
              </AnimatePresence>
            </div>
          )}
        </main>
      </div>

      <CreateTournamentModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </>
  );
}

export default withAuth(TournamentsPage);
