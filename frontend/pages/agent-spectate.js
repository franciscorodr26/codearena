import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Eye,
  ChevronRight,
  Clock,
  RefreshCw
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { config } from '../config/env';
import AgentModuleChips from '../components/AgentModuleChips';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import withAuth from '../components/withAuth';
import { CardSkeleton } from '../components/ui/Skeleton';
import EmptyState from '../components/EmptyState';
import AgentBattlesGate from '../components/AgentBattlesGate'

const MODEL_INFO = {
  haiku: { name: 'Haiku', color: 'bg-green-500/10 border-green-500/20', textColor: 'text-green-400' },
  sonnet: { name: 'Sonnet', color: 'bg-primary-500/10 border-primary-500/20', textColor: 'text-primary-400' },
  opus: { name: 'Opus', color: 'bg-purple-500/10 border-purple-500/20', textColor: 'text-purple-400' }
};

const DIFFICULTY_COLORS = {
  easy: 'text-success',
  medium: 'text-warning',
  hard: 'text-error'
};

function AgentSpectate() {
  const router = useRouter();
  const { token } = useAuth();

  const [activeBattles, setActiveBattles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchActiveBattles = async () => {
    if (!token) return;

    try {
      const response = await fetch(`${config.backend_url}/api/agent/battles/active`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch active battles');
      }

      setActiveBattles(data.battles || []);
      setError('');
    } catch (err) {
      console.error('Error fetching active battles:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActiveBattles();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Revived agent battle page kept as originally written: this hook intentionally runs on the listed values only.
  }, [token]);

  // Auto-refresh every 5 seconds if enabled
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchActiveBattles();
    }, 5000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Revived agent battle page kept as originally written: this hook intentionally runs on the listed values only.
  }, [autoRefresh, token]);

  const formatTime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSpectate = (battleId) => {
    router.push(`/agent-battle/${battleId}`);
  };

  return (
    <>
      <Head>
        <title>Spectate Agent Battles - CodeArena</title>
        <meta name="description" content="Watch live AI agent battles in real-time" />
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">

        <div className="relative z-10 max-w-6xl mx-auto px-6 py-8">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between mb-8"
          >
            <button
              onClick={() => router.push('/agent-battles')}
              className="flex items-center space-x-2 text-surface-400 hover:text-white transition-colors"
            >
              <ChevronRight className="h-5 w-5 rotate-180" />
              <span>Back to Agent Battles</span>
            </button>

            <div className="flex items-center space-x-2">
              <Eye className="h-6 w-6 text-primary-400" />
              <span className="text-lg font-semibold">Spectate Battles</span>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={fetchActiveBattles}
                disabled={loading}
                className="p-2 rounded-lg bg-surface-800/50 hover:bg-surface-700 transition-colors disabled:opacity-50"
                title="Refresh"
              >
                <RefreshCw className={`h-5 w-5 text-primary-400 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`px-3 py-2 rounded-lg transition-colors ${
                  autoRefresh
                    ? 'bg-success/20 text-success border border-success/30'
                    : 'bg-surface-800/50 text-surface-400 border border-surface-700'
                }`}
              >
                {autoRefresh ? 'Auto-Refresh On' : 'Auto-Refresh Off'}
              </button>
            </div>
          </motion.div>

          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">Live Battles</h1>
            <p className="text-surface-400 max-w-2xl mx-auto">
              Watch AI agents compete in real-time coding challenges.
            </p>
          </div>

          {/* Stats Bar */}
          <div className="mb-8">
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-6">
                  <div>
                    <div className="text-2xl font-bold text-white">{activeBattles.length}</div>
                    <div className="text-xs text-surface-400">Active Battles</div>
                  </div>
                  <div className="h-8 w-px bg-surface-700" />
                  <div>
                    <div className="text-2xl font-bold text-white">
                      {activeBattles.reduce((sum, b) => sum + (b.spectatorCount || 0), 0)}
                    </div>
                    <div className="text-xs text-surface-400">Total Spectators</div>
                  </div>
                </div>
                <div className="hidden md:block text-sm text-surface-400">
                  Updates every 5 seconds
                </div>
              </div>
            </Card>
          </div>

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-error/10 border border-error/30 rounded-xl p-4 mb-6 text-error"
            >
              {error}
            </motion.div>
          )}

          {/* Loading */}
          {loading && activeBattles.length === 0 ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : activeBattles.length === 0 ? (
            /* Empty State */
            <EmptyState
              icon="👁️"
              title="No Active Battles"
              description="There are no battles happening right now. Check back soon or start your own!"
              action={
                <Button
                  variant="primary"
                  onClick={() => router.push('/agent-battles')}
                >
                  Start a Battle
                </Button>
              }
            />
          ) : (
            /* Battle List */
            <div className="space-y-4">
              <AnimatePresence mode="popLayout">
                {activeBattles.map((battle, index) => {
                  const player1Model = MODEL_INFO[battle.players[0]?.model] || MODEL_INFO.sonnet;
                  const player2Model = MODEL_INFO[battle.players[1]?.model] || MODEL_INFO.sonnet;
                  const player1Modules = battle.players[0]?.modules || battle.players[0]?.tools || [];
                  const player2Modules = battle.players[1]?.modules || battle.players[1]?.tools || [];

                  return (
                    <motion.div
                      key={battle.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <Card
                        className="p-6 cursor-pointer hover:border-primary-500/30 transition-all group"
                        onClick={() => handleSpectate(battle.id)}
                      >
                        <div className="flex items-center justify-between gap-6">
                          {/* Left: Players */}
                          <div className="flex-1 flex items-center space-x-4">
                            {/* Player 1 */}
                            <div className="flex items-center space-x-3 flex-1">
                              <div className="flex-1">
                                <div className="font-semibold text-white">
                                  {battle.players[0]?.username || 'Player 1'}
                                </div>
                                <div className={`text-xs ${player1Model.textColor}`}>
                                  {player1Model.name} · <span className="capitalize">{battle.players[0]?.language || 'javascript'}</span>
                                </div>
                                <AgentModuleChips
                                  className="mt-2"
                                  label="Modules"
                                  modules={player1Modules}
                                  maxVisible={2}
                                />
                                {battle.state === 'running' && battle.players[0]?.totalTests > 0 && (
                                  <div className="text-xs text-surface-400 mt-1">
                                    {battle.players[0].passedCount}/{battle.players[0].totalTests} tests
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* VS */}
                            <div className="px-3 py-1 text-xs font-medium text-surface-500">
                              vs
                            </div>

                            {/* Player 2 */}
                            <div className="flex items-center space-x-3 flex-1 flex-row-reverse">
                              <div className="flex-1 text-right">
                                <div className="font-semibold text-white">
                                  {battle.players[1]?.username || 'Player 2'}
                                </div>
                                <div className={`text-xs ${player2Model.textColor}`}>
                                  {player2Model.name} · <span className="capitalize">{battle.players[1]?.language || 'javascript'}</span>
                                </div>
                                <AgentModuleChips
                                  className="mt-2"
                                  label="Modules"
                                  modules={player2Modules}
                                  maxVisible={2}
                                />
                                {battle.state === 'running' && battle.players[1]?.totalTests > 0 && (
                                  <div className="text-xs text-surface-400 mt-1">
                                    {battle.players[1].passedCount}/{battle.players[1].totalTests} tests
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Center: Problem & Status */}
                          <div className="flex-1 text-center">
                            <div className="font-medium text-white mb-1">
                              {battle.problem?.title || 'Loading...'}
                            </div>
                            <div className="flex items-center justify-center space-x-3 text-sm">
                              <span className={`capitalize ${DIFFICULTY_COLORS[battle.problem?.difficulty] || 'text-surface-400'}`}>
                                {battle.problem?.difficulty || 'Medium'}
                              </span>
                              <span className="text-surface-600">•</span>
                              {battle.state === 'running' ? (
                                <div className="flex items-center space-x-2">
                                  <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
                                  <span className="text-success">Live</span>
                                </div>
                              ) : (
                                <span className="text-warning">Starting...</span>
                              )}
                              {battle.startedAt && (
                                <>
                                  <span className="text-surface-600">•</span>
                                  <div className="flex items-center space-x-1 text-surface-400">
                                    <Clock className="h-3 w-3" />
                                    <span>{formatTime(battle.elapsedTime)}</span>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Right: Spectators & Action */}
                          <div className="flex items-center space-x-4">
                            <div className="text-center">
                              <div className="flex items-center space-x-2 text-primary-400 mb-1">
                                <Eye className="h-4 w-4" />
                                <span className="font-bold text-lg">{battle.spectatorCount || 0}</span>
                              </div>
                              <div className="text-xs text-surface-500">watching</div>
                            </div>

                            <Button
                              variant="primary"
                              size="sm"
                              className="group-hover:scale-105 transition-transform"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSpectate(battle.id);
                              }}
                            >
                              <Eye className="h-4 w-4 mr-2" />
                              Watch
                            </Button>
                          </div>
                        </div>
                      </Card>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const AgentPage = withAuth(AgentSpectate);
export default function AgentPageGated(props) {
  return <AgentBattlesGate><AgentPage {...props} /></AgentBattlesGate>
}
