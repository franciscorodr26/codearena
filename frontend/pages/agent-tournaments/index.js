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
  Sword as Swords,
  ChevronRight,
  Filter,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { config } from '../../config/env';
import FloatingOrbs from '../../components/ui/FloatingOrbs';
import Card from '../../components/ui/Card';
import withAuth from '../../components/withAuth';
import AgentBattlesGate from '../../components/AgentBattlesGate'

const AgentTournamentsPage = () => {
  const router = useRouter();
  const { user } = useAuth();

  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('upcoming'); // 'all', 'upcoming', 'in_progress', 'completed'

  useEffect(() => {
    fetchTournaments();
  }, [filter]);

  const fetchTournaments = async () => {
    try {
      setLoading(true);
      setError(null);

      const statusParam = filter === 'all' ? '' : `?status=${filter}`;
      const response = await fetch(`${config.backend_url}/api/agent/tournaments${statusParam}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch tournaments');
      }

      const data = await response.json();
      setTournaments(data.tournaments || []);
    } catch (err) {
      console.error('Error fetching tournaments:', err);
      setError(err.message);
    } finally {
      setLoading(false);
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
      <span className={`px-2 py-1 rounded-lg text-xs font-medium border ${config.color}`}>
        {config.label}
      </span>
    );
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getFormatIcon = (format) => {
    switch (format) {
      case 'single_elimination':
        return '🏆';
      case 'double_elimination':
        return '🎯';
      case 'round_robin':
        return '🔄';
      default:
        return '🏆';
    }
  };

  return (
    <>
      <Head>
        <title>Agent Tournaments - CodeArena</title>
        <meta name="description" content="Compete in AI agent coding tournaments" />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950 text-white">
        <FloatingOrbs />

        <div className="container mx-auto px-4 py-8 relative z-10">
          {/* Header */}
          <div className="mb-8">
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between mb-4"
            >
              <div>
                <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-primary-400 to-secondary-400 bg-clip-text text-transparent">
                  Agent Tournaments
                </h1>
                <p className="text-surface-300">
                  Compete with your AI agents in structured tournaments
                </p>
              </div>
            </motion.div>

            {/* Filters */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="flex flex-wrap gap-2"
            >
              {[
                { value: 'all', label: 'All' },
                { value: 'upcoming', label: 'Upcoming' },
                { value: 'in_progress', label: 'In Progress' },
                { value: 'completed', label: 'Completed' }
              ].map((filterOption) => (
                <button
                  key={filterOption.value}
                  onClick={() => setFilter(filterOption.value)}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    filter === filterOption.value
                      ? 'bg-primary-500 text-white'
                      : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
                  }`}
                >
                  {filterOption.label}
                </button>
              ))}
            </motion.div>
          </div>

          {/* Loading State */}
          {loading && (
            <div className="flex justify-center items-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
              <span className="ml-3 text-surface-300">Loading tournaments...</span>
            </div>
          )}

          {/* Error State */}
          {error && (
            <Card className="bg-error-500/10 border-error-500/30 p-6">
              <div className="flex items-center gap-3 text-error-400">
                <AlertCircle className="w-5 h-5" />
                <p>{error}</p>
              </div>
            </Card>
          )}

          {/* Tournaments List */}
          {!loading && !error && (
            <div className="space-y-4">
              {tournaments.length === 0 ? (
                <Card className="p-12 text-center">
                  <Trophy className="w-16 h-16 mx-auto mb-4 text-surface-500" />
                  <h3 className="text-xl font-semibold mb-2 text-surface-200">No tournaments found</h3>
                  <p className="text-surface-400">
                    {filter === 'upcoming'
                      ? 'No upcoming tournaments at the moment. Check back soon!'
                      : 'Try changing your filter to see more tournaments.'}
                  </p>
                </Card>
              ) : (
                tournaments.map((tournament, index) => (
                  <motion.div
                    key={tournament.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <Card
                      className="p-6 hover:bg-surface-800/50 transition-all cursor-pointer group"
                      onClick={() => router.push(`/agent-tournaments/${tournament.id}`)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            <span className="text-2xl">{getFormatIcon(tournament.format)}</span>
                            <h3 className="text-xl font-bold group-hover:text-primary-400 transition-colors">
                              {tournament.name}
                            </h3>
                            {getStatusBadge(tournament.status)}
                          </div>

                          {tournament.description && (
                            <p className="text-surface-300 mb-4">{tournament.description}</p>
                          )}

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="flex items-center gap-2 text-sm text-surface-400">
                              <Calendar className="w-4 h-4" />
                              <span>{formatDate(tournament.start_time)}</span>
                            </div>

                            <div className="flex items-center gap-2 text-sm text-surface-400">
                              <Users className="w-4 h-4" />
                              <span>
                                {tournament.participant_count} / {tournament.max_participants} players
                              </span>
                            </div>

                            <div className="flex items-center gap-2 text-sm text-surface-400">
                              <Swords className="w-4 h-4" />
                              <span className="capitalize">{tournament.format.replace('_', ' ')}</span>
                            </div>

                            {tournament.prize_pool > 0 && (
                              <div className="flex items-center gap-2 text-sm text-yellow-400">
                                <Award className="w-4 h-4" />
                                <span>${tournament.prize_pool} Prize</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <ChevronRight className="w-6 h-6 text-surface-500 group-hover:text-primary-400 transition-colors" />
                      </div>
                    </Card>
                  </motion.div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

const AgentPage = withAuth(AgentTournamentsPage);
export default function AgentPageGated(props) {
  return <AgentBattlesGate><AgentPage {...props} /></AgentBattlesGate>
}
