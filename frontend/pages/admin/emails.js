import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  Shield,
  ArrowLeft,
  Loader2,
  RefreshCw,
  Mail,
  AlertCircle,
  Users
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { config } from '../../config/env';
import FloatingOrbs from '../../components/ui/FloatingOrbs';

export default function EmailSubscribersAdminPage() {
  const { token, loading: authLoading } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStats = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${config.backend_url}/api/admin/emails/stats`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.status === 403) {
        setError('Admin access required');
        return;
      }
      if (!response.ok) {
        setError('Failed to load subscriber stats');
        return;
      }

      const json = await response.json();
      if (json.success) {
        setData(json);
      } else {
        setError('Failed to load subscriber stats');
      }
    } catch (err) {
      console.error('Failed to fetch email stats:', err);
      setError('Failed to load subscriber stats');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      fetchStats();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [token, authLoading, fetchStats]);

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
          <p className="text-surface-400 mb-4">
            You need admin privileges to access this page.
          </p>
          <Link href="/" className="text-primary-400 hover:text-primary-300">
            Return to Home
          </Link>
        </div>
      </div>
    );
  }

  const sortedStats = data?.stats
    ? [...data.stats].sort((a, b) => b.subscribers - a.subscribers)
    : [];
  const verifiedUsers = data?.verifiedUsers || 0;

  return (
    <>
      <Head>
        <title>Email Subscribers - CodeArena Admin</title>
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">
        <FloatingOrbs />

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="mb-8">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-surface-400 hover:text-white mb-4 transition"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Home
            </Link>
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div>
                <h1 className="text-3xl font-bold flex items-center gap-3">
                  <Mail className="h-8 w-8 text-primary-400" />
                  Email Subscribers
                </h1>
                <p className="text-surface-400 mt-2">
                  How many people will receive each email if you send it now.
                </p>
              </div>
              <button
                onClick={fetchStats}
                disabled={loading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-800 hover:bg-surface-700 border border-surface-700 text-white transition disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {/* Error banner */}
          {error && error !== 'Admin access required' && (
            <div className="mb-6 p-4 rounded-lg bg-error/10 border border-error/30 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-error" />
              <span className="text-error">{error}</span>
            </div>
          )}

          {/* Verified users stat card */}
          <div className="mb-6 p-5 rounded-xl bg-surface-900 border border-surface-800 flex items-center gap-4">
            <div className="p-3 rounded-lg bg-primary-500/10">
              <Users className="h-6 w-6 text-primary-400" />
            </div>
            <div>
              <div className="text-sm text-surface-400">Verified users with email</div>
              <div className="text-2xl font-bold">
                {loading && !data ? '-' : verifiedUsers.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Stats table */}
          <div className="rounded-xl bg-surface-900 border border-surface-800 overflow-hidden">
            {loading && !data ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-surface-800/50 text-surface-400 text-sm">
                  <tr>
                    <th className="text-left px-6 py-3 font-medium">Email Type</th>
                    <th className="text-right px-6 py-3 font-medium">Subscribers</th>
                    <th className="text-right px-6 py-3 font-medium">% of Verified Users</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedStats.map((row, idx) => {
                    const pctRaw = verifiedUsers > 0
                      ? (row.subscribers / verifiedUsers) * 100
                      : 0;
                    const pct = pctRaw > 100 ? '100%+' : `${pctRaw.toFixed(1)}%`;
                    return (
                      <tr
                        key={row.type}
                        className={`border-t border-surface-800 ${
                          idx % 2 === 0 ? 'bg-surface-900' : 'bg-surface-900/50'
                        }`}
                      >
                        <td className="px-6 py-4">
                          <div className="font-medium text-white">{row.label}</div>
                          {row.type === 'marketing' && (
                            <div className="text-xs text-surface-400 mt-1">
                              {row.registeredUsers} registered + {row.newsletterOnly} newsletter-only
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right font-mono font-semibold">
                          {row.subscribers.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-right text-surface-300">
                          {pct}
                        </td>
                      </tr>
                    );
                  })}
                  {sortedStats.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-6 py-10 text-center text-surface-400">
                        No data.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
