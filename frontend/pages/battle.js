// Complete battle.js with all bug fixes applied
// Save as: frontend/pages/battle.js

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Logo from '../components/Logo';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Users,
  CheckCircle,
  XCircle,
  Send,
  User,
  Home,
  Copy,
  RotateCcw,
  Clock,
  LogOut,
  Target,
  ArrowLeft,
  Share2,
  Twitter,
  UserPlus,
  Bot,
  Flag,
  EyeOff,
  Code,
  ChevronRight
} from 'lucide-react';
import { io } from 'socket.io-client';
import { config } from '../config/env';
import { withAuth } from '../components/withAuth';
import { useAuth } from '../contexts/AuthContext';
import { trackStartBattle, trackSubmitSolution, trackEndBattle, trackLanguageSelect, trackBattleAbandon } from '../utils/analytics';
import CodeEditor from '../components/CodeEditor';
import ResizablePanel, { ResizablePanelVertical } from '../components/ResizablePanel';
import Button from '../components/ui/Button';
import SubmitButton from '../components/ui/SubmitButton';
import { Card } from '../components/ui/Card';
import KeyboardShortcut from '../components/ui/KeyboardShortcut';
import PartialCreditResult from '../components/PartialCreditResult';
import { useBattleActivityMetrics } from '../hooks/useBattleActivityMetrics';
import { useBattleCore } from '../hooks/useBattleCore';
import { useBattleResult } from '../hooks/useBattleResult';
import { useRematch } from '../hooks/useRematch';
import { useMatchmaking } from '../hooks/useMatchmaking';
import { useAntiCheatState } from '../hooks/useAntiCheatState';
import { generateBrowserFingerprint } from '../utils/browserFingerprint';
import { useBattleUI } from '../hooks/useBattleUI';
import { useEditorPreferences } from '../hooks/useEditorPreferences';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { useFriends } from '../contexts/FriendContext';
import { LAUNCH_LANGUAGE_IDS, getLanguageDisplayName, getLanguageFileExtension } from '../utils/languages';
// AntiCheatSuite removed from battles - using passive detection only
// Component preserved for future use in practice mode
// FloatingOrbs removed for cleaner design
import EnhancedFeedbackForm from '../components/EnhancedFeedbackForm';
import BattleErrorBoundary from '../components/BattleErrorBoundary';
import PlayerInvitePanel from '../components/PlayerInvitePanel';
import { fetchWithTimeout } from '../utils/fetch';
import { formatTimer as formatTime } from '../utils/formatting';
import ReportProblemModal from '../components/ReportProblemModal';
import { getPerformanceRating } from '../utils/performance';
import { ProblemDescription } from '../components/ProblemDescription';
import { bindBattleConnection } from '../utils/battleConnection';

// BattleErrorBoundary imported from components
// EnhancedFeedbackForm imported from shared component

