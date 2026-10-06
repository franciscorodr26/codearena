import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  Trophy,
  X as XIcon,
  Clock,
  TrendingUp,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Eye
} from 'lucide-react';
import { config } from '../config/env';
import { authFetch } from '../utils/fetch';
import Button from './ui/Button';

function OutcomeBadge({ outcome }) {
  const styles = {
    win: 'bg-success/10 text-success border-success/20',
    loss: 'bg-error/10 text-error border-error/20',
    tie: 'bg-warning/10 text-warning border-warning/20'
  };

  const labels = {
    win: 'Victory',
    loss: 'Defeat',
    tie: 'Tie'
  };

  return (
    <span className={`px-2 py-0.5 text-[10px] font-medium rounded border ${styles[outcome] || styles.loss}`}>
      {labels[outcome] || outcome}
    </span>
  );
}

function BattleCard({ battle, onViewDetails }) {
  const formattedDate = new Date(battle.finishedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 bg-surface-900/40 border border-surface-800 rounded-lg hover:border-surface-700 transition-all"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center space-x-3">
          <OutcomeBadge outcome={battle.outcome} />
          <div>
            <div className="text-sm font-medium text-white">
              vs {battle.opponent.username}
            </div>
            <div className="text-[10px] text-surface-600">{formattedDate}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium tabular-nums">
            <span className={battle.myScore > battle.opponentScore ? 'text-success' : 'text-surface-300'}>
              {battle.myScore}%
            </span>
            <span className="text-surface-600 mx-1">-</span>
            <span className={battle.opponentScore > battle.myScore ? 'text-error' : 'text-surface-300'}>
              {battle.opponentScore}%
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3 text-[11px] text-surface-500">
          {battle.problemTitle && (
            <span className="truncate max-w-[150px]" title={battle.problemTitle}>
              {battle.problemTitle}
            </span>
          )}
          {battle.difficulty && (
            <span className={`capitalize ${
              battle.difficulty === 'hard' ? 'text-error' :
              battle.difficulty === 'medium' ? 'text-warning' : 'text-success'
            }`}>
              {battle.difficulty}
            </span>
          )}
          {battle.durationSec && (
            <span className="flex items-center space-x-1">
              <Clock className="h-3 w-3" />
              <span>{Math.floor(battle.durationSec / 60)}min</span>
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => onViewDetails(battle)} className="text-xs">
          <Eye className="h-3 w-3 mr-1" />
          Details
        </Button>
      </div>
    </motion.div>
  );
}

function BattleDetailModal({ battle, onClose }) {
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState(null);
  const [error, setError] = useState('');
  const [showMyPrompt, setShowMyPrompt] = useState(false);

  useEffect(() => {
    if (battle?.id) {
      fetchDetails();
    }
    // Fetch once per battle; fetchDetails only reads battle.id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.id]);

  const fetchDetails = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authFetch(`${config.backend_url}/api/prompt-battle/history/${battle.id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load details');
      setDetails(data.battle);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!battle) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-surface-900 border border-surface-700 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <div className="p-4 border-b border-surface-800 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <h3 className="font-semibold text-white">Battle Details</h3>
              <OutcomeBadge outcome={battle.outcome} />
            </div>
            <button
              onClick={onClose}
              className="p-1 text-surface-500 hover:text-white transition-colors"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="p-4 overflow-y-auto max-h-[calc(80vh-60px)]">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 text-surface-500 animate-spin" />
              </div>
            ) : error ? (
              <div className="text-center py-12">
                <p className="text-sm text-error">{error}</p>
                <Button variant="ghost" size="sm" onClick={fetchDetails} className="mt-2">
                  Try Again
                </Button>
              </div>
            ) : details ? (
              <div className="space-y-4">
                {/* Match Info */}
                <div className="grid grid-cols-2 gap-4 p-4 bg-surface-950/50 rounded-lg">
                  <div>
                    <div className="text-[11px] text-surface-500 mb-1">Problem</div>
                    <div className="text-sm font-medium">{details.problemTitle || 'Unknown'}</div>
                    {details.difficulty && (
                      <div className={`text-[10px] capitalize mt-0.5 ${
                        details.difficulty === 'hard' ? 'text-error' :
                        details.difficulty === 'medium' ? 'text-warning' : 'text-success'
                      }`}>
                        {details.difficulty}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-surface-500 mb-1">Duration</div>
                    <div className="text-sm font-medium">
                      {details.durationSec ? `${Math.floor(details.durationSec / 60)} minutes` : 'Unknown'}
                    </div>
                    <div className="text-[10px] text-surface-600 mt-0.5">
                      {new Date(details.finishedAt).toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Scores */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-surface-950/50 rounded-lg border border-surface-800">
                    <div className="text-[11px] text-surface-500 mb-2">Your Score</div>
                    <div className="flex items-baseline space-x-2">
                      <span className={`text-2xl font-bold ${
                        details.outcome === 'win' ? 'text-success' : 'text-surface-300'
                      }`}>
                        {Math.round((details.me?.adjustedScore || 0) * 10) / 10}%
                      </span>
                      {details.me?.submitCount > 1 && (
                        <span className="text-[10px] text-surface-600">
                          ({details.me.submitCount} submissions)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="p-4 bg-surface-950/50 rounded-lg border border-surface-800">
                    <div className="text-[11px] text-surface-500 mb-2">Opponent Score</div>
                    <div className="flex items-baseline space-x-2">
                      <span className={`text-2xl font-bold ${
                        details.outcome === 'loss' ? 'text-error' : 'text-surface-300'
                      }`}>
                        {Math.round((details.opponent?.adjustedScore || 0) * 10) / 10}%
                      </span>
                      {details.opponent?.submitCount > 1 && (
                        <span className="text-[10px] text-surface-600">
                          ({details.opponent.submitCount} submissions)
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Your Prompt */}
                {details.me?.prompt && (
                  <div className="p-4 bg-surface-950/50 rounded-lg border border-surface-800">
                    <button
                      onClick={() => setShowMyPrompt(!showMyPrompt)}
                      className="w-full flex items-center justify-between text-sm font-medium text-surface-300 hover:text-white transition-colors"
                    >
                      <span>Your Prompt</span>
                      {showMyPrompt ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                    {showMyPrompt && (
                      <pre className="mt-3 p-3 bg-surface-900 rounded text-xs text-surface-400 whitespace-pre-wrap overflow-x-auto">
                        {details.me.prompt}
                      </pre>
                    )}
                  </div>
                )}

                {/* Model Output */}
                {details.me?.modelOutput && (
                  <div className="p-4 bg-surface-950/50 rounded-lg border border-surface-800">
                    <div className="text-sm font-medium text-surface-300 mb-2">Model Output</div>
                    <pre className="p-3 bg-surface-900 rounded text-xs text-surface-400 whitespace-pre-wrap overflow-x-auto max-h-60">
                      {details.me.modelOutput}
                    </pre>
                  </div>
                )}

                {/* Token Usage */}
                {details.me?.tokenUsage && (
                  <div className="flex items-center space-x-4 text-[11px] text-surface-500 px-1">
                    <span>Input: {details.me.tokenUsage.inputTokens || 0} tokens</span>
                    <span>Output: {details.me.tokenUsage.outputTokens || 0} tokens</span>
                    <span>Total: {details.me.tokenUsage.totalTokens || 0} tokens</span>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default function PromptBattleHistory({ compact = false, limit = 10 }) {
  const [battles, setBattles] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({ offset: 0, limit, total: 0, hasMore: false });
  const [selectedBattle, setSelectedBattle] = useState(null);

  useEffect(() => {
    fetchHistory();
    // Initial page load only; later pages are fetched by the pager.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchHistory = async (offset = 0) => {
    setLoading(true);
    setError('');
    try {
      const response = await authFetch(
        `${config.backend_url}/api/prompt-battle/history?limit=${limit}&offset=${offset}`
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load history');

      if (offset === 0) {
        setBattles(data.battles);
      } else {
        setBattles(prev => [...prev, ...data.battles]);
      }
      setStats(data.stats);
      setPagination(data.pagination);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = () => {
    if (pagination.hasMore && !loading) {
      fetchHistory(pagination.offset + pagination.limit);
    }
  };

  if (loading && battles.length === 0) {
    return (
      <div className={`${compact ? 'p-4' : 'p-6'} bg-surface-900/40 border border-surface-800 rounded-lg`}>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 text-surface-500 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={`${compact ? 'p-4' : 'p-6'} bg-surface-900/40 border border-surface-800 rounded-lg`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <MessageSquare className="h-4 w-4 text-primary-400" />
            <h2 className="text-sm font-medium text-surface-300 uppercase tracking-wider">
              Prompt Battle History
            </h2>
          </div>
          {stats && (
            <div className="flex items-center space-x-3 text-[11px]">
              <span className="text-success">{stats.wins}W</span>
              <span className="text-error">{stats.losses}L</span>
              <span className="text-warning">{stats.ties}T</span>
              <span className="text-surface-500">({stats.winRate}%)</span>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 p-2 bg-error/10 border border-error/20 rounded text-xs text-error">
            {error}
          </div>
        )}

        {battles.length === 0 ? (
          <div className="text-center py-12">
            <MessageSquare className="h-8 w-8 text-surface-600 mx-auto mb-3" />
            <p className="text-sm text-surface-500">No prompt battles yet</p>
            <p className="text-xs text-surface-600 mt-1">
              Challenge someone to a prompt battle to see your history here
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {battles.map((battle) => (
              <BattleCard
                key={battle.id}
                battle={battle}
                onViewDetails={setSelectedBattle}
              />
            ))}

            {pagination.hasMore && (
              <div className="text-center pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadMore}
                  loading={loading}
                  className="text-xs"
                >
                  Load More ({pagination.total - battles.length} remaining)
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Battle Detail Modal */}
      {selectedBattle && (
        <BattleDetailModal
          battle={selectedBattle}
          onClose={() => setSelectedBattle(null)}
        />
      )}
    </>
  );
}
