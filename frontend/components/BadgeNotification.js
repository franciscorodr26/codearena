import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

/**
 * Rarity configurations for styling
 */
const rarityConfig = {
  common: {
    bg: 'from-slate-600 to-slate-700',
    border: 'border-slate-400',
    glow: 'shadow-slate-500/30',
    text: 'text-slate-300',
    accent: 'bg-slate-500'
  },
  rare: {
    bg: 'from-blue-600 to-blue-700',
    border: 'border-blue-400',
    glow: 'shadow-blue-500/40',
    text: 'text-blue-300',
    accent: 'bg-blue-500'
  },
  epic: {
    bg: 'from-purple-600 to-purple-700',
    border: 'border-purple-400',
    glow: 'shadow-purple-500/50',
    text: 'text-purple-300',
    accent: 'bg-purple-500'
  },
  legendary: {
    bg: 'from-amber-500 to-orange-600',
    border: 'border-amber-400',
    glow: 'shadow-amber-500/60',
    text: 'text-amber-300',
    accent: 'bg-amber-500'
  }
};

/**
 * Single Badge Toast Notification
 */
function BadgeToast({ badge, onClose, index = 0 }) {
  const rarity = rarityConfig[badge.rarity] || rarityConfig.common;

  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -50, scale: 0.8 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.8 }}
      transition={{
        type: 'spring',
        stiffness: 300,
        damping: 25,
        delay: index * 0.15
      }}
      className={`
        relative overflow-hidden
        bg-gradient-to-r ${rarity.bg}
        border ${rarity.border}
        rounded-xl p-4 pr-10
        shadow-xl ${rarity.glow}
        min-w-[280px] max-w-[360px]
      `}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-2 right-2 p-1 rounded-full hover:bg-white/10 transition-colors"
      >
        <X className="w-4 h-4 text-white/70" />
      </button>

      {/* Content */}
      <div className="flex items-center gap-4">
        {/* Badge Icon */}
        <div className="relative">
          <div className={`
            w-14 h-14 rounded-xl
            bg-gradient-to-br from-white/20 to-white/5
            flex items-center justify-center
            border border-white/20
          `}>
            <span className="text-3xl">{badge.icon}</span>
          </div>
          {/* Pulse effect */}
          <div className="absolute inset-0 rounded-xl animate-ping opacity-30 bg-white" style={{ animationDuration: '1.5s' }} />
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-white/70 uppercase tracking-wide">
            Badge Unlocked!
          </p>
          <p className="text-lg font-bold text-white truncate">
            {badge.name}
          </p>
          <p className={`text-xs ${rarity.text} capitalize`}>
            {badge.rarity} Achievement
          </p>
        </div>
      </div>

      {/* Shimmer effect for legendary */}
      {badge.rarity === 'legendary' && (
        <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-shimmer" />
        </div>
      )}

      {/* Progress bar (auto-dismiss indicator) */}
      <motion.div
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: 5, ease: 'linear' }}
        className={`absolute bottom-0 left-0 right-0 h-1 ${rarity.accent} origin-left`}
      />
    </motion.div>
  );
}

/**
 * Badge Notification Container
 * Manages multiple badge notifications
 */
export function BadgeNotificationContainer({ badges, onDismiss, onDismissAll }) {
  if (!badges || badges.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-3">
      <AnimatePresence mode="popLayout">
        {badges.map((badge, index) => (
          <BadgeToast
            key={badge.id || badge.slug}
            badge={badge}
            index={index}
            onClose={() => onDismiss(badge.id || badge.slug)}
          />
        ))}
      </AnimatePresence>

      {/* Dismiss all button if multiple badges */}
      {badges.length > 1 && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onDismissAll}
          className="text-xs text-surface-400 hover:text-white transition-colors text-right pr-2"
        >
          Dismiss all
        </motion.button>
      )}
    </div>
  );
}

/**
 * Hook to manage badge notifications
 */
export function useBadgeNotifications() {
  const [pendingBadges, setPendingBadges] = useState([]);

  const showBadges = (badges) => {
    if (!Array.isArray(badges)) badges = [badges];
    setPendingBadges(prev => [...prev, ...badges]);
  };

  const dismissBadge = (badgeId) => {
    setPendingBadges(prev => prev.filter(b => (b.id || b.slug) !== badgeId));
  };

  const dismissAll = () => {
    setPendingBadges([]);
  };

  return {
    pendingBadges,
    showBadges,
    dismissBadge,
    dismissAll
  };
}

/**
 * Full-screen Badge Celebration Modal
 * For showing major badge achievements (legendary, multiple badges)
 */
export function BadgeCelebrationModal({ badges, isOpen, onClose }) {
  if (!isOpen || !badges || badges.length === 0) return null;

  const primaryBadge = badges[0];
  const rarity = rarityConfig[primaryBadge.rarity] || rarityConfig.common;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          className="text-center p-8"
          onClick={e => e.stopPropagation()}
        >
          {/* Celebration text */}
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-2xl font-bold text-white mb-6"
          >
            {badges.length > 1 ? `${badges.length} Badges Unlocked!` : 'Badge Unlocked!'}
          </motion.p>

          {/* Badge display */}
          <div className="flex justify-center gap-6 mb-8">
            {badges.slice(0, 3).map((badge, i) => (
              <motion.div
                key={badge.id || badge.slug}
                initial={{ y: 50, opacity: 0, rotate: -10 }}
                animate={{ y: 0, opacity: 1, rotate: 0 }}
                transition={{ delay: 0.3 + i * 0.15, type: 'spring' }}
                className={`
                  w-24 h-24 rounded-2xl
                  bg-gradient-to-br ${rarityConfig[badge.rarity]?.bg || rarity.bg}
                  border-2 ${rarityConfig[badge.rarity]?.border || rarity.border}
                  shadow-2xl ${rarityConfig[badge.rarity]?.glow || rarity.glow}
                  flex items-center justify-center
                `}
              >
                <span className="text-5xl">{badge.icon}</span>
              </motion.div>
            ))}
          </div>

          {/* Badge names */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="space-y-2 mb-8"
          >
            {badges.map(badge => (
              <div key={badge.id || badge.slug}>
                <p className="text-xl font-bold text-white">{badge.name}</p>
                <p className={`text-sm ${rarityConfig[badge.rarity]?.text || rarity.text} capitalize`}>
                  {badge.rarity} • {badge.description}
                </p>
              </div>
            ))}
          </motion.div>

          {/* Close button */}
          <motion.button
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.6 }}
            onClick={onClose}
            className="px-8 py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-medium transition-colors"
          >
            Awesome!
          </motion.button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default BadgeNotificationContainer;
