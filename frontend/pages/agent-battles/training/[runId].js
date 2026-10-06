import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import {
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Brain,
  Sparkles,
  BarChart3,
  AlertCircle,
  Code,
  FileText,
  TrendingUp,
  Target
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { config } from '../../../config/env';
import FloatingOrbs from '../../../components/ui/FloatingOrbs';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import withAuth from '../../../components/withAuth';
import AgentBattlesGate from '../../../components/AgentBattlesGate'

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

function TrainingRunDetails() {
  const router = useRouter();
  const { runId } = router.query;
  const { token } = useAuth();

  const [trainingRun, setTrainingRun] = useState(null);
  const [results, setResults] = useState([]);
  const [statsByDifficulty, setStatsByDifficulty] = useState({});
  const [failurePatterns, setFailurePatterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedResult, setSelectedResult] = useState(null);

  useEffect(() => {
    if (!runId || !token) return;

    const fetchTrainingRun = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${config.backend_url}/api/agent/training/${runId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch training run');
        }

        setTrainingRun(data.trainingRun);
        setResults(data.results || []);
        setStatsByDifficulty(data.statsByDifficulty || {});
        setFailurePatterns(data.failurePatterns || []);
      } catch (err) {
        console.error('Error fetching training run:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchTrainingRun();
  }, [runId, token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-950 text-white flex items-center justify-center">
        <FloatingOrbs />
        <Loader2 className="h-12 w-12 text-primary-400 animate-spin" />
      </div>
    );
  }

  if (error || !trainingRun) {
    return (
      <div className="min-h-screen bg-surface-950 text-white">
        <FloatingOrbs />
        <div className="relative z-10 max-w-4xl mx-auto px-6 py-20">
          <Card variant="glass" className="p-12 text-center">
            <AlertCircle className="h-16 w-16 text-error mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Error Loading Training Run</h2>
            <p className="text-surface-400 mb-6">{error || 'Training run not found'}</p>
            <Button variant="primary" onClick={() => router.push('/agent-battles/training')}>
              Back to Training
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  const modelInfo = MODEL_INFO[trainingRun.loadoutModel] || MODEL_INFO.sonnet;
  const ModelIcon = modelInfo.icon;

  return (
    <>
      <Head>
        <title>Training Run Details - CodeArena</title>
        <meta name="description" content="View detailed results of your agent training run" />
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
              onClick={() => router.push('/agent-battles/training')}
              className="flex items-center space-x-2 text-surface-400 hover:text-white transition-colors"
            >
              <ChevronRight className="h-5 w-5 rotate-180" />
              <span>Back to Training</span>
            </button>
          </motion.div>

          {/* Hero Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card variant="gradient" className="p-6 mb-6">
              <div className="flex items-start space-x-4">
                <div className={`w-16 h-16 rounded-xl bg-gradient-to-br ${modelInfo.color} flex items-center justify-center flex-shrink-0`}>
                  <ModelIcon className="h-8 w-8 text-white" />
                </div>
                <div className="flex-1">
                  <h1 className="text-3xl font-bold mb-2">{trainingRun.loadoutName}</h1>
                  <div className="flex items-center space-x-4 text-surface-400">
                    <div className="flex items-center space-x-1">
                      <span className={modelInfo.textColor}>{modelInfo.name}</span>
                    </div>
                    <span>•</span>
                    <div className="flex items-center space-x-1">
                      <span className="uppercase">{trainingRun.loadoutLanguage}</span>
                    </div>
                    <span>•</span>
                    <div className="flex items-center space-x-1">
                      <Target className="h-4 w-4" />
                      <span className="capitalize">{trainingRun.difficultyFilter || 'All Difficulties'}</span>
                    </div>
                    <span>•</span>
                    <div className="flex items-center space-x-1">
                      <Clock className="h-4 w-4" />
                      <span>{new Date(trainingRun.startedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-4xl font-bold text-primary-400 mb-1">
                    {trainingRun.successRate}%
                  </div>
                  <div className="text-sm text-surface-400">Success Rate</div>
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Summary Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="grid md:grid-cols-4 gap-4 mb-6"
          >
            <Card variant="glass" className="p-4">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 rounded-lg bg-success/20 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6 text-success" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">
                    {trainingRun.problemsSolved}/{trainingRun.totalProblems}
                  </div>
                  <div className="text-sm text-surface-400">Problems Solved</div>
                </div>
              </div>
            </Card>

            <Card variant="glass" className="p-4">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 rounded-lg bg-warning/20 flex items-center justify-center">
                  <Target className="h-6 w-6 text-warning" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">{trainingRun.totalTestsPassed}</div>
                  <div className="text-sm text-surface-400">Tests Passed</div>
                </div>
              </div>
            </Card>

            <Card variant="glass" className="p-4">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 rounded-lg bg-error/20 flex items-center justify-center">
                  <XCircle className="h-6 w-6 text-error" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">{trainingRun.totalTestsFailed}</div>
                  <div className="text-sm text-surface-400">Tests Failed</div>
                </div>
              </div>
            </Card>

            <Card variant="glass" className="p-4">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 rounded-lg bg-primary-500/20 flex items-center justify-center">
                  <Clock className="h-6 w-6 text-primary-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">
                    {(trainingRun.totalExecutionTime / 1000).toFixed(1)}s
                  </div>
                  <div className="text-sm text-surface-400">Total Time</div>
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Stats by Difficulty */}
          {Object.keys(statsByDifficulty).length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="mb-6"
            >
              <Card variant="glass" className="p-6">
                <h3 className="text-xl font-bold mb-4 flex items-center">
                  <BarChart3 className="h-5 w-5 mr-2 text-primary-400" />
                  Performance by Difficulty
                </h3>
                <div className="space-y-4">
                  {Object.entries(statsByDifficulty).map(([difficulty, stats]) => {
                    const successRate = stats.total > 0 ? ((stats.solved / stats.total) * 100).toFixed(1) : 0;
                    const testPassRate = stats.totalTests > 0 ? ((stats.testsPassed / stats.totalTests) * 100).toFixed(1) : 0;

                    return (
                      <div key={difficulty} className="p-4 bg-surface-900/50 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-lg font-bold capitalize ${DIFFICULTY_COLORS[difficulty] || 'text-surface-400'}`}>
                            {difficulty}
                          </span>
                          <span className="text-primary-400 font-bold">{successRate}%</span>
                        </div>
                        <div className="w-full bg-surface-800 rounded-full h-2 mb-2">
                          <div
                            className="bg-gradient-to-r from-primary-500 to-cyan-500 h-2 rounded-full transition-all"
                            style={{ width: `${successRate}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-sm text-surface-400">
                          <span>{stats.solved}/{stats.total} solved</span>
                          <span>{stats.testsPassed}/{stats.totalTests} tests ({testPassRate}%)</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </motion.div>
          )}

          {/* Failure Patterns */}
          {failurePatterns.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="mb-6"
            >
              <Card variant="glass" className="p-6">
                <h3 className="text-xl font-bold mb-4 flex items-center">
                  <AlertCircle className="h-5 w-5 mr-2 text-error" />
                  Common Failure Patterns
                </h3>
                <div className="space-y-3">
                  {failurePatterns.map((pattern, index) => (
                    <div key={index} className="p-4 bg-error/10 border border-error/30 rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="font-bold text-white">{pattern.problemTitle}</h4>
                          <div className="flex items-center space-x-2 text-sm text-surface-400 mt-1">
                            <span className={`capitalize ${DIFFICULTY_COLORS[pattern.difficulty]}`}>
                              {pattern.difficulty}
                            </span>
                            <span>•</span>
                            <span>ID: {pattern.problemId}</span>
                          </div>
                        </div>
                        <div className="text-right text-sm">
                          <div className="text-error font-bold">
                            {pattern.testsPassed}/{pattern.totalTests} tests
                          </div>
                        </div>
                      </div>
                      {pattern.errorMessage && (
                        <div className="text-sm text-error/80 mt-2 font-mono bg-surface-950/50 p-2 rounded">
                          {pattern.errorMessage}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </motion.div>
          )}

          {/* Detailed Results */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <Card variant="glass" className="p-6">
              <h3 className="text-xl font-bold mb-4 flex items-center">
                <FileText className="h-5 w-5 mr-2 text-primary-400" />
                All Results ({results.length})
              </h3>
              <div className="space-y-2">
                {results.map((result, index) => (
                  <div key={index}>
                    <button
                      onClick={() => setSelectedResult(selectedResult?.problem_id === result.problem_id ? null : result)}
                      className={`w-full p-4 rounded-lg flex items-center justify-between transition-all ${
                        result.success
                          ? 'bg-success/10 border border-success/30 hover:bg-success/20'
                          : 'bg-error/10 border border-error/30 hover:bg-error/20'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        {result.success ? (
                          <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
                        ) : (
                          <XCircle className="h-5 w-5 text-error flex-shrink-0" />
                        )}
                        <div className="text-left">
                          <div className="font-medium text-white">{result.problem_title}</div>
                          <div className="flex items-center space-x-2 text-xs text-surface-400 mt-1">
                            <span className={`capitalize ${DIFFICULTY_COLORS[result.problem_difficulty]}`}>
                              {result.problem_difficulty}
                            </span>
                            <span>•</span>
                            <span>{result.tests_passed}/{result.total_tests} tests</span>
                            <span>•</span>
                            <span>{(result.execution_time_ms / 1000).toFixed(2)}s</span>
                            {result.tokens_used > 0 && (
                              <>
                                <span>•</span>
                                <span>{result.tokens_used} tokens</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className={`h-5 w-5 text-surface-400 transition-transform ${
                        selectedResult?.problem_id === result.problem_id ? 'rotate-90' : ''
                      }`} />
                    </button>

                    {selectedResult?.problem_id === result.problem_id && result.code_generated && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-2 p-4 bg-surface-950 rounded-lg border border-surface-700"
                      >
                        <div className="flex items-center space-x-2 mb-2">
                          <Code className="h-4 w-4 text-primary-400" />
                          <h4 className="font-bold text-white">Generated Code</h4>
                        </div>
                        <pre className="text-sm text-surface-300 overflow-x-auto bg-surface-900 p-3 rounded">
                          <code>{result.code_generated}</code>
                        </pre>
                        {result.error_message && (
                          <div className="mt-3">
                            <div className="flex items-center space-x-2 mb-2">
                              <AlertCircle className="h-4 w-4 text-error" />
                              <h4 className="font-bold text-error">Error</h4>
                            </div>
                            <div className="text-sm text-error bg-error/10 p-3 rounded border border-error/30">
                              {result.error_message}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        </div>
      </div>
    </>
  );
}

const AgentPage = withAuth(TrainingRunDetails);
export default function AgentPageGated(props) {
  return <AgentBattlesGate><AgentPage {...props} /></AgentBattlesGate>
}
