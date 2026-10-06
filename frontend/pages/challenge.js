// pages/challenge.js - Weekly Arena Challenge Page
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Logo from '../components/Logo';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock,
  Play,
  CheckCircle,
  XCircle,
  ChevronRight,
  Users,
  Calendar,
  Lightbulb,
  X,
  Code2,
  BookOpen,
  EyeOff,
  ArrowLeft,
  Loader2,
  Sparkles,
  Send,
  RotateCcw
} from 'lucide-react';
import { config } from '../config/env';
import { withAuth } from '../components/withAuth';
import { useAuth } from '../contexts/AuthContext';
import { ProblemDescription } from '../components/ProblemDescription';
import { trackViewChallenge, trackChallengeStart, trackChallengeSubmit, trackChallengeComplete, trackLanguageSelect } from '../utils/analytics';
import { fetchWithTimeout } from '../utils/fetch';
import { formatTimer as formatTime, formatWeekLabel } from '../utils/formatting';
import AvatarDisplay from '../components/ui/AvatarDisplay';
import { LANGUAGES, LAUNCH_LANGUAGE_IDS } from '../utils/languages';
import CodeEditor from '../components/CodeEditor';
import ResizablePanel from '../components/ResizablePanel';
import Button from '../components/ui/Button';
import SubmitButton from '../components/ui/SubmitButton';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { FadeIn } from '../components/ui/Motion';
import { useEditorPreferences } from '../hooks/useEditorPreferences';

// Countdown timer component (shows days, hours, minutes)
const CountdownTimer = ({ timeUntilNext }) => {
  const [timeLeft, setTimeLeft] = useState(timeUntilNext);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    setTimeLeft(timeUntilNext);
    const timer = setInterval(() => {
      if (isMountedRef.current) {
        setTimeLeft(prev => Math.max(0, prev - 1000));
      }
    }, 1000);
    return () => {
      isMountedRef.current = false;
      clearInterval(timer);
    };
  }, [timeUntilNext]);

  const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
  const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

  return (
    <div className="flex items-center space-x-1 text-surface-300">
      <span className="font-mono text-sm">
        {days > 0 && `${days}d `}{String(hours).padStart(2, '0')}h {String(minutes).padStart(2, '0')}m
      </span>
    </div>
  );
};

// Streak display component
const StreakDisplay = ({ current, best, completedThisWeek }) => (
  <div className="flex items-center space-x-4">
    <div>
      <div className="text-xl font-bold text-white">{current}</div>
      <div className="text-xs text-surface-400">week streak</div>
    </div>
    {best > 0 && (
      <div className="border-l border-surface-700 pl-4">
        <div className="text-lg font-bold text-surface-300">{best}</div>
        <div className="text-xs text-surface-500">best</div>
      </div>
    )}
    {completedThisWeek && (
      <Badge variant="success" className="ml-2">
        Completed
      </Badge>
    )}
  </div>
);

