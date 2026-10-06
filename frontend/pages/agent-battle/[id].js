import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Cpu,
  Zap,
  Brain,
  Sparkles,
  Trophy,
  Clock,
  ChevronRight,
  Check,
  X,
  Loader2,
  Code,
  Play,
  Target,
  Eye,
  RotateCcw,
  Swords,
  Users,
  ArrowLeft,
  Flame,
  Award,
  Volume2,
  VolumeX,
  History
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { config } from '../../config/env';
import FloatingOrbs from '../../components/ui/FloatingOrbs';
import AgentModuleChips from '../../components/AgentModuleChips';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import withAuth from '../../components/withAuth';
import io from 'socket.io-client';
import confetti from 'canvas-confetti';
import { useGameSounds } from '../../hooks/useGameSounds';
import AgentBattlesGate from '../../components/AgentBattlesGate'

const MODEL_INFO = {
  haiku: { name: 'Haiku', icon: Zap, color: 'from-green-500 to-emerald-600', textColor: 'text-green-400' },
  sonnet: { name: 'Sonnet', icon: Brain, color: 'from-primary-500 to-cyan-600', textColor: 'text-primary-400' },
  opus: { name: 'Opus', icon: Sparkles, color: 'from-purple-500 to-pink-600', textColor: 'text-purple-400' }
};

