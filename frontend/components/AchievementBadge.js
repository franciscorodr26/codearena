import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock } from 'lucide-react';

/**
 * Rarity color configurations
 */
const rarityConfig = {
  common: {
    bg: 'from-slate-600 to-slate-700',
    border: 'border-slate-500/50',
    glow: 'shadow-slate-500/20',
    text: 'text-slate-300',
    label: 'Common'
  },
  rare: {
    bg: 'from-blue-600 to-blue-700',
    border: 'border-blue-400/50',
    glow: 'shadow-blue-500/30',
    text: 'text-blue-300',
    label: 'Rare'
  },
  epic: {
    bg: 'from-purple-600 to-purple-700',
    border: 'border-purple-400/50',
    glow: 'shadow-purple-500/40',
    text: 'text-purple-300',
    label: 'Epic'
  },
  legendary: {
    bg: 'from-amber-500 to-orange-600',
    border: 'border-amber-400/60',
    glow: 'shadow-amber-500/50',
    text: 'text-amber-300',
    label: 'Legendary'
  }
};

/**
 * Category icons
 */
const categoryIcons = {
  battle: '',
  streak: '',
  rank: '',
  practice: '',
  weekly: '',
  special: ''
};

const categoryLabels = {
  battle: 'Battle',
  streak: 'Streak',
  rank: 'Rank',
  practice: 'Practice',
  weekly: 'Weekly Challenge',
  special: 'Special'
};

/**
 * Badge Detail Modal
 */
