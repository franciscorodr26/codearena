// frontend/components/GamificationElements.js
// Gamification and engagement elements for the practice page
import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Target,
  Clock,
  TrendingUp,
  Award,
  Timer,
  Activity,
  CheckCircle
} from 'lucide-react';

// Design system colors for SVG/canvas contexts where Tailwind classes can't be used
const TIMER_COLORS = {
  success: { stroke: '#22c55e', glow: 'rgba(34, 197, 94, 0.5)' },   // success
  warning: { stroke: '#f59e0b', glow: 'rgba(245, 158, 11, 0.5)' },  // warning
  error:   { stroke: '#ef4444', glow: 'rgba(239, 68, 68, 0.5)' },   // error/danger
  paused:  { stroke: '#64748b', glow: 'rgba(100, 116, 139, 0.25)' }, // surface-500
};

// =============================================================================
// CIRCULAR PROGRESS TIMER
// =============================================================================
export const CircularProgressTimer = ({
  timeElapsed,
  idealTime = 600, // 10 min default
  size = 64,
  strokeWidth = 4,
  showFlames = false,
  isPaused = false,
  className = ''
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;

  // Calculate progress (0-1, capped at 1)
  const progress = Math.min(timeElapsed / idealTime, 1);
  const strokeDashoffset = circumference - (progress * circumference);

  // Color transitions: green (0-33%) -> yellow (33-66%) -> red (66-100%)
  const getColor = () => {
    if (progress < 0.33) return TIMER_COLORS.success;
    if (progress < 0.66) return TIMER_COLORS.warning;
    return TIMER_COLORS.error;
  };

  const colors = isPaused
    ? TIMER_COLORS.paused
    : getColor();
  const isUnderPressure = !isPaused && (progress >= 0.9 || timeElapsed >= idealTime - 60);
  const isCritical = !isPaused && progress >= 0.95;

  // Format time display
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>

      {/* SVG Circle */}
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke={colors.stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <Clock className={`h-3 w-3 mb-0.5 ${isPaused ? 'text-surface-500' : isUnderPressure ? 'text-red-400' : 'text-surface-400'}`} />
        <span className={`font-mono text-xs font-bold ${
          isCritical ? 'text-red-400' :
          isUnderPressure ? 'text-orange-400' :
          'text-white'
        }`}>
          {formatTime(timeElapsed)}
        </span>
      </div>
    </div>
  );
};

// =============================================================================
// STREAK COUNTER
// =============================================================================
export const StreakCounter = ({
  streak = 0,
  showAnimation = true,
  size = 'md',
  className = ''
}) => {
  const [showPlusOne, setShowPlusOne] = useState(false);
  const prevStreakRef = useRef(streak);

  useEffect(() => {
    if (streak > prevStreakRef.current && showAnimation) {
      setShowPlusOne(true);
      setTimeout(() => setShowPlusOne(false), 1500);
    }
    prevStreakRef.current = streak;
  }, [streak, showAnimation]);

  const sizeClasses = {
    sm: 'text-xs px-2.5 py-1',
    md: 'text-sm px-3 py-1',
    lg: 'text-base px-4 py-1.5'
  };

  const iconSizes = {
    sm: 'h-3.5 w-3.5',
    md: 'h-4 w-4',
    lg: 'h-5 w-5'
  };

  if (streak === 0) return null;

  return (
    <div
      className={`flex items-center gap-1.5 bg-surface-800/60 rounded-full border border-surface-700 ${sizeClasses[size]} ${className}`}
    >
      <span className="font-bold text-white">{streak}</span>
      <span className="text-surface-400 text-xs">day streak</span>
    </div>
  );
};

// =============================================================================
// PROGRESS SECTION
// =============================================================================
export const ProgressSection = ({
  problemsSolvedToday = 0,
  dailyGoal = 5,
  xpGained = 0,
  sessionXP = 0,
  className = ''
}) => {
  const progress = Math.min((problemsSolvedToday / dailyGoal) * 100, 100);
  const isGoalReached = problemsSolvedToday >= dailyGoal;

  return (
    <motion.div
      className={`flex items-center gap-3 ${className}`}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
    >
      {/* Problems solved today */}
      <div className="flex items-center gap-2 bg-surface-800/60 rounded-lg px-3 py-1.5 border border-surface-700">
        <Target className={`h-4 w-4 ${isGoalReached ? 'text-success' : 'text-primary-400'}`} />
        <div className="flex flex-col">
          <span className="text-xs text-surface-400">Today</span>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-white text-sm">{problemsSolvedToday}</span>
            <span className="text-surface-500 text-xs">/ {dailyGoal}</span>
          </div>
        </div>
        {/* Mini progress bar */}
        <div className="h-1.5 w-12 bg-surface-700 rounded-full overflow-hidden">
          <motion.div
            className={`h-full ${isGoalReached ? 'bg-success' : 'bg-primary-500'}`}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* XP gained this session */}
      {sessionXP > 0 && (
        <div className="flex items-center gap-1.5 bg-surface-800/60 rounded-lg px-2.5 py-1 border border-surface-700">
          <span className="font-bold text-white text-sm">+{sessionXP}</span>
          <span className="text-surface-400 text-xs">XP</span>
        </div>
      )}
    </motion.div>
  );
};

