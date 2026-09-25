import React from 'react';
import { motion } from 'framer-motion';

/**
 * Skeleton loading component for content placeholders
 */
export function Skeleton({ className = '', variant = 'default' }) {
  const baseClasses = 'bg-surface-800 rounded animate-pulse';

  const variants = {
    default: 'h-4 w-full',
    title: 'h-8 w-3/4',
    subtitle: 'h-5 w-1/2',
    avatar: 'h-12 w-12 rounded-full',
    card: 'h-32 w-full rounded-xl',
    button: 'h-10 w-24 rounded-lg',
    line: 'h-4 w-full',
    text: 'h-4 w-full',
  };

  return (
    <div className={`${baseClasses} ${variants[variant] || variants.default} ${className}`} />
  );
}

/**
 * Card skeleton for loading states
 */
export function CardSkeleton({ className = '' }) {
  return (
    <div className={`bg-surface-900/50 border border-surface-700 rounded-xl p-6 ${className}`}>
      <div className="flex items-center space-x-4 mb-4">
        <Skeleton variant="avatar" />
        <div className="flex-1 space-y-2">
          <Skeleton variant="subtitle" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton variant="line" />
        <Skeleton className="w-5/6" />
        <Skeleton className="w-4/6" />
      </div>
    </div>
  );
}

/**
 * Table row skeleton
 */
export function TableRowSkeleton({ columns = 4, className = '' }) {
  return (
    <div className={`flex items-center space-x-4 py-4 border-b border-surface-800 ${className}`}>
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} className={`h-4 ${i === 0 ? 'w-8' : 'flex-1'}`} />
      ))}
    </div>
  );
}

/**
 * Leaderboard skeleton
 */
export function LeaderboardSkeleton({ rows = 5 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center space-x-4 p-4 bg-surface-900/50 rounded-lg">
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton variant="avatar" className="h-10 w-10" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-6 w-16" />
        </div>
      ))}
    </div>
  );
}

/**
 * Stats skeleton
 */
export function StatsSkeleton({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-surface-900/50 border border-surface-700 rounded-xl p-4">
          <Skeleton className="h-3 w-16 mb-2" />
          <Skeleton className="h-8 w-12" />
        </div>
      ))}
    </div>
  );
}

/**
 * Page loading skeleton with header
 */
export function PageSkeleton({ children }) {
  return (
    <div className="min-h-screen bg-surface-950 text-white">
      <div className="p-6">
        {/* Header skeleton */}
        <div className="flex items-center justify-between mb-8">
          <Skeleton variant="title" className="w-48" />
          <Skeleton variant="button" />
        </div>
        {children}
      </div>
    </div>
  );
}

export default Skeleton;
