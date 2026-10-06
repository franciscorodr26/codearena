import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Loader2,
  ChevronRight,
  TrendingUp,
  Calendar,
  Clock,
  ChevronDown,
  Activity
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { config } from '../config/env';
import { authFetch } from '../utils/fetch';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import withAuth from '../components/withAuth';
import AvatarDisplay from '../components/ui/AvatarDisplay';
import { LeaderboardSkeleton } from '../components/ui/Skeleton';
import EmptyState from '../components/EmptyState';
import AgentBattlesGate from '../components/AgentBattlesGate'

// Model labels — clean text, no emoji
const MODEL_LABELS = {
  haiku: { label: 'Haiku', color: 'text-emerald-400' },
  sonnet: { label: 'Sonnet', color: 'text-cyan-400' },
  opus: { label: 'Opus', color: 'text-violet-400' }
};

// Rank tier colors — muted
const getRankColor = (elo) => {
  if (elo >= 2200) return 'text-rose-400/80';
  if (elo >= 2000) return 'text-violet-400/80';
  if (elo >= 1800) return 'text-cyan-500/80';
  if (elo >= 1600) return 'text-blue-400/80';
  if (elo >= 1400) return 'text-amber-500';
  if (elo >= 1200) return 'text-surface-400';
  return 'text-amber-600';
};

const getRankBadge = (elo) => {
  if (elo >= 2200) return { name: 'Grandmaster', color: 'text-rose-400/80' };
  if (elo >= 2000) return { name: 'Master', color: 'text-violet-400/80' };
  if (elo >= 1800) return { name: 'Diamond', color: 'text-cyan-500/80' };
  if (elo >= 1600) return { name: 'Platinum', color: 'text-blue-400/80' };
  if (elo >= 1400) return { name: 'Gold', color: 'text-amber-500' };
  if (elo >= 1200) return { name: 'Silver', color: 'text-surface-400' };
  return { name: 'Bronze', color: 'text-amber-600' };
};

