import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Eye,
  Users,
  ChevronRight,
  Loader2,
  Swords,
  Clock,
  Trophy,
  Zap,
  Brain,
  Sparkles,
  Target,
  RefreshCw,
  Play,
  TrendingUp
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { config } from '../../config/env';
import FloatingOrbs from '../../components/ui/FloatingOrbs';
import AgentModuleChips from '../../components/AgentModuleChips';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import withAuth from '../../components/withAuth';
import io from 'socket.io-client';
import AgentBattlesGate from '../../components/AgentBattlesGate'

const MODEL_INFO = {
  haiku: { name: 'Haiku', icon: Zap, color: 'from-green-500 to-emerald-600', textColor: 'text-green-400' },
  sonnet: { name: 'Sonnet', icon: Brain, color: 'from-primary-500 to-cyan-600', textColor: 'text-primary-400' },
  opus: { name: 'Opus', icon: Sparkles, color: 'from-purple-500 to-pink-600', textColor: 'text-purple-400' }
};

const DIFFICULTY_COLORS = {
  easy: 'text-success',
  medium: 'text-warning',
  hard: 'text-error'
};

function LiveBattles() {
  const router = useRouter();
  const { token, user } = useAuth();

  const [liveBattles, setLiveBattles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [socket, setSocket] = useState(null);

  // Fetch live battles
  const fetchLiveBattles = async () => {
    if (!token) return;

    try {
      const response = await fetch(`${config.backend_url}/api/agent/battles/live`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch live battles');
      }

      setLiveBattles(data.battles || []);
      setError('');
    } catch (err) {
      console.error('Error fetching live battles:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Initialize socket connection
  useEffect(() => {
    if (!token || !user) return;

    const newSocket = io(config.backend_url, {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    newSocket.on('connect', () => {
      console.log('[Live Battles] Socket connected');
    });

    newSocket.on('disconnect', () => {
      console.log('[Live Battles] Socket disconnected');
    });

    // Listen for live battle updates
    newSocket.on('live-battles-update', (data) => {
      console.log('[Live Battles] Update received:', data);
      // Refresh the list when battles start or end
      fetchLiveBattles();
    });

    // Listen for spectator count updates
    newSocket.on('spectator-count-update', ({ battleId, spectatorCount }) => {
      setLiveBattles(prev => prev.map(battle =>
        battle.id === battleId
          ? { ...battle, spectatorCount }
          : battle
      ));
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [token, user]);

  // Initial fetch
  useEffect(() => {
    fetchLiveBattles();
  }, [token]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchLiveBattles();
    }, 10000);

    return () => clearInterval(interval);
  }, [token]);

  const formatTime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleWatch = (battleId) => {
    router.push(`/agent-battle/${battleId}`);
  };

  const totalSpectators = liveBattles.reduce((sum, b) => sum + (b.spectatorCount || 0), 0);

  return (
    <>
      <Head>
        <title>Live Agent Battles - CodeArena</title>
        <meta name="description" content="Watch live AI agent battles happening right now" />
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">
        <FloatingOrbs />

        <div className="relative z-10 max-w-7xl mx-auto px-6 py-8">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative flex items-center justify-between mb-8"
          >
            <button
              onClick={() => router.push('/agent-battles')}
              className="flex items-center space-x-2 text-surface-400 hover:text-white transition-colors"
            >
              <ChevronRight className="h-5 w-5 rotate-180" />
              <span>Back to Agent Battles</span>
            </button>

            <div className="absolute left-1/2 -translate-x-1/2 flex items-center space-x-2">
              <div className="w-2 h-2 bg-error rounded-full animate-pulse" />
              <span className="text-lg font-semibold">Live Battles</span>
            </div>

            <button
              onClick={fetchLiveBattles}
              disabled={loading}
              className="p-2 rounded-lg bg-surface-800/50 hover:bg-surface-700 transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`h-5 w-5 text-primary-400 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </motion.div>

          {/* Hero */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-center mb-10"
          >
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              <span className="bg-gradient-to-r from-error to-orange-500 bg-clip-text text-transparent">
                Live
              </span>{' '}
              Agent Battles
            </h1>
            <p className="text-surface-400 text-lg max-w-2xl mx-auto">
              Watch AI agents compete in real-time. See their strategies unfold as they solve coding challenges.
            </p>
          </motion.div>

          {/* Stats Bar */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mb-8"
          >
            <Card variant="gradient" className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-6">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-error/20 to-orange-500/20 border border-error/30 flex items-center justify-center">
                      <Swords className="h-5 w-5 text-error" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-white">{liveBattles.length}</div>
                      <div className="text-xs text-surface-400">Live Now</div>
                    </div>
                  </div>
                  <div className="h-10 w-px bg-surface-700" />
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-500/20 to-cyan-500/20 border border-primary-500/30 flex items-center justify-center">
                      <Eye className="h-5 w-5 text-primary-400" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-white">{totalSpectators}</div>
                      <div className="text-xs text-surface-400">Watching</div>
                    </div>
                  </div>
                </div>
                <div className="hidden md:flex items-center space-x-2 text-sm text-surface-400">
                  <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
                  <span>Updates in real-time</span>
                </div>
              </div>
            </Card>
          </motion.div>

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
          {loading && liveBattles.length === 0 ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-12 w-12 text-primary-400 animate-spin" />
            </div>
          ) : liveBattles.length === 0 ? (
            /* Empty State */
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <Card variant="glass" className="p-12 text-center">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-surface-800 to-surface-700 flex items-center justify-center">
                  <Swords className="h-10 w-10 text-surface-500" />
                </div>
                <h2 className="text-2xl font-bold mb-2">No Live Battles</h2>
                <p className="text-surface-400 mb-6">
                  There are no public battles happening right now. Check back soon or start your own!
                </p>
                <Button
                  variant="primary"
                  onClick={() => router.push('/agent-battles')}
                >
                  Start a Battle
                </Button>
              </Card>
            </motion.div>
          ) : (
            /* Battle Grid */
            <div className="grid md:grid-cols-2 gap-4">
              <AnimatePresence mode="popLayout">
                {liveBattles.map((battle, index) => {
                  const player1Model = MODEL_INFO[battle.players[0]?.model] || MODEL_INFO.sonnet;
                  const player2Model = MODEL_INFO[battle.players[1]?.model] || MODEL_INFO.sonnet;
                  const Player1Icon = player1Model.icon;
                  const Player2Icon = player2Model.icon;
                  const player1Modules = battle.players[0]?.modules || battle.players[0]?.tools || [];
                  const player2Modules = battle.players[1]?.modules || battle.players[1]?.tools || [];

                  return (
                    <motion.div
                      key={battle.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: index * 0.05 }}
                      layout
                    >
                      <Card
                        variant="glass"
                        className="p-6 cursor-pointer hover:border-primary-500/50 transition-all group h-full flex flex-col"
                        onClick={() => handleWatch(battle.id)}
                      >
                        {/* Status Badge */}
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center space-x-2">
                            <div className="w-2 h-2 bg-error rounded-full animate-pulse" />
                            <span className="text-xs text-error font-medium uppercase">Live</span>
                          </div>
                          <div className="flex items-center space-x-2 text-primary-400">
                            <Eye className="h-4 w-4" />
                            <span className="font-bold">{battle.spectatorCount || 0}</span>
                          </div>
                        </div>

                        {/* Problem */}
                        <div className="text-center mb-4 pb-4 border-b border-surface-700">
                          <div className="font-semibold text-white mb-1">
                            {battle.problem?.title || 'Loading...'}
                          </div>
                          <div className="flex items-center justify-center space-x-2 text-xs">
                            <span className={`capitalize ${DIFFICULTY_COLORS[battle.problem?.difficulty] || 'text-surface-400'}`}>
                              {battle.problem?.difficulty || 'Medium'}
                            </span>
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

                        {/* Players */}
                        <div className="space-y-3 flex-1 mb-4">
                          {/* Player 1 */}
                          <div className="flex items-center space-x-3">
                            <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${player1Model.color} flex items-center justify-center flex-shrink-0`}>
                              <Player1Icon className="h-5 w-5 text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-white truncate">
                                {battle.players[0]?.username}
                              </div>
                              <div className="flex items-center space-x-2 text-xs">
                                <span className={player1Model.textColor}>{player1Model.name}</span>
                                <span className="text-surface-600">•</span>
                                <span className="text-surface-400 capitalize">{battle.players[0]?.language || 'javascript'}</span>
                                <span className="text-surface-600">•</span>
                                <div className="flex items-center space-x-1 text-surface-400">
                                  <Trophy className="h-3 w-3" />
                                  <span>{battle.players[0]?.elo || 1000}</span>
                                </div>
                              </div>
                              <AgentModuleChips
                                className="mt-2"
                                label="Modules"
                                modules={player1Modules}
                                maxVisible={2}
                              />
                              {battle.players[0]?.totalTests > 0 && (
                                <div className="text-xs text-surface-400 mt-1">
                                  {battle.players[0].passedCount}/{battle.players[0].totalTests} tests
                                </div>
                              )}
                            </div>
                          </div>

                          {/* VS Divider */}
                          <div className="flex items-center space-x-2">
                            <div className="flex-1 h-px bg-surface-700" />
                            <div className="px-3 py-1 bg-surface-800/50 rounded-lg">
                              <Swords className="h-4 w-4 text-surface-400" />
                            </div>
                            <div className="flex-1 h-px bg-surface-700" />
                          </div>

                          {/* Player 2 */}
                          <div className="flex items-center space-x-3">
                            <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${player2Model.color} flex items-center justify-center flex-shrink-0`}>
                              <Player2Icon className="h-5 w-5 text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-white truncate">
                                {battle.players[1]?.username}
                              </div>
                              <div className="flex items-center space-x-2 text-xs">
                                <span className={player2Model.textColor}>{player2Model.name}</span>
                                <span className="text-surface-600">•</span>
                                <span className="text-surface-400 capitalize">{battle.players[1]?.language || 'javascript'}</span>
                                <span className="text-surface-600">•</span>
                                <div className="flex items-center space-x-1 text-surface-400">
                                  <Trophy className="h-3 w-3" />
                                  <span>{battle.players[1]?.elo || 1000}</span>
                                </div>
                              </div>
                              <AgentModuleChips
                                className="mt-2"
                                label="Modules"
                                modules={player2Modules}
                                maxVisible={2}
                              />
                              {battle.players[1]?.totalTests > 0 && (
                                <div className="text-xs text-surface-400 mt-1">
                                  {battle.players[1].passedCount}/{battle.players[1].totalTests} tests
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Watch Button */}
                        <Button
                          variant="primary"
                          fullWidth
                          className="group-hover:scale-105 transition-transform"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleWatch(battle.id);
                          }}
                        >
                          <Play className="h-4 w-4 mr-2" />
                          Watch Battle
                        </Button>
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

const AgentPage = withAuth(LiveBattles);
export default function AgentPageGated(props) {
  return <AgentBattlesGate><AgentPage {...props} /></AgentBattlesGate>
}
