import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  History,
  ChevronRight,
  ChevronLeft,
  Eye,
  Filter,
  X,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  Code,
  Target,
  Cpu,
  CheckCircle
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { config } from '../config/env';
import { authFetch } from '../utils/fetch';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import AgentModuleChips from '../components/AgentModuleChips';
import withAuth from '../components/withAuth';
import { CardSkeleton, StatsSkeleton } from '../components/ui/Skeleton';
import EmptyState from '../components/EmptyState';
import AgentBattlesGate from '../components/AgentBattlesGate'

const MODEL_INFO = {
  haiku: { name: 'Haiku', color: 'text-green-400', bgColor: 'bg-green-500/10' },
  sonnet: { name: 'Sonnet', color: 'text-primary-400', bgColor: 'bg-primary-500/10' },
  opus: { name: 'Opus', color: 'text-purple-400', bgColor: 'bg-purple-500/10' }
};

const OUTCOME_FILTERS = [
  { value: 'all', label: 'All Battles', icon: Target },
  { value: 'wins', label: 'Wins', icon: CheckCircle },
  { value: 'losses', label: 'Losses', icon: X }
];

function AgentHistory() {
  const router = useRouter();
  const { user, token } = useAuth();

  // State
  const [battles, setBattles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Filters
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  // Stats
  const [stats, setStats] = useState({
    totalBattles: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    winRate: 0
  });

  // Fetch battles
  useEffect(() => {
    if (!token) return;

    const fetchBattles = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await authFetch(
          `${config.backend_url}/api/agent/battles/history?page=${currentPage}&limit=20&outcome=${outcomeFilter}`
        );

        if (!response.ok) {
          throw new Error('Failed to load battle history');
        }

        const data = await response.json();
        setBattles(data.battles);
        setCurrentPage(data.pagination.page);
        setTotalPages(data.pagination.totalPages);
        setTotal(data.pagination.total);
        setLoading(false);
      } catch (err) {
        console.error('Error loading battle history:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    fetchBattles();
  }, [token, currentPage, outcomeFilter]);

  // Calculate stats from all battles (fetch separately or compute from visible)
  useEffect(() => {
    if (!token) return;

    const fetchStats = async () => {
      try {
        const response = await authFetch(
          `${config.backend_url}/api/agent/battles/history?page=1&limit=1000&outcome=all`
        );

        if (response.ok) {
          const data = await response.json();
          const allBattles = data.battles;

          const wins = allBattles.filter(b => b.outcome === 'win').length;
          const losses = allBattles.filter(b => b.outcome === 'loss').length;
          const draws = allBattles.filter(b => b.outcome === 'draw').length;
          const winRate = allBattles.length > 0 ? (wins / allBattles.length * 100).toFixed(1) : 0;

          setStats({
            totalBattles: allBattles.length,
            wins,
            losses,
            draws,
            winRate: parseFloat(winRate)
          });
        }
      } catch (err) {
        console.error('Error fetching stats:', err);
      }
    };

    fetchStats();
  }, [token]);

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleViewBattle = (battleId) => {
    router.push(`/agent-replay/${battleId}`);
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  const BattleCard = ({ battle }) => {
    const modelInfo = MODEL_INFO[battle.opponent.loadout.model] || MODEL_INFO.sonnet;
    const isWin = battle.outcome === 'win';
    const isDraw = battle.outcome === 'draw';
    const userModules = battle.userLoadout?.modules || battle.userLoadout?.tools || [];
    const opponentModules = battle.opponent?.loadout?.modules || battle.opponent?.loadout?.tools || [];

    const OutcomeIcon = isWin ? CheckCircle : isDraw ? Minus : X;
    const outcomeColor = isWin
      ? 'text-success border-success/30 bg-success/10'
      : isDraw
      ? 'text-warning border-warning/30 bg-warning/10'
      : 'text-error border-error/30 bg-error/10';

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ scale: 1.01 }}
        className="mb-4"
      >
        <Card
          variant="glass"
          className={`p-4 cursor-pointer transition-all duration-200 hover:border-primary-500/50 ${
            isWin ? 'bg-success/5' : isDraw ? 'bg-warning/5' : 'bg-error/5'
          }`}
          onClick={() => handleViewBattle(battle.id)}
        >
          <div className="flex items-center justify-between">
            {/* Left: Outcome Badge */}
            <div className="flex items-center space-x-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${outcomeColor}`}>
                <OutcomeIcon className="h-6 w-6" />
              </div>

              {/* Battle Info */}
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-1">
                  <span className="font-semibold text-white">vs {battle.opponent.username}</span>
                  <div className={`px-2 py-0.5 rounded text-xs ${modelInfo.bgColor} ${modelInfo.color}`}>
                    <span>{modelInfo.name}</span>
                  </div>
                </div>

                <div className="flex items-center space-x-4 text-sm text-surface-400">
                  <div className="flex items-center space-x-1">
                    <Clock className="h-3 w-3" />
                    <span>{formatDate(battle.createdAt)}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Code className="h-3 w-3" />
                    <span>{battle.userLoadout.language}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Target className="h-3 w-3" />
                    <span>{battle.testsPassed || 0} tests passed</span>
                  </div>
                  {battle.tokensUsed > 0 && (
                    <div className="flex items-center space-x-1">
                      <Cpu className="h-3 w-3" />
                      <span>{battle.tokensUsed.toLocaleString()} tokens</span>
                    </div>
                  )}
                </div>

                {(userModules.length > 0 || opponentModules.length > 0) && (
                  <div className="mt-3 space-y-2">
                    <AgentModuleChips
                      label="Your Loadout"
                      modules={userModules}
                      maxVisible={3}
                    />
                    <AgentModuleChips
                      label="Opponent"
                      modules={opponentModules}
                      maxVisible={3}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Right: ELO Change & Action */}
            <div className="flex items-center space-x-4">
              {battle.eloChange !== undefined && battle.eloChange !== 0 && (
                <div className="flex items-center space-x-1">
                  {battle.eloChange > 0 ? (
                    <TrendingUp className="h-4 w-4 text-success" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-error" />
                  )}
                  <span
                    className={`font-bold ${
                      battle.eloChange > 0 ? 'text-success' : 'text-error'
                    }`}
                  >
                    {battle.eloChange > 0 ? '+' : ''}
                    {battle.eloChange}
                  </span>
                </div>
              )}

              <div className="flex items-center space-x-2 text-primary-400">
                <Eye className="h-4 w-4" />
                <span className="text-sm">View Replay</span>
                <ChevronRight className="h-4 w-4" />
              </div>
            </div>
          </div>
        </Card>
      </motion.div>
    );
  };

  return (
    <>
      <Head>
        <title>Agent Battle History - CodeArena</title>
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">

        <div className="relative z-10 max-w-6xl mx-auto px-6 py-8">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div>
                  <h1 className="text-3xl font-bold">Agent Battle History</h1>
                  <p className="text-surface-400">Review your past agent battles</p>
                </div>
              </div>

              <Button
                variant="secondary"
                onClick={() => router.push('/agent-battles')}
                className="flex items-center space-x-2"
              >
                <span>Back to Agent Battles</span>
              </Button>
            </div>
          </motion.div>

          {/* Stats Cards */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8"
          >
            <Card variant="glass" className="p-4">
              <div className="text-surface-400 text-sm mb-1">Total Battles</div>
              <div className="text-2xl font-bold text-white">{stats.totalBattles}</div>
            </Card>

            <Card variant="glass" className="p-4">
              <div className="text-surface-400 text-sm mb-1">Wins</div>
              <div className="text-2xl font-bold text-success">{stats.wins}</div>
            </Card>

            <Card variant="glass" className="p-4">
              <div className="text-surface-400 text-sm mb-1">Losses</div>
              <div className="text-2xl font-bold text-error">{stats.losses}</div>
            </Card>

            <Card variant="glass" className="p-4">
              <div className="text-surface-400 text-sm mb-1">Draws</div>
              <div className="text-2xl font-bold text-warning">{stats.draws}</div>
            </Card>

            <Card variant="glass" className="p-4">
              <div className="text-surface-400 text-sm mb-1">Win Rate</div>
              <div className="text-2xl font-bold text-primary-400">{stats.winRate}%</div>
            </Card>
          </motion.div>

          {/* Filters */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mb-6"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Filter className="h-5 w-5 text-surface-400" />
                <span className="text-sm text-surface-400">Filter by outcome:</span>
              </div>
            </div>

            <div className="flex gap-3">
              {OUTCOME_FILTERS.map((filter) => {
                const FilterIcon = filter.icon;
                const isActive = outcomeFilter === filter.value;

                return (
                  <button
                    key={filter.value}
                    onClick={() => {
                      setOutcomeFilter(filter.value);
                      setCurrentPage(1);
                    }}
                    className={`flex-1 px-4 py-3 rounded-lg border transition-all ${
                      isActive
                        ? 'border-primary-500 bg-primary-500/20 text-primary-400'
                        : 'border-surface-700 bg-surface-800/50 text-surface-400 hover:border-surface-600'
                    }`}
                  >
                    <div className="flex items-center justify-center space-x-2">
                      <FilterIcon className="h-4 w-4" />
                      <span className="font-medium">{filter.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>

          {/* Battle List */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            {loading ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            ) : error ? (
              <Card variant="glass" className="p-8 text-center">
                <div className="text-error mb-2">Error loading battles</div>
                <div className="text-surface-400 text-sm">{error}</div>
              </Card>
            ) : battles.length === 0 ? (
              <EmptyState
                icon="🤖"
                title="No battles found"
                description={
                  outcomeFilter === 'all'
                    ? "You haven't participated in any agent battles yet."
                    : `No ${outcomeFilter} found. Try a different filter.`
                }
                action={
                  <Button
                    variant="primary"
                    onClick={() => router.push('/agent-battles')}
                    className="flex items-center space-x-2 mx-auto"
                  >
                    <span>Start Your First Battle</span>
                  </Button>
                }
              />
            ) : (
              <>
                <div className="mb-4">
                  <div className="text-sm text-surface-400">
                    Showing {battles.length} of {total} battles
                  </div>
                </div>

                <AnimatePresence mode="wait">
                  {battles.map((battle, index) => (
                    <BattleCard key={battle.id} battle={battle} />
                  ))}
                </AnimatePresence>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center space-x-2 mt-8">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="flex items-center space-x-1"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span>Previous</span>
                    </Button>

                    <div className="flex items-center space-x-2">
                      {[...Array(totalPages)].map((_, i) => {
                        const pageNum = i + 1;
                        // Show first, last, current, and pages around current
                        if (
                          pageNum === 1 ||
                          pageNum === totalPages ||
                          Math.abs(pageNum - currentPage) <= 1
                        ) {
                          return (
                            <button
                              key={pageNum}
                              onClick={() => handlePageChange(pageNum)}
                              className={`w-10 h-10 rounded-lg font-medium transition-all ${
                                currentPage === pageNum
                                  ? 'bg-primary-500 text-white'
                                  : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                              }`}
                            >
                              {pageNum}
                            </button>
                          );
                        } else if (
                          pageNum === currentPage - 2 ||
                          pageNum === currentPage + 2
                        ) {
                          return (
                            <span key={pageNum} className="text-surface-600">
                              ...
                            </span>
                          );
                        }
                        return null;
                      })}
                    </div>

                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="flex items-center space-x-1"
                    >
                      <span>Next</span>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </motion.div>
        </div>
      </div>
    </>
  );
}

const AgentPage = withAuth(AgentHistory);
export default function AgentPageGated(props) {
  return <AgentBattlesGate><AgentPage {...props} /></AgentBattlesGate>
}