export function BadgeDetailModal({ badge, isOpen, onClose, earned = true }) {
  if (!isOpen || !badge) return null;

  const rarity = rarityConfig[badge.rarity] || rarityConfig.common;
  const categoryIcon = categoryIcons[badge.category] || '';
  const categoryLabel = categoryLabels[badge.category] || badge.category;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className={`
            relative max-w-sm w-full rounded-2xl overflow-hidden
            bg-gradient-to-br from-surface-800 to-surface-900
            border ${rarity.border}
            shadow-2xl ${rarity.glow}
          `}
          onClick={e => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-full bg-surface-700/50 hover:bg-surface-600 transition-colors z-10"
          >
            <X className="w-4 h-4 text-surface-300" />
          </button>

          {/* Header with badge icon */}
          <div className={`bg-gradient-to-br ${rarity.bg} p-8 text-center relative`}>
            {/* Decorative background pattern */}
            <div className="absolute inset-0 opacity-10">
              <div className="absolute inset-0" style={{
                backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
                backgroundSize: '24px 24px'
              }} />
            </div>

            {/* Badge icon */}
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
              className={`
                w-24 h-24 mx-auto rounded-2xl
                bg-gradient-to-br from-white/20 to-white/5
                border-2 border-white/30
                flex items-center justify-center
                shadow-xl
                ${!earned ? 'grayscale opacity-50' : ''}
              `}
            >
              <span className="text-5xl">{badge.icon}</span>
            </motion.div>

            {/* Rarity label */}
            <div className={`mt-4 inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${rarity.text} bg-black/20`}>
              {rarity.label}
            </div>
          </div>

          {/* Content */}
          <div className="p-6 text-center">
            <h3 className="text-xl font-bold text-white mb-2">{badge.name}</h3>
            <p className="text-surface-300 mb-4">{badge.description}</p>

            {/* Category */}
            <div className="flex items-center justify-center gap-2 text-sm text-surface-400 mb-4">
              <span>{categoryIcon}</span>
              <span>{categoryLabel}</span>
            </div>

            {/* Earned status */}
            {earned && badge.earned_at && (
              <div className="pt-4 border-t border-surface-700">
                <p className="text-xs text-surface-500">
                  Earned on {new Date(badge.earned_at).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </p>
              </div>
            )}

            {!earned && (
              <div className="pt-4 border-t border-surface-700">
                <p className="text-xs text-surface-500 flex items-center justify-center gap-1">
                  Not yet earned
                </p>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Single Achievement Badge Display
 */
export function AchievementBadge({
  badge,
  size = 'md',
  showDetails = true,
  earned = true,
  onClick,
  className = ''
}) {
  const rarity = rarityConfig[badge.rarity] || rarityConfig.common;

  const sizes = {
    sm: {
      container: 'w-14 h-14',
      icon: 'text-2xl',
      padding: 'p-2'
    },
    md: {
      container: 'w-20 h-20',
      icon: 'text-3xl',
      padding: 'p-3'
    },
    lg: {
      container: 'w-28 h-28',
      icon: 'text-5xl',
      padding: 'p-4'
    }
  };

  const sizeConfig = sizes[size] || sizes.md;

  return (
    <motion.div
      className={`flex flex-col items-center gap-2 ${className}`}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={earned ? { scale: 1.05 } : undefined}
      onClick={onClick}
    >
      {/* Badge Icon Container */}
      <div
        className={`
          relative ${sizeConfig.container} ${sizeConfig.padding}
          rounded-xl border-2
          bg-gradient-to-br ${rarity.bg} ${rarity.border}
          flex items-center justify-center
          ${earned ? `shadow-lg ${rarity.glow} cursor-pointer` : 'opacity-40 grayscale'}
          transition-all duration-300
        `}
      >
        {/* Icon */}
        <span className={sizeConfig.icon}>{badge.icon}</span>

        {/* Shine effect for legendary */}
        {earned && badge.rarity === 'legendary' && (
          <div className="absolute inset-0 rounded-xl overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-shimmer" />
          </div>
        )}

        {/* Lock overlay for unearned */}
        {!earned && (
          <div className="absolute inset-0 rounded-xl bg-surface-900/60 flex items-center justify-center">
            <Lock className="w-5 h-5 text-surface-400" />
          </div>
        )}
      </div>

      {/* Badge Details */}
      {showDetails && (
        <div className="text-center max-w-[100px]">
          <p className={`text-xs font-semibold truncate ${earned ? 'text-white' : 'text-surface-500'}`}>
            {badge.name}
          </p>
          <p className={`text-[10px] ${rarity.text}`}>
            {rarity.label}
          </p>
        </div>
      )}
    </motion.div>
  );
}

/**
 * Badge Grid Display
 */
export function BadgeGrid({ badges, size = 'md', emptyMessage = 'No badges yet' }) {
  if (!badges || badges.length === 0) {
    return (
      <div className="text-center py-8 text-surface-400">
        <span className="text-4xl mb-2 block"></span>
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-4">
      {badges.map((badge) => (
        <AchievementBadge
          key={badge.id || badge.slug}
          badge={badge}
          size={size}
          earned={badge.earned !== false}
        />
      ))}
    </div>
  );
}

/**
 * Badge Stats Summary
 */
export function BadgeStats({ stats }) {
  if (!stats) return null;

  return (
    <div className="flex items-center gap-4 text-sm">
      <div className="flex items-center gap-1.5">
        <span className="text-slate-400">●</span>
        <span className="text-surface-300">{stats.common || 0}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-blue-400">●</span>
        <span className="text-surface-300">{stats.rare || 0}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-purple-400">●</span>
        <span className="text-surface-300">{stats.epic || 0}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-amber-400">●</span>
        <span className="text-surface-300">{stats.legendary || 0}</span>
      </div>
      <div className="border-l border-surface-600 pl-4 ml-2">
        <span className="font-semibold text-white">{stats.total || 0}</span>
        <span className="text-surface-400 ml-1">total</span>
      </div>
    </div>
  );
}

/**
 * Compact Badge Row (for profile preview)
 */
export function BadgeRow({ badges, maxDisplay = 5, showMore = true }) {
  const displayBadges = badges.slice(0, maxDisplay);
  const remaining = badges.length - maxDisplay;

  return (
    <div className="flex items-center gap-2">
      {displayBadges.map((badge) => (
        <div
          key={badge.id || badge.slug}
          className={`
            w-8 h-8 rounded-lg border
            bg-gradient-to-br ${rarityConfig[badge.rarity]?.bg || rarityConfig.common.bg}
            ${rarityConfig[badge.rarity]?.border || rarityConfig.common.border}
            flex items-center justify-center
          `}
          title={badge.name}
        >
          <span className="text-sm">{badge.icon}</span>
        </div>
      ))}
      {showMore && remaining > 0 && (
        <div className="w-8 h-8 rounded-lg bg-surface-700 border border-surface-600 flex items-center justify-center">
          <span className="text-xs text-surface-400">+{remaining}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Category Section for Badge Showcase
 */
export function BadgeCategory({ category, badges, title }) {
  const icon = categoryIcons[category] || '';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <h3 className="text-lg font-semibold text-white capitalize">{title || category}</h3>
        <span className="text-sm text-surface-400">
          ({badges.filter(b => b.earned).length}/{badges.length})
        </span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
        {badges.map((badge) => (
          <AchievementBadge
            key={badge.id || badge.slug}
            badge={badge}
            size="md"
            earned={badge.earned}
          />
        ))}
      </div>
    </div>
  );
}

export default AchievementBadge;