function AgentLeaderboard() {
  const router = useRouter();
  const { user, token } = useAuth();

  const [activeView, setActiveView] = useState('current');
  const [timeframe, setTimeframe] = useState('alltime');
  const [leaderboard, setLeaderboard] = useState([]);
  const [userRank, setUserRank] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedRows, setExpandedRows] = useState(new Set());

  const [currentSeason, setCurrentSeason] = useState(null);
  const [pastSeasons, setPastSeasons] = useState([]);
  const [selectedPastSeason, setSelectedPastSeason] = useState(null);
  const [pastSeasonData, setPastSeasonData] = useState(null);

  useEffect(() => {
    fetchCurrentSeason();
    if (activeView === 'current') {
      fetchLeaderboard();
    } else {
      fetchPastSeasons();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Revived agent battle page kept as originally written: this hook intentionally runs on the listed values only.
  }, [timeframe, activeView]);

  const fetchCurrentSeason = async () => {
    try {
      const response = await authFetch(
        `${config.backend_url}/api/agent/seasons/current`
      );
      const data = await response.json();
      if (response.ok) {
        setCurrentSeason(data.season);
      }
    } catch (err) {
      console.error('Failed to fetch current season:', err);
    }
  };

  const fetchLeaderboard = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authFetch(
        `${config.backend_url}/api/agent/leaderboard?timeframe=${timeframe}`
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch leaderboard');
      }
      setLeaderboard(data.leaderboard);
      setUserRank(data.userRank);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchPastSeasons = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authFetch(
        `${config.backend_url}/api/agent/seasons/history`
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch past seasons');
      }
      setPastSeasons(data.seasons);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchPastSeasonResults = async (seasonId) => {
    setLoading(true);
    setError('');
    try {
      const response = await authFetch(
        `${config.backend_url}/api/agent/seasons/${seasonId}/results`
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch season results');
      }
      setPastSeasonData(data);
      setSelectedPastSeason(seasonId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const claimRewards = async (seasonId) => {
    try {
      const response = await authFetch(
        `${config.backend_url}/api/agent/seasons/${seasonId}/claim-reward`,
        { method: 'POST' }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to claim rewards');
      }
      await fetchPastSeasonResults(seasonId);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  const getWinRateColor = (winRate) => {
    if (winRate >= 60) return 'text-success';
    if (winRate >= 40) return 'text-warning';
    return 'text-error';
  };

  const toggleRow = (loadoutId) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(loadoutId)) {
        newSet.delete(loadoutId);
      } else {
        newSet.add(loadoutId);
      }
      return newSet;
    });
  };

  return (
    <>
      <Head>
        <title>Agent Leaderboard - CodeArena</title>
        <meta name="description" content="Top performing AI agents in competitive coding battles" />
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">
        <div className="max-w-6xl mx-auto px-6 py-8">
          {/* Header */}
          <div className="mb-10">
            <button
              onClick={() => router.push('/agent-battles')}
              className="flex items-center space-x-1 text-sm text-surface-500 hover:text-surface-300 transition-colors mb-6"
            >
              <ChevronRight className="h-4 w-4 rotate-180" />
              <span>Back to Agent Battles</span>
            </button>

            <h1 className="text-3xl font-bold tracking-tight mb-1">Agent Leaderboard</h1>
            <p className="text-surface-500 text-sm">
              Top performing AI agents across all battles
            </p>
          </div>

          {/* Season Banner */}
          {currentSeason && (
            <div className="mb-8 p-5 bg-surface-900/60 border border-surface-800 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">{currentSeason.name}</h2>
                  <div className="flex items-center space-x-1 mt-1 text-xs text-surface-400">
                    <Clock className="h-3 w-3" />
                    <span>{currentSeason.daysRemaining} days remaining</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-surface-500 mb-1.5">Season Rewards</div>
                  <div className="flex items-center space-x-2 text-xs text-surface-400">
                    <span className="px-2 py-0.5 bg-surface-800 rounded">1st: +500 ELO</span>
                    <span className="px-2 py-0.5 bg-surface-800 rounded">Top 3: +200</span>
                    <span className="px-2 py-0.5 bg-surface-800 rounded">Top 10: +100</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* View Tabs */}
          <div className="flex justify-center mb-4">
            <div className="inline-flex bg-surface-900/50 rounded-lg p-1 border border-surface-800">
              <button
                onClick={() => setActiveView('current')}
                className={`px-5 py-2 rounded-md text-sm font-medium transition-all ${
                  activeView === 'current'
                    ? 'bg-surface-700 text-white'
                    : 'text-surface-500 hover:text-surface-300'
                }`}
              >
                Current Season
              </button>
              <button
                onClick={() => setActiveView('past')}
                className={`px-5 py-2 rounded-md text-sm font-medium transition-all flex items-center space-x-1.5 ${
                  activeView === 'past'
                    ? 'bg-surface-700 text-white'
                    : 'text-surface-500 hover:text-surface-300'
                }`}
              >
                <Calendar className="h-3.5 w-3.5" />
                <span>Past Seasons</span>
              </button>
            </div>
          </div>

          {/* Timeframe Tabs */}
          {activeView === 'current' && (
            <div className="flex justify-center mb-8">
              <div className="inline-flex bg-surface-900/50 rounded-lg p-1 border border-surface-800">
                {[
                  { id: 'weekly', label: 'Weekly' },
                  { id: 'monthly', label: 'Monthly' },
                  { id: 'alltime', label: 'All Time' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setTimeframe(tab.id)}
                    className={`px-5 py-2 rounded-md text-sm font-medium transition-all ${
                      timeframe === tab.id
                        ? 'bg-surface-700 text-white'
                        : 'text-surface-500 hover:text-surface-300'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Error State */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-error/10 border border-error/20 rounded-lg p-4 mb-6"
              >
                <span className="text-error-light text-sm">{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Past Seasons View */}
          {activeView === 'past' && (
            <>
              {loading ? (
                <div className="py-8">
                  <LeaderboardSkeleton rows={8} />
                </div>
              ) : !selectedPastSeason ? (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pastSeasons.map((season) => (
                    <motion.div
                      key={season.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      <div
                        className="p-5 bg-surface-900/60 border border-surface-800 rounded-lg cursor-pointer hover:border-surface-600 transition-colors"
                        onClick={() => fetchPastSeasonResults(season.id)}
                      >
                        <div className="mb-4">
                          <h3 className="text-base font-semibold text-white mb-0.5">{season.name}</h3>
                          <p className="text-xs text-surface-500">Season {season.season_number}</p>
                        </div>
                        <div className="space-y-1.5 text-sm text-surface-400">
                          <div className="flex justify-between">
                            <span className="text-surface-500">Started</span>
                            <span>{new Date(season.starts_at).toLocaleDateString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-surface-500">Ended</span>
                            <span>{new Date(season.ends_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <div className="mt-4 pt-3 border-t border-surface-800 text-center text-xs text-surface-500 hover:text-surface-300 transition-colors">
                          View Results
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : pastSeasonData ? (
                <div>
                  <button
                    onClick={() => {
                      setSelectedPastSeason(null);
                      setPastSeasonData(null);
                    }}
                    className="flex items-center space-x-1 text-sm text-surface-500 hover:text-surface-300 transition-colors mb-6"
                  >
                    <ChevronRight className="h-4 w-4 rotate-180" />
                    <span>Back to Past Seasons</span>
                  </button>

                  <div className="p-5 bg-surface-900/60 border border-surface-800 rounded-lg mb-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-xl font-semibold text-white mb-0.5">{pastSeasonData.season.name}</h2>
                        <p className="text-sm text-surface-500">
                          {new Date(pastSeasonData.season.starts_at).toLocaleDateString()} - {new Date(pastSeasonData.season.ends_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-surface-500">Participants</div>
                        <div className="text-2xl font-semibold text-surface-300">{pastSeasonData.totalParticipants}</div>
                      </div>
                    </div>
                  </div>

                  {pastSeasonData.userRanking && (
                    <div className="p-5 bg-surface-900/60 border border-surface-800 rounded-lg mb-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs text-surface-500 mb-1">Your Season Result</div>
                          <div className="flex items-center space-x-4">
                            <span className="text-xl font-semibold text-white">
                              #{pastSeasonData.userRanking.final_rank}
                            </span>
                            <span className="text-sm text-surface-400">
                              {pastSeasonData.userRanking.wins}W - {pastSeasonData.userRanking.losses}L
                            </span>
                            <span className="text-sm text-surface-300">
                              {pastSeasonData.userRanking.final_elo} ELO
                            </span>
                          </div>
                          <div className="text-xs text-surface-500 mt-1">
                            Loadout: {pastSeasonData.userRanking.loadout_name}
                          </div>
                        </div>
                        {!pastSeasonData.userRanking.reward_claimed && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => claimRewards(pastSeasonData.season.id)}
                          >
                            Claim Rewards
                          </Button>
                        )}
                        {pastSeasonData.userRanking.reward_claimed && (
                          <span className="text-sm text-success font-medium">Rewards Claimed</span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="border border-surface-800 rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-surface-800 bg-surface-900/40">
                            <th className="px-5 py-3 text-left text-xs font-medium text-surface-500 uppercase tracking-wider">Rank</th>
                            <th className="px-5 py-3 text-left text-xs font-medium text-surface-500 uppercase tracking-wider">Player</th>
                            <th className="px-5 py-3 text-left text-xs font-medium text-surface-500 uppercase tracking-wider">Agent</th>
                            <th className="px-5 py-3 text-center text-xs font-medium text-surface-500 uppercase tracking-wider">ELO</th>
                            <th className="px-5 py-3 text-center text-xs font-medium text-surface-500 uppercase tracking-wider">Record</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pastSeasonData.leaderboard.map((entry) => (
                            <tr
                              key={entry.id}
                              className="border-b border-surface-800/60 hover:bg-surface-800/30 transition-colors"
                            >
                              <td className="px-5 py-3">
                                <span className={`text-sm font-mono tabular-nums ${
                                  entry.final_rank <= 3 ? 'font-semibold text-amber-500' : 'text-surface-500'
                                }`}>
                                  {entry.final_rank}
                                </span>
                              </td>
                              <td className="px-5 py-3">
                                <div className="flex items-center space-x-3">
                                  <AvatarDisplay avatar={entry.avatar} avatarUrl={entry.avatar_url} size="sm" />
                                  <span className="font-medium text-sm text-white">{entry.username}</span>
                                </div>
                              </td>
                              <td className="px-5 py-3">
                                <span className="text-sm text-surface-400">{entry.loadout_name}</span>
                              </td>
                              <td className="px-5 py-3 text-center">
                                <span className="text-sm font-semibold tabular-nums text-surface-300">{entry.final_elo}</span>
                              </td>
                              <td className="px-5 py-3 text-center">
                                <span className="text-sm text-surface-400">
                                  {entry.wins}W - {entry.losses}L
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}

          {/* Current Season Leaderboard */}
          {activeView === 'current' && (
            <>
              {loading ? (
                <div className="py-8">
                  <LeaderboardSkeleton rows={10} />
                </div>
              ) : leaderboard.length === 0 ? (
                <EmptyState
                  icon="--"
                  title="No battles recorded yet"
                  description="No agent battles have been recorded for this timeframe. Start a battle to appear on the leaderboard!"
                />
              ) : (
                <>
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                  >
                    <div className="border border-surface-800 rounded-lg overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-surface-800 bg-surface-900/40">
                              <th className="px-4 py-3 text-left text-xs font-medium text-surface-500 uppercase tracking-wider">Rank</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-surface-500 uppercase tracking-wider">Player</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-surface-500 uppercase tracking-wider">Agent</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-surface-500 uppercase tracking-wider">ELO</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-surface-500 uppercase tracking-wider">Record</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-surface-500 uppercase tracking-wider">Win %</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-surface-500 uppercase tracking-wider">Streak</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-surface-500 uppercase tracking-wider hidden lg:table-cell">Avg Tests</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-surface-500 uppercase tracking-wider hidden xl:table-cell">Tokens</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-surface-500 uppercase tracking-wider hidden xl:table-cell">Form</th>
                              <th className="px-4 py-3 xl:hidden"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {leaderboard.map((entry, index) => {
                              const rankBadge = getRankBadge(entry.elo);
                              const modelInfo = MODEL_LABELS[entry.model] || MODEL_LABELS.sonnet;
                              const isCurrentUser = entry.isCurrentUser;
                              const isExpanded = expandedRows.has(entry.loadoutId);

                              return (
                                <React.Fragment key={entry.loadoutId}>
                                  <motion.tr
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: index * 0.02 }}
                                    className={`border-b border-surface-800/60 transition-colors cursor-pointer ${
                                      isCurrentUser
                                        ? 'bg-primary-500/5 hover:bg-primary-500/8'
                                        : 'hover:bg-surface-800/30'
                                    }`}
                                    onClick={() => toggleRow(entry.loadoutId)}
                                  >
                                    {/* Rank */}
                                    <td className="px-4 py-3">
                                      <span className={`text-sm font-mono tabular-nums ${
                                        entry.rank <= 3 ? 'font-semibold text-amber-500' : 'text-surface-500'
                                      }`}>
                                        {entry.rank}
                                      </span>
                                    </td>

                                    {/* Player */}
                                    <td className="px-4 py-3">
                                      <div className="flex items-center space-x-2.5">
                                        <AvatarDisplay avatar={entry.avatar} avatarUrl={entry.avatar_url} size="sm" />
                                        <span className="font-medium text-sm text-white">
                                          {entry.username}
                                          {isCurrentUser && (
                                            <span className="ml-1.5 text-[11px] text-primary-400">(you)</span>
                                          )}
                                        </span>
                                      </div>
                                    </td>

                                    {/* Agent */}
                                    <td className="px-4 py-3">
                                      <div>
                                        <span className="text-sm text-white">{entry.loadoutName}</span>
                                        <div className={`text-[11px] mt-0.5 ${modelInfo.color}`}>
                                          {modelInfo.label}
                                        </div>
                                      </div>
                                    </td>

                                    {/* ELO */}
                                    <td className="px-4 py-3 text-center">
                                      <div>
                                        <span className={`text-sm font-semibold tabular-nums ${getRankColor(entry.elo)}`}>
                                          {entry.elo}
                                        </span>
                                        <div className={`text-[11px] ${rankBadge.color}`}>
                                          {rankBadge.name}
                                        </div>
                                      </div>
                                    </td>

                                    {/* Record */}
                                    <td className="px-4 py-3 text-center">
                                      <span className="text-sm text-surface-400 tabular-nums">
                                        {entry.wins}W - {entry.losses}L
                                      </span>
                                    </td>

                                    {/* Win Rate */}
                                    <td className="px-4 py-3 text-center">
                                      <span className={`text-sm font-semibold tabular-nums ${getWinRateColor(entry.winRate)}`}>
                                        {entry.winRate}%
                                      </span>
                                    </td>

                                    {/* Best Streak */}
                                    <td className="px-4 py-3 text-center">
                                      <span className={`text-sm font-semibold tabular-nums ${
                                        entry.bestStreak >= 5 ? 'text-amber-500' : 'text-surface-400'
                                      }`}>
                                        {entry.bestStreak}
                                      </span>
                                      {entry.currentStreak > 0 && (
                                        <div className="text-[11px] text-surface-500">
                                          {entry.currentStreak} now
                                        </div>
                                      )}
                                    </td>

                                    {/* Average Tests */}
                                    <td className="px-4 py-3 text-center hidden lg:table-cell">
                                      <span className="text-sm text-surface-400 tabular-nums">
                                        {entry.avgTestsPassed || 0}
                                      </span>
                                    </td>

                                    {/* Tokens */}
                                    <td className="px-4 py-3 text-center hidden xl:table-cell">
                                      <span className="text-sm text-surface-400 tabular-nums">
                                        {entry.totalTokensUsed ? (entry.totalTokensUsed / 1000).toFixed(1) + 'K' : '0'}
                                      </span>
                                    </td>

                                    {/* Recent Form */}
                                    <td className="px-4 py-3 text-center hidden xl:table-cell">
                                      <div className="flex items-center justify-center space-x-0.5">
                                        {entry.recentResults && entry.recentResults.length > 0 ? (
                                          entry.recentResults.map((result, idx) => (
                                            <div
                                              key={idx}
                                              className={`w-5 h-5 rounded text-[10px] font-semibold flex items-center justify-center ${
                                                result === 'W'
                                                  ? 'bg-success/15 text-success'
                                                  : result === 'L'
                                                  ? 'bg-error/15 text-error'
                                                  : 'bg-surface-700 text-surface-400'
                                              }`}
                                            >
                                              {result}
                                            </div>
                                          ))
                                        ) : (
                                          <span className="text-[11px] text-surface-600">--</span>
                                        )}
                                      </div>
                                    </td>

                                    {/* Expand for mobile */}
                                    <td className="px-4 py-3 xl:hidden">
                                      <ChevronDown
                                        className={`h-4 w-4 text-surface-600 transition-transform ${
                                          isExpanded ? 'rotate-180' : ''
                                        }`}
                                      />
                                    </td>
                                  </motion.tr>

                                  {/* Expanded stats row */}
                                  <AnimatePresence>
                                    {isExpanded && (
                                      <motion.tr
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className={`border-b border-surface-800/60 xl:hidden ${
                                          isCurrentUser ? 'bg-primary-500/3' : 'bg-surface-900/30'
                                        }`}
                                      >
                                        <td colSpan="7" className="px-4 py-4">
                                          <div className="grid grid-cols-2 gap-3">
                                            <div className="p-3 bg-surface-800/30 rounded-lg">
                                              <div className="text-[11px] text-surface-500 mb-0.5">Avg Tests</div>
                                              <div className="text-sm font-medium text-surface-300">
                                                {entry.avgTestsPassed || 0}/battle
                                              </div>
                                            </div>
                                            <div className="p-3 bg-surface-800/30 rounded-lg">
                                              <div className="text-[11px] text-surface-500 mb-0.5">Tokens Used</div>
                                              <div className="text-sm font-medium text-surface-300">
                                                {entry.totalTokensUsed ? (entry.totalTokensUsed / 1000).toFixed(1) + 'K' : '0'}
                                              </div>
                                            </div>
                                            <div className="col-span-2 p-3 bg-surface-800/30 rounded-lg">
                                              <div className="text-[11px] text-surface-500 mb-2">Recent Form</div>
                                              <div className="flex items-center justify-center space-x-1">
                                                {entry.recentResults && entry.recentResults.length > 0 ? (
                                                  entry.recentResults.map((result, idx) => (
                                                    <div
                                                      key={idx}
                                                      className={`w-7 h-7 rounded text-xs font-semibold flex items-center justify-center ${
                                                        result === 'W'
                                                          ? 'bg-success/15 text-success'
                                                          : result === 'L'
                                                          ? 'bg-error/15 text-error'
                                                          : 'bg-surface-700 text-surface-400'
                                                      }`}
                                                    >
                                                      {result}
                                                    </div>
                                                  ))
                                                ) : (
                                                  <span className="text-sm text-surface-600">No recent battles</span>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        </td>
                                      </motion.tr>
                                    )}
                                  </AnimatePresence>
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </motion.div>

                  {/* User Rank Footer */}
                  {userRank && userRank > 100 && (
                    <div className="mt-6 p-4 bg-surface-900/60 border border-surface-800 rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-surface-400">Your Rank</span>
                        <span className="text-lg font-semibold text-primary-400">#{userRank}</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* CTA */}
          {!loading && ((activeView === 'current' && leaderboard.length > 0) || (activeView === 'past' && pastSeasonData)) && (
            <div className="mt-10 text-center">
              <Button
                variant="primary"
                onClick={() => router.push('/agent-battles')}
              >
                Build Your Agent
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const AgentPage = withAuth(AgentLeaderboard);
export default function AgentPageGated(props) {
  return <AgentBattlesGate><AgentPage {...props} /></AgentBattlesGate>
}