function Battle() {
  const router = useRouter();
  const { user, token } = useAuth();
  const editorPrefs = useEditorPreferences();

  // Core battle state
  const {
    battleState, setBattleState,
    battleId, setBattleId,
    playerId, setPlayerId,
    playerName, setPlayerName,
    joinBattleId, setJoinBattleId,
    battle, setBattle,
    opponent, setOpponent,
    selectedLanguage, setSelectedLanguage,
    code, setCode,
    timeLeft, setTimeLeft,
    testResults, setTestResults,
    hiddenTestResults, setHiddenTestResults,
    connectionStatus, setConnectionStatus,
    error, setError,
    setServerTimeSync,
    resetCoreState,
    prepareForRematch,
    codeLoadedFromStorageRef
  } = useBattleCore();

  // Battle result state
  const {
    winner, setWinner,
    winnerName, setWinnerName,
    loserName, setLoserName,
    isTie, setIsTie,
    isPartialCredit, setIsPartialCredit,
    partialCreditData, setPartialCreditData,
    battleStartTime, setBattleStartTime,
    solveTime, setSolveTime,
    performanceData, setPerformanceData,
    battleViolations, setBattleViolations,
    ratingChanges, setRatingChanges,
    finishedPlayerCode, setFinishedPlayerCode,
    finishedOpponentCode, setFinishedOpponentCode,
    finishedPlayerLanguage, setFinishedPlayerLanguage,
    finishedOpponentLanguage, setFinishedOpponentLanguage,
    resetResultState
  } = useBattleResult();

  // Rematch state
  const {
    rematchStatus, setRematchStatus,
    rematchRequester, setRematchRequester,
    rematchTimeLeft,
    rematchTimerRef,
    startRematchTimer,
    stopRematchTimer,
    resetRematchState
  } = useRematch();

  // Matchmaking state
  const {
    isFromMatchmaking, setIsFromMatchmaking,
    skipLanguageSelection, setSkipLanguageSelection,
    allPlayersReady, setAllPlayersReady,
    canStartBattle, setCanStartBattle,
    readyButtonState, setReadyButtonState,
    startButtonState, setStartButtonState,
    showPreBattleScreen, setShowPreBattleScreen,
    preloadProgress, setPreloadProgress,
    battlePhase, setBattlePhase,
    countdownNumber, setCountdownNumber,
    countdownIntervalRef,
    loadingIntervalRef,
    resetMatchmakingState
  } = useMatchmaking();

  // Anti-cheat UI state
  const {
    focusLostTime, setFocusLostTime,
    setTotalTimeAway,
    focusWarnings, setFocusWarnings,
    pasteWarning, setPasteWarning,
    copyWarning, setCopyWarning,
    opponentViolation, setOpponentViolation,
    devToolsOpen, setDevToolsOpen,
    integrityScore, setIntegrityScore,
    setViolationCount,
    resetAntiCheatState
  } = useAntiCheatState();

  // UI and modal state
  const {
    battleLinkToast, setBattleLinkToast,
    isEvaluating, setIsEvaluating,
    showOpponentLeftModal, setShowOpponentLeftModal,
    showForfeitModal, setShowForfeitModal,
    showFeedback, setShowFeedback,
    showUnderstandingGate, setShowUnderstandingGate,
    pendingSubmission, setPendingSubmission,
    resetUIState
  } = useBattleUI();

  // Friends context for post-battle friend requests
  const {
    sendFriendRequest,
    isFriend,
    hasPendingRequestTo,
    hasPendingRequestFrom,
    friendError,
    clearError: clearFriendError
  } = useFriends();

  // Friend request state for opponent
  const [friendRequestSent, setFriendRequestSent] = useState(false);
  const [friendRequestError, setFriendRequestError] = useState(null);

  // Bot battle state
  const [isAgainstBot, setIsAgainstBot] = useState(false);
  const [botDifficulty, setBotDifficulty] = useState(null);
  const [showReportProblem, setShowReportProblem] = useState(false);

  // Submit button feedback state
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  // Player test progress tracking (for display during battle)
  const [playerTestsPassed, setPlayerTestsPassed] = useState(0);
  const [playerTestsTotal, setPlayerTestsTotal] = useState(0);

  // Time limit for private battles (in seconds)
  const [selectedTimeLimit, setSelectedTimeLimit] = useState(600); // Default 10 minutes
  const [isRanked, setIsRanked] = useState(false); // Private battles default to unranked

  // Device fingerprint for trust system
  const [deviceFingerprint, setDeviceFingerprint] = useState(null);

  // Local-only activity totals used for battle integrity checks.
  const {
    startTracking: startActivityTracking,
    stopTracking: stopActivityTracking,
    trackActivity,
    trackCodeChange,
    isTracking: isActivityTracking,
    getMetrics
  } = useBattleActivityMetrics();

  const socketRef = useRef(null);
  const timerRef = useRef(null);
  const syncTimerRef = useRef(null);
  // Tracks stray setTimeout ids that aren't otherwise stored in refs, so we
  // can clear them on unmount and avoid setState-on-unmounted warnings/leaks.
  const pendingTimeoutsRef = useRef(new Set());
  const battleStateRef = useRef(battleState);
  const battleStartedRef = useRef(false); // Flag to prevent duplicate start-battle emissions
  const hasJoinedBattleRef = useRef(null); // Track which battleId we've joined to prevent duplicate join-battle emissions
  const connectionCleanupRef = useRef(null);
  const connectionContextRef = useRef(null);
  useEffect(() => {
    connectionContextRef.current = { battleId, playerId, language: selectedLanguage, battleState };
  }, [battleId, playerId, selectedLanguage, battleState]);
  const isFromMatchmakingRef = useRef(false); // Track matchmaking vs private battle in callbacks
  const codeSetByServerRef = useRef(false); // Prevent race condition with starter code
  const playerIdRef = useRef(playerId); // Track current playerId for socket listeners during rematch
  const battleIdRef = useRef(battleId); // Track current battleId to filter stale events from old battles

  useEffect(() => {
    battleStateRef.current = battleState;
  }, [battleState]);

  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  useEffect(() => {
    battleIdRef.current = battleId;
  }, [battleId]);

  useEffect(() => {
    isFromMatchmakingRef.current = isFromMatchmaking;
  }, [isFromMatchmaking]);

  // Set player name from authenticated user
  useEffect(() => {
    const n = user?.username;
    if (n && !playerName) {
      setPlayerName(n);
    }
  }, [user, playerName, setPlayerName]);

  // Auto-dismiss errors after 8 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(''), 8000);
      return () => clearTimeout(timer);
    }
  }, [error, setError]);

  // Generate device fingerprint on mount for trust system
  useEffect(() => {
    generateBrowserFingerprint().then(setDeviceFingerprint).catch(() => {});
  }, []);

  const validateLanguage = (lang) => {
    return LAUNCH_LANGUAGE_IDS.includes(lang);
  };

  // startRematchTimer and stopRematchTimer are provided by useRematch hook

  // Starter code is authored server-side and shipped with the problem
  const getStarterCode = (problemId, language) => {
    const source = battle?.problem;
    if (!source || source.id !== problemId) return '';
    return source.starterCode?.[language] || '';
  };

  // Languages come from the problem: the server's runner decides what it can grade
  const runnableLanguageIds = battle?.problem?.runnableLanguages;
  const languages = useMemo(() => {
    const ids = Array.isArray(runnableLanguageIds) && runnableLanguageIds.length > 0
      ? runnableLanguageIds
      : LAUNCH_LANGUAGE_IDS;
    return Object.fromEntries(ids.map(id => [id, {
      name: getLanguageDisplayName(id),
      icon: '',
      extension: getLanguageFileExtension(id)
    }]));
  }, [runnableLanguageIds]);

  const prevSelectedLanguageRef = useRef(selectedLanguage);
  useEffect(() => {
    const languageChanged = prevSelectedLanguageRef.current !== selectedLanguage;
    prevSelectedLanguageRef.current = selectedLanguage;

    // Skip if code was just set by server (battle-joined) to prevent race condition
    // But NOT if the user explicitly switched language
    if (codeSetByServerRef.current && !languageChanged) {
      codeSetByServerRef.current = false;
      return;
    }
    codeSetByServerRef.current = false;

    // Skip if code was loaded from localStorage (prevent overwriting saved work)
    // But NOT if the user explicitly switched language
    if (codeLoadedFromStorageRef.current && !languageChanged) {
      codeLoadedFromStorageRef.current = false;
      return;
    }
    codeLoadedFromStorageRef.current = false;

    if (battle?.problem?.id && languages[selectedLanguage]) {
      const starterCode = getStarterCode(battle.problem.id, selectedLanguage);
      setCode(starterCode);
    }
  }, [selectedLanguage, battle?.problem?.id, languages, setCode, codeLoadedFromStorageRef]);

  // CRITICAL FIX: Enhanced URL parameter handling
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const battleIdFromUrl = urlParams.get('id');
    const playerIdFromUrl = urlParams.get('playerId');
    const joinIdFromUrl = urlParams.get('join');
    const opponentNameFromUrl = urlParams.get('opponent');
    const yourNameFromUrl = urlParams.get('yourName');
    const fromMatchmaking = urlParams.get('matchmaking');
    const skipLangSelection = urlParams.get('skipLanguageSelection');
    const languageFromUrl = urlParams.get('language');
    const isAgainstBotFromUrl = urlParams.get('isAgainstBot');
    const botDifficultyFromUrl = urlParams.get('botDifficulty');

    // Case 1: Valid battle context (both IDs present)
    if (battleIdFromUrl && playerIdFromUrl) {
      setBattleId(battleIdFromUrl);
      setPlayerId(playerIdFromUrl);

      if (yourNameFromUrl) {
        setPlayerName(decodeURIComponent(yourNameFromUrl));
      }

      if (languageFromUrl && validateLanguage(languageFromUrl)) {
        setSelectedLanguage(languageFromUrl);
      }

      // Check if this is a bot battle
      if (isAgainstBotFromUrl === 'true') {
        setIsAgainstBot(true);
        if (botDifficultyFromUrl) {
          setBotDifficulty(botDifficultyFromUrl);
        }
      }

      // CRITICAL: Only set opponent if we have opponent name AND valid battle context
      if (opponentNameFromUrl) {
        setOpponent({
          name: decodeURIComponent(opponentNameFromUrl),
          language: 'python',
          ready: false,
          submitted: false,
          isBot: isAgainstBotFromUrl === 'true'
        });
      }

      if (fromMatchmaking === 'true') setIsFromMatchmaking(true);
      if (skipLangSelection === 'true') {
        setSkipLanguageSelection(true);
        setBattleState('waiting');
      } else {
        setBattleState('waiting');
      }
      setError('');
      return;
    }
    
    // Case 2: Only join ID (user clicked join link)
    if (joinIdFromUrl && !battleIdFromUrl && !playerIdFromUrl) {
      setJoinBattleId(joinIdFromUrl);
      setBattleState('menu');
      setError('');
      // CRITICAL: Clear all stale data
      setOpponent(null);
      setIsFromMatchmaking(false);
      setPlayerName('');
      return;
    }
    
    // Case 3: No URL parameters (fresh visit or manual navigation)
    setBattleState('menu');
    setOpponent(null);
    setJoinBattleId('');
    setIsFromMatchmaking(false);
    setPlayerName('');

    // TEST MODE: Preview countdown animation with ?testCountdown=true
    const testCountdown = urlParams.get('testCountdown');
    if (testCountdown === 'true') {
      setBattleState('ready');
      setShowPreBattleScreen(true);
      setBattlePhase('countdown');
      setCountdownNumber(3);

      // Run the countdown animation
      let count = 3;
      const countdownInterval = setInterval(() => {
        count -= 1;
        if (count <= 0) {
          clearInterval(countdownInterval);
          // Reset to menu after showing the animation
          setTimeout(() => {
            setCountdownNumber(3);
            setShowPreBattleScreen(false);
            setBattlePhase('');
            setBattleState('menu');
          }, 1000);
        } else {
          setCountdownNumber(count);
        }
      }, 1000);

      return;
    }
  }, [router.asPath, setBattleId, setPlayerId, setPlayerName, setSelectedLanguage, setOpponent, setIsFromMatchmaking, setSkipLanguageSelection, setBattleState, setError, setJoinBattleId, setShowPreBattleScreen, setBattlePhase, setCountdownNumber]);

  const battleTimeLimitRef = useRef(600);
  const battleServerStartRef = useRef(null);

  const startTimer = useCallback((startedAt, timeLimit) => {
    const serverStartTime = new Date(startedAt).getTime();

    if (timerRef.current) clearInterval(timerRef.current);
    if (syncTimerRef.current) clearInterval(syncTimerRef.current);

    setBattleStartTime(serverStartTime);
    battleServerStartRef.current = serverStartTime;
    battleTimeLimitRef.current = timeLimit;

    const elapsed = Math.max(0, (Date.now() - serverStartTime) / 1000);
    setTimeLeft(Math.max(0, Math.round(timeLimit - elapsed)));

    // Use wall-clock time so timer stays accurate even if tab is backgrounded
    timerRef.current = setInterval(() => {
      const now = Date.now();
      const elapsedSec = Math.max(0, (now - serverStartTime) / 1000);
      const remaining = Math.max(0, timeLimit - elapsedSec);
      setTimeLeft(Math.round(remaining));
      if (remaining <= 0) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, 1000);

    syncTimerRef.current = setInterval(async () => {
      try {
        const response = await fetchWithTimeout(`${config.backend_url}/api/battle/${battleId}/timer`, {}, 10000);
        const data = await response.json();
        if (data.success) {
          setTimeLeft(Math.max(0, Math.round(data.timeRemaining)));
          setServerTimeSync(data.serverTime);
        }
      } catch (error) {
        // Timer sync skipped silently
      }
    }, 30000);
  }, [battleId, setBattleStartTime, setTimeLeft, setServerTimeSync]);

  // CRITICAL FIX: Comprehensive state reset function
  // Uses hook reset functions to minimize dependencies and prevent stale closures
  const resetAllState = useCallback(() => {
    // Reset all hook states using their built-in reset functions
    resetCoreState();
    resetResultState();
    resetRematchState();
    resetMatchmakingState();
    resetAntiCheatState();
    resetUIState();

    // Reset player test progress
    setPlayerTestsPassed(0);
    setPlayerTestsTotal(0);

    // CRITICAL: Clear URL to prevent state rehydration
    window.history.replaceState(null, '', '/battle');

    // Clean up invite flag
    sessionStorage.removeItem('joinedViaInvite');

    // Clear local timers
    if (timerRef.current) clearInterval(timerRef.current);
    if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    battleStartedRef.current = false;

    // CRITICAL: Disconnect socket
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, [resetCoreState, resetResultState, resetRematchState, resetMatchmakingState, resetAntiCheatState, resetUIState]);

  const exitBattle = () => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('exit-battle', { battleId, playerId, reason: 'player_exit' });
    }
    resetAllState();
    router.push('/modes');
  };

  const returnToModes = () => {
    router.push('/modes');
  };

  const returnToMatchmaking = () => {
    router.push('/matchmaking');
  };

  const goToPracticeMode = () => {
    if (battle?.problem?.id) {
      const problemId = battle.problem.id;
      const lang = selectedLanguage || 'python';
      if (code) {
        localStorage.setItem(`practice-code-${problemId}-${lang}`, code);
      }
      const battleRef = battle?.id || battleId;
      router.push(`/practice?problem=${encodeURIComponent(problemId)}${battleRef ? `&after=${encodeURIComponent(battleRef)}` : ''}`);
    } else {
      router.push('/practice');
    }
  };

  const startNewPrivateBattle = () => {
    resetAllState();
  };

  const requestRematch = () => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('request-rematch', { battleId, playerId, playerName });
      setRematchStatus('requesting');
    } else {
      setError('Not connected to server');
    }
  };

  const acceptRematch = () => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('respond-rematch', { battleId, playerId, accepted: true });
      setRematchStatus('accepted');
      stopRematchTimer();
    } else {
      setError('Not connected to server');
    }
  };

  const declineRematch = () => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('respond-rematch', { battleId, playerId, accepted: false });
      setRematchStatus('declined');
      setRematchRequester(null);
      stopRematchTimer();
    } else {
      setError('Not connected to server');
    }
  };

  const cancelRematch = () => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('cancel-rematch', { battleId, playerId });
      setRematchStatus(null);
      stopRematchTimer();
    } else {
      setError('Not connected to server');
    }
  };

  const setupSocketListeners = useCallback((socket) => {
    // Remove all existing listeners to prevent duplicates
    connectionCleanupRef.current?.();
    socket.removeAllListeners();
    connectionCleanupRef.current = bindBattleConnection(socket, {
      getContext: () => connectionContextRef.current,
      joinedBattleRef: hasJoinedBattleRef,
      onStatus: setConnectionStatus,
      onError: setError,
    });

    socket.on('error', (error) => {
      setError('Socket error: ' + (typeof error === 'string' ? error : error.message || 'Unknown error'));
    });

    socket.on('battle-joined', ({ battle: battleData, yourPlayerId, yourLanguage }) => {
      // Mark that code will be set by server to prevent race condition with language useEffect
      codeSetByServerRef.current = true;

      if (yourLanguage && yourLanguage !== selectedLanguage) {
        setSelectedLanguage(yourLanguage);
      }

      setBattle(battleData);
      const opp = battleData.players?.find(p => p.id !== yourPlayerId);

      if (opp) {
        setOpponent(prev => ({
          ...opp,
          language: opp.language || 'python',
          // Preserve isBot flag from URL params or use server's value
          isBot: opp.isBot || prev?.isBot || false
        }));
      }

      if (battleData.problem?.id) {
        // Check if we have saved code in localStorage first
        const savedCode = typeof window !== 'undefined'
          ? localStorage.getItem(`codearena-code-${battleData.id}`)
          : null;

        if (savedCode) {
          // Use saved code from localStorage (preserves work on refresh)
          setCode(savedCode);
          codeLoadedFromStorageRef.current = true;
        } else {
          // No saved code, use starter code
          // Use battleData directly (not stale `battle` closure) so rematch gets the new problem's description
          const starterCode = battleData.problem.starterCode?.[yourLanguage || selectedLanguage] || '';
          setCode(starterCode);
        }
      }
      
      if (battleData.state === 'coding' && battleStateRef.current !== 'coding') {
        battleStateRef.current = 'coding'; // Update synchronously to prevent duplicate startTimer calls
        setBattleState('coding');
        startTimer(battleData.startedAt, battleData.timeLimit);
      } else if (battleData.state === 'ready' && battleStateRef.current === 'waiting') {
        // Handle joining during countdown phase (e.g., challenge/matchmade auto-start)
        setBattleState('ready');
        setAllPlayersReady(true);
        setCanStartBattle(true);
      }
    });

    socket.on('player-joined', ({ player }) => {
      setOpponent(prev => ({
        ...player,
        language: player.language || 'python',
        // Preserve isBot flag from previous state or use server's value
        isBot: player.isBot || prev?.isBot || false
      }));
    });

    socket.on('player-language-update', ({ playerId: langPlayerId, language }) => {
      if (langPlayerId !== playerId) {
        setOpponent(prev => prev ? { ...prev, language } : null);
      }
    });

    socket.on('player-ready-update', ({ battleId: eventBattleId, playerId: readyPlayerId, ready, language }) => {
      // Filter out events from old battles (e.g., stale events during rematch)
      if (eventBattleId && eventBattleId !== battleIdRef.current) {
        return;
      }
      // Use ref to get current playerId (not stale closure value from when listener was set up)
      if (readyPlayerId !== playerIdRef.current) {
        setOpponent(prev => {
          // Only show toast when opponent transitions from not-ready to ready
          if (prev && !prev.ready && ready) {
            setBattleLinkToast({ message: 'Your opponent is ready to battle!', success: true });
          }
          return prev ? { ...prev, ready, language } : null;
        });
      }
    });

    socket.on('all-players-ready', ({ canStart }) => {
      setAllPlayersReady(true);
      setCanStartBattle(canStart);

      if (battleStateRef.current === 'waiting') {
        setBattleState('ready');
      }

      // Auto-start countdown when both players are ready
      // Server ignores duplicate request-countdown via countdownStarted flag
      if (canStart && !battleStartedRef.current && socket.connected) {
        socket.emit('request-countdown', { battleId, playerId });
        setShowPreBattleScreen(true);
        setBattlePhase('loading');
        setPreloadProgress(0);
      }
    });

    // Synchronized countdown - BOTH players receive this at the same time
    socket.on('countdown-sync', ({ battleStartTime, countdownSeconds }) => {
      // Clear any existing intervals
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      if (loadingIntervalRef.current) {
        clearInterval(loadingIntervalRef.current);
        loadingIntervalRef.current = null;
      }

      // Show countdown screen
      setShowPreBattleScreen(true);
      setBattlePhase('countdown');
      setPreloadProgress(100);
      setCountdownNumber(countdownSeconds);

      // Calculate time remaining based on server time for precision
      const now = Date.now();
      const timeUntilStart = battleStartTime - now;
      const currentCount = Math.ceil(timeUntilStart / 1000);
      setCountdownNumber(Math.min(currentCount, countdownSeconds));

      // Synchronized countdown interval
      countdownIntervalRef.current = setInterval(() => {
        const remaining = battleStartTime - Date.now();
        const count = Math.ceil(remaining / 1000);

        if (count <= 0) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
          setCountdownNumber(0);
          // Server will send battle-started event
          // Fallback: if battle-started doesn't arrive within 8 seconds, clear the screen
          const fallbackId = setTimeout(() => {
            pendingTimeoutsRef.current.delete(fallbackId);
            if (battleStateRef.current === 'ready') {
              setShowPreBattleScreen(false);
              setBattlePhase('');
              setPreloadProgress(0);
              setStartButtonState('idle');
              setCountdownNumber(3);
            }
          }, 8000);
          pendingTimeoutsRef.current.add(fallbackId);
        } else {
          setCountdownNumber(Math.max(1, count));
        }
      }, 100); // Check every 100ms for smooth countdown
    });

    socket.on('battle-started', ({ startedAt, timeLimit }) => {
      // Set flag immediately to prevent any in-flight countdown from emitting start-battle
      battleStartedRef.current = true;

      // Clear any running countdown/loading intervals immediately
      // This handles the case where another player started the battle while we were counting down
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      if (loadingIntervalRef.current) {
        clearInterval(loadingIntervalRef.current);
        loadingIntervalRef.current = null;
      }

      setShowPreBattleScreen(false);
      setBattlePhase('');
      setPreloadProgress(0);
      setStartButtonState('idle');
      setCountdownNumber(3);
      setError(''); // Clear any previous errors

      // Track battle start
      trackStartBattle({
        battleId: battleId,
        problemId: battle?.problem?.id,
        problemName: battle?.problem?.title,
        battleType: isFromMatchmakingRef.current ? 'QUICK_MATCH' : 'PRIVATE',
        language: selectedLanguage
      }, user);

      // Start local activity tracking for battle integrity.
      if (battle?.problem) {
        startActivityTracking();
      }

      if (battleStateRef.current !== 'coding') {
        battleStateRef.current = 'coding'; // Update synchronously to prevent duplicate startTimer calls
        setBattleState('coding');
        startTimer(startedAt, timeLimit);
      }
    });

    socket.on('timer-sync', ({ timeRemaining, serverTime }) => {
      setTimeLeft(Math.max(0, Math.round(timeRemaining)));
      setServerTimeSync(serverTime);
    });

    socket.on('battle-tie', (data) => {
      setBattleState('finished');
      setIsTie(true);
      setWinner('tie');
      setError('');

      // Store rating changes from server (ties can have ELO adjustments)
      if (data?.ratingChanges) {
        setRatingChanges(data.ratingChanges);
      }

      // Track battle end as timeout/tie
      const durationSeconds = battleStartTime
        ? Math.floor((Date.now() - battleStartTime) / 1000)
        : 600; // Default 10 min
      trackEndBattle({
        battleId: battleId,
        problemId: battle?.problem?.id,
        playerResult: 'TIMEOUT',
        durationSeconds: durationSeconds,
        problemSolved: false,
        battleType: isFromMatchmakingRef.current ? 'QUICK_MATCH' : 'PRIVATE'
      }, user);

      stopActivityTracking();

      if (timerRef.current) clearInterval(timerRef.current);
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    });

    socket.on('battle-partial-credit', ({
      message,
      isPartialCredit: partialCredit,
      winner: winnerId,
      loser: loserId,
      winnerName: wName,
      loserName: lName,
      testProgress,
      ratingChanges,
      scaleFactor
    }) => {
      setBattleState('finished');
      const isWinner = winnerId === playerId;
      setWinner(isWinner ? 'you' : 'opponent');
      setWinnerName(wName);
      setLoserName(lName);
      setIsTie(false);
      setIsPartialCredit(true);
      setPartialCreditData({ testProgress, scaleFactor, ratingChanges });
      if (ratingChanges) {
        setRatingChanges(ratingChanges);
      }
      setError('');

      // Track battle end as partial credit win/loss
      const durationSeconds = battleStartTime
        ? Math.floor((Date.now() - battleStartTime) / 1000)
        : 600;
      trackEndBattle({
        battleId: battleId,
        problemId: battle?.problem?.id,
        playerResult: isWinner ? 'PARTIAL_WIN' : 'PARTIAL_LOSS',
        durationSeconds: durationSeconds,
        problemSolved: false,
        battleType: isFromMatchmakingRef.current ? 'QUICK_MATCH' : 'PRIVATE'
      }, user);

      stopActivityTracking();

      if (timerRef.current) clearInterval(timerRef.current);
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    });

    socket.on('player-submitted', ({ playerId: submittedPlayerId }) => {
      if (submittedPlayerId !== playerId) {
        setOpponent(prev => prev ? { ...prev, submitted: true } : null);
      }
    });

    // Handle opponent submission with test results (e.g., bot failed submission)
    socket.on('opponent-submitted', ({ playerId: submittedPlayerId, passed, testResults: opponentTestResults }) => {
      if (submittedPlayerId !== playerId) {
        const testsPassed = opponentTestResults?.filter(r => r.passed)?.length || 0;
        const testsTotal = opponentTestResults?.length || 0;
        setOpponent(prev => prev ? {
          ...prev,
          submitted: true,
          submissionPassed: passed,
          testsPassed,
          testsTotal
        } : null);
      }
    });

    socket.on('opponent-progress', ({ playerId: progressPlayerId, testsPassed, testsTotal }) => {
      if (progressPlayerId !== playerId) {
        setOpponent(prev => prev ? {
          ...prev,
          testsPassed: Math.max(prev.testsPassed || 0, testsPassed),
          testsTotal
        } : null);
      }
    });

    // Handle bot giving up (shows a toast notification before battle-finished)
    socket.on('bot-gave-up', ({ botName, reason }) => {
      setBattleLinkToast({
        message: `${botName || 'Bot'} gave up: ${reason || 'couldn\'t solve the problem'}`,
        success: true
      });
    });

    socket.on('battle-finished', ({
      winner: winnerId,
      loser: loserId,
      winnerName: wName,
      loserName: lName,
      testResults: results,
      winnerTestResults,
      winnerHiddenTests,
      loserTestResults,
      loserHiddenTests,
      forfeit,
      winnerPerformance,
      loserPerformance,
      winnerCode: wCode,
      loserCode: lCode,
      winnerLanguage: wLang,
      loserLanguage: lLang,
      violations,
      isAgainstBot: isBotBattle,
      ratingChanges: serverRatingChanges
    }) => {
      setBattleState('finished');
      const isWinner = winnerId === playerId;
      setWinner(isWinner ? 'you' : 'opponent');
      setWinnerName(wName);
      setLoserName(lName);

      // Store both players' code for the results screen
      setFinishedPlayerCode(isWinner ? wCode : lCode);
      setFinishedOpponentCode(isWinner ? lCode : wCode);
      setFinishedPlayerLanguage(isWinner ? (wLang || 'python') : (lLang || 'python'));
      setFinishedOpponentLanguage(isWinner ? (lLang || 'python') : (wLang || 'python'));

      // Use player-specific test results so loser sees their own results, not winner's
      if (winnerTestResults && loserTestResults) {
        setTestResults(isWinner ? winnerTestResults : loserTestResults);
        setHiddenTestResults(isWinner ? (winnerHiddenTests || null) : (loserHiddenTests || null));
      } else {
        setTestResults(results);
      }
      setIsTie(false);

      // Store rating changes from server
      if (serverRatingChanges) {
        setRatingChanges(serverRatingChanges);
      }

      // Update bot battle state from server response
      if (isBotBattle !== undefined) {
        setIsAgainstBot(isBotBattle);
      }

      if (violations) {
        setBattleViolations({
          you: isWinner ? violations.winner : violations.loser,
          opponent: isWinner ? violations.loser : violations.winner
        });
      }

      // Calculate duration and determine result
      const durationSeconds = battleStartTime
        ? Math.floor((Date.now() - battleStartTime) / 1000)
        : winnerPerformance?.solveTime || 0;

      // Track battle end
      trackEndBattle({
        battleId: battleId,
        problemId: battle?.problem?.id,
        playerResult: forfeit
          ? (isWinner ? 'WIN' : 'FORFEIT')
          : (isWinner ? 'WIN' : 'LOSE'),
        durationSeconds: durationSeconds,
        problemSolved: isWinner,
        battleType: isFromMatchmakingRef.current ? 'QUICK_MATCH' : 'PRIVATE'
      }, user);

      stopActivityTracking();

      if (winnerId === playerId && winnerPerformance) {
        setPerformanceData(winnerPerformance);
        setSolveTime(winnerPerformance.solveTime);
      } else if (loserId === playerId && loserPerformance) {
        setPerformanceData(loserPerformance);
        setSolveTime(loserPerformance.timeSpent || 0);
      } else if (battleStartTime) {
        const calculatedTime = Math.floor((Date.now() - battleStartTime) / 1000);
        if (winnerId === playerId) {
          const perfData = getPerformanceRating(calculatedTime);
          setPerformanceData({ ...perfData, solveTime: calculatedTime });
          setSolveTime(calculatedTime);
        }
      }

      // Forfeit handled silently

      if (timerRef.current) clearInterval(timerRef.current);
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    });

    socket.on('submission-evaluating', () => {
      setIsEvaluating(true);
    });

    socket.on('submission-result', ({ testResults: results, hiddenTests, passed, error: submissionError }) => {
      setIsEvaluating(false);
      setTestResults(results || []);
      setHiddenTestResults(hiddenTests || null);

      // Update player test progress display (includes both visible and hidden tests)
      const visiblePassed = results?.filter(r => r.passed)?.length || 0;
      const hiddenPassed = hiddenTests?.passed || 0;
      const visibleTotal = results?.length || 0;
      const hiddenTotal = hiddenTests?.total || 0;
      setPlayerTestsPassed(visiblePassed + hiddenPassed);
      setPlayerTestsTotal(visibleTotal + hiddenTotal);

      // Update submit button feedback
      if (passed) {
        setSubmitSuccess(true);
        setSubmitError(false);
      } else {
        setSubmitError(true);
        setSubmitSuccess(false);
      }

      // Track solution submission
      const failedCount = results?.filter(r => !r.passed)?.length || 0;
      trackSubmitSolution({
        battleId: battleId,
        problemId: battle?.problem?.id,
        accepted: passed,
        testcasesPassed: visiblePassed + hiddenPassed,
        testcasesFailed: failedCount
      }, user);

      if (submissionError) {
        setError('Submission error: ' + submissionError);
      }
    });

    // Handle rate limiting - reset evaluating state so user can retry
    socket.on('rate-limit-exceeded', ({ message }) => {
      setIsEvaluating(false);
      setError(message || 'Too many submissions. Please wait before trying again.');
    });

    socket.on('opponent-left', ({ message, returnToMatchmaking: shouldReturnToMatchmaking }) => {
      setError(message || 'Your opponent has left the battle');

      if (isFromMatchmaking || shouldReturnToMatchmaking) {
        setTimeout(() => {
          setShowOpponentLeftModal(true);
        }, 2000);
      } else {
        setTimeout(() => {
          resetAllState();
        }, 3000);
      }
    });

    socket.on('player-disconnected', ({ playerId: disconnectedPlayerId, playerName, message }) => {
      if (disconnectedPlayerId !== playerId) {
        setOpponent(prev => prev ? { ...prev, disconnected: true } : null);
        setError(message || `${playerName} has disconnected`);
      }
    });

    socket.on('rematch-request-sent', () => {
      setRematchStatus('requesting');
      startRematchTimer(30000);
    });

    socket.on('rematch-requested', ({ requesterId, requesterName }) => {
      setRematchStatus('pending');
      setRematchRequester({ id: requesterId, name: requesterName });
      startRematchTimer(30000);
    });

    socket.on('rematch-accepted', ({ battleId: newBattleId, playerId: newPlayerId, opponentName }) => {
      // Reset all state using hook functions (reduces re-renders and dependencies)
      prepareForRematch(newBattleId, newPlayerId);
      resetResultState();
      resetMatchmakingState();
      resetRematchState();
      setIsAgainstBot(false); // Reset bot flag for rematch
      setBattleLinkToast(null); // Clear any toast from previous battle
      codeSetByServerRef.current = false; // Reset to prevent stale code from previous battle
      if (opponentName) {
        setOpponent({ name: opponentName, language: 'python', ready: false, submitted: false });
      }
      battleStartedRef.current = false;

      // Mark as joined BEFORE updating URL to prevent the URL param effect
      // and socket connection effect from emitting a duplicate join-battle
      hasJoinedBattleRef.current = newBattleId;

      window.history.replaceState(null, '', `/battle?id=${newBattleId}&playerId=${newPlayerId}`);

      // Join the new battle after a short delay to let state settle
      setTimeout(() => {
        if (socket && socket.connected) {
          socket.emit('join-battle', {
            battleId: newBattleId,
            playerId: newPlayerId,
            language: selectedLanguage
          });
        }
      }, 500);
    });

    socket.on('rematch-declined', () => {
      setRematchStatus('declined');
      setRematchRequester(null);
      stopRematchTimer();
      
      setTimeout(() => {
        setRematchStatus(null);
      }, 3000);
    });

    socket.on('rematch-expired', () => {
      // Client-side timer already handles expiration - only process if not already expired
      setRematchStatus(prev => {
        if (prev === 'expired' || prev === null) return prev;
        return 'expired';
      });
      setRematchRequester(null);
      stopRematchTimer();
    });

    socket.on('rematch-cancelled', () => {
      setRematchStatus(null);
      setRematchRequester(null);
      stopRematchTimer();
    });

    socket.on('rematch-request-cancelled', () => {
      setRematchStatus(null);
      stopRematchTimer();
    });

    // Anti-cheating: Listen for opponent violations
    socket.on('opponent-violation', ({ violationType, severity, opponentName, message }) => {
      setOpponentViolation({
        id: Date.now(),
        type: violationType,
        severity,
        opponentName,
        message
      });
    });

    // Anti-cheating: Listen for account suspension
    socket.on('account-suspended', ({ reason, duration }) => {
      setError(`Account suspended: ${reason}. Duration: ${duration}`);
      setBattleState('menu');
    });

    // Anti-cheating: Listen for integrity status updates
    socket.on('battle-integrity-status', ({ violations, integrityScore: score }) => {
      setIntegrityScore(score);
      setViolationCount(violations.count || 0);
    });

  }, [
    // Values accessed in handlers
    battleId, playerId, selectedLanguage, isFromMatchmaking, battleStartTime, battle, code,
    // Timer functions
    startTimer, startRematchTimer, stopRematchTimer,
    // Local activity tracking
    startActivityTracking, stopActivityTracking,
    // Reset functions (consolidated state updates)
    resetAllState, prepareForRematch, resetResultState, resetMatchmakingState, resetRematchState,
    // Individual setters still needed in handlers
    setBattle, setBattleState, setBattleViolations, setCode, setConnectionStatus, setError,
    setIntegrityScore, setIsEvaluating, setIsTie, setLoserName, setOpponent, setOpponentViolation,
    setPerformanceData, setRematchRequester, setRematchStatus, setSelectedLanguage, setServerTimeSync,
    setShowOpponentLeftModal, setSolveTime, setTestResults, setTimeLeft,
    setViolationCount, setWinner, setWinnerName,
    // Other
    user
  ]);

  useEffect(() => {
    if (['waiting', 'ready', 'coding'].includes(battleState)) {
      if (!socketRef.current) {
        const newSocket = io(config.backend_url, {
          transports: ['websocket', 'polling'],
          timeout: 20000,
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          auth: { token }
        });

        socketRef.current = newSocket;
        setupSocketListeners(newSocket);
        setConnectionStatus('connecting');
      } else if (battleId && playerId && battleState === 'waiting' && socketRef.current.connected && hasJoinedBattleRef.current !== battleId) {
        // Only emit join-battle if we haven't already joined this battle (prevents rate limit issues on preference changes)
        hasJoinedBattleRef.current = battleId;
        socketRef.current.emit('join-battle', { battleId, playerId, language: selectedLanguage });
      }
    }

    // Capture refs for cleanup
    const rematchTimer = rematchTimerRef.current;
    return () => {
      if (battleState === 'menu' || battleState === 'finished') {
        connectionCleanupRef.current?.();
        connectionCleanupRef.current = null;
        hasJoinedBattleRef.current = null; // Reset for next battle
        if (socketRef.current) {
          socketRef.current.removeAllListeners();
          socketRef.current.disconnect();
          socketRef.current = null;
        }
        if (timerRef.current) clearInterval(timerRef.current);
        if (syncTimerRef.current) clearInterval(syncTimerRef.current);
        if (rematchTimer) clearInterval(rematchTimer);
      }
    };
  }, [battleState, setupSocketListeners, battleId, playerId, selectedLanguage, token, setConnectionStatus, rematchTimerRef]);

  // Cleanup on component unmount (regardless of battle state)
  useEffect(() => {
    // Capture refs for cleanup
    const rematchTimer = rematchTimerRef.current;
    const countdownInterval = countdownIntervalRef.current;
    const loadingInterval = loadingIntervalRef.current;
    const pendingTimeouts = pendingTimeoutsRef.current;
    return () => {
      connectionCleanupRef.current?.();
      connectionCleanupRef.current = null;
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      if (timerRef.current) clearInterval(timerRef.current);
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
      if (rematchTimer) clearInterval(rematchTimer);
      if (countdownInterval) clearInterval(countdownInterval);
      if (loadingInterval) clearInterval(loadingInterval);
      // Clear any pending stray setTimeouts (e.g. the countdown-sync 8s
      // fallback and the 60s submission safety timeout) so they don't fire
      // setState on an unmounted component.
      if (pendingTimeouts) {
        pendingTimeouts.forEach(id => clearTimeout(id));
        pendingTimeouts.clear();
      }
    };
  }, [rematchTimerRef, countdownIntervalRef, loadingIntervalRef]);

  // Track battle abandonment (user leaves mid-battle)
  useEffect(() => {
    const isActiveBattle = ['in_battle', 'ready', 'waiting'].includes(battleState) && battle?.problem;

    const handleBeforeUnload = () => {
      if (isActiveBattle) {
        // Use sendBeacon for reliable tracking on page unload
        const abandonData = {
          battleId,
          problemId: battle?.problem?.id,
          difficulty: battle?.problem?.difficulty,
          language: selectedLanguage,
          timeElapsedSeconds: battle?.timeLimit ? battle.timeLimit - timeLeft : 0,
          timeRemainingSeconds: timeLeft,
          hadStartedCoding: code !== getStarterCode(battle?.problem?.id, selectedLanguage),
          opponentUsername: opponent?.username,
          reason: 'close_tab'
        };
        // Track via beacon (won't block page close)
        navigator.sendBeacon?.('/api/analytics/abandon', JSON.stringify(abandonData));
      }
    };

    const handleRouteChange = () => {
      if (isActiveBattle) {
        trackBattleAbandon({
          battleId,
          problemId: battle?.problem?.id,
          difficulty: battle?.problem?.difficulty,
          language: selectedLanguage,
          timeElapsedSeconds: battle?.timeLimit ? battle.timeLimit - timeLeft : 0,
          timeRemainingSeconds: timeLeft,
          hadStartedCoding: code !== getStarterCode(battle?.problem?.id, selectedLanguage),
          opponentUsername: opponent?.username,
          reason: 'navigation'
        }, user);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    router.events?.on('routeChangeStart', handleRouteChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      router.events?.off('routeChangeStart', handleRouteChange);
    };
  }, [battleState, battle, battleId, selectedLanguage, timeLeft, code, opponent, user, router.events]);

  // Social sharing for battle victories
  const shareVictory = async (platform = 'twitter') => {
    const problemName = battle?.problem?.title || 'a coding challenge';
    const timeText = formatTime(solveTime || 0);
    const percentileText = performanceData?.percentile ? ` (${performanceData.percentile}th percentile)` : '';
    const ratingText = performanceData?.rating?.trim() || '';
    const complexityText = performanceData?.userComplexity ? ` [${performanceData.userComplexity}]` : '';

    const shareText = `I just won a coding battle on CodeArena!\n\nSolved "${problemName}" in ${timeText}${ratingText ? ` - ${ratingText}` : ''}${complexityText}${percentileText}\n\nThink you can beat me? Challenge me!\n\n#CodeArena #CodingBattle #Developer`;

    const shareUrl = config.frontend_url;

    if (platform === 'twitter') {
      const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
      window.open(twitterUrl, '_blank', 'width=600,height=400,noopener,noreferrer');
    } else if (platform === 'copy') {
      const textToCopy = `${shareText}\n\n${shareUrl}`;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(textToCopy);
        } else {
          // Fallback for non-HTTPS or older browsers
          const textArea = document.createElement('textarea');
          textArea.value = textToCopy;
          textArea.style.position = 'fixed';
          textArea.style.left = '-9999px';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
        }
        return true;
      } catch (err) {
        console.error('Failed to copy:', err);
        return false;
      }
    }
  };

  const createBattle = async () => {
    if (!user?.username) {
      setError('Please log in to create a battle');
      return;
    }

    // Use username from account
    const nameToUse = user.username;
    setPlayerName(nameToUse);

    setBattleState('creating');
    setError('');
    try {
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetchWithTimeout(`${config.backend_url}/api/battle/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ playerName: nameToUse, timeLimit: selectedTimeLimit, ranked: isRanked }),
        credentials: 'include'
      }, 20000);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create battle: ${response.status} ${errorText}`);
      }
      
      const data = await response.json();
      
      setBattleId(data.battleId);
      setPlayerId(data.playerId);
      setBattleState('waiting');
    } catch (error) {
      setError('Failed to create battle: ' + error.message);
      setBattleState('menu');
    }
  };

   
  const _joinBattle = async () => {
    if (!joinBattleId.trim()) {
      setError('Please enter a Battle ID');
      return;
    }

    if (!user?.username) {
      setError('Please log in to join a battle');
      return;
    }

    // Use username from account
    const nameToUse = user.username;
    setPlayerName(nameToUse);

    setBattleState('joining');
    setError('');
    try {
      let battleIdToJoin = joinBattleId.trim();

      if (battleIdToJoin.includes('battle?join=')) {
        const match = battleIdToJoin.match(/battle\?join=([^&?#]+)/);
        battleIdToJoin = match ? match[1] : battleIdToJoin;
      } else if (battleIdToJoin.includes('/battle/')) {
        const parts = battleIdToJoin.split('/battle/');
        battleIdToJoin = parts[1] ? parts[1].split('?')[0].split('#')[0] : battleIdToJoin;
      } else if (battleIdToJoin.includes('?join=')) {
        const match = battleIdToJoin.match(/\?join=([^&?#]+)/);
        battleIdToJoin = match ? match[1] : battleIdToJoin;
      }

      battleIdToJoin = battleIdToJoin.split('?')[0].split('#')[0];

      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetchWithTimeout(`${config.backend_url}/api/battle/join/${battleIdToJoin}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ playerName: nameToUse }),
        credentials: 'include'
      }, 20000);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Failed to join battle: ${response.status}`);
      }
      
      const data = await response.json();
      
      setBattleId(data.battleId);
      setPlayerId(data.playerId);
      setBattleState('waiting');
      setJoinBattleId('');
      
    } catch (error) {
      setError('Failed to join battle: ' + error.message);
      setBattleState('menu');
    }
  };

  const markReady = () => {
    if (socketRef.current && socketRef.current.connected) {
      setReadyButtonState('pressed');

      setTimeout(() => {
        socketRef.current.emit('player-ready', { battleId, playerId, language: selectedLanguage });
        setReadyButtonState('confirmed');
        // State persists as 'confirmed' until battle starts or state is reset
      }, 200);
    } else {
      setError('Not connected to server');
    }
  };

  const startBattle = () => {
    if (socketRef.current && socketRef.current.connected) {
      setStartButtonState('pressed');
      // Reset the battleStartedRef flag since we're starting a new countdown
      battleStartedRef.current = false;

      setTimeout(() => {
        setStartButtonState('loading');

        // Request synchronized countdown from server - BOTH players will see the countdown
        socketRef.current.emit('request-countdown', { battleId, playerId });

        // Show loading briefly while waiting for server response
        setShowPreBattleScreen(true);
        setBattlePhase('loading');
        setPreloadProgress(0);

        let progress = 0;
        if (loadingIntervalRef.current) clearInterval(loadingIntervalRef.current);

        loadingIntervalRef.current = setInterval(() => {
          progress += Math.random() * 20 + 10;
          setPreloadProgress(Math.min(progress, 100));
          if (progress >= 100) {
            clearInterval(loadingIntervalRef.current);
            loadingIntervalRef.current = null;
          }
        }, 100);
      }, 300);
    } else {
      setError('Not connected to server');
    }
  };

  const submitSolution = () => {
    // Prevent double-click submissions
    if (isEvaluating) return;

    if (socketRef.current && socketRef.current.connected) {
      // Direct submission - no CYU interruption
      // Anti-cheat handled passively via keystroke/paste metrics sent with submission
      // Backend analyzes and flags suspicious submissions for review
      doActualSubmission();
    } else {
      setError('Not connected to server');
    }
  };

  // Keyboard shortcut: Cmd/Ctrl + Enter to submit solution
  useKeyboardShortcut('Enter', submitSolution, {
    meta: true,
    enabled: battleState === 'coding' && timeLeft > 0 && connectionStatus === 'connected' && !isEvaluating
  });

  const submitFeedback = async (feedbackData) => {
    try {
      const response = await fetchWithTimeout(`${config.backend_url}/api/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          battleId,
          playerId,
          playerName,
          rating: feedbackData.rating,
          suggestion: feedbackData.suggestion.trim(),
          email: feedbackData.email.trim(),
          winner: winner,
          problemId: battle?.problem?.id,
          timestamp: feedbackData.timestamp,
          standalone: feedbackData.standalone || false
        }),
        credentials: 'include'
      }, 15000);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to submit feedback' }));
        throw new Error(errorData.error || 'Failed to submit feedback');
      }

      await response.json(); // Consume response body
      setShowFeedback(false);
      setError('');
      
    } catch (error) {
      throw error;
    }
  };

  const [isGeneratingInvite, setIsGeneratingInvite] = useState(false);

  const shareInviteLink = async () => {
    if (!battleId || !token) {
      setBattleLinkToast({
        message: 'Unable to generate invite link',
        success: false
      });
      return;
    }

    setIsGeneratingInvite(true);

    try {
      // Generate a tracked invite link
      const response = await fetchWithTimeout(`${config.backend_url}/api/battle/${battleId}/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }, 10000);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate invite');
      }

      const { inviteUrl } = await response.json();

      // Try native Web Share API first (great for mobile)
      if (navigator.share) {
        try {
          await navigator.share({
            title: 'CodeArena Battle Invite',
            text: 'Challenge me to a live coding battle on CodeArena!',
            url: inviteUrl
          });
          setBattleLinkToast({
            message: 'Invite shared!',
            success: true
          });
          return;
        } catch (shareErr) {
          // User cancelled or share failed - fall back to clipboard
          if (shareErr.name === 'AbortError') {
            // User cancelled, don't show error
            return;
          }
          // Fall through to clipboard copy
        }
      }

      // Fallback: Copy to clipboard
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(inviteUrl);
        setBattleLinkToast({
          message: 'Invite link copied to clipboard!',
          success: true
        });
      } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = inviteUrl;
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
          setBattleLinkToast({
            message: 'Invite link copied to clipboard!',
            success: true
          });
        } catch (err) {
          setBattleLinkToast({
            message: 'Could not copy link. Please copy manually: ' + inviteUrl,
            success: false
          });
        }
        document.body.removeChild(textArea);
      }
    } catch (err) {
      setBattleLinkToast({
        message: err.message || 'Failed to generate invite link',
        success: false
      });
    } finally {
      setIsGeneratingInvite(false);
    }
  };

  const copyInviteLink = async () => {
    if (!battleId || !token) {
      setBattleLinkToast({
        message: 'Unable to generate invite link',
        success: false
      });
      return;
    }

    setIsGeneratingInvite(true);

    try {
      const response = await fetchWithTimeout(`${config.backend_url}/api/battle/${battleId}/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }, 10000);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate invite');
      }

      const { inviteUrl } = await response.json();

      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(inviteUrl);
        setBattleLinkToast({
          message: 'Invite link copied to clipboard!',
          success: true
        });
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = inviteUrl;
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
          setBattleLinkToast({
            message: 'Invite link copied to clipboard!',
            success: true
          });
        } catch (err) {
          setBattleLinkToast({
            message: 'Could not copy link. Please copy manually: ' + inviteUrl,
            success: false
          });
        }
        document.body.removeChild(textArea);
      }
    } catch (err) {
      setBattleLinkToast({
        message: err.message || 'Failed to generate invite link',
        success: false
      });
    } finally {
      setIsGeneratingInvite(false);
    }
  };

  useEffect(() => {
    if (socketRef.current && socketRef.current.connected && (battleState === 'waiting' || battleState === 'coding')) {
      socketRef.current.emit('language-update', { battleId, playerId, language: selectedLanguage });
    }
  }, [selectedLanguage, battleState, battleId, playerId]);

  // Helper to report violations to server
  const reportViolation = useCallback((violationType, details = null, severity = 'warning') => {
    if (config.allow_cheating) return; // Skip in dev mode
    if (!socketRef.current?.connected || !battleId || !playerId) return;

    socketRef.current.emit('report-violation', {
      battleId,
      playerId,
      violationType,
      details,
      severity
    });

    setViolationCount(prev => prev + 1);
    setIntegrityScore(prev => Math.max(0, prev - (severity === 'critical' ? 15 : severity === 'serious' ? 10 : 5)));
  }, [battleId, playerId, setViolationCount, setIntegrityScore]);

  // Direct submission - sends code + metrics for passive anti-cheat analysis
  const doActualSubmission = useCallback(() => {
    if (socketRef.current && socketRef.current.connected) {
      setIsEvaluating(true);

      const metrics = getMetrics();
      const keystrokeData = {
        keystrokes: metrics.keystrokes,
        pastes: metrics.pastes,
        activeTypingTime: Math.round(metrics.activeTypingTime / 1000),
        idleTime: Math.round(metrics.idleTime / 1000),
        linesAdded: metrics.linesAdded,
        linesDeleted: metrics.linesDeleted,
        revisionCount: metrics.revisionCount,
        codeLength: code.length,
        deviceFingerprint
      };

      socketRef.current.emit('submit-solution', {
        battleId,
        playerId,
        code,
        keystrokeData
      });

      // Safety timeout: if no response in 60s, reset evaluating state
      const submitSafetyId = setTimeout(() => {
        pendingTimeoutsRef.current.delete(submitSafetyId);
        setIsEvaluating(prev => {
          if (prev) setError('Submission timed out. Please try again.');
          return false;
        });
      }, 60000);
      pendingTimeoutsRef.current.add(submitSafetyId);
    }
  }, [battleId, playerId, code, getMetrics, setIsEvaluating, deviceFingerprint]);

  // When timer reaches 0 during coding, auto-submit so the user isn't stuck
  useEffect(() => {
    if (timeLeft > 0 || battleState !== 'coding') return;

    // Give the backend a few seconds to send battle-tie
    const fallbackTimer = setTimeout(() => {
      // If still in coding state after 5s, force transition to finished
      if (battleStateRef.current === 'coding') {
        setBattleState('finished');
        setIsTie(true);
        setWinner('tie');
        if (timerRef.current) clearInterval(timerRef.current);
        if (syncTimerRef.current) clearInterval(syncTimerRef.current);
      }
    }, 5000);

    return () => clearTimeout(fallbackTimer);
  }, [timeLeft, battleState, setBattleState, setIsTie, setWinner]);

  useEffect(() => {
    if (battleState !== 'coding') return;

    const handleFocus = () => {
      if (focusLostTime) {
        const timeAway = Date.now() - focusLostTime;
        const timeAwaySeconds = Math.floor(timeAway / 1000);

        setTotalTimeAway(prev => prev + timeAwaySeconds);
        setFocusLostTime(null);

        // Stricter thresholds for competitive play
        if (timeAwaySeconds >= 10 && timeAwaySeconds < 30) {
          setFocusWarnings(prev => [...prev, {
            id: Date.now(),
            message: `You were away for ${timeAwaySeconds} seconds. Stay focused!`,
            type: 'warning'
          }]);
          reportViolation('tab_switch', `Away for ${timeAwaySeconds}s`, 'warning');
        } else if (timeAwaySeconds >= 30 && timeAwaySeconds < 60) {
          setFocusWarnings(prev => [...prev, {
            id: Date.now(),
            message: `Away for ${timeAwaySeconds} seconds. This has been logged.`,
            type: 'serious'
          }]);
          reportViolation('tab_switch', `Away for ${timeAwaySeconds}s`, 'serious');
        } else if (timeAwaySeconds >= 60) {
          setFocusWarnings(prev => [...prev, {
            id: Date.now(),
            message: `Extended absence (${timeAwaySeconds}s). Your opponent has been notified.`,
            type: 'critical'
          }]);
          reportViolation('extended_absence', `Away for ${timeAwaySeconds}s`, 'critical');
        }
      }
    };

    const handleBlur = () => {
      setFocusLostTime(Date.now());
    };

    // Snap timer to real time when tab becomes visible again
    const handleVisibilityChange = () => {
      if (!document.hidden && battleServerStartRef.current && battleTimeLimitRef.current) {
        const elapsedSec = Math.max(0, (Date.now() - battleServerStartRef.current) / 1000);
        const remaining = Math.max(0, battleTimeLimitRef.current - elapsedSec);
        setTimeLeft(Math.round(remaining));
      }
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [battleState, focusLostTime, battleId, playerId, reportViolation, setFocusLostTime, setTotalTimeAway, setFocusWarnings, setTimeLeft]);

  useEffect(() => {
    if (focusWarnings.length > 0) {
      const timer = setTimeout(() => {
        setFocusWarnings(prev => prev.slice(1));
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [focusWarnings, setFocusWarnings]);

  useEffect(() => {
    if (copyWarning) {
      const timer = setTimeout(() => {
        setCopyWarning(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [copyWarning, setCopyWarning]);

  useEffect(() => {
    if (pasteWarning) {
      const timer = setTimeout(() => {
        setPasteWarning(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [pasteWarning, setPasteWarning]);

  useEffect(() => {
    if (battleLinkToast) {
      // "Opponent ready" message persists until match starts
      if (battleLinkToast.message?.includes('opponent')) {
        return; // Don't auto-dismiss
      }
      const timer = setTimeout(() => {
        setBattleLinkToast(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [battleLinkToast, setBattleLinkToast]);

  // Track content copied from within the code editor so internal copy-paste
  // (e.g. duplicating a variable name) is allowed without triggering anti-cheat.
  const internalClipboardRef = useRef(null);

  useEffect(() => {
    if (battleState !== 'coding') return;
    const handleCopy = (e) => {
      const problemArea = document.querySelector('.problem-description');
      const codeEditor = document.querySelector('.code-editor');

      // Block copying from the problem description (prevents sharing answers)
      if (problemArea && problemArea.contains(e.target)) {
        if (config.allow_cheating) {
          setCopyWarning({
            id: Date.now(),
            message: 'Cheating is allowed in development mode!',
            type: 'dev-mode-allowed'
          });
          return;
        }

        e.preventDefault();
        setCopyWarning({
          id: Date.now(),
          message: 'Copying the problem is disabled to ensure fair play',
          type: 'copy-blocked'
        });
        reportViolation('copy_attempt', 'Attempted to copy problem description', 'warning');
        return false;
      }

      // Allow copying within the code editor: track what was copied
      // so we can recognize internal pastes later
      if (codeEditor && codeEditor.contains(e.target)) {
        const selectedText = window.getSelection()?.toString() || '';
        if (selectedText) {
          internalClipboardRef.current = selectedText;
        }
      }
    };

    const handleSelectStart = (e) => {
      const problemArea = document.querySelector('.problem-description');
      if (problemArea && problemArea.contains(e.target)) {
        if (config.allow_cheating) {
          return;
        }

        e.preventDefault();
        return false;
      }
    };

    const handleContextMenu = (e) => {
      const problemArea = document.querySelector('.problem-description');

      if (problemArea && problemArea.contains(e.target)) {
        if (config.allow_cheating) {
          setCopyWarning({
            id: Date.now(),
            message: 'Cheating is allowed in development mode!',
            type: 'dev-mode-allowed'
          });
          return;
        }

        e.preventDefault();
        setCopyWarning({
          id: Date.now(),
          message: 'Right-click is disabled to ensure fair play',
          type: 'copy-blocked'
        });
        reportViolation('right_click', 'Attempted to use context menu', 'warning');
        return false;
      }
    };

    const handlePaste = (e) => {
      const problemArea = document.querySelector('.problem-description');
      const codeEditor = document.querySelector('.code-editor');

      if ((problemArea && problemArea.contains(e.target)) ||
          (codeEditor && codeEditor.contains(e.target))) {
        if (config.allow_cheating) {
          setPasteWarning({
            id: Date.now(),
            message: 'Cheating is allowed in development mode!',
            type: 'dev-mode-allowed'
          });
          return;
        }

        // Check if the pasted content matches what was copied from within the editor
        const pastedText = e.clipboardData?.getData('text') || '';
        if (internalClipboardRef.current && pastedText === internalClipboardRef.current) {
          // Internal copy-paste (e.g. duplicating a variable name): allow it
          return;
        }

        e.preventDefault();
        setPasteWarning({
          id: Date.now(),
          message: 'Pasting external content is disabled to ensure fair play',
          type: 'paste-blocked'
        });
        reportViolation('paste_attempt', 'Attempted to paste external code', 'serious');
        return false;
      }
    };

    document.addEventListener('copy', handleCopy, true);
    document.addEventListener('selectstart', handleSelectStart, true);
    document.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('paste', handlePaste, true);

    return () => {
      document.removeEventListener('copy', handleCopy, true);
      document.removeEventListener('selectstart', handleSelectStart, true);
      document.removeEventListener('contextmenu', handleContextMenu, true);
      document.removeEventListener('paste', handlePaste, true);
    };
  }, [battleState, reportViolation, setCopyWarning, setPasteWarning]);

  // DevTools Detection
  useEffect(() => {
    if (battleState !== 'coding' || config.allow_cheating) return;
    let devToolsCheckInterval;
    const threshold = 160;

    const checkDevTools = () => {
      const widthThreshold = window.outerWidth - window.innerWidth > threshold;
      const heightThreshold = window.outerHeight - window.innerHeight > threshold;

      if (widthThreshold || heightThreshold) {
        if (!devToolsOpen) {
          setDevToolsOpen(true);
          setFocusWarnings(prev => [...prev, {
            id: Date.now(),
            message: 'Developer tools detected! This is a serious violation.',
            type: 'critical'
          }]);
          reportViolation('devtools_open', 'DevTools window detected', 'critical');
        }
      } else {
        setDevToolsOpen(false);
      }
    };

    // Check periodically
    devToolsCheckInterval = setInterval(checkDevTools, 1000);

    // Also detect F12 and common DevTools shortcuts
    const handleKeyDown = (e) => {
      // F12
      if (e.key === 'F12') {
        e.preventDefault();
        setFocusWarnings(prev => [...prev, {
          id: Date.now(),
          message: 'Developer tools shortcut blocked',
          type: 'serious'
        }]);
        reportViolation('keyboard_shortcut', 'F12 pressed', 'serious');
        return false;
      }

      // Ctrl+Shift+I (Windows/Linux) or Cmd+Option+I (Mac) - DevTools
      // Note: On Mac, Option key = altKey, not shiftKey
      if ((e.ctrlKey && e.shiftKey && e.key === 'I') ||
          (e.metaKey && e.altKey && (e.key === 'I' || e.key === 'i'))) {
        e.preventDefault();
        reportViolation('keyboard_shortcut', 'DevTools shortcut', 'serious');
        return false;
      }

      // Ctrl+Shift+J (Windows/Linux) or Cmd+Option+J (Mac) - Console
      if ((e.ctrlKey && e.shiftKey && e.key === 'J') ||
          (e.metaKey && e.altKey && (e.key === 'J' || e.key === 'j'))) {
        e.preventDefault();
        reportViolation('keyboard_shortcut', 'Console shortcut', 'serious');
        return false;
      }

      // Ctrl+Shift+C (Windows/Linux) or Cmd+Option+C (Mac) - Inspect element
      if ((e.ctrlKey && e.shiftKey && e.key === 'C') ||
          (e.metaKey && e.altKey && (e.key === 'C' || e.key === 'c'))) {
        e.preventDefault();
        reportViolation('keyboard_shortcut', 'Inspect shortcut', 'serious');
        return false;
      }

      // Ctrl+U / Cmd+U (View source)
      if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
        e.preventDefault();
        reportViolation('keyboard_shortcut', 'View source', 'warning');
        return false;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      clearInterval(devToolsCheckInterval);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [battleState, devToolsOpen, reportViolation, setDevToolsOpen, setFocusWarnings]);

  // Auto-dismiss opponent violation notifications
  useEffect(() => {
    if (opponentViolation) {
      const timer = setTimeout(() => {
        setOpponentViolation(null);
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [opponentViolation, setOpponentViolation]);

  useEffect(() => {
    // Capture ref value for cleanup
    const rematchTimer = rematchTimerRef.current;
    return () => {
      if (rematchTimer) clearInterval(rematchTimer);
      if (timerRef.current) clearInterval(timerRef.current);
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
      if (isActivityTracking) {
        stopActivityTracking();
      }
    };
  }, [isActivityTracking, stopActivityTracking, rematchTimerRef]);

  // RENDER: Menu State
  if (battleState === 'menu') {
    return (
      <>
        <Head>
          <title>Private Battle - CodeArena</title>
        </Head>
      <div className="min-h-screen min-h-[100dvh] bg-surface-950 text-white overflow-hidden">

        <div className="h-screen h-[100dvh] flex flex-col">
          {/* Header */}
          <motion.header
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="px-4 sm:px-6 py-4 sm:py-6 flex-shrink-0"
          >
            <Link href="/modes" className="flex items-center space-x-2 hover:opacity-80 transition-opacity group">
              <ArrowLeft className="h-4 w-4 text-surface-500 group-hover:text-primary-400 transition-colors" />
              <Logo />
            </Link>
          </motion.header>

          <div className="flex-1 flex items-center justify-center px-4 sm:px-6 py-4 sm:py-8 overflow-y-auto overscroll-contain">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center max-w-md w-full my-auto"
            >
              <div className="mb-6 sm:mb-8">
                <h1 className="text-3xl sm:text-4xl font-bold mb-3 sm:mb-4 text-white">Private Battle</h1>
                <p className="text-surface-400 mb-6 sm:mb-8 text-sm sm:text-base">Challenge a friend to a 1v1 coding duel</p>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-danger/10 border border-danger/30 rounded-lg p-3 mb-4"
                >
                  <p className="text-danger-light text-sm">{error}</p>
                </motion.div>
              )}

              {/* Show username from account */}
              <Card variant="glass" className="p-4 mb-4">
                <p className="text-sm text-surface-400">Playing as</p>
                <p className="text-lg font-semibold text-primary-400">{user?.username || 'Loading...'}</p>
              </Card>

              {/* Time Limit Selection */}
              <Card variant="glass" className="p-4 mb-6">
                <p className="text-sm text-surface-400 mb-3">Time Limit</p>
                <div className="flex items-center justify-center space-x-3">
                  {[
                    { value: 600, label: '10 min' },
                    { value: 1800, label: '30 min' },
                    { value: 3600, label: '60 min' },
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => setSelectedTimeLimit(value)}
                      className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                        selectedTimeLimit === value
                          ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/30'
                          : 'bg-surface-700/50 text-surface-300 hover:bg-surface-600/50 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Card>

              {/* Ranked/Unranked Toggle */}
              <Card variant="glass" className="p-4 mb-6">
                <p className="text-sm text-surface-400 mb-3">Match Type</p>
                <div className="flex items-center justify-center space-x-4">
                  <button
                    onClick={() => setIsRanked(true)}
                    className={`flex-1 py-3 px-4 rounded-lg border-2 transition-all ${
                      isRanked
                        ? 'border-primary-500 bg-primary-500/10 text-white'
                        : 'border-surface-700 bg-surface-800/50 text-surface-400 hover:border-surface-600'
                    }`}
                  >
                    <span className="font-medium">Ranked</span>
                    <p className="text-xs mt-1 opacity-70">Affects your ELO rating</p>
                  </button>
                  <button
                    onClick={() => setIsRanked(false)}
                    className={`flex-1 py-3 px-4 rounded-lg border-2 transition-all ${
                      !isRanked
                        ? 'border-secondary-500 bg-secondary-500/10 text-white'
                        : 'border-surface-700 bg-surface-800/50 text-surface-400 hover:border-surface-600'
                    }`}
                  >
                    <span className="font-medium">Casual</span>
                    <p className="text-xs mt-1 opacity-70">No ELO changes</p>
                  </button>
                </div>
              </Card>

              {/* Create Battle Button - for shareable invite links */}
              <Button
                variant="primary"
                size="lg"
                onClick={createBattle}
                className="w-full mb-4"
                icon={Share2}
              >
                Create Battle & Share Link
              </Button>

              <div className="text-surface-500 text-sm mb-4">or invite a friend directly</div>

              {/* Player Invite Panel */}
              <PlayerInvitePanel ranked={isRanked} />

              <div className="mt-6">
                <Link href="/modes" className="text-surface-400 hover:text-white transition-colors flex items-center justify-center space-x-2">
                  <Home className="h-4 w-4" />
                  <span>Back to Modes</span>
                </Link>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
      </>
    );
  }

  // RENDER: Creating/Joining State
  if (battleState === 'creating' || battleState === 'joining') {
    return (
      <>
        <Head>
          <title>Joining Battle - CodeArena</title>
        </Head>
      <div className="min-h-screen bg-surface-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-surface-600 border-t-primary-400 mx-auto mb-4"></div>
          <p className="text-lg text-surface-200">{battleState === 'creating' ? 'Creating battle...' : 'Joining battle...'}</p>
          {error && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 mt-4 max-w-md">
              <p className="text-danger-light text-sm">{error}</p>
            </div>
          )}
        </div>
      </div>
      </>
    );
  }

  // RENDER: Waiting State
  if (battleState === 'waiting') {
    return (
      <>
        <Head>
          <title>Waiting Room - CodeArena</title>
        </Head>
      <div className="min-h-screen bg-surface-950 text-white flex items-center justify-center">
        {battleLinkToast && (
          <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50">
            <div className={`rounded-lg p-4 max-w-md ${
              battleLinkToast.success
                ? 'bg-success/10 border-success/30 border'
                : 'bg-danger/10 border-danger/30 border'
            }`}>
              <div className={`flex items-center space-x-2 ${
                battleLinkToast.success ? 'text-success-light' : 'text-danger-light'
              }`}>
                <div className="text-sm font-medium">{battleLinkToast.message}</div>
              </div>
            </div>
          </div>
        )}
        <div className="text-center max-w-lg px-4">
          <h1 className="text-2xl font-semibold mb-4 text-white">
            {opponent ? 'Opponent Found' : 'Waiting for Opponent'}
          </h1>
          <p className="text-surface-300 mb-8">
            {opponent ? 'Choose your language and get ready to battle!' : 'Waiting for your opponent to join...'}
          </p>

          {error && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 mb-6">
              <p className="text-danger-light text-sm">{error}</p>
            </div>
          )}

          {opponent && (
            <Card variant="glass" className="p-6 mb-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <h3 className="font-semibold mb-2">You</h3>
                  <p className="text-primary-400">{playerName}</p>
                  <p className="text-sm text-surface-400">{languages[selectedLanguage]?.name || selectedLanguage}</p>
                </div>
                <div className="text-center">
                  <h3 className="font-semibold mb-2">Opponent</h3>
                  <p className="text-secondary-400">{opponent?.name || 'Unknown'}</p>
                  <p className="text-sm text-surface-400">{opponent?.language ? languages[opponent.language]?.name : 'Selecting...'}</p>
                  {opponent?.ready && (
                    <div className="flex items-center justify-center gap-1 mt-2">
                      <CheckCircle className="h-4 w-4 text-success" />
                      <span className="text-xs text-success">Ready!</span>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )}

          {opponent && !skipLanguageSelection && (
            <Card variant="glass" className="p-4 mb-6">
              <h3 className="font-semibold mb-3">Choose Your Language:</h3>
              <select
                value={selectedLanguage}
                onChange={(e) => {
                  trackLanguageSelect({
                    language: e.target.value,
                    previousLanguage: selectedLanguage,
                    context: 'battle',
                    problemId: battle?.problem?.id
                  }, user);
                  setSelectedLanguage(e.target.value);
                }}
                className="w-full bg-surface-700 text-white text-sm rounded-lg px-4 py-2.5 border border-surface-600 focus:outline-none focus:border-primary-500 cursor-pointer"
              >
                {Object.entries(languages).map(([key, lang]) => (
                  <option key={key} value={key}>{lang.icon} {lang.name}</option>
                ))}
              </select>
            </Card>
          )}

          <div className="text-sm text-surface-400 mb-6">
            Connection: <span className={
              connectionStatus === 'connected' ? 'text-success' :
              connectionStatus === 'connecting' ? 'text-warning' : 'text-danger'
            }>
              {connectionStatus}
            </span>
          </div>

          <div className="flex gap-4 justify-center">
            {opponent ? (
              <Button
                variant="success"
                size="lg"
                onClick={markReady}
                disabled={connectionStatus !== 'connected' || readyButtonState !== 'idle'}
              >
                <div className="relative flex items-center justify-center space-x-2">
                  {readyButtonState === 'idle' && (
                    <>
                      <span>Ready</span>
                    </>
                  )}
                  {readyButtonState === 'pressed' && (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Processing...</span>
                    </>
                  )}
                  {readyButtonState === 'confirmed' && (
                    <>
                      <CheckCircle className="h-5 w-5 animate-bounce" />
                      <span>Ready Confirmed!</span>
                    </>
                  )}
                </div>
              </Button>
            ) : (
              <div className="flex gap-3">
                <Button
                  variant="primary"
                  onClick={shareInviteLink}
                  disabled={isGeneratingInvite}
                  icon={isGeneratingInvite ? null : Share2}
                >
                  {isGeneratingInvite ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Generating...</span>
                    </div>
                  ) : (
                    'Share Invite Link'
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={copyInviteLink}
                  disabled={isGeneratingInvite}
                  icon={Copy}
                >
                  Copy Link
                </Button>
                <Button
                  variant="ghost"
                  onClick={exitBattle}
                >
                  Cancel
                </Button>
              </div>
            )}

            {opponent && (
              <Button
                variant="danger"
                onClick={exitBattle}
                icon={LogOut}
              >
                Exit
              </Button>
            )}
          </div>
        </div>
      </div>
      </>
    );
  }

  // RENDER: Ready State
  if (battleState === 'ready') {
    if (showPreBattleScreen) {
      return (
        <>
        <Head>
          <title>Battle Starting... - CodeArena</title>
        </Head>
        <div className="min-h-screen bg-surface-950 text-white flex items-center justify-center">
          <div className="text-center max-w-lg">
            {battlePhase === 'loading' && (
              <>
                <div className="mb-8">
                  <div className="w-12 h-12 border-2 border-surface-600 border-t-primary-400 rounded-full animate-spin mx-auto"></div>
                </div>

                <h1 className="text-2xl font-semibold mb-3 text-white">Preparing battle</h1>
                <p className="text-surface-400 mb-8">Setting up your environment...</p>

                <div className="w-64 mx-auto mb-6">
                  <div className="h-1 bg-surface-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 rounded-full transition-all duration-300"
                      style={{ width: `${preloadProgress}%` }}
                    ></div>
                  </div>
                </div>
              </>
            )}

            {battlePhase === 'countdown' && (
              <>
                <motion.div
                  key={countdownNumber}
                  initial={{ scale: 1.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  className="mb-8"
                >
                  <span className="text-8xl font-black text-white tabular-nums">
                    {countdownNumber}
                  </span>
                </motion.div>

                <p className="text-surface-400 text-lg">
                  Starting in {countdownNumber}...
                </p>
              </>
            )}

            {battlePhase === 'ready' && (
              <>
                <CheckCircle className="h-12 w-12 text-success mx-auto mb-4" />
                <h1 className="text-2xl font-semibold mb-4 text-white">Ready</h1>
              </>
            )}
          </div>
        </div>
        </>
      );
    }

    return (
      <>
        <Head>
          <title>Get Ready - CodeArena</title>
        </Head>
      <div className="min-h-screen bg-surface-950 text-white flex items-center justify-center">
        <div className="text-center max-w-lg px-4">
          <h1 className="text-2xl font-semibold mb-4 text-white">Ready to Start</h1>
          <p className="text-surface-300 mb-8">Both players are ready. Click start when you're ready to begin!</p>

          {error && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 mb-6">
              <p className="text-danger-light text-sm">{error}</p>
            </div>
          )}

          <Card variant="glass" className="p-6 mb-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <h3 className="font-semibold mb-2">You</h3>
                <p className="text-primary-400">{playerName}</p>
                <p className="text-sm text-surface-400">{languages[selectedLanguage]?.name || selectedLanguage}</p>
                <div className="mt-2 flex items-center justify-center space-x-2">
                  <CheckCircle className="h-5 w-5 text-success" />
                  <span className="text-success font-semibold">Ready!</span>
                </div>
              </div>
              <div className="text-center">
                <h3 className="font-semibold mb-2">Opponent</h3>
                <p className="text-secondary-400">{opponent?.name || 'Unknown'}</p>
                <p className="text-sm text-surface-400">{opponent?.language ? languages[opponent.language]?.name : 'Not selected'}</p>
                <div className="mt-2 flex items-center justify-center space-x-2">
                  {opponent?.ready ? (
                    <>
                      <CheckCircle className="h-5 w-5 text-success" />
                      <span className="text-success font-semibold">Ready!</span>
                    </>
                  ) : (
                    <>
                      <div className="h-5 w-5 border-2 border-warning border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-warning">Getting ready...</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {canStartBattle && allPlayersReady ? (
            <div className="bg-success/20 border border-success rounded-lg p-6 mb-6">
              <div className="flex items-center justify-center space-x-2 text-success mb-4">
                <CheckCircle className="h-6 w-6" />
                <span className="font-semibold text-lg">Both players ready!</span>
              </div>
              
              <Button
                variant="success"
                size="lg"
                fullWidth
                onClick={startBattle}
                disabled={connectionStatus !== 'connected' || startButtonState !== 'idle'}
              >
                <div className="relative flex items-center justify-center space-x-3">
                  {startButtonState === 'idle' && (
                    <>
                      <Play className="h-6 w-6" />
                      <span>Start Battle!</span>
                    </>
                  )}
                  {startButtonState === 'pressed' && (
                    <>
                      <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Initiating...</span>
                    </>
                  )}
                  {startButtonState === 'loading' && (
                    <>
                      <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Preparing...</span>
                    </>
                  )}
                </div>
              </Button>
            </div>
          ) : (
            <div className="bg-warning/20 border border-warning rounded-lg p-4 mb-6">
              <div className="flex items-center justify-center space-x-2 text-warning">
                <div className="h-4 w-4 border-2 border-warning border-t-transparent rounded-full animate-spin"></div>
                <span className="font-semibold">Waiting for opponent to be ready...</span>
              </div>
            </div>
          )}

          <Button
            variant="danger"
            onClick={exitBattle}
            icon={LogOut}
            className="mx-auto"
          >
            Exit Battle
          </Button>
        </div>
      </div>
      </>
    );
  }

  // RENDER: Finished State
  if (battleState === 'finished') {
    const wasForfeit = testResults.length === 0 && !isTie && winner !== 'tie';

    return (
      <>
        <Head>
          <title>Battle Results - CodeArena</title>
        </Head>
      <div className="min-h-screen bg-surface-950 text-white">

        {/* Sticky nav bar */}
        <nav className="sticky top-0 z-50 bg-surface-900/80 backdrop-blur-md border-b border-surface-800 px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center space-x-2">
            <Logo />
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={goToPracticeMode}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-surface-300 hover:text-white border border-surface-700 hover:border-surface-500 rounded-lg transition-all font-medium"
            >
              <Target className="h-4 w-4" />
              <span className="hidden sm:inline">Practice This</span>
            </button>
            <button
              onClick={() => router.push('/players')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-surface-300 hover:text-white hover:bg-surface-800 rounded-lg transition-all"
            >
              <span className="hidden sm:inline">Leaderboard</span>
            </button>
            <button
              onClick={isFromMatchmaking ? returnToMatchmaking : returnToModes}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-500 hover:bg-primary-400 text-white rounded-lg transition-all font-medium"
            >
              <Play className="h-4 w-4 fill-current" />
              <span>Play Again</span>
            </button>
          </div>
        </nav>

        <div className="text-center max-w-2xl px-4 mx-auto py-6">
          {/* Result header */}
          <h1 className={`text-3xl font-bold mb-3 ${
              isTie || winner === 'tie' ? 'text-surface-400' :
              winner === 'you' ? 'text-success' : 'text-danger'
            }`}>
              {isTie || winner === 'tie' ? 'Time Expired' :
               wasForfeit && winner === 'you' ? 'Victory (Forfeit)' :
               isPartialCredit && winner === 'you' ? 'Partial Win' :
               isPartialCredit && winner === 'opponent' ? 'Close Battle' :
               winner === 'you' ? 'Victory' : 'Defeat'}
            </h1>

          {/* Practice Match Indicator for Bot Battles */}
          {isAgainstBot && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-blue-900/30 border border-blue-500/30 rounded-lg p-3 mb-3"
            >
              <div className="flex items-center justify-center gap-2 text-blue-400">
                <Bot className="h-5 w-5" />
                <span className="font-medium">Practice Match vs Bot</span>
              </div>
              <p className="text-surface-400 text-sm mt-1">No rating changes applied</p>
            </motion.div>
          )}

          {/* Rating Change Display */}
          {ratingChanges && !isAgainstBot && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="flex items-center justify-center gap-2 mb-3"
            >
              {(() => {
                const isWin = winner === 'you';
                const isTieResult = winner === 'tie';
                // Handle different ratingChanges formats:
                // battle-finished: { winner: {change, newRating}, loser: {change, newRating} }
                // battle-tie: { player1: {change}, player2: {change} }
                // battle-partial-credit: { winner: {change}, loser: {change} }
                let change, newRating, newRank;
                if (isTieResult) {
                  // For ties, try player1/player2 format (server doesn't know which is which from client perspective)
                  change = ratingChanges.player1?.change ?? ratingChanges.player2?.change ?? 0;
                  newRating = ratingChanges.player1?.newRating ?? ratingChanges.player2?.newRating ?? null;
                  newRank = ratingChanges.player1?.newRank ?? ratingChanges.player2?.newRank ?? null;
                } else {
                  change = isWin ? ratingChanges.winner?.change : ratingChanges.loser?.change;
                  newRating = isWin ? ratingChanges.winner?.newRating : ratingChanges.loser?.newRating;
                  newRank = isWin ? ratingChanges.winner?.newRank : ratingChanges.loser?.newRank;
                }
                if (change == null) return null;
                return (
                  <div className={`px-4 py-2 rounded-lg border ${
                    change > 0
                      ? 'bg-success/10 border-success/30 text-success'
                      : change < 0
                        ? 'bg-danger/10 border-danger/30 text-danger'
                        : 'bg-surface-800/50 border-surface-700 text-surface-400'
                  }`}>
                    <span className="font-bold text-lg">{change > 0 ? '+' : ''}{change}</span>
                    <span className="text-sm ml-1">rating</span>
                    {newRating && <span className="text-sm ml-2 opacity-75">({newRating}{newRank ? ` ${newRank}` : ''})</span>}
                  </div>
                );
              })()}
            </motion.div>
          )}

          {/* Share Victory Buttons - Only show for winners */}
          {winner === 'you' && !isTie && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex items-center justify-center gap-3 mb-3"
            >
              <button
                onClick={() => shareVictory('twitter')}
                className="flex items-center space-x-2 bg-[#1DA1F2] hover:bg-[#1a8cd8] text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                <Twitter className="h-4 w-4" />
                <span>Share on X</span>
              </button>
              <button
                onClick={async (e) => {
                  const btn = e.currentTarget;
                  const spanEl = btn.querySelector('span');
                  const success = await shareVictory('copy');
                  if (spanEl) {
                    spanEl.textContent = success ? 'Copied!' : 'Failed';
                    setTimeout(() => {
                      if (spanEl) spanEl.textContent = 'Copy';
                    }, 2000);
                  }
                }}
                className="flex items-center space-x-2 bg-surface-700 hover:bg-surface-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                <Copy className="h-4 w-4" />
                <span>Copy</span>
              </button>
            </motion.div>
          )}

          {wasForfeit && winner === 'you' && (
            <div className="bg-surface-800 border border-surface-700 rounded-xl p-3 mb-3">
              <div className="flex items-center justify-center space-x-2 text-orange-300 mb-3">
                <LogOut className="h-6 w-6" />
                <h3 className="text-xl font-bold">Opponent Forfeited</h3>
              </div>
              <p className="text-surface-300 text-sm">
                {loserName} left the battle early. You win by default!
              </p>
            </div>
          )}

          {/* Partial Credit Result Explanation */}
          {isPartialCredit && partialCreditData && (
            <PartialCreditResult winner={winner} partialCreditData={partialCreditData} />
          )}

          {!isTie && !wasForfeit && !isPartialCredit && performanceData && (
            <div className={`${
              winner === 'you'
                ? 'bg-success/5 border-success/30'
                : 'bg-surface-800 border-surface-700'
            } border rounded-xl p-3 mb-3`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${winner === 'you' ? 'text-success' : 'text-surface-300'}`}>
                    {winner === 'you' ? 'Performance' : 'Battle Analysis'}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className={`font-bold ${winner === 'you' ? 'text-primary-400' : 'text-orange-300'}`}>
                    {formatTime(solveTime || 0)}
                  </span>
                  {winner === 'you' && performanceData.rating && (
                    <>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${performanceData.color} bg-surface-700`}>
                        {performanceData.rating}
                      </span>
                      {performanceData.userComplexity && (
                        <span className="text-surface-300 text-xs font-mono">{performanceData.userComplexity}</span>
                      )}
                      <span className="text-surface-400 text-xs">{performanceData.percentile}th %ile</span>
                    </>
                  )}
                  {winner !== 'you' && (
                    <span className="text-surface-400 text-xs">{winnerName} solved it faster</span>
                  )}
                </div>
              </div>
              {winner === 'you' && performanceData.percentile && (
                <div className="relative h-1 bg-surface-700 rounded-full overflow-hidden mt-2">
                  <div
                    className={`h-full transition-all duration-1000 ${
                      performanceData.percentile >= 75 ? 'bg-success' :
                      performanceData.percentile >= 50 ? 'bg-warning' :
                      'bg-orange-500'
                    }`}
                    style={{ width: `${performanceData.percentile}%` }}
                  />
                </div>
              )}
              {winner === 'you' && performanceData.userComplexity && performanceData.optimalComplexity && (
                <div className="mt-2 text-xs text-surface-300">
                  <span>Your solution: <span className="font-mono font-medium text-white">{performanceData.userComplexity}</span></span>
                  <span className="mx-2 text-surface-500">|</span>
                  <span>Optimal: <span className="font-mono font-medium text-accent-400">{performanceData.optimalComplexity}</span></span>
                </div>
              )}
            </div>
          )}
          
          {/* Test Results Summary */}
          {testResults.length > 0 && (
            <div className="bg-surface-800 border border-surface-700 rounded-xl p-3 mb-3 text-left">
              <h3 className="font-semibold mb-2 flex items-center justify-center text-sm">
                {testResults.every(r => r.passed) && (!hiddenTestResults || hiddenTestResults.passed === hiddenTestResults.total) ? (
                  <CheckCircle className="h-5 w-5 text-success mr-2" />
                ) : (
                  <XCircle className="h-5 w-5 text-danger-light mr-2" />
                )}
                Test Results - {testResults.filter(r => r.passed).length + (hiddenTestResults?.passed || 0)}/{testResults.length + (hiddenTestResults?.total || 0)} Passed
              </h3>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {testResults.map((result, idx) => (
                  <div key={idx} className={`p-2 rounded-lg border ${result.passed ? 'border-success/30 bg-success/10' : 'border-danger/30 bg-danger/10'}`}>
                    <div className="flex items-center space-x-2">
                      {result.passed ? (
                        <CheckCircle className="h-3.5 w-3.5 text-success flex-shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-danger-light flex-shrink-0" />
                      )}
                      <span className="text-xs font-medium">Test {idx + 1} {result.passed ? 'Passed' : 'Failed'}</span>
                    </div>
                    {!result.passed && (
                      <div className="text-xs text-surface-400 ml-6 space-y-0.5">
                        <div><strong>Input:</strong> {result.input}</div>
                        <div><strong>Expected:</strong> <span className="text-success">{result.expected}</span></div>
                        <div><strong>Actual:</strong> <span className="text-danger-light">{result.actual}</span></div>
                        {result.stdout && (
                          <div className="mt-1 p-1.5 bg-surface-900 rounded border border-surface-600">
                            <div className="text-surface-500 text-[10px] uppercase tracking-wide mb-0.5">Console Output</div>
                            <pre className="text-surface-300 whitespace-pre-wrap break-all text-[11px] max-h-40 overflow-y-auto">{result.stdout.length > 5000 ? result.stdout.slice(0, 5000) + '\n... (output truncated)' : result.stdout}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {hiddenTestResults && hiddenTestResults.total > 0 && (
                  <div className={`p-3 rounded-lg border ${
                    hiddenTestResults.passed === hiddenTestResults.total
                      ? 'border-success/30 bg-success/10'
                      : 'border-surface-600 bg-surface-800'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <EyeOff className="h-4 w-4 text-surface-400" />
                        <span className="text-sm font-medium text-surface-300">Hidden Tests</span>
                      </div>
                      <span className={`text-sm font-medium ${
                        hiddenTestResults.passed === hiddenTestResults.total ? 'text-success' : 'text-surface-400'
                      }`}>
                        {hiddenTestResults.passed}/{hiddenTestResults.total} passed
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Code Review */}
          {(finishedPlayerCode || finishedOpponentCode) && (
            <div className="bg-surface-800 border border-surface-700 rounded-xl p-3 mb-3 text-left">
              <h3 className="font-semibold mb-3 text-sm flex items-center justify-center">
                <Code className="h-4 w-4 mr-2 text-primary-400" />
                Code Review
              </h3>
              <div className="space-y-3">
                {finishedPlayerCode && (
                  <details className="group">
                    <summary className="cursor-pointer flex items-center justify-between text-sm text-surface-300 hover:text-white transition-colors">
                      <span>Your Code <span className="text-surface-500 text-xs ml-1">({finishedPlayerLanguage})</span></span>
                      <ChevronRight className="h-4 w-4 group-open:rotate-90 transition-transform" />
                    </summary>
                    <pre className="mt-2 p-3 bg-surface-900 border border-surface-700 rounded-lg text-xs font-mono text-surface-300 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre">{finishedPlayerCode}</pre>
                  </details>
                )}
                {finishedOpponentCode && (
                  <details className="group">
                    <summary className="cursor-pointer flex items-center justify-between text-sm text-surface-300 hover:text-white transition-colors">
                      <span>Opponent&apos;s Code <span className="text-surface-500 text-xs ml-1">({finishedOpponentLanguage})</span></span>
                      <ChevronRight className="h-4 w-4 group-open:rotate-90 transition-transform" />
                    </summary>
                    <pre className="mt-2 p-3 bg-surface-900 border border-surface-700 rounded-lg text-xs font-mono text-surface-300 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre">{finishedOpponentCode}</pre>
                  </details>
                )}
              </div>
            </div>
          )}

          {!isTie && winner !== 'tie' && (
            <div className="bg-surface-800 rounded-lg p-3 mb-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center">
                  <div className="flex items-center justify-center mb-1">
                    <User className="h-4 w-4 mr-1.5" />
                    <span className="text-sm">{winner === 'you' ? winnerName : loserName}</span>
                  </div>
                  <div className={`text-lg font-bold ${winner === 'you' ? 'text-success' : 'text-danger-light'}`}>
                    {winner === 'you' ? 'Winner' : 'Runner-up'}
                  </div>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center mb-1">
                    <User className="h-4 w-4 mr-1.5" />
                    <span className="text-sm">{winner === 'you' ? loserName : winnerName}</span>
                  </div>
                  <div className={`text-lg font-bold ${winner === 'opponent' ? 'text-success' : 'text-danger-light'}`}>
                    {winner === 'opponent' ? 'Winner' : 'Runner-up'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Fair Play Summary */}
          {battleViolations && (battleViolations.you?.count > 0 || battleViolations.opponent?.count > 0) && (
            <div className="bg-surface-800/50 border border-surface-700 rounded-lg p-3 mb-3">
              <div className="flex items-center justify-center space-x-2 mb-3">
                <h3 className="text-sm font-semibold text-surface-300">Fair Play Summary</h3>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className={`text-center p-3 rounded ${
                  battleViolations.you?.count > 0
                    ? 'bg-danger/10 border border-danger/30'
                    : 'bg-success/10 border border-success/30'
                }`}>
                  <div className="text-surface-400 mb-1">You</div>
                  {battleViolations.you?.count > 0 ? (
                    <div className="text-danger-light">
                      {battleViolations.you.count} violation{battleViolations.you.count !== 1 ? 's' : ''}
                    </div>
                  ) : (
                    <div className="text-success">Clean record</div>
                  )}
                </div>
                <div className={`text-center p-3 rounded ${
                  battleViolations.opponent?.count > 0
                    ? 'bg-danger/10 border border-danger/30'
                    : 'bg-success/10 border border-success/30'
                }`}>
                  <div className="text-surface-400 mb-1">Opponent</div>
                  {battleViolations.opponent?.count > 0 ? (
                    <div className="text-danger-light">
                      {battleViolations.opponent.count} violation{battleViolations.opponent.count !== 1 ? 's' : ''}
                    </div>
                  ) : (
                    <div className="text-success">Clean record</div>
                  )}
                </div>
              </div>
              {performanceData?.flaggedForReview && (
                <div className="mt-3 text-center text-xs text-warning bg-warning/10 border border-warning/30 rounded p-2">
                  This result has been flagged for review: {performanceData.anomalyReason}
                </div>
              )}
            </div>
          )}

          {(isTie || winner === 'tie') && (
            <div className="bg-surface-800 rounded-lg p-3 mb-3">
              <h3 className="text-base font-semibold mb-1">Time's Up!</h3>
              <p className="text-surface-300 text-sm">Neither player completed the challenge in time.</p>
            </div>
          )}
          
          {/* Rematch Section - For bot battles, show "New Bot Battle" instead */}
          <div className="bg-surface-800 rounded-lg p-3 mb-3">
            {isAgainstBot ? (
              <div className="text-center">
                <h3 className="text-sm font-semibold mb-2">Ready for another battle?</h3>
                <div className="flex flex-row gap-2 justify-center">
                  <button
                    onClick={() => router.push('/matchmaking')}
                    className="bg-primary-500 hover:bg-primary-400 px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center space-x-1.5 justify-center"
                  >
                    <span>Find Opponent</span>
                  </button>
                </div>
              </div>
            ) : rematchStatus === null && (
              <div className="text-center">
                <h3 className="text-sm font-semibold mb-2">Want another round?</h3>
                <button
                  onClick={requestRematch}
                  disabled={connectionStatus !== 'connected'}
                  className="bg-primary-500 hover:bg-primary-400 disabled:opacity-50 px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center space-x-1.5 mx-auto"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>Request Rematch</span>
                </button>
              </div>
            )}

            {!isAgainstBot && rematchStatus === 'requesting' && (
              <div className="text-center">
                <div className="flex items-center justify-center space-x-2 mb-3">
                  <div className="h-5 w-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-secondary-400 font-semibold">Rematch Requested</span>
                </div>
                <p className="text-surface-400 text-sm mb-3">
                  Waiting for {opponent?.name || 'opponent'} to respond...
                </p>
                <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
                  <Clock className="h-4 w-4" />
                  <span>Expires in {rematchTimeLeft}s</span>
                </div>
                <button
                  onClick={cancelRematch}
                  className="mt-3 text-danger-light hover:text-red-300 text-sm border border-danger/30 hover:border-red-500 px-3 py-1 rounded transition-colors"
                >
                  Cancel Request
                </button>
              </div>
            )}

            {!isAgainstBot && rematchStatus === 'pending' && rematchRequester && (
              <div className="text-center">
                <div className="flex items-center justify-center space-x-2 mb-3">
                  <RotateCcw className="h-5 w-5 text-yellow-400" />
                  <span className="text-yellow-400 font-semibold">Rematch Request</span>
                </div>
                <p className="text-surface-300 mb-4">
                  <span className="text-secondary-400 font-medium">{rematchRequester.name}</span> wants a rematch!
                </p>
                <div className="flex items-center justify-center space-x-2 text-sm text-gray-500 mb-4">
                  <Clock className="h-4 w-4" />
                  <span>Expires in {rematchTimeLeft}s</span>
                </div>
                <div className="flex space-x-3 justify-center">
                  <button
                    onClick={acceptRematch}
                    className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded-lg font-medium transition-colors"
                  >
                    Accept
                  </button>
                  <button
                    onClick={declineRematch}
                    className="bg-red-600 hover:bg-red-500 px-4 py-2 rounded-lg font-medium transition-colors"
                  >
                    Decline
                  </button>
                </div>
              </div>
            )}

            {!isAgainstBot && rematchStatus === 'accepted' && (
              <div className="text-center">
                <div className="flex items-center justify-center space-x-2 mb-3">
                  <CheckCircle className="h-5 w-5 text-success" />
                  <span className="text-success font-semibold">Rematch Accepted!</span>
                </div>
                <p className="text-surface-400 text-sm">Preparing new battle...</p>
              </div>
            )}

            {!isAgainstBot && rematchStatus === 'declined' && (
              <div className="text-center">
                <div className="flex items-center justify-center space-x-2 mb-3">
                  <XCircle className="h-5 w-5 text-danger-light" />
                  <span className="text-danger-light font-semibold">Rematch Declined</span>
                </div>
                <p className="text-surface-400 text-sm">{opponent?.name || 'Opponent'} declined the rematch</p>
              </div>
            )}

            {!isAgainstBot && rematchStatus === 'expired' && (
              <div className="text-center">
                <div className="flex items-center justify-center space-x-2 mb-3">
                  <Clock className="h-5 w-5 text-warning" />
                  <span className="text-warning font-semibold">Rematch Expired</span>
                </div>
                <p className="text-surface-400 text-sm">The rematch request timed out</p>
              </div>
            )}
          </div>

          {/* Add Friend Section - Hide for bot battles, requires opponent's database userId */}
          {!isAgainstBot && opponent?.userId && user?.id && String(opponent.userId) !== String(user.id) && (
            <div className="bg-surface-800 rounded-lg p-3 mb-3">
              <div className="text-center">
                {isFriend(opponent.userId) ? (
                  <div className="flex items-center justify-center space-x-2 text-success">
                    <CheckCircle className="h-5 w-5" />
                    <span className="font-medium">You're already friends with {opponent.name}</span>
                  </div>
                ) : hasPendingRequestTo(opponent.userId) || friendRequestSent ? (
                  <div className="flex items-center justify-center space-x-2 text-secondary-400">
                    <Clock className="h-5 w-5" />
                    <span className="font-medium">Friend request sent to {opponent.name}</span>
                  </div>
                ) : hasPendingRequestFrom(opponent.userId) ? (
                  <div className="flex items-center justify-center space-x-2 text-yellow-400">
                    <UserPlus className="h-5 w-5" />
                    <span className="font-medium">{opponent.name} has sent you a friend request!</span>
                  </div>
                ) : (
                  <>
                    <h3 className="text-sm font-semibold mb-2">Good game! Want to stay connected?</h3>
                    <button
                      onClick={() => {
                        const result = sendFriendRequest(opponent.userId);
                        if (result) {
                          setFriendRequestSent(true);
                          setFriendRequestError(null);
                        }
                      }}
                      disabled={connectionStatus !== 'connected'}
                      className="bg-primary-500 hover:bg-primary-400 disabled:opacity-50 px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center space-x-1.5 mx-auto"
                    >
                      <UserPlus className="h-4 w-4" />
                      <span>Add {opponent.name} as Friend</span>
                    </button>
                    {(friendRequestError || friendError) && (
                      <p className="text-danger-light text-sm mt-2">{friendRequestError || friendError}</p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

        </div>

        {showFeedback === true && (
          <EnhancedFeedbackForm
            onSubmit={submitFeedback}
            onClose={() => setShowFeedback(false)}
            battleContext={{
              battleId,
              playerId,
              playerName,
              winner: winner,
              problemId: battle?.problem?.id
            }}
            standalone={false}
          />
        )}

      </div>
      </>
    );
  }

  // RENDER: Coding State (Battle Interface)
  return (
    <>
      <Head>
         <title>Battle - CodeArena</title>
      </Head>
    <div className="h-screen bg-surface-900 text-white flex flex-col overflow-hidden">
      {/* Focus/Copy/Paste/DevTools Warnings */}
      {focusWarnings.length > 0 && (
        <div className="fixed top-4 right-4 z-50 space-y-2">
          {focusWarnings.map((warning) => (
            <div
              key={warning.id}
              className={`p-4 rounded-lg border max-w-sm ${warning.type === 'bonus' ? '' : 'animate-pulse'} ${
                warning.type === 'critical'
                  ? 'bg-red-900/90 border-red-500 text-red-100'
                  : warning.type === 'serious'
                  ? 'bg-danger/80 border-danger/30 text-danger-light'
                  : warning.type === 'bonus'
                  ? 'bg-green-900/90 border-green-500 text-green-100'
                  : 'bg-warning/80 border-warning text-warning'
              }`}
            >
              <div className="text-sm font-medium">{warning.message}</div>
            </div>
          ))}
        </div>
      )}

      {/* Opponent Violation Notification */}
      {opponentViolation && (
        <div className="fixed top-4 left-4 z-50 animate-bounce">
          <div className={`p-4 rounded-lg border max-w-sm ${
            opponentViolation.severity === 'critical'
              ? 'bg-orange-900/90 border-orange-500 text-orange-100'
              : 'bg-yellow-900/90 border-yellow-500 text-yellow-100'
          }`}>
            <div className="text-xs uppercase tracking-wide mb-1 opacity-75">Fair Play Alert</div>
            <div className="text-sm font-medium">{opponentViolation.message}</div>
          </div>
        </div>
      )}

      {/* Integrity Score (shown when low) */}
      {integrityScore < 80 && battleState === 'coding' && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className={`px-3 py-2 rounded-lg text-xs font-medium ${
            integrityScore < 50 ? 'bg-red-900/90 text-red-200' :
            integrityScore < 70 ? 'bg-orange-900/90 text-orange-200' :
            'bg-yellow-900/90 text-yellow-200'
          }`}>
            Integrity: {integrityScore}%
          </div>
        </div>
      )}

      {pasteWarning && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50">
          <div className="bg-primary-900/95 border-primary-500 border rounded-lg p-4 max-w-md">
            <div className="text-primary-200 text-sm font-medium">{pasteWarning.message}</div>
          </div>
        </div>
      )}

      {copyWarning && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50">
          <div className="bg-red-900/95 border-danger/30 border rounded-lg p-4 max-w-md">
            <div className="text-danger-light text-sm font-medium">{copyWarning.message}</div>
          </div>
        </div>
      )}

      {/* Header - Mobile responsive */}
      <div className="bg-surface-800 border-b border-surface-700 p-2 md:p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Logo - simplified on mobile */}
          <div className="flex items-center space-x-2 md:space-x-4">
            <div className="hidden md:block">
              <Logo size="md" />
              <div className="text-xs text-surface-500 font-medium tracking-wide uppercase">
                Live Battle
              </div>
            </div>
            <div className="md:hidden">
              <Logo size="sm" showText={false} />
            </div>
          </div>

          {/* Timer - always visible and prominent */}
          <div className={`px-3 py-1.5 md:px-4 md:py-2 rounded-lg border font-mono font-bold transition-colors ${
            timeLeft < 60
              ? 'bg-error/10 border-error/40 text-error'
              : timeLeft < 180
              ? 'bg-warning/10 border-warning/30 text-warning'
              : 'bg-surface-800 border-surface-600 text-surface-200'
          }`}>
            <span className="text-base md:text-lg tabular-nums">
              {formatTime(timeLeft)}
            </span>
          </div>

          {/* Player status - hidden on mobile */}
          <div className="hidden md:flex items-center space-x-4">
            <div className="text-center">
              <div className="text-xs text-surface-400">{playerName || user?.username || 'You'}</div>
              <div className="flex items-center">
                <div className={`w-2 h-2 rounded-full mr-2 ${
                  submitSuccess ? 'bg-primary-400' :
                  submitError ? 'bg-red-400' :
                  'bg-success animate-pulse'
                }`}></div>
                <span className="text-sm">
                  {submitSuccess ? 'Submitted' :
                   submitError ? 'Failed' : 'Coding'}
                </span>
              </div>
              {playerTestsTotal > 0 && (
                <div className={`text-xs font-medium ${
                  playerTestsPassed === playerTestsTotal ? 'text-green-400' :
                  playerTestsPassed > 0 ? 'text-yellow-400' : 'text-surface-400'
                }`}>
                  {playerTestsPassed}/{playerTestsTotal} tests passed
                </div>
              )}
            </div>
            <div className="text-center">
              <div className="text-xs text-surface-400 flex items-center justify-center gap-1">
                {opponent?.name}
                {isAgainstBot && (
                  <span className="inline-flex items-center gap-0.5 text-xs bg-blue-600/30 text-blue-400 px-1.5 py-0.5 rounded-full">
                    <Bot className="h-3 w-3" />
                    Bot
                  </span>
                )}
              </div>
              <div className="flex items-center">
                <div className={`w-2 h-2 rounded-full mr-2 ${
                  opponent?.submitted && opponent?.submissionPassed === false ? 'bg-red-400' :
                  opponent?.submitted ? 'bg-primary-400' :
                  opponent?.disconnected ? 'bg-danger' : 'bg-warning animate-pulse'
                }`}></div>
                <span className="text-sm">
                  {opponent?.submitted && opponent?.submissionPassed === false ? 'Failed' :
                   opponent?.submitted ? 'Submitted' :
                   opponent?.disconnected ? 'Disconnected' : 'Coding'}
                </span>
              </div>
              {(() => {
                const passed = opponent?.testsPassed || 0;
                const total = opponent?.testsTotal || battle?.problem?.testCases?.length || 0;
                return total > 0 && (
                  <div className={`text-xs font-medium ${
                    passed === total ? 'text-green-400' :
                    passed > 0 ? 'text-yellow-400' : 'text-surface-400'
                  }`}>
                    {passed}/{total} tests passed
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      <ResizablePanel
        className="flex-1"
        storageKey="battlePanelWidth"
        defaultLeftWidth={50}
        minLeftWidth={30}
        maxLeftWidth={70}
        leftPanel={
          <div className="h-full bg-surface-800 overflow-y-auto" style={{ userSelect: 'none' }}>
          <div className="p-6 pb-24 md:pb-6">
            {battle?.problem ? (
              <>
                <div className="flex items-center justify-between mb-4" style={{ userSelect: 'none' }}>
                  <h2 className="text-2xl font-bold">{battle.problem.title}</h2>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setShowReportProblem(true)}
                      className="p-1.5 text-surface-500 hover:text-yellow-400 hover:bg-yellow-500/10 rounded-lg transition-colors"
                      title="Report problem"
                    >
                      <Flag className="h-4 w-4" />
                    </button>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                      battle.problem.difficulty === 'Easy' ? 'bg-green-500/20 text-green-400' :
                      battle.problem.difficulty === 'Medium' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {battle.problem.difficulty}
                    </span>
                  </div>
                </div>

                <div className="prose prose-invert max-w-none problem-description" style={{ userSelect: 'none' }}>
                  <ProblemDescription description={battle.problem.description} />

                  <h3 className="text-lg font-semibold mb-3">Examples:</h3>
                  {(battle.problem.examples || []).map((example, idx) => (
                      <div key={idx} className="bg-surface-900 rounded-lg p-4 mb-4">
                        <div className="mb-2">
                          <strong>Input:</strong> <code className="text-primary-400 bg-surface-700 px-2 py-1 rounded text-sm">{example.input}</code>
                        </div>
                        <div className="mb-2">
                          <strong>Output:</strong> <code className="text-success bg-surface-700 px-2 py-1 rounded text-sm">{example.output}</code>
                        </div>
                        <div className="text-surface-400 text-sm">
                          <strong>Explanation:</strong> {example.explanation}
                        </div>
                      </div>
                  ))}

                  <h3 className="text-lg font-semibold mb-3">Constraints:</h3>
                  <ul className="text-surface-300 space-y-1">
                    {(battle.problem.constraints || []).map((constraint, idx) => (
                      <li key={idx} className="flex items-start">
                        <span className="text-primary-400 mr-2">•</span>
                        <span>{constraint}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <div className="text-center text-surface-400">Loading problem...</div>
            )}
          </div>
        </div>
        }
        rightPanel={
          <div className="h-full flex flex-col bg-surface-900 overflow-hidden">
              <div className="bg-surface-800 px-2 md:px-4 py-2 border-b border-surface-700 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1 md:space-x-2">
                    <div className="hidden md:flex items-center space-x-2">
                      <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                      <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    </div>
                    <span className="text-surface-400 text-xs md:text-sm md:ml-4">
                      solution{languages[selectedLanguage]?.extension || ''}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <select
                        value={selectedLanguage}
                        onChange={(e) => {
                          setSelectedLanguage(e.target.value);
                          try { localStorage.setItem('codearena-preferred-language', e.target.value); } catch (_) {}
                        }}
                        className="bg-surface-700 text-surface-300 text-xs rounded px-2 py-1 border border-surface-600 focus:outline-none focus:border-accent-500 cursor-pointer"
                      >
                        {Object.entries(languages).map(([key, lang]) => {
                          const disabled = lang.proOnly && !user?.is_pro;
                          return (
                            <option key={key} value={key} disabled={disabled}>
                              {lang.icon} {lang.name}{disabled ? ' (Pro)' : ''}
                            </option>
                          );
                        })}
                      </select>
                    <span className={`text-xs ${connectionStatus === 'connected' ? 'text-success' : 'text-danger-light'}`}>
                      {connectionStatus === 'connected' ? '●' : '○'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons - Top of editor area */}
              <div className="flex-shrink-0 px-4 py-3 bg-surface-800 border-b border-surface-700">
                <div className="flex items-center gap-3">
                  {/* Hero Submit Button */}
                  <SubmitButton
                    onClick={submitSolution}
                    disabled={timeLeft <= 0 || connectionStatus !== 'connected'}
                    loading={isEvaluating}
                    success={submitSuccess}
                    error={submitError}
                    label="Submit Solution"
                    loadingLabel="Testing..."
                    successLabel="Passed!"
                    errorLabel="Failed"
                    shortcut="Enter"
                    mode="battle"
                    size="lg"
                  />

                  {/* Vertical Divider */}
                  <div className="h-8 w-px bg-surface-600"></div>

                  {/* Timer Status Badge */}
                  <div className={`px-3 py-1.5 rounded-lg text-sm font-mono font-bold transition-colors ${
                    timeLeft <= 60
                      ? 'bg-error/10 text-error border border-error/30'
                      : timeLeft <= 180
                      ? 'bg-warning/10 text-warning border border-warning/30'
                      : 'bg-surface-800 text-surface-200 border border-surface-600'
                  }`}>
                    <span className="tabular-nums">{Math.floor(timeLeft / 60)}:{Math.floor(timeLeft % 60).toString().padStart(2, '0')}</span>
                  </div>

                  {/* Exit Button - Right side */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowForfeitModal(true)}
                    className="ml-auto border border-error/40 text-error-light hover:bg-error/10 hover:border-error/60"
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <LogOut className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">Exit</span>
                    </div>
                  </Button>
                </div>
              </div>

              <ResizablePanelVertical
                storageKey="battleOutputHeight2"
                defaultTopHeight={65}
                minTopHeight={30}
                maxTopHeight={90}
                className="min-h-0 p-3 pb-0"
                topPanel={
                  <div className="w-full h-full bg-surface-900 border border-surface-700 rounded-lg overflow-hidden relative">
                    <CodeEditor
                      value={code}
                      onChange={(newCode) => {
                        setCode(newCode);
                        trackActivity();
                        trackCodeChange(newCode);
                        if (socketRef.current && socketRef.current.connected) {
                          socketRef.current.emit('code-update', { battleId, playerId, code: newCode });
                        }
                      }}
                      onSubmit={() => {
                        if (!isEvaluating && code.trim() && timeLeft > 0 && connectionStatus === 'connected') {
                          submitSolution();
                        }
                      }}
                      language={selectedLanguage}
                      readOnly={isEvaluating}
                      height="100%"
                      vimMode={editorPrefs.vimMode}
                      onPaste={(pastedText) => {
                        if (config.allow_cheating) return;
                        // Allow internal copy-paste (e.g. variable names copied within the editor)
                        if (internalClipboardRef.current && pastedText === internalClipboardRef.current) {
                          return;
                        }
                        // External paste: flag it
                        setPasteWarning({
                          id: Date.now(),
                          message: 'Pasting external content is disabled to ensure fair play',
                          type: 'paste-blocked'
                        });
                        reportViolation('paste_attempt', 'Attempted to paste external code', 'serious');
                      }}
                    />
                  </div>
                }
                bottomPanel={
                  <div className="h-full bg-surface-800 rounded-lg border border-surface-600 overflow-y-auto mx-0 mt-1">
                    {isEvaluating ? (
                      <div className="flex items-center justify-center py-6">
                        <div className="text-center">
                          <div className="flex items-center justify-center space-x-3 mb-2">
                            <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
                            <span className="text-sm text-primary-400 font-medium">Running Tests...</span>
                          </div>
                        </div>
                      </div>
                    ) : testResults.length > 0 ? (
                      <div className="p-3">
                        <h3 className="text-sm font-semibold mb-2 flex items-center">
                          {testResults.every(r => r.passed) && (!hiddenTestResults || hiddenTestResults.passed === hiddenTestResults.total) ? (
                            <>
                              <CheckCircle className="h-4 w-4 text-success-light mr-2" />
                              <span className="text-success-light">All Tests Passed</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="h-4 w-4 text-danger-light mr-2" />
                              <span className="text-danger-light">
                                {testResults.filter(r => r.passed).length + (hiddenTestResults?.passed || 0)}/{testResults.length + (hiddenTestResults?.total || 0)} Tests Passed
                              </span>
                            </>
                          )}
                        </h3>

                        <div className="space-y-1.5">
                          {testResults.map((result, idx) => (
                            <div
                              key={idx}
                              className={`p-2 rounded-lg border ${
                                result.passed
                                  ? 'bg-success/10 border-success/30 text-success-light'
                                  : 'bg-danger/10 border-danger/30 text-danger-light'
                              }`}
                            >
                              <div className="flex items-center space-x-2 mb-1">
                                {result.passed ? (
                                  <CheckCircle className="h-3.5 w-3.5" />
                                ) : (
                                  <XCircle className="h-3.5 w-3.5" />
                                )}
                                <span className="text-xs font-medium">Test Case {idx + 1}</span>
                              </div>
                              <div className="text-xs text-surface-400 space-y-0.5">
                                <div>Input: {result.input}</div>
                                <div>Expected: <span className="text-success-light">{result.expected}</span></div>
                                <div>Got: <span className={result.passed ? 'text-success-light' : 'text-danger-light'}>{result.actual}</span></div>
                                {result.stdout && (
                                  <div className="mt-1 p-1.5 bg-surface-900 rounded border border-surface-600">
                                    <div className="text-surface-500 text-[10px] uppercase tracking-wide mb-0.5">Console Output</div>
                                    <pre className="text-surface-300 whitespace-pre-wrap break-all text-[11px] max-h-40 overflow-y-auto">{result.stdout.length > 5000 ? result.stdout.slice(0, 5000) + '\n... (output truncated)' : result.stdout}</pre>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}

                          {hiddenTestResults && hiddenTestResults.total > 0 && (
                            <div className={`p-2 rounded-lg border ${
                              hiddenTestResults.passed === hiddenTestResults.total
                                ? 'bg-success/10 border-success/30'
                                : 'bg-surface-800 border-surface-600'
                            }`}>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                  <EyeOff className="h-3.5 w-3.5 text-surface-400" />
                                  <span className="text-xs font-medium text-surface-300">Hidden Tests</span>
                                </div>
                                <span className={`text-xs font-medium ${
                                  hiddenTestResults.passed === hiddenTestResults.total
                                    ? 'text-success'
                                    : 'text-surface-400'
                                }`}>
                                  {hiddenTestResults.passed}/{hiddenTestResults.total} passed
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : error ? (
                      <div className="p-4">
                        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                          <p className="text-sm text-red-400">{error}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full text-surface-500 text-sm">
                        Output will appear here after submitting
                      </div>
                    )}
                  </div>
                }
              />
          </div>
        }
      />

      {/* Opponent Left Modal */}
      <AnimatePresence>
        {showOpponentLeftModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-surface-900 border border-surface-700 rounded-2xl max-w-md w-full p-6 shadow-2xl"
            >
              <div className="flex items-center space-x-3 mb-4">
                <div className="p-2 bg-warning/20 rounded-xl">
                  <Users className="h-6 w-6 text-warning" />
                </div>
                <h2 className="text-xl font-bold text-white">Opponent Left</h2>
              </div>
              <p className="text-surface-300 mb-6">
                Your opponent has left the battle. Would you like to return to matchmaking to find a new opponent?
              </p>
              <div className="flex space-x-3">
                <Button
                  variant="ghost"
                  fullWidth
                  onClick={() => {
                    setShowOpponentLeftModal(false);
                    returnToModes();
                  }}
                >
                  Back to Modes
                </Button>
                <Button
                  variant="primary"
                  fullWidth
                  onClick={() => {
                    setShowOpponentLeftModal(false);
                    returnToMatchmaking();
                  }}
                >
                  Find New Opponent
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Forfeit Battle Modal */}
      <AnimatePresence>
        {showForfeitModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowForfeitModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-surface-900 border border-surface-700 rounded-2xl max-w-md w-full p-6 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center space-x-3 mb-4">
                <div className="p-2 bg-danger/20 rounded-xl">
                  <LogOut className="h-6 w-6 text-danger" />
                </div>
                <h2 className="text-xl font-bold text-white">Exit Battle?</h2>
              </div>
              <p className="text-surface-300 mb-6">
                Are you sure you want to exit? This will count as a <span className="text-danger font-semibold">forfeit</span> and your opponent will win.
              </p>
              <div className="flex space-x-3">
                <Button
                  variant="ghost"
                  fullWidth
                  onClick={() => setShowForfeitModal(false)}
                >
                  Keep Fighting
                </Button>
                <Button
                  variant="danger"
                  fullWidth
                  onClick={() => {
                    setShowForfeitModal(false);
                    if (socketRef.current && socketRef.current.connected) {
                      socketRef.current.emit('forfeit-battle', { battleId, playerId });
                    } else {
                      exitBattle();
                    }
                  }}
                >
                  Forfeit & Exit
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ReportProblemModal
        isOpen={showReportProblem}
        onClose={() => setShowReportProblem(false)}
        problemId={battle?.problem?.id}
        problemTitle={battle?.problem?.title}
      />
    </div>
    </>
  );
}

// Wrap Battle with error boundary for crash protection
function BattleWithErrorBoundary(props) {
  return (
    <BattleErrorBoundary>
      <Battle {...props} />
    </BattleErrorBoundary>
  );
}

export default withAuth(BattleWithErrorBoundary);