// =============================================================================
// QUICK STATS BAR
// =============================================================================
export const QuickStatsBar = ({
  rating = 1000,
  winStreak = 0,
  fastestSolveTime = null,
  rank = 'Silver',
  className = ''
}) => {
  const getRankColor = (rank) => {
    const colors = {
      'Bronze': 'text-amber-600',
      'Silver': 'text-slate-300',
      'Gold': 'text-yellow-400',
      'Platinum': 'text-cyan-300',
      'Diamond': 'text-blue-400',
      'Master': 'text-purple-400',
      'Grandmaster': 'text-red-400'
    };
    return colors[rank] || 'text-white';
  };

  const formatTime = (seconds) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <motion.div
      className={`flex items-center gap-2 ${className}`}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Rating */}
      <div className="flex items-center gap-1.5 bg-surface-800/50 rounded-md px-2.5 py-1.5 border border-surface-700/50">
        <span className={`font-mono font-bold text-xs ${getRankColor(rank)}`}>{rating}</span>
      </div>

      {/* Win Streak */}
      {winStreak > 0 && (
        <div className="flex items-center gap-1 bg-success/10 rounded-md px-2.5 py-1.5 border border-success/20">
          <TrendingUp className="h-3.5 w-3.5 text-success" />
          <span className="font-bold text-xs text-success">{winStreak}W</span>
        </div>
      )}

      {/* Fastest Solve */}
      {fastestSolveTime && (
        <div className="flex items-center gap-1 bg-warning/10 rounded-md px-2.5 py-1.5 border border-warning/20">
          <Timer className="h-3.5 w-3.5 text-warning" />
          <span className="font-mono text-xs text-warning">{formatTime(fastestSolveTime)}</span>
        </div>
      )}
    </motion.div>
  );
};

