import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  ChevronRight,
  Loader2,
  Play,
  Trophy,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Brain,
  Sparkles,
  BarChart3,
  History,
  Settings,
  AlertCircle,
  FileText,
  Target
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { config } from '../../config/env';
import FloatingOrbs from '../../components/ui/FloatingOrbs';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import withAuth from '../../components/withAuth';
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

function AgentTraining() {
  const router = useRouter();
  const { token, user } = useAuth();

  const [activeTab, setActiveTab] = useState('new'); // 'new', 'history', 'stats'
  const [loadouts, setLoadouts] = useState([]);
  const [selectedLoadout, setSelectedLoadout] = useState(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState('');
  const [trainingHistory, setTrainingHistory] = useState([]);
  const [trainingStats, setTrainingStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');
  const [currentTraining, setCurrentTraining] = useState(null);

  // Fetch loadouts
  const fetchLoadouts = async () => {
    if (!token) return;

    try {
      const response = await fetch(`${config.backend_url}/api/agent/loadouts`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch loadouts');
      }

      setLoadouts(data.loadouts || []);
    } catch (err) {
      console.error('Error fetching loadouts:', err);
      setError(err.message);
    }
  };

  // Fetch training history
  const fetchTrainingHistory = async () => {
    if (!token) return;

    try {
      const response = await fetch(`${config.backend_url}/api/agent/training/history`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch training history');
      }

      setTrainingHistory(data.runs || []);
    } catch (err) {
      console.error('Error fetching training history:', err);
      setError(err.message);
    }
  };

  // Fetch training stats
  const fetchTrainingStats = async () => {
    if (!token) return;

    try {
      const response = await fetch(`${config.backend_url}/api/agent/training/stats`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch training stats');
      }

      setTrainingStats(data);
    } catch (err) {
      console.error('Error fetching training stats:', err);
      setError(err.message);
    }
  };

  // Initialize
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([
        fetchLoadouts(),
        fetchTrainingHistory(),
        fetchTrainingStats()
      ]);
      setLoading(false);
    };

    init();
  }, [token]);

  // Start training
  const startTraining = async () => {
    if (!selectedLoadout) {
      setError('Please select a loadout');
      return;
    }

    if (!selectedDifficulty) {
      setError('Please select a difficulty');
      return;
    }

    setError('');
    setExecuting(true);

    try {
      // Start training run
      const startResponse = await fetch(`${config.backend_url}/api/agent/training/start`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          loadoutId: selectedLoadout.id,
          difficulty: selectedDifficulty
        })
      });

      const startData = await startResponse.json();

      if (!startResponse.ok) {
        throw new Error(startData.error || 'Failed to start training');
      }

      const trainingRunId = startData.trainingRunId;

      // Execute training run
      const executeResponse = await fetch(
        `${config.backend_url}/api/agent/training/${trainingRunId}/execute`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const executeData = await executeResponse.json();

      if (!executeResponse.ok) {
        throw new Error(executeData.error || 'Failed to execute training');
      }

      setCurrentTraining(executeData);

      // Refresh data
      await Promise.all([
        fetchTrainingHistory(),
        fetchTrainingStats()
      ]);
    } catch (err) {
      console.error('Error executing training:', err);
      setError(err.message);
    } finally {
      setExecuting(false);
    }
  };

  const viewTrainingDetails = (runId) => {
    router.push(`/agent-battles/training/${runId}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-950 text-white flex items-center justify-center">
        <FloatingOrbs />
        <Loader2 className="h-12 w-12 text-primary-400 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Agent Training Mode - CodeArena</title>
        <meta name="description" content="Train your AI agents without affecting ELO ratings" />
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">
        <FloatingOrbs />

        <div className="relative z-10 max-w-7xl mx-auto px-6 py-8">
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
          </motion.div>

          {/* Hero */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-center mb-10"
          >
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              <span className="bg-gradient-to-r from-primary-400 to-cyan-500 bg-clip-text text-transparent">
                Training Mode
              </span>
            </h1>
            <p className="text-surface-400 text-lg max-w-2xl mx-auto">
              Test your agents against problem sets without affecting ELO ratings. Track performance metrics and identify areas for improvement.
            </p>
          </motion.div>

          {/* Tabs */}
          <div className="flex space-x-2 mb-6 border-b border-surface-800">
            <button
              onClick={() => setActiveTab('new')}
              className={`px-6 py-3 font-medium transition-colors ${
                activeTab === 'new'
                  ? 'text-primary-400 border-b-2 border-primary-400'
                  : 'text-surface-400 hover:text-white'
              }`}
            >
              <Play className="h-4 w-4 inline mr-2" />
              New Training
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-6 py-3 font-medium transition-colors ${
                activeTab === 'history'
                  ? 'text-primary-400 border-b-2 border-primary-400'
                  : 'text-surface-400 hover:text-white'
              }`}
            >
              <History className="h-4 w-4 inline mr-2" />
              History
            </button>
            <button
              onClick={() => setActiveTab('stats')}
              className={`px-6 py-3 font-medium transition-colors ${
                activeTab === 'stats'
                  ? 'text-primary-400 border-b-2 border-primary-400'
                  : 'text-surface-400 hover:text-white'
              }`}
            >
              <BarChart3 className="h-4 w-4 inline mr-2" />
              Statistics
            </button>
          </div>

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-error/10 border border-error/30 rounded-xl p-4 mb-6 text-error flex items-start space-x-3"
            >
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </motion.div>
          )}

          {/* New Training Tab */}
          {activeTab === 'new' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {/* Loadout Selection */}
              <Card variant="glass" className="p-6">
                <h3 className="text-xl font-bold mb-4 flex items-center">
                  <Settings className="h-5 w-5 mr-2 text-primary-400" />
                  Select Agent Loadout
                </h3>

                {loadouts.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-surface-400 mb-4">You don't have any agent loadouts yet.</p>
                    <Button variant="primary" onClick={() => router.push('/agent-battles')}>
                      Create Loadout
                    </Button>
                  </div>
                ) : (
                  <div className="grid md:grid-cols-2 gap-4">
                    {loadouts.map((loadout) => {
                      const modelInfo = MODEL_INFO[loadout.model] || MODEL_INFO.sonnet;
                      const ModelIcon = modelInfo.icon;
                      const isSelected = selectedLoadout?.id === loadout.id;

                      return (
                        <button
                          key={loadout.id}
                          onClick={() => setSelectedLoadout(loadout)}
                          className={`p-4 rounded-lg border-2 transition-all text-left ${
                            isSelected
                              ? 'border-primary-400 bg-primary-400/10'
                              : 'border-surface-700 hover:border-surface-600 bg-surface-900/50'
                          }`}
                        >
                          <div className="flex items-start space-x-3">
                            <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${modelInfo.color} flex items-center justify-center flex-shrink-0`}>
                              <ModelIcon className="h-6 w-6 text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-bold text-white mb-1 truncate">{loadout.name}</h4>
                              <div className="flex items-center space-x-2 text-xs">
                                <span className={modelInfo.textColor}>{modelInfo.name}</span>
                                <span className="text-surface-600">•</span>
                                <span className="text-surface-400 uppercase">{loadout.language}</span>
                              </div>
                              <div className="flex items-center space-x-2 text-xs text-surface-400 mt-1">
                                <Trophy className="h-3 w-3" />
                                <span>ELO: {loadout.elo || 1000}</span>
                                <span className="text-surface-600">•</span>
                                <span>{loadout.wins || 0}W/{loadout.losses || 0}L</span>
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* Difficulty Selection */}
              <Card variant="glass" className="p-6">
                <h3 className="text-xl font-bold mb-4 flex items-center">
                  <Target className="h-5 w-5 mr-2 text-primary-400" />
                  Select Difficulty
                </h3>

                <div className="grid grid-cols-3 gap-4">
                  {['easy', 'medium', 'hard'].map((difficulty) => (
                    <button
                      key={difficulty}
                      onClick={() => setSelectedDifficulty(difficulty)}
                      className={`p-6 rounded-lg border-2 transition-all ${
                        selectedDifficulty === difficulty
                          ? 'border-primary-400 bg-primary-400/10'
                          : 'border-surface-700 hover:border-surface-600 bg-surface-900/50'
                      }`}
                    >
                      <div className="text-center">
                        <div className={`text-2xl font-bold mb-1 capitalize ${DIFFICULTY_COLORS[difficulty]}`}>
                          {difficulty}
                        </div>
                        <div className="text-sm text-surface-400">
                          {difficulty === 'easy' && 'Warm up your agent'}
                          {difficulty === 'medium' && 'Standard practice'}
                          {difficulty === 'hard' && 'Challenge mode'}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </Card>

              {/* Start Training Button */}
              <div className="flex justify-center">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={startTraining}
                  disabled={!selectedLoadout || !selectedDifficulty || executing}
                  className="min-w-[300px]"
                >
                  {executing ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Training in Progress...
                    </>
                  ) : (
                    <>
                      <Play className="h-5 w-5 mr-2" />
                      Start Training
                    </>
                  )}
                </Button>
              </div>

              {/* Current Training Results */}
              {currentTraining && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                >
                  <Card variant="gradient" className="p-6">
                    <h3 className="text-2xl font-bold mb-6 text-center">Training Complete!</h3>

                    {/* Summary Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      <div className="text-center p-4 bg-surface-900/50 rounded-lg">
                        <div className="text-3xl font-bold text-success mb-1">
                          {currentTraining.summary.problemsSolved}
                        </div>
                        <div className="text-sm text-surface-400">Solved</div>
                      </div>
                      <div className="text-center p-4 bg-surface-900/50 rounded-lg">
                        <div className="text-3xl font-bold text-primary-400 mb-1">
                          {currentTraining.summary.successRate}%
                        </div>
                        <div className="text-sm text-surface-400">Success Rate</div>
                      </div>
                      <div className="text-center p-4 bg-surface-900/50 rounded-lg">
                        <div className="text-3xl font-bold text-warning mb-1">
                          {currentTraining.summary.totalTestsPassed}
                        </div>
                        <div className="text-sm text-surface-400">Tests Passed</div>
                      </div>
                      <div className="text-center p-4 bg-surface-900/50 rounded-lg">
                        <div className="text-3xl font-bold text-surface-400 mb-1">
                          {(currentTraining.summary.totalExecutionTime / 1000).toFixed(1)}s
                        </div>
                        <div className="text-sm text-surface-400">Total Time</div>
                      </div>
                    </div>

                    {/* Results List */}
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {currentTraining.results.map((result, index) => (
                        <div
                          key={index}
                          className={`p-3 rounded-lg flex items-center justify-between ${
                            result.success
                              ? 'bg-success/10 border border-success/30'
                              : 'bg-error/10 border border-error/30'
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            {result.success ? (
                              <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
                            ) : (
                              <XCircle className="h-5 w-5 text-error flex-shrink-0" />
                            )}
                            <div>
                              <div className="font-medium text-white">{result.problemTitle}</div>
                              {result.error && (
                                <div className="text-xs text-error mt-1">{result.error}</div>
                              )}
                            </div>
                          </div>
                          {result.testsPassed !== undefined && (
                            <div className="text-sm text-surface-400">
                              {result.testsPassed}/{result.totalTests} tests
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="mt-6 text-center">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setCurrentTraining(null);
                          setActiveTab('history');
                        }}
                      >
                        View Full Details
                      </Button>
                    </div>
                  </Card>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {trainingHistory.length === 0 ? (
                <Card variant="glass" className="p-12 text-center">
                  <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-surface-800 to-surface-700 flex items-center justify-center">
                    <History className="h-10 w-10 text-surface-500" />
                  </div>
                  <h2 className="text-2xl font-bold mb-2">No Training History</h2>
                  <p className="text-surface-400 mb-6">
                    Start your first training session to see results here.
                  </p>
                  <Button variant="primary" onClick={() => setActiveTab('new')}>
                    Start Training
                  </Button>
                </Card>
              ) : (
                <div className="space-y-4">
                  {trainingHistory.map((run) => (
                    <Card
                      key={run.id}
                      variant="glass"
                      className="p-6 cursor-pointer hover:border-primary-500/50 transition-all"
                      onClick={() => viewTrainingDetails(run.id)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3 mb-2">
                            <h3 className="text-lg font-bold text-white">{run.loadout_name}</h3>
                            <span className={`px-2 py-1 rounded text-xs font-medium capitalize ${
                              run.status === 'completed'
                                ? 'bg-success/20 text-success'
                                : run.status === 'running'
                                ? 'bg-warning/20 text-warning'
                                : 'bg-error/20 text-error'
                            }`}>
                              {run.status}
                            </span>
                          </div>

                          <div className="flex items-center space-x-4 text-sm text-surface-400 mb-3">
                            <div className="flex items-center space-x-1">
                              <Bot className="h-4 w-4" />
                              <span className="capitalize">{run.loadout_model}</span>
                            </div>
                            <span>•</span>
                            <div className="flex items-center space-x-1">
                              <Target className="h-4 w-4" />
                              <span className="capitalize">{run.difficulty_filter || 'All'}</span>
                            </div>
                            <span>•</span>
                            <div className="flex items-center space-x-1">
                              <Clock className="h-4 w-4" />
                              <span>{new Date(run.started_at).toLocaleDateString()}</span>
                            </div>
                          </div>

                          <div className="grid grid-cols-4 gap-3">
                            <div>
                              <div className="text-xs text-surface-400">Solved</div>
                              <div className="text-lg font-bold text-success">
                                {run.problems_solved}/{run.total_problems}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-surface-400">Success Rate</div>
                              <div className="text-lg font-bold text-primary-400">
                                {run.successRate}%
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-surface-400">Tests Passed</div>
                              <div className="text-lg font-bold text-warning">
                                {run.total_tests_passed}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-surface-400">Time</div>
                              <div className="text-lg font-bold text-surface-300">
                                {(run.total_execution_time_ms / 1000).toFixed(1)}s
                              </div>
                            </div>
                          </div>
                        </div>

                        <ChevronRight className="h-6 w-6 text-surface-400" />
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* Stats Tab */}
          {activeTab === 'stats' && trainingStats && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {/* Overall Stats */}
              <Card variant="gradient" className="p-6">
                <h3 className="text-2xl font-bold mb-6">Overall Training Statistics</h3>
                <div className="grid md:grid-cols-4 gap-4">
                  <div className="text-center p-4 bg-surface-900/50 rounded-lg">
                    <div className="text-3xl font-bold text-primary-400 mb-1">
                      {trainingStats.overall.totalRuns}
                    </div>
                    <div className="text-sm text-surface-400">Total Runs</div>
                  </div>
                  <div className="text-center p-4 bg-surface-900/50 rounded-lg">
                    <div className="text-3xl font-bold text-success mb-1">
                      {trainingStats.overall.overallSuccessRate}%
                    </div>
                    <div className="text-sm text-surface-400">Success Rate</div>
                  </div>
                  <div className="text-center p-4 bg-surface-900/50 rounded-lg">
                    <div className="text-3xl font-bold text-warning mb-1">
                      {trainingStats.overall.totalProblemsSolved}
                    </div>
                    <div className="text-sm text-surface-400">Problems Solved</div>
                  </div>
                  <div className="text-center p-4 bg-surface-900/50 rounded-lg">
                    <div className="text-3xl font-bold text-surface-300 mb-1">
                      {trainingStats.overall.totalTestsPassed}
                    </div>
                    <div className="text-sm text-surface-400">Tests Passed</div>
                  </div>
                </div>
              </Card>

              {/* Stats by Difficulty */}
              <Card variant="glass" className="p-6">
                <h3 className="text-xl font-bold mb-4 flex items-center">
                  <BarChart3 className="h-5 w-5 mr-2 text-primary-400" />
                  Performance by Difficulty
                </h3>
                <div className="space-y-4">
                  {trainingStats.byDifficulty.map((stat) => (
                    <div key={stat.difficulty} className="p-4 bg-surface-900/50 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-lg font-bold capitalize ${DIFFICULTY_COLORS[stat.difficulty] || 'text-surface-400'}`}>
                          {stat.difficulty}
                        </span>
                        <span className="text-primary-400 font-bold">{stat.successRate}%</span>
                      </div>
                      <div className="w-full bg-surface-800 rounded-full h-2 mb-2">
                        <div
                          className="bg-gradient-to-r from-primary-500 to-cyan-500 h-2 rounded-full transition-all"
                          style={{ width: `${stat.successRate}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-sm text-surface-400">
                        <span>{stat.totalSolved}/{stat.totalAttempted} solved</span>
                        <span>Avg: {(stat.avgExecutionTime / 1000).toFixed(1)}s</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Stats by Loadout */}
              {trainingStats.byLoadout.length > 0 && (
                <Card variant="glass" className="p-6">
                  <h3 className="text-xl font-bold mb-4 flex items-center">
                    <TrendingUp className="h-5 w-5 mr-2 text-primary-400" />
                    Performance by Loadout
                  </h3>
                  <div className="space-y-3">
                    {trainingStats.byLoadout.map((stat, index) => {
                      const modelInfo = MODEL_INFO[stat.model] || MODEL_INFO.sonnet;
                      const ModelIcon = modelInfo.icon;

                      return (
                        <div key={stat.loadoutId} className="p-4 bg-surface-900/50 rounded-lg">
                          <div className="flex items-center space-x-3 mb-3">
                            <div className="text-xl font-bold text-surface-400 w-8">
                              #{index + 1}
                            </div>
                            <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${modelInfo.color} flex items-center justify-center flex-shrink-0`}>
                              <ModelIcon className="h-5 w-5 text-white" />
                            </div>
                            <div className="flex-1">
                              <div className="font-bold text-white">{stat.loadoutName}</div>
                              <div className="text-xs text-surface-400 capitalize">{stat.model}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-2xl font-bold text-primary-400">
                                {stat.avgSuccessRate}%
                              </div>
                              <div className="text-xs text-surface-400">{stat.runs} runs</div>
                            </div>
                          </div>
                          <div className="text-sm text-surface-400">
                            {stat.problemsSolved}/{stat.problemsAttempted} problems solved
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </>
  );
}

const AgentPage = withAuth(AgentTraining);
export default function AgentPageGated(props) {
  return <AgentBattlesGate><AgentPage {...props} /></AgentBattlesGate>
}
