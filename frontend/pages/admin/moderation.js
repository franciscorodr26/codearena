import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import {
  Shield,
  ShieldCheck,
  AlertTriangle,
  Flag,
  Ban,
  CheckCircle,
  XCircle,
  Clock,
  User,
  ArrowLeft,
  Loader2,
  RefreshCw,
  Eye,
  Trash2,
  Search,
  Users,
  MessageSquare,
  Star,
  Mail,
  Bug,
  Crown,
  Lightbulb
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { config } from '../../config/env';
import AvatarDisplay from '../../components/ui/AvatarDisplay';
import FloatingOrbs from '../../components/ui/FloatingOrbs';

const REPORT_STATUS_COLORS = {
  pending: 'bg-warning/20 text-warning border-warning/30',
  reviewed: 'bg-primary-500/20 text-primary-400 border-primary-500/30',
  resolved: 'bg-success/20 text-success border-success/30',
  dismissed: 'bg-surface-500/20 text-surface-400 border-surface-500/30'
};

const REASON_LABELS = {
  harassment: 'Harassment',
  spam: 'Spam',
  cheating: 'Cheating',
  inappropriate_content: 'Inappropriate Content',
  impersonation: 'Impersonation',
  other: 'Other'
};

const PRO_PLAN_LABELS = {
  monthly: 'Monthly',
  three_month: '3-month',
  annual: 'Annual'
};

export default function AdminModerationPage() {
  const router = useRouter();
  const { user, token, loading: authLoading } = useAuth();

  const [reports, setReports] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [actionLoading, setActionLoading] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const [banModal, setBanModal] = useState(null);
  const [banReason, setBanReason] = useState('');
  const [banDuration, setBanDuration] = useState(24);
  const [isPermanent, setIsPermanent] = useState(false);
  const [activeTab, setActiveTab] = useState('reports'); // 'reports', 'users', or 'feedback'
  const [userSearch, setUserSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [deleteModal, setDeleteModal] = useState(null);
  const [feedbackList, setFeedbackList] = useState([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackCount, setFeedbackCount] = useState(0);
  const [bugReports, setBugReports] = useState([]);
  const [bugReportsLoading, setBugReportsLoading] = useState(false);
  const [bugReportsNewCount, setBugReportsNewCount] = useState(0);
  const [bugReportFilter, setBugReportFilter] = useState('all');
  const [selectedBugReport, setSelectedBugReport] = useState(null);
  const [featureRequests, setFeatureRequests] = useState([]);
  const [featureRequestsLoading, setFeatureRequestsLoading] = useState(false);
  const [featureRequestsNewCount, setFeatureRequestsNewCount] = useState(0);
  const [featureRequestFilter, setFeatureRequestFilter] = useState('all');
  const [featureRequestCategoryFilter, setFeatureRequestCategoryFilter] = useState('all');
  const [expandedFeatureRequest, setExpandedFeatureRequest] = useState(null);
  const [showBannedOnly, setShowBannedOnly] = useState(false);
  const [showProOnly, setShowProOnly] = useState(false);
  const [sortBy, setSortBy] = useState('rating_desc');
  const [actionNotice, setActionNotice] = useState(null);
  const [proActionLoading, setProActionLoading] = useState(null);

  // Fetch reports
  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${config.backend_url}/api/moderation/admin/reports${filter ? `?status=${filter}` : ''}`,
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
        setReports(data.reports);
      }
    } catch (err) {
      setError('Failed to fetch reports');
    } finally {
      setLoading(false);
    }
  }, [token, filter]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(
        `${config.backend_url}/api/moderation/admin/stats`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      const data = await response.json();
      if (data.success) {
        setStats(data.stats);
        // Initialize counts from stats so they show immediately
        if (data.stats.feedbackCount !== undefined) {
          setFeedbackCount(data.stats.feedbackCount);
        }
        if (data.stats.bugReportsNew !== undefined) {
          setBugReportsNewCount(data.stats.bugReportsNew);
        }
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, [token]);

  // Fetch all users
  const fetchAllUsers = useCallback(async (filters = {}) => {
    setUsersLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (filters.proOnly) params.append('proOnly', 'true');
      if (filters.bannedOnly) params.append('bannedOnly', 'true');
      if (filters.sortBy) params.append('sortBy', filters.sortBy);

      const response = await fetch(
        `${config.backend_url}/api/moderation/admin/users?${params}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      const data = await response.json();
      if (data.users) {
        setAllUsers(data.users);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setUsersLoading(false);
    }
  }, [token]);

  // Fetch user feedback
  const fetchFeedback = useCallback(async () => {
    setFeedbackLoading(true);
    try {
      const response = await fetch(
        `${config.backend_url}/feedback`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      const data = await response.json();
      if (data.feedback) {
        setFeedbackList(data.feedback);
        setFeedbackCount(data.count || data.feedback.length);
      }
    } catch (err) {
      console.error('Failed to fetch feedback:', err);
    } finally {
      setFeedbackLoading(false);
    }
  }, [token]);

  // Delete feedback
  const deleteFeedback = async (feedbackId) => {
    if (!confirm('Delete this feedback?')) return;
    try {
      const response = await fetch(
        `${config.backend_url}/feedback/${feedbackId}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      if (response.ok) {
        setFeedbackList(prev => prev.filter(fb => fb.id !== feedbackId));
        setFeedbackCount(prev => prev - 1);
      }
    } catch (err) {
      console.error('Failed to delete feedback:', err);
    }
  };

  // Fetch bug reports
  const fetchBugReports = useCallback(async () => {
    setBugReportsLoading(true);
    try {
      const response = await fetch(
        `${config.backend_url}/api/bug-reports/admin${bugReportFilter !== 'all' ? `?status=${bugReportFilter}` : ''}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      const data = await response.json();
      if (data.success) {
        setBugReports(data.reports);
        setBugReportsNewCount(data.newCount || 0);
      }
    } catch (err) {
      console.error('Failed to fetch bug reports:', err);
    } finally {
      setBugReportsLoading(false);
    }
  }, [token, bugReportFilter]);

  // Update bug report status
  const updateBugReportStatus = async (reportId, status, adminNotes = null) => {
    try {
      const response = await fetch(
        `${config.backend_url}/api/bug-reports/admin/${reportId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ status, adminNotes })
        }
      );
      if (response.ok) {
        setBugReports(prev => prev.map(r => r.id === reportId ? { ...r, status, admin_notes: adminNotes } : r));
        if (status !== 'new') {
          setBugReportsNewCount(prev => Math.max(0, prev - 1));
        }
      }
    } catch (err) {
      console.error('Failed to update bug report:', err);
    }
  };

  // Delete bug report
  const deleteBugReport = async (reportId) => {
    if (!confirm('Delete this bug report?')) return;
    try {
      const response = await fetch(
        `${config.backend_url}/api/bug-reports/admin/${reportId}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      if (response.ok) {
        const deletedReport = bugReports.find(r => r.id === reportId);
        setBugReports(prev => prev.filter(r => r.id !== reportId));
        if (deletedReport?.status === 'new') {
          setBugReportsNewCount(prev => Math.max(0, prev - 1));
        }
      }
    } catch (err) {
      console.error('Failed to delete bug report:', err);
    }
  };

  // Fetch feature requests
  const fetchFeatureRequests = useCallback(async () => {
    setFeatureRequestsLoading(true);
    try {
      const params = new URLSearchParams();
      if (featureRequestFilter !== 'all') params.append('status', featureRequestFilter);
      if (featureRequestCategoryFilter !== 'all') params.append('category', featureRequestCategoryFilter);
      const queryString = params.toString();
      const response = await fetch(
        `${config.backend_url}/api/feature-requests/admin${queryString ? `?${queryString}` : ''}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      const data = await response.json();
      if (data.success) {
        setFeatureRequests(Array.isArray(data.featureRequests) ? data.featureRequests : []);
        setFeatureRequestsNewCount(data.newCount || 0);
      }
    } catch (err) {
      console.error('Failed to fetch feature requests:', err);
    } finally {
      setFeatureRequestsLoading(false);
    }
  }, [token, featureRequestFilter, featureRequestCategoryFilter]);

  // Update feature request status
  const updateFeatureRequestStatus = async (requestId, status) => {
    try {
      const response = await fetch(
        `${config.backend_url}/api/feature-requests/admin/${requestId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ status })
        }
      );
      if (response.ok) {
        setFeatureRequests(prev => prev.map(r => r.id === requestId ? { ...r, status } : r));
        if (status !== 'new') {
          setFeatureRequestsNewCount(prev => Math.max(0, prev - 1));
        }
      }
    } catch (err) {
      console.error('Failed to update feature request:', err);
    }
  };

  // Delete feature request
  const deleteFeatureRequest = async (requestId) => {
    if (!confirm('Delete this feature request?')) return;
    try {
      const response = await fetch(
        `${config.backend_url}/api/feature-requests/admin/${requestId}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      if (response.ok) {
        const deletedRequest = featureRequests.find(r => r.id === requestId);
        setFeatureRequests(prev => prev.filter(r => r.id !== requestId));
        if (deletedRequest?.status === 'new') {
          setFeatureRequestsNewCount(prev => Math.max(0, prev - 1));
        }
      }
    } catch (err) {
      console.error('Failed to delete feature request:', err);
    }
  };

  // Search users
  const searchUsers = useCallback(async (query) => {
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    try {
      const response = await fetch(
        `${config.backend_url}/api/users/search?q=${encodeURIComponent(query)}&limit=20`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      const data = await response.json();
      if (data.users) {
        setSearchResults(data.users);
      }
    } catch (err) {
      console.error('Failed to search users:', err);
    } finally {
      setSearchLoading(false);
    }
  }, [token]);

  // Delete user
  const handleDeleteUser = async () => {
    if (!deleteModal) return;
    setActionLoading('delete');
    try {
      const response = await fetch(
        `${config.backend_url}/api/moderation/admin/users/${deleteModal.userId}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      const data = await response.json();
      if (data.success) {
        setDeleteModal(null);
        setSearchResults(prev => prev.filter(u => u.id !== deleteModal.userId));
        setAllUsers(prev => prev.filter(u => u.id !== deleteModal.userId));
        fetchStats();
        alert(`User ${deleteModal.username} has been deleted`);
      } else {
        alert(data.error || 'Failed to delete user');
      }
    } catch (err) {
      console.error('Failed to delete user:', err);
      alert('Failed to delete user');
    } finally {
      setActionLoading(null);
    }
  };

  useEffect(() => {
    if (token) {
      fetchReports();
      fetchStats();
    }
  }, [token, fetchReports, fetchStats]);

  // Fetch all users when switching to Users tab or when filters change
  useEffect(() => {
    if (token && activeTab === 'users') {
      fetchAllUsers({ proOnly: showProOnly, bannedOnly: showBannedOnly, sortBy });
    }
  }, [token, activeTab, showProOnly, showBannedOnly, sortBy, fetchAllUsers]);

  // Fetch feedback when switching to Feedback tab
  useEffect(() => {
    if (token && activeTab === 'feedback' && feedbackList.length === 0) {
      fetchFeedback();
    }
  }, [token, activeTab, feedbackList.length, fetchFeedback]);

  // Fetch bug reports when switching to Bug Reports tab
  useEffect(() => {
    if (token && activeTab === 'bugs') {
      fetchBugReports();
    }
  }, [token, activeTab, bugReportFilter, fetchBugReports]);

  // Fetch feature requests when switching to Feature Requests tab
  useEffect(() => {
    if (token && activeTab === 'features') {
      fetchFeatureRequests();
    }
  }, [token, activeTab, featureRequestFilter, featureRequestCategoryFilter, fetchFeatureRequests]);

  // Debounced user search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (userSearch) {
        searchUsers(userSearch);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [userSearch, searchUsers]);

  // Handle report action
  const handleReportAction = async (reportId, status, resolution = null) => {
    setActionLoading(reportId);
    try {
      const response = await fetch(
        `${config.backend_url}/api/moderation/admin/reports/${reportId}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ status, resolution })
        }
      );

      if (response.ok) {
        fetchReports();
        setSelectedReport(null);
      }
    } catch (err) {
      console.error('Failed to update report:', err);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle ban user
  const handleBanUser = async () => {
    if (!banModal || !banReason) return;

    setActionLoading('ban');
    try {
      const response = await fetch(
        `${config.backend_url}/api/moderation/admin/ban`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            userId: banModal.userId,
            reason: banReason,
            duration: isPermanent ? null : banDuration,
            isPermanent
          })
        }
      );

      const data = await response.json();
      if (data.success) {
        setBanModal(null);
        setBanReason('');
        fetchReports();
        fetchStats();
      } else {
        alert(data.error || 'Failed to ban user');
      }
    } catch (err) {
      console.error('Failed to ban user:', err);
    } finally {
      setActionLoading(null);
    }
  };

  // Format date
  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatProExpiry = (dateStr) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const showActionNotice = (message, type = 'success') => {
    setActionNotice({ message, type });
  };

  const updateVisibleUserProStatus = (userId, isPro, expiresAt = null) => {
    const applyUpdate = (users) => users.map((u) => (
      u.id === userId
        ? { ...u, is_pro: isPro ? 1 : 0, pro_expires_at: expiresAt }
        : u
    ));

    setAllUsers((prev) => {
      const updated = applyUpdate(prev);
      return showProOnly && !isPro
        ? updated.filter((u) => u.id !== userId)
        : updated;
    });
    setSearchResults((prev) => applyUpdate(prev));
  };

  // Activate Pro for a user
  const activatePro = async (userId, username, plan) => {
    const planLabel = PRO_PLAN_LABELS[plan] || 'Monthly';
    const actionKey = `${userId}:${plan}`;
    setProActionLoading(actionKey);
    setActionNotice(null);
    try {
      const response = await fetch(
        `${config.backend_url}/api/moderation/admin/users/${userId}/activate-pro`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ plan })
        }
      );
      const data = await response.json();
      if (data.success) {
        updateVisibleUserProStatus(userId, true, data.expiresAt);
        showActionNotice(`${planLabel} Pro granted to @${username} until ${formatProExpiry(data.expiresAt)}.`);
        fetchStats();
      } else {
        showActionNotice(data.error || 'Failed to activate Pro', 'error');
      }
    } catch (err) {
      console.error('Failed to activate Pro:', err);
      showActionNotice('Error activating Pro', 'error');
    } finally {
      setProActionLoading(null);
    }
  };

  // Deactivate Pro for a user
  const deactivatePro = async (userId, username) => {
    setProActionLoading(`${userId}:deactivate`);
    setActionNotice(null);
    try {
      const response = await fetch(
        `${config.backend_url}/api/moderation/admin/users/${userId}/deactivate-pro`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        }
      );
      const data = await response.json();
      if (data.success) {
        updateVisibleUserProStatus(userId, false);
        showActionNotice(`Pro disabled for @${username}.`);
        fetchStats();
      } else {
        showActionNotice(data.error || 'Failed to disable Pro', 'error');
      }
    } catch (err) {
      console.error('Failed to disable Pro:', err);
      showActionNotice('Failed to disable Pro', 'error');
    } finally {
      setProActionLoading(null);
    }
  };

  // User row component for reuse
  const UserRow = ({ user, onBan, onDelete, showDate }) => (
    <div className={`bg-surface-900 border rounded-xl p-4 flex items-center justify-between gap-4 ${user.is_banned ? 'border-error/50' : 'border-surface-800'}`}>
      <div className="flex items-center gap-3">
        <AvatarDisplay user={user} size="md" />
        <div>
          <div className="flex items-center gap-2">
            <p className="font-semibold text-white">@{user.username}</p>
            {user.is_banned === 1 && (
              <span className="px-1.5 py-0.5 text-xs bg-error/20 text-error rounded flex items-center gap-1">
                <Ban className="h-3 w-3" />
                Banned
              </span>
            )}
            {user.is_pro === 1 && (
              <>
                <span className="px-1.5 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded flex items-center gap-1">
                  <Crown className="h-3 w-3" />
                  Pro
                </span>
                {user.pro_expires_at && (
                  <span className="text-xs text-amber-300">
                    Until {formatProExpiry(user.pro_expires_at)}
                  </span>
                )}
              </>
            )}
          </div>
          <p className="text-sm text-surface-400">
            Rating: {user.rating || 1000} • {user.wins || 0}W / {user.losses || 0}L
            {showDate && user.created_at && (
              <span className="ml-2 text-surface-500">
                • Joined {new Date(user.created_at).toLocaleDateString()}
              </span>
            )}
          </p>
          {user.is_banned === 1 && user.ban_reason && (
            <p className="text-sm text-error mt-1">
              Reason: {user.ban_reason}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 flex-wrap">
        {user.is_pro === 1 ? (
          <>
            <button
              onClick={() => activatePro(user.id, user.username, 'three_month')}
              disabled={proActionLoading === `${user.id}:three_month`}
              className="px-2 py-1.5 text-xs bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1"
              title="Extend Pro by 3 months"
            >
              {proActionLoading === `${user.id}:three_month` ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Crown className="h-3 w-3" />
              )}
              {proActionLoading === `${user.id}:three_month` ? 'Updating' : '+3 Months'}
            </button>
            <button
              onClick={() => deactivatePro(user.id, user.username)}
              disabled={proActionLoading === `${user.id}:deactivate`}
              className="px-2 py-1.5 text-xs bg-error/20 text-error hover:bg-error/30 disabled:opacity-50 rounded-lg transition-colors"
              title="Disable Pro access"
            >
              {proActionLoading === `${user.id}:deactivate` ? 'Updating' : 'Disable Pro'}
            </button>
          </>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={() => activatePro(user.id, user.username, 'three_month')}
              disabled={proActionLoading === `${user.id}:three_month`}
              className="px-2 py-1.5 text-xs bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1"
              title="Grant 3 months Pro"
            >
              {proActionLoading === `${user.id}:three_month` ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Crown className="h-3 w-3" />
              )}
              {proActionLoading === `${user.id}:three_month` ? 'Updating' : 'Grant 3 Months'}
            </button>
            <button
              onClick={() => activatePro(user.id, user.username, 'monthly')}
              disabled={proActionLoading === `${user.id}:monthly`}
              className="px-2 py-1.5 text-xs bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-50 rounded-lg transition-colors"
              title="Enable Monthly Pro"
            >
              {proActionLoading === `${user.id}:monthly` ? 'Updating' : 'Enable Monthly'}
            </button>
            <button
              onClick={() => activatePro(user.id, user.username, 'annual')}
              disabled={proActionLoading === `${user.id}:annual`}
              className="px-2 py-1.5 text-xs bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-50 rounded-lg transition-colors"
              title="Enable Annual Pro"
            >
              {proActionLoading === `${user.id}:annual` ? 'Updating' : 'Enable Annual'}
            </button>
          </div>
        )}
        <Link
          href={`/profile/${user.username}`}
          className="px-3 py-1.5 text-sm bg-surface-800 hover:bg-surface-700 rounded-lg transition-colors flex items-center gap-1"
        >
          <Eye className="h-4 w-4" />
          View
        </Link>
        <button
          onClick={() => onBan({ userId: user.id, username: user.username })}
          className="px-3 py-1.5 text-sm bg-warning/20 text-warning hover:bg-warning/30 rounded-lg transition-colors flex items-center gap-1"
        >
          <Ban className="h-4 w-4" />
          Ban
        </button>
        <button
          onClick={() => onDelete({ userId: user.id, username: user.username })}
          className="px-3 py-1.5 text-sm bg-error/20 text-error hover:bg-error/30 rounded-lg transition-colors flex items-center gap-1"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </div>
    </div>
  );

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
        <title>Admin Moderation - CodeArena</title>
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">
        <FloatingOrbs />

        {/* Header */}
        <motion.header
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-surface-900/80 backdrop-blur-md border-b border-surface-800 px-6 py-4 sticky top-0 z-50"
        >
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-surface-400 hover:text-white transition-colors">
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div className="flex items-center gap-2">
                <Shield className="h-6 w-6 text-error" />
                <h1 className="text-xl font-bold">Admin Moderation</h1>
              </div>
            </div>
            <button
              onClick={() => { fetchReports(); fetchStats(); }}
              className="p-2 hover:bg-surface-800 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw className="h-5 w-5 text-surface-400" />
            </button>
          </div>
        </motion.header>

        <div className="max-w-7xl mx-auto p-6">
          {/* Admin Tools Nav */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <Link
              href="/admin/emails"
              className="flex items-center gap-3 p-4 rounded-xl bg-surface-900 border border-surface-800 hover:border-primary-500/50 hover:bg-surface-800 transition-colors"
            >
              <div className="p-2 rounded-lg bg-primary-500/10">
                <Mail className="h-5 w-5 text-primary-400" />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-white">Email Subscribers</div>
                <div className="text-xs text-surface-400 truncate">Subscriber counts per email type</div>
              </div>
            </Link>
            <Link
              href="/admin/trust"
              className="flex items-center gap-3 p-4 rounded-xl bg-surface-900 border border-surface-800 hover:border-primary-500/50 hover:bg-surface-800 transition-colors"
            >
              <div className="p-2 rounded-lg bg-success/10">
                <ShieldCheck className="h-5 w-5 text-success" />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-white">Trust &amp; Safety</div>
                <div className="text-xs text-surface-400 truncate">Trust score reviews</div>
              </div>
            </Link>
          </div>

          {/* Main Tabs */}
          <div className="flex items-center gap-1 mb-6 border-b border-surface-800">
            <button
              onClick={() => setActiveTab('reports')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px rounded-t-lg ${
                activeTab === 'reports'
                  ? 'border-warning text-warning bg-warning/10'
                  : 'border-transparent text-surface-400 hover:text-white hover:bg-surface-800/50'
              }`}
            >
              <Flag className="h-4 w-4" />
              Abuse Reports
            </button>
            <div className="h-6 w-px bg-surface-700" />
            <button
              onClick={() => setActiveTab('users')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px rounded-t-lg ${
                activeTab === 'users'
                  ? 'border-success text-success bg-success/10'
                  : 'border-transparent text-surface-400 hover:text-white hover:bg-surface-800/50'
              }`}
            >
              <Users className="h-4 w-4" />
              User Management
            </button>
            <div className="h-6 w-px bg-surface-700" />
            <button
              onClick={() => setActiveTab('feedback')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px rounded-t-lg ${
                activeTab === 'feedback'
                  ? 'border-secondary-500 text-secondary-400 bg-secondary-500/10'
                  : 'border-transparent text-surface-400 hover:text-white hover:bg-surface-800/50'
              }`}
            >
              <MessageSquare className="h-4 w-4" />
              Platform Feedback
              {feedbackCount > 0 && (
                <span className="ml-1 px-2 py-0.5 text-xs bg-secondary-500/20 text-secondary-400 rounded-full">
                  {feedbackCount}
                </span>
              )}
            </button>
            <div className="h-6 w-px bg-surface-700" />
            <button
              onClick={() => setActiveTab('bugs')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px rounded-t-lg ${
                activeTab === 'bugs'
                  ? 'border-accent-500 text-accent-400 bg-accent-500/10'
                  : 'border-transparent text-surface-400 hover:text-white hover:bg-surface-800/50'
              }`}
            >
              <Bug className="h-4 w-4" />
              Bug Reports
              {bugReportsNewCount > 0 && (
                <span className="ml-1 px-2 py-0.5 text-xs bg-accent-500/20 text-accent-400 rounded-full">
                  {bugReportsNewCount}
                </span>
              )}
            </button>
            <div className="h-6 w-px bg-surface-700" />
            <button
              onClick={() => setActiveTab('features')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px rounded-t-lg ${
                activeTab === 'features'
                  ? 'border-primary-500 text-primary-400 bg-primary-500/10'
                  : 'border-transparent text-surface-400 hover:text-white hover:bg-surface-800/50'
              }`}
            >
              <Lightbulb className="h-4 w-4" />
              Feature Requests
              {featureRequestsNewCount > 0 && (
                <span className="ml-1 px-2 py-0.5 text-xs bg-primary-500/20 text-primary-400 rounded-full">
                  {featureRequestsNewCount}
                </span>
              )}
            </button>
          </div>

          {/* Stats Cards */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <motion.button
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setFilter('pending');
                  setActiveTab('reports');
                }}
                className={`bg-surface-900 border rounded-xl p-4 text-left hover:border-warning/50 hover:bg-surface-800/50 transition-colors cursor-pointer ${activeTab === 'reports' ? 'border-warning/50' : 'border-surface-800'}`}
              >
                <div className="flex items-center gap-2 text-warning mb-2">
                  <Flag className="h-5 w-5" />
                  <span className="text-sm">Abuse Reports</span>
                </div>
                <p className="text-2xl font-bold">{stats.pendingReports || 0} <span className="text-sm font-normal text-surface-500">pending</span></p>
                <p className="text-xs text-surface-500 mt-1">{stats.totalReports || 0} total</p>
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setShowBannedOnly(false);
                  setShowProOnly(false);
                  setActiveTab('users');
                }}
                className={`bg-surface-900 border rounded-xl p-4 text-left hover:border-success/50 hover:bg-surface-800/50 transition-colors cursor-pointer ${activeTab === 'users' ? 'border-success/50' : 'border-surface-800'}`}
              >
                <div className="flex items-center gap-2 text-success mb-2">
                  <Users className="h-5 w-5" />
                  <span className="text-sm">Users</span>
                </div>
                <p className="text-2xl font-bold">{stats.totalUsers || 0}</p>
                <p className="text-xs text-surface-500 mt-1">{stats.proUsers || 0} Pro • {stats.bannedUsers || 0} banned</p>
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setActiveTab('feedback')}
                className={`bg-surface-900 border rounded-xl p-4 text-left hover:border-secondary-500/50 hover:bg-surface-800/50 transition-colors cursor-pointer ${activeTab === 'feedback' ? 'border-secondary-500/50' : 'border-surface-800'}`}
              >
                <div className="flex items-center gap-2 text-secondary-400 mb-2">
                  <MessageSquare className="h-5 w-5" />
                  <span className="text-sm">Feedback</span>
                </div>
                <p className="text-2xl font-bold">{stats.feedbackCount ?? feedbackCount}</p>
                <p className="text-xs text-surface-500 mt-1">submissions</p>
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setActiveTab('bugs')}
                className={`bg-surface-900 border rounded-xl p-4 text-left hover:border-accent-500/50 hover:bg-surface-800/50 transition-colors cursor-pointer ${activeTab === 'bugs' ? 'border-accent-500/50' : 'border-surface-800'}`}
              >
                <div className="flex items-center gap-2 text-accent-400 mb-2">
                  <Bug className="h-5 w-5" />
                  <span className="text-sm">Bug Reports</span>
                </div>
                <p className="text-2xl font-bold">{stats.bugReportsNew || bugReportsNewCount || 0} <span className="text-sm font-normal text-surface-500">new</span></p>
                <p className="text-xs text-surface-500 mt-1">{stats.bugReportsTotal || bugReports.length || 0} total</p>
              </motion.button>
            </div>
          )}

          {actionNotice && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`fixed top-20 right-6 z-[60] max-w-md border rounded-xl px-4 py-3 shadow-lg flex items-center justify-between gap-3 ${
                actionNotice.type === 'error'
                  ? 'bg-error/10 border-error/30 text-error'
                  : 'bg-success/10 border-success/30 text-success'
              }`}
              role="status"
            >
              <div className="flex items-center gap-2">
                {actionNotice.type === 'error' ? (
                  <AlertTriangle className="h-5 w-5" />
                ) : (
                  <CheckCircle className="h-5 w-5" />
                )}
                <span className="text-sm font-medium">{actionNotice.message}</span>
              </div>
              <button
                onClick={() => setActionNotice(null)}
                className="p-1 rounded-lg hover:bg-white/10 transition-colors"
                title="Dismiss message"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </motion.div>
          )}

          {/* Reports Tab Content */}
          {activeTab === 'reports' && (
            <>
              {/* Filter Tabs */}
              <div className="flex gap-2 mb-6">
                {['pending', 'reviewed', 'resolved', 'dismissed', ''].map((status) => (
                  <button
                    key={status || 'all'}
                    onClick={() => setFilter(status)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      filter === status
                        ? 'bg-primary-500 text-white'
                        : 'bg-surface-800 text-surface-400 hover:text-white'
                    }`}
                  >
                    {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'All'}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Users Tab Content */}
          {activeTab === 'users' && (
            <div className="space-y-6">
              {/* Filter Dropdown + Sort + Search */}
              <div className="flex gap-4">
                <select
                  value={showProOnly ? 'pro' : showBannedOnly ? 'banned' : 'all'}
                  onChange={(e) => {
                    const val = e.target.value;
                    setShowProOnly(val === 'pro');
                    setShowBannedOnly(val === 'banned');
                  }}
                  className="px-4 py-2.5 bg-surface-800 border border-surface-700 rounded-lg text-white focus:outline-none focus:border-primary-500"
                >
                  <option value="all">All Users ({stats?.totalUsers || 0})</option>
                  <option value="pro">Pro Users ({stats?.proUsers || 0})</option>
                  <option value="banned">Banned ({stats?.bannedUsers || 0})</option>
                </select>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="px-4 py-2.5 bg-surface-800 border border-surface-700 rounded-lg text-white focus:outline-none focus:border-primary-500"
                >
                  <option value="rating_desc">Sort: Rating (High to Low)</option>
                  <option value="rating_asc">Sort: Rating (Low to High)</option>
                  <option value="joined_desc">Sort: Joined (Newest First)</option>
                  <option value="joined_asc">Sort: Joined (Oldest First)</option>
                </select>

                {/* Search Box - only when viewing all users */}
                {!showBannedOnly && !showProOnly && (
                  <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-surface-500" />
                    <input
                      type="text"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Search users by username or email..."
                      className="w-full pl-12 pr-4 py-2.5 bg-surface-900 border border-surface-700 rounded-lg text-white placeholder-surface-500 focus:outline-none focus:border-primary-500"
                    />
                    {searchLoading && (
                      <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 animate-spin text-primary-400" />
                    )}
                  </div>
                )}
              </div>

              {/* Filtered/Search Results or All Users */}
              {showBannedOnly ? (
                // Show only banned users (backend pre-filtered)
                <div className="space-y-3">
                  {usersLoading ? (
                    <div className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-primary-400 mx-auto" />
                    </div>
                  ) : allUsers.length > 0 ? (
                    allUsers.map((u) => (
                      <UserRow key={u.id} user={u} onBan={setBanModal} onDelete={setDeleteModal} showDate />
                    ))
                  ) : (
                    <div className="text-center py-12">
                      <CheckCircle className="h-12 w-12 text-success mx-auto mb-4" />
                      <p className="text-surface-400">No banned users</p>
                    </div>
                  )}
                </div>
              ) : showProOnly ? (
                // Show only Pro users (backend pre-filtered)
                <div className="space-y-3">
                  {usersLoading ? (
                    <div className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-primary-400 mx-auto" />
                    </div>
                  ) : allUsers.length > 0 ? (
                    allUsers.map((u) => (
                      <UserRow key={u.id} user={u} onBan={setBanModal} onDelete={setDeleteModal} showDate />
                    ))
                  ) : (
                    <div className="text-center py-12">
                      <Star className="h-12 w-12 text-surface-600 mx-auto mb-4" />
                      <p className="text-surface-400">No Pro users yet</p>
                    </div>
                  )}
                </div>
              ) : userSearch.length >= 2 ? (
                // Show search results
                searchResults.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-sm text-surface-400 mb-2">Search results for "{userSearch}"</p>
                    {searchResults.map((u) => (
                      <UserRow key={u.id} user={u} onBan={setBanModal} onDelete={setDeleteModal} />
                    ))}
                  </div>
                ) : !searchLoading ? (
                  <div className="text-center py-12">
                    <User className="h-12 w-12 text-surface-600 mx-auto mb-4" />
                    <p className="text-surface-400">No users found matching "{userSearch}"</p>
                  </div>
                ) : null
              ) : (
                // Show all users
                <div className="space-y-3">
                  <p className="text-sm text-surface-400 mb-2">All users ({allUsers.length}) - {sortBy === 'joined_desc' ? 'newest first' : sortBy === 'joined_asc' ? 'oldest first' : sortBy === 'rating_asc' ? 'lowest rating first' : 'highest rating first'}</p>
                  {usersLoading ? (
                    <div className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-primary-400 mx-auto" />
                    </div>
                  ) : allUsers.length > 0 ? (
                    allUsers.map((u) => (
                      <UserRow key={u.id} user={u} onBan={setBanModal} onDelete={setDeleteModal} showDate />
                    ))
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-surface-400">No users found</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Feedback Tab Content */}
          {activeTab === 'feedback' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-surface-400">
                  User feedback submissions ({feedbackCount})
                </p>
                <button
                  onClick={fetchFeedback}
                  className="px-3 py-1.5 text-sm bg-surface-800 hover:bg-surface-700 rounded-lg transition-colors flex items-center gap-1"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </button>
              </div>

              {feedbackLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
                </div>
              ) : feedbackList.length === 0 ? (
                <div className="text-center py-12">
                  <MessageSquare className="h-12 w-12 text-surface-600 mx-auto mb-4" />
                  <p className="text-surface-400">No feedback submitted yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {feedbackList.map((fb) => (
                    <motion.div
                      key={fb.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-surface-900 border border-surface-800 rounded-xl p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          {/* Rating Stars */}
                          <div className="flex items-center gap-2 mb-2">
                            <div className="flex items-center">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Star
                                  key={star}
                                  className={`h-4 w-4 ${
                                    star <= fb.rating
                                      ? 'text-yellow-400 fill-yellow-400'
                                      : 'text-surface-600'
                                  }`}
                                />
                              ))}
                            </div>
                            <span className="text-sm text-surface-400">
                              {fb.rating}/5
                            </span>
                            {fb.standalone ? (
                              <span className="px-2 py-0.5 text-xs bg-primary-500/20 text-primary-400 rounded-full">
                                General
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 text-xs bg-success/20 text-success rounded-full">
                                Post-Battle
                              </span>
                            )}
                          </div>

                          {/* Player Info */}
                          <div className="flex items-center gap-2 text-sm text-surface-400 mb-2">
                            <User className="h-4 w-4" />
                            <span>{fb.player_name || 'Anonymous'}</span>
                            {fb.email && (
                              <>
                                <Mail className="h-4 w-4 ml-2" />
                                <a
                                  href={`mailto:${fb.email}`}
                                  className="text-primary-400 hover:text-primary-300"
                                >
                                  {fb.email}
                                </a>
                              </>
                            )}
                          </div>

                          {/* Suggestion */}
                          {fb.suggestion && (
                            <div className="bg-surface-800 rounded-lg p-3 mt-2">
                              <p className="text-sm text-surface-300">"{fb.suggestion}"</p>
                            </div>
                          )}

                          {/* Metadata */}
                          <div className="flex items-center gap-4 mt-3 text-xs text-surface-500">
                            <span>{formatDate(fb.created_at || fb.timestamp)}</span>
                            {fb.battle_id && (
                              <span>Battle: {fb.battle_id.slice(0, 8)}...</span>
                            )}
                            {fb.problem_id && (
                              <span>Problem: {fb.problem_id}</span>
                            )}
                          </div>
                        </div>
                        {/* Delete Button */}
                        <button
                          onClick={() => deleteFeedback(fb.id)}
                          className="ml-4 p-2 text-surface-500 hover:text-error hover:bg-error/10 rounded-lg transition-colors"
                          title="Delete feedback"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Bug Reports Tab Content */}
          {activeTab === 'bugs' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <select
                    value={bugReportFilter}
                    onChange={(e) => setBugReportFilter(e.target.value)}
                    className="px-3 py-1.5 bg-surface-800 border border-surface-700 rounded-lg text-sm text-white focus:outline-none focus:border-primary-500"
                  >
                    <option value="all">All Status</option>
                    <option value="new">New</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                  <span className="text-sm text-surface-400">
                    ({bugReports.length} reports)
                  </span>
                </div>
                <button
                  onClick={fetchBugReports}
                  className="px-3 py-1.5 text-sm bg-surface-800 hover:bg-surface-700 rounded-lg transition-colors flex items-center gap-1"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </button>
              </div>

              {bugReportsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-accent-400" />
                </div>
              ) : bugReports.length === 0 ? (
                <div className="text-center py-12">
                  <Bug className="h-12 w-12 text-surface-600 mx-auto mb-4" />
                  <p className="text-surface-400">No bug reports</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {bugReports.map((report) => (
                    <motion.div
                      key={report.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-surface-900 border border-surface-800 rounded-xl p-4 cursor-pointer hover:border-surface-700 transition-colors"
                      onClick={() => setSelectedBugReport(report)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-semibold text-white truncate">{report.title}</h3>
                            <span className={`px-2 py-0.5 text-xs rounded-full border flex-shrink-0 ${
                              report.status === 'new' ? 'bg-accent-500/20 text-accent-400 border-accent-500/30' :
                              report.status === 'in_progress' ? 'bg-primary-500/20 text-primary-400 border-primary-500/30' :
                              report.status === 'resolved' ? 'bg-success/20 text-success border-success/30' :
                              'bg-surface-500/20 text-surface-400 border-surface-500/30'
                            }`}>
                              {report.status.replace('_', ' ')}
                            </span>
                          </div>
                          <p className="text-sm text-surface-300 mb-3 line-clamp-2">
                            {report.description}
                          </p>
                          <div className="flex flex-wrap items-center gap-4 text-xs text-surface-500">
                            {report.username && (
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                @{report.username}
                              </span>
                            )}
                            {report.email && (
                              <span className="flex items-center gap-1">
                                <Mail className="h-3 w-3" />
                                {report.email}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(report.created_at).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={report.status}
                            onChange={(e) => updateBugReportStatus(report.id, e.target.value)}
                            className="px-2 py-1 text-xs bg-surface-800 border border-surface-700 rounded-lg text-white focus:outline-none"
                          >
                            <option value="new">New</option>
                            <option value="in_progress">In Progress</option>
                            <option value="resolved">Resolved</option>
                            <option value="closed">Closed</option>
                          </select>
                          <button
                            onClick={() => deleteBugReport(report.id)}
                            className="p-2 text-surface-500 hover:text-error hover:bg-error/10 rounded-lg transition-colors"
                            title="Delete bug report"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Feature Requests Tab Content */}
          {activeTab === 'features' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <select
                    value={featureRequestFilter}
                    onChange={(e) => setFeatureRequestFilter(e.target.value)}
                    className="px-3 py-1.5 bg-surface-800 border border-surface-700 rounded-lg text-sm text-white focus:outline-none focus:border-primary-500"
                  >
                    <option value="all">All Status</option>
                    <option value="new">New</option>
                    <option value="planned">Planned</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="declined">Declined</option>
                  </select>
                  <select
                    value={featureRequestCategoryFilter}
                    onChange={(e) => setFeatureRequestCategoryFilter(e.target.value)}
                    className="px-3 py-1.5 bg-surface-800 border border-surface-700 rounded-lg text-sm text-white focus:outline-none focus:border-primary-500"
                  >
                    <option value="all">All Categories</option>
                    <option value="practice">Practice</option>
                    <option value="battles">Battles</option>
                    <option value="ui">UI/Design</option>
                    <option value="social">Social</option>
                    <option value="creator">CreatorArena</option>
                    <option value="other">Other</option>
                  </select>
                  <span className="text-sm text-surface-400">
                    ({featureRequests.length} requests)
                  </span>
                </div>
                <button
                  onClick={fetchFeatureRequests}
                  className="px-3 py-1.5 text-sm bg-surface-800 hover:bg-surface-700 rounded-lg transition-colors flex items-center gap-1"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </button>
              </div>

              {featureRequestsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
                </div>
              ) : featureRequests.length === 0 ? (
                <div className="text-center py-12">
                  <Lightbulb className="h-12 w-12 text-surface-600 mx-auto mb-4" />
                  <p className="text-surface-400">No feature requests</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {featureRequests.map((request) => (
                    <motion.div
                      key={request.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={() => setExpandedFeatureRequest(expandedFeatureRequest === request.id ? null : request.id)}
                      className="bg-surface-900 border border-surface-800 rounded-xl p-4 hover:border-primary-500/30 transition-colors cursor-pointer"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className={`font-semibold text-white ${expandedFeatureRequest === request.id ? '' : 'truncate'}`}>{request.title}</h3>
                            <span className={`px-2 py-0.5 text-xs rounded-full border flex-shrink-0 ${
                              request.status === 'new' ? 'bg-primary-500/20 text-primary-400 border-primary-500/30' :
                              request.status === 'planned' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
                              request.status === 'in_progress' ? 'bg-warning/20 text-warning border-warning/30' :
                              request.status === 'completed' ? 'bg-success/20 text-success border-success/30' :
                              'bg-surface-500/20 text-surface-400 border-surface-500/30'
                            }`}>
                              {request.status === 'in_progress' ? 'in progress' : request.status}
                            </span>
                            {request.category && (
                              <span className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30 flex-shrink-0">
                                {request.category === 'ui' ? 'UI/Design' : request.category.charAt(0).toUpperCase() + request.category.slice(1)}
                              </span>
                            )}
                          </div>
                          <p className={`text-sm text-surface-300 mb-3 ${expandedFeatureRequest === request.id ? '' : 'line-clamp-2'}`}>
                            {request.description}
                          </p>
                          <div className="flex flex-wrap items-center gap-4 text-xs text-surface-500">
                            {request.username && (
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                @{request.username}
                              </span>
                            )}
                            {request.email && (
                              <span className="flex items-center gap-1">
                                <Mail className="h-3 w-3" />
                                {request.email}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(request.created_at).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={request.status}
                            onChange={(e) => updateFeatureRequestStatus(request.id, e.target.value)}
                            className="px-2 py-1 text-xs bg-surface-800 border border-surface-700 rounded-lg text-white focus:outline-none"
                          >
                            <option value="new">New</option>
                            <option value="planned">Planned</option>
                            <option value="in_progress">In Progress</option>
                            <option value="completed">Completed</option>
                            <option value="declined">Declined</option>
                          </select>
                          <button
                            onClick={() => deleteFeatureRequest(request.id)}
                            className="p-2 text-surface-500 hover:text-error hover:bg-error/10 rounded-lg transition-colors"
                            title="Delete feature request"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Reports List */}
          {activeTab === 'reports' && (loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
            </div>
          ) : reports.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="h-12 w-12 text-success mx-auto mb-4" />
              <p className="text-surface-400">No {filter || ''} reports</p>
            </div>
          ) : (
            <div className="space-y-4">
              {reports.map((report) => (
                <motion.div
                  key={report.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-surface-900 border border-surface-800 rounded-xl p-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      {/* Reported User */}
                      <div className="text-center">
                        <AvatarDisplay avatar={report.reported_avatar} size="lg" />
                        <p className="text-xs text-surface-500 mt-1">Reported</p>
                      </div>

                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Link
                            href={`/profile/${report.reported_username}`}
                            className="font-semibold hover:text-primary-400 transition-colors"
                          >
                            @{report.reported_username}
                          </Link>
                          <span className={`px-2 py-0.5 text-xs rounded-full border ${REPORT_STATUS_COLORS[report.status]}`}>
                            {report.status}
                          </span>
                        </div>

                        <div className="flex items-center gap-4 text-sm text-surface-400 mb-2">
                          <span className="flex items-center gap-1">
                            <AlertTriangle className="h-4 w-4 text-warning" />
                            {REASON_LABELS[report.reason] || report.reason}
                          </span>
                          <span>Reported by @{report.reporter_username}</span>
                          <span>{formatDate(report.created_at)}</span>
                        </div>

                        {report.description && (
                          <p className="text-sm text-surface-300 bg-surface-800 rounded-lg p-2 max-w-xl">
                            "{report.description}"
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      {report.status === 'pending' && (
                        <>
                          <button
                            onClick={() => handleReportAction(report.id, 'dismissed')}
                            disabled={actionLoading === report.id}
                            className="px-3 py-1.5 text-sm bg-surface-800 hover:bg-surface-700 rounded-lg transition-colors flex items-center gap-1"
                          >
                            <XCircle className="h-4 w-4" />
                            Dismiss
                          </button>
                          <button
                            onClick={() => setBanModal({ userId: report.reported_user_id, username: report.reported_username })}
                            disabled={actionLoading === report.id}
                            className="px-3 py-1.5 text-sm bg-error/20 text-error hover:bg-error/30 rounded-lg transition-colors flex items-center gap-1"
                          >
                            <Ban className="h-4 w-4" />
                            Ban User
                          </button>
                          <button
                            onClick={() => handleReportAction(report.id, 'resolved', 'Actioned')}
                            disabled={actionLoading === report.id}
                            className="px-3 py-1.5 text-sm bg-success/20 text-success hover:bg-success/30 rounded-lg transition-colors flex items-center gap-1"
                          >
                            <CheckCircle className="h-4 w-4" />
                            Resolve
                          </button>
                        </>
                      )}
                      <Link
                        href={`/profile/${report.reported_username}`}
                        className="px-3 py-1.5 text-sm bg-surface-800 hover:bg-surface-700 rounded-lg transition-colors flex items-center gap-1"
                      >
                        <Eye className="h-4 w-4" />
                        View Profile
                      </Link>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          ))}
        </div>

        {/* Delete Confirmation Modal */}
        {deleteModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-surface-900 border border-surface-700 rounded-2xl max-w-md w-full p-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-error/20 flex items-center justify-center">
                  <Trash2 className="h-5 w-5 text-error" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Delete @{deleteModal.username}?</h3>
                  <p className="text-sm text-surface-400">This action cannot be undone</p>
                </div>
              </div>

              <p className="text-surface-300 mb-6">
                This will permanently delete the user account and all associated data including battle history, messages, and stats.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteModal(null)}
                  className="flex-1 px-4 py-3 bg-surface-800 hover:bg-surface-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteUser}
                  disabled={actionLoading === 'delete'}
                  className="flex-1 px-4 py-3 bg-error hover:bg-error-light rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {actionLoading === 'delete' ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" />
                      Delete User
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Ban Modal */}
        {banModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-surface-900 border border-surface-700 rounded-2xl max-w-md w-full p-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-error/20 flex items-center justify-center">
                  <Ban className="h-5 w-5 text-error" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Ban @{banModal.username}</h3>
                  <p className="text-sm text-surface-400">This will prevent them from accessing CodeArena</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-2">
                    Reason *
                  </label>
                  <textarea
                    value={banReason}
                    onChange={(e) => setBanReason(e.target.value)}
                    placeholder="Why is this user being banned?"
                    rows={3}
                    className="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-lg text-white placeholder-surface-500 focus:outline-none focus:border-primary-500"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPermanent}
                      onChange={(e) => setIsPermanent(e.target.checked)}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm text-surface-300">Permanent ban</span>
                  </label>
                </div>

                {!isPermanent && (
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Duration (hours)
                    </label>
                    <select
                      value={banDuration}
                      onChange={(e) => setBanDuration(parseInt(e.target.value))}
                      className="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-lg text-white focus:outline-none focus:border-primary-500"
                    >
                      <option value={1}>1 hour</option>
                      <option value={6}>6 hours</option>
                      <option value={24}>24 hours</option>
                      <option value={72}>3 days</option>
                      <option value={168}>7 days</option>
                      <option value={720}>30 days</option>
                    </select>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setBanModal(null)}
                    className="flex-1 px-4 py-3 bg-surface-800 hover:bg-surface-700 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleBanUser}
                    disabled={!banReason || actionLoading === 'ban'}
                    className="flex-1 px-4 py-3 bg-error hover:bg-error-light rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {actionLoading === 'ban' ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <Ban className="h-4 w-4" />
                        Ban User
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Bug Report Detail Modal */}
        {selectedBugReport && (
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedBugReport(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-surface-900 border border-surface-700 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-accent-600/20 to-error/20 border-b border-surface-700 p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-accent-500/20 flex items-center justify-center">
                      <Bug className="h-5 w-5 text-accent-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-white">{selectedBugReport.title}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`px-2 py-0.5 text-xs rounded-full border ${
                          selectedBugReport.status === 'new' ? 'bg-accent-500/20 text-accent-400 border-accent-500/30' :
                          selectedBugReport.status === 'in_progress' ? 'bg-primary-500/20 text-primary-400 border-primary-500/30' :
                          selectedBugReport.status === 'resolved' ? 'bg-success/20 text-success border-success/30' :
                          'bg-surface-500/20 text-surface-400 border-surface-500/30'
                        }`}>
                          {selectedBugReport.status.replace('_', ' ')}
                        </span>
                        <span className="text-xs text-surface-500">
                          {new Date(selectedBugReport.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedBugReport(null)}
                    className="p-2 hover:bg-surface-800 rounded-lg transition-colors text-surface-400"
                  >
                    <XCircle className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
                {/* Reporter Info */}
                <div className="flex flex-wrap gap-4 mb-6 text-sm">
                  {selectedBugReport.username && (
                    <div className="flex items-center gap-2 text-surface-300">
                      <User className="h-4 w-4 text-surface-500" />
                      <span>@{selectedBugReport.username}</span>
                    </div>
                  )}
                  {selectedBugReport.email && (
                    <a
                      href={`mailto:${selectedBugReport.email}`}
                      className="flex items-center gap-2 text-primary-400 hover:text-primary-300"
                    >
                      <Mail className="h-4 w-4" />
                      <span>{selectedBugReport.email}</span>
                    </a>
                  )}
                  {selectedBugReport.page_url && (
                    <a
                      href={selectedBugReport.page_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-primary-400 hover:text-primary-300"
                    >
                      <Eye className="h-4 w-4" />
                      <span className="truncate max-w-[300px]">{selectedBugReport.page_url}</span>
                    </a>
                  )}
                </div>

                {/* Description */}
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-surface-400 mb-2">Description</h4>
                  <div className="bg-surface-800 rounded-lg p-4">
                    <p className="text-surface-200 whitespace-pre-wrap">{selectedBugReport.description}</p>
                  </div>
                </div>

                {/* Screenshot */}
                {selectedBugReport.screenshot_url && (
                  <div className="mb-6">
                    <h4 className="text-sm font-medium text-surface-400 mb-2">Screenshot</h4>
                    <a
                      href={selectedBugReport.screenshot_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-surface-800 hover:bg-surface-700 rounded-lg text-primary-400 transition-colors"
                    >
                      <Eye className="h-4 w-4" />
                      View Screenshot
                    </a>
                  </div>
                )}

                {/* Admin Notes */}
                {selectedBugReport.admin_notes && (
                  <div className="mb-6">
                    <h4 className="text-sm font-medium text-surface-400 mb-2">Admin Notes</h4>
                    <div className="bg-surface-800 rounded-lg p-4">
                      <p className="text-surface-300">{selectedBugReport.admin_notes}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer Actions */}
              <div className="border-t border-surface-700 p-4 flex items-center justify-between">
                <select
                  value={selectedBugReport.status}
                  onChange={(e) => {
                    updateBugReportStatus(selectedBugReport.id, e.target.value);
                    setSelectedBugReport({ ...selectedBugReport, status: e.target.value });
                  }}
                  className="px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-white focus:outline-none"
                >
                  <option value="new">New</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      deleteBugReport(selectedBugReport.id);
                      setSelectedBugReport(null);
                    }}
                    className="px-4 py-2 bg-error/20 hover:bg-error/30 text-error rounded-lg transition-colors flex items-center gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                  <button
                    onClick={() => setSelectedBugReport(null)}
                    className="px-4 py-2 bg-surface-800 hover:bg-surface-700 rounded-lg transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </>
  );
}