// =============================================================================
// OPPONENT PREVIEW (for matchmaking)
// =============================================================================
const OpponentPreviewComponent = ({
  name = '',
  rating = 1000,
  rank = 'Silver',
  avatar,
  isTyping = false,
  className = ''
}) => {
  // Guard against null/undefined/empty name
  if (!name || typeof name !== 'string') return null;

  const getRankBadge = (rank) => {
    const badges = {
      'Bronze': { bg: 'bg-amber-600/20', text: 'text-amber-500', border: 'border-amber-500/30' },
      'Silver': { bg: 'bg-slate-400/20', text: 'text-slate-300', border: 'border-slate-400/30' },
      'Gold': { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
      'Platinum': { bg: 'bg-cyan-400/20', text: 'text-cyan-300', border: 'border-cyan-400/30' },
      'Diamond': { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
      'Master': { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' },
      'Grandmaster': { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' }
    };
    return badges[rank] || badges['Silver'];
  };

  const rankBadge = getRankBadge(rank);

  return (
    <motion.div
      className={`flex items-center gap-3 bg-surface-800/60 rounded-lg px-3 py-2 border border-surface-700 ${className}`}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      {/* Avatar */}
      <div className="relative">
        <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-secondary-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
          {avatar || (name && name.length > 0 ? name.charAt(0).toUpperCase() : '?')}
        </div>
        {isTyping && (
          <motion.div
            className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-success rounded-full border-2 border-surface-800"
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ duration: 0.8, repeat: Infinity }}
          />
        )}
      </div>

      {/* Info */}
      <div className="flex flex-col">
        <span className="text-white font-medium text-sm">{name}</span>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-1.5 py-0.5 rounded ${rankBadge.bg} ${rankBadge.text} ${rankBadge.border} border`}>
            {rank}
          </span>
          <span className="text-surface-400 text-xs">{rating}</span>
        </div>
      </div>

      {/* Typing indicator */}
      {isTyping && (
        <div className="flex items-center gap-1 ml-auto">
          <Activity className="h-3 w-3 text-success animate-pulse" />
          <span className="text-success text-xs">typing...</span>
        </div>
      )}
    </motion.div>
  );
};
export const OpponentPreview = memo(OpponentPreviewComponent);

// =============================================================================
// ACHIEVEMENT TOAST
// =============================================================================
export const AchievementToast = ({
  title,
  description,
  icon: Icon = CheckCircle,
  color = 'primary',
  onClose,
  duration = 4000,
  stackIndex = 0
}) => {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const colorClasses = {
    primary: 'from-primary-500/20 to-primary-600/20 border-primary-500/40',
    success: 'from-success/20 to-green-600/20 border-success/40',
    warning: 'from-warning/20 to-orange-600/20 border-warning/40',
    purple: 'from-purple-500/20 to-purple-600/20 border-purple-500/40',
    gold: 'from-yellow-500/20 to-amber-600/20 border-yellow-500/40'
  };

  const iconColors = {
    primary: 'text-primary-400',
    success: 'text-success',
    warning: 'text-warning',
    purple: 'text-purple-400',
    gold: 'text-yellow-400'
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      style={{ bottom: 80 + (stackIndex * 88) }}
      className="fixed left-1/2 z-50 flex -translate-x-1/2 transform items-center gap-3 rounded-xl border border-surface-600 bg-surface-800 px-5 py-3 shadow-lg backdrop-blur-md"
    >
      <Icon className={`h-6 w-6 ${iconColors[color]}`} />

      <div className="flex flex-col">
        <span className="text-white font-bold text-sm">{title}</span>
        <span className="text-surface-300 text-xs">{description}</span>
      </div>
    </motion.div>
  );
};

// =============================================================================
// MOTIVATIONAL MESSAGE TOAST
// =============================================================================
const MotivationalToastComponent = ({
  message,
  type = 'encouragement', // 'encouragement', 'celebration', 'tip'
  onClose,
  duration = 3000
}) => {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const typeConfig = {
    encouragement: {
      icon: CheckCircle,
      bg: 'bg-surface-800',
      border: 'border-surface-600',
      iconColor: 'text-blue-400'
    },
    celebration: {
      icon: CheckCircle,
      bg: 'bg-surface-800',
      border: 'border-surface-600',
      iconColor: 'text-success'
    },
    tip: {
      icon: Award,
      bg: 'bg-surface-800',
      border: 'border-surface-600',
      iconColor: 'text-primary-400'
    }
  };

  const config = typeConfig[type];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 50 }}
      className={`fixed bottom-6 right-6 z-40 ${config.bg} backdrop-blur-sm rounded-lg px-4 py-2.5 border ${config.border} shadow-lg flex items-center gap-2 max-w-xs`}
    >
      <Icon className={`h-4 w-4 ${config.iconColor} flex-shrink-0`} />
      <span className="text-white text-sm">{message}</span>
    </motion.div>
  );
};
export const MotivationalToast = memo(MotivationalToastComponent);

// =============================================================================
// FIRST LINE CELEBRATION (micro-interaction when typing starts)
// =============================================================================
export const FirstLineCelebration = ({ show }) => {
  // Intentionally minimal - no flashy celebration needed
  return null;
};

// =============================================================================
// USE ACHIEVEMENTS HOOK
// =============================================================================
export const useAchievements = () => {
  const [achievements, setAchievements] = useState([]);
  const shownAchievementsRef = useRef(new Set());

  const triggerAchievement = useCallback((achievement) => {
    // Prevent duplicate achievements in same session
    const key = `${achievement.id || achievement.title}`;
    if (shownAchievementsRef.current.has(key)) return;

    shownAchievementsRef.current.add(key);
    const id = Date.now();
    setAchievements(prev => [...prev, { ...achievement, id }]);

    // Auto-remove after duration
    setTimeout(() => {
      setAchievements(prev => prev.filter(a => a.id !== id));
    }, achievement.duration || 4000);
  }, []);

  const dismissAchievement = useCallback((id) => {
    setAchievements(prev => prev.filter(a => a.id !== id));
  }, []);

  const checkAchievements = useCallback(({
    problemsSolvedToday = 0,
    sessionSolveCount = 0,
    timeElapsed = 0,
    isFirstProblem = false,
    allTestsPassed = false,
    difficulty = 'Easy',
    firstTrySuccess = false,
    submitCount = 1
  }) => {
    // First problem of the day
    if (isFirstProblem && problemsSolvedToday === 1) {
      triggerAchievement({
        title: "First Problem of the Day",
        description: "You're building momentum. Keep it up.",
        icon: CheckCircle,
        color: 'primary'
      });
    }

    // First try success - solved on first submit
    if (allTestsPassed && firstTrySuccess && submitCount === 1) {
      triggerAchievement({
        title: "First Try",
        description: "Solved on your first attempt.",
        icon: Target,
        color: 'success'
      });
    }

    // Speed achievements are exclusive so one quick solve does not fire several similar toasts.
    if (allTestsPassed) {
      if (timeElapsed < 30) {
        triggerAchievement({
          title: "Blitz Solve",
          description: "Solved in under 30 seconds.",
          icon: Timer,
          color: 'primary',
          duration: 5000
        });
      } else if (timeElapsed < 60) {
        triggerAchievement({
          title: "Speed Record",
          description: "Solved in under 1 minute.",
          icon: Timer,
          color: 'warning'
        });
      } else if (timeElapsed < 180) {
        triggerAchievement({
          title: "Fast Solve",
          description: "Solved in under 3 minutes.",
          icon: Timer,
          color: 'purple'
        });
      }
    }

    // Hard problem conquered
    if (allTestsPassed && difficulty === 'Hard') {
      triggerAchievement({
        title: "Hard Problem Solved",
        description: "You tackled a challenging one.",
        icon: CheckCircle,
        color: 'purple'
      });
    }

    // Medium problem speed run - under 2 min on medium
    if (allTestsPassed && difficulty === 'Medium' && timeElapsed < 120) {
      triggerAchievement({
        title: "Medium Speed Run",
        description: "Quick solve on a medium problem.",
        icon: TrendingUp,
        color: 'success'
      });
    }

    // 3 in a row
    if (sessionSolveCount === 3) {
      triggerAchievement({
        title: "Three in a Row",
        description: "3 problems solved this session.",
        icon: Award,
        color: 'success'
      });
    }

    // 5 in a row
    if (sessionSolveCount === 5) {
      triggerAchievement({
        title: "Five Solved",
        description: "5 problems solved this session.",
        icon: Award,
        color: 'warning'
      });
    }

    // 10 problems in one session
    if (sessionSolveCount === 10) {
      triggerAchievement({
        title: "Marathon Session",
        description: "10 problems in one session.",
        icon: Award,
        color: 'primary',
        duration: 6000
      });
    }
  }, [triggerAchievement]);

  return {
    achievements,
    triggerAchievement,
    dismissAchievement,
    checkAchievements
  };
};

// =============================================================================
// USE MOTIVATIONAL MESSAGES HOOK
// =============================================================================
export const useMotivationalMessages = () => {
  const [message, setMessage] = useState(null);
  const lastMessageTimeRef = useRef(0);
  const hasShownFirstLineRef = useRef(false);

  const showMessage = useCallback((msg, type = 'encouragement') => {
    // Prevent spam - minimum 30 seconds between messages
    const now = Date.now();
    if (now - lastMessageTimeRef.current < 30000) return;

    lastMessageTimeRef.current = now;
    setMessage({ text: msg, type, id: now });
  }, []);

  const dismissMessage = useCallback(() => {
    setMessage(null);
  }, []);

  const checkMotivation = useCallback(({
    timeElapsed = 0,
    codeLength = 0,
    hasStartedTyping = false
  }) => {
    // First line encouragement
    if (hasStartedTyping && codeLength > 0 && !hasShownFirstLineRef.current) {
      hasShownFirstLineRef.current = true;
      showMessage("Great start! You've got this!", 'celebration');
    }

    // 2 minute encouragement
    if (timeElapsed === 120 && codeLength > 50) {
      showMessage("You're making progress. Keep going!", 'encouragement');
    }

    // 5 minute tip
    if (timeElapsed === 300) {
      showMessage("Try breaking the problem into smaller steps", 'tip');
    }
  }, [showMessage]);

  const reset = useCallback(() => {
    hasShownFirstLineRef.current = false;
    lastMessageTimeRef.current = 0;
    setMessage(null);
  }, []);

  return {
    message,
    showMessage,
    dismissMessage,
    checkMotivation,
    reset
  };
};

export default {
  CircularProgressTimer,
  StreakCounter,
  ProgressSection,
  QuickStatsBar,
  OpponentPreview,
  AchievementToast,
  MotivationalToast,
  FirstLineCelebration,
  useAchievements,
  useMotivationalMessages
};
