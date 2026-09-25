/**
 * Skeleton Loading Components
 *
 * Provides smooth loading states for various UI elements.
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';

// Base skeleton with shimmer animation
export function Skeleton({ className = '', rounded = 'md' }) {
  const roundedClasses = {
    none: '',
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    '2xl': 'rounded-2xl',
    full: 'rounded-full'
  };

  return (
    <div
      className={`relative overflow-hidden bg-surface-700/50 ${roundedClasses[rounded]} ${className}`}
    >
      <motion.div
        className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-surface-600/20 to-transparent"
        animate={{ translateX: ['-100%', '100%'] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

// Text line skeleton
export function SkeletonText({ lines = 1, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-4"
          style={{ width: i === lines - 1 && lines > 1 ? '75%' : '100%' }}
        />
      ))}
    </div>
  );
}

// Circle/Avatar skeleton
export function SkeletonCircle({ size = 'md', className = '' }) {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16'
  };

  return <Skeleton className={`${sizeClasses[size]} ${className}`} rounded="full" />;
}

// Card skeleton
export function SkeletonCard({ className = '' }) {
  return (
    <div className={`bg-surface-800 rounded-xl border border-surface-700 p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <SkeletonCircle />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    </div>
  );
}

// Problem card skeleton (for practice/battle)
export function SkeletonProblemCard({ className = '' }) {
  return (
    <div className={`bg-surface-800 rounded-xl border border-surface-700 p-6 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-6 w-32" rounded="lg" />
        <Skeleton className="h-6 w-16" rounded="full" />
      </div>
      <Skeleton className="h-4 w-full mb-2" />
      <Skeleton className="h-4 w-3/4 mb-4" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-16" rounded="full" />
        <Skeleton className="h-6 w-20" rounded="full" />
      </div>
    </div>
  );
}

// Player/User card skeleton
export function SkeletonPlayerCard({ className = '' }) {
  return (
    <div className={`bg-surface-800 rounded-xl border border-surface-700 p-4 ${className}`}>
      <div className="flex items-center gap-4">
        <SkeletonCircle size="lg" />
        <div className="flex-1">
          <Skeleton className="h-5 w-24 mb-2" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="text-right">
          <Skeleton className="h-5 w-12 mb-2" />
          <Skeleton className="h-3 w-8" />
        </div>
      </div>
    </div>
  );
}

// Stats card skeleton
export function SkeletonStatsCard({ className = '' }) {
  return (
    <div className={`bg-surface-800 rounded-xl border border-surface-700 p-6 ${className}`}>
      <Skeleton className="h-4 w-20 mb-3" />
      <Skeleton className="h-8 w-16 mb-1" />
      <Skeleton className="h-3 w-12" />
    </div>
  );
}

// List skeleton
export function SkeletonList({ count = 3, className = '' }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

// Table row skeleton
export function SkeletonTableRow({ columns = 4, className = '' }) {
  return (
    <div className={`flex items-center gap-4 py-3 px-4 border-b border-surface-700 ${className}`}>
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-4 flex-1"
          style={{ maxWidth: i === 0 ? '30%' : i === columns - 1 ? '15%' : '20%' }}
        />
      ))}
    </div>
  );
}

// Leaderboard skeleton
export function SkeletonLeaderboard({ rows = 5, className = '' }) {
  return (
    <div className={`bg-surface-800 rounded-xl border border-surface-700 overflow-hidden ${className}`}>
      <div className="p-4 border-b border-surface-700">
        <Skeleton className="h-6 w-32" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-3 px-4 border-b border-surface-700 last:border-0">
          <Skeleton className="h-6 w-6" rounded="full" />
          <SkeletonCircle size="sm" />
          <Skeleton className="h-4 w-24 flex-1" />
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </div>
  );
}

// Profile header skeleton
export function SkeletonProfileHeader({ className = '' }) {
  return (
    <div className={`bg-surface-800 rounded-xl border border-surface-700 p-6 ${className}`}>
      <div className="flex flex-col md:flex-row items-center gap-6">
        <SkeletonCircle size="xl" className="w-24 h-24" />
        <div className="flex-1 text-center md:text-left">
          <Skeleton className="h-8 w-48 mb-2 mx-auto md:mx-0" />
          <Skeleton className="h-4 w-32 mb-4 mx-auto md:mx-0" />
          <div className="flex gap-4 justify-center md:justify-start">
            <Skeleton className="h-6 w-20" rounded="lg" />
            <Skeleton className="h-6 w-20" rounded="lg" />
            <Skeleton className="h-6 w-20" rounded="lg" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Message/conversation skeleton
export function SkeletonMessage({ isOwn = false, className = '' }) {
  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} ${className}`}>
      <div className={`flex gap-2 max-w-[70%] ${isOwn ? 'flex-row-reverse' : ''}`}>
        {!isOwn && <SkeletonCircle size="sm" />}
        <div className="space-y-1">
          <Skeleton className={`h-10 ${isOwn ? 'w-32' : 'w-48'}`} rounded="xl" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
    </div>
  );
}

// Conversation list skeleton
export function SkeletonConversationList({ count = 5, className = '' }) {
  return (
    <div className={`space-y-1 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-lg">
          <SkeletonCircle size="md" />
          <div className="flex-1">
            <Skeleton className="h-4 w-24 mb-1" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </div>
  );
}

// Battle history card skeleton
export function SkeletonBattleHistory({ className = '' }) {
  return (
    <div className={`bg-surface-800 rounded-xl border border-surface-700 p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <SkeletonCircle size="md" />
          <div>
            <Skeleton className="h-4 w-20 mb-1" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
        <Skeleton className="h-6 w-14" rounded="full" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-16" rounded="lg" />
        <Skeleton className="h-5 w-24" rounded="lg" />
      </div>
    </div>
  );
}

// Analytics chart skeleton
export function SkeletonChart({ height = 200, className = '' }) {
  // Pre-generate random heights to avoid calling Math.random during render
  const barHeights = useMemo(() =>
    Array.from({ length: 7 }, () => 30 + Math.random() * 60),
    []
  );

  return (
    <div className={`bg-surface-800 rounded-xl border border-surface-700 p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-5 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-16" rounded="full" />
          <Skeleton className="h-6 w-16" rounded="full" />
        </div>
      </div>
      <div className="flex items-end gap-2" style={{ height }}>
        {barHeights.map((barHeight, i) => (
          <Skeleton
            key={i}
            className="flex-1"
            rounded="sm"
            style={{ height: `${barHeight}%` }}
          />
        ))}
      </div>
    </div>
  );
}

// Full page loading skeleton
export function SkeletonPage({ className = '' }) {
  return (
    <div className={`min-h-screen bg-surface-900 p-6 ${className}`}>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <Skeleton className="h-8 w-48" />
          <div className="flex gap-3">
            <Skeleton className="h-10 w-24" rounded="lg" />
            <Skeleton className="h-10 w-24" rounded="lg" />
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonStatsCard key={i} />
          ))}
        </div>

        {/* Content area */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2">
            <SkeletonCard className="h-64" />
          </div>
          <div>
            <SkeletonLeaderboard rows={5} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default Skeleton;
