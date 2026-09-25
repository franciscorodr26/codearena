import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, ChevronDown, X, Zap } from 'lucide-react';
import { modesForPlayMenu } from '../lib/modes';

const GAME_MODES = modesForPlayMenu();

const COLOR_CLASSES = {
  green: {
    icon: 'text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/30',
    hover: 'hover:border-green-500/50 hover:bg-green-500/15',
    badge: 'bg-green-500/20 text-green-400'
  },
  purple: {
    icon: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    hover: 'hover:border-purple-500/50 hover:bg-purple-500/15',
    badge: 'bg-purple-500/20 text-purple-400'
  },
  amber: {
    icon: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    hover: 'hover:border-amber-500/50 hover:bg-amber-500/15',
    badge: 'bg-amber-500/20 text-amber-400'
  },
  yellow: {
    icon: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
    hover: 'hover:border-yellow-500/50 hover:bg-yellow-500/15',
    badge: 'bg-yellow-500/20 text-yellow-400'
  },
  cyan: {
    icon: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    hover: 'hover:border-cyan-500/50 hover:bg-cyan-500/15',
    badge: 'bg-cyan-500/20 text-cyan-400'
  },
  rose: {
    icon: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    hover: 'hover:border-rose-500/50 hover:bg-rose-500/15',
    badge: 'bg-rose-500/20 text-rose-400'
  }
};

export default function PlayMenu() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [navigating, setNavigating] = useState(null);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    function handleEscape(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  const handleModeSelect = (route, modeId) => {
    if (navigating) return;
    setNavigating(modeId);
    setIsOpen(false);
    router.push(route);
  };

  const featuredMode = GAME_MODES.find(m => m.featured);
  const otherModes = GAME_MODES.filter(m => !m.featured);

  return (
    <div className="relative">
      {/* Trigger Button */}
      <motion.button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-4 py-2 rounded-xl font-semibold transition-all ${
          isOpen
            ? 'bg-primary-500 text-white'
            : 'bg-gradient-to-r from-primary-500 to-secondary-500 text-white hover:from-primary-400 hover:to-secondary-400 shadow-lg shadow-primary-500/20'
        }`}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <Play className="w-4 h-4 fill-current" />
        <span className="hidden sm:inline">Play</span>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </motion.button>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Mobile backdrop */}
            <motion.div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
            />

            {/* Menu panel */}
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="fixed left-4 right-4 top-20 z-50 lg:absolute lg:left-auto lg:right-0 lg:top-full lg:mt-2 lg:w-[420px] lg:max-w-[calc(100vw-2rem)]"
            >
              <div className="bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-surface-800">
                  <div className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-primary-400" />
                    <h3 className="font-semibold text-white">Choose Your Arena</h3>
                  </div>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="p-1.5 text-surface-400 hover:text-white hover:bg-surface-800 rounded-lg transition-colors lg:hidden"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Featured Mode */}
                {featuredMode && (
                  <div className="p-3">
                    <motion.button
                      onClick={() => handleModeSelect(featuredMode.route, featuredMode.id)}
                      disabled={navigating === featuredMode.id}
                      className={`w-full p-4 rounded-xl border ${COLOR_CLASSES[featuredMode.color].border} ${COLOR_CLASSES[featuredMode.color].bg} ${COLOR_CLASSES[featuredMode.color].hover} transition-all text-left group`}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                    >
                      <div className="flex items-start gap-4">
                        <div className={`p-3 rounded-xl ${COLOR_CLASSES[featuredMode.color].bg} border ${COLOR_CLASSES[featuredMode.color].border}`}>
                          <featuredMode.icon className={`w-6 h-6 ${COLOR_CLASSES[featuredMode.color].icon}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-white group-hover:text-primary-300 transition-colors">
                              {featuredMode.title}
                            </span>
                            {featuredMode.badge && (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${COLOR_CLASSES[featuredMode.color].badge}`}>
                                {featuredMode.badge}
                              </span>
                            )}
                            {/* Live indicator */}
                            <span className="flex items-center gap-1 text-[10px] text-green-400">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-400"></span>
                              </span>
                              Live
                            </span>
                          </div>
                          <p className="text-sm text-surface-400">{featuredMode.description}</p>
                        </div>
                      </div>
                    </motion.button>
                  </div>
                )}

                {/* Mode Grid */}
                <div className="px-3 pb-3">
                  <div className="grid grid-cols-2 gap-2">
                    {otherModes.map((mode, index) => {
                      const colors = COLOR_CLASSES[mode.color];
                      const Icon = mode.icon;

                      return (
                        <motion.button
                          key={mode.id}
                          onClick={() => handleModeSelect(mode.route, mode.id)}
                          disabled={navigating === mode.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.03 }}
                          className={`p-3 rounded-xl border ${colors.border} ${colors.hover} transition-all text-left group`}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`p-2 rounded-lg ${colors.bg}`}>
                              <Icon className={`w-4 h-4 ${colors.icon}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-sm font-medium text-white group-hover:text-primary-300 transition-colors truncate">
                                  {mode.title}
                                </span>
                                {mode.badge && (
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${colors.badge}`}>
                                    {mode.badge}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-surface-500 truncate">{mode.description}</p>
                            </div>
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

                {/* Footer link to full modes page */}
                <div className="px-4 py-3 border-t border-surface-800 bg-surface-850">
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      router.push('/modes');
                    }}
                    className="w-full text-center text-sm text-surface-400 hover:text-primary-400 transition-colors"
                  >
                    View all modes & details →
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