// Leaderboard entry component
const LeaderboardEntry = ({ entry, rank, isCurrentUser }) => {
  return (
    <div
      className={`flex items-center justify-between p-3 rounded-lg ${
        isCurrentUser
          ? 'bg-primary-500/10 border border-primary-500/20'
          : 'bg-surface-800/50 hover:bg-surface-700/50'
      } transition-colors`}
    >
      <div className="flex items-center space-x-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
          rank <= 3
            ? 'bg-surface-700 text-white'
            : 'bg-surface-700 text-surface-300'
        }`}>
          {rank}
        </div>
        <div className="flex items-center space-x-2">
          <AvatarDisplay user={entry} size="sm" />
          <div>
            <div className="font-medium text-white text-sm">{entry.username}</div>
            <div className="flex items-center space-x-2 text-xs text-surface-400">
              {entry.streak > 0 && (
                <span className="text-warning">{entry.streak} streak</span>
              )}
              {entry.totalCompletions > 0 && (
                <span className="text-primary-400">{entry.totalCompletions} solved</span>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="text-right">
        {entry.score != null ? (
          <>
            <div className="font-mono text-sm text-success-light">{entry.score}%</div>
            {entry.submitCount != null && (
              <div className="text-xs text-surface-500">{entry.submitCount} run{entry.submitCount !== 1 ? 's' : ''}</div>
            )}
          </>
        ) : (
          <>
            <div className="font-mono text-sm text-success-light">{formatTime(entry.solveTime)}</div>
            <div className="text-xs text-surface-500">{entry.language}</div>
          </>
        )}
      </div>
    </div>
  );
};

// Starter code is authored server-side and shipped with the problem
const getStarterCode = (problem, language) => problem?.starterCode?.[language] || '';

function ArenaChallenge() {
  const router = useRouter();
  const { user, token } = useAuth();
  const editorPrefs = useEditorPreferences();

  const [challenge, setChallenge] = useState(null);
  const [stats, setStats] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [timeUntilNext, setTimeUntilNext] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [attempt, setAttempt] = useState(null);
  const [streak, setStreak] = useState({ current: 0, best: 0, completedThisWeek: false });

  const [started, setStarted] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('codearena-preferred-language') || 'python';
    }
    return 'python';
  });
  const [availableLanguages, setAvailableLanguages] = useState(LAUNCH_LANGUAGE_IDS);
  const [code, setCode] = useState('');
  const [testResults, setTestResults] = useState([]);
  const [hiddenTestResults, setHiddenTestResults] = useState(null); // { passed: X, total: Y }
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [timeElapsed, setTimeElapsed] = useState(0);

  // Solution modal state
  const [showSolution, setShowSolution] = useState(false);
  const [solution, setSolution] = useState(null);
  const [loadingSolution, setLoadingSolution] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // Prompt challenge state
  const [challengeType, setChallengeType] = useState('prompt');
  const [promptText, setPromptText] = useState('');
  const [modelOutput, setModelOutput] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [finalScore, setFinalScore] = useState(null);
  const [finalModelOutput, setFinalModelOutput] = useState('');
  const [judgeRationale, setJudgeRationale] = useState(null);
  const [judgeCriteria, setJudgeCriteria] = useState(null);
  const [autoStartTried, setAutoStartTried] = useState(false);

  const timerRef = useRef(null);
  const startTimeRef = useRef(null);

  // LocalStorage key for code persistence
  const CODE_STORAGE_PREFIX = 'challenge-code-';

  // Use shared languages config
  const languages = LANGUAGES;

  // Languages this challenge's problem can run in
  useEffect(() => {
    const ids = challenge?.problem?.runnableLanguages;
    if (Array.isArray(ids) && ids.length > 0) setAvailableLanguages(ids);
  }, [challenge?.problem?.runnableLanguages]);

  const fetchChallenge = useCallback(async () => {
    try {
      setLoading(true);
      const headers = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const response = await fetchWithTimeout(`${config.backend_url}/api/challenge`, { headers }, 20000);
      const data = await response.json();

      if (data.success) {
        setChallenge(data.challenge);
        setStats(data.stats);
        setLeaderboard(data.leaderboard || []);
        setTimeUntilNext(data.timeUntilNext);
        if (data.challengeType) setChallengeType(data.challengeType);
      } else {
        setError(data.error || 'Failed to load challenge');
      }
    } catch (err) {
      console.error('Error fetching challenge:', err);
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Timer functions - defined before fetchAttempt which uses them
  const startTimer = useCallback((startTime = Date.now()) => {
    startTimeRef.current = startTime;
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setTimeElapsed(elapsed);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fetchAttempt = useCallback(async () => {
    if (!token) return;

    try {
      const response = await fetchWithTimeout(`${config.backend_url}/api/challenge/attempt`, {
        headers: { Authorization: `Bearer ${token}` }
      }, 15000);
      const data = await response.json();

      if (data.success) {
        setAttempt(data.attempt);
        setStreak({
          current: data.streak?.current || 0,
          best: data.streak?.best || 0,
          completedThisWeek: data.attempt?.completed || false
        });

        if (data.attempt?.started && !data.attempt?.completed) {
          setStarted(true);
          const startedAt = new Date(data.attempt.startedAt).getTime();
          const elapsed = Math.floor((Date.now() - startedAt) / 1000);
          setTimeElapsed(elapsed);
          startTimer(startedAt);
        }
      }
    } catch (err) {
      console.error('Error fetching attempt:', err);
    }
  }, [token, startTimer]);

  useEffect(() => {
    fetchChallenge();
  }, [fetchChallenge]);

  useEffect(() => {
    fetchAttempt();
  }, [fetchAttempt]);

  // Track challenge view when loaded
  useEffect(() => {
    if (challenge?.id && challenge?.problem) {
      trackViewChallenge({
        challengeId: challenge.id,
        problemId: challenge.problem.id,
        problemName: challenge.problem.title,
        difficulty: challenge.problem.difficulty
      }, user);
    }
  }, [challenge?.id, challenge?.problem, user]);

  useEffect(() => {
    // Update starter code when language changes or when challenge is first revealed
    if (challenge?.revealed && challenge?.problem?.id) {
      const p = challenge.problem;
      // Check for saved code in localStorage first
      const storageKey = `${CODE_STORAGE_PREFIX}${challenge.id}-${selectedLanguage}`;
      const savedCode = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null;

      if (savedCode) {
        setCode(savedCode);
      } else {
        setCode(getStarterCode(p, selectedLanguage));
      }
    }
    // Keyed on the problem id: the problem object is replaced on every challenge refresh,
    // and re-running would overwrite the player's code with the starter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLanguage, challenge?.revealed, challenge?.problem?.id, challenge?.id]);

  // Save code to localStorage when it changes (debounced)
  useEffect(() => {
    if (challenge?.id && code && typeof window !== 'undefined') {
      const storageKey = `${CODE_STORAGE_PREFIX}${challenge.id}-${selectedLanguage}`;
      const timeoutId = setTimeout(() => {
        try {
          localStorage.setItem(storageKey, code);
        } catch (e) {
          console.warn('Failed to save code to localStorage:', e);
        }
      }, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [challenge?.id, code, selectedLanguage]);

  // Auto-dismiss errors after 8 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(''), 8000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  const handleStart = useCallback(async ({ silent = false } = {}) => {
    if (!token) {
      if (!silent) router.push('/login');
      return false;
    }

    // Prevent double-click / re-entrant starts
    if (starting || started) return started;
    setStarting(true);
    if (!silent) setStartError('');

    try {
      const response = await fetchWithTimeout(`${config.backend_url}/api/challenge/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(challengeType === 'prompt' ? {} : { language: selectedLanguage })
      }, 20000);

      const data = await response.json();

      // Handle language restriction error
      if (response.status === 403 && data.languageRestricted) {
        setStartError(data.message || 'That language is not available for this challenge.');
        setStarting(false);
        return false;
      }

      if (data.success) {
        setStarted(true);
        setAttempt(data.attempt);

        // Update challenge with revealed problem details
        if (data.problem) {
          setChallenge(prev => ({
            ...prev,
            problem: data.problem,
            revealed: true
          }));

          if (challengeType !== 'prompt') {
            const p = data.problem;
            setCode(getStarterCode(p, selectedLanguage));
          }

          // Track challenge start
          trackChallengeStart({
            challengeId: challenge?.id,
            problemId: data.problem.id,
            problemName: data.problem.title,
            difficulty: data.problem.difficulty,
            language: challengeType === 'prompt' ? 'prompt' : selectedLanguage
          }, user);
        }

        startTimer();
        setStarting(false);
        return true;
      } else if (data.alreadyStarted) {
        // User already has an attempt: fetch it and transition to the editor
        await fetchAttempt();
        await fetchChallenge();
        setStarting(false);
        return true;
      } else {
        if (!silent) setStartError(data.error || 'Failed to start challenge');
        setStarting(false);
        return false;
      }
    } catch (err) {
      console.error('Error starting challenge:', err);
      if (!silent) setStartError(err.message || 'Failed to connect to server');
      setStarting(false);
      return false;
    }
  }, [token, starting, started, challengeType, selectedLanguage, challenge, user, fetchAttempt, fetchChallenge, startTimer, router]);

  // Auto-start prompt challenges on first load (no mystery box / reveal step).
  // The scenario IS the problem: gating it behind a button adds friction without payoff.
  useEffect(() => {
    if (autoStartTried) return;
    if (loading) return;
    if (!token || !user) return;
    if (challengeType !== 'prompt') return;
    if (!challenge?.problem) return;
    if (started) return;
    if (attempt?.completed) return;
    setAutoStartTried(true);
    handleStart({ silent: true });
  }, [autoStartTried, loading, token, user, challengeType, challenge?.problem, started, attempt?.completed, handleStart]);

  const handleExit = () => {
    if (started && !attempt?.completed) {
      // Show confirm modal before exiting mid-challenge
      setShowExitConfirm(true);
    } else {
      router.push('/modes');
    }
  };

  const confirmExit = () => {
    setShowExitConfirm(false);
    router.push('/modes');
  };

  // Free preview: unscored, unlimited. Lets the user iterate before their one shot.
  const handlePreview = async () => {
    if (!token || previewing || isSubmitting || !promptText.trim()) return;
    // Make sure the attempt row exists / timer is running before first preview.
    if (!started) {
      const ok = await handleStart({ silent: true });
      if (!ok) return;
    }
    setPreviewing(true);
    setError('');
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/api/challenge/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt: promptText, modelId: challenge?.problem?.modelId })
      }, 60000);
      const data = await res.json();
      if (data.success) {
        setModelOutput(data.modelOutput);
      } else {
        setError(data.error || 'Failed to run preview');
      }
    } catch (err) {
      setError(err.message || 'Failed to connect');
    } finally {
      setPreviewing(false);
    }
  };

  const handleSubmitPrompt = async () => {
    if (!token || isSubmitting || previewing || !promptText.trim()) return;
    if (!started) {
      const ok = await handleStart({ silent: true });
      if (!ok) return;
    }
    setIsSubmitting(true);
    setError('');
    const submitTimestamp = Date.now();
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/api/challenge/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          prompt: promptText,
          modelId: challenge?.problem?.modelId,
          submittedAt: submitTimestamp
        })
      }, 60000);
      const data = await res.json();
      if (data.success) {
        stopTimer();
        setFinalScore(data.attempt.score);
        setFinalModelOutput(data.modelOutput || '');
        setJudgeRationale(data.judgeRationale ?? null);
        setJudgeCriteria(Array.isArray(data.judgeCriteria) ? data.judgeCriteria : null);
        setAttempt(prev => ({ ...prev, completed: true, score: data.attempt.score }));
        setStreak({ current: data.streak?.current || 0, best: data.streak?.best || 0, completedThisWeek: true });
        fetchChallenge();
      } else {
        setError(data.error || 'Failed to submit');
      }
    } catch (err) {
      setError(err.message || 'Failed to connect');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!token || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitSuccess(false);
    setSubmitError(false);
    setError('');

    // Capture time at submission before server evaluation delay
    const submitTimestamp = Date.now();
    const submitTimeElapsed = startTimeRef.current
      ? Math.floor((submitTimestamp - startTimeRef.current) / 1000)
      : timeElapsed;

    try {
      // Note: testCases are fetched server-side to prevent cheating with hidden tests
      const testResponse = await fetchWithTimeout(`${config.backend_url}/api/practice/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          language: selectedLanguage,
          problemId: challenge.problem.id
        })
      }, 60000);

      // Check HTTP status before parsing JSON
      if (!testResponse.ok) {
        const errorData = await testResponse.json().catch(() => ({}));
        throw new Error(errorData.message || `Server error: ${testResponse.status}`);
      }

      const testData = await testResponse.json();

      if (!testData.success) {
        throw new Error(testData.message || 'Failed to run tests');
      }

      setTestResults(testData.results);
      setHiddenTestResults(testData.hiddenTests || null);
      // Use server's allPassed which includes hidden tests
      const allPassed = testData.allPassed ?? false;

      // Update submit button feedback
      if (allPassed) {
        setSubmitSuccess(true);
        setSubmitError(false);
      } else {
        setSubmitError(true);
        setSubmitSuccess(false);
      }
      const visiblePassedCount = testData.results?.filter(r => r.passed).length ?? 0;
      const hiddenPassedCount = testData.hiddenTests?.passed ?? 0;
      const passedCount = visiblePassedCount + hiddenPassedCount;
      const totalTests = (testData.results?.length ?? 0) + (testData.hiddenTests?.total ?? 0);
      const failedCount = totalTests - passedCount;

      // Track submission
      trackChallengeSubmit({
        challengeId: challenge?.id,
        problemId: challenge.problem.id,
        language: selectedLanguage,
        accepted: allPassed,
        testcasesPassed: passedCount,
        testcasesFailed: failedCount,
        attemptNumber: (attempt?.submissions || 0) + 1
      }, user);

      if (allPassed) {
        const completeResponse = await fetchWithTimeout(`${config.backend_url}/api/challenge/complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            solveTime: submitTimeElapsed,
            submittedAt: submitTimestamp, // When submit was clicked (before evaluation)
            code
          })
        }, 20000);

        // Check HTTP status before parsing JSON
        if (!completeResponse.ok) {
          const errorData = await completeResponse.json().catch(() => ({}));
          throw new Error(errorData.message || `Failed to complete challenge: ${completeResponse.status}`);
        }

        const completeData = await completeResponse.json();

        if (completeData.success) {
          stopTimer();
          setTimeElapsed(submitTimeElapsed);
          setAttempt({ ...attempt, completed: true, solveTime: submitTimeElapsed });
          setStreak({
            current: completeData.streak?.current || streak.current + 1,
            best: completeData.streak?.best || Math.max(streak.best, streak.current + 1),
            completedThisWeek: true
          });

          // Track challenge complete
          trackChallengeComplete({
            challengeId: challenge?.id,
            problemId: challenge.problem.id,
            problemName: challenge.problem.title,
            difficulty: challenge.problem.difficulty,
            language: selectedLanguage,
            solveTimeSeconds: submitTimeElapsed,
            attempts: (attempt?.submissions || 0) + 1,
            leaderboardRank: completeData.rank
          }, user);

          fetchChallenge();
        }
      }
    } catch (err) {
      console.error('Submit error:', err);
      setError(err.message || 'Failed to submit solution');
    } finally {
      setIsSubmitting(false);
    }
  };

  const allTestsPassed = testResults.length > 0 && testResults.every(r => r.passed);

  // Fetch solution (only available after completion)
  const fetchSolution = async () => {
    if (!token || loadingSolution) return;

    setLoadingSolution(true);
    try {
      const response = await fetchWithTimeout(`${config.backend_url}/api/challenge/solution`, {
        headers: { Authorization: `Bearer ${token}` }
      }, 15000);

      const data = await response.json();

      if (data.success && data.solution) {
        setSolution(data.solution);
        setShowSolution(true);
      } else if (data.error) {
        setError(data.error);
      }
    } catch (err) {
      console.error('Error fetching solution:', err);
      setError('Failed to load solution');
    } finally {
      setLoadingSolution(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-surface-400 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Arena Challenge - CodeArena</title>
        <meta name="description" content="Complete this week's coding challenge and compete for the fastest time!" />
      </Head>

      <div className="h-screen bg-surface-950 text-white overflow-hidden">

        <div className="relative z-10 h-full flex flex-col">
          {/* Header */}
          <motion.header
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="bg-surface-900/80 backdrop-blur-md border-b border-surface-700 px-6 py-3"
          >
            <div className="flex items-center justify-between max-w-7xl mx-auto">
              <div className="flex items-center space-x-4">
                <button
                  onClick={handleExit}
                  className="flex items-center space-x-2 hover:opacity-80 transition-opacity group"
                >
                  <ArrowLeft className="h-4 w-4 text-surface-500 group-hover:text-primary-400 transition-colors" />
                  <Logo />
                </button>

                <div className="hidden md:flex items-center space-x-1 text-surface-500">
                  <Calendar className="h-4 w-4 text-warning" />
                  <span className="text-sm">{formatWeekLabel(challenge?.week)}</span>
                </div>
              </div>

              <div className="flex items-center space-x-4">
                <StreakDisplay
                  current={streak.current}
                  best={streak.best}
                  completedThisWeek={streak.completedThisWeek}
                />

                {started && !attempt?.completed ? (
                  <div className="flex items-center space-x-2 bg-primary-500/20 rounded-lg px-3 py-1.5">
                    <Clock className="h-4 w-4 text-primary-400" />
                    <span className="font-mono text-primary-400">{formatTime(timeElapsed)}</span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2 bg-surface-800/50 rounded-lg px-3 py-1.5">
                    <span className="text-xs text-surface-400">Next challenge:</span>
                    <CountdownTimer timeUntilNext={timeUntilNext} />
                  </div>
                )}
              </div>
            </div>
          </motion.header>

          {/* Main Content */}
          {/* Prompt challenges skip the mystery-box reveal gate: the scenario IS the problem.
              Auto-start kicks in on first load via useEffect; we render the editor immediately
              and the start request fires in the background (or on first preview/submit). */}
          {challengeType !== 'prompt' && !started && !attempt?.completed ? (
            <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
              <FadeIn className="text-center max-w-2xl">
                <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white">
                  Arena Challenge
                </h1>
                <p className="text-lg text-surface-300 mb-8">
                  This week's mystery challenge awaits. You have ONE attempt - make it count!
                </p>

                {challenge?.problem && (
                  <Card variant="glass" className="p-6 mb-8 text-left">
                    {/* Mystery Challenge Header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <motion.div
                          animate={{ rotate: [0, 10, -10, 0] }}
                          transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                          className="text-3xl"
                        >
                          
                        </motion.div>
                        <h2 className="text-2xl font-bold">{challenge.problem.title}</h2>
                      </div>
                      <Badge variant={
                        challenge.problem.difficulty === 'Easy' ? 'success' :
                        challenge.problem.difficulty === 'Medium' ? 'warning' : 'danger'
                      }>
                        {challenge.problem.difficulty}
                      </Badge>
                    </div>

                    {/* Mystery Description */}
                    <div className="bg-surface-800/50 rounded-xl p-4 mb-6 border border-surface-700">
                      <ProblemDescription description={challenge.problem.description} className="text-center" />
                    </div>

                    {/* Warning about one attempt */}
                    <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 mb-6">
                      <div className="flex items-center space-x-3">
                        <div className="text-2xl"></div>
                        <div>
                          <h4 className="font-semibold text-warning">One Attempt Only</h4>
                          <p className="text-sm text-surface-400">
                            Once you start, the timer begins. You cannot restart this week's challenge.
                          </p>
                        </div>
                      </div>
                    </div>

                    {stats && (
                      <div className="grid grid-cols-2 gap-4 mb-6">
                        <div className="text-center p-3 bg-surface-800/50 rounded-lg">
                          <div className="text-2xl font-bold text-primary-400">{stats.completions}</div>
                          <div className="text-xs text-surface-400">Completions</div>
                        </div>
                        <div className="text-center p-3 bg-surface-800/50 rounded-lg">
                          <div className="text-2xl font-bold text-warning">{stats.totalAttempts}</div>
                          <div className="text-xs text-surface-400">Attempts</div>
                        </div>
                      </div>
                    )}

                    {challengeType !== 'prompt' && (
                      <div className="mb-6">
                        <label className="block text-sm font-medium text-surface-300 mb-2">
                          Choose your language:
                        </label>
                        <select
                          value={selectedLanguage}
                          onChange={(e) => {
                            trackLanguageSelect({
                              language: e.target.value,
                              previousLanguage: selectedLanguage,
                              context: 'challenge',
                              problemId: challenge?.problem?.id
                            }, user);
                            setSelectedLanguage(e.target.value);
                            try { localStorage.setItem('codearena-preferred-language', e.target.value); } catch (_) {}
                          }}
                          className="w-full bg-surface-700 text-white text-sm rounded-lg px-4 py-2.5 border border-surface-600 focus:outline-none focus:border-primary-500 cursor-pointer"
                        >
                          {languages.filter(lang => availableLanguages.includes(lang.id)).map(lang => (
                            <option key={lang.id} value={lang.id}>{lang.icon} {lang.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Start error */}
                    {startError && (
                      <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 mb-4 text-danger-light text-sm text-center">
                        {startError}
                      </div>
                    )}

                    {/* Start Button Container */}
                    <div>
                      <Button
                        variant="warning"
                        fullWidth
                        size="lg"
                        icon={Play}
                        onClick={handleStart}
                        loading={starting}
                        disabled={starting}
                      >
                        Reveal & Start Challenge
                        <ChevronRight className="h-5 w-5 ml-1" />
                      </Button>
                    </div>
                  </Card>
                )}

                {leaderboard.length > 0 && (
                  <Card variant="glass" className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold">This Week's Leaderboard</h3>
                      <Badge variant="primary">{leaderboard?.length ?? 0} completions</Badge>
                    </div>
                    <div className="space-y-2">
                      {leaderboard?.slice(0, 5).map((entry, index) => (
                        <LeaderboardEntry
                          key={entry.userId}
                          entry={entry}
                          rank={index + 1}
                          isCurrentUser={user?.id === entry.userId}
                        />
                      ))}
                    </div>
                  </Card>
                )}
              </FadeIn>
            </div>
          ) : attempt?.completed ? (
            <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
              <FadeIn className="text-center max-w-2xl">
                <div className="w-24 h-24 bg-success rounded-full flex items-center justify-center mx-auto mb-8">
                  <CheckCircle className="h-12 w-12 text-white" />
                </div>

                <h1 className="text-4xl font-bold mb-4 text-success">
                  Challenge Complete!
                </h1>
                {challengeType === 'prompt' ? (
                  <div className="mb-8">
                    <p className="text-lg text-surface-300 mb-2">
                      Score: <span className="text-success-light font-bold text-2xl">{attempt.score ?? finalScore ?? '-'}%</span>
                    </p>

                    {/* How you were scored: judge rationale + per-criterion breakdown.
                        Falls back to nothing extra if judgeRationale is null/missing
                        (the score number above acts as the existing tier display). */}
                    {judgeRationale ? (
                      <Card variant="glass" className="mt-6 p-5 text-left">
                        <div className="flex items-center space-x-2 mb-3">
                          <Lightbulb className="h-4 w-4 text-warning" />
                          <h3 className="text-sm font-semibold text-warning uppercase tracking-wide">How you were scored</h3>
                        </div>
                        <p className="text-surface-200 text-sm leading-relaxed mb-4">{judgeRationale}</p>
                        {Array.isArray(judgeCriteria) && judgeCriteria.length > 0 && (
                          <div className="space-y-2 border-t border-surface-700 pt-4">
                            {judgeCriteria.map((c, i) => (
                              <div key={i} className="bg-surface-800/50 rounded-lg p-3 border border-surface-700">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-sm font-medium text-white">{c.name}</span>
                                  {typeof c.score === 'number' && (
                                    <span className="font-mono text-sm text-success-light">{c.score}</span>
                                  )}
                                </div>
                                {c.comment && (
                                  <p className="text-xs text-surface-400 leading-relaxed">{c.comment}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </Card>
                    ) : null}

                    {finalModelOutput && (
                      <div className="mt-4 bg-surface-800/50 rounded-xl p-4 border border-surface-700 text-left max-h-60 overflow-y-auto">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs text-secondary-400 uppercase tracking-wide">AI Response</p>
                          <Badge variant="warning">Your final scored output</Badge>
                        </div>
                        <p className="text-surface-300 text-sm whitespace-pre-line">{finalModelOutput}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-lg text-surface-300 mb-2">
                    You solved this week's challenge in <span className="text-success-light font-bold">{formatTime(attempt.solveTime || timeElapsed)}</span>
                  </p>
                )}

                <div className="flex items-center justify-center space-x-4 mb-8">
                  <span className="font-bold text-warning">{streak.current} week streak!</span>
                </div>

                <Card variant="glass" className="p-6 mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold">This Week's Leaderboard</h3>
                  </div>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {leaderboard.map((entry, index) => (
                      <LeaderboardEntry
                        key={entry.userId}
                        entry={entry}
                        rank={index + 1}
                        isCurrentUser={user?.id === entry.userId}
                      />
                    ))}
                  </div>
                </Card>

                <div className="flex items-center justify-center space-x-4">
                  {challengeType !== 'prompt' && (
                    <Button
                      variant="warning"
                      onClick={fetchSolution}
                      disabled={loadingSolution}
                    >
                      {loadingSolution ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                          Loading...
                        </>
                      ) : (
                        <>
                          <Lightbulb className="h-4 w-4 mr-2" />
                          View Solution
                        </>
                      )}
                    </Button>
                  )}
                  <Button variant="primary" onClick={() => router.push('/modes')}>
                    <Play className="h-4 w-4 mr-2" />
                    Play More
                  </Button>
                  <Button variant="secondary" onClick={() => router.push('/players')}>
                    <Users className="h-4 w-4 mr-2" />
                    Leaderboard
                  </Button>
                </div>

                <p className="text-surface-400 text-sm mt-8">
                  New challenge drops every Monday!
                </p>
              </FadeIn>
            </div>
          ) : challengeType === 'prompt' ? (
            /* ── Prompt Challenge Editor ── */
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
              {/* Left: Scenario */}
              <motion.div
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                className="lg:w-2/5 border-r border-surface-700 overflow-y-auto flex-shrink-0"
              >
                <div className="p-4 md:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h1 className="text-lg md:text-xl font-bold">{challenge?.problem?.title}</h1>
                    <Badge variant={
                      challenge?.problem?.difficulty === 'Easy' ? 'success' :
                      challenge?.problem?.difficulty === 'Medium' ? 'warning' : 'danger'
                    }>{challenge?.problem?.difficulty}</Badge>
                  </div>

                  <div className="bg-surface-800/50 rounded-xl p-4 mb-4 border border-surface-700">
                    <div className="flex items-center space-x-2 mb-2">
                      <BookOpen className="h-4 w-4 text-primary-400" />
                      <span className="text-sm font-semibold text-primary-400 uppercase tracking-wide">Scenario</span>
                    </div>
                    <p className="text-surface-300 text-sm whitespace-pre-line">{challenge?.problem?.scenario}</p>
                  </div>

                  <div className="bg-surface-800/50 rounded-xl p-4 mb-4 border border-surface-700">
                    <div className="flex items-center space-x-2 mb-2">
                      <Sparkles className="h-4 w-4 text-warning" />
                      <span className="text-sm font-semibold text-warning uppercase tracking-wide">Your Task</span>
                    </div>
                    <p className="text-surface-300 text-sm whitespace-pre-line">{challenge?.problem?.description}</p>
                  </div>

                  {challenge?.problem?.targetOutput && (
                    <div className="bg-surface-800/50 rounded-xl p-4 border border-surface-700">
                      <div className="flex items-center space-x-2 mb-2">
                        <CheckCircle className="h-4 w-4 text-success" />
                        <span className="text-sm font-semibold text-success uppercase tracking-wide">Expected Output</span>
                      </div>
                      <p className="text-surface-400 text-sm">{challenge?.problem?.targetOutput}</p>
                    </div>
                  )}

                  {error && (
                    <div className="mt-4 bg-danger/10 border border-danger/20 rounded-lg p-3 text-danger-light text-sm">
                      {error}
                    </div>
                  )}
                </div>
              </motion.div>

              {/* Right: Prompt Editor + AI Response */}
              <motion.div
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="flex-1 flex flex-col overflow-hidden"
              >
                {/* Action bar - Free Preview (unlimited) on the left, Submit Final Answer (one shot) on the right */}
                <div className="flex-shrink-0 px-4 py-3 bg-surface-800 border-b border-surface-700 flex flex-wrap items-center justify-between gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handlePreview}
                    loading={previewing}
                    disabled={previewing || isSubmitting || !promptText.trim()}
                    icon={Sparkles}
                  >
                    Free Preview (no penalty)
                  </Button>
                  <div className="flex flex-col items-end">
                    <Button
                      variant="warning"
                      size="sm"
                      onClick={handleSubmitPrompt}
                      loading={isSubmitting}
                      disabled={isSubmitting || previewing || !promptText.trim()}
                      icon={Send}
                    >
                      Submit Final Answer
                    </Button>
                    <span className="text-[10px] text-warning mt-1 mr-1 max-w-xs text-right">
                      This is your ONE scored submission for this week. You can preview as many times as you want, but only your final submit is scored.
                    </span>
                  </div>
                </div>

                {/* Prompt textarea */}
                <div className="flex-shrink-0 p-3 border-b border-surface-700 bg-surface-900/80">
                  <label className="block text-xs text-surface-400 mb-1 uppercase tracking-wide">Your Prompt</label>
                  <textarea
                    value={promptText}
                    onChange={e => setPromptText(e.target.value)}
                    placeholder="Write your prompt here. Be specific about what you want the AI to produce..."
                    className="w-full h-40 bg-surface-800 text-white text-sm rounded-lg p-3 border border-surface-600 focus:outline-none focus:border-primary-500 resize-none font-mono placeholder-surface-500"
                    disabled={isSubmitting}
                  />
                  <div className="flex items-center justify-end mt-1">
                    <div className="text-xs text-surface-500">{promptText.length} chars</div>
                  </div>
                </div>

                {/* AI Response */}
                <div className="flex-1 overflow-y-auto p-3">
                  {modelOutput ? (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <Sparkles className="h-4 w-4 text-secondary-400" />
                          <span className="text-xs font-semibold text-secondary-400 uppercase tracking-wide">AI Response</span>
                        </div>
                        <Badge variant="success">Preview output</Badge>
                      </div>
                      <div className="bg-surface-800/50 rounded-xl p-4 border border-surface-700">
                        <p className="text-surface-300 text-sm whitespace-pre-line">{modelOutput}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-surface-500 text-sm text-center px-6">
                      Use <span className="text-surface-300 font-medium mx-1">Free Preview</span> to test prompts without penalty.
                      When you're ready, click <span className="text-surface-300 font-medium mx-1">Submit Final Answer</span> for your one scored shot.
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          ) : (
            <ResizablePanel
              storageKey="challengePanelWidth"
              defaultLeftWidth={35}
              minLeftWidth={25}
              maxLeftWidth={60}
              className="flex-1"
              leftPanel={
                <motion.div
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  className="h-full overflow-y-auto"
                >
                <div className="p-3 md:p-6">
                  <div className="flex items-center justify-between mb-3 md:mb-4">
                    <h1 className="text-lg md:text-2xl font-bold">{challenge?.problem?.title}</h1>
                    <Badge variant={
                      challenge?.problem?.difficulty === 'Easy' ? 'success' :
                      challenge?.problem?.difficulty === 'Medium' ? 'warning' : 'danger'
                    }>
                      {challenge?.problem?.difficulty}
                    </Badge>
                  </div>

                  <ProblemDescription description={challenge?.problem?.description} className="text-sm md:text-base mb-4 md:mb-6" />

                  <h3 className="text-base md:text-lg font-semibold mb-2 md:mb-3">
                    Examples
                  </h3>
                  {challenge?.problem?.examples?.map((example, index) => (
                    <Card key={index} variant="glass" className="p-3 md:p-4 mb-3 md:mb-4">
                      <div className="mb-2">
                        <strong className="text-surface-200 text-sm">Input:</strong>{' '}
                        <code className="text-primary-400 bg-surface-800 px-1.5 md:px-2 py-0.5 md:py-1 rounded text-xs md:text-sm break-all">{example.input}</code>
                      </div>
                      <div className="mb-2">
                        <strong className="text-surface-200 text-sm">Output:</strong>{' '}
                        <code className="text-success-light bg-surface-800 px-1.5 md:px-2 py-0.5 md:py-1 rounded text-xs md:text-sm break-all">{example.output}</code>
                      </div>
                      {example.explanation && (
                        <div className="text-surface-400 text-xs md:text-sm">
                          <strong>Explanation:</strong> {example.explanation}
                        </div>
                      )}
                    </Card>
                  ))}

                  <h3 className="text-base md:text-lg font-semibold mb-2 md:mb-3">Constraints:</h3>
                  <ul className="text-surface-300 text-sm md:text-base space-y-1 mb-4 md:mb-6">
                    {challenge?.problem?.constraints?.map((constraint, idx) => (
                      <li key={idx} className="flex items-start">
                        <span className="text-primary-400 mr-2">•</span>
                        <span>{constraint}</span>
                      </li>
                    ))}
                  </ul>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-danger/10 border border-danger/20 rounded-lg p-3 text-danger-light text-sm"
                    >
                      {error}
                    </motion.div>
                  )}

                  {testResults.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-6"
                    >
                      <h3 className="text-lg font-semibold mb-3 flex items-center">
                        {allTestsPassed ? (
                          <>
                            <CheckCircle className="h-5 w-5 text-success-light mr-2" />
                            <span className="text-success-light">All Tests Passed!</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-5 w-5 text-danger-light mr-2" />
                            <span className="text-danger-light">Some Tests Failed</span>
                          </>
                        )}
                      </h3>

                      <div className="space-y-2">
                        {testResults.map((result, index) => (
                          <motion.div
                            key={index}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.1 }}
                            className={`p-3 rounded-lg border ${
                              result.passed
                                ? 'bg-success/10 border-success/30 text-success-light'
                                : 'bg-danger/10 border-danger/30 text-danger-light'
                            }`}
                          >
                            <div className="flex items-center space-x-2 mb-2">
                              {result.passed ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                              <span className="text-sm font-medium">Test Case {index + 1}</span>
                            </div>
                            <div className="text-xs text-surface-400 space-y-1">
                              <div>Input: {result.input}</div>
                              <div>Expected: <span className="text-success-light">{result.expected}</span></div>
                              <div>Got: <span className={result.passed ? 'text-success-light' : 'text-danger-light'}>{result.actual}</span></div>
                            </div>
                          </motion.div>
                        ))}

                        {/* Hidden Test Cases Summary */}
                        {hiddenTestResults && hiddenTestResults.total > 0 && (
                          <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: testResults.length * 0.1 }}
                            className={`p-3 rounded-lg border ${
                              hiddenTestResults.passed === hiddenTestResults.total
                                ? 'bg-success/10 border-success/30'
                                : 'bg-surface-800 border-surface-600'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-2">
                                <EyeOff className="h-4 w-4 text-surface-400" />
                                <span className="text-sm font-medium text-surface-300">Hidden Tests</span>
                              </div>
                              <span className={`text-sm font-medium ${
                                hiddenTestResults.passed === hiddenTestResults.total
                                  ? 'text-success'
                                  : 'text-surface-400'
                              }`}>
                                {hiddenTestResults.passed}/{hiddenTestResults.total} passed
                              </span>
                            </div>
                            <p className="text-xs text-surface-500 mt-1">
                              Hidden tests verify your solution works for edge cases
                            </p>
                          </motion.div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </div>
              </motion.div>
              }
              rightPanel={
                (() => {
                  const currentLanguage = languages.find(l => l.id === selectedLanguage);
                  return (
                <motion.div
                  initial={{ x: 20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="h-full flex flex-col bg-surface-900/50 min-h-0"
                >
                {/* Primary Action Bar - Submit Button at top */}
                <div className="flex-shrink-0 px-3 md:px-4 py-2 md:py-3 bg-gradient-to-r from-surface-800 to-surface-800/80 border-b border-surface-600">
                  <div className="flex items-center gap-3">
                    <SubmitButton
                      onClick={handleSubmit}
                      disabled={!code.trim()}
                      loading={isSubmitting}
                      success={submitSuccess}
                      error={submitError}
                      label="Submit"
                      loadingLabel="Running..."
                      successLabel="Passed!"
                      errorLabel="Failed"
                      shortcut="Enter"
                      mode="challenge"
                      size="lg"
                    />

                    {/* Language selector */}
                    <div className="h-8 w-px bg-surface-600 hidden sm:block"></div>
                    <select
                      value={selectedLanguage}
                      onChange={(e) => {
                        trackLanguageSelect({
                          language: e.target.value,
                          previousLanguage: selectedLanguage,
                          context: 'challenge_coding',
                          problemId: challenge?.problem?.id
                        }, user);
                        setSelectedLanguage(e.target.value);
                        try { localStorage.setItem('codearena-preferred-language', e.target.value); } catch (_) {}
                      }}
                      className="bg-surface-700 text-white text-sm rounded-lg px-3 py-1.5 border border-surface-600 focus:outline-none focus:border-primary-500 cursor-pointer"
                    >
                      {languages.filter(lang => availableLanguages.includes(lang.id)).map(lang => (
                        <option key={lang.id} value={lang.id}>{lang.icon} {lang.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Secondary info bar - smaller on mobile */}
                <div className="px-2 md:px-3 py-1.5 border-b border-surface-700/50 bg-surface-900/80 flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center space-x-2 sm:hidden">
                    <span className="text-sm">{currentLanguage?.icon}</span>
                    <span className="font-medium text-xs">{currentLanguage?.name}</span>
                  </div>
                  <div className="text-xs text-surface-500">
                    {code.split('\n').length} lines | {code.length} chars
                  </div>
                </div>

                {/* Code Editor - takes remaining space */}
                <div className="flex-1 p-2 md:p-3 min-h-0 overflow-hidden">
                  <div className="w-full h-full min-h-[300px] md:min-h-0 bg-surface-800/50 border border-surface-600 rounded-lg overflow-hidden">
                    <CodeEditor
                      value={code}
                      onChange={setCode}
                      onSubmit={() => {
                        if (!isSubmitting && code.trim()) handleSubmit();
                      }}
                      language={selectedLanguage}
                      readOnly={isSubmitting}
                      height="100%"
                      vimMode={editorPrefs.vimMode}
                    />
                  </div>
                </div>
              </motion.div>
                  );
                })()
              }
            />
          )}
        </div>

        {/* Solution Modal */}
        <AnimatePresence>
          {showSolution && solution && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setShowSolution(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-surface-900 border border-surface-700 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden shadow-2xl"
                onClick={e => e.stopPropagation()}
              >
                {/* Modal Header */}
                <div className="bg-gradient-to-r from-warning/20 to-primary-500/20 border-b border-surface-700 px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 bg-warning/20 rounded-xl">
                        <Lightbulb className="h-6 w-6 text-warning" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-white">Solution Explained</h2>
                        <p className="text-surface-400 text-sm">{challenge?.problem?.title}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setShowSolution(false)}
                      className="p-2 text-surface-400 hover:text-white hover:bg-surface-700 rounded-lg transition-colors"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {/* Modal Content */}
                <div className="overflow-y-auto max-h-[calc(90vh-80px)] p-6">
                  {/* Complexity Info */}
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <Card variant="glass" className="p-4">
                      <div className="flex items-center space-x-3">
                        <Clock className="h-5 w-5 text-primary-400" />
                        <div>
                          <div className="text-sm text-surface-400">Time Complexity</div>
                          <div className="text-lg font-mono font-bold text-primary-400">{solution.timeComplexity}</div>
                        </div>
                      </div>
                    </Card>
                    <Card variant="glass" className="p-4">
                      <div className="flex items-center space-x-3">
                        <Code2 className="h-5 w-5 text-secondary-400" />
                        <div>
                          <div className="text-sm text-surface-400">Space Complexity</div>
                          <div className="text-lg font-mono font-bold text-secondary-400">{solution.spaceComplexity}</div>
                        </div>
                      </div>
                    </Card>
                  </div>

                  {/* Key Insights */}
                  {solution.keyInsights && solution.keyInsights.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-lg font-semibold mb-3">Key Insights</h3>
                      <div className="grid gap-2">
                        {solution.keyInsights.map((insight, index) => (
                          <motion.div
                            key={index}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.1 }}
                            className="flex items-start space-x-3 bg-surface-800/50 rounded-lg p-3"
                          >
                            <div className="w-6 h-6 rounded-full bg-warning/20 flex items-center justify-center text-warning text-xs font-bold flex-shrink-0">
                              {index + 1}
                            </div>
                            <p className="text-surface-300">{insight}</p>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Explanation */}
                  <div className="mb-6">
                    <h3 className="flex items-center space-x-2 text-lg font-semibold mb-3">
                      <BookOpen className="h-5 w-5 text-primary-400" />
                      <span>Approach</span>
                    </h3>
                    <Card variant="glass" className="p-4">
                      <div className="prose prose-invert max-w-none text-surface-300">
                        {solution.explanation.split('\n').map((paragraph, index) => {
                          // Helper to parse inline markdown (bold and code)
                          const parseInlineMarkdown = (text) => {
                            const parts = [];
                            let remaining = text;
                            let keyCounter = 0;

                            while (remaining.length > 0) {
                              // Check for **bold**
                              const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);
                              // Check for `code`
                              const codeMatch = remaining.match(/`([^`]+)`/);

                              if (boldMatch && (!codeMatch || boldMatch.index < codeMatch.index)) {
                                if (boldMatch.index > 0) {
                                  parts.push(remaining.slice(0, boldMatch.index));
                                }
                                parts.push(<strong key={keyCounter++} className="text-white font-semibold">{boldMatch[1]}</strong>);
                                remaining = remaining.slice(boldMatch.index + boldMatch[0].length);
                              } else if (codeMatch) {
                                if (codeMatch.index > 0) {
                                  parts.push(remaining.slice(0, codeMatch.index));
                                }
                                parts.push(<code key={keyCounter++} className="text-primary-400 bg-surface-800 px-1 rounded text-sm">{codeMatch[1]}</code>);
                                remaining = remaining.slice(codeMatch.index + codeMatch[0].length);
                              } else {
                                parts.push(remaining);
                                break;
                              }
                            }
                            return parts;
                          };

                          if (paragraph.startsWith('- ')) {
                            return <li key={index} className="ml-4 mb-1">{parseInlineMarkdown(paragraph.slice(2))}</li>;
                          }
                          if (paragraph.match(/^\d+\./)) {
                            return <li key={index} className="ml-4 list-decimal mb-1">{parseInlineMarkdown(paragraph.replace(/^\d+\.\s*/, ''))}</li>;
                          }
                          return paragraph.trim() ? <p key={index} className="mb-3">{parseInlineMarkdown(paragraph)}</p> : null;
                        })}
                      </div>
                    </Card>
                  </div>

                  {/* Code Solution */}
                  <div>
                    <h3 className="flex items-center space-x-2 text-lg font-semibold mb-3">
                      <Code2 className="h-5 w-5 text-success-light" />
                      <span>Python Solution</span>
                    </h3>
                    <div className="bg-surface-800 border border-surface-700 rounded-xl overflow-hidden">
                      <div className="bg-surface-900/80 px-4 py-2 border-b border-surface-700 flex items-center justify-between">
                        <span className="text-sm text-surface-400">solution.py</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(solution.code);
                          }}
                          className="text-xs text-surface-400 hover:text-white transition-colors"
                        >
                          Copy
                        </button>
                      </div>
                      <pre className="p-4 overflow-x-auto text-sm">
                        <code className="text-success-light font-mono whitespace-pre">
                          {solution.code}
                        </code>
                      </pre>
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Exit Confirmation Modal */}
        <AnimatePresence>
          {showExitConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setShowExitConfirm(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-surface-900 border border-surface-700 rounded-2xl max-w-md w-full p-6 shadow-2xl"
                onClick={e => e.stopPropagation()}
              >
                <div className="mb-4">
                  <h2 className="text-xl font-bold text-white">Exit Challenge?</h2>
                </div>
                <p className="text-surface-300 mb-6">
                  Are you sure you want to exit? Your progress will be lost and you <span className="text-warning font-semibold">cannot restart</span> this week's challenge.
                </p>
                <div className="flex space-x-3">
                  <Button
                    variant="ghost"
                    fullWidth
                    onClick={() => setShowExitConfirm(false)}
                  >
                    Keep Going
                  </Button>
                  <Button
                    variant="danger"
                    fullWidth
                    onClick={confirmExit}
                  >
                    Exit Challenge
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

export default withAuth(ArenaChallenge);
