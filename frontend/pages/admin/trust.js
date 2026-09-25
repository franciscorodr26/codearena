/**
 * Admin Trust Tier Dashboard
 *
 * Dashboard for monitoring and managing the trust tier system.
 * Shows tier distribution, users requiring attention, and manual override controls.
 */

import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Users,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Search,
  Eye,
  Edit,
  ArrowLeft,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { config } from '../../config/env';
import AvatarDisplay from '../../components/ui/AvatarDisplay';
import TrustIndicator from '../../components/TrustIndicator';
import FloatingOrbs from '../../components/ui/FloatingOrbs';

const TIER_ICONS = {
  trusted: ShieldCheck,
  standard: Shield,
  probation: ShieldAlert,
  restricted: ShieldX
};

const TIER_COLORS = {
  trusted: { bg: 'bg-success/20', border: 'border-success/30', text: 'text-success' },
  standard: { bg: 'bg-primary-500/20', border: 'border-primary-500/30', text: 'text-primary-400' },
  probation: { bg: 'bg-warning/20', border: 'border-warning/30', text: 'text-warning' },
  restricted: { bg: 'bg-error/20', border: 'border-error/30', text: 'text-error' }
};

export default function AdminTrustDashboard() {
  const router = useRouter();
  const { user, token, loading: authLoading } = useAuth();

  const [distribution, setDistribution] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [probationUsers, setProbationUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedUser, setSelectedUser] = useState(null);
  const [userHistory, setUserHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Override modal state
  const [overrideModal, setOverrideModal] = useState(null);
  const [overrideTier, setOverrideTier] = useState('standard');
  const [overrideScore, setOverrideScore] = useState(60);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideLoading, setOverrideLoading] = useState(false);

  // Fetch distribution stats
  const fetchDistribution = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${config.backend_url}/api/trust/admin/distribution`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.status === 403) {
        setError('Admin access required');
        return;
      }
      const data = await response.json();
      if (data.success) {
        setDistribution(data.distribution);
        setTotalUsers(data.totalUsers);
      }
    } catch (err) {
      console.error('Failed to fetch distribution:', err);
    }
  }, [token]);

  // Fetch probation users
  const fetchProbationUsers = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${config.backend_url}/api/trust/admin/probation-list?limit=100`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        setProbationUsers(data.users);
      }
    } catch (err) {
      console.error('Failed to fetch probation users:', err);
    }
  }, [token]);

  // Fetch overall stats
  const fetchStats = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${config.backend_url}/api/trust/admin/stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        setStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, [token]);

  // Fetch user history
  const fetchUserHistory = async (userId) => {
    if (!token) return;
    setHistoryLoading(true);
    try {
      const response = await fetch(`${config.backend_url}/api/trust/admin/user/${userId}/history`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        setUserHistory(data);
      }
    } catch (err) {
      console.error('Failed to fetch user history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Handle override submission
  const handleOverride = async () => {
    if (!overrideModal || !overrideReason.trim()) return;
    setOverrideLoading(true);
    try {
      const response = await fetch(`${config.backend_url}/api/trust/admin/user/${overrideModal.id}/override`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          newTier: overrideTier,
          newScore: overrideScore,
          reason: overrideReason.trim()
        })
      });
      const data = await response.json();
      if (data.success) {
        setOverrideModal(null);
        setOverrideReason('');
        // Refresh data
        fetchDistribution();
        fetchProbationUsers();
        if (selectedUser?.id === overrideModal.id) {
          fetchUserHistory(overrideModal.id);
        }
      } else {
        alert(data.error || 'Failed to override');
      }
    } catch (err) {
      console.error('Failed to override:', err);
      alert('Failed to override trust tier');
    } finally {
      setOverrideLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }

    Promise.all([fetchDistribution(), fetchProbationUsers(), fetchStats()])
      .finally(() => setLoading(false));
  }, [authLoading, user, router, fetchDistribution, fetchProbationUsers, fetchStats]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-error mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">{error}</h1>
          <Link href="/" className="text-primary-400 hover:underline">Return Home</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Trust Tier Dashboard - Admin | CodeArena</title>
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">
        <FloatingOrbs />

        {/* Header */}
        <motion.header
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="border-b border-surface-800 bg-surface-900/50 sticky top-0 z-10 backdrop-blur-sm"
        >
          <div className="max-w-7xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Link href="/admin/moderation" className="text-surface-400 hover:text-white">
                  <ArrowLeft className="h-5 w-5" />
                </Link>
                <div className="flex items-center gap-2">
                  <Shield className="h-6 w-6 text-primary-400" />
                  <h1 className="text-xl font-bold">Trust Tier Dashboard</h1>
                </div>
              </div>
              <button
                onClick={() => {
                  setLoading(true);
                  Promise.all([fetchDistribution(), fetchProbationUsers(), fetchStats()])
                    .finally(() => setLoading(false));
                }}
                className="px-3 py-1.5 bg-surface-800 hover:bg-surface-700 rounded-lg flex items-center gap-2 text-sm"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
            </div>
          </div>
        </motion.header>

        <div className="max-w-7xl mx-auto px-4 py-6">
          {/* Distribution Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {['trusted', 'standard', 'probation', 'restricted'].map((tier) => {
              const data = distribution.find(d => d.tier === tier) || { count: 0, percentage: 0 };
              const Icon = TIER_ICONS[tier];
              const colors = TIER_COLORS[tier];

              return (
                <motion.div
                  key={tier}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`${colors.bg} border ${colors.border} rounded-xl p-4`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`h-5 w-5 ${colors.text}`} />
                    <span className={`font-medium capitalize ${colors.text}`}>{tier}</span>
                  </div>
                  <p className="text-3xl font-bold text-white">{data.count}</p>
                  <p className="text-sm text-surface-400">{data.percentage}% of users</p>
                </motion.div>
              );
            })}
          </div>

          {/* Stats Overview */}
          {stats && (
            <div className="bg-surface-900 border border-surface-800 rounded-xl p-4 mb-8">
              <h2 className="text-lg font-semibold mb-4">System Health</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-surface-400 text-sm">At-Risk Users</p>
                  <p className="text-2xl font-bold text-warning">{stats.atRiskUsers}</p>
                </div>
                <div>
                  <p className="text-surface-400 text-sm">Trusted %</p>
                  <p className="text-2xl font-bold text-success">{stats.trustedPercentage}%</p>
                </div>
                <div>
                  <p className="text-surface-400 text-sm">Pending Reviews</p>
                  <p className="text-2xl font-bold text-warning">{stats.flaggedSubmissions?.pending || 0}</p>
                </div>
                <div>
                  <p className="text-surface-400 text-sm">False Positive Rate</p>
                  <p className="text-2xl font-bold text-primary-400">{stats.flaggedSubmissions?.falsePositiveRate || 0}%</p>
                </div>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                activeTab === 'overview'
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('watchlist')}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                activeTab === 'watchlist'
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
              }`}
            >
              <ShieldAlert className="h-4 w-4" />
              Watchlist
              {probationUsers.length > 0 && (
                <span className="bg-warning text-surface-950 text-xs px-1.5 py-0.5 rounded-full">
                  {probationUsers.length}
                </span>
              )}
            </button>
          </div>

          {/* Watchlist Tab */}
          {activeTab === 'watchlist' && (
            <div className="bg-surface-900 border border-surface-800 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-surface-800">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-warning" />
                  Users Requiring Attention
                </h2>
                <p className="text-sm text-surface-400 mt-1">
                  Users on probation or restricted status
                </p>
              </div>

              {probationUsers.length === 0 ? (
                <div className="p-8 text-center text-surface-400">
                  <CheckCircle className="h-12 w-12 mx-auto mb-3 text-success" />
                  <p>No users currently on probation or restricted</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-surface-400 text-sm border-b border-surface-800">
                        <th className="px-4 py-3">User</th>
                        <th className="px-4 py-3">Tier</th>
                        <th className="px-4 py-3">Score</th>
                        <th className="px-4 py-3">Violations</th>
                        <th className="px-4 py-3">Clean Streak</th>
                        <th className="px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {probationUsers.map((u) => (
                        <tr key={u.id} className="border-b border-surface-800/50 hover:bg-surface-800/30">
                          <td className="px-4 py-3">
                            <Link
                              href={`/profile/${u.username}`}
                              className="flex items-center gap-2 hover:text-primary-400"
                            >
                              <AvatarDisplay user={u} size="sm" />
                              <span>@{u.username}</span>
                            </Link>
                          </td>
                          <td className="px-4 py-3">
                            <TrustIndicator tier={u.trustTier} size="sm" />
                          </td>
                          <td className="px-4 py-3 font-mono">{u.trustScore}</td>
                          <td className="px-4 py-3">{u.totalViolations}</td>
                          <td className="px-4 py-3">{u.cleanBattlesSinceViolation}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  setSelectedUser(u);
                                  fetchUserHistory(u.id);
                                }}
                                className="p-1.5 bg-surface-700 hover:bg-surface-600 rounded text-surface-300"
                                title="View History"
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => {
                                  setOverrideModal(u);
                                  setOverrideTier(u.trustTier);
                                  setOverrideScore(u.trustScore);
                                }}
                                className="p-1.5 bg-primary-500/20 text-primary-400 hover:bg-primary-500/30 rounded"
                                title="Override Tier"
                              >
                                <Edit className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Overview Tab - User History Panel */}
          {activeTab === 'overview' && selectedUser && userHistory && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-surface-900 border border-surface-800 rounded-xl p-6"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <AvatarDisplay user={userHistory.user} size="md" />
                  <div>
                    <h3 className="font-semibold">@{userHistory.user?.username}</h3>
                    <TrustIndicator
                      tier={userHistory.trustInfo?.tier}
                      score={userHistory.trustInfo?.score}
                      showScore
                      size="sm"
                    />
                  </div>
                </div>
                <button
                  onClick={() => {
                    setSelectedUser(null);
                    setUserHistory(null);
                  }}
                  className="text-surface-400 hover:text-white"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>

              {/* Behavior Metrics */}
              {userHistory.behaviorMetrics && (
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-surface-400 mb-3">Behavior Metrics</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-surface-800 rounded-lg p-3">
                      <p className="text-xs text-surface-400">Avg Typing Speed</p>
                      <p className="text-lg font-mono">
                        {userHistory.behaviorMetrics.avgTypingSpeed?.toFixed(2) || 0} c/s
                      </p>
                    </div>
                    <div className="bg-surface-800 rounded-lg p-3">
                      <p className="text-xs text-surface-400">Avg Paste Freq</p>
                      <p className="text-lg font-mono">
                        {userHistory.behaviorMetrics.avgPasteFrequency?.toFixed(2) || 0}
                      </p>
                    </div>
                    <div className="bg-surface-800 rounded-lg p-3">
                      <p className="text-xs text-surface-400">Times Flagged</p>
                      <p className="text-lg font-mono">{userHistory.behaviorMetrics.timesFlagged || 0}</p>
                    </div>
                    <div className="bg-surface-800 rounded-lg p-3">
                      <p className="text-xs text-surface-400">False Positives</p>
                      <p className="text-lg font-mono">{userHistory.behaviorMetrics.timesFalsePositive || 0}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Score History */}
              <div>
                <h4 className="text-sm font-medium text-surface-400 mb-3">Recent Score Changes</h4>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {userHistory.scoreHistory?.slice(0, 20).map((h, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between bg-surface-800 rounded-lg px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        {h.change > 0 ? (
                          <TrendingUp className="h-4 w-4 text-success" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-error" />
                        )}
                        <span className={h.change > 0 ? 'text-success' : 'text-error'}>
                          {h.change > 0 ? '+' : ''}{h.change}
                        </span>
                        <span className="text-surface-400">({h.previousScore} → {h.newScore})</span>
                      </div>
                      <div className="text-right">
                        <p className="text-surface-300 truncate max-w-xs" title={h.reason}>
                          {h.reason}
                        </p>
                        <p className="text-xs text-surface-500">
                          {new Date(h.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* Override Modal */}
        {overrideModal && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-surface-900 border border-surface-700 rounded-xl max-w-md w-full p-6"
            >
              <h3 className="text-lg font-semibold mb-4">Override Trust Tier</h3>
              <p className="text-surface-400 text-sm mb-4">
                User: <span className="text-white">@{overrideModal.username}</span>
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-surface-400 mb-1">New Tier</label>
                  <select
                    value={overrideTier}
                    onChange={(e) => setOverrideTier(e.target.value)}
                    className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2"
                  >
                    <option value="trusted">Trusted</option>
                    <option value="standard">Standard</option>
                    <option value="probation">Probation</option>
                    <option value="restricted">Restricted</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-surface-400 mb-1">New Score (0-100)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={overrideScore}
                    onChange={(e) => setOverrideScore(parseInt(e.target.value) || 0)}
                    className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm text-surface-400 mb-1">Reason (required)</label>
                  <textarea
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Explain why you're overriding this user's trust tier..."
                    rows={3}
                    className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 resize-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setOverrideModal(null);
                    setOverrideReason('');
                  }}
                  className="flex-1 px-4 py-2 bg-surface-700 hover:bg-surface-600 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleOverride}
                  disabled={!overrideReason.trim() || overrideLoading}
                  className="flex-1 px-4 py-2 bg-primary-500 hover:bg-primary-400 disabled:bg-surface-700 disabled:text-surface-500 rounded-lg flex items-center justify-center gap-2"
                >
                  {overrideLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Edit className="h-4 w-4" />
                      Override
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </>
  );
}
