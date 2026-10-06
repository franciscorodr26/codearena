import React, { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  ArrowLeft,
  Loader2,
  RefreshCw,
  Bot,
  Activity,
  Users,
  DollarSign,
  AlertCircle,
  TrendingUp,
  Clock,
  Zap,
  RotateCcw,
  Ban,
  CheckCircle,
  X,
  UserX,
  Puzzle,
  Scale,
  ArrowUp,
  ArrowDown,
  Minus
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { config } from '../../config/env';
import AvatarDisplay from '../../components/ui/AvatarDisplay';
import FloatingOrbs from '../../components/ui/FloatingOrbs';
import io from 'socket.io-client';
import AgentBattlesGate from '../../components/AgentBattlesGate'

function AgentBattlesAdminPage() {
  const router = useRouter();
  const { user, token, loading: authLoading } = useAuth();
  const socketRef = useRef(null);

  const [stats, setStats] = useState(null);
  const [recentBattles, setRecentBattles] = useState([]);
  const [rateLimitUsers, setRateLimitUsers] = useState([]);
  const [spendingData, setSpendingData] = useState([]);
  const [spendingSummary, setSpendingSummary] = useState(null);
  const [bannedUsers, setBannedUsers] = useState([]);
  const [moduleStats, setModuleStats] = useState(null);
  const [moduleCombinations, setModuleCombinations] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [toast, setToast] = useState(null);

  // Modal states
  const [showBanModal, setShowBanModal] = useState(false);
  const [banTarget, setBanTarget] = useState(null);
  const [banDuration, setBanDuration] = useState(24);
  const [banReason, setBanReason] = useState('');

  // Confirmation modal states
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);

  // Show toast notification
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(
        `${config.backend_url}/api/admin/agent-battles/stats`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      if (response.status === 403) {
        setError('Admin access required');
        return;
      }

      const data = await response.json();
      if (data.success) {
        setStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, [token]);

  // Fetch recent battles
  const fetchRecentBattles = useCallback(async () => {
    try {
      const response = await fetch(
        `${config.backend_url}/api/admin/agent-battles/recent?limit=20`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      const data = await response.json();
      if (data.success) {
        setRecentBattles(data.battles);
      }
    } catch (err) {
      console.error('Failed to fetch recent battles:', err);
    }
  }, [token]);

  // Fetch rate limit users
  const fetchRateLimitUsers = useCallback(async () => {
    try {
      const response = await fetch(
        `${config.backend_url}/api/admin/agent-battles/rate-limits?threshold=0.7`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      const data = await response.json();
      if (data.success) {
        setRateLimitUsers(data.users);
      }
    } catch (err) {
      console.error('Failed to fetch rate limit users:', err);
    }
  }, [token]);

  // Fetch spending data
  const fetchSpendingData = useCallback(async () => {
    try {
      const response = await fetch(
        `${config.backend_url}/api/admin/agent-battles/spending?limit=50`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      const data = await response.json();
      if (data.success) {
        setSpendingData(data.spending);
        setSpendingSummary(data.summary);
      }
    } catch (err) {
      console.error('Failed to fetch spending data:', err);
    }
  }, [token]);

  // Fetch banned users
  const fetchBannedUsers = useCallback(async () => {
    try {
      const response = await fetch(
        `${config.backend_url}/api/admin/agent-battles/banned-users`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      const data = await response.json();
      if (data.success) {
        setBannedUsers(data.bans);
      }
    } catch (err) {
      console.error('Failed to fetch banned users:', err);
    }
  }, [token]);

  // Fetch module stats
  const fetchModuleStats = useCallback(async () => {
    try {
      const response = await fetch(
        `${config.backend_url}/api/admin/agent-battles/module-stats?days=30`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      const data = await response.json();
      if (data.success) {
        setModuleStats(data);
      }
    } catch (err) {
      console.error('Failed to fetch module stats:', err);
    }
  }, [token]);

  // Fetch module combinations
  const fetchModuleCombinations = useCallback(async () => {
    try {
      const response = await fetch(
        `${config.backend_url}/api/admin/agent-battles/module-combinations?days=30`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      const data = await response.json();
      if (data.success) {
        setModuleCombinations(data);
      }
    } catch (err) {
      console.error('Failed to fetch module combinations:', err);
    }
  }, [token]);

  // Fetch all data
  const fetchAllData = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      fetchStats(),
      fetchRecentBattles(),
      fetchRateLimitUsers(),
      fetchSpendingData(),
      fetchBannedUsers(),
      fetchModuleStats(),
      fetchModuleCombinations()
    ]);
    setLoading(false);
  }, [fetchStats, fetchRecentBattles, fetchRateLimitUsers, fetchSpendingData, fetchBannedUsers, fetchModuleStats, fetchModuleCombinations]);

  // Admin actions
  const resetRateLimit = async (userId) => {
    setShowConfirmModal(false);
    try {
      const response = await fetch(
        `${config.backend_url}/api/admin/agent-battles/reset-rate-limit/${userId}`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      const data = await response.json();
      if (data.success) {
        showToast('Rate limit reset successfully');
        fetchRateLimitUsers();
      } else {
        showToast(data.error || 'Failed to reset rate limit', 'error');
      }
    } catch (err) {
      console.error('Failed to reset rate limit:', err);
      showToast('Failed to reset rate limit', 'error');
    }
  };

  const resetSpending = async (userId) => {
    setShowConfirmModal(false);
    try {
      const response = await fetch(
        `${config.backend_url}/api/admin/agent-battles/reset-spending/${userId}`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      const data = await response.json();
      if (data.success) {
        showToast('Spending reset successfully');
        fetchSpendingData();
      } else {
        showToast(data.error || 'Failed to reset spending', 'error');
      }
    } catch (err) {
      console.error('Failed to reset spending:', err);
      showToast('Failed to reset spending', 'error');
    }
  };

  const banUser = async () => {
    if (!banTarget || !banDuration) return;

    try {
      const response = await fetch(
        `${config.backend_url}/api/admin/agent-battles/ban-user/${banTarget.userId}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            duration: banDuration,
            reason: banReason || 'No reason provided'
          })
        }
      );

      const data = await response.json();
      if (data.success) {
        showToast(`User @${banTarget.username} banned for ${banDuration} hours`);
        setShowBanModal(false);
        setBanTarget(null);
        setBanDuration(24);
        setBanReason('');
        fetchBannedUsers();
      } else {
        showToast(data.error || 'Failed to ban user', 'error');
      }
    } catch (err) {
      console.error('Failed to ban user:', err);
      showToast('Failed to ban user', 'error');
    }
  };

  const unbanUser = async (userId, username) => {
    setShowConfirmModal(false);
    try {
      const response = await fetch(
        `${config.backend_url}/api/admin/agent-battles/unban-user/${userId}`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      const data = await response.json();
      if (data.success) {
        showToast(`User @${username} unbanned successfully`);
        fetchBannedUsers();
      } else {
        showToast(data.error || 'Failed to unban user', 'error');
      }
    } catch (err) {
      console.error('Failed to unban user:', err);
      showToast('Failed to unban user', 'error');
    }
  };

  // Confirmation modal handler
  const showConfirmation = (action, message, onConfirm) => {
    setConfirmAction({ message, onConfirm });
    setShowConfirmModal(true);
  };

  // Socket.io for real-time updates
  useEffect(() => {
    if (!token) return;

    const socket = io(config.backend_url, {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Admin] Socket connected');
    });

    socket.on('agent-battle-created', (battle) => {
      console.log('[Admin] New battle created:', battle);
      fetchStats();
      fetchRecentBattles();
    });

    socket.on('agent-battle-completed', (battle) => {
      console.log('[Admin] Battle completed:', battle);
      fetchStats();
      fetchRecentBattles();
      fetchSpendingData();
    });

    socket.on('disconnect', () => {
      console.log('[Admin] Socket disconnected');
    });

    return () => {
      socket.disconnect();
    };
  }, [token, fetchStats, fetchRecentBattles, fetchSpendingData]);

  // Auto-refresh stats every 30 seconds
  useEffect(() => {
    if (!token) return;

    const interval = setInterval(() => {
      fetchStats();
    }, 30000);

    return () => clearInterval(interval);
  }, [token, fetchStats]);

  useEffect(() => {
    if (token) {
      fetchAllData();
    }
  }, [token, fetchAllData]);

  // Format date
  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Format duration
  const formatDuration = (ms) => {
    if (!ms) return 'N/A';
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  // Calculate time remaining
  const getTimeRemaining = (bannedUntil) => {
    const now = new Date();
    const until = new Date(bannedUntil);
    const diff = until - now;
    const hours = Math.ceil(diff / (1000 * 60 * 60));
    return hours > 0 ? `${hours}h remaining` : 'Expired';
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error === 'Admin access required') {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div className="text-center">
          <Shield className="h-16 w-16 text-error mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-surface-400 mb-4">You need admin privileges to access this page.</p>
          <Link href="/" className="text-primary-400 hover:text-primary-300">
            Return to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Agent Battles Admin - CodeArena</title>
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">
        <FloatingOrbs />

        {/* Toast Notifications */}
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: -50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -50 }}
              className="fixed top-4 right-4 z-50"
            >
              <div className={`px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 ${
                toast.type === 'error'
                  ? 'bg-error text-white'
                  : 'bg-success text-white'
              }`}>
                {toast.type === 'error' ? (
                  <AlertCircle className="h-5 w-5" />
                ) : (
                  <CheckCircle className="h-5 w-5" />
                )}
                <span>{toast.message}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Confirmation Modal */}
        <AnimatePresence>
          {showConfirmModal && confirmAction && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
              onClick={() => setShowConfirmModal(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-surface-900 border border-surface-800 rounded-xl p-6 max-w-md w-full mx-4"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-xl font-bold mb-4">Confirm Action</h3>
                <p className="text-surface-400 mb-6">{confirmAction.message}</p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={confirmAction.onConfirm}
                    className="flex-1 px-4 py-2 bg-error hover:bg-error/80 rounded-lg font-medium transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setShowConfirmModal(false)}
                    className="flex-1 px-4 py-2 bg-surface-800 hover:bg-surface-700 rounded-lg font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Ban Modal */}
        <AnimatePresence>
          {showBanModal && banTarget && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
              onClick={() => setShowBanModal(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-surface-900 border border-surface-800 rounded-xl p-6 max-w-md w-full mx-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold">Ban User</h3>
                  <button
                    onClick={() => setShowBanModal(false)}
                    className="p-1 hover:bg-surface-800 rounded transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <p className="text-surface-400 mb-4">
                  Ban <span className="text-white font-semibold">@{banTarget.username}</span> from agent battles
                </p>

                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm text-surface-400 mb-2">Duration (hours)</label>
                    <select
                      value={banDuration}
                      onChange={(e) => setBanDuration(parseInt(e.target.value))}
                      className="w-full px-4 py-2 bg-surface-800 border border-surface-700 rounded-lg focus:outline-none focus:border-accent-500"
                    >
                      <option value={1}>1 hour</option>
                      <option value={6}>6 hours</option>
                      <option value={24}>24 hours (1 day)</option>
                      <option value={72}>72 hours (3 days)</option>
                      <option value={168}>168 hours (1 week)</option>
                      <option value={720}>720 hours (30 days)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm text-surface-400 mb-2">Reason</label>
                    <textarea
                      value={banReason}
                      onChange={(e) => setBanReason(e.target.value)}
                      placeholder="Enter reason for ban..."
                      className="w-full px-4 py-2 bg-surface-800 border border-surface-700 rounded-lg focus:outline-none focus:border-accent-500 resize-none"
                      rows={3}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={banUser}
                    className="flex-1 px-4 py-2 bg-error hover:bg-error/80 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <Ban className="h-4 w-4" />
                    Ban User
                  </button>
                  <button
                    onClick={() => setShowBanModal(false)}
                    className="flex-1 px-4 py-2 bg-surface-800 hover:bg-surface-700 rounded-lg font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header */}
        <motion.header
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-surface-900/80 backdrop-blur-md border-b border-surface-800 px-6 py-4 sticky top-0 z-50"
        >
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/admin/moderation" className="text-surface-400 hover:text-white transition-colors">
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div className="flex items-center gap-2">
                <Bot className="h-6 w-6 text-accent-400" />
                <h1 className="text-xl font-bold">Agent Battles Admin</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {stats && (
                <div className="flex items-center gap-2 px-3 py-1 bg-surface-800 rounded-lg text-sm">
                  <Activity className="h-4 w-4 text-success animate-pulse" />
                  <span className="text-surface-400">Queue:</span>
                  <span className="font-semibold">{stats.queueSize}</span>
                </div>
              )}
              <button
                onClick={fetchAllData}
                className="p-2 hover:bg-surface-800 rounded-lg transition-colors"
                title="Refresh"
              >
                <RefreshCw className="h-5 w-5 text-surface-400" />
              </button>
            </div>
          </div>
        </motion.header>

        <div className="max-w-7xl mx-auto p-6">
          {/* Tabs */}
          <div className="flex items-center gap-1 mb-6 border-b border-surface-800 overflow-x-auto">
            <button
              onClick={() => setActiveTab('overview')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px rounded-t-lg whitespace-nowrap ${
                activeTab === 'overview'
                  ? 'border-accent-500 text-accent-400 bg-accent-500/10'
                  : 'border-transparent text-surface-400 hover:text-white hover:bg-surface-800/50'
              }`}
            >
              <Activity className="h-4 w-4" />
              Overview
            </button>
            <div className="h-6 w-px bg-surface-700" />
            <button
              onClick={() => setActiveTab('battles')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px rounded-t-lg whitespace-nowrap ${
                activeTab === 'battles'
                  ? 'border-primary-500 text-primary-400 bg-primary-500/10'
                  : 'border-transparent text-surface-400 hover:text-white hover:bg-surface-800/50'
              }`}
            >
              <Bot className="h-4 w-4" />
              Recent Battles
            </button>
            <div className="h-6 w-px bg-surface-700" />
            <button
              onClick={() => setActiveTab('limits')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px rounded-t-lg whitespace-nowrap ${
                activeTab === 'limits'
                  ? 'border-warning text-warning bg-warning/10'
                  : 'border-transparent text-surface-400 hover:text-white hover:bg-surface-800/50'
              }`}
            >
              <AlertCircle className="h-4 w-4" />
              Rate Limits
              {rateLimitUsers.length > 0 && (
                <span className="ml-1 px-2 py-0.5 text-xs bg-warning/20 text-warning rounded-full">
                  {rateLimitUsers.length}
                </span>
              )}
            </button>
            <div className="h-6 w-px bg-surface-700" />
            <button
              onClick={() => setActiveTab('spending')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px rounded-t-lg whitespace-nowrap ${
                activeTab === 'spending'
                  ? 'border-success text-success bg-success/10'
                  : 'border-transparent text-surface-400 hover:text-white hover:bg-surface-800/50'
              }`}
            >
              <DollarSign className="h-4 w-4" />
              Spending
            </button>
            <div className="h-6 w-px bg-surface-700" />
            <button
              onClick={() => setActiveTab('banned')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px rounded-t-lg whitespace-nowrap ${
                activeTab === 'banned'
                  ? 'border-error text-error bg-error/10'
                  : 'border-transparent text-surface-400 hover:text-white hover:bg-surface-800/50'
              }`}
            >
              <UserX className="h-4 w-4" />
              Banned Users
              {bannedUsers.length > 0 && (
                <span className="ml-1 px-2 py-0.5 text-xs bg-error/20 text-error rounded-full">
                  {bannedUsers.length}
                </span>
              )}
            </button>
            <div className="h-6 w-px bg-surface-700" />
            <button
              onClick={() => setActiveTab('modules')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px rounded-t-lg whitespace-nowrap ${
                activeTab === 'modules'
                  ? 'border-purple-500 text-purple-400 bg-purple-500/10'
                  : 'border-transparent text-surface-400 hover:text-white hover:bg-surface-800/50'
              }`}
            >
              <Puzzle className="h-4 w-4" />
              Module Balance
              {moduleStats?.summary?.imbalancedCount > 0 && (
                <span className="ml-1 px-2 py-0.5 text-xs bg-purple-500/20 text-purple-400 rounded-full">
                  {moduleStats.summary.imbalancedCount}
                </span>
              )}
            </button>
          </div>

          {/* Stats Cards */}
          {stats && activeTab === 'overview' && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <motion.div
                whileHover={{ scale: 1.02, y: -2 }}
                className="bg-surface-900 border border-surface-800 rounded-xl p-4"
              >
                <div className="flex items-center gap-2 text-accent-400 mb-2">
                  <Bot className="h-5 w-5" />
                  <span className="text-sm">Total Battles</span>
                </div>
                <p className="text-2xl font-bold">{stats.totalBattles}</p>
                <p className="text-xs text-surface-500 mt-1">{stats.completedBattles} completed</p>
              </motion.div>

              <motion.div
                whileHover={{ scale: 1.02, y: -2 }}
                className="bg-surface-900 border border-surface-800 rounded-xl p-4"
              >
                <div className="flex items-center gap-2 text-primary-400 mb-2">
                  <Activity className="h-5 w-5" />
                  <span className="text-sm">Active Now</span>
                </div>
                <p className="text-2xl font-bold">{stats.activeBattles}</p>
                <p className="text-xs text-surface-500 mt-1">{stats.queueSize} in queue</p>
              </motion.div>

              <motion.div
                whileHover={{ scale: 1.02, y: -2 }}
                className="bg-surface-900 border border-surface-800 rounded-xl p-4"
              >
                <div className="flex items-center gap-2 text-success mb-2">
                  <Users className="h-5 w-5" />
                  <span className="text-sm">Unique Users</span>
                </div>
                <p className="text-2xl font-bold">{stats.uniqueUsers}</p>
                <p className="text-xs text-surface-500 mt-1">participated</p>
              </motion.div>

              <motion.div
                whileHover={{ scale: 1.02, y: -2 }}
                className="bg-surface-900 border border-surface-800 rounded-xl p-4"
              >
                <div className="flex items-center gap-2 text-warning mb-2">
                  <Clock className="h-5 w-5" />
                  <span className="text-sm">Last 24h</span>
                </div>
                <p className="text-2xl font-bold">{stats.battlesLast24h}</p>
                <p className="text-xs text-surface-500 mt-1">battles fought</p>
              </motion.div>
            </div>
          )}

          {/* Overview Tab */}
          {activeTab === 'overview' && stats && (
            <div className="space-y-6">
              <div className="bg-surface-900 border border-surface-800 rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-4">System Health</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-surface-400 mb-1">Avg Battle Duration</p>
                    <p className="text-xl font-semibold">{formatDuration(stats.avgDurationMs)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-surface-400 mb-1">Completion Rate</p>
                    <p className="text-xl font-semibold">
                      {stats.totalBattles > 0
                        ? Math.round((stats.completedBattles / stats.totalBattles) * 100)
                        : 0}%
                    </p>
                  </div>
                </div>
              </div>

              {spendingSummary && (
                <div className="bg-surface-900 border border-surface-800 rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <DollarSign className="h-5 w-5 text-success" />
                    Spending Summary
                  </h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-surface-400 mb-1">Today</p>
                      <p className="text-xl font-semibold text-success">
                        ${parseFloat(spendingSummary.totalDailySpending).toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-surface-400 mb-1">This Month</p>
                      <p className="text-xl font-semibold text-success">
                        ${parseFloat(spendingSummary.totalMonthlySpending).toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-surface-400 mb-1">Active Users</p>
                      <p className="text-xl font-semibold">{spendingSummary.activeUsers}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Recent Battles Tab */}
          {activeTab === 'battles' && (
            <div className="space-y-3">
              {loading ? (
                <div className="text-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary-400 mx-auto" />
                </div>
              ) : recentBattles.length === 0 ? (
                <div className="text-center py-12">
                  <Bot className="h-12 w-12 text-surface-600 mx-auto mb-4" />
                  <p className="text-surface-400">No battles yet</p>
                </div>
              ) : (
                recentBattles.map((battle, index) => (
                  <motion.div
                    key={battle.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="bg-surface-900 border border-surface-800 rounded-xl p-4"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="text-center">
                          <AvatarDisplay user={battle.player1} size="md" />
                          <p className="text-xs text-surface-500 mt-1">
                            @{battle.player1.username}
                          </p>
                        </div>
                        <div className="text-surface-500">vs</div>
                        <div className="text-center">
                          <AvatarDisplay user={battle.player2} size="md" />
                          <p className="text-xs text-surface-500 mt-1">
                            @{battle.player2.username}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          battle.status === 'completed'
                            ? 'bg-success/20 text-success'
                            : 'bg-warning/20 text-warning'
                        }`}>
                          {battle.status}
                        </span>
                        <p className="text-xs text-surface-500 mt-1">
                          {formatDate(battle.createdAt)}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-surface-400">Model:</span>
                          <span className="font-medium">{battle.player1.loadout?.model || 'N/A'}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-surface-400">Time:</span>
                          <span>{formatDuration(battle.player1.timeMs)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-surface-400">Tokens:</span>
                          <span>{battle.player1.tokensUsed || 0}</span>
                        </div>
                        {battle.winnerId === battle.player1.id && (
                          <div className="flex items-center gap-1 text-success">
                            <Zap className="h-4 w-4" />
                            <span className="font-semibold">Winner</span>
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-surface-400">Model:</span>
                          <span className="font-medium">{battle.player2.loadout?.model || 'N/A'}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-surface-400">Time:</span>
                          <span>{formatDuration(battle.player2.timeMs)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-surface-400">Tokens:</span>
                          <span>{battle.player2.tokensUsed || 0}</span>
                        </div>
                        {battle.winnerId === battle.player2.id && (
                          <div className="flex items-center gap-1 text-success">
                            <Zap className="h-4 w-4" />
                            <span className="font-semibold">Winner</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          )}

          {/* Rate Limits Tab */}
          {activeTab === 'limits' && (
            <div className="space-y-3">
              {rateLimitUsers.length === 0 ? (
                <div className="text-center py-12">
                  <AlertCircle className="h-12 w-12 text-surface-600 mx-auto mb-4" />
                  <p className="text-surface-400">No users near rate limits</p>
                </div>
              ) : (
                rateLimitUsers.map((user) => (
                  <motion.div
                    key={user.userId}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`bg-surface-900 border rounded-xl p-4 ${
                      user.atLimit ? 'border-error' : 'border-warning'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-semibold">@{user.username}</p>
                        <p className="text-sm text-surface-400">{user.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          user.isPro
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-surface-700 text-surface-300'
                        }`}>
                          {user.isPro ? 'Pro' : 'Free'}
                        </span>
                        <button
                          onClick={() => showConfirmation(
                            'reset-rate-limit',
                            `Reset rate limit for @${user.username}?`,
                            () => resetRateLimit(user.userId)
                          )}
                          className="px-3 py-1.5 bg-primary-500 hover:bg-primary-600 rounded-lg text-sm font-medium transition-colors flex items-center gap-1"
                          title="Reset Rate Limit"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Reset
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-surface-400 mb-1">Daily Usage</p>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-surface-800 rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-full ${
                                user.dailyPercentage >= 100
                                  ? 'bg-error'
                                  : user.dailyPercentage >= 80
                                  ? 'bg-warning'
                                  : 'bg-success'
                              }`}
                              style={{ width: `${Math.min(user.dailyPercentage, 100)}%` }}
                            />
                          </div>
                          <span className="text-sm font-medium">{user.dailyPercentage}%</span>
                        </div>
                        <p className="text-xs text-surface-500 mt-1">
                          ${user.dailySpend.toFixed(2)} / ${user.dailyLimit.toFixed(2)}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-surface-400 mb-1">Monthly Usage</p>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-surface-800 rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-full ${
                                user.monthlyPercentage >= 100
                                  ? 'bg-error'
                                  : user.monthlyPercentage >= 80
                                  ? 'bg-warning'
                                  : 'bg-success'
                              }`}
                              style={{ width: `${Math.min(user.monthlyPercentage, 100)}%` }}
                            />
                          </div>
                          <span className="text-sm font-medium">{user.monthlyPercentage}%</span>
                        </div>
                        <p className="text-xs text-surface-500 mt-1">
                          ${user.monthlySpend.toFixed(2)} / ${user.monthlyLimit.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          )}

          {/* Spending Tab */}
          {activeTab === 'spending' && (
            <div className="space-y-3">
              {spendingData.length === 0 ? (
                <div className="text-center py-12">
                  <DollarSign className="h-12 w-12 text-surface-600 mx-auto mb-4" />
                  <p className="text-surface-400">No spending data yet</p>
                </div>
              ) : (
                <div className="bg-surface-900 border border-surface-800 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-surface-800">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-surface-400">User</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-surface-400">Type</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-surface-400">Daily</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-surface-400">Monthly</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-surface-400">Battles</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-surface-400">Avg/Battle</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-surface-400">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-800">
                        {spendingData.map((user) => (
                          <tr key={user.userId} className="hover:bg-surface-800/50">
                            <td className="px-4 py-3">
                              <Link href={`/profile/${user.username}`} className="text-primary-400 hover:text-primary-300">
                                @{user.username}
                              </Link>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-1 text-xs rounded-full ${
                                user.isPro
                                  ? 'bg-amber-500/20 text-amber-400'
                                  : 'bg-surface-700 text-surface-300'
                              }`}>
                                {user.isPro ? 'Pro' : 'Free'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="text-sm font-medium">${user.dailySpend.toFixed(2)}</div>
                              <div className="text-xs text-surface-500">
                                / ${user.dailyLimit.toFixed(2)}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="text-sm font-medium">${user.monthlySpend.toFixed(2)}</div>
                              <div className="text-xs text-surface-500">
                                / ${user.monthlyLimit.toFixed(2)}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="text-sm font-medium">{user.totalBattles}</div>
                              <div className="text-xs text-surface-500">
                                {user.battlesLast24h} today
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right text-sm">
                              ${user.avgCostPerBattle}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => showConfirmation(
                                    'reset-spending',
                                    `Reset spending for @${user.username}?`,
                                    () => resetSpending(user.userId)
                                  )}
                                  className="px-2 py-1 bg-primary-500 hover:bg-primary-600 rounded text-xs font-medium transition-colors"
                                  title="Reset Spending"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={() => {
                                    setBanTarget(user);
                                    setShowBanModal(true);
                                  }}
                                  className="px-2 py-1 bg-error hover:bg-error/80 rounded text-xs font-medium transition-colors"
                                  title="Ban User"
                                >
                                  <Ban className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Banned Users Tab */}
          {activeTab === 'banned' && (
            <div className="space-y-3">
              {bannedUsers.length === 0 ? (
                <div className="text-center py-12">
                  <UserX className="h-12 w-12 text-surface-600 mx-auto mb-4" />
                  <p className="text-surface-400">No banned users</p>
                </div>
              ) : (
                bannedUsers.map((ban) => (
                  <motion.div
                    key={ban.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-surface-900 border border-error rounded-xl p-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <AvatarDisplay avatar={ban.avatar} size="md" />
                        <div>
                          <p className="font-semibold">@{ban.username}</p>
                          <p className="text-sm text-surface-400">{ban.email}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => showConfirmation(
                          'unban',
                          `Unban @${ban.username}?`,
                          () => unbanUser(ban.userId, ban.username)
                        )}
                        className="px-3 py-1.5 bg-success hover:bg-success/80 rounded-lg text-sm font-medium transition-colors flex items-center gap-1"
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                        Unban
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-xs text-surface-400 mb-1">Banned At</p>
                        <p>{formatDate(ban.bannedAt)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-surface-400 mb-1">Expires</p>
                        <p>{getTimeRemaining(ban.bannedUntil)}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-xs text-surface-400 mb-1">Reason</p>
                        <p className="text-sm">{ban.reason || 'No reason provided'}</p>
                      </div>
                      {ban.bannedByUsername && (
                        <div className="col-span-2">
                          <p className="text-xs text-surface-400 mb-1">Banned By</p>
                          <p className="text-sm">@{ban.bannedByUsername}</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          )}

          {/* Module Balance Tab */}
          {activeTab === 'modules' && (
            <div className="space-y-6">
              {/* Balance Summary */}
              {moduleStats?.summary && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <motion.div
                    whileHover={{ scale: 1.02, y: -2 }}
                    className="bg-surface-900 border border-surface-800 rounded-xl p-4"
                  >
                    <div className="flex items-center gap-2 text-purple-400 mb-2">
                      <Puzzle className="h-5 w-5" />
                      <span className="text-sm">Modules Tracked</span>
                    </div>
                    <p className="text-2xl font-bold">{moduleStats.summary.totalModulesTracked}</p>
                    <p className="text-xs text-surface-500 mt-1">in last {moduleStats.dateRange?.days || 30} days</p>
                  </motion.div>

                  <motion.div
                    whileHover={{ scale: 1.02, y: -2 }}
                    className="bg-surface-900 border border-surface-800 rounded-xl p-4"
                  >
                    <div className="flex items-center gap-2 text-warning mb-2">
                      <Scale className="h-5 w-5" />
                      <span className="text-sm">Imbalanced</span>
                    </div>
                    <p className="text-2xl font-bold">{moduleStats.summary.imbalancedCount}</p>
                    <p className="text-xs text-surface-500 mt-1">need attention</p>
                  </motion.div>

                  <motion.div
                    whileHover={{ scale: 1.02, y: -2 }}
                    className="bg-surface-900 border border-surface-800 rounded-xl p-4"
                  >
                    <div className="flex items-center gap-2 text-error mb-2">
                      <ArrowUp className="h-5 w-5" />
                      <span className="text-sm">Overpowered</span>
                    </div>
                    <p className="text-2xl font-bold">{moduleStats.summary.overpowered?.length || 0}</p>
                    <p className="text-xs text-surface-500 mt-1">&gt;60% win rate</p>
                  </motion.div>

                  <motion.div
                    whileHover={{ scale: 1.02, y: -2 }}
                    className="bg-surface-900 border border-surface-800 rounded-xl p-4"
                  >
                    <div className="flex items-center gap-2 text-primary-400 mb-2">
                      <ArrowDown className="h-5 w-5" />
                      <span className="text-sm">Underpowered</span>
                    </div>
                    <p className="text-2xl font-bold">{moduleStats.summary.underpowered?.length || 0}</p>
                    <p className="text-xs text-surface-500 mt-1">&lt;40% win rate</p>
                  </motion.div>
                </div>
              )}

              {/* Module Stats Table */}
              <div className="bg-surface-900 border border-surface-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-surface-800 flex items-center justify-between">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Puzzle className="h-5 w-5 text-purple-400" />
                    Module Win Rates
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-surface-800">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-surface-400">Module</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-surface-400">Category</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-surface-400">Uses</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-surface-400">Wins</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-surface-400">Losses</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-surface-400">Win Rate</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-surface-400">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-800">
                      {moduleStats?.stats?.length === 0 ? (
                        <tr>
                          <td colSpan="7" className="px-4 py-8 text-center text-surface-400">
                            No module data yet. Battles will populate this once modules are used.
                          </td>
                        </tr>
                      ) : (
                        moduleStats?.stats?.map((stat) => (
                          <tr key={stat.moduleId} className="hover:bg-surface-800/50">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{stat.module?.name || stat.moduleId}</span>
                                {stat.module?.isDefault && (
                                  <span className="px-1.5 py-0.5 text-xs bg-surface-700 text-surface-300 rounded">
                                    Default
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-surface-400 capitalize">
                              {stat.module?.category || '-'}
                            </td>
                            <td className="px-4 py-3 text-right text-sm">{stat.totalUses}</td>
                            <td className="px-4 py-3 text-right text-sm text-success">{stat.totalWins}</td>
                            <td className="px-4 py-3 text-right text-sm text-error">{stat.totalLosses}</td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-16 bg-surface-800 rounded-full h-2 overflow-hidden">
                                  <div
                                    className={`h-full ${
                                      stat.winRate > 60
                                        ? 'bg-error'
                                        : stat.winRate < 40
                                        ? 'bg-primary-400'
                                        : 'bg-success'
                                    }`}
                                    style={{ width: `${stat.winRate}%` }}
                                  />
                                </div>
                                <span className="text-sm font-medium w-12 text-right">{stat.winRate}%</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center">
                              {stat.balanceStatus === 'insufficient_data' ? (
                                <span className="px-2 py-1 text-xs bg-surface-700 text-surface-300 rounded-full flex items-center gap-1 justify-center">
                                  <Minus className="h-3 w-3" />
                                  Low Data
                                </span>
                              ) : stat.balanceStatus === 'overpowered' ? (
                                <span className="px-2 py-1 text-xs bg-error/20 text-error rounded-full flex items-center gap-1 justify-center">
                                  <ArrowUp className="h-3 w-3" />
                                  OP
                                </span>
                              ) : stat.balanceStatus === 'underpowered' ? (
                                <span className="px-2 py-1 text-xs bg-primary-500/20 text-primary-400 rounded-full flex items-center gap-1 justify-center">
                                  <ArrowDown className="h-3 w-3" />
                                  Weak
                                </span>
                              ) : (
                                <span className="px-2 py-1 text-xs bg-success/20 text-success rounded-full flex items-center gap-1 justify-center">
                                  <CheckCircle className="h-3 w-3" />
                                  OK
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Module Combinations */}
              {moduleCombinations?.topCombos?.length > 0 && (
                <div className="bg-surface-900 border border-surface-800 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-surface-800">
                    <h3 className="font-semibold flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-success" />
                      Top Module Combinations
                    </h3>
                  </div>
                  <div className="p-4 grid gap-3">
                    {moduleCombinations.topCombos.map((combo, idx) => (
                      <div
                        key={combo.combination}
                        className={`flex items-center justify-between p-3 rounded-lg ${
                          combo.isEffective ? 'bg-success/10 border border-success/30' : 'bg-surface-800'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-surface-500 font-mono text-sm">#{idx + 1}</span>
                          <div>
                            <div className="font-medium">{combo.moduleNames.join(' + ')}</div>
                            <div className="text-xs text-surface-400">{combo.uses} uses</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`font-semibold ${
                            combo.winRate > 55 ? 'text-success' : combo.winRate < 45 ? 'text-error' : 'text-surface-300'
                          }`}>
                            {combo.winRate}% win
                          </div>
                          <div className="text-xs text-surface-400">{combo.wins}W / {combo.uses - combo.wins}L</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function AgentBattlesAdminPageGated(props) {
  return <AgentBattlesGate><AgentBattlesAdminPage {...props} /></AgentBattlesGate>
}