// PlayerCard component - extracted from AgentBattle to prevent recreation on every render
const PlayerCard = ({ player, isLeft, isWinner, playerCode, toolUse, battleState, winner, user, userWinStreak }) => {
  const loadout = player.loadout || {};
  const modelInfo = MODEL_INFO[loadout.model || player.model] || MODEL_INFO.sonnet;
  const Icon = modelInfo.icon;
  const isCoding = player.status === 'coding';
  const isValidating = player.status === 'validating';
  const language = loadout.language || 'javascript';
  const modules = loadout.modules || loadout.tools || [];

  const isCurrentUser = user && player.userId === user.id;
  const isLoss = battleState === 'finished' && !isWinner && !winner === null;

  // Get last ~20 lines of code for display
  const displayCode = () => {
    if (!playerCode) return '';
    const lines = playerCode.split('\n');
    const lastLines = lines.slice(-20);
    return lastLines.join('\n');
  };

  // Animation variants for victory/defeat
  const cardVariants = {
    initial: { opacity: 0, x: isLeft ? -20 : 20 },
    animate: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.3 }
    },
    victory: {
      opacity: 1,
      x: 0,
      scale: [1, 1.02, 1],
      transition: {
        scale: {
          duration: 0.6,
          repeat: 3,
          ease: "easeInOut"
        }
      }
    },
    defeat: {
      opacity: 1,
      x: [0, isLeft ? -5 : 5, isLeft ? 5 : -5, isLeft ? -3 : 3, isLeft ? 3 : -3, 0],
      transition: {
        duration: 0.5,
        times: [0, 0.15, 0.3, 0.5, 0.7, 1]
      }
    }
  };

  return (
    <motion.div
      initial="initial"
      animate={
        battleState === 'finished'
          ? (isWinner ? 'victory' : 'defeat')
          : 'animate'
      }
      variants={cardVariants}
      className={`flex-1 ${isLeft ? 'pr-4' : 'pl-4'}`}
    >
      <Card
        variant="glass"
        className={`p-6 h-full transition-all duration-500 relative overflow-hidden ${
          isWinner
            ? 'border-success/50 bg-success/5 shadow-[0_0_30px_rgba(16,185,129,0.3)]'
            : battleState === 'finished' && winner
            ? 'opacity-75'
            : ''
        } ${player.status === 'running' || player.status === 'coding' ? 'border-primary-500/30' : ''}`}
      >
        {/* Victory/Defeat Overlay */}
        <AnimatePresence>
          {battleState === 'finished' && isWinner && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease: "backOut" }}
              className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none"
            >
              <div className="text-center">
                <motion.div
                  animate={{
                    scale: [1, 1.1, 1],
                    textShadow: [
                      '0 0 20px rgba(255,215,0,0.5)',
                      '0 0 40px rgba(255,215,0,0.8)',
                      '0 0 20px rgba(255,215,0,0.5)'
                    ]
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                  className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-yellow-500 to-yellow-300"
                  style={{ WebkitTextStroke: '2px rgba(255,215,0,0.5)' }}
                >
                  VICTORY
                </motion.div>
                {isCurrentUser && userWinStreak >= 5 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="text-2xl font-bold text-orange-400 mt-2"
                  >
                    {userWinStreak} Win Streak! 🔥
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
          {battleState === 'finished' && !isWinner && winner && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none"
            >
              <motion.div
                animate={{
                  opacity: [0.7, 0.5, 0.7]
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
                className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 via-red-600 to-red-400"
                style={{ WebkitTextStroke: '2px rgba(239,68,68,0.3)' }}
              >
                DEFEAT
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${modelInfo.color} flex items-center justify-center`}>
              <Icon className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="font-semibold text-white">{player.username}</div>
              <div className={`text-xs ${modelInfo.textColor}`}>{modelInfo.name} Agent</div>
            </div>
          </div>
          {isWinner && (
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{
                scale: 1,
                rotate: 0,
                boxShadow: [
                  '0 0 20px rgba(255,215,0,0.6)',
                  '0 0 40px rgba(255,215,0,0.9)',
                  '0 0 20px rgba(255,215,0,0.6)'
                ]
              }}
              transition={{
                scale: { duration: 0.6, ease: "backOut" },
                rotate: { duration: 0.6, ease: "backOut" },
                boxShadow: {
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut"
                }
              }}
              className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center"
            >
              <Trophy className="h-5 w-5 text-white" />
            </motion.div>
          )}
        </div>

        <div className="mb-4 flex items-center justify-between text-sm">
          <span className="text-surface-400">Language</span>
          <span className="text-white capitalize">{language}</span>
        </div>

        <AgentModuleChips
          className="mb-4"
          label="Modules"
          modules={modules}
          maxVisible={5}
        />

        {/* Status */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-surface-400">Status</span>
            <span className={`font-medium ${
              player.status === 'completed' ? 'text-success' :
              player.status === 'failed' ? 'text-error' :
              player.status === 'running' ? 'text-primary-400' :
              player.status === 'coding' ? 'text-emerald-400' :
              player.status === 'validating' ? 'text-yellow-400' :
              'text-surface-400'
            }`}>
              {player.status === 'completed' ? 'Completed' :
               player.status === 'failed' ? 'Failed' :
               player.status === 'running' ? 'Running...' :
               player.status === 'coding' ? 'Coding...' :
               player.status === 'validating' ? 'Validating...' :
               player.status === 'error' ? 'Error' :
               'Pending'}
            </span>
          </div>

          {/* Progress bar */}
          {player.totalTests > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-surface-500">Tests Passed</span>
                <span className="text-white">{player.passedCount}/{player.totalTests}</span>
              </div>
              <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(player.passedCount / player.totalTests) * 100}%` }}
                  className={`h-full ${player.passedCount === player.totalTests ? 'bg-success' : 'bg-primary-500'}`}
                />
              </div>
            </div>
          )}
        </div>

        {/* Tool Usage Display */}
        {toolUse && (
          <div className="mb-4">
            <div className="flex items-center space-x-2 text-xs text-yellow-400 mb-2">
              <Play className="h-3 w-3" />
              <span>Using Tool: {toolUse.tool}</span>
              {!toolUse.output && (
                <motion.span
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  Running...
                </motion.span>
              )}
            </div>
            {toolUse.output && (
              <div className="bg-surface-900 rounded-lg p-3 text-xs">
                <div className={`font-semibold mb-1 ${toolUse.output.success ? 'text-success' : 'text-error'}`}>
                  {toolUse.output.success ? 'Success' : 'Error'}
                </div>
                {toolUse.output.output && (
                  <div className="mb-2">
                    <div className="text-surface-500">Output:</div>
                    <pre className="text-surface-300 whitespace-pre-wrap break-words font-mono">
                      {toolUse.output.output}
                    </pre>
                  </div>
                )}
                {toolUse.output.error && (
                  <div>
                    <div className="text-surface-500">Error:</div>
                    <pre className="text-error whitespace-pre-wrap break-words font-mono">
                      {toolUse.output.error}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Live Code Display */}
        {(isCoding || isValidating || playerCode) && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs text-surface-500 mb-2">
              <span>Live Code</span>
              {isCoding && (
                <motion.span
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="text-emerald-400"
                >
                  Generating...
                </motion.span>
              )}
            </div>
            <div className="relative bg-surface-900 rounded-lg p-3 max-h-64 overflow-y-auto code-display">
              {playerCode ? (
                <pre className="text-xs font-mono text-emerald-400 whitespace-pre-wrap break-words">
                  {displayCode()}
                  {isCoding && (
                    <span className="typing-cursor">|</span>
                  )}
                </pre>
              ) : (
                <div className="text-xs text-surface-500 italic">
                  Generating code...
                </div>
              )}
            </div>
          </div>
        )}

        {/* Execution time */}
        {player.executionTime && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-surface-400">Execution Time</span>
            <span className="text-white">{(player.executionTime / 1000).toFixed(2)}s</span>
          </div>
        )}

        {/* Analytics - Only show after battle finishes */}
        {battleState === 'finished' && (
          <>
            {/* Token Usage */}
            {player.tokensUsed !== undefined && player.tokensUsed > 0 && (
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-surface-400">Tokens Used</span>
                <span className="text-white font-mono">{player.tokensUsed.toLocaleString()}</span>
              </div>
            )}

            {/* Generation Time */}
            {player.generationTimeMs !== undefined && player.generationTimeMs > 0 && (
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-surface-400">Generation Time</span>
                <span className="text-white">{(player.generationTimeMs / 1000).toFixed(2)}s</span>
              </div>
            )}

            {/* Tool Calls */}
            {player.toolCalls !== undefined && player.toolCalls > 0 && (
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-surface-400">Tool Calls</span>
                <span className="text-white">{player.toolCalls}</span>
              </div>
            )}
          </>
        )}

        {/* Win Streak Display */}
        {battleState === 'finished' && player.currentStreak !== undefined && player.currentStreak >= 3 && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="mt-2 px-3 py-2 bg-gradient-to-r from-orange-500/20 to-red-500/20 border border-orange-500/30 rounded-lg"
          >
            <div className="flex items-center justify-center space-x-2">
              <motion.div
                animate={{
                  scale: [1, 1.2, 1],
                  rotate: [0, 5, -5, 0]
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              >
                <Flame className="h-4 w-4 text-orange-400" />
              </motion.div>
              <span className="font-bold text-orange-400">
                {player.currentStreak} Win Streak!
              </span>
              <motion.div
                animate={{
                  scale: [1, 1.2, 1],
                  rotate: [0, -5, 5, 0]
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              >
                <Flame className="h-4 w-4 text-orange-400" />
              </motion.div>
            </div>
          </motion.div>
        )}

        {/* ELO Change with Streak Bonus */}
        {player.eloChange !== undefined && (
          <div className="space-y-1 mt-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-surface-400">ELO Change</span>
              <span className={`font-bold ${player.eloChange > 0 ? 'text-success' : player.eloChange < 0 ? 'text-error' : 'text-surface-400'}`}>
                {player.eloChange > 0 ? '+' : ''}{player.eloChange}
              </span>
            </div>
            {player.streakBonus !== undefined && player.streakBonus > 0 && (
              <div className="flex items-center justify-end text-xs">
                <span className="text-orange-400 flex items-center space-x-1">
                  <Flame className="h-3 w-3" />
                  <span>+{player.streakBonus} streak bonus</span>
                </span>
              </div>
            )}
          </div>
        )}

        {/* Running indicator */}
        {player.status === 'running' && !isCoding && !isValidating && (
          <div className="mt-4 flex items-center justify-center">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            >
              <Loader2 className="h-8 w-8 text-primary-400" />
            </motion.div>
          </div>
        )}
      </Card>
    </motion.div>
  );
};

function AgentBattle() {
  const router = useRouter();
  const { id: battleId } = router.query;
  const { user, token } = useAuth();

  // Sound effects
  const sounds = useGameSounds();

  // Battle state
  const [battle, setBattle] = useState(null);
  const [problem, setProblem] = useState(null);
  const [players, setPlayers] = useState([]);
  const [battleState, setBattleState] = useState('loading'); // loading, running, finished
  const [winner, setWinner] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [socket, setSocket] = useState(null);
  const [playerCodes, setPlayerCodes] = useState({});
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [playerToolUse, setPlayerToolUse] = useState({}); // Track tool usage per player
  const [userWinStreak, setUserWinStreak] = useState(0);
  const celebrationTriggered = useRef(false);
  const [earnedBadges, setEarnedBadges] = useState([]); // Track newly earned badges
  const [rivalry, setRivalry] = useState(null); // Head-to-head record

  // Rematch state
  const [rematchRequested, setRematchRequested] = useState(false);
  const [rematchWaiting, setRematchWaiting] = useState(false);
  const [rematchIncoming, setRematchIncoming] = useState(null);
  const [rematchTimeLeft, setRematchTimeLeft] = useState(60);
  const [rematchAccepted, setRematchAccepted] = useState(false);

  // Check if user is spectating (not a participant)
  const isSpectating = user && players.length > 0 && !players.some(p => p.userId === user.id);

  // Initialize socket and fetch battle
  useEffect(() => {
    if (!battleId || !token) return;

    const newSocket = io(config.backend_url, {
      auth: { token }
    });

    newSocket.on('connect', () => {
      // Join battle room for updates
      newSocket.emit('join-agent-battle-room', { battleId });
    });

    newSocket.on('agent-battle-state', (data) => {
      // Initial state when joining a battle in progress
      if (data.problem) setProblem(data.problem);
      if (data.state) setBattleState(data.state === 'matched' ? 'running' : data.state);
      if (data.players) setPlayers(data.players);
      if (data.spectatorCount !== undefined) setSpectatorCount(data.spectatorCount);
    });

    newSocket.on('agent-battle-started', (data) => {
      setProblem(data.problem);
      setBattleState('running');
    });

    newSocket.on('agent-battle-progress', (data) => {
      setPlayers(prev => prev.map(p =>
        p.userId === data.playerId
          ? { ...p, status: data.status, passedCount: data.passedCount, totalTests: data.totalTests }
          : p
      ));
    });

    newSocket.on('agent-coding-started', (data) => {
      setPlayers(prev => prev.map(p =>
        p.userId === data.playerId
          ? { ...p, status: 'coding' }
          : p
      ));
      setPlayerCodes(prev => ({
        ...prev,
        [data.playerId]: ''
      }));
    });

    newSocket.on('agent-code-chunk', (data) => {
      setPlayerCodes(prev => ({
        ...prev,
        [data.playerId]: (prev[data.playerId] || '') + data.chunk
      }));
      // Play subtle typing sound (throttled)
      if (Math.random() < 0.1) { // Only 10% of chunks to avoid overwhelming
        sounds.codeChunk();
      }
    });

    newSocket.on('agent-coding-finished', (data) => {
      setPlayers(prev => prev.map(p =>
        p.userId === data.playerId
          ? { ...p, status: 'validating' }
          : p
      ));
    });

    newSocket.on('agent-battle-finished', (data) => {
      setBattleState('finished');
      setWinner(data.winnerId);
      setPlayers(data.players);
    });

    newSocket.on('spectator-count-update', (data) => {
      if (data.spectatorCount !== undefined) {
        setSpectatorCount(data.spectatorCount);
      }
    });

    newSocket.on('agent-tool-use', (data) => {
      // Track tool usage for display
      setPlayerToolUse(prev => ({
        ...prev,
        [data.playerId]: {
          tool: data.tool,
          input: data.input,
          output: data.output,
          timestamp: data.timestamp
        }
      }));
    });

    // Badge earned handler
    newSocket.on('badge-earned', (data) => {
      setEarnedBadges(prev => [...prev, data.badge]);
      // Play badge unlock sound
      sounds.badgeUnlock();
      // Auto-dismiss after 5 seconds
      setTimeout(() => {
        setEarnedBadges(prev => prev.filter(b => b.slug !== data.badge.slug));
      }, 5000);
    });

    // Rematch event handlers
    newSocket.on('agent-rematch-requested', (data) => {
      setRematchWaiting(false);
      setRematchRequested(false);
      setRematchIncoming(data.requester);
      setRematchTimeLeft(Math.max(1, Math.floor((data.expiresIn || 60000) / 1000)));
    });

    newSocket.on('agent-rematch-waiting', () => {
      setRematchWaiting(true);
    });

    newSocket.on('agent-rematch-starting', (data) => {
      setRematchAccepted(true);
      // Redirect to new battle after short delay
      setTimeout(() => {
        router.push(`/agent-battle/${data.battleId}`);
      }, 2000);
    });

    newSocket.on('agent-rematch-declined', (data) => {
      setRematchWaiting(false);
      setRematchRequested(false);
      // Could show a toast notification here
      console.log(`${data.decliner.username} declined the rematch`);
    });

    newSocket.on('agent-rematch-cancelled', (data) => {
      setRematchIncoming(null);
      console.log(`${data.canceller.username} cancelled the rematch request`);
    });

    newSocket.on('agent-rematch-error', (data) => {
      console.error('Rematch error:', data.error);
      setRematchWaiting(false);
      setRematchRequested(false);
    });

    // Error handlers
    newSocket.on('agent-battle-error', (data) => {
      console.error('Agent battle error:', data.error);
      setBattleState('error');
    });

    newSocket.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
    });

    setSocket(newSocket);

    return () => {
      if (newSocket.connected) {
        newSocket.emit('leave-agent-battle-room', { battleId });
      }
      newSocket.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Revived agent battle page kept as originally written: this hook intentionally runs on the listed values only.
  }, [battleId, token]);

  // Fetch rivalry record when players are loaded
  useEffect(() => {
    const fetchRivalry = async () => {
      if (!players || players.length < 2 || !user || !token) return;

      const opponentId = players.find(p => p.userId !== user.id)?.userId;
      if (!opponentId) return;

      try {
        const response = await fetch(`${config.backend_url}/api/agent/rivalries/${opponentId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const data = await response.json();
        if (data.success && data.rivalry) {
          setRivalry(data.rivalry);
        }
      } catch (err) {
        console.error('Failed to fetch rivalry:', err);
      }
    };

    fetchRivalry();
  }, [players, user, token]);

  // Timer
  useEffect(() => {
    let interval;
    if (battleState === 'running') {
      interval = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [battleState]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Rematch timer countdown
  useEffect(() => {
    if (rematchIncoming && rematchTimeLeft > 0) {
      const timer = setInterval(() => {
        setRematchTimeLeft(prev => {
          const newTime = prev - 1;
          // Play countdown tick for last 10 seconds
          if (newTime <= 10 && newTime > 0) {
            sounds.countdown();
          }
          if (newTime <= 0) {
            setRematchIncoming(null);
            return 60;
          }
          return newTime;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [rematchIncoming, rematchTimeLeft, sounds]);

  // Rematch handlers
  const handleRequestRematch = () => {
    if (!socket || !battleId) return;
    setRematchRequested(true);
    socket.emit('request-agent-rematch', { battleId });
  };

  const handleAcceptRematch = () => {
    if (!socket || !battleId) return;
    socket.emit('accept-agent-rematch', { battleId });
    setRematchWaiting(true);
    setRematchIncoming(null);
  };

  const handleDeclineRematch = () => {
    if (!socket || !battleId) return;
    socket.emit('decline-agent-rematch', { battleId });
    setRematchIncoming(null);
  };

  const handleCancelRematch = () => {
    if (!socket || !battleId) return;
    socket.emit('cancel-agent-rematch', { battleId });
    setRematchRequested(false);
    setRematchWaiting(false);
  };

  // Confetti celebration functions
  const fireVictoryConfetti = (isStreakWin = false) => {
    const count = isStreakWin ? 200 : 100;
    const duration = isStreakWin ? 4000 : 2500;
    const endTime = Date.now() + duration;

    const colors = isStreakWin
      ? ['#FFD700', '#FFA500', '#FF6347', '#9333EA', '#8B5CF6'] // Gold, orange, red, purple for streaks
      : ['#FFD700', '#FFA500', '#FBBF24']; // Gold/yellow for regular wins

    const frame = () => {
      confetti({
        particleCount: isStreakWin ? 7 : 5,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.6 },
        colors: colors,
        gravity: isStreakWin ? 0.8 : 1,
        scalar: isStreakWin ? 1.4 : 1.2,
        drift: 0.2
      });

      confetti({
        particleCount: isStreakWin ? 7 : 5,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.6 },
        colors: colors,
        gravity: isStreakWin ? 0.8 : 1,
        scalar: isStreakWin ? 1.4 : 1.2,
        drift: -0.2
      });

      if (Date.now() < endTime) {
        requestAnimationFrame(frame);
      }
    };

    frame();

    // Additional center burst for streak wins
    if (isStreakWin) {
      setTimeout(() => {
        confetti({
          particleCount: 150,
          spread: 120,
          origin: { y: 0.5 },
          colors: colors,
          gravity: 1.2,
          scalar: 1.5,
          ticks: 300
        });
      }, 500);
    }
  };

  // Trigger celebrations when battle finishes
  useEffect(() => {
    if (battleState === 'finished' && winner && user && !celebrationTriggered.current) {
      celebrationTriggered.current = true;

      // Check if current user won
      const winningPlayer = players.find(p => p.isWinner);
      const currentUserWon = winningPlayer && winningPlayer.userId === user.id;

      if (currentUserWon) {
        // Play victory sound
        sounds.victory();

        // Fetch user stats to check win streak
        fetch(`${config.backend_url}/api/users/${user.id}/stats`, {
          headers: { Authorization: `Bearer ${token}` }
        })
          .then(res => res.json())
          .then(data => {
            const streak = data.win_streak || 0;
            setUserWinStreak(streak);

            // Play streak sound for milestones (3, 5, 10+)
            if (streak === 3 || streak === 5 || streak % 10 === 0) {
              setTimeout(() => sounds.streakUp(), 600);
            }

            // Fire confetti - extra special for 5+ streaks
            const isStreakWin = streak >= 5;
            setTimeout(() => fireVictoryConfetti(isStreakWin), 300);
          })
          .catch(err => {
            console.error('Failed to fetch stats:', err);
            // Still fire confetti even if stats fetch fails
            setTimeout(() => fireVictoryConfetti(false), 300);
          });
      } else {
        // Play defeat sound for current user
        sounds.defeat();
      }
    }
  }, [battleState, winner, user, players, token, sounds]);


  return (
    <>
      <Head>
        <title>Agent Battle - CodeArena</title>
      </Head>

      <style jsx global>{`
        .code-display {
          scrollbar-width: thin;
          scrollbar-color: rgba(16, 185, 129, 0.3) rgba(0, 0, 0, 0.2);
        }

        .code-display::-webkit-scrollbar {
          width: 6px;
        }

        .code-display::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 3px;
        }

        .code-display::-webkit-scrollbar-thumb {
          background: rgba(16, 185, 129, 0.3);
          border-radius: 3px;
        }

        .code-display::-webkit-scrollbar-thumb:hover {
          background: rgba(16, 185, 129, 0.5);
        }

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }

        .typing-cursor {
          animation: blink 1s step-end infinite;
          color: #10b981;
          font-weight: bold;
        }

        @keyframes pulse-glow {
          0%, 100% {
            box-shadow: 0 0 20px rgba(147, 51, 234, 0.3);
          }
          50% {
            box-shadow: 0 0 40px rgba(147, 51, 234, 0.6);
          }
        }

        .rematch-pulse {
          animation: pulse-glow 2s ease-in-out infinite;
        }

        @keyframes countdown-pulse {
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.05);
            opacity: 0.8;
          }
        }

        .countdown-timer {
          animation: countdown-pulse 1s ease-in-out infinite;
        }

        @keyframes badge-glow {
          0%, 100% {
            box-shadow: 0 0 30px rgba(234, 179, 8, 0.5), 0 0 60px rgba(234, 179, 8, 0.3);
          }
          50% {
            box-shadow: 0 0 40px rgba(234, 179, 8, 0.7), 0 0 80px rgba(234, 179, 8, 0.5);
          }
        }

        .badge-glow {
          animation: badge-glow 2s ease-in-out infinite;
        }
      `}</style>

      <div className="min-h-screen bg-surface-950 text-white">
        <FloatingOrbs />

        {/* Spectator Banner */}
        {isSpectating && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="fixed top-0 left-0 right-0 z-40 bg-gradient-to-r from-primary-500/20 to-purple-500/20 border-b border-primary-500/30 backdrop-blur-sm"
          >
            <div className="max-w-7xl mx-auto px-6 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-500/30 to-purple-500/30 border border-primary-500/40 flex items-center justify-center">
                    <Eye className="h-5 w-5 text-primary-400" />
                  </div>
                  <div>
                    <div className="text-white font-semibold flex items-center space-x-2">
                      <span>You are spectating this battle</span>
                      <div className="flex items-center space-x-1 text-sm text-primary-400">
                        <Users className="h-4 w-4" />
                        <span>{spectatorCount} {spectatorCount === 1 ? 'spectator' : 'spectators'}</span>
                      </div>
                    </div>
                    <div className="text-surface-300 text-xs">
                      Watch the agents compete in real-time
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push('/agent-battles/live')}
                  className="border border-primary-500/30 hover:bg-primary-500/10"
                >
                  Browse More Battles
                </Button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Badge Earned Notifications */}
        <AnimatePresence>
          {earnedBadges.map((badge, index) => (
            <motion.div
              key={badge.slug}
              initial={{ opacity: 0, y: -100, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -50, scale: 0.8 }}
              transition={{ type: 'spring', damping: 15 }}
              className="fixed top-24 left-1/2 transform -translate-x-1/2 z-50"
              style={{ marginTop: `${index * 120}px` }}
              onClick={() => setEarnedBadges(prev => prev.filter(b => b.slug !== badge.slug))}
            >
              <Card
                variant="glass"
                className="p-6 border-2 border-yellow-500/50 bg-surface-900/95 backdrop-blur-xl badge-glow cursor-pointer hover:scale-105 transition-transform"
              >
                <div className="flex items-center space-x-4">
                  <motion.div
                    initial={{ rotate: 0 }}
                    animate={{ rotate: [0, -10, 10, -10, 10, 0] }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="w-16 h-16 rounded-full bg-gradient-to-br from-yellow-500 to-yellow-600 flex items-center justify-center text-3xl"
                  >
                    {badge.icon}
                  </motion.div>
                  <div>
                    <div className="text-yellow-400 text-sm font-semibold mb-1">
                      Achievement Unlocked!
                    </div>
                    <div className="font-bold text-lg text-white mb-1">
                      {badge.name}
                    </div>
                    <div className="text-surface-300 text-sm">
                      {badge.description}
                    </div>
                    <div className="mt-2">
                      <span className={`text-xs px-2 py-1 rounded ${
                        badge.rarity === 'legendary' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                        badge.rarity === 'epic' ? 'bg-pink-500/20 text-pink-400 border border-pink-500/30' :
                        badge.rarity === 'rare' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                        'bg-surface-700/50 text-surface-300 border border-surface-600'
                      }`}>
                        {badge.rarity.charAt(0).toUpperCase() + badge.rarity.slice(1)}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>

        <div className="relative z-10 max-w-6xl mx-auto px-6 py-8">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between mb-8"
          >
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push('/agent-battles')}
                className="flex items-center space-x-2 text-surface-400 hover:text-white transition-colors"
              >
                <ChevronRight className="h-5 w-5 rotate-180" />
                <span>Back to Agent Battles</span>
              </button>
              <button
                onClick={() => router.push('/agent-history')}
                className="flex items-center space-x-2 text-surface-400 hover:text-white transition-colors"
              >
                <History className="h-4 w-4" />
                <span>Battle History</span>
              </button>
            </div>

            <div className="flex items-center space-x-4">
              {isSpectating && (
                <div className="flex items-center space-x-2 px-4 py-2 bg-primary-500/20 border border-primary-500/30 rounded-lg">
                  <Eye className="h-4 w-4 text-primary-400" />
                  <span className="font-medium text-primary-400">Spectating</span>
                </div>
              )}
              <div className="flex items-center space-x-2 px-4 py-2 bg-surface-800/50 rounded-lg">
                <Clock className="h-4 w-4 text-surface-400" />
                <span className="font-mono text-white">{formatTime(elapsedTime)}</span>
              </div>
              <div className="flex items-center space-x-2 px-4 py-2 bg-surface-800/50 rounded-lg">
                <Eye className="h-4 w-4 text-surface-400" />
                <span className="font-mono text-white">{spectatorCount}</span>
              </div>
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

          {/* Battle Status Banner */}
          <AnimatePresence mode="wait">
            {battleState === 'loading' && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Card variant="glass" className="p-8 text-center mb-8">
                  <Loader2 className="h-12 w-12 text-primary-400 mx-auto mb-4 animate-spin" />
                  <h2 className="text-xl font-bold mb-2">Loading Battle...</h2>
                  <p className="text-surface-400">Preparing the arena</p>
                </Card>
              </motion.div>
            )}

            {battleState === 'running' && (
              <motion.div
                key="running"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Card variant="gradient" className="p-6 mb-8 border-primary-500/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                        className="w-3 h-3 bg-success rounded-full"
                      />
                      <h2 className="text-lg font-semibold">Battle in Progress</h2>
                    </div>
                    <div className="text-surface-400 text-sm">
                      Agents are solving the problem...
                    </div>
                  </div>
                </Card>
              </motion.div>
            )}

            {battleState === 'finished' && (
              <motion.div
                key="finished"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <Card
                  variant="glass"
                  className={`p-8 text-center mb-8 ${
                    winner
                      ? 'border-success/50 bg-success/5 shadow-[0_0_40px_rgba(16,185,129,0.2)]'
                      : 'border-warning/50 bg-warning/5'
                  }`}
                >
                  {rematchAccepted ? (
                    // Rematch starting animation
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <motion.div
                        animate={{
                          rotate: [0, 360],
                          scale: [1, 1.2, 1]
                        }}
                        transition={{
                          rotate: { duration: 2, repeat: Infinity, ease: 'linear' },
                          scale: { duration: 1, repeat: Infinity }
                        }}
                        className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary-500 to-secondary-500 flex items-center justify-center"
                      >
                        <Swords className="h-10 w-10 text-white" />
                      </motion.div>
                      <h2 className="text-2xl font-bold mb-2">Rematch Starting!</h2>
                      <p className="text-surface-400">Preparing for another epic battle...</p>
                    </motion.div>
                  ) : (
                    <>
                      <motion.div
                        initial={{ scale: 0, rotate: -180 }}
                        animate={{
                          scale: [0, 1.2, 1],
                          rotate: 0,
                          boxShadow: winner
                            ? [
                                '0 0 30px rgba(255,215,0,0.6)',
                                '0 0 60px rgba(255,215,0,0.9)',
                                '0 0 30px rgba(255,215,0,0.6)'
                              ]
                            : undefined
                        }}
                        transition={{
                          scale: { duration: 0.8, times: [0, 0.6, 1], ease: "backOut" },
                          rotate: { duration: 0.8, ease: "backOut" },
                          boxShadow: winner
                            ? {
                                duration: 2,
                                repeat: Infinity,
                                ease: "easeInOut"
                              }
                            : undefined
                        }}
                        className={`w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center ${
                          winner
                            ? 'bg-gradient-to-br from-yellow-400 via-yellow-500 to-yellow-600'
                            : 'bg-warning'
                        }`}
                      >
                        {winner ? (
                          <Trophy className="h-10 w-10 text-white" />
                        ) : (
                          <Target className="h-10 w-10 text-white" />
                        )}
                      </motion.div>
                      <motion.h2
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="text-2xl font-bold mb-2"
                      >
                        {winner
                          ? `${players.find(p => p.isWinner)?.username || 'Agent'} Wins!`
                          : "It's a Tie!"
                        }
                      </motion.h2>
                      {winner && user && players.find(p => p.isWinner)?.userId === user.id && userWinStreak >= 5 && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.5, duration: 0.4 }}
                          className="mb-3"
                        >
                          <span className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 rounded-full text-white font-bold text-lg shadow-lg">
                            🔥 {userWinStreak} Win Streak!
                          </span>
                        </motion.div>
                      )}
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.4 }}
                        className="text-surface-400 mb-6"
                      >
                        Battle completed in {formatTime(elapsedTime)}
                      </motion.p>

                      {/* Rematch Incoming Request */}
                      {rematchIncoming && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="mb-6 p-4 bg-primary-500/10 border border-primary-500/30 rounded-lg"
                        >
                          <div className="flex items-center justify-center space-x-2 mb-3">
                            <Swords className="h-5 w-5 text-primary-400" />
                            <h3 className="font-semibold text-primary-400">
                              {rematchIncoming.username} wants a rematch!
                            </h3>
                          </div>
                          <div className="flex items-center justify-center space-x-2 mb-4 text-sm text-surface-400">
                            <Clock className="h-4 w-4" />
                            <span>Expires in {rematchTimeLeft}s</span>
                          </div>
                          <div className="flex gap-3 justify-center">
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={handleAcceptRematch}
                              className="flex items-center space-x-2"
                            >
                              <Check className="h-4 w-4" />
                              <span>Accept</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleDeclineRematch}
                              className="flex items-center space-x-2"
                            >
                              <X className="h-4 w-4" />
                              <span>Decline</span>
                            </Button>
                          </div>
                        </motion.div>
                      )}

                      {/* Rematch Waiting State */}
                      {rematchWaiting && !rematchIncoming && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="mb-6 p-4 bg-surface-800/50 rounded-lg"
                        >
                          <div className="flex items-center justify-center space-x-3 mb-3">
                            <motion.div
                              animate={{ rotate: 360 }}
                              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                            >
                              <Loader2 className="h-5 w-5 text-primary-400" />
                            </motion.div>
                            <p className="text-surface-300">Waiting for opponent...</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleCancelRematch}
                            className="mx-auto"
                          >
                            Cancel Request
                          </Button>
                        </motion.div>
                      )}

                      {/* Action Buttons */}
                      {!rematchIncoming && !rematchWaiting && (
                        <div className="flex flex-col sm:flex-row gap-3 justify-center">
                          {!isSpectating && (
                            <Button
                              variant="primary"
                              onClick={handleRequestRematch}
                              disabled={rematchRequested}
                              className="flex items-center justify-center space-x-2"
                            >
                              <motion.div
                                animate={!rematchRequested ? {
                                  rotate: [0, -15, 15, -15, 0],
                                  scale: [1, 1.1, 1]
                                } : {}}
                                transition={{
                                  duration: 2,
                                  repeat: Infinity,
                                  repeatDelay: 1
                                }}
                              >
                                <RotateCcw className="h-5 w-5" />
                              </motion.div>
                              <span>Rematch</span>
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            onClick={() => router.push(`/agent-replay/${battleId}`)}
                            className="flex items-center space-x-2"
                          >
                            <Eye className="h-5 w-5" />
                            <span>Watch Replay</span>
                          </Button>
                          {isSpectating ? (
                            <>
                              <Button
                                variant="secondary"
                                onClick={() => router.push('/agent-spectate')}
                                className="flex items-center space-x-2"
                              >
                                <Eye className="h-5 w-5" />
                                <span>Watch Another Battle</span>
                              </Button>
                              <Button
                                variant="primary"
                                onClick={() => router.push('/agent-battles')}
                                className="flex items-center space-x-2"
                              >
                                <Swords className="h-5 w-5" />
                                <span>Start My Own Battle</span>
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="secondary"
                              onClick={() => router.push('/agent-battles')}
                              className="flex items-center space-x-2"
                            >
                              <Users className="h-5 w-5" />
                              <span>Find New Opponent</span>
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            onClick={() => router.push('/agent-history')}
                            className="flex items-center space-x-2"
                          >
                            <History className="h-5 w-5" />
                            <span>View History</span>
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => router.push('/agent-battles')}
                            className="flex items-center space-x-2"
                          >
                            <ArrowLeft className="h-5 w-5" />
                            <span>Back to Loadouts</span>
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Post-Battle Analysis Panel */}
          {battleState === 'finished' && players.length === 2 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="mb-8"
            >
              <Card variant="glass" className="p-6">
                <div className="flex items-center space-x-3 mb-5">
                  <Target className="h-5 w-5 text-cyan-400" />
                  <h3 className="font-semibold text-lg">Battle Analysis</h3>
                </div>

                {/* Insight line */}
                {(() => {
                  const p1 = players[0];
                  const p2 = players[1];
                  const userPlayer = players.find(p => p.userId === user?.id);
                  const opponentPlayer = players.find(p => p.userId !== user?.id);
                  let insight = '';
                  if (userPlayer && opponentPlayer) {
                    const uPassed = userPlayer.passedCount || 0;
                    const oPassed = opponentPlayer.passedCount || 0;
                    const uTotal = userPlayer.totalTests || 0;
                    const uTime = userPlayer.generationTimeMs || 0;
                    const oTime = opponentPlayer.generationTimeMs || 0;
                    if (uPassed === uTotal && uTotal > 0 && winner === userPlayer.userId) {
                      insight = 'Your agent aced every test case!';
                    } else if (uPassed === oPassed && uTime < oTime && winner === userPlayer.userId) {
                      insight = 'Both agents passed the same tests, yours was faster.';
                    } else if (uPassed < oPassed) {
                      insight = `Your agent passed ${uPassed} tests vs opponent's ${oPassed}. Focus on edge case handling.`;
                    } else if (uPassed > oPassed) {
                      insight = `Your agent solved more test cases (${uPassed} vs ${oPassed}).`;
                    } else if (!winner) {
                      insight = 'Both agents performed equally, a true draw.';
                    }
                  }
                  return insight ? (
                    <div className="mb-5 p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                      <p className="text-sm text-cyan-300 flex items-center gap-2">
                        <Sparkles className="h-4 w-4 flex-shrink-0" />
                        {insight}
                      </p>
                    </div>
                  ) : null;
                })()}

                {/* Comparative metrics */}
                <div className="grid grid-cols-2 gap-4 mb-5">
                  {players.map((player, idx) => {
                    const isUser = player.userId === user?.id;
                    return (
                      <div key={player.userId} className={`p-4 rounded-lg border ${
                        player.isWinner
                          ? 'border-success/30 bg-success/5'
                          : 'border-surface-700 bg-surface-800/50'
                      }`}>
                        <div className="flex items-center gap-2 mb-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                            idx === 0 ? 'bg-primary-500/20 text-primary-400' : 'bg-purple-500/20 text-purple-400'
                          }`}>
                            {(player.username || 'Agent')[0].toUpperCase()}
                          </div>
                          <div>
                            <span className="text-sm font-medium text-white">
                              {player.username || 'Agent'}
                              {isUser && <span className="text-xs text-surface-500 ml-1">(you)</span>}
                            </span>
                            {player.isWinner && (
                              <span className="ml-2 text-xs text-success">Winner</span>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2 text-sm">
                          {player.totalTests > 0 && (
                            <div className="flex justify-between">
                              <span className="text-surface-400">Tests Passed</span>
                              <span className={`font-mono ${
                                player.passedCount === player.totalTests ? 'text-success' : 'text-white'
                              }`}>
                                {player.passedCount}/{player.totalTests}
                              </span>
                            </div>
                          )}
                          {player.generationTimeMs > 0 && (
                            <div className="flex justify-between">
                              <span className="text-surface-400">AI Gen Time</span>
                              <span className="text-white font-mono">
                                {(player.generationTimeMs / 1000).toFixed(2)}s
                              </span>
                            </div>
                          )}
                          {player.executionTime > 0 && (
                            <div className="flex justify-between">
                              <span className="text-surface-400">Exec Time</span>
                              <span className="text-white font-mono">
                                {(player.executionTime / 1000).toFixed(2)}s
                              </span>
                            </div>
                          )}
                          {player.tokensUsed > 0 && (
                            <div className="flex justify-between">
                              <span className="text-surface-400">Tokens Used</span>
                              <span className="text-white font-mono">
                                {player.tokensUsed.toLocaleString()}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Tests passed comparison bar */}
                {players[0]?.totalTests > 0 && (
                  <div>
                    <div className="text-xs text-surface-500 mb-2 uppercase tracking-wider">Tests Passed Comparison</div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono text-primary-400 w-8 text-right">
                        {players[0]?.passedCount || 0}
                      </span>
                      <div className="flex-1 h-3 bg-surface-800 rounded-full overflow-hidden flex">
                        <div
                          className="h-full bg-primary-500 transition-all duration-500"
                          style={{
                            width: `${((players[0]?.passedCount || 0) / (players[0]?.totalTests || 1)) * 50}%`
                          }}
                        />
                        <div className="flex-1" />
                        <div
                          className="h-full bg-purple-500 transition-all duration-500"
                          style={{
                            width: `${((players[1]?.passedCount || 0) / (players[1]?.totalTests || 1)) * 50}%`
                          }}
                        />
                      </div>
                      <span className="text-sm font-mono text-purple-400 w-8">
                        {players[1]?.passedCount || 0}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-surface-500 mt-1">
                      <span>{players[0]?.username || 'Player 1'}</span>
                      <span>{players[1]?.username || 'Player 2'}</span>
                    </div>
                  </div>
                )}
              </Card>
            </motion.div>
          )}

          {/* Problem Card */}
          {problem && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mb-8"
            >
              <Card variant="glass" className="p-6">
                <div className="flex items-center space-x-3 mb-4">
                  <Code className="h-5 w-5 text-primary-400" />
                  <h3 className="font-semibold text-lg">{problem.title}</h3>
                </div>
                <p className="text-surface-300 text-sm leading-relaxed">
                  {problem.description?.slice(0, 300)}
                  {problem.description?.length > 300 && '...'}
                </p>
                {problem.examples && problem.examples.length > 0 && (
                  <div className="mt-4 p-4 bg-surface-800/50 rounded-lg">
                    <div className="text-xs text-surface-500 mb-2">Example:</div>
                    <div className="font-mono text-sm">
                      <div className="text-surface-400">
                        Input: <span className="text-white">{JSON.stringify(problem.examples[0].input)}</span>
                      </div>
                      <div className="text-surface-400">
                        Output: <span className="text-success">{JSON.stringify(problem.examples[0].output)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            </motion.div>
          )}

          {/* Rivalry Card */}
          {rivalry && battleState !== 'loading' && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="mb-4"
            >
              <Card variant="glass" className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Swords className="h-5 w-5 text-orange-400" />
                    <div>
                      <div className="text-sm font-semibold text-white">
                        Head-to-Head: {rivalry.userWins}-{rivalry.opponentWins}
                        {rivalry.draws > 0 && `-${rivalry.draws}`}
                      </div>
                      <div className="text-xs text-surface-400">
                        {rivalry.totalBattles} {rivalry.totalBattles === 1 ? 'battle' : 'battles'} against {rivalry.opponentUsername}
                      </div>
                    </div>
                  </div>
                  {rivalry.lastWinnerId && (
                    <div className="text-sm">
                      {rivalry.userWonLast ? (
                        <span className="text-success flex items-center space-x-1">
                          <Trophy className="h-4 w-4" />
                          <span>You won last time</span>
                        </span>
                      ) : (
                        <span className="text-orange-400 flex items-center space-x-1">
                          <Flame className="h-4 w-4" />
                          <span>Revenge match!</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            </motion.div>
          )}

          {/* Players Grid */}
          {players.length >= 2 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex gap-6"
            >
              <PlayerCard
                player={players[0]}
                isLeft={true}
                isWinner={players[0]?.isWinner}
                playerCode={playerCodes[players[0]?.userId] || ''}
                toolUse={playerToolUse[players[0]?.userId]}
                battleState={battleState}
                winner={winner}
                user={user}
                userWinStreak={userWinStreak}
              />

              {/* VS Divider */}
              <div className="flex flex-col items-center justify-center">
                <div className="w-px h-full bg-gradient-to-b from-transparent via-surface-600 to-transparent" />
                <div className="px-4 py-2 bg-surface-800 rounded-full text-surface-400 font-bold my-4">
                  VS
                </div>
                <div className="w-px h-full bg-gradient-to-b from-transparent via-surface-600 to-transparent" />
              </div>

              <PlayerCard
                player={players[1]}
                isLeft={false}
                isWinner={players[1]?.isWinner}
                playerCode={playerCodes[players[1]?.userId] || ''}
                toolUse={playerToolUse[players[1]?.userId]}
                battleState={battleState}
                winner={winner}
                user={user}
                userWinStreak={userWinStreak}
              />
            </motion.div>
          )}

          {/* Empty state if no players */}
          {players.length === 0 && battleState !== 'loading' && (
            <Card variant="glass" className="p-8 text-center">
              <Bot className="h-12 w-12 text-surface-500 mx-auto mb-4" />
              <p className="text-surface-400">Waiting for battle data...</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

const AgentPage = withAuth(AgentBattle);
export default function AgentPageGated(props) {
  return <AgentBattlesGate><AgentPage {...props} /></AgentBattlesGate>
}
