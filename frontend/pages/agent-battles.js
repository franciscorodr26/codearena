import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import {
  Play,
  Settings,
  ChevronRight,
  ArrowLeft,
  AlertCircle,
  Check,
  Loader2,
  Code,
  TestTube,
  BookOpen,
  RotateCcw,
  Globe,
  Lock,
  Copy,
  TrendingUp,
  Calendar,
  Clock,
  Eye,
  X,
  History,
  GitBranch,
  Bug,
  Shield,
  FileType,
  HardDrive,
  Library,
  Target,
  Swords,
  Sparkles,
  Zap
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { config } from '../config/env';
import { authFetch } from '../utils/fetch';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import withAuth from '../components/withAuth';
import io from 'socket.io-client';
import AgentChallenges from '../components/AgentChallenges';
import AgentTemplatePicker from '../components/AgentTemplatePicker';
import AgentBattlesGate from '../components/AgentBattlesGate'
// Available AI Models — clean, no gradient icons
const MODELS = [
  {
    id: 'haiku',
    name: 'Haiku',
    description: 'Fast & cheap',
    tier: 'free',
    accent: 'text-emerald-400',
    selectedBorder: 'border-emerald-500/50',
    selectedBg: 'bg-emerald-500/5'
  },
  {
    id: 'sonnet',
    name: 'Sonnet',
    description: 'Balanced',
    tier: 'free',
    accent: 'text-cyan-400',
    selectedBorder: 'border-cyan-500/50',
    selectedBg: 'bg-cyan-500/5'
  },
  {
    id: 'opus',
    name: 'Opus',
    description: 'Most powerful',
    tier: 'pro',
    accent: 'text-violet-400',
    selectedBorder: 'border-violet-500/50',
    selectedBg: 'bg-violet-500/5'
  }
];

// Icon mapping for modules
const MODULE_ICONS = {
  'test-runner': TestTube,
  'auto-retry': RotateCcw,
  'docs-lookup': BookOpen,
  'debug-mode': Bug,
  'edge-case-focus': Shield,
  'type-checker': FileType,
  'complexity-analyzer': TrendingUp,
  'memory-profiler': HardDrive,
  'template-library': Library,
  'strategic-planner': GitBranch
};

// Fallback modules for initial render (before API call)
const DEFAULT_MODULES = [
  { id: 'test-runner', name: 'Test Runner', description: 'Run code before submitting', icon: 'TestTube', isDefault: true, isUnlocked: true },
  { id: 'auto-retry', name: 'Auto Retry', description: 'Retry on failure with feedback', icon: 'RotateCcw', isDefault: true, isUnlocked: true },
  { id: 'docs-lookup', name: 'Docs Lookup', description: 'Search documentation', icon: 'BookOpen', isDefault: true, isUnlocked: true }
];

// Languages
const LANGUAGES = [
  { id: 'python', name: 'Python' },
  { id: 'javascript', name: 'JavaScript' },
  { id: 'typescript', name: 'TypeScript' },
  { id: 'java', name: 'Java' },
  { id: 'cpp', name: 'C++' },
  { id: 'go', name: 'Go' },
  { id: 'rust', name: 'Rust' }
];

// Default system prompts
const PRESET_PROMPTS = [
  {
    name: 'Competitive',
    prompt: 'You are a competitive programmer. Write clean, efficient code. Optimize for speed and correctness.'
  },
  {
    name: 'Defensive',
    prompt: 'You are a careful programmer. Double-check edge cases. Verify your solution before submitting.'
  },
  {
    name: 'Minimal',
    prompt: 'Write the shortest correct solution. No comments, no extra code.'
  }
];

function AgentBattles() {
  const router = useRouter();
  const { user, token } = useAuth();

  // Loadout state
  const [selectedModel, setSelectedModel] = useState('sonnet');
  const [systemPrompt, setSystemPrompt] = useState(PRESET_PROMPTS[0].prompt);
  const [selectedModules, setSelectedModules] = useState(['test-runner']);
  const [selectedLanguage, setSelectedLanguage] = useState('python');
  const [loadoutName, setLoadoutName] = useState('');
  const [loadoutDescription, setLoadoutDescription] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Modules state
  const [availableModules, setAvailableModules] = useState(DEFAULT_MODULES);
  const [modulesLoading, setModulesLoading] = useState(true);
  const [moduleUnlockQueue, setModuleUnlockQueue] = useState([]);
  const [activeModuleUnlock, setActiveModuleUnlock] = useState(null);

  // UI state
  const [activeTab, setActiveTab] = useState('build'); // 'build' | 'test' | 'battle' | 'browse' | 'my-loadouts' | 'history' | 'challenges' | 'rivalries' | 'spectate' | 'training'
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState(null);

  // Template picker state
  const [showTemplates, setShowTemplates] = useState(true);

  // Training mode state
  const [trainingProblems, setTrainingProblems] = useState({});
  const [loadingTrainingProblems, setLoadingTrainingProblems] = useState(false);
  const [selectedDifficulty, setSelectedDifficulty] = useState('easy');
  const [selectedProblem, setSelectedProblem] = useState(null);
  const [trainingResult, setTrainingResult] = useState(null);
  const [trainingHistory, setTrainingHistory] = useState([]);
  const [trainingStats, setTrainingStats] = useState(null);
  const [runningTraining, setRunningTraining] = useState(false);

  // Battle history state
  const [battleHistory, setBattleHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Browse loadouts state
  const [publicLoadouts, setPublicLoadouts] = useState([]);
  const [loadingPublic, setLoadingPublic] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // My loadouts state
  const [myLoadouts, setMyLoadouts] = useState([]);
  const [loadingMyLoadouts, setLoadingMyLoadouts] = useState(false);

  // Version history state
  const [selectedLoadoutForVersions, setSelectedLoadoutForVersions] = useState(null);
  const [loadoutVersions, setLoadoutVersions] = useState([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [showVersionsModal, setShowVersionsModal] = useState(false);


  // Rivalries state
  const [rivalries, setRivalries] = useState([]);
  const [rivalriesLoading, setRivalriesLoading] = useState(false);

  // Season state
  const [currentSeason, setCurrentSeason] = useState(null);

  useEffect(() => {
    fetchCurrentSeason();
    fetchModules();
  }, [token]);

  const fetchCurrentSeason = async () => {
    if (!token) return;
    try {
      const response = await authFetch(
        `${config.backend_url}/api/agent/seasons/current`
      );
      const data = await response.json();
      if (response.ok && data.season) {
        setCurrentSeason(data);
      }
    } catch (err) {
      console.error('Failed to fetch current season:', err);
    }
  };

  const fetchModules = async () => {
    if (!token) return;
    setModulesLoading(true);
    try {
      const response = await authFetch(
        `${config.backend_url}/api/agent/modules`
      );
      const data = await response.json();
      if (response.ok && data.modules) {
        setAvailableModules(data.modules);
      }
    } catch (err) {
      console.error('Failed to fetch modules:', err);
    } finally {
      setModulesLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;

    const socket = io(config.backend_url, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000
    });

    socket.on('connect', () => {
      console.log('[Agent Battles] Socket connected');
    });

    socket.on('disconnect', (reason) => {
      console.log('[Agent Battles] Socket disconnected:', reason);
    });

    socket.on('reconnect', (attemptNumber) => {
      console.log('[Agent Battles] Socket reconnected after', attemptNumber, 'attempts');
      // Refresh modules in case we missed any unlocks
      fetchModules();
    });

    socket.on('reconnect_failed', () => {
      console.error('[Agent Battles] Socket reconnection failed');
    });

    socket.on('module-unlocked', ({ module }) => {
      if (!module?.id) return;

      setModuleUnlockQueue(prev => [...prev, module]);
      fetchModules();
    });

    return () => {
      socket.close();
    };
  }, [token]);

  useEffect(() => {
    if (activeModuleUnlock || moduleUnlockQueue.length === 0) return;

    const [nextUnlock, ...remaining] = moduleUnlockQueue;
    setModuleUnlockQueue(remaining);
    setActiveModuleUnlock(nextUnlock);

    confetti({
      particleCount: 70,
      spread: 65,
      origin: { y: 0.2 }
    });
  }, [activeModuleUnlock, moduleUnlockQueue]);

  useEffect(() => {
    if (!activeModuleUnlock) return;

    const timer = setTimeout(() => {
      setActiveModuleUnlock(null);
    }, 6000);

    return () => clearTimeout(timer);
  }, [activeModuleUnlock]);

  useEffect(() => {
    const savedLanguage = localStorage.getItem('codearena-agent-language');
    const savedModel = localStorage.getItem('codearena-agent-model');
    if (savedLanguage) {
      const isValidLanguage = LANGUAGES.some(lang => lang.id === savedLanguage);
      if (isValidLanguage) setSelectedLanguage(savedLanguage);
    }
    if (savedModel) {
      const isValidModel = MODELS.some(model => model.id === savedModel);
      if (isValidModel) setSelectedModel(savedModel);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('codearena-agent-language', selectedLanguage);
    localStorage.setItem('codearena-agent-model', selectedModel);
  }, [selectedLanguage, selectedModel]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const toggleModule = (moduleId) => {
    const moduleItem = availableModules.find(m => m.id === moduleId);
    if (!moduleItem || !moduleItem.isUnlocked) return; // Can't select locked modules

    setSelectedModules(prev =>
      prev.includes(moduleId)
        ? prev.filter(id => id !== moduleId)
        : [...prev, moduleId]
    );
  };

  const fetchPublicLoadouts = async (page = 1) => {
    setLoadingPublic(true);
    setError('');
    try {
      const response = await authFetch(
        `${config.backend_url}/api/agent/loadouts/public?page=${page}&limit=12`
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to fetch public loadouts');
      setPublicLoadouts(data.loadouts);
      setCurrentPage(data.pagination.page);
      setTotalPages(data.pagination.totalPages);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingPublic(false);
    }
  };

  const fetchMyLoadouts = async () => {
    setLoadingMyLoadouts(true);
    setError('');
    try {
      const response = await authFetch(`${config.backend_url}/api/agent/loadouts`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to fetch loadouts');
      setMyLoadouts(data.loadouts);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMyLoadouts(false);
    }
  };

  const cloneLoadout = async (loadoutId) => {
    setIsLoading(true);
    setError('');
    try {
      const response = await authFetch(
        `${config.backend_url}/api/agent/loadouts/${loadoutId}/clone`,
        { method: 'POST' }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to clone loadout');
      await fetchMyLoadouts();
      setActiveTab('my-loadouts');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleLoadoutVisibility = async (loadoutId, currentlyPublic) => {
    setError('');
    try {
      const response = await authFetch(
        `${config.backend_url}/api/agent/loadouts/${loadoutId}/visibility`,
        { method: 'PUT', body: JSON.stringify({ isPublic: !currentlyPublic }) }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update visibility');
      await fetchMyLoadouts();
    } catch (err) {
      setError(err.message);
    }
  };

  const loadLoadout = (loadout) => {
    setSelectedModel(loadout.model);
    setSystemPrompt(loadout.system_prompt || loadout.systemPrompt || '');
    setSelectedLanguage(loadout.language);
    // Support both 'modules' (new) and 'tools' (legacy) field names
    const modules = loadout.modules || loadout.tools || [];
    // Parse if it's a JSON string (from DB)
    setSelectedModules(typeof modules === 'string' ? JSON.parse(modules) : modules);
    setActiveTab('build');
  };

  const handleTemplateSelect = (result) => {
    if (result.loadInBuilder) {
      // Load template settings into the builder
      setSelectedModel(result.model);
      setSystemPrompt(result.systemPrompt || '');
      setSelectedLanguage(result.language);
      setSelectedModules(result.modules || []);
      setShowTemplates(false);
    } else {
      // Template was cloned as a new loadout
      setShowTemplates(false);
      setActiveTab('my-loadouts');
      // Refresh loadouts
      fetchMyLoadouts();
    }
  };

  const fetchVersionHistory = async (loadoutId) => {
    setLoadingVersions(true);
    setError('');
    try {
      const response = await authFetch(`${config.backend_url}/api/agent/loadouts/${loadoutId}/versions`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to fetch version history');
      setLoadoutVersions(data.versions);
      setSelectedLoadoutForVersions({ id: loadoutId, name: data.loadoutName });
      setShowVersionsModal(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingVersions(false);
    }
  };

  const activateVersion = async (loadoutId, versionId) => {
    setError('');
    try {
      const response = await authFetch(
        `${config.backend_url}/api/agent/loadouts/${loadoutId}/versions/${versionId}/activate`,
        { method: 'POST' }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to activate version');
      await fetchVersionHistory(loadoutId);
      await fetchMyLoadouts();
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (activeTab === 'browse') fetchPublicLoadouts(1);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'my-loadouts' || activeTab === 'build') fetchMyLoadouts();
  }, [activeTab]);

  const fetchBattleHistory = async () => {
    setHistoryLoading(true);
    try {
      const response = await authFetch(`${config.backend_url}/api/agent/battles/recent`);
      if (!response.ok) throw new Error('Failed to load battle history');
      const data = await response.json();
      setBattleHistory(data.battles);
    } catch (err) {
      console.error('Error loading battle history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'history') fetchBattleHistory();
  }, [activeTab]);

  // Fetch rivalries
  const fetchRivalries = async () => {
    setRivalriesLoading(true);
    try {
      const response = await authFetch(`${config.backend_url}/api/agent/rivalries?limit=20`);
      if (!response.ok) throw new Error('Failed to load rivalries');
      const data = await response.json();
      setRivalries(data.rivalries || []);
    } catch (err) {
      console.error('Error loading rivalries:', err);
    } finally {
      setRivalriesLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'rivalries') fetchRivalries();
  }, [activeTab]);

  // Fetch training problems
  const fetchTrainingProblems = async () => {
    if (!token) return;
    setLoadingTrainingProblems(true);
    try {
      const response = await authFetch(`${config.backend_url}/api/agent/training/problems`);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load training problems');
      }

      setTrainingProblems(data.problems && typeof data.problems === 'object' ? data.problems : {});
    } catch (err) {
      console.error('Error loading training problems:', err);
      setError(err.message);
    } finally {
      setLoadingTrainingProblems(false);
    }
  };

  // Fetch training history
  const fetchTrainingHistory = async () => {
    if (!token) return;
    try {
      const response = await authFetch(`${config.backend_url}/api/agent/training/history?limit=10`);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load training history');
      }

      setTrainingHistory(Array.isArray(data.runs) ? data.runs : []);
      setTrainingStats(data.stats || null);
    } catch (err) {
      console.error('Error loading training history:', err);
    }
  };

  // Load training data when training tab is opened
  useEffect(() => {
    if (activeTab === 'training' && token) {
      fetchTrainingProblems();
      fetchTrainingHistory();
    }
  }, [activeTab, token]);

  // Run training
  const runTraining = async (problemId) => {
    setRunningTraining(true);
    setError('');
    setTrainingResult(null);

    try {
      const response = await authFetch(`${config.backend_url}/api/agent/training/run`, {
        method: 'POST',
        body: JSON.stringify({
          problemId,
          loadout: {
            model: selectedModel,
            systemPrompt,
            language: selectedLanguage,
            tools: selectedModules
          }
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Training run failed');
      }

      setTrainingResult(data);
      // Refresh history
      await fetchTrainingHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunningTraining(false);
    }
  };

  const saveLoadout = async () => {
    if (!loadoutName.trim()) {
      setError('Please enter a loadout name');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const response = await authFetch(`${config.backend_url}/api/agent/loadouts`, {
        method: 'POST',
        body: JSON.stringify({
          name: loadoutName,
          description: loadoutDescription,
          model: selectedModel,
          systemPrompt,
          language: selectedLanguage,
          modules: selectedModules
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save loadout');
      setShowSaveDialog(false);
      setLoadoutName('');
      setLoadoutDescription('');
      await fetchMyLoadouts();
      setActiveTab('my-loadouts');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const testAgent = async () => {
    setIsLoading(true);
    setError('');
    setTestResult(null);
    try {
      const response = await authFetch(`${config.backend_url}/api/agent/test-run`, {
        method: 'POST',
        body: JSON.stringify({
          problemId: 'two-sum',
          loadout: {
            model: selectedModel,
            systemPrompt,
            language: selectedLanguage,
            modules: selectedModules
          }
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Test failed');
      setTestResult(data.result);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const startBattle = () => {
    router.push({
      pathname: '/agent-matchmaking',
      query: {
        model: selectedModel,
        language: selectedLanguage,
        modules: selectedModules.join(','),
        prompt: encodeURIComponent(systemPrompt)
      }
    });
  };

  const tabs = [
    { id: 'build', label: 'Build' },
    { id: 'browse', label: 'Browse' },
    { id: 'my-loadouts', label: 'My Loadouts' },
    { id: 'history', label: 'History' },
  ];

  const ActiveUnlockIcon = activeModuleUnlock
    ? (MODULE_ICONS[activeModuleUnlock.id] || Code)
    : Code;

  return (
    <>
      <Head>
        <title>Agent Battles - CodeArena</title>
        <meta name="description" content="Build AI agents and battle them against other players' agents in real-time coding challenges." />
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">
        <AnimatePresence>
          {activeModuleUnlock && (
            <motion.div
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.96 }}
              className="fixed top-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))]"
            >
              <div className="rounded-2xl border border-success/30 bg-surface-900/95 p-4 shadow-2xl backdrop-blur">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-success/10">
                    <ActiveUnlockIcon className="h-5 w-5 text-success" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-success">
                      Module Unlocked
                    </div>
                    <div className="mt-1 text-base font-semibold text-white">
                      {activeModuleUnlock.name}
                    </div>
                    <div className="mt-1 text-sm text-surface-400">
                      {activeModuleUnlock.description}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={() => {
                          setActiveTab('build');
                          setActiveModuleUnlock(null);
                        }}
                        className="rounded-lg border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success transition-colors hover:bg-success/15"
                      >
                        Equip Now
                      </button>
                      <button
                        onClick={() => setActiveModuleUnlock(null)}
                        className="rounded-lg border border-surface-700 px-3 py-1.5 text-xs font-medium text-surface-400 transition-colors hover:border-surface-600 hover:text-surface-200"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="max-w-6xl mx-auto px-6 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <Link href="/modes" className="flex items-center gap-2 text-surface-400 hover:text-white transition-colors group">
              <ArrowLeft className="h-5 w-5 group-hover:-translate-x-1 transition-transform" />
              <span className="font-medium">Back</span>
            </Link>

            <div className="flex items-center space-x-2">
              <span className="text-base font-semibold">Agent Battles</span>
              <span className="px-1.5 py-0.5 text-[10px] bg-surface-800 text-surface-400 rounded font-medium">BETA</span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => router.push('/agent-battles/live')}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-sm border border-surface-700 rounded-lg text-surface-400 hover:text-surface-200 hover:border-surface-600 transition-colors"
              >
                <div className="w-1.5 h-1.5 bg-error rounded-full animate-pulse" />
                <span className="hidden sm:inline">Live</span>
              </button>
              <button
                onClick={() => router.push('/agent-leaderboard')}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-sm border border-surface-700 rounded-lg text-surface-400 hover:text-surface-200 hover:border-surface-600 transition-colors"
              >
                <span>Leaderboard</span>
              </button>
            </div>
          </div>

          {/* Hero */}
          <div className="text-center mb-10">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
              Build Your AI Agent
            </h1>
            <p className="text-surface-500 text-sm max-w-xl mx-auto">
              Configure your agent's model, modules, and strategy. Then battle against other players' agents in real-time coding challenges.
            </p>
          </div>

          {/* Season Info */}
          {currentSeason?.season && (
            <div className="mb-8 p-4 bg-surface-900/60 border border-surface-800 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm text-white">{currentSeason.season.name}</div>
                  <div className="flex items-center space-x-3 mt-1 text-xs text-surface-500">
                    <span className="flex items-center space-x-1">
                      <Clock className="h-3 w-3" />
                      <span>{currentSeason.season.daysRemaining} days left</span>
                    </span>
                    {currentSeason.userRanking && (
                      <span>Rank #{currentSeason.userRanking.current_rank}</span>
                    )}
                  </div>
                </div>
                <div className="hidden md:flex items-center space-x-3">
                  <div className="flex items-center space-x-2 text-xs text-surface-500">
                    <span className="px-2 py-0.5 bg-surface-800 rounded">1st: +500 ELO</span>
                    <span className="px-2 py-0.5 bg-surface-800 rounded">Badges</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.push('/agent-leaderboard')}
                  >
                    Leaderboard
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Tab Navigation */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="flex lg:justify-center mb-8 overflow-x-auto scrollbar-hide -mx-3 px-3"
          >
            <div className="inline-flex bg-surface-900/50 rounded-lg p-1 border border-surface-700 whitespace-nowrap mx-auto">
              <button
                onClick={() => setActiveTab('build')}
                className={`
                  px-6 py-2 rounded-md text-sm font-medium transition-all
                  ${activeTab === 'build'
                    ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20'
                    : 'text-surface-400 hover:text-white'
                  }
                `}
              >
                Build
              </button>
              <button
                onClick={() => setActiveTab('browse')}
                className={`
                  px-6 py-2 rounded-md text-sm font-medium transition-all flex items-center space-x-1
                  ${activeTab === 'browse'
                    ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20'
                    : 'text-surface-400 hover:text-white'
                  }
                `}
              >
                <Globe className="h-4 w-4" />
                <span>Browse Loadouts</span>
              </button>
              <button
                onClick={() => setActiveTab('my-loadouts')}
                className={`
                  px-6 py-2 rounded-md text-sm font-medium transition-all
                  ${activeTab === 'my-loadouts'
                    ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20'
                    : 'text-surface-400 hover:text-white'
                  }
                `}
              >
                My Loadouts
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`
                  px-6 py-2 rounded-md text-sm font-medium transition-all
                  ${activeTab === 'history'
                    ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20'
                    : 'text-surface-400 hover:text-white'
                  }
                `}
              >
                Battle History
              </button>
              <button
                onClick={() => setActiveTab('challenges')}
                className={`
                  px-6 py-2 rounded-md text-sm font-medium transition-all flex items-center space-x-1
                  ${activeTab === 'challenges'
                    ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20'
                    : 'text-surface-400 hover:text-white'
                  }
                `}
              >
                <Target className="h-4 w-4" />
                <span>Challenges</span>
              </button>
              <button
                onClick={() => setActiveTab('training')}
                className={`
                  px-6 py-2 rounded-md text-sm font-medium transition-all flex items-center space-x-1
                  ${activeTab === 'training'
                    ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20'
                    : 'text-surface-400 hover:text-white'
                  }
                `}
              >
                <TestTube className="h-4 w-4" />
                <span>Training</span>
              </button>
              <button
                onClick={() => setActiveTab('rivalries')}
                className={`
                  px-6 py-2 rounded-md text-sm font-medium transition-all flex items-center space-x-1
                  ${activeTab === 'rivalries'
                    ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20'
                    : 'text-surface-400 hover:text-white'
                  }
                `}
              >
                <Swords className="h-4 w-4" />
                <span>Rivals</span>
              </button>
              <button
                onClick={() => router.push('/agent-battles/live')}
                className="px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px border-transparent text-surface-500 hover:text-surface-300 flex items-center space-x-1.5"
              >
                <div className="w-1.5 h-1.5 bg-error rounded-full animate-pulse" />
                <span>Live</span>
              </button>
            </div>
          </motion.div>

          {/* Error Banner */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-error/10 border border-error/20 rounded-lg p-4 mb-6 flex items-start space-x-3"
              >
                <AlertCircle className="h-4 w-4 text-error flex-shrink-0 mt-0.5" />
                <span className="text-sm text-error-light">{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Build Tab */}
          {activeTab === 'build' && (
            <div className="space-y-6">
              {/* Quick Battle Card */}
              {myLoadouts.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="relative overflow-hidden rounded-xl border border-cyan-500/30 p-6"
                  style={{
                    background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Zap className="h-5 w-5 text-cyan-400" />
                        Jump Into Your First Battle
                      </h2>
                      <p className="text-sm text-surface-400 mt-1">
                        We&apos;ll set up a default agent for you, just click and go.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        router.push({
                          pathname: '/agent-matchmaking',
                          query: {
                            model: 'sonnet',
                            language: 'javascript',
                            modules: 'test-runner',
                            prompt: encodeURIComponent(PRESET_PROMPTS[0].prompt),
                            quickStart: 'true'
                          }
                        });
                      }}
                      className="flex-shrink-0 flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold text-white transition-all hover:scale-105"
                      style={{
                        background: 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)',
                        boxShadow: '0 0 20px rgba(6, 182, 212, 0.3)',
                      }}
                    >
                      <Zap className="h-4 w-4" />
                      Quick Battle
                    </button>
                  </div>
                  <p className="text-xs text-surface-500 mt-3">
                    Or customize your agent below to build your own loadout.
                  </p>
                </motion.div>
              ) : (
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      const latest = myLoadouts[0];
                      router.push({
                        pathname: '/agent-matchmaking',
                        query: {
                          model: latest?.model || selectedModel,
                          language: latest?.language || selectedLanguage,
                          modules: (latest?.modules || selectedModules).join?.(',') || latest?.modules || selectedModules.join(','),
                          prompt: encodeURIComponent(latest?.systemPrompt || systemPrompt),
                          quickStart: 'true'
                        }
                      });
                    }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:scale-105"
                    style={{
                      background: 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)',
                      boxShadow: '0 0 15px rgba(6, 182, 212, 0.2)',
                    }}
                  >
                    <Zap className="h-4 w-4" />
                    Quick Battle
                  </button>
                </div>
              )}

            <div className="grid lg:grid-cols-3 gap-8">
              {/* Left: Loadout Builder */}
              <div className="lg:col-span-2 space-y-6">
                {/* Template Picker - shows as collapsible section */}
                {showTemplates && (
                  <AgentTemplatePicker
                    onSelectTemplate={handleTemplateSelect}
                    onClose={() => setShowTemplates(false)}
                  />
                )}

                {/* Show templates button when hidden */}
                {!showTemplates && (
                  <button
                    onClick={() => setShowTemplates(true)}
                    className="w-full p-3 bg-surface-900/20 border border-surface-800/50 rounded-lg text-xs text-surface-500 hover:text-surface-300 hover:border-surface-700 transition-all flex items-center justify-center space-x-2"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Show Starter Templates</span>
                  </button>
                )}

                {/* Model Selection */}
                <div className="p-6 bg-surface-900/40 border border-surface-800 rounded-lg">
                  <h2 className="text-sm font-medium text-surface-300 uppercase tracking-wider mb-4">Model</h2>
                  <div className="grid grid-cols-3 gap-3">
                    {MODELS.map((model) => {
                      const isSelected = selectedModel === model.id;
                      const isLocked = model.tier === 'pro' && !user?.isPro;

                      return (
                        <button
                          key={model.id}
                          onClick={() => !isLocked && setSelectedModel(model.id)}
                          disabled={isLocked}
                          className={`relative p-4 rounded-lg border transition-all text-center ${
                            isSelected
                              ? `${model.selectedBorder} ${model.selectedBg}`
                              : 'border-surface-800 bg-surface-900/50 hover:border-surface-600'
                          } ${isLocked ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          {isLocked && (
                            <div className="absolute top-2 right-2 text-[10px] text-surface-500 font-medium">PRO</div>
                          )}
                          <div className={`text-lg font-semibold mb-0.5 ${isSelected ? model.accent : 'text-white'}`}>
                            {model.name}
                          </div>
                          <div className="text-xs text-surface-500">{model.description}</div>
                          {isSelected && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-primary-500 rounded-full flex items-center justify-center">
                              <Check className="h-2.5 w-2.5 text-white" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* System Prompt */}
                <div className="p-6 bg-surface-900/40 border border-surface-800 rounded-lg">
                  <h2 className="text-sm font-medium text-surface-300 uppercase tracking-wider mb-4">System Prompt</h2>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {PRESET_PROMPTS.map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() => setSystemPrompt(preset.prompt)}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                          systemPrompt === preset.prompt
                            ? 'border-primary-500/50 bg-primary-500/5 text-primary-400'
                            : 'border-surface-700 text-surface-500 hover:border-surface-600 hover:text-surface-300'
                        }`}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="Define your agent's behavior and strategy..."
                    rows={4}
                    className="w-full bg-surface-950 border border-surface-800 rounded-lg px-4 py-3 text-sm text-white placeholder-surface-600 focus:outline-none focus:border-surface-600 transition-colors resize-none"
                  />
                  <div className="flex justify-between mt-2 text-[11px] text-surface-600">
                    <span>This guides how your agent approaches problems</span>
                    <span>{systemPrompt.length} / 2000</span>
                  </div>
                </div>

                {/* Modules */}
                <div className="p-6 bg-surface-900/40 border border-surface-800 rounded-lg">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-2">
                      <h2 className="text-sm font-medium text-surface-300 uppercase tracking-wider">Modules</h2>
                      <span className="text-[11px] text-surface-600">select up to 2</span>
                    </div>
                    <span className="text-[11px] text-surface-500">
                      {availableModules.filter(m => m.isUnlocked).length}/{availableModules.length} unlocked
                    </span>
                  </div>
                  {modulesLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-surface-500" />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {availableModules.map((module) => {
                        const Icon = MODULE_ICONS[module.id] || Code;
                        const isSelected = selectedModules.includes(module.id);
                        const isLocked = !module.isUnlocked;
                        const isDisabled = isLocked || (!isSelected && selectedModules.length >= 2);

                        return (
                          <button
                            key={module.id}
                            onClick={() => !isDisabled && toggleModule(module.id)}
                            disabled={isDisabled}
                            className={`relative p-3 rounded-lg border transition-all text-left ${
                              isLocked
                                ? 'border-surface-800/50 bg-surface-900/30 opacity-60'
                                : isSelected
                                ? 'border-success/40 bg-success/5'
                                : 'border-surface-800 bg-surface-900/50'
                            } ${isDisabled && !isLocked ? 'opacity-30 cursor-not-allowed' : isLocked ? 'cursor-default' : 'cursor-pointer hover:border-surface-600'}`}
                          >
                            {isLocked && (
                              <div className="absolute top-2 right-2">
                                <Lock className="h-3 w-3 text-surface-600" />
                              </div>
                            )}
                            <Icon className={`h-4 w-4 mb-1.5 ${isLocked ? 'text-surface-600' : isSelected ? 'text-success' : 'text-surface-500'}`} />
                            <div className={`text-sm font-medium ${isLocked ? 'text-surface-500' : isSelected ? 'text-success' : 'text-white'}`}>
                              {module.name}
                            </div>
                            <div className="text-[11px] text-surface-600 mt-0.5 line-clamp-2">{module.description}</div>
                            {isLocked && module.unlockCondition && (
                              <div className="mt-2 pt-2 border-t border-surface-800/50">
                                <div className="text-[10px] text-surface-500">{module.unlockCondition.description}</div>
                                {module.progress && (
                                  <div className="mt-1">
                                    <div className="h-1 bg-surface-800 rounded-full overflow-hidden">
                                      <div
                                        className="h-full bg-primary-500/50 rounded-full transition-all"
                                        style={{ width: `${module.progress.percentage}%` }}
                                      />
                                    </div>
                                    <div className="text-[9px] text-surface-600 mt-0.5">
                                      {module.progress.current}/{module.progress.target}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Language */}
                <div className="p-6 bg-surface-900/40 border border-surface-800 rounded-lg">
                  <h2 className="text-sm font-medium text-surface-300 uppercase tracking-wider mb-4">Language</h2>
                  <div className="flex flex-wrap gap-2">
                    {LANGUAGES.map((lang) => (
                      <button
                        key={lang.id}
                        onClick={() => setSelectedLanguage(lang.id)}
                        className={`px-3 py-1.5 text-sm rounded-lg border transition-all ${
                          selectedLanguage === lang.id
                            ? 'border-primary-500/50 bg-primary-500/5 text-primary-400'
                            : 'border-surface-800 text-surface-500 hover:border-surface-600'
                        }`}
                      >
                        {lang.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right: Actions & Preview */}
              <div className="space-y-6">
                {/* Loadout Summary */}
                <div className="p-6 bg-surface-900/60 border border-surface-800 rounded-lg">
                  <h2 className="text-sm font-medium text-surface-300 uppercase tracking-wider mb-4">Your Loadout</h2>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-surface-500">Model</span>
                      <span className="text-white capitalize">{selectedModel}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-surface-500">Language</span>
                      <span className="text-white capitalize">{selectedLanguage}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-surface-500">Modules</span>
                      <span className="text-white">{selectedModules.length > 0 ? selectedModules.length : 'None'}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-surface-500">Prompt</span>
                      <span className="text-white">{systemPrompt.length > 0 ? `${systemPrompt.length} chars` : 'Empty'}</span>
                    </div>
                  </div>
                  <div className="border-t border-surface-800 mt-4 pt-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-surface-500">Est. cost/battle</span>
                      <span className="text-surface-300">
                        ~${selectedModel === 'opus' ? '0.15' : selectedModel === 'sonnet' ? '0.03' : '0.01'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="p-6 bg-surface-900/40 border border-surface-800 rounded-lg space-y-3">
                  {!showSaveDialog ? (
                    <>
                      <Button variant="secondary" fullWidth onClick={() => setShowSaveDialog(true)} size="sm">
                        Save Loadout
                      </Button>
                      <Button variant="secondary" fullWidth onClick={testAgent} loading={isLoading} disabled={isLoading} size="sm">
                        Test Agent
                      </Button>
                      <Button variant="primary" fullWidth onClick={startBattle} disabled={isLoading}>
                        Find Battle
                      </Button>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-surface-500 mb-1">Loadout Name</label>
                        <input
                          type="text"
                          value={loadoutName}
                          onChange={(e) => setLoadoutName(e.target.value)}
                          placeholder="e.g., Speed Demon"
                          className="w-full bg-surface-950 border border-surface-800 rounded-lg px-3 py-2 text-sm text-white placeholder-surface-600 focus:outline-none focus:border-surface-600 transition-colors"
                          maxLength={100}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-surface-500 mb-1">Description (optional)</label>
                        <textarea
                          value={loadoutDescription}
                          onChange={(e) => setLoadoutDescription(e.target.value)}
                          placeholder="What makes this loadout special?"
                          rows={3}
                          className="w-full bg-surface-950 border border-surface-800 rounded-lg px-3 py-2 text-sm text-white placeholder-surface-600 focus:outline-none focus:border-surface-600 transition-colors resize-none"
                          maxLength={500}
                        />
                      </div>
                      <div className="flex space-x-2">
                        <Button variant="ghost" fullWidth onClick={() => { setShowSaveDialog(false); setLoadoutName(''); setLoadoutDescription(''); }} size="sm">
                          Cancel
                        </Button>
                        <Button variant="primary" fullWidth onClick={saveLoadout} disabled={isLoading || !loadoutName.trim()} loading={isLoading} size="sm">
                          Save
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Test Results */}
                {testResult && (
                  <div className="p-6 bg-surface-900/40 border border-surface-800 rounded-lg">
                    <h3 className="text-sm font-medium text-surface-300 uppercase tracking-wider mb-4">Test Results</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-surface-500">Status</span>
                        <span className={testResult.success ? 'text-success' : 'text-warning'}>{testResult.success ? 'Passed' : 'Failed'}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-surface-500">Tests</span>
                        <span className="text-white">{testResult.passedCount}/{testResult.totalTests}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-surface-500">Time</span>
                        <span className="text-white">{testResult.executionTimeMs}ms</span>
                      </div>
                    </div>
                    {testResult.code && (
                      <div className="mt-4 pt-3 border-t border-surface-800">
                        <div className="text-[11px] text-surface-500 mb-2">Generated Code</div>
                        <pre className="bg-surface-950 rounded-lg p-3 text-xs text-emerald-400 overflow-auto max-h-40">
                          {testResult.code.slice(0, 500)}
                          {testResult.code.length > 500 && '...'}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                {/* Tips */}
                <div className="p-5 bg-surface-900/30 border border-surface-800/50 rounded-lg">
                  <h3 className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-3">Tips</h3>
                  <ul className="space-y-2 text-xs text-surface-500">
                    <li className="flex items-start space-x-2">
                      <span className="text-surface-600 mt-0.5">--</span>
                      <span>Haiku is fastest but may miss edge cases</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <span className="text-surface-600 mt-0.5">--</span>
                      <span>Test Runner helps catch bugs before submitting</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <span className="text-surface-600 mt-0.5">--</span>
                      <span>Auto Retry gives your agent a second chance</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            </div>
          )}

          {/* Browse Public Loadouts Tab */}
          {activeTab === 'browse' && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <h2 className="text-xl font-semibold mb-1">Browse Public Loadouts</h2>
                <p className="text-sm text-surface-500">Discover and clone loadouts from the community</p>
              </div>

              {loadingPublic ? (
                <div className="flex justify-center py-20">
                  <Loader2 className="h-6 w-6 text-surface-500 animate-spin" />
                </div>
              ) : publicLoadouts.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-sm text-surface-500">No public loadouts available yet</p>
                </div>
              ) : (
                <>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {publicLoadouts.map((loadout) => (
                      <div key={loadout.id} className="p-5 bg-surface-900/40 border border-surface-800 rounded-lg flex flex-col">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <h3 className="font-medium text-sm text-white mb-0.5">{loadout.name}</h3>
                            <div className="text-[11px] text-surface-500">{loadout.creator.username}</div>
                          </div>
                          <div className="text-xs text-surface-400 tabular-nums">{loadout.elo}</div>
                        </div>

                        {loadout.description && (
                          <p className="text-xs text-surface-500 mb-3 line-clamp-2">{loadout.description}</p>
                        )}

                        <div className="space-y-1.5 mb-4 flex-1 text-xs">
                          <div className="flex justify-between">
                            <span className="text-surface-600">Model</span>
                            <span className="text-surface-300 capitalize">{loadout.model}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-surface-600">Language</span>
                            <span className="text-surface-300 capitalize">{loadout.language}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-surface-600">Win Rate</span>
                            <span className={`font-medium ${
                              loadout.winRate >= 60 ? 'text-success' :
                              loadout.winRate >= 40 ? 'text-warning' : 'text-error'
                            }`}>{loadout.winRate}%</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-surface-600">Record</span>
                            <span className="text-surface-400">{loadout.wins}W - {loadout.losses}L</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-surface-600">Clones</span>
                            <span className="text-surface-400">{loadout.timesCloned}</span>
                          </div>
                        </div>

                        <Button variant="secondary" fullWidth onClick={() => cloneLoadout(loadout.id)} disabled={isLoading} size="sm">
                          Clone Loadout
                        </Button>
                      </div>
                    ))}
                  </div>

                  {totalPages > 1 && (
                    <div className="flex justify-center items-center space-x-2 mt-6">
                      <Button variant="ghost" size="sm" onClick={() => fetchPublicLoadouts(currentPage - 1)} disabled={currentPage === 1 || loadingPublic}>
                        Previous
                      </Button>
                      <span className="text-surface-500 text-sm">Page {currentPage} of {totalPages}</span>
                      <Button variant="ghost" size="sm" onClick={() => fetchPublicLoadouts(currentPage + 1)} disabled={currentPage === totalPages || loadingPublic}>
                        Next
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* My Loadouts Tab */}
          {activeTab === 'my-loadouts' && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <h2 className="text-xl font-semibold mb-1">My Loadouts</h2>
                <p className="text-sm text-surface-500">Manage your saved agent configurations</p>
              </div>

              {loadingMyLoadouts ? (
                <div className="flex justify-center py-20">
                  <Loader2 className="h-6 w-6 text-surface-500 animate-spin" />
                </div>
              ) : myLoadouts.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-sm text-surface-500 mb-4">No saved loadouts yet</p>
                  <Button variant="primary" size="sm" onClick={() => setActiveTab('build')}>
                    Create Your First Loadout
                  </Button>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {myLoadouts.map((loadout) => (
                    <div key={loadout.id} className="p-5 bg-surface-900/40 border border-surface-800 rounded-lg flex flex-col">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="font-medium text-sm text-white flex-1">{loadout.name}</h3>
                        <button
                          onClick={() => toggleLoadoutVisibility(loadout.id, loadout.isPublic)}
                          className={`p-1 rounded transition-colors ${
                            loadout.isPublic ? 'text-success hover:text-success/80' : 'text-surface-600 hover:text-surface-400'
                          }`}
                          title={loadout.isPublic ? 'Public' : 'Private'}
                        >
                          {loadout.isPublic ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                        </button>
                      </div>

                      {loadout.description && (
                        <p className="text-xs text-surface-500 mb-3 line-clamp-2">{loadout.description}</p>
                      )}

                      <div className="space-y-1.5 mb-4 flex-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-surface-600">Model</span>
                          <span className="text-surface-300 capitalize">{loadout.model}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-surface-600">Language</span>
                          <span className="text-surface-300 capitalize">{loadout.language}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-surface-600">Win Rate</span>
                          <span className={`font-medium ${
                            loadout.winRate >= 60 ? 'text-success' :
                            loadout.winRate >= 40 ? 'text-warning' : 'text-error'
                          }`}>{loadout.winRate}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-surface-600">Record</span>
                          <span className="text-surface-400">{loadout.wins}W - {loadout.losses}L</span>
                        </div>
                        {loadout.isPublic && (
                          <div className="flex justify-between">
                            <span className="text-surface-600">Clones</span>
                            <span className="text-surface-400">{loadout.timesCloned}</span>
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Button variant="secondary" fullWidth onClick={() => loadLoadout(loadout)} size="sm">
                          Load in Builder
                        </Button>
                        <Button variant="ghost" fullWidth onClick={() => fetchVersionHistory(loadout.id)} size="sm">
                          Version History
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Battle History Tab */}
          {activeTab === 'history' && (
            <div className="space-y-6">
              <div className="p-6 bg-surface-900/40 border border-surface-800 rounded-lg">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-base font-semibold">Recent Battles</h2>
                  <button
                    onClick={fetchBattleHistory}
                    className="text-surface-500 hover:text-surface-300 transition-colors"
                    disabled={historyLoading}
                  >
                    <RotateCcw className={`h-4 w-4 ${historyLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {historyLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 text-surface-500 animate-spin" />
                  </div>
                ) : battleHistory.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-sm text-surface-500 mb-4">No battles yet</p>
                    <Button variant="primary" size="sm" onClick={() => setActiveTab('build')}>
                      Start Your First Battle
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {battleHistory.map((battle) => {
                      const modelInfo = MODELS.find(m => m.id === battle.opponent.loadout.model) || MODELS[1];

                      return (
                        <div
                          key={battle.id}
                          className={`p-4 border rounded-lg cursor-pointer transition-colors hover:border-surface-600 ${
                            battle.isWinner ? 'bg-success/3 border-success/15' : 'bg-error/3 border-error/15'
                          }`}
                          onClick={() => router.push(`/agent-replay/${battle.id}`)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-4 flex-1">
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${
                                battle.isWinner ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
                              }`}>
                                {battle.isWinner ? 'W' : 'L'}
                              </div>

                              <div className="flex-1">
                                <div className="flex items-center space-x-2 mb-0.5">
                                  <span className="text-sm font-medium text-white">
                                    {battle.isWinner ? 'Victory' : 'Defeat'}
                                  </span>
                                  <span className="text-xs text-surface-600">vs</span>
                                  <span className="text-sm text-surface-400">{battle.opponent.username}</span>
                                </div>

                                <div className="flex items-center space-x-3 text-xs text-surface-500">
                                  <span className="capitalize">{battle.opponent.loadout.model}</span>
                                  <span>{battle.userLoadout.language}</span>
                                  <span className={
                                    battle.eloChange > 0 ? 'text-success' : battle.eloChange < 0 ? 'text-error' : ''
                                  }>
                                    {battle.eloChange > 0 ? '+' : ''}{battle.eloChange} ELO
                                  </span>
                                </div>

                                <div className="text-[11px] text-surface-600 mt-0.5">
                                  {new Date(battle.createdAt).toLocaleDateString()} at {new Date(battle.createdAt).toLocaleTimeString()}
                                </div>
                              </div>
                            </div>

                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/agent-replay/${battle.id}`);
                              }}
                            >
                              Replay
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {battleHistory.length > 0 && (
                <div className="p-6 bg-surface-900/40 border border-surface-800 rounded-lg">
                  <h3 className="text-sm font-medium text-surface-300 uppercase tracking-wider mb-4">Recent Performance</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-semibold text-success mb-0.5 tabular-nums">
                        {battleHistory.filter(b => b.isWinner).length}
                      </div>
                      <div className="text-xs text-surface-500">Wins</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-semibold text-error mb-0.5 tabular-nums">
                        {battleHistory.filter(b => !b.isWinner).length}
                      </div>
                      <div className="text-xs text-surface-500">Losses</div>
                    </div>
                    <div className="text-center">
                      <div className={`text-2xl font-semibold mb-0.5 tabular-nums ${
                        battleHistory.filter(b => b.isWinner).length / battleHistory.length >= 0.5
                          ? 'text-success' : 'text-warning'
                      }`}>
                        {((battleHistory.filter(b => b.isWinner).length / battleHistory.length) * 100).toFixed(0)}%
                      </div>
                      <div className="text-xs text-surface-500">Win Rate</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Rivals Tab */}
          {activeTab === 'rivalries' && (
            <div className="space-y-6">
              <div className="p-6 bg-surface-900/40 border border-surface-800 rounded-lg">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-base font-semibold flex items-center gap-2">
                    <Swords className="h-5 w-5 text-primary-400" />
                    Your Rivals
                  </h2>
                  <button
                    onClick={fetchRivalries}
                    className="text-surface-500 hover:text-surface-300 transition-colors"
                    disabled={rivalriesLoading}
                  >
                    <RotateCcw className={`h-4 w-4 ${rivalriesLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {rivalriesLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 text-surface-500 animate-spin" />
                  </div>
                ) : rivalries.length === 0 ? (
                  <div className="text-center py-12">
                    <Swords className="h-10 w-10 text-surface-700 mx-auto mb-3" />
                    <p className="text-sm text-surface-400 mb-1">No rivals yet</p>
                    <p className="text-xs text-surface-600 mb-4">Battle other players to build rivalries</p>
                    <Button variant="primary" size="sm" onClick={() => setActiveTab('build')}>
                      Find a Battle
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {rivalries.map((rival) => {
                      const total = rival.userWins + rival.opponentWins + rival.draws;
                      const winRate = total > 0 ? ((rival.userWins / total) * 100).toFixed(0) : 0;
                      const isAhead = rival.userWins > rival.opponentWins;
                      const isTied = rival.userWins === rival.opponentWins;

                      return (
                        <div
                          key={rival.opponentId}
                          className={`p-4 border rounded-lg transition-colors ${
                            isAhead ? 'bg-success/3 border-success/15' : isTied ? 'bg-surface-800/50 border-surface-700' : 'bg-error/3 border-error/15'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-4 flex-1">
                              <div className="w-10 h-10 rounded-lg bg-surface-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                                {rival.opponentAvatar ? (
                                  <img src={rival.opponentAvatar} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <span className="text-sm font-bold text-surface-400">
                                    {(rival.opponentUsername || '?')[0].toUpperCase()}
                                  </span>
                                )}
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="text-sm font-medium text-white truncate">{rival.opponentUsername}</span>
                                  {rival.totalBattles >= 10 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium">Nemesis</span>
                                  )}
                                  {rival.totalBattles >= 5 && rival.totalBattles < 10 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary-500/15 text-primary-400 font-medium">Rival</span>
                                  )}
                                </div>

                                <div className="flex items-center gap-4 text-xs">
                                  <span className="text-surface-400">{rival.totalBattles} battles</span>
                                  <span className="flex items-center gap-1">
                                    <span className="text-success">{rival.userWins}W</span>
                                    <span className="text-surface-600">-</span>
                                    <span className="text-error">{rival.opponentWins}L</span>
                                    {rival.draws > 0 && (
                                      <>
                                        <span className="text-surface-600">-</span>
                                        <span className="text-surface-400">{rival.draws}D</span>
                                      </>
                                    )}
                                  </span>
                                  <span className={`font-medium ${isAhead ? 'text-success' : isTied ? 'text-surface-400' : 'text-error'}`}>
                                    {winRate}% win rate
                                  </span>
                                </div>

                                <div className="text-[11px] text-surface-600 mt-0.5">
                                  Last battle: {new Date(rival.lastBattleAt).toLocaleDateString()}
                                  {rival.userWonLast ? '. You won' : '. They won'}
                                </div>
                              </div>
                            </div>

                            <div className={`text-sm font-bold px-3 py-1 rounded-md ${
                              isAhead ? 'bg-success/10 text-success' : isTied ? 'bg-surface-700 text-surface-400' : 'bg-error/10 text-error'
                            }`}>
                              {isAhead ? 'Ahead' : isTied ? 'Tied' : 'Behind'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Challenges Tab */}
          {activeTab === 'challenges' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="max-w-4xl mx-auto"
            >
              <AgentChallenges
                onChallengeCompleted={(reward) => {
                  // Optional: Show a toast notification or update UI
                  console.log('Challenge completed!', reward);
                }}
              />
            </motion.div>
          )}

          {/* Training Tab */}
          {activeTab === 'training' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
              <div className="text-center mb-6">
                <h2 className="text-2xl font-bold mb-2">Agent Training Mode</h2>
                <p className="text-surface-400">
                  Test your agent against specific problems without affecting your ELO rating
                </p>
              </div>

              {/* Stats Overview */}
              {trainingStats && (
                <Card variant="gradient" className="p-6">
                  <h3 className="font-semibold mb-4">Training Stats</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-primary-400">{trainingStats.totalRuns}</div>
                      <div className="text-sm text-surface-400">Total Runs</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-success">{trainingStats.totalSolved}</div>
                      <div className="text-sm text-surface-400">Problems Solved</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-warning">{trainingStats.totalTestsPassed}</div>
                      <div className="text-sm text-surface-400">Tests Passed</div>
                    </div>
                    <div className="text-center">
                      <div className={`text-2xl font-bold ${
                        trainingStats.averageSuccessRate >= 70 ? 'text-success' :
                        trainingStats.averageSuccessRate >= 40 ? 'text-warning' :
                        'text-error'
                      }`}>
                        {trainingStats.averageSuccessRate}%
                      </div>
                      <div className="text-sm text-surface-400">Success Rate</div>
                    </div>
                  </div>
                </Card>
              )}

              <div className="grid lg:grid-cols-3 gap-6">
                {/* Left: Problem Selection */}
                <div className="lg:col-span-2 space-y-6">
                  <Card variant="glass" className="p-6">
                    <h3 className="font-semibold mb-4 flex items-center space-x-2">
                      <BookOpen className="h-5 w-5 text-primary-400" />
                      <span>Select Problem</span>
                    </h3>

                    {/* Difficulty Filter */}
                    <div className="flex space-x-2 mb-4">
                      {['easy', 'medium', 'hard', 'prompt-engineering'].map((diff) => (
                        <button
                          key={diff}
                          onClick={() => setSelectedDifficulty(diff)}
                          className={`
                            px-4 py-2 rounded-lg border transition-all capitalize
                            ${selectedDifficulty === diff
                              ? 'border-primary-500 bg-primary-500/10 text-primary-400'
                              : 'border-surface-700 text-surface-400 hover:border-surface-500'
                            }
                          `}
                        >
                          {diff.replace('-', ' ')}
                        </button>
                      ))}
                    </div>

                    {/* Problem List */}
                    {loadingTrainingProblems ? (
                      <div className="flex justify-center py-12">
                        <Loader2 className="h-8 w-8 text-primary-500 animate-spin" />
                      </div>
                    ) : trainingProblems?.[selectedDifficulty]?.length > 0 ? (
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {trainingProblems[selectedDifficulty].map((problem) => (
                          <motion.button
                            key={problem.id}
                            whileHover={{ scale: 1.01 }}
                            onClick={() => setSelectedProblem(problem)}
                            className={`
                              w-full text-left p-4 rounded-lg border transition-all
                              ${selectedProblem?.id === problem.id
                                ? 'border-primary-500 bg-primary-500/10'
                                : 'border-surface-700 hover:border-surface-500 bg-surface-800/50'
                              }
                            `}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="font-medium text-white">{problem.title}</div>
                                <div className="text-sm text-surface-400 mt-1 line-clamp-2">
                                  {problem.description}
                                </div>
                                <div className="flex items-center space-x-3 mt-2 text-xs text-surface-500">
                                  <span className="flex items-center space-x-1">
                                    <TestTube className="h-3 w-3" />
                                    <span>{problem.testCaseCount} tests</span>
                                  </span>
                                </div>
                              </div>
                              {selectedProblem?.id === problem.id && (
                                <Check className="h-5 w-5 text-primary-400 flex-shrink-0 ml-3" />
                              )}
                            </div>
                          </motion.button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12 text-surface-400">
                        No problems available for this difficulty
                      </div>
                    )}
                  </Card>

                  {/* Training Result */}
                  {trainingResult && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      <Card variant="glass" className="p-6">
                        <h3 className="font-semibold mb-4 flex items-center space-x-2">
                          {trainingResult.success ? (
                            <Check className="h-5 w-5 text-success" />
                          ) : (
                            <X className="h-5 w-5 text-error" />
                          )}
                          <span>Training Result</span>
                        </h3>

                        <div className="space-y-4">
                          <div className="flex justify-between items-center">
                            <span className="text-surface-400">Problem</span>
                            <span className="text-white font-medium">{trainingResult.problem.title}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-surface-400">Status</span>
                            <span className={trainingResult.success ? 'text-success' : 'text-error'}>
                              {trainingResult.success ? 'Passed' : 'Failed'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-surface-400">Tests</span>
                            <span className="text-white">
                              {trainingResult.passedCount}/{trainingResult.totalTests}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-surface-400">Execution Time</span>
                            <span className="text-white">{trainingResult.executionTimeMs}ms</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-surface-400">Tokens Used</span>
                            <span className="text-white">{trainingResult.tokensUsed}</span>
                          </div>

                          {trainingResult.errorMessage && (
                            <div className="pt-3 border-t border-surface-700">
                              <div className="text-xs text-surface-400 mb-2">Error:</div>
                              <div className="text-sm text-error bg-error/10 rounded-lg p-3">
                                {trainingResult.errorMessage}
                              </div>
                            </div>
                          )}

                          {trainingResult.code && (
                            <div className="pt-3 border-t border-surface-700">
                              <div className="text-xs text-surface-400 mb-2">Generated Code:</div>
                              <pre className="bg-surface-900 rounded-lg p-3 text-xs text-green-400 overflow-auto max-h-60">
                                {trainingResult.code}
                              </pre>
                            </div>
                          )}

                          {trainingResult.testResults && trainingResult.testResults.length > 0 && (
                            <div className="pt-3 border-t border-surface-700">
                              <div className="text-xs text-surface-400 mb-2">Test Results:</div>
                              <div className="space-y-2">
                                {trainingResult.testResults.map((test, idx) => (
                                  <div
                                    key={idx}
                                    className={`flex items-center justify-between p-2 rounded ${
                                      test.passed ? 'bg-success/10' : 'bg-error/10'
                                    }`}
                                  >
                                    <span className="text-sm">Test {idx + 1}</span>
                                    <span className={`text-sm ${test.passed ? 'text-success' : 'text-error'}`}>
                                      {test.passed ? 'Passed' : 'Failed'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </Card>
                    </motion.div>
                  )}
                </div>

                {/* Right: Actions & History */}
                <div className="space-y-6">
                  {/* Current Loadout */}
                  <Card variant="gradient" className="p-6">
                    <h3 className="font-semibold mb-4">Current Loadout</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-surface-400">Model</span>
                        <span className="text-white capitalize">{selectedModel}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-surface-400">Language</span>
                        <span className="text-white capitalize">{selectedLanguage}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-surface-400">Tools</span>
                        <span className="text-white">{selectedModules.length}</span>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-surface-700">
                      <Button
                        variant="primary"
                        fullWidth
                        icon={Play}
                        onClick={() => selectedProblem && runTraining(selectedProblem.id)}
                        disabled={!selectedProblem || runningTraining}
                        loading={runningTraining}
                        className="bg-gradient-to-r from-success to-emerald-600"
                      >
                        Run Training
                      </Button>
                    </div>
                  </Card>

                  {/* Info */}
                  <Card variant="glass" className="p-6">
                    <h3 className="font-semibold mb-3 text-sm text-surface-300">Training Mode</h3>
                    <ul className="space-y-2 text-xs text-surface-400">
                      <li className="flex items-start space-x-2">
                        <Check className="h-3 w-3 mt-0.5 text-success flex-shrink-0" />
                        <span>No ELO rating changes</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <Check className="h-3 w-3 mt-0.5 text-success flex-shrink-0" />
                        <span>Practice specific problem types</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <Check className="h-3 w-3 mt-0.5 text-success flex-shrink-0" />
                        <span>See detailed test results</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <Check className="h-3 w-3 mt-0.5 text-success flex-shrink-0" />
                        <span>Track improvement over time</span>
                      </li>
                    </ul>
                  </Card>

                  {/* Recent Training Runs */}
                  {Array.isArray(trainingHistory) && trainingHistory.length > 0 && (
                    <Card variant="glass" className="p-6">
                      <h3 className="font-semibold mb-4 text-sm">Recent Runs</h3>
                      <div className="space-y-2">
                        {trainingHistory.slice(0, 5).map((run) => (
                          <div
                            key={run.id}
                            className="flex items-center justify-between p-2 bg-surface-800/50 rounded"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-surface-300 truncate">
                                {run.results?.[0]?.problem_title || 'Training Run'}
                              </div>
                              <div className="text-xs text-surface-500">
                                {new Date(run.created_at).toLocaleDateString()}
                              </div>
                            </div>
                            <div className={`text-xs px-2 py-1 rounded ${
                              run.problems_solved > 0
                                ? 'bg-success/10 text-success'
                                : 'bg-error/10 text-error'
                            }`}>
                              {run.problems_solved > 0 ? 'Pass' : 'Fail'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}
                </div>
              </div>
            </motion.div>
          )}


          {/* Version History Modal */}
          <AnimatePresence>
            {showVersionsModal && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
                onClick={() => setShowVersionsModal(false)}
              >
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-surface-900 rounded-lg border border-surface-800 max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col"
                >
                  <div className="flex items-center justify-between p-5 border-b border-surface-800">
                    <div>
                      <h2 className="text-base font-semibold">Version History</h2>
                      <p className="text-xs text-surface-500 mt-0.5">{selectedLoadoutForVersions?.name}</p>
                    </div>
                    <button
                      onClick={() => setShowVersionsModal(false)}
                      className="p-1.5 hover:bg-surface-800 rounded-lg transition-colors"
                    >
                      <X className="h-4 w-4 text-surface-500" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-5">
                    {loadingVersions ? (
                      <div className="flex justify-center py-12">
                        <Loader2 className="h-6 w-6 text-surface-500 animate-spin" />
                      </div>
                    ) : loadoutVersions.length === 0 ? (
                      <div className="text-center py-12">
                        <p className="text-sm text-surface-500">No version history available</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {loadoutVersions.map((version, index) => (
                          <div
                            key={version.id}
                            className={`p-4 border rounded-lg ${
                              version.isActive
                                ? 'border-primary-500/40 bg-primary-500/3'
                                : 'border-surface-800'
                            }`}
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex items-center space-x-3">
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                                  version.isActive
                                    ? 'bg-primary-500/20 text-primary-400'
                                    : 'bg-surface-800 text-surface-500'
                                }`}>
                                  v{version.versionNumber}
                                </div>
                                <div>
                                  <div className="flex items-center space-x-2">
                                    <span className="text-sm font-medium">Version {version.versionNumber}</span>
                                    {version.isActive && (
                                      <span className="px-1.5 py-0.5 text-[10px] bg-primary-500/10 text-primary-400 rounded font-medium">
                                        Active
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-surface-600 mt-0.5">
                                    {new Date(version.createdAt).toLocaleString()}
                                  </div>
                                </div>
                              </div>
                              {!version.isActive && (
                                <Button variant="ghost" size="sm" onClick={() => activateVersion(selectedLoadoutForVersions.id, version.id)}>
                                  Activate
                                </Button>
                              )}
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                              <div>
                                <div className="text-[11px] text-surface-600">Model</div>
                                <div className="text-sm font-medium capitalize">{version.model}</div>
                              </div>
                              <div>
                                <div className="text-[11px] text-surface-600">Language</div>
                                <div className="text-sm font-medium capitalize">{version.language}</div>
                              </div>
                              <div>
                                <div className="text-[11px] text-surface-600">Record</div>
                                <div className="text-sm font-medium">{version.wins}W - {version.losses}L</div>
                              </div>
                              <div>
                                <div className="text-[11px] text-surface-600">Win Rate</div>
                                <div className={`text-sm font-medium ${
                                  version.winRate >= 60 ? 'text-success' :
                                  version.winRate >= 40 ? 'text-warning' : 'text-error'
                                }`}>
                                  {version.winRate}%
                                </div>
                              </div>
                            </div>

                            {version.systemPrompt && (
                              <details className="mt-3">
                                <summary className="cursor-pointer text-xs text-primary-400 hover:text-primary-300">
                                  View System Prompt
                                </summary>
                                <div className="mt-2 p-3 bg-surface-950 rounded-lg">
                                  <pre className="text-xs text-surface-400 whitespace-pre-wrap break-words">
                                    {version.systemPrompt}
                                  </pre>
                                </div>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}

const AgentPage = withAuth(AgentBattles);
export default function AgentPageGated(props) {
  return <AgentBattlesGate><AgentPage {...props} /></AgentBattlesGate>
}
