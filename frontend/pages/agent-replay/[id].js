import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Pause,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  SkipBack,
  SkipForward,
  Clock,
  Trophy,
  Zap,
  Brain,
  Sparkles,
  Code,
  Terminal,
  Copy,
  Check,
  Share2,
  CheckCircle,
  XCircle,
  Keyboard
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { config } from '../../config/env';
import FloatingOrbs from '../../components/ui/FloatingOrbs';
import AgentModuleChips from '../../components/AgentModuleChips';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import withAuth from '../../components/withAuth';
import AgentBattlesGate from '../../components/AgentBattlesGate'

const MODEL_INFO = {
  haiku: { name: 'Haiku', icon: Zap, color: 'from-green-500 to-emerald-600', textColor: 'text-green-400' },
  sonnet: { name: 'Sonnet', icon: Brain, color: 'from-primary-500 to-cyan-600', textColor: 'text-primary-400' },
  opus: { name: 'Opus', icon: Sparkles, color: 'from-purple-500 to-pink-600', textColor: 'text-purple-400' }
};

function AgentReplay() {
  const router = useRouter();
  const { id: battleId } = router.query;
  const { token } = useAuth();

  // Replay state
  const [battle, setBattle] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentEventIndex, setCurrentEventIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);

  // Player code state
  const [player1Code, setPlayer1Code] = useState('');
  const [player2Code, setPlayer2Code] = useState('');
  const [player1ToolUse, setPlayer1ToolUse] = useState(null);
  const [player2ToolUse, setPlayer2ToolUse] = useState(null);
  const [player1Status, setPlayer1Status] = useState('pending');
  const [player2Status, setPlayer2Status] = useState('pending');
  const [player1Result, setPlayer1Result] = useState(null);
  const [player2Result, setPlayer2Result] = useState(null);

  // Share state
  const [copied, setCopied] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);

  const playbackRef = useRef(null);
  const lastEventTimeRef = useRef(0);

  // Fetch battle and events
  useEffect(() => {
    if (!battleId || !token) return;

    const fetchReplay = async () => {
      try {
        setLoading(true);
        const response = await fetch(`${config.backend_url}/api/agent/battles/${battleId}/replay`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        if (!response.ok) {
          throw new Error('Failed to load replay');
        }

        const data = await response.json();
        setBattle(data.battle);
        setEvents(data.events);
        setLoading(false);
      } catch (err) {
        console.error('Error loading replay:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    fetchReplay();
  }, [battleId, token]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Ignore if user is typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          handlePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleStepBack();
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleStepForward();
          break;
        case 'r':
          e.preventDefault();
          handleRestart();
          break;
        case 'e':
          e.preventDefault();
          handleSkipToEnd();
          break;
        case 's':
          e.preventDefault();
          handleSpeedChange();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Revived agent battle page kept as originally written: this hook intentionally runs on the listed values only.
  }, [isPlaying, currentEventIndex, events, playbackSpeed]);

  // Playback engine
  useEffect(() => {
    if (!isPlaying || !events.length) return;

    const playNextEvent = () => {
      if (currentEventIndex >= events.length) {
        setIsPlaying(false);
        return;
      }

      const event = events[currentEventIndex];
      const nextEvent = events[currentEventIndex + 1];

      // Apply event to state
      applyEvent(event);

      // Calculate delay until next event
      let delay = 0;
      if (nextEvent) {
        delay = (nextEvent.timestamp_ms - event.timestamp_ms) / playbackSpeed;
        // Cap delay at 2 seconds for very long pauses
        delay = Math.min(delay, 2000);
      }

      setCurrentTime(event.timestamp_ms);
      setCurrentEventIndex(prev => prev + 1);

      if (nextEvent) {
        playbackRef.current = setTimeout(playNextEvent, delay);
      } else {
        setIsPlaying(false);
      }
    };

    playbackRef.current = setTimeout(playNextEvent, 0);

    return () => {
      if (playbackRef.current) {
        clearTimeout(playbackRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Revived agent battle page kept as originally written: this hook intentionally runs on the listed values only.
  }, [isPlaying, currentEventIndex, playbackSpeed, events]);

  // Apply event to state
  const applyEvent = (event) => {
    const isPlayer1 = event.player_id === battle?.player1?.id;

    switch (event.event_type) {
      case 'coding_started':
        if (isPlayer1) {
          setPlayer1Status('coding');
          setPlayer1Code('');
        } else {
          setPlayer2Status('coding');
          setPlayer2Code('');
        }
        break;

      case 'code_chunk':
        if (isPlayer1) {
          setPlayer1Code(prev => prev + event.event_data.chunk);
        } else {
          setPlayer2Code(prev => prev + event.event_data.chunk);
        }
        break;

      case 'tool_use':
        if (isPlayer1) {
          setPlayer1ToolUse(event.event_data);
        } else {
          setPlayer2ToolUse(event.event_data);
        }
        // Clear tool use after 2 seconds
        setTimeout(() => {
          if (isPlayer1) {
            setPlayer1ToolUse(null);
          } else {
            setPlayer2ToolUse(null);
          }
        }, 2000);
        break;

      case 'submission':
        if (isPlayer1) {
          setPlayer1Status('validating');
        } else {
          setPlayer2Status('validating');
        }
        break;

      case 'result':
        if (isPlayer1) {
          setPlayer1Status(event.event_data.status);
          setPlayer1Result(event.event_data);
        } else {
          setPlayer2Status(event.event_data.status);
          setPlayer2Result(event.event_data);
        }
        break;
    }
  };

  // Playback controls
  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const handleRestart = () => {
    setIsPlaying(false);
    setCurrentEventIndex(0);
    setCurrentTime(0);
    setPlayer1Code('');
    setPlayer2Code('');
    setPlayer1ToolUse(null);
    setPlayer2ToolUse(null);
    setPlayer1Status('pending');
    setPlayer2Status('pending');
    setPlayer1Result(null);
    setPlayer2Result(null);
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
    }
  };

  const handleSpeedChange = () => {
    const speeds = [0.5, 1, 2, 4];
    const currentIndex = speeds.indexOf(playbackSpeed);
    const nextIndex = (currentIndex + 1) % speeds.length;
    setPlaybackSpeed(speeds[nextIndex]);
  };

  const handleStepForward = () => {
    setIsPlaying(false);
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
    }

    if (currentEventIndex < events.length) {
      const event = events[currentEventIndex];
      applyEvent(event);
      setCurrentTime(event.timestamp_ms);
      setCurrentEventIndex(prev => prev + 1);
    }
  };

  const handleStepBack = () => {
    setIsPlaying(false);
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
    }

    if (currentEventIndex > 0) {
      // Go back one event
      const newIndex = currentEventIndex - 1;

      // Reset state and replay up to new index
      setPlayer1Code('');
      setPlayer2Code('');
      setPlayer1ToolUse(null);
      setPlayer2ToolUse(null);
      setPlayer1Status('pending');
      setPlayer2Status('pending');
      setPlayer1Result(null);
      setPlayer2Result(null);

      for (let i = 0; i < newIndex; i++) {
        applyEvent(events[i]);
      }

      setCurrentEventIndex(newIndex);
      setCurrentTime(newIndex > 0 ? events[newIndex - 1].timestamp_ms : 0);
    }
  };

  const handleSkipToEnd = () => {
    setIsPlaying(false);
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
    }

    // Reset and replay all events
    setPlayer1Code('');
    setPlayer2Code('');
    setPlayer1ToolUse(null);
    setPlayer2ToolUse(null);
    setPlayer1Status('pending');
    setPlayer2Status('pending');
    setPlayer1Result(null);
    setPlayer2Result(null);

    events.forEach(event => applyEvent(event));

    setCurrentEventIndex(events.length);
    setCurrentTime(totalDuration);
  };

  const handleSeek = (timestamp) => {
    setIsPlaying(false);
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
    }

    // Find the event index for this timestamp
    const eventIndex = events.findIndex(e => e.timestamp_ms >= timestamp);
    if (eventIndex === -1) return;

    // Reset state
    setPlayer1Code('');
    setPlayer2Code('');
    setPlayer1ToolUse(null);
    setPlayer2ToolUse(null);
    setPlayer1Status('pending');
    setPlayer2Status('pending');
    setPlayer1Result(null);
    setPlayer2Result(null);

    // Replay all events up to this point
    for (let i = 0; i < eventIndex; i++) {
      applyEvent(events[i]);
    }

    setCurrentEventIndex(eventIndex);
    setCurrentTime(timestamp);
  };

  const handleShare = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatTime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const PlayerPanel = ({ player, code, toolUse, status, result, isWinner }) => {
    const modelInfo = MODEL_INFO[player?.loadout?.model] || MODEL_INFO.sonnet;
    const Icon = modelInfo.icon;
    const modules = player?.loadout?.modules || player?.loadout?.tools || [];
    const language = player?.loadout?.language || 'javascript';

    // Get last ~20 lines of code for display
    const displayCode = () => {
      if (!code) return '';
      const lines = code.split('\n');
      const lastLines = lines.slice(-20);
      return lastLines.join('\n');
    };

    // Show test case results if available
    const showTestResults = result && result.passedCount !== undefined && result.totalTests > 0;

    return (
      <Card variant="glass" className={`p-6 h-full ${isWinner ? 'border-success/50 bg-success/5' : ''}`}>
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
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center">
              <Trophy className="h-5 w-5 text-white" />
            </div>
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
              status === 'completed' ? 'text-success' :
              status === 'failed' ? 'text-error' :
              status === 'coding' ? 'text-emerald-400' :
              status === 'validating' ? 'text-yellow-400' :
              'text-surface-400'
            }`}>
              {status === 'completed' ? 'Completed' :
               status === 'failed' ? 'Failed' :
               status === 'coding' ? 'Coding...' :
               status === 'validating' ? 'Validating...' :
               'Pending'}
            </span>
          </div>

          {/* Progress */}
          {result && result.totalTests > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-surface-500">Tests Passed</span>
                <span className="text-white">{result.passedCount}/{result.totalTests}</span>
              </div>
              <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(result.passedCount / result.totalTests) * 100}%` }}
                  className={`h-full ${result.passedCount === result.totalTests ? 'bg-success' : 'bg-primary-500'}`}
                />
              </div>
            </div>
          )}
        </div>

        {/* Tool Usage */}
        <AnimatePresence>
          {toolUse && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg"
            >
              <div className="flex items-center space-x-2 text-xs text-yellow-400 mb-2">
                <Terminal className="h-3 w-3" />
                <span>Using Tool: {toolUse.tool}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Code Display */}
        {code && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs text-surface-500 mb-2">
              <span>Live Code</span>
              {status === 'coding' && (
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
              <pre className="text-xs font-mono text-emerald-400 whitespace-pre-wrap break-words">
                {displayCode()}
                {status === 'coding' && <span className="typing-cursor">|</span>}
              </pre>
            </div>
          </div>
        )}

        {/* Test Results Grid */}
        {showTestResults && result.passedCount > 0 && (
          <div className="mb-4">
            <div className="text-xs text-surface-500 mb-2">Test Results</div>
            <div className="grid grid-cols-5 gap-1">
              {Array.from({ length: result.totalTests }).map((_, idx) => (
                <div
                  key={idx}
                  className={`h-6 rounded flex items-center justify-center ${
                    idx < result.passedCount
                      ? 'bg-success/20 border border-success/50'
                      : 'bg-error/20 border border-error/50'
                  }`}
                  title={`Test ${idx + 1}: ${idx < result.passedCount ? 'Passed' : 'Failed'}`}
                >
                  {idx < result.passedCount ? (
                    <CheckCircle className="h-3 w-3 text-success" />
                  ) : (
                    <XCircle className="h-3 w-3 text-error" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metrics */}
        {result && (
          <div className="space-y-2 text-sm">
            {result.executionTime && (
              <div className="flex items-center justify-between">
                <span className="text-surface-400">Execution Time</span>
                <span className="text-white">{(result.executionTime / 1000).toFixed(2)}s</span>
              </div>
            )}
            {result.tokensUsed > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-surface-400">Tokens Used</span>
                <span className="text-white font-mono">{result.tokensUsed.toLocaleString()}</span>
              </div>
            )}
            {result.generationTimeMs > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-surface-400">Generation Time</span>
                <span className="text-white">{(result.generationTimeMs / 1000).toFixed(2)}s</span>
              </div>
            )}
            {result.toolCalls > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-surface-400">Tool Calls</span>
                <span className="text-white">{result.toolCalls}</span>
              </div>
            )}
          </div>
        )}
      </Card>
    );
  };

  if (loading) {
    return (
      <>
        <Head>
          <title>Loading Replay - CodeArena</title>
        </Head>
        <div className="min-h-screen bg-surface-950 text-white flex items-center justify-center">
          <FloatingOrbs />
          <Card variant="glass" className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4" />
            <p className="text-surface-400">Loading battle replay...</p>
          </Card>
        </div>
      </>
    );
  }

  if (error || !battle) {
    return (
      <>
        <Head>
          <title>Error - CodeArena</title>
        </Head>
        <div className="min-h-screen bg-surface-950 text-white flex items-center justify-center">
          <FloatingOrbs />
          <Card variant="glass" className="p-8 text-center max-w-md">
            <div className="text-error mb-4">⚠️</div>
            <h2 className="text-xl font-bold mb-2">Failed to Load Replay</h2>
            <p className="text-surface-400 mb-4">{error || 'Battle not found'}</p>
            <Button variant="primary" onClick={() => router.push('/agent-battles')}>
              Back to Agent Battles
            </Button>
          </Card>
        </div>
      </>
    );
  }

  const totalDuration = events.length > 0 ? events[events.length - 1].timestamp_ms : 0;
  const progress = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;
  const problem = events.find(e => e.event_type === 'battle_start')?.event_data?.problem;

  return (
    <>
      <Head>
        <title>Battle Replay - CodeArena</title>
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

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }

        .typing-cursor {
          animation: blink 1s step-end infinite;
          color: #10b981;
          font-weight: bold;
        }
      `}</style>

      <div className="min-h-screen bg-surface-950 text-white">
        <FloatingOrbs />

        <div className="relative z-10 max-w-6xl mx-auto px-6 py-8">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between mb-6"
          >
            <button
              onClick={() => router.push('/agent-battles')}
              className="flex items-center space-x-2 text-surface-400 hover:text-white transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
              <span>Back to Agent Battles</span>
            </button>

            <div className="flex items-center space-x-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowKeyboardHelp(!showKeyboardHelp)}
                className="flex items-center space-x-2"
                title="Keyboard Shortcuts"
              >
                <Keyboard className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleShare}
                className="flex items-center space-x-2"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Share2 className="h-4 w-4" />
                    <span>Share Replay</span>
                  </>
                )}
              </Button>
            </div>
          </motion.div>

          {/* Keyboard Shortcuts Help */}
          <AnimatePresence>
            {showKeyboardHelp && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-6"
              >
                <Card variant="glass" className="p-4">
                  <h3 className="font-semibold mb-3 flex items-center space-x-2">
                    <Keyboard className="h-4 w-4" />
                    <span>Keyboard Shortcuts</span>
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-surface-400">Play / Pause</span>
                      <kbd className="px-2 py-1 bg-surface-800 rounded text-xs font-mono">Space</kbd>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-surface-400">Step Forward</span>
                      <kbd className="px-2 py-1 bg-surface-800 rounded text-xs font-mono">→</kbd>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-surface-400">Step Back</span>
                      <kbd className="px-2 py-1 bg-surface-800 rounded text-xs font-mono">←</kbd>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-surface-400">Restart</span>
                      <kbd className="px-2 py-1 bg-surface-800 rounded text-xs font-mono">R</kbd>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-surface-400">Skip to End</span>
                      <kbd className="px-2 py-1 bg-surface-800 rounded text-xs font-mono">E</kbd>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-surface-400">Change Speed</span>
                      <kbd className="px-2 py-1 bg-surface-800 rounded text-xs font-mono">S</kbd>
                    </div>
                  </div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Title */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center mb-6"
          >
            <h1 className="text-3xl font-bold mb-2">Battle Replay</h1>
            <p className="text-surface-400">
              {battle.player1.username} vs {battle.player2.username}
            </p>
          </motion.div>

          {/* Playback Controls */}
          <Card variant="glass" className="p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                {/* Restart */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRestart}
                  className="flex items-center space-x-1"
                  title="Restart"
                >
                  <SkipBack className="h-4 w-4" />
                </Button>

                {/* Step Back */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleStepBack}
                  disabled={currentEventIndex === 0}
                  className="flex items-center space-x-1"
                  title="Step Back"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                {/* Play/Pause */}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handlePlayPause}
                  className="flex items-center space-x-2 px-4"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="h-4 w-4" />
                      <span>Pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      <span>Play</span>
                    </>
                  )}
                </Button>

                {/* Step Forward */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleStepForward}
                  disabled={currentEventIndex >= events.length}
                  className="flex items-center space-x-1"
                  title="Step Forward"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>

                {/* Skip to End */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSkipToEnd}
                  className="flex items-center space-x-1"
                  title="Skip to End"
                >
                  <SkipForward className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center space-x-3">
                {/* Speed Control */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSpeedChange}
                  className="flex items-center space-x-2"
                >
                  <Zap className="h-4 w-4" />
                  <span>{playbackSpeed}x</span>
                </Button>

                {/* Time Display */}
                <div className="flex items-center space-x-2 px-3 py-1 bg-surface-800/50 rounded-lg">
                  <Clock className="h-4 w-4 text-surface-400" />
                  <span className="font-mono text-sm">
                    {formatTime(currentTime)} / {formatTime(totalDuration)}
                  </span>
                </div>

                {/* Event Counter */}
                <div className="px-3 py-1 bg-surface-800/50 rounded-lg">
                  <span className="font-mono text-sm text-surface-400">
                    Event {currentEventIndex}/{events.length}
                  </span>
                </div>
              </div>
            </div>

            {/* Progress Bar with Event Markers */}
            <div className="relative">
              <div
                className="relative h-3 bg-surface-800 rounded-full overflow-visible cursor-pointer"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const percentage = x / rect.width;
                  const timestamp = Math.floor(percentage * totalDuration);
                  handleSeek(timestamp);
                }}
              >
                {/* Progress Fill */}
                <motion.div
                  className="h-full bg-gradient-to-r from-primary-500 to-secondary-500 rounded-full"
                  style={{ width: `${progress}%` }}
                />

                {/* Event Markers */}
                {events.map((event, idx) => {
                  const position = totalDuration > 0 ? (event.timestamp_ms / totalDuration) * 100 : 0;
                  let markerColor = 'bg-surface-600';
                  let markerSize = 'w-1.5 h-1.5';

                  // Color code by event type
                  if (event.event_type === 'battle_start') {
                    markerColor = 'bg-green-500';
                    markerSize = 'w-2 h-2';
                  } else if (event.event_type === 'submission') {
                    markerColor = 'bg-blue-500';
                    markerSize = 'w-2 h-2';
                  } else if (event.event_type === 'result') {
                    markerColor = 'bg-purple-500';
                    markerSize = 'w-2 h-2';
                  } else if (event.event_type === 'tool_use') {
                    markerColor = 'bg-yellow-500';
                  }

                  return (
                    <div
                      key={idx}
                      className={`absolute top-1/2 -translate-y-1/2 ${markerSize} ${markerColor} rounded-full cursor-pointer hover:scale-150 transition-transform`}
                      style={{ left: `${position}%` }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSeek(event.timestamp_ms);
                      }}
                      title={event.event_type}
                    />
                  );
                })}

                {/* Current Position Indicator */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg border-2 border-primary-500"
                  style={{ left: `${progress}%`, marginLeft: '-6px' }}
                />
              </div>

              {/* Event Legend */}
              <div className="flex items-center justify-center space-x-4 mt-2 text-xs text-surface-500">
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full" />
                  <span>Start</span>
                </div>
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-blue-500 rounded-full" />
                  <span>Submission</span>
                </div>
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-purple-500 rounded-full" />
                  <span>Result</span>
                </div>
                <div className="flex items-center space-x-1">
                  <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full" />
                  <span>Tool Use</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Problem Card */}
          {problem && (
            <Card variant="glass" className="p-6 mb-6">
              <div className="flex items-center space-x-3 mb-4">
                <Code className="h-5 w-5 text-primary-400" />
                <h3 className="font-semibold text-lg">{problem.title}</h3>
              </div>
              <p className="text-surface-300 text-sm leading-relaxed">
                {problem.description?.slice(0, 300)}
                {problem.description?.length > 300 && '...'}
              </p>
            </Card>
          )}

          {/* Players Grid */}
          <div className="flex gap-6">
            <div className="flex-1">
              {/* eslint-disable-next-line react-hooks/static-components -- Revived agent battle page kept as originally written: PlayerPanel holds no state, so remounting it only costs a re-render. */}
              <PlayerPanel
                player={battle.player1}
                code={player1Code}
                toolUse={player1ToolUse}
                status={player1Status}
                result={player1Result}
                isWinner={battle.winnerId === battle.player1.id}
              />
            </div>

            {/* VS Divider */}
            <div className="flex flex-col items-center justify-center">
              <div className="w-px h-full bg-gradient-to-b from-transparent via-surface-600 to-transparent" />
              <div className="px-4 py-2 bg-surface-800 rounded-full text-surface-400 font-bold my-4">
                VS
              </div>
              <div className="w-px h-full bg-gradient-to-b from-transparent via-surface-600 to-transparent" />
            </div>

            <div className="flex-1">
              {/* eslint-disable-next-line react-hooks/static-components -- Revived agent battle page kept as originally written: PlayerPanel holds no state, so remounting it only costs a re-render. */}
              <PlayerPanel
                player={battle.player2}
                code={player2Code}
                toolUse={player2ToolUse}
                status={player2Status}
                result={player2Result}
                isWinner={battle.winnerId === battle.player2.id}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const AgentPage = withAuth(AgentReplay);
export default function AgentPageGated(props) {
  return <AgentBattlesGate><AgentPage {...props} /></AgentBattlesGate>
}
