import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Cpu,
  Zap,
  Brain,
  Sparkles,
  Loader2,
  X,
  ChevronRight,
  Users,
  Clock,
  Swords,
  Shield,
  Target,
  AlertCircle,
  Timer,
  Volume2,
  VolumeX,
  Settings,
  TrendingUp,
  Activity
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { config } from '../config/env';
import FloatingOrbs from '../components/ui/FloatingOrbs';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import withAuth from '../components/withAuth';
import io from 'socket.io-client';
import { useGameSounds } from '../hooks/useGameSounds';
import AgentBattlesGate from '../components/AgentBattlesGate'

const MODEL_INFO = {
  haiku: { name: 'Haiku', icon: Zap, color: 'text-green-400' },
  sonnet: { name: 'Sonnet', icon: Brain, color: 'text-primary-400' },
  opus: { name: 'Opus', icon: Sparkles, color: 'text-purple-400' }
};

// Helper function to generate searching message based on preferences
function getSearchingMessage(prefs) {
  const parts = [];

  if (prefs.modelPreference !== 'any') {
    if (prefs.modelPreference === 'same-model-only') {
      parts.push('same model');
    } else {
      parts.push(`${prefs.modelPreference} model`);
    }
  }

  if (prefs.eloRange === 'similar') {
    parts.push('similar rating');
  } else if (prefs.eloRange === 'custom') {
    parts.push(`${prefs.customEloMin}-${prefs.customEloMax} ELO`);
  }

  if (prefs.difficulty !== 'any') {
    parts.push(`${prefs.difficulty} problems`);
  }

  if (parts.length === 0) {
    return 'Finding a worthy challenger for your agent';
  }

  return `Looking for opponents with ${parts.join(', ')}`;
}

