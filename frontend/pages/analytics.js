// pages/analytics.js - Performance Analytics Dashboard
import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Logo from '../components/Logo';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  Clock,
  Zap,
  Code2,
  BarChart3,
  Award,
  Flame,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

// Dynamic import Recharts to reduce initial bundle size
const LineChart = dynamic(() => import('recharts').then(mod => mod.LineChart), { ssr: false });
const Line = dynamic(() => import('recharts').then(mod => mod.Line), { ssr: false });
const BarChart = dynamic(() => import('recharts').then(mod => mod.BarChart), { ssr: false });
const Bar = dynamic(() => import('recharts').then(mod => mod.Bar), { ssr: false });
const XAxis = dynamic(() => import('recharts').then(mod => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import('recharts').then(mod => mod.YAxis), { ssr: false });
const CartesianGrid = dynamic(() => import('recharts').then(mod => mod.CartesianGrid), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then(mod => mod.Tooltip), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then(mod => mod.ResponsiveContainer), { ssr: false });
import { config } from '../config/env';
import { withAuth } from '../components/withAuth';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import FloatingOrbs from '../components/ui/FloatingOrbs';
import { fetchWithTimeout } from '../utils/fetch';
import { getLanguageDisplayName } from '../utils/languages';
import { formatDuration as formatTime } from '../utils/formatting';
import { withRetry } from '../utils/errorHandling';

// Language colors for charts
const languageColors = {
  python: '#3776AB',
  javascript: '#F7DF1E',
  java: '#ED8B00',
  cpp: '#00599C',
  go: '#00ADD8',
  rust: '#DEA584'
};

// Stat Card Component - memoized to prevent unnecessary re-renders
const StatCard = memo(function StatCard({ icon: Icon, label, value, subValue, color = 'primary', trend }) {
  return (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="relative"
  >
    <Card variant="glass" className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-surface-400 text-sm mb-1">{label}</p>
          <p className="text-3xl font-bold text-white">{value}</p>
          {subValue && (
            <p className="text-surface-400 text-xs mt-1">{subValue}</p>
          )}
        </div>
        <div className={`p-3 rounded-xl bg-${color}-500/20`}>
          <Icon className={`h-6 w-6 text-${color}-400`} />
        </div>
      </div>
      {trend !== undefined && (
        <div className={`flex items-center mt-3 text-sm ${trend >= 0 ? 'text-success' : 'text-error'}`}>
          {trend >= 0 ? <TrendingUp className="h-4 w-4 mr-1" /> : <TrendingDown className="h-4 w-4 mr-1" />}
          <span>{trend >= 0 ? '+' : ''}{trend} this week</span>
        </div>
      )}
    </Card>
  </motion.div>
  );
});

// Custom tooltip for charts - memoized to prevent unnecessary re-renders
const CustomTooltip = memo(function CustomTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-surface-800 border border-surface-700 rounded-lg p-3 shadow-xl">
        <p className="text-surface-300 text-sm mb-1">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-white font-semibold" style={{ color: entry.color }}>
            {entry.name}: {entry.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
});

function Analytics() {
  const router = useRouter();
  const { user, token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState(null);

  const fetchAnalytics = useCallback(async (isRefresh = false) => {
    if (!token) return;

    try {
      if (isRefresh) {
        setRefreshing(true);
        setError(null);
      } else {
        setLoading(true);
      }

      const res = await withRetry(async () => {
        const response = await fetchWithTimeout(`${config.backend_url}/api/analytics`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to fetch analytics');
        }

        return response;
      });

      const data = await res.json();
      setAnalytics(data.analytics);
      setError(null);
    } catch (err) {
      console.error('Analytics fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const handleRefresh = () => {
    if (!refreshing) {
      fetchAnalytics(true);
    }
  };

  // Memoized chart data transformations to prevent recalculation on every render
  const languageChartData = useMemo(() =>
    Object.entries(analytics?.languageStats || {}).map(([lang, stats]) => ({
      name: getLanguageDisplayName(lang),
      wins: stats.wins,
      losses: stats.losses,
      total: stats.wins + stats.losses,
      winRate: stats.wins + stats.losses > 0
        ? Math.round((stats.wins / (stats.wins + stats.losses)) * 100)
        : 0,
      color: languageColors[lang] || '#6366f1'
    })),
    [analytics?.languageStats]
  );

  const solveTimeData = useMemo(() =>
    analytics?.solveTimeTrends?.map((entry, index) => ({
      name: `#${index + 1}`,
      time: Math.round(entry.solve_time / 1000),
    })) || [],
    [analytics?.solveTimeTrends]
  );

  const stats = analytics?.stats;
  const winRate = useMemo(() =>
    stats && (stats.wins + stats.losses) > 0
      ? Math.round((stats.wins / (stats.wins + stats.losses)) * 100)
      : 0,
    [stats]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-12 h-12 border-4 border-primary-500/30 border-t-primary-500 rounded-full"
        />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Analytics - CodeArena</title>
        <meta name="description" content="Track your coding performance and improvement" />
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">
        <FloatingOrbs />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-8">
          {/* Header */}
          <motion.header
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="mb-8"
          >
            <div className="flex items-center space-x-4 mb-4">
              <Link href="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
                <Logo />
              </Link>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="p-3 bg-gradient-to-br from-primary-500 to-secondary-600 rounded-2xl">
                  <BarChart3 className="h-8 w-8 text-white" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold">Language & Speed Analytics</h1>
                  <p className="text-surface-400">Deep dive into your performance by language and solve times</p>
                </div>
              </div>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="p-2 text-surface-400 hover:text-white hover:bg-surface-800 rounded-lg transition-colors disabled:opacity-50"
                title="Refresh data"
              >
                <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </motion.header>

          {error && !analytics ? (
            <Card variant="glass" className="p-8 text-center max-w-md mx-auto">
              <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">Failed to Load Analytics</h2>
              <p className="text-surface-400 mb-6">{error}</p>
              <div className="flex gap-3 justify-center">
                <Button variant="ghost" onClick={() => router.push('/')}>Go Home</Button>
                <Button onClick={handleRefresh} loading={refreshing}>
                  <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                  Try Again
                </Button>
              </div>
            </Card>
          ) : (
            <>
              {/* Stats Grid - Focused on solve time & battles */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                <StatCard
                  icon={Zap}
                  label="Total Battles"
                  value={stats?.total_battles || 0}
                  subValue={`${stats?.wins || 0}W - ${stats?.losses || 0}L`}
                  color="primary"
                />
                <StatCard
                  icon={Clock}
                  label="Avg Solve Time"
                  value={stats?.avg_solve_time ? formatTime(Math.round(stats.avg_solve_time / 1000)) : '-'}
                  subValue={stats?.fastest_solve ? `Best: ${formatTime(Math.round(stats.fastest_solve / 1000))}` : null}
                  color="warning"
                />
                <StatCard
                  icon={Code2}
                  label="Languages Used"
                  value={Object.keys(analytics?.languageStats || {}).length}
                  subValue="across all battles"
                  color="secondary"
                />
              </div>

              {/* Language Performance Chart */}
              <div className="grid lg:grid-cols-1 gap-6 mb-8">
                {/* Win/Loss by Language */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <Card variant="glass" className="p-6">
                    <div className="flex items-center space-x-3 mb-6">
                      <Code2 className="h-5 w-5 text-secondary-400" />
                      <h2 className="text-xl font-bold">Performance by Language</h2>
                    </div>

                    {languageChartData.length > 0 ? (
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={languageChartData} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
                            <XAxis type="number" stroke="#9CA3AF" fontSize={12} />
                            <YAxis
                              type="category"
                              dataKey="name"
                              stroke="#9CA3AF"
                              fontSize={12}
                              width={80}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Bar dataKey="wins" name="Wins" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} />
                            <Bar dataKey="losses" name="Losses" stackId="a" fill="#ef4444" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-64 flex items-center justify-center text-surface-400">
                        <div className="text-center">
                          <Code2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                          <p>No language data yet. Start battling!</p>
                        </div>
                      </div>
                    )}
                  </Card>
                </motion.div>
              </div>

              {/* Solve Time Trends */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <Card variant="glass" className="p-6 mb-8">
                  <div className="flex items-center space-x-3 mb-6">
                    <Clock className="h-5 w-5 text-warning" />
                    <h2 className="text-xl font-bold">Solve Time Trends</h2>
                    <Badge variant="warning" className="ml-2">Wins Only</Badge>
                  </div>

                  {solveTimeData.length > 0 ? (
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={solveTimeData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis
                            dataKey="name"
                            stroke="#9CA3AF"
                            fontSize={12}
                            tickLine={false}
                          />
                          <YAxis
                            stroke="#9CA3AF"
                            fontSize={12}
                            tickLine={false}
                            unit="s"
                          />
                          <Tooltip content={<CustomTooltip />} />
                          <Line
                            type="monotone"
                            dataKey="time"
                            name="Solve Time (s)"
                            stroke="#f59e0b"
                            strokeWidth={2}
                            dot={{ fill: '#f59e0b', strokeWidth: 2, r: 3 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-48 flex items-center justify-center text-surface-400">
                      <div className="text-center">
                        <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <p>Win some battles to track your solve times!</p>
                      </div>
                    </div>
                  )}
                </Card>
              </motion.div>

              {/* Language Win Rates */}
              {languageChartData.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                >
                  <Card variant="glass" className="p-6">
                    <div className="flex items-center space-x-3 mb-6">
                      <Award className="h-5 w-5 text-success" />
                      <h2 className="text-xl font-bold">Language Win Rates</h2>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                      {languageChartData.map((lang) => (
                        <div
                          key={lang.name}
                          className="bg-surface-800/50 rounded-xl p-4 text-center"
                        >
                          <div
                            className="w-10 h-10 rounded-full mx-auto mb-2 flex items-center justify-center"
                            style={{ backgroundColor: `${lang.color}20` }}
                          >
                            <Code2 className="h-5 w-5" style={{ color: lang.color }} />
                          </div>
                          <p className="font-semibold text-white">{lang.name}</p>
                          <p className="text-2xl font-bold text-primary-400">{lang.winRate}%</p>
                          <p className="text-xs text-surface-400">
                            {lang.wins}W / {lang.losses}L
                          </p>
                        </div>
                      ))}
                    </div>
                  </Card>
                </motion.div>
              )}

              {/* Pro Upsell - Coming Soon */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="mt-8"
              >
                <Card variant="glass" className="p-6 border-primary-500/30 bg-gradient-to-r from-primary-500/10 to-secondary-500/10">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="p-3 bg-primary-500/20 rounded-xl">
                        <Flame className="h-6 w-6 text-primary-400" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold">AI-Powered Insights Coming Soon</h3>
                        <p className="text-surface-400 text-sm">
                          Get personalized feedback on your code quality, performance under pressure, and improvement tips.
                        </p>
                      </div>
                    </div>
                    <Badge variant="primary">Pro</Badge>
                  </div>
                </Card>
              </motion.div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default withAuth(Analytics);
