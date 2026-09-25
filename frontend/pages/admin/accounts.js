import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  Shield,
  ArrowLeft,
  Loader2,
  RefreshCw,
  AlertCircle,
  Users,
  UserCheck,
  AlertTriangle,
  MailX,
  KeyRound,
  Mail
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { config } from '../../config/env';
import FloatingOrbs from '../../components/ui/FloatingOrbs';

function formatDate(value) {
  if (!value) return '--';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export default function AccountAuditAdminPage() {
  const { token, loading: authLoading } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAudit = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${config.backend_url}/api/admin/account-audit`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.status === 403) {
        setError('Admin access required');
        return;
      }
      if (!response.ok) {
        setError('Failed to load account audit');
        return;
      }

      const json = await response.json();
      if (json.success) {
        setData(json);
      } else {
        setError('Failed to load account audit');
      }
    } catch (err) {
      console.error('Failed to fetch account audit:', err);
      setError('Failed to load account audit');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      fetchAudit();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [token, authLoading, fetchAudit]);

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

  const audit = data?.audit || null;
  const breakdown = audit?.breakdown || null;
  const suspected = audit?.suspected || [];

  const statCards = [
    {
      label: 'Total accounts',
      value: audit ? audit.total : null,
      icon: Users
    },
    {
      label: 'Real members',
      value: audit ? audit.realMembers : null,
      icon: UserCheck
    },
    {
      label: 'Suspected test/seed',
      value: audit ? audit.suspectedTest : null,
      icon: AlertTriangle
    },
    {
      label: 'Unverified (no email backing)',
      value: breakdown ? breakdown.unverifiedNoOauth : null,
      icon: MailX
    }
  ];

  const breakdownCards = [
    {
      label: 'OAuth',
      value: breakdown ? breakdown.oauth : null,
      icon: KeyRound
    },
    {
      label: 'Email-verified',
      value: breakdown ? breakdown.emailVerifiedNonOauth : null,
      icon: Mail
    },
    {
      label: 'Unverified',
      value: breakdown ? breakdown.unverifiedNoOauth : null,
      icon: MailX
    }
  ];

  const showLoadingPlaceholder = loading && !data;

  return (
    <>
      <Head>
        <title>Account Audit - CodeArena Admin</title>
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
                  <Users className="h-8 w-8 text-primary-400" />
                  Account Audit
                </h1>
                <p className="text-surface-400 mt-2">
                  Real members vs test/seed accounts.
                </p>
              </div>
              <button
                onClick={fetchAudit}
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

          {/* Headline stat */}
          <div className="mb-6 p-6 rounded-xl bg-surface-900 border border-surface-800">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-primary-500/10">
                <UserCheck className="h-5 w-5 text-primary-400" />
              </div>
              <div className="text-sm text-surface-400">
                Real members (email-backed)
              </div>
            </div>
            <div className="text-5xl font-bold">
              {showLoadingPlaceholder || !audit || audit.realMembers === null || audit.realMembers === undefined
                ? '-'
                : Number(audit.realMembers).toLocaleString()}
            </div>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
            {statCards.map((card) => {
              const Icon = card.icon;
              let display = '-';
              if (!showLoadingPlaceholder && card.value !== null && card.value !== undefined) {
                display = Number(card.value).toLocaleString();
              }
              return (
                <div
                  key={card.label}
                  className="p-5 rounded-xl bg-surface-900 border border-surface-800"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 rounded-lg bg-primary-500/10">
                      <Icon className="h-5 w-5 text-primary-400" />
                    </div>
                    <div className="text-sm text-surface-400">{card.label}</div>
                  </div>
                  <div className="text-2xl font-bold">{display}</div>
                </div>
              );
            })}
          </div>

          {/* Email backing breakdown */}
          <div className="mb-6 rounded-xl bg-surface-900 border border-surface-800 overflow-hidden">
            <div className="px-6 py-4 border-b border-surface-800">
              <h2 className="font-semibold text-white">Email backing</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-6">
              {breakdownCards.map((card) => {
                const Icon = card.icon;
                let display = '-';
                if (!showLoadingPlaceholder && card.value !== null && card.value !== undefined) {
                  display = Number(card.value).toLocaleString();
                }
                return (
                  <div
                    key={card.label}
                    className="p-4 rounded-lg bg-surface-800/40 border border-surface-800"
                  >
                    <div className="flex items-center gap-2 mb-2 text-sm text-surface-400">
                      <Icon className="h-4 w-4 text-primary-400" />
                      {card.label}
                    </div>
                    <div className="text-xl font-bold">{display}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Suspected test / seed accounts table */}
          <div className="rounded-xl bg-amber-500/5 border border-amber-500/30 overflow-hidden">
            <div className="px-6 py-4 border-b border-amber-500/20 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              <h2 className="font-semibold text-white">
                Suspected test / seed accounts
              </h2>
            </div>
            {showLoadingPlaceholder ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-amber-500/10 text-amber-200/80 text-sm">
                  <tr>
                    <th className="text-left px-6 py-3 font-medium">Username</th>
                    <th className="text-left px-6 py-3 font-medium">Email</th>
                    <th className="text-left px-6 py-3 font-medium">Reason</th>
                    <th className="text-right px-6 py-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {suspected.map((row, idx) => (
                    <tr
                      key={row.id}
                      className={`border-t border-amber-500/15 ${
                        idx % 2 === 0 ? 'bg-amber-500/[0.03]' : 'bg-transparent'
                      }`}
                    >
                      <td className="px-6 py-4 font-medium text-white">
                        {row.username}
                      </td>
                      <td className="px-6 py-4 text-surface-300 font-mono text-sm">
                        {row.email}
                      </td>
                      <td className="px-6 py-4 text-surface-300">{row.reason}</td>
                      <td className="px-6 py-4 text-right text-surface-400 font-mono text-sm">
                        {formatDate(row.created_at)}
                      </td>
                    </tr>
                  ))}
                  {suspected.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-10 text-center text-surface-400">
                        None found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Muted note */}
          <p className="mt-4 text-sm text-surface-500">
            Flagged for review only - nothing is deleted. These are excluded from
            the real-member count.
          </p>
        </div>
      </div>
    </>
  );
}