function AgentMatchmaking() {
  const router = useRouter();
  const { user, token } = useAuth();

  // Sound effects
  const sounds = useGameSounds();

  // Get loadout from query params
  const {
    model = 'sonnet',
    language = 'python',
    modules = '',
    tools = '',
    prompt = '',
    quickStart = ''
  } = router.query;

  const selectedModules = typeof modules === 'string' && modules.length > 0
    ? modules.split(',')
    : (typeof tools === 'string' && tools.length > 0 ? tools.split(',') : []);

  const loadout = {
    model,
    language,
    modules: selectedModules,
    tools: selectedModules,
    systemPrompt: prompt ? decodeURIComponent(prompt) : ''
  };

  // Queue state
  const [isSearching, setIsSearching] = useState(false);
  const [queueTime, setQueueTime] = useState(0);
  const [queuePosition, setQueuePosition] = useState(null);
  const [playersInQueue, setPlayersInQueue] = useState(0);
  const [matchingPlayersCount, setMatchingPlayersCount] = useState(0);
  const [matchFound, setMatchFound] = useState(false);
  const [opponent, setOpponent] = useState(null);
  const [socket, setSocket] = useState(null);
  const [searchExpanded, setSearchExpanded] = useState(false);

  // Matchmaking preferences
  const [preferences, setPreferences] = useState(() => {
    // Load from localStorage if available
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('agentMatchmakingPreferences');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error('Failed to parse saved preferences:', e);
        }
      }
    }
    return {
      modelPreference: 'any',
      eloRange: 'any',
      customEloMin: 800,
      customEloMax: 1200,
      difficulty: 'any'
    };
  });

  // Rate limit state
  const [rateLimit, setRateLimit] = useState(null);
  const [rateLimitError, setRateLimitError] = useState(null);
  const [queueError, setQueueError] = useState(null);

  // Initialize socket connection — wait for token before connecting
  useEffect(() => {
    if (!token) return;

    const newSocket = io(config.backend_url, {
      auth: { token }
    });

    newSocket.on('connect', () => {
      console.log('Connected to agent matchmaking');
    });

    newSocket.on('agent-queue-update', (data) => {
      setPlayersInQueue(data.playersInQueue);
      setQueuePosition(data.position);
      setMatchingPlayersCount(data.matchingPlayersCount || 0);
      if (data.rateLimit) {
        setRateLimit(data.rateLimit);
      }
    });

    newSocket.on('agent-search-expanded', (data) => {
      setSearchExpanded(true);
      console.log('Search expanded:', data.message);
    });

    newSocket.on('agent-match-found', (data) => {
      setMatchFound(true);
      setOpponent(data.opponent);
      // Play match found sound
      sounds.matchFound();
      // Redirect to battle after short delay
      setTimeout(() => {
        router.push(`/agent-battle/${data.battleId}`);
      }, 2000);
    });

    // Error handlers
    newSocket.on('agent-queue-error', (data) => {
      console.error('Agent queue error:', data.error);
      setIsSearching(false);

      // Handle rate limit errors
      if (data.rateLimitExceeded) {
        setRateLimitError({
          message: data.error,
          limit: data.limit,
          remaining: data.remaining,
          minutesUntilReset: data.minutesUntilReset
        });
      } else if (data.spendingLimitExceeded) {
        // Handle spending limit errors
        setRateLimitError({
          message: data.error || 'Daily or monthly spending limit reached',
          limit: data.dailyLimit || data.monthlyLimit,
          remaining: 0,
          minutesUntilReset: null
        });
      } else {
        // Show generic queue errors
        setQueueError(data.error || 'Failed to join queue. Please try again.');
      }
    });

    newSocket.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
      setQueueError('Connection failed. Please check your internet and try again.');
    });

    newSocket.on('agent-battle-error', (data) => {
      console.error('Agent battle error:', data.error);
      setIsSearching(false);
      setMatchFound(false);
      setQueueError(data.error || 'Battle error occurred.');
    });

    // Handle match creation errors — without this, users get stuck searching forever
    newSocket.on('agent-match-error', (data) => {
      console.error('Agent match error:', data.error);
      setIsSearching(false);
      setMatchFound(false);
      setQueueError(data.error || 'Match creation failed. Please try again.');
    });

    setSocket(newSocket);

    return () => {
      // Leave queue before closing socket
      if (newSocket.connected) {
        newSocket.emit('leave-agent-queue');
      }
      newSocket.close();
    };
  }, [token]);

  // Queue timer
  useEffect(() => {
    let interval;
    if (isSearching && !matchFound) {
      interval = setInterval(() => {
        setQueueTime(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isSearching, matchFound]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const joinQueue = useCallback(() => {
    if (!socket) return;

    setIsSearching(true);
    setQueueTime(0);
    setSearchExpanded(false);
    setRateLimitError(null);
    setQueueError(null);

    // Save preferences to localStorage
    localStorage.setItem('agentMatchmakingPreferences', JSON.stringify(preferences));

    socket.emit('join-agent-queue', {
      loadout: {
        model: loadout.model,
        language: loadout.language,
        modules: loadout.modules,
        tools: loadout.tools,
        systemPrompt: loadout.systemPrompt
      },
      preferences
    });
  }, [socket, loadout, preferences]);

  // Auto-start queue for quickStart — wait for router to hydrate query params
  const quickStartTriggered = useRef(false);
  useEffect(() => {
    if (!router.isReady) return;
    if (quickStart === 'true' && socket && !quickStartTriggered.current && !isSearching && !matchFound) {
      quickStartTriggered.current = true;
      const timer = setTimeout(() => joinQueue(), 500);
      return () => clearTimeout(timer);
    }
  }, [router.isReady, quickStart, socket, isSearching, matchFound, joinQueue]);

  const leaveQueue = useCallback(() => {
    if (!socket) return;

    setIsSearching(false);
    setQueueTime(0);
    setQueuePosition(null);

    socket.emit('leave-agent-queue');
  }, [socket]);

  const goBack = () => {
    if (isSearching) {
      leaveQueue();
    }
    router.push('/agent-battles');
  };

  const ModelIcon = MODEL_INFO[loadout.model]?.icon || Brain;

  return (
    <>
      <Head>
        <title>Agent Matchmaking - CodeArena</title>
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">
        <FloatingOrbs />

        <div className="relative z-10 max-w-2xl mx-auto px-6 py-8">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between mb-8"
          >
            <button
              onClick={goBack}
              className="flex items-center space-x-2 text-surface-400 hover:text-white transition-colors"
            >
              <ChevronRight className="h-5 w-5 rotate-180" />
              <span>Back to Loadout</span>
            </button>

            <div className="flex items-center space-x-4">
              <button
                onClick={sounds.toggleSound}
                className="p-2 rounded-lg bg-surface-800/50 hover:bg-surface-700 transition-colors"
                title={sounds.soundEnabled ? 'Mute sounds' : 'Unmute sounds'}
              >
                {sounds.soundEnabled ? (
                  <Volume2 className="h-4 w-4 text-primary-400" />
                ) : (
                  <VolumeX className="h-4 w-4 text-surface-500" />
                )}
              </button>
              <div className="flex items-center space-x-2">
                <Bot className="h-6 w-6 text-secondary-400" />
                <span className="text-lg font-semibold">Agent Battle</span>
              </div>
            </div>
          </motion.div>

          {/* Loadout Summary */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card variant="glass" className="p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center space-x-2">
                <Shield className="h-5 w-5 text-primary-400" />
                <span>Your Agent</span>
              </h2>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg bg-surface-800 ${MODEL_INFO[loadout.model]?.color}`}>
                    <ModelIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-xs text-surface-500">Model</div>
                    <div className="font-medium capitalize">{MODEL_INFO[loadout.model]?.name}</div>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <div className="p-2 rounded-lg bg-surface-800 text-primary-400">
                    <Cpu className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-xs text-surface-500">Language</div>
                    <div className="font-medium capitalize">{loadout.language}</div>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <div className="p-2 rounded-lg bg-surface-800 text-success">
                    <Target className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-xs text-surface-500">Modules</div>
                    <div className="font-medium">{loadout.modules.length || 'None'}</div>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <div className="p-2 rounded-lg bg-surface-800 text-warning">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-xs text-surface-500">Queue Time</div>
                    <div className="font-medium">{formatTime(queueTime)}</div>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Matchmaking Preferences */}
          {!isSearching && !matchFound && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <Card variant="glass" className="p-6 mb-6">
                <h2 className="text-lg font-semibold mb-4 flex items-center space-x-2">
                  <Settings className="h-5 w-5 text-secondary-400" />
                  <span>Matchmaking Preferences</span>
                </h2>

                <div className="space-y-4">
                  {/* Model Preference */}
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Opponent Model
                    </label>
                    <select
                      value={preferences.modelPreference}
                      onChange={(e) => setPreferences({ ...preferences, modelPreference: e.target.value })}
                      className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="any">Any Model</option>
                      <option value="same-model-only">Same as Mine ({MODEL_INFO[loadout.model]?.name})</option>
                      <option value="haiku">Haiku Only</option>
                      <option value="sonnet">Sonnet Only</option>
                      <option value="opus">Opus Only</option>
                    </select>
                  </div>

                  {/* ELO Range Preference */}
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      <div className="flex items-center space-x-2">
                        <TrendingUp className="h-4 w-4" />
                        <span>ELO Range</span>
                      </div>
                    </label>
                    <select
                      value={preferences.eloRange}
                      onChange={(e) => setPreferences({ ...preferences, eloRange: e.target.value })}
                      className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="any">Any Rating</option>
                      <option value="similar">Similar Rating (±200)</option>
                      <option value="custom">Custom Range</option>
                    </select>
                  </div>

                  {/* Custom ELO Range */}
                  {preferences.eloRange === 'custom' && (
                    <div className="grid grid-cols-2 gap-3 pl-6">
                      <div>
                        <label className="block text-xs text-surface-400 mb-1">Min ELO</label>
                        <input
                          type="number"
                          value={preferences.customEloMin}
                          onChange={(e) => setPreferences({ ...preferences, customEloMin: parseInt(e.target.value) || 0 })}
                          min="0"
                          max="3000"
                          className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-surface-400 mb-1">Max ELO</label>
                        <input
                          type="number"
                          value={preferences.customEloMax}
                          onChange={(e) => setPreferences({ ...preferences, customEloMax: parseInt(e.target.value) || 3000 })}
                          min="0"
                          max="3000"
                          className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                    </div>
                  )}

                  {/* Difficulty Preference */}
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      <div className="flex items-center space-x-2">
                        <Activity className="h-4 w-4" />
                        <span>Problem Difficulty</span>
                      </div>
                    </label>
                    <select
                      value={preferences.difficulty}
                      onChange={(e) => setPreferences({ ...preferences, difficulty: e.target.value })}
                      className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="any">Any Difficulty</option>
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </div>
                </div>
              </Card>
            </motion.div>
          )}

          {/* Rate Limit Error */}
          {rateLimitError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6"
            >
              <Card variant="glass" className="p-4 border-error/30 bg-error/5">
                <div className="flex items-start space-x-3">
                  <AlertCircle className="h-5 w-5 text-error flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-semibold text-error mb-1">Rate Limit Exceeded</h3>
                    <p className="text-sm text-surface-300 mb-2">
                      {rateLimitError.message}
                    </p>
                    <div className="flex items-center space-x-2 text-xs text-surface-400">
                      <Timer className="h-3 w-3" />
                      <span>Reset in {rateLimitError.minutesUntilReset} minute{rateLimitError.minutesUntilReset !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setRateLimitError(null)}
                    className="text-surface-500 hover:text-white transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </Card>
            </motion.div>
          )}

          {/* Rate Limit Info */}
          {rateLimit && !rateLimitError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6"
            >
              <Card variant="glass" className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-lg bg-surface-800 text-secondary-400">
                      <Target className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">
                        {rateLimit.remaining} of {rateLimit.limit} battles remaining
                      </div>
                      <div className="text-xs text-surface-500">
                        Resets in {Math.ceil((rateLimit.resetTime - Date.now()) / (60 * 1000))} minutes
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 max-w-xs h-2 rounded-full bg-surface-700 overflow-hidden ml-4">
                    <div
                      className="h-full rounded-full bg-secondary-500 transition-all"
                      style={{ width: `${(rateLimit.remaining / rateLimit.limit) * 100}%` }}
                    />
                  </div>
                </div>
              </Card>
            </motion.div>
          )}

          {/* Queue Status */}
          <AnimatePresence mode="wait">
            {!isSearching && !matchFound && (
              <motion.div
                key="ready"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
              >
                <Card variant="gradient" className="p-8 text-center">
                  <motion.div
                    animate={{ scale: [1, 1.05, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-secondary-500 to-primary-500 flex items-center justify-center"
                  >
                    <Swords className="h-12 w-12 text-white" />
                  </motion.div>

                  <h2 className="text-2xl font-bold mb-2">Ready to Battle?</h2>
                  <p className="text-surface-400 mb-6">
                    Your agent will compete against another player's agent in a real-time coding challenge.
                  </p>

                  <Button
                    variant="primary"
                    size="lg"
                    icon={!socket ? Loader2 : Swords}
                    onClick={joinQueue}
                    disabled={!socket}
                    className={!socket
                      ? 'opacity-50 cursor-not-allowed'
                      : 'bg-gradient-to-r from-secondary-500 to-primary-500 hover:from-secondary-400 hover:to-primary-400'
                    }
                  >
                    {!socket ? 'Connecting...' : 'Find Opponent'}
                  </Button>

                  {queueError && (
                    <div className="mt-4 p-3 rounded-lg bg-error/10 border border-error/20">
                      <p className="text-sm text-error-light">{queueError}</p>
                    </div>
                  )}

                  {playersInQueue > 0 && (
                    <div className="mt-4 flex items-center justify-center space-x-2 text-sm text-surface-400">
                      <Users className="h-4 w-4" />
                      <span>{playersInQueue} player{playersInQueue !== 1 ? 's' : ''} in queue</span>
                    </div>
                  )}
                </Card>
              </motion.div>
            )}

            {isSearching && !matchFound && (
              <motion.div
                key="searching"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
              >
                <Card variant="glass" className="p-8 text-center border-primary-500/30">
                  {/* Animated searching indicator */}
                  <div className="relative w-32 h-32 mx-auto mb-6">
                    {/* Outer ring */}
                    <motion.div
                      className="absolute inset-0 rounded-full border-4 border-primary-500/20"
                      animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0, 0.5] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                    {/* Middle ring */}
                    <motion.div
                      className="absolute inset-2 rounded-full border-4 border-secondary-500/30"
                      animate={{ scale: [1, 1.15, 1], opacity: [0.7, 0.2, 0.7] }}
                      transition={{ duration: 2, repeat: Infinity, delay: 0.3 }}
                    />
                    {/* Inner content */}
                    <div className="absolute inset-4 rounded-full bg-gradient-to-br from-secondary-500/20 to-primary-500/20 flex items-center justify-center">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                      >
                        <Loader2 className="h-12 w-12 text-primary-400" />
                      </motion.div>
                    </div>
                  </div>

                  <h2 className="text-2xl font-bold mb-2">
                    {searchExpanded ? 'Search Expanded...' : 'Searching for Opponent...'}
                  </h2>
                  <p className="text-surface-400 mb-2">
                    {searchExpanded
                      ? 'Now matching with any available player'
                      : getSearchingMessage(preferences)}
                  </p>
                  {!searchExpanded && matchingPlayersCount > 0 && (
                    <p className="text-sm text-primary-400 mb-4">
                      {matchingPlayersCount} player{matchingPlayersCount !== 1 ? 's' : ''} match your preferences
                    </p>
                  )}

                  <div className="flex items-center justify-center space-x-6 text-sm mb-6">
                    <div className="flex items-center space-x-2">
                      <Clock className="h-4 w-4 text-surface-500" />
                      <span className="text-white font-medium">{formatTime(queueTime)}</span>
                    </div>
                    {queuePosition && (
                      <div className="flex items-center space-x-2">
                        <Users className="h-4 w-4 text-surface-500" />
                        <span className="text-white font-medium">Position #{queuePosition}</span>
                      </div>
                    )}
                  </div>

                  <Button
                    variant="ghost"
                    icon={X}
                    onClick={leaveQueue}
                  >
                    Cancel Search
                  </Button>
                </Card>
              </motion.div>
            )}

            {matchFound && (
              <motion.div
                key="match-found"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <Card variant="glass" className="p-8 text-center border-success/30 bg-success/5">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: [0, 1.2, 1] }}
                    transition={{ duration: 0.5 }}
                    className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-success to-emerald-600 flex items-center justify-center"
                  >
                    <Swords className="h-12 w-12 text-white" />
                  </motion.div>

                  <h2 className="text-2xl font-bold text-success mb-2">Match Found!</h2>
                  <p className="text-surface-300 mb-4">
                    Preparing the battle arena...
                  </p>

                  {opponent && (
                    <div className="inline-flex items-center space-x-3 px-4 py-2 rounded-xl bg-surface-800/50">
                      <span className="text-surface-400">vs</span>
                      <span className="font-semibold text-white">{opponent.username}'s Agent</span>
                      <span className="text-xs text-surface-500 capitalize">({opponent.model})</span>
                    </div>
                  )}

                  <motion.div
                    className="mt-6"
                    animate={{ opacity: [1, 0.5, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  >
                    <Loader2 className="h-6 w-6 text-success mx-auto animate-spin" />
                  </motion.div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Tips while waiting */}
          {isSearching && !matchFound && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-6"
            >
              <Card variant="glass" className="p-4">
                <h3 className="text-sm font-semibold text-surface-300 mb-3">While you wait...</h3>
                <ul className="space-y-2 text-xs text-surface-400">
                  <li className="flex items-start space-x-2">
                    <Zap className="h-3 w-3 mt-0.5 text-warning flex-shrink-0" />
                    <span>Both agents will receive the same problem simultaneously</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Target className="h-3 w-3 mt-0.5 text-success flex-shrink-0" />
                    <span>First agent to pass all test cases wins the battle</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Brain className="h-3 w-3 mt-0.5 text-primary-400 flex-shrink-0" />
                    <span>Your system prompt and modules give your agent its personality</span>
                  </li>
                </ul>
              </Card>
            </motion.div>
          )}
        </div>
      </div>
    </>
  );
}

const AgentPage = withAuth(AgentMatchmaking);
export default function AgentPageGated(props) {
  return <AgentBattlesGate><AgentPage {...props} /></AgentBattlesGate>
}
