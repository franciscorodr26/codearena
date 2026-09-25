import { useState, useEffect, useCallback, memo, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import {
  Trophy, Target, Zap, Clock, Award, Activity,
  Play, Swords, BookOpen, Calendar, Flame, Code,
  TrendingUp, ChevronRight, Crown, Shield, Star,
  RefreshCw, AlertCircle, Sparkles, Users, ArrowUp,
  ArrowDown, Timer, Rocket, Heart, Menu, X,
  ChevronLeft, PartyPopper, Bot, Lightbulb, LogOut,
  MessageSquare, Wand2, Gamepad2
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import SearchBar from '../components/SearchBar';
import NotificationBell from '../components/NotificationBell';
import { useMessaging } from '../contexts/MessagingContext';
import { useFriends } from '../contexts/FriendContext';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { FadeIn, StaggerContainer, StaggerItem, CountUp, TiltCard, HoverScale, PulseGlow } from '../components/ui/Motion';
import FloatingOrbs from '../components/ui/FloatingOrbs';
import AvatarDisplay from '../components/ui/AvatarDisplay';
import { Skeleton } from '../components/ui/Skeleton';
import ProfileDropdown from '../components/ProfileDropdown';
import Logo from '../components/Logo';
import { config } from '../config/env';
import { fetchWithTimeout, AUTH_ERROR_EVENT } from '../utils/fetch';
import { withRetry } from '../utils/errorHandling';

const API = config.backend_url;

function createDashboardFetchError(response, fallbackMessage) {
  const error = new Error(fallbackMessage);
  error.response = response;
  error.status = response.status;
  return error;
}

// Rank tier configuration with enhanced styling
const RANK_TIERS = [
  { name: 'Bronze', min: 0, max: 1199, color: 'from-amber-700 to-amber-600', textColor: 'text-orange-400', glowColor: 'rgba(217, 119, 6, 0.4)', icon: Shield, emoji: '🥉' },
  { name: 'Silver', min: 1200, max: 1399, color: 'from-slate-400 to-slate-300', textColor: 'text-slate-300', glowColor: 'rgba(148, 163, 184, 0.4)', icon: Shield, emoji: '🥈' },
  { name: 'Gold', min: 1400, max: 1599, color: 'from-yellow-500 to-yellow-400', textColor: 'text-yellow-400', glowColor: 'rgba(234, 179, 8, 0.4)', icon: Award, emoji: '🥇' },
  { name: 'Platinum', min: 1600, max: 1799, color: 'from-cyan-400 to-cyan-300', textColor: 'text-cyan-400', glowColor: 'rgba(34, 211, 238, 0.4)', icon: Star, emoji: '💎' },
  { name: 'Diamond', min: 1800, max: 1999, color: 'from-blue-400 to-purple-400', textColor: 'text-blue-400', glowColor: 'rgba(96, 165, 250, 0.4)', icon: Crown, emoji: '💠' },
  { name: 'Master', min: 2000, max: 2199, color: 'from-purple-500 to-pink-500', textColor: 'text-purple-400', glowColor: 'rgba(168, 85, 247, 0.5)', icon: Crown, emoji: '👑' },
  { name: 'Grandmaster', min: 2200, max: Infinity, color: 'from-red-500 to-orange-500', textColor: 'text-red-400', glowColor: 'rgba(239, 68, 68, 0.5)', icon: Crown, emoji: '🏆' }
];

const ACTIVITY_TYPE_CONFIG = {
  coding_battle: { icon: 'Swords', color: 'text-blue-400', bgColor: 'bg-blue-400/10', label: 'Battle' },
  solo_practice: { icon: 'Code', color: 'text-green-400', bgColor: 'bg-green-400/10', label: 'Practice' },
  prompt_practice: { icon: 'MessageSquare', color: 'text-amber-400', bgColor: 'bg-amber-400/10', label: 'Prompt' },
  game_created: { icon: 'Gamepad2', color: 'text-pink-400', bgColor: 'bg-pink-400/10', label: 'Game' },
  prompt_1v1: { icon: 'Zap', color: 'text-cyan-400', bgColor: 'bg-cyan-400/10', label: '1v1' },
};

function MiniSparkline({ scores, width = 60, height = 20, color = '#f59e0b' }) {
  if (!scores || scores.length < 2) return null;
  const validScores = scores.filter(s => s != null);
  if (validScores.length < 2) return null;
  const min = Math.min(...validScores);
  const max = Math.max(...validScores);
  const range = max - min || 1;
  const points = validScores.map((s, i) => {
    const x = (i / (validScores.length - 1)) * width;
    const y = height - ((s - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = now - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days >= 365) return `${Math.floor(days / 365)}y`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

function getRankTier(rating) {
  return RANK_TIERS.find(t => rating >= t.min && rating <= t.max) || RANK_TIERS[0];
}

function getRankIndex(rating) {
  return RANK_TIERS.findIndex(t => rating >= t.min && rating <= t.max);
}

const RANK_SOLID_COLORS = {
  Bronze: '#fb923c',
  Silver: '#cbd5e1',
  Gold: '#facc15',
  Platinum: '#22d3ee',
  Diamond: '#60a5fa',
  Master: '#c084fc',
  Grandmaster: '#f87171'
};

const RANK_GRADIENTS = {
  Bronze: 'linear-gradient(135deg, #b45309, #d97706)',
  Silver: 'linear-gradient(135deg, #94a3b8, #cbd5e1)',
  Gold: 'linear-gradient(135deg, #eab308, #facc15)',
  Platinum: 'linear-gradient(135deg, #22d3ee, #67e8f9)',
  Diamond: 'linear-gradient(135deg, #60a5fa, #c084fc)',
  Master: 'linear-gradient(135deg, #a855f7, #ec4899)',
  Grandmaster: 'linear-gradient(135deg, #ef4444, #f97316)'
};

function getRankSurfaceStyle(rankTier) {
  return {
    backgroundColor: RANK_SOLID_COLORS[rankTier.name] || '#14b8a6',
    backgroundImage: RANK_GRADIENTS[rankTier.name],
    forcedColorAdjust: 'none'
  };
}

function getRankTextStyle(rankTier) {
  return {
    '--dashboard-gradient-fallback': RANK_SOLID_COLORS[rankTier.name] || '#5eead4'
  };
}

// Confetti Celebration Component
const ConfettiCelebration = memo(function ConfettiCelebration({ show, message, emoji }) {
  if (!show) return null;

  const confettiColors = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444'];
  const particles = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    color: confettiColors[i % confettiColors.length],
    x: Math.random() * 100,
    delay: Math.random() * 0.5,
    duration: 2 + Math.random() * 2,
    size: 6 + Math.random() * 8,
    rotation: Math.random() * 360,
  }));

  return (
    <motion.div
      className="fixed inset-0 z-50 pointer-events-none overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Confetti particles */}
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute"
          style={{
            left: `${p.x}%`,
            top: '-20px',
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            borderRadius: Math.random() > 0.5 ? '50%' : '2px',
          }}
          initial={{ y: -20, rotate: 0, opacity: 1 }}
          animate={{
            y: window.innerHeight + 100,
            rotate: p.rotation + 720,
            opacity: [1, 1, 0],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            ease: 'easeIn',
          }}
        />
      ))}

      {/* Center celebration message */}
      <motion.div
        className="absolute inset-0 flex items-center justify-center pointer-events-auto"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
      >
        <div className="bg-surface-900/95 backdrop-blur-lg border border-surface-700 rounded-3xl p-8 text-center shadow-2xl max-w-sm mx-4">
          <motion.div
            className="text-6xl mb-4"
            animate={{ scale: [1, 1.3, 1], rotate: [0, 10, -10, 0] }}
            transition={{ duration: 0.6, repeat: 2 }}
          >
            {emoji || '🎉'}
          </motion.div>
          <motion.h2
            className="text-2xl font-bold text-white mb-2"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            {message || 'Congratulations!'}
          </motion.h2>
          <motion.div
            className="flex justify-center gap-1"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            {[...Array(5)].map((_, i) => (
              <motion.span
                key={i}
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 0.5, delay: i * 0.1, repeat: Infinity, repeatDelay: 1 }}
              >
                ⭐
              </motion.span>
            ))}
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
});

// Personal Best Badge
const PersonalBestBadge = memo(function PersonalBestBadge({ show }) {
  if (!show) return null;

  return (
    <motion.div
      className="absolute -top-1 -left-1 z-20"
      initial={{ scale: 0, rotate: -45 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 300 }}
    >
      <div className="bg-gradient-to-r from-yellow-500 to-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg flex items-center gap-1">
        <Star className="w-3 h-3 fill-current" />
        NEW BEST
      </div>
    </motion.div>
  );
});

function getNextRankTier(rating) {
  const currentIndex = RANK_TIERS.findIndex(t => rating >= t.min && rating <= t.max);
  if (currentIndex < RANK_TIERS.length - 1) {
    return RANK_TIERS[currentIndex + 1];
  }
  return null;
}

// Time-based greeting with personality
function getGreeting(username) {
  const hour = new Date().getHours();
  const name = username || 'Coder';
  if (hour < 6) return `Burning the midnight oil, ${name}?`;
  if (hour < 12) return `Good morning, ${name}`;
  if (hour < 17) return `Good afternoon, ${name}`;
  if (hour < 21) return `Good evening, ${name}`;
  return `Late night coding, ${name}?`;
}

// Motivational messages based on performance
function getMotivationalMessage(stats) {
  if (!stats) return "Ready to start your coding journey?";

  const { wins, losses, currentStreak, winRate } = stats;
  const total = (wins || 0) + (losses || 0);

  if (total === 0) return "Your first victory awaits! Pick a mode below.";
  if (currentStreak >= 5) return "You're on fire! Keep the streak going!";
  if (currentStreak >= 3) return "Hot streak! You're unstoppable right now.";
  if (winRate >= 70) return "Dominating the arena! Top-tier performance.";
  if (winRate >= 50) return "Solid performance. Keep pushing forward!";
  if (losses > wins && total >= 5) return "Every loss is a lesson. Your comeback starts now!";
  return "The arena awaits. Show them what you've got!";
}

// Time since last activity
function getTimeSince(dateString) {
  if (!dateString) return null;
  const now = new Date();
  const then = new Date(dateString);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Animated Rank Badge with Glow
const AnimatedRankBadge = memo(function AnimatedRankBadge({ rating, size = 'lg' }) {
  const rankTier = getRankTier(rating);
  const RankIcon = rankTier.icon;

  const sizeClasses = {
    sm: 'w-10 h-10',
    md: 'w-14 h-14',
    lg: 'w-20 h-20'
  };

  const iconSizes = {
    sm: 'w-5 h-5',
    md: 'w-7 h-7',
    lg: 'w-10 h-10'
  };

  return (
    <motion.div
      className={`relative ${sizeClasses[size]} rounded-2xl bg-gradient-to-br ${rankTier.color} flex items-center justify-center`}
      style={getRankSurfaceStyle(rankTier)}
      initial={{ scale: 0, rotate: -180 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
    >
      {/* Glow effect */}
      <motion.div
        className="absolute inset-0 rounded-2xl"
        animate={{
          boxShadow: [
            `0 0 20px ${rankTier.glowColor}`,
            `0 0 40px ${rankTier.glowColor}`,
            `0 0 20px ${rankTier.glowColor}`,
          ],
        }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <RankIcon className={`${iconSizes[size]} text-white relative z-10`} />

      {/* Sparkle particles for high ranks */}
      {rating >= 1600 && (
        <>
          {[...Array(3)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-1 h-1 bg-white rounded-full"
              initial={{ opacity: 0, scale: 0 }}
              animate={{
                opacity: [0, 1, 0],
                scale: [0, 1, 0],
                x: [0, (i - 1) * 20],
                y: [0, -20 - i * 5],
              }}
              transition={{
                duration: 1.5,
                delay: i * 0.3,
                repeat: Infinity,
                repeatDelay: 1,
              }}
            />
          ))}
        </>
      )}
    </motion.div>
  );
});

// Streak Fire Animation
const StreakFire = memo(function StreakFire({ streak }) {
  if (streak < 3) return null;

  const intensity = Math.min(streak, 10);

  return (
    <motion.div
      className="absolute -top-2 -right-2"
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 300 }}
    >
      <motion.div
        animate={{
          scale: [1, 1.2, 1],
          rotate: [-5, 5, -5]
        }}
        transition={{ duration: 0.5, repeat: Infinity }}
        className="text-2xl"
      >
        🔥
      </motion.div>
      {intensity >= 5 && (
        <motion.span
          className="absolute -top-1 -right-1 text-xs font-bold text-orange-400"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          x{streak}
        </motion.span>
      )}
    </motion.div>
  );
});

// Rating Chart Component with enhanced animations
const RatingChart = memo(function RatingChart({ data, width = 600, height = 180 }) {
  if (!data || data.length < 2) {
    return (
      <motion.div
        className="flex items-center justify-center h-44 text-surface-500"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="text-center">
          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <TrendingUp className="w-10 h-10 mx-auto mb-3 opacity-40" />
          </motion.div>
          <p className="text-sm">Play more battles to see your rating history</p>
          <p className="text-xs text-surface-600 mt-1">Your journey starts with a single battle</p>
        </div>
      </motion.div>
    );
  }

  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const ratings = data.map(d => d.rating);
  const minRating = Math.min(...ratings) - 50;
  const maxRating = Math.max(...ratings) + 50;
  const ratingRange = maxRating - minRating;

  const xScale = (i) => padding.left + (i / (data.length - 1)) * chartWidth;
  const yScale = (rating) => padding.top + chartHeight - ((rating - minRating) / ratingRange) * chartHeight;

  const pathD = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.rating)}`).join(' ');
  const areaD = pathD + ` L ${xScale(data.length - 1)} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom} Z`;

  // Calculate trend
  const lastRating = data[data.length - 1]?.rating || 0;
  const firstRating = data[0]?.rating || 0;
  const trend = lastRating - firstRating;

  return (
    <div className="relative">
      {/* Trend indicator */}
      <motion.div
        className={`absolute top-0 right-0 flex items-center gap-1 text-sm font-medium ${
          trend > 0 ? 'text-green-400' : trend < 0 ? 'text-red-400' : 'text-surface-400'
        }`}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 1 }}
      >
        {trend > 0 ? <ArrowUp className="w-4 h-4" /> : trend < 0 ? <ArrowDown className="w-4 h-4" /> : null}
        {trend !== 0 && <span>{trend > 0 ? '+' : ''}{trend}</span>}
      </motion.div>

      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="dashboardRatingGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgb(139, 92, 246)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="rgb(139, 92, 246)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="dashboardLineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgb(99, 102, 241)" />
            <stop offset="50%" stopColor="rgb(139, 92, 246)" />
            <stop offset="100%" stopColor="rgb(236, 72, 153)" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => (
          <g key={i}>
            <motion.line
              x1={padding.left}
              y1={padding.top + chartHeight * pct}
              x2={width - padding.right}
              y2={padding.top + chartHeight * pct}
              stroke="rgba(255,255,255,0.08)"
              strokeDasharray="4,4"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
            />
            <text
              x={padding.left - 8}
              y={padding.top + chartHeight * pct + 4}
              textAnchor="end"
              fill="rgba(255,255,255,0.4)"
              fontSize="10"
            >
              {Math.round(maxRating - ratingRange * pct)}
            </text>
          </g>
        ))}

        {/* Area fill */}
        <motion.path
          d={areaD}
          fill="url(#dashboardRatingGradient)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1 }}
        />

        {/* Line with glow */}
        <motion.path
          d={pathD}
          fill="none"
          stroke="url(#dashboardLineGradient)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#glow)"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        />

        {/* Data points */}
        {data.map((d, i) => (
          <motion.circle
            key={i}
            cx={xScale(i)}
            cy={yScale(d.rating)}
            r="5"
            fill={d.result === 'win' ? '#10b981' : d.result === 'loss' ? '#ef4444' : '#f59e0b'}
            stroke="white"
            strokeWidth="2"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 1 + i * 0.05, type: 'spring' }}
          />
        ))}

        {/* Current rating highlight */}
        {data.length > 0 && (
          <g>
            <motion.circle
              cx={xScale(data.length - 1)}
              cy={yScale(data[data.length - 1].rating)}
              r="8"
              fill="rgb(139, 92, 246)"
              stroke="white"
              strokeWidth="3"
              initial={{ scale: 0 }}
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ delay: 1.5, duration: 0.5 }}
            />
          </g>
        )}
      </svg>
    </div>
  );
});

// Activity Heatmap with enhanced tooltips and mobile support
const ActivityHeatmap = memo(function ActivityHeatmap({ data }) {
  const [hoveredDay, setHoveredDay] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const scrollRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Check scroll position for mobile arrows
  const checkScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 5);
    }
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (el) {
      el.addEventListener('scroll', checkScroll);
      // Scroll to end (most recent) on mobile
      if (window.innerWidth < 768) {
        el.scrollLeft = el.scrollWidth;
      }
      return () => el.removeEventListener('scroll', checkScroll);
    }
  }, [data, checkScroll]);

  const scroll = (direction) => {
    if (scrollRef.current) {
      const amount = direction === 'left' ? -100 : 100;
      scrollRef.current.scrollBy({ left: amount, behavior: 'smooth' });
    }
  };

  if (!data || !data.length) {
    return (
      <motion.div
        className="flex items-center justify-center h-28 text-surface-500 text-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="text-center">
          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Calendar className="w-8 h-8 mx-auto mb-2 opacity-40" />
          </motion.div>
          <p className="mb-1">Start playing to build your activity streak!</p>
          <p className="text-xs text-surface-600">Your journey awaits</p>
        </div>
      </motion.div>
    );
  }

  const weeks = [];
  for (let i = 0; i < data.length; i += 7) {
    weeks.push(data.slice(i, i + 7));
  }

  const intensityColors = [
    'bg-surface-800 hover:bg-surface-700 active:bg-surface-600',
    'bg-emerald-900/50 hover:bg-emerald-800/60 active:bg-emerald-700/70',
    'bg-emerald-700/60 hover:bg-emerald-600/70 active:bg-emerald-500/80',
    'bg-emerald-500/70 hover:bg-emerald-400/80 active:bg-emerald-300/90',
    'bg-emerald-400 hover:bg-emerald-300 active:bg-emerald-200'
  ];

  // Calculate total activity
  const totalProblems = data.reduce((sum, d) => sum + (d.problems || 0), 0);
  const activeDays = data.filter(d => d.problems > 0).length;
  const currentStreak = calculateCurrentStreak(data);

  function calculateCurrentStreak(days) {
    let streak = 0;
    const reversed = [...days].reverse();
    for (const day of reversed) {
      if (day.problems > 0) streak++;
      else break;
    }
    return streak;
  }

  const displayDay = selectedDay || hoveredDay;

  return (
    <div className="space-y-3">
      {/* Summary stats - mobile optimized */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-surface-400">
          <span className="text-white font-semibold">{totalProblems}</span> problems in{' '}
          <span className="text-white font-semibold">{activeDays}</span> days
        </span>
        {currentStreak > 0 && (
          <motion.span
            className="flex items-center gap-1 text-orange-400 text-xs bg-orange-500/10 px-2 py-1 rounded-full"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
          >
            <Flame className="w-3 h-3" />
            {currentStreak} day streak
          </motion.span>
        )}
      </div>

      {/* Heatmap grid with mobile scroll controls */}
      <div className="relative">
        {/* Mobile scroll arrows */}
        <AnimatePresence>
          {canScrollLeft && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => scroll('left')}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 bg-surface-800/90 backdrop-blur rounded-full flex items-center justify-center text-surface-300 hover:text-white hover:bg-surface-700 transition-colors md:hidden shadow-lg"
            >
              <ChevronLeft className="w-4 h-4" />
            </motion.button>
          )}
          {canScrollRight && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => scroll('right')}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 bg-surface-800/90 backdrop-blur rounded-full flex items-center justify-center text-surface-300 hover:text-white hover:bg-surface-700 transition-colors md:hidden shadow-lg"
            >
              <ChevronRight className="w-4 h-4" />
            </motion.button>
          )}
        </AnimatePresence>

        {/* Scrollable heatmap */}
        <div
          ref={scrollRef}
          className="flex gap-1 overflow-x-auto pb-2 scrollbar-hide scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1 flex-shrink-0">
              {week.map((day, di) => (
                <motion.button
                  key={di}
                  className={`w-4 h-4 md:w-3.5 md:h-3.5 rounded-sm ${intensityColors[day.intensity]} transition-all cursor-pointer relative touch-manipulation ${
                    selectedDay === day ? 'ring-2 ring-white ring-offset-1 ring-offset-surface-900' : ''
                  }`}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: wi * 0.015 + di * 0.008 }}
                  onMouseEnter={() => setHoveredDay(day)}
                  onMouseLeave={() => setHoveredDay(null)}
                  onClick={() => setSelectedDay(selectedDay === day ? null : day)}
                  whileHover={{ scale: 1.3 }}
                  whileTap={{ scale: 0.9 }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Day info & Legend - stacked on mobile */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <AnimatePresence mode="wait">
          {displayDay ? (
            <motion.div
              key="day-info"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="text-xs text-surface-300 bg-surface-800/50 px-3 py-1.5 rounded-lg"
            >
              <span className="font-medium text-white">{displayDay.date}</span>
              <span className="mx-2 text-surface-600">•</span>
              <span className={displayDay.problems > 0 ? 'text-emerald-400' : 'text-surface-500'}>
                {displayDay.problems} {displayDay.problems === 1 ? 'problem' : 'problems'}
              </span>
            </motion.div>
          ) : (
            <motion.div
              key="tap-hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-xs text-surface-500 md:hidden"
            >
              Tap a day to see details
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex items-center gap-1.5 text-xs text-surface-500">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className={`w-3 h-3 rounded-sm ${intensityColors[i].split(' ')[0]}`} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
});

// Enhanced Stat Card with animations - Mobile optimized
const StatCard = memo(function StatCard({ icon: Icon, label, value, subValue, color = 'primary', delay = 0, trend, highlight }) {
  const colorClasses = {
    primary: 'from-primary-500 to-primary-600',
    secondary: 'from-secondary-500 to-secondary-600',
    success: 'from-green-500 to-emerald-600',
    warning: 'from-yellow-500 to-orange-500',
    danger: 'from-red-500 to-rose-600'
  };
  const colorStyles = {
    primary: { bg: '#14b8a6', gradient: 'linear-gradient(135deg, #14b8a6, #0d9488)' },
    secondary: { bg: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)' },
    success: { bg: '#22c55e', gradient: 'linear-gradient(135deg, #22c55e, #059669)' },
    warning: { bg: '#eab308', gradient: 'linear-gradient(135deg, #eab308, #f97316)' },
    danger: { bg: '#ef4444', gradient: 'linear-gradient(135deg, #ef4444, #e11d48)' }
  };
  const colorStyle = colorStyles[color] || colorStyles.primary;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, type: 'spring', stiffness: 200 }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      whileTap={{ scale: 0.98 }}
      className={`relative bg-surface-800/60 backdrop-blur-sm border border-surface-700/50 rounded-xl p-3 md:p-5 hover:border-surface-600 active:border-surface-500 transition-all overflow-hidden touch-manipulation ${
        highlight ? 'ring-2 ring-primary-500/50' : ''
      }`}
    >
      {/* Background gradient on hover */}
      <motion.div
        className={`absolute inset-0 bg-gradient-to-br ${colorClasses[color] || colorClasses.primary} opacity-0`}
        style={{ backgroundImage: colorStyle.gradient }}
        whileHover={{ opacity: 0.05 }}
      />

      <div className="relative z-10">
        <div className="flex items-start justify-between mb-2 md:mb-3">
          <motion.div
            className={`dashboard-stat-icon p-2 md:p-2.5 rounded-lg md:rounded-xl bg-gradient-to-br ${colorClasses[color] || colorClasses.primary}`}
            style={{
              '--dashboard-stat-bg': colorStyle.bg,
              '--dashboard-stat-gradient': colorStyle.gradient,
              backgroundColor: colorStyle.bg,
              backgroundImage: colorStyle.gradient,
              forcedColorAdjust: 'none'
            }}
            whileHover={{ scale: 1.1, rotate: 5 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 400 }}
          >
            <Icon className="w-4 md:w-5 h-4 md:h-5 text-white" />
          </motion.div>
          {trend !== undefined && trend !== 0 && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className={`flex items-center gap-0.5 text-[10px] md:text-xs font-medium ${
                trend > 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {trend > 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
              {Math.abs(trend)}
            </motion.div>
          )}
        </div>
        <div className="text-2xl md:text-3xl font-bold text-white mb-0.5 md:mb-1">
          {typeof value === 'number' ? <CountUp end={value} duration={1.5} /> : value}
        </div>
        <div className="text-xs md:text-sm text-surface-400">{label}</div>
        {subValue && (
          <motion.div
            className="text-[10px] md:text-xs text-surface-500 mt-0.5 md:mt-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: delay + 0.3 }}
          >
            {subValue}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
});

// Quick Play Card - Featured game mode
const QuickPlayCard = memo(function QuickPlayCard({
  icon: Icon,
  title,
  description,
  onClick,
  color = 'primary',
  featured = false,
  recommended = false,
  badge,
  delay = 0
}) {
  const iconColors = {
    primary: 'text-primary-400',
    green: 'text-green-400',
    cyan: 'text-cyan-400',
    purple: 'text-purple-400',
    amber: 'text-amber-400',
    rose: 'text-rose-400'
  };

  const iconColor = iconColors[color] || iconColors.primary;

  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.2 }}
      whileHover={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
      whileTap={{ scale: 0.98 }}
      className={`relative snap-start shrink-0 w-[80%] sm:w-auto sm:flex-1 p-4 rounded-xl text-left border transition-colors ${
        recommended
          ? 'border-primary-500/40 bg-primary-500/[0.06] shadow-[0_0_12px_-4px_rgba(99,179,175,0.25)]'
          : 'border-surface-700/50 bg-surface-800/40 hover:bg-surface-800 active:bg-surface-700'
      }`}
    >
      {recommended && (
        <span className="absolute -top-2 left-3 px-1.5 py-0.5 bg-primary-500/20 text-primary-300 text-[9px] font-semibold uppercase tracking-wider rounded-full border border-primary-500/30">
          Recommended
        </span>
      )}
      <div className="flex items-center gap-3 mb-1.5">
        <Icon className={`w-5 h-5 ${iconColor}`} />
        <h3 className="text-sm font-medium text-white">{title}</h3>
        {badge && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700/50 text-surface-400">
            {badge}
          </span>
        )}
      </div>
      <p className="text-xs text-surface-500 pl-8">{description}</p>
    </motion.button>
  );
});

// Quick Play Section - Prominent game modes at top
// Get personalized recommendation based on user stats
function getPersonalizedRecommendation(stats, lastBattleTime) {
  const totalGames = (stats?.wins || 0) + (stats?.losses || 0);
  const winRate = stats?.winRate || 0;
  const rating = stats?.rating || 1000;
  const currentStreak = stats?.currentStreak || 0;

  // New user recommendations
  if (totalGames === 0) {
    return { text: "New here? Start with Practice vs Bot to warm up!", highlight: 'bot-battle' };
  }
  if (totalGames < 5) {
    return { text: "Getting started! Try a few more bot matches before ranked.", highlight: 'bot-battle' };
  }

  // Streak-based recommendations
  if (currentStreak >= 3) {
    return { text: `🔥 ${currentStreak} win streak! Keep the momentum in Quick Match!`, highlight: 'quick-match' };
  }
  if (currentStreak <= -3) {
    return { text: "Rough patch? Practice mode can help you refocus.", highlight: 'practice' };
  }

  // Performance-based recommendations
  if (winRate < 40 && totalGames >= 10) {
    return { text: "Pro tip: Bot battles help improve without ELO pressure.", highlight: 'bot-battle' };
  }
  if (winRate >= 60) {
    return { text: "You're crushing it! Ready for ranked matches.", highlight: 'quick-match' };
  }

  // Time-based recommendations
  if (lastBattleTime) {
    return { text: `Last battle: ${lastBattleTime}. Ready for another?`, highlight: null };
  }

  return { text: "Quick Match uses ELO matchmaking for fair opponents.", highlight: null };
}

// Check for last practice session in localStorage
function useLastPracticeSession() {
  const [lastSession, setLastSession] = useState(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('lastPracticeSession');
      if (stored) {
        const session = JSON.parse(stored);
        // Only show if less than 7 days old
        const daysSince = (Date.now() - session.timestamp) / (1000 * 60 * 60 * 24);
        if (daysSince < 7) {
          setLastSession(session);
        }
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }, []);

  return lastSession;
}

const QuickPlaySection = memo(function QuickPlaySection({ router, lastBattleTime, stats }) {
  const lastPracticeSession = useLastPracticeSession();
  const recommendation = useMemo(
    () => getPersonalizedRecommendation(stats, lastBattleTime),
    [stats, lastBattleTime]
  );

  const gameModes = [
    {
      id: 'practice',
      title: 'Solo Practice',
      description: lastPracticeSession?.problemName
        ? `Continue: ${lastPracticeSession.problemName}`
        : 'Build skill, no pressure',
      icon: Target,
      color: 'cyan',
      route: lastPracticeSession?.problemSlug
        ? `/practice?problem=${lastPracticeSession.problemSlug}`
        : '/practice',
      featured: true,
      badge: lastPracticeSession ? 'Resume' : null
    },
    {
      id: 'quick-match',
      title: 'Quick Match',
      description: 'Find an opponent instantly',
      icon: Swords,
      color: 'green',
      route: '/matchmaking'
    }
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 md:mb-8"
    >
      {/* Section Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <motion.div
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
          >
            <Zap className="w-5 h-5 text-yellow-400" />
          </motion.div>
          <h2 className="text-lg md:text-xl font-bold text-white">Quick Play</h2>
        </div>
        <Link
          href="/modes"
          className="text-xs md:text-sm text-surface-400 hover:text-primary-400 transition-colors flex items-center gap-1"
        >
          All modes <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Game Mode Cards */}
      <div className="flex gap-3 md:gap-4 overflow-x-auto overflow-y-visible pt-3 pb-2 scrollbar-hide snap-x snap-mandatory -mx-1 px-1">
        {gameModes.map((mode, index) => (
          <QuickPlayCard
            key={mode.id}
            icon={mode.icon}
            title={mode.title}
            description={mode.description}
            color={mode.color}
            onClick={() => router.push(mode.route)}
            featured={mode.featured}
            recommended={mode.recommended}
            badge={mode.badge}
            delay={index * 0.05}
          />
        ))}
      </div>

      {/* Personalized tip / recommendation */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2 text-xs text-surface-500">
          <Sparkles className="w-3.5 h-3.5 text-yellow-500/70 flex-shrink-0" />
          <span>{recommendation.text}</span>
        </div>
      </motion.div>
    </motion.div>
  );
});

// Quick Action Button - Mobile optimized
const QuickActionButton = memo(function QuickActionButton({ icon: Icon, label, onClick, variant = 'primary', pulse }) {
  const variants = {
    primary: 'bg-gradient-to-r from-primary-500 to-secondary-500 hover:from-primary-400 hover:to-secondary-400 active:from-primary-600 active:to-secondary-600 text-white shadow-lg shadow-primary-500/20',
    secondary: 'bg-surface-800 hover:bg-surface-700 active:bg-surface-600 text-white border border-surface-700',
    ghost: 'bg-transparent hover:bg-surface-800 active:bg-surface-700 text-surface-300 hover:text-white'
  };

  return (
    <motion.button
      onClick={onClick}
      className={`relative flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-2.5 md:py-3 rounded-xl font-medium transition-all flex-shrink-0 touch-manipulation ${variants[variant]}`}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.95 }}
    >
      {pulse && (
        <motion.div
          className="absolute inset-0 rounded-xl bg-primary-500"
          animate={{ opacity: [0.5, 0, 0.5], scale: [1, 1.1, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}
      <Icon className="w-4 md:w-5 h-4 md:h-5 relative z-10" />
      <span className="relative z-10 text-sm md:text-base whitespace-nowrap">{label}</span>
    </motion.button>
  );
});

// Section-specific skeleton components
const HeroSkeleton = memo(function HeroSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-surface-800/60 rounded-2xl p-6 md:p-8"
    >
      <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
        <div className="flex items-center gap-4 md:gap-6">
          <Skeleton className="w-20 h-20 md:w-24 md:h-24 rounded-2xl" />
          <div className="space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-12 w-24" />
          </div>
        </div>
        <div className="flex gap-3 ml-auto">
          <Skeleton className="h-12 w-32 rounded-xl" />
          <Skeleton className="h-12 w-28 rounded-xl hidden sm:block" />
        </div>
      </div>
      <div className="mt-6 pt-6 border-t border-surface-700/50">
        <Skeleton className="h-3 w-full rounded-full" />
      </div>
    </motion.div>
  );
});

const StatsSkeleton = memo(function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
      {[1, 2, 3, 4].map(i => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08 }}
          className="bg-surface-800/60 rounded-xl p-4 md:p-5"
        >
          <div className="flex items-start justify-between mb-3">
            <Skeleton className="w-10 h-10 rounded-xl" />
          </div>
          <Skeleton className="h-8 w-16 mb-2" />
          <Skeleton className="h-4 w-20" />
        </motion.div>
      ))}
    </div>
  );
});

const ChartSkeleton = memo(function ChartSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="bg-surface-800/60 rounded-xl p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="h-44 flex items-end gap-2">
        {[...Array(12)].map((_, i) => (
          <motion.div
            key={i}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ delay: i * 0.05 }}
            className="flex-1 bg-surface-700/50 rounded-t"
            style={{ height: `${30 + Math.random() * 60}%`, transformOrigin: 'bottom' }}
          />
        ))}
      </div>
    </motion.div>
  );
});

const BattlesSkeleton = memo(function BattlesSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="bg-surface-800/60 rounded-xl p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-16" />
      </div>
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map(i => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08 }}
            className="flex items-center justify-between p-3 bg-surface-800/40 rounded-xl"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="w-10 h-10 rounded-xl" />
              <div>
                <Skeleton className="h-4 w-16 mb-1" />
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
            <Skeleton className="h-6 w-12 rounded-lg" />
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
});

// Dashboard Skeleton with shimmer
function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-surface-950 text-white">
      <FloatingOrbs />

      {/* Header skeleton */}
      <header className="relative z-20 px-4 md:px-6 py-4 border-b border-surface-800/50 bg-surface-950/80">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-4">
          <Skeleton className="h-8 w-32" />
          <div className="hidden lg:flex items-center gap-6">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="w-10 h-10 rounded-full" />
        </div>
      </header>

      <div className="relative z-10 px-4 md:px-6 py-6 md:py-8 max-w-7xl mx-auto">
        {/* Hero skeleton */}
        <div className="mb-6 md:mb-8">
          <HeroSkeleton />
        </div>

        {/* Stats skeleton */}
        <div className="mb-6 md:mb-8">
          <StatsSkeleton />
        </div>

        {/* Content grid skeleton */}
        <div className="grid lg:grid-cols-3 gap-4 md:gap-6">
          <div className="lg:col-span-2 space-y-4 md:space-y-6">
            <ChartSkeleton />
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="bg-surface-800/60 rounded-xl p-6"
            >
              <Skeleton className="h-6 w-40 mb-4" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </motion.div>
          </div>
          <div className="space-y-4 md:space-y-6">
            <BattlesSkeleton />
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="bg-surface-800/60 rounded-xl p-6"
            >
              <Skeleton className="h-6 w-24 mb-4" />
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const { user, token, loading: authLoading, logout } = useAuth();
  const { unreadCount } = useMessaging();
  const { pendingCount } = useFriends();
  // Restore cached dashboard data instantly on navigation
  const [dashboardData, setDashboardData] = useState(() => {
    if (typeof window === 'undefined') return null;
    try {
      const cached = sessionStorage.getItem('dashboard_cache');
      if (cached) {
        const { data, ts } = JSON.parse(cached);
        if (Date.now() - ts < 60000) return data; // Use cache if < 60s old
      }
    } catch { /* ignore */ }
    return null;
  });
  const [badges, setBadges] = useState(() => {
    if (typeof window === 'undefined') return [];
    try {
      const cached = sessionStorage.getItem('dashboard_badges_cache');
      if (cached) {
        const { data, ts } = JSON.parse(cached);
        if (Date.now() - ts < 60000) return data;
      }
    } catch { /* ignore */ }
    return [];
  });
  const [loading, setLoading] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      const cached = sessionStorage.getItem('dashboard_cache');
      if (cached) {
        const { ts } = JSON.parse(cached);
        if (Date.now() - ts < 60000) return false; // Skip loading if cache is fresh
      }
    } catch { /* ignore */ }
    return true;
  });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshRipple, setRefreshRipple] = useState(0);
  const [error, setError] = useState(null);
  const [rateLimitCooldown, setRateLimitCooldown] = useState(0);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Celebration states
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationMessage, setCelebrationMessage] = useState('');
  const [celebrationEmoji, setCelebrationEmoji] = useState('');
  const previousRankRef = useRef(null);

  const fetchDashboardData = useCallback(async (isRefresh = false) => {
    try {
      if (!token) {
        // No token yet: let AuthContext handle the redirect once it finishes
        // verifying. Pushing here while auth state is still "logged in" would
        // bounce off login's auto-redirect and create a refresh loop.
        return;
      }

      if (isRefresh) {
        setRefreshing(true);
        setError(null);
      }

      const [progressRes, badgesRes] = await Promise.all([
        withRetry(async () => {
          const response = await fetchWithTimeout(`${API}/api/analytics/progress`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (response.status === 401) {
            // Dispatch to AuthContext so it clears state + redirects with ?expired=1.
            // A bare router.push here leaves the auth state intact, and login auto-
            // redirects back to /dashboard, producing a loop that trips the rate limiter.
            window.dispatchEvent(new CustomEvent(AUTH_ERROR_EVENT, {
              detail: { message: 'Session expired. Please log in again.' }
            }));
            throw new Error('AUTH_REDIRECT');
          }
          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw createDashboardFetchError(response, errData.error || 'Failed to fetch dashboard data');
          }
          return response;
        }),
        fetchWithTimeout(`${API}/api/badges/me`, {
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => null)
      ]);

      const progressData = await progressRes.json();
      setDashboardData(progressData.progress);
      try { sessionStorage.setItem('dashboard_cache', JSON.stringify({ data: progressData.progress, ts: Date.now() })); } catch { /* ignore */ }

      if (badgesRes?.ok) {
        const badgesData = await badgesRes.json();
        setBadges(badgesData.badges || []);
        try { sessionStorage.setItem('dashboard_badges_cache', JSON.stringify({ data: badgesData.badges || [], ts: Date.now() })); } catch { /* ignore */ }
      }

      // Check for rank up
      const currentRating = progressData.progress?.stats?.rating || 1000;
      const currentRankIndex = getRankIndex(currentRating);
      const storedRankIndex = parseInt(sessionStorage.getItem('lastRankIndex') || '-1', 10);

      if (storedRankIndex >= 0 && currentRankIndex > storedRankIndex) {
        // User ranked up!
        const newRank = RANK_TIERS[currentRankIndex];
        setCelebrationMessage(`Promoted to ${newRank.name}!`);
        setCelebrationEmoji(newRank.emoji);
        setShowCelebration(true);
        setTimeout(() => setShowCelebration(false), 4000);
      }
      sessionStorage.setItem('lastRankIndex', currentRankIndex.toString());

      // Check for personal best (highest rating ever)
      const previousBestRating = parseInt(localStorage.getItem('personalBestRating') || '0', 10);
      if (currentRating > previousBestRating && previousBestRating > 0) {
        localStorage.setItem('personalBestRating', currentRating.toString());
        // Could trigger a subtle "New Personal Best" indicator
      } else if (previousBestRating === 0) {
        localStorage.setItem('personalBestRating', currentRating.toString());
      }

      // Show welcome animation for first visit
      const hasVisited = sessionStorage.getItem('dashboard_visited');
      if (!hasVisited) {
        setShowWelcome(true);
        sessionStorage.setItem('dashboard_visited', 'true');
        setTimeout(() => setShowWelcome(false), 3000);
      }

      setError(null);
    } catch (err) {
      if (err.message !== 'AUTH_REDIRECT') {
        // Check if it's a rate limit error
        if (err.message?.toLowerCase().includes('too many requests') || err.message?.toLowerCase().includes('rate limit')) {
          setRateLimitCooldown(30); // 30 second cooldown
        }
        setError(err.message);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirect=/dashboard');
      return;
    }

    if (user && token) {
      fetchDashboardData();
    }
  }, [user, token, authLoading, fetchDashboardData, router]);

  // Rate limit cooldown countdown
  useEffect(() => {
    if (rateLimitCooldown > 0) {
      const timer = setTimeout(() => {
        setRateLimitCooldown(prev => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [rateLimitCooldown]);

  const handleRefresh = () => {
    if (rateLimitCooldown > 0) return; // Don't allow refresh during cooldown
    setRefreshRipple(prev => prev + 1);
    if (!refreshing) {
      fetchDashboardData(true);
    }
  };

  // Computed values
  const stats = useMemo(() => dashboardData?.stats || {}, [dashboardData]);
  const rankTier = useMemo(() => getRankTier(stats.rating || 1000), [stats.rating]);
  const nextRank = useMemo(() => getNextRankTier(stats.rating || 1000), [stats.rating]);
  const motivationalMessage = useMemo(() => getMotivationalMessage(stats), [stats]);

  const progressToNextRank = useMemo(() => {
    if (!nextRank) return 100;
    return Math.min(100, ((stats.rating - rankTier.min) / (rankTier.max - rankTier.min + 1)) * 100);
  }, [stats.rating, rankTier, nextRank]);

  const recentActivity = useMemo(() => dashboardData?.recentActivity || [], [dashboardData]);
  const promptScoreHistory = useMemo(() => dashboardData?.promptScoreHistory || {}, [dashboardData]);

  const lastBattleTime = useMemo(() => {
    const history = dashboardData?.ratingHistory;
    if (history?.length > 0) {
      return getTimeSince(history[0].date);
    }
    return null;
  }, [dashboardData]);

  if (authLoading || loading) {
    return <DashboardSkeleton />;
  }

  if (error && !dashboardData) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <FloatingOrbs />
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <Card className="p-8 text-center max-w-md relative z-10">
            <motion.div
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ duration: 0.5 }}
            >
              <AlertCircle className="w-14 h-14 text-red-400 mx-auto mb-4" />
            </motion.div>
            <h2 className="text-xl font-bold text-white mb-2">Failed to Load Dashboard</h2>
            <p className="text-surface-400 mb-6">
              {rateLimitCooldown > 0
                ? `Too many requests. Please wait ${rateLimitCooldown}s before trying again.`
                : error}
            </p>
            <div className="flex gap-3 justify-center">
              <Button variant="ghost" onClick={() => router.push('/modes')}>Go to Modes</Button>
              <Button
                onClick={handleRefresh}
                loading={refreshing}
                disabled={rateLimitCooldown > 0}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                {rateLimitCooldown > 0 ? `Wait ${rateLimitCooldown}s` : 'Try Again'}
              </Button>
            </div>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Dashboard - CodeArena</title>
        <meta name="description" content="Your CodeArena dashboard - track your progress, stats, and battles" />
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">
        <FloatingOrbs />

        {/* Celebration overlay */}
        <AnimatePresence>
          {showCelebration && (
            <ConfettiCelebration
              show={showCelebration}
              message={celebrationMessage}
              emoji={celebrationEmoji}
            />
          )}
        </AnimatePresence>

        {/* Epic Welcome Screen - 10/10 Edition */}
        <AnimatePresence>
          {showWelcome && (
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950 cursor-pointer select-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              onClick={() => setShowWelcome(false)}
            >
              {/* Animated background particles - doubled for epic effect */}
              <div className="absolute inset-0 overflow-hidden">
                {[...Array(40)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="absolute rounded-full"
                    style={{
                      width: Math.random() * 6 + 2,
                      height: Math.random() * 6 + 2,
                      left: `${Math.random() * 100}%`,
                      top: `${Math.random() * 100}%`,
                      background: rankTier.glowColor,
                    }}
                    animate={{
                      y: [0, -60, 0],
                      x: [0, (Math.random() - 0.5) * 40, 0],
                      opacity: [0.1, 0.8, 0.1],
                      scale: [1, 2, 1],
                    }}
                    transition={{
                      duration: 3 + Math.random() * 3,
                      repeat: Infinity,
                      delay: Math.random() * 2,
                    }}
                  />
                ))}
              </div>

              {/* Radial light rays */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
                {[...Array(12)].map((_, i) => (
                  <motion.div
                    key={`ray-${i}`}
                    className="absolute h-0.5 origin-left"
                    style={{
                      width: '60vw',
                      background: `linear-gradient(90deg, ${rankTier.glowColor} 0%, transparent 100%)`,
                      transform: `rotate(${i * 30}deg)`,
                    }}
                    initial={{ scaleX: 0, opacity: 0 }}
                    animate={{ scaleX: 1, opacity: [0, 0.2, 0.05] }}
                    transition={{ duration: 1.2, delay: 0.2 }}
                  />
                ))}
              </div>

              {/* Center glow effect - larger and more dramatic */}
              <motion.div
                className="absolute w-[600px] h-[600px] rounded-full blur-3xl"
                style={{ background: `radial-gradient(circle, ${rankTier.glowColor} 0%, transparent 60%)` }}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: [0, 1.5, 1.2], opacity: [0, 0.6, 0.35] }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />

              {/* Main content with screen shake on entry */}
              <motion.div
                className="relative z-10 text-center px-4"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{
                  scale: 1,
                  opacity: 1,
                  x: [0, -4, 4, -3, 3, 0],
                }}
                transition={{
                  scale: { duration: 0.4, ease: 'easeOut' },
                  opacity: { duration: 0.3 },
                  x: { duration: 0.5, delay: 0.3 }
                }}
              >
                {/* Avatar with glow ring */}
                <motion.div
                  className="mb-4"
                  initial={{ scale: 0, y: -40 }}
                  animate={{ scale: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 300, delay: 0.1 }}
                >
                  <div className="relative inline-block">
                    <motion.div
                      className="absolute inset-0 rounded-full"
                      style={{ boxShadow: `0 0 40px ${rankTier.glowColor}` }}
                      animate={{ opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                    <div className={`w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden border-4 mx-auto relative`}
                      style={{ borderColor: rankTier.glowColor }}
                    >
                      <AvatarDisplay
                        avatar={user?.avatar}
                        username={user?.username}
                        size={96}
                        className="w-full h-full"
                      />
                    </div>
                    {/* Streak fire badge */}
                    {(stats.currentStreak || 0) >= 3 && (
                      <motion.div
                        className="absolute -bottom-1 -right-1 bg-gradient-to-r from-orange-500 to-red-500 rounded-full px-2 py-1 text-xs font-bold text-white flex items-center gap-1 shadow-lg"
                        initial={{ scale: 0, rotate: -20 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: 'spring', delay: 0.5 }}
                      >
                        <Flame className="w-3 h-3" />
                        {stats.currentStreak}
                      </motion.div>
                    )}
                  </div>
                </motion.div>

                {/* Rank badge - epic entrance with impact ring */}
                <motion.div
                  className="relative mb-6"
                  initial={{ scale: 0, y: 80, rotate: -15 }}
                  animate={{ scale: 1, y: 0, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 180, damping: 12, delay: 0.2 }}
                >
                  {/* Impact ring explosion */}
                  <motion.div
                    className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: [0.5, 3], opacity: [1, 0] }}
                    transition={{ duration: 0.7, delay: 0.4, ease: 'easeOut' }}
                  >
                    <div
                      className="w-32 h-32 md:w-40 md:h-40 rounded-3xl border-4"
                      style={{ borderColor: rankTier.glowColor }}
                    />
                  </motion.div>

                  <motion.div
                    className={`w-32 h-32 md:w-40 md:h-40 mx-auto rounded-3xl bg-gradient-to-br ${rankTier.color} flex items-center justify-center shadow-2xl relative overflow-hidden`}
                    style={getRankSurfaceStyle(rankTier)}
                    animate={{
                      boxShadow: [
                        `0 0 30px ${rankTier.glowColor}`,
                        `0 0 80px ${rankTier.glowColor}`,
                        `0 0 30px ${rankTier.glowColor}`,
                      ],
                    }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    {/* Shine sweep effect */}
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-12"
                      initial={{ x: '-150%' }}
                      animate={{ x: '150%' }}
                      transition={{ duration: 0.8, delay: 0.6 }}
                    />
                    <motion.span
                      className="text-6xl md:text-7xl relative z-10"
                      animate={{ scale: [1, 1.1, 1] }}
                      transition={{ duration: 0.3, delay: 0.5 }}
                    >
                      {rankTier.emoji}
                    </motion.span>
                  </motion.div>

                  {/* Rank name badge */}
                  <motion.div
                    className={`absolute -bottom-3 left-1/2 transform -translate-x-1/2 px-5 py-1.5 rounded-full bg-surface-900/90 backdrop-blur border border-surface-600 ${rankTier.textColor} font-bold text-sm uppercase tracking-widest`}
                    initial={{ opacity: 0, y: 15, scale: 0.7 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: 0.6, type: 'spring' }}
                  >
                    {rankTier.name}
                  </motion.div>
                </motion.div>

                {/* Welcome text */}
                <motion.div
                  initial={{ opacity: 0, y: 25 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                >
                  <h1 className="text-2xl md:text-4xl font-bold mb-2 text-white">
                    Welcome back, <span className={`dashboard-gradient-text bg-gradient-to-r ${rankTier.color} bg-clip-text text-transparent`} style={getRankTextStyle(rankTier)}>{user?.username || 'Champion'}</span>
                  </h1>
                </motion.div>

                {/* ELO display with count-up */}
                <motion.div
                  className="mx-auto mb-5 flex w-fit flex-col items-start"
                  initial={{ opacity: 0, y: 25 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.65 }}
                >
                  <span className="text-surface-400 text-base md:text-lg font-medium leading-none">Elo</span>
                  <span className="-mt-1 dashboard-elo-value text-5xl md:text-6xl font-black leading-none" style={getRankTextStyle(rankTier)}>
                    <CountUp end={stats.rating || 1000} duration={1.5} />
                  </span>
                </motion.div>

                {/* Quick stats - staggered pop-in */}
                <motion.div
                  className="flex items-center justify-center gap-6 mb-6"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.8 }}
                >
                  <motion.div
                    className="text-center"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.85, type: 'spring', stiffness: 300 }}
                  >
                    <div className="text-2xl font-bold text-emerald-400">{stats.wins || 0}</div>
                    <div className="text-xs text-surface-500 uppercase tracking-wide">Wins</div>
                  </motion.div>
                  <div className="w-px h-8 bg-surface-700" />
                  <motion.div
                    className="text-center"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.95, type: 'spring', stiffness: 300 }}
                  >
                    <div className="text-2xl font-bold text-red-400">{stats.losses || 0}</div>
                    <div className="text-xs text-surface-500 uppercase tracking-wide">Losses</div>
                  </motion.div>
                  {(stats.wins || 0) + (stats.losses || 0) > 0 && (
                    <>
                      <div className="w-px h-8 bg-surface-700" />
                      <motion.div
                        className="text-center"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 1.05, type: 'spring', stiffness: 300 }}
                      >
                        <div className="text-2xl font-bold text-primary-400">
                          {Math.round(((stats.wins || 0) / ((stats.wins || 0) + (stats.losses || 0))) * 100)}%
                        </div>
                        <div className="text-xs text-surface-500 uppercase tracking-wide">Win Rate</div>
                      </motion.div>
                    </>
                  )}
                </motion.div>

                {/* Progress to next rank */}
                {nextRank && (
                  <motion.div
                    className="max-w-xs mx-auto"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.1 }}
                  >
                    <div className="flex justify-between text-xs text-surface-400 mb-1.5 font-medium">
                      <span>{rankTier.name}</span>
                      <span>{nextRank.name}</span>
                    </div>
                    <div className="h-3 bg-surface-800 rounded-full overflow-hidden border border-surface-700">
                      <motion.div
                        className={`h-full bg-gradient-to-r ${rankTier.color} relative`}
                        initial={{ width: 0 }}
                        animate={{ width: `${progressToNextRank}%` }}
                        transition={{ delay: 1.3, duration: 1, ease: 'easeOut' }}
                      >
                        {/* Progress bar shine */}
                        <motion.div
                          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent"
                          initial={{ x: '-100%' }}
                          animate={{ x: '200%' }}
                          transition={{ duration: 0.8, delay: 2 }}
                        />
                      </motion.div>
                    </div>
                    <motion.div
                      className="text-sm text-surface-400 mt-2 text-center"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 1.5 }}
                    >
                      <span className="text-white font-bold">{nextRank.min - (stats.rating || 1000)}</span> points to <span className={rankTier.textColor}>{nextRank.name}</span>
                    </motion.div>
                  </motion.div>
                )}

                {/* Ready text - epic finish */}
                <motion.div
                  className="mt-8"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1.7 }}
                >
                  <motion.p
                    className={`dashboard-gradient-text text-xl md:text-2xl font-bold bg-gradient-to-r ${rankTier.color} bg-clip-text text-transparent`}
                    style={getRankTextStyle(rankTier)}
                    animate={{ scale: [1, 1.03, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    Ready to dominate
                    <motion.span
                      className="text-white"
                      animate={{ opacity: [1, 0, 1] }}
                      transition={{ duration: 0.5, repeat: Infinity }}
                    >
                      _
                    </motion.span>
                  </motion.p>
                  <motion.p
                    className="text-surface-600 text-xs mt-3 uppercase tracking-widest"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 1, 0.7] }}
                    transition={{ delay: 2, duration: 1 }}
                  >
                    tap anywhere to continue
                  </motion.p>
                </motion.div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mobile Menu Overlay */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              className="fixed inset-0 z-40 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={() => setMobileMenuOpen(false)}
              />
              <motion.nav
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25 }}
                className="absolute right-0 top-0 bottom-0 w-72 max-w-[85vw] bg-surface-900 border-l border-surface-800 p-6 overflow-y-auto overscroll-contain"
              >
                <div className="flex items-center justify-between mb-6">
                  <span className="text-lg font-bold">Menu</span>
                  <button
                    onClick={() => setMobileMenuOpen(false)}
                    className="p-2 hover:bg-surface-800 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* User card + prominent Log out at the TOP of the drawer, so
                    signing out never requires scrolling past every nav link. */}
                {user && (
                  <div className="mb-6 pb-6 border-b border-surface-800 space-y-3">
                    <Link
                      href={user?.username ? `/profile/${user.username}` : '/profile'}
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-3"
                    >
                      <AvatarDisplay user={user} size="lg" rounded="xl" />
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate">{user?.username}</p>
                        <p className="text-xs text-surface-400 truncate">{user?.email}</p>
                      </div>
                    </Link>
                    <button
                      onClick={() => {
                        setMobileMenuOpen(false);
                        router.push('/');
                        logout();
                      }}
                      className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-red-400 bg-red-500/10 hover:bg-red-500/20 font-medium transition-colors"
                      aria-label="Log out"
                    >
                      <LogOut className="w-4 h-4" />
                      Log out
                    </button>
                  </div>
                )}

                <div className="space-y-2">
                  {[
                    { href: '/dashboard', icon: Activity, label: 'Dashboard', active: true },
                    { href: '/modes', icon: Play, label: 'Play' },
                    { href: '/matchmaking', icon: Swords, label: 'Find Match' },
                    { href: '/problems', icon: BookOpen, label: 'Problems' },
                    { href: '/players', icon: Trophy, label: 'Leaderboard' },
                    { href: '/messages', icon: MessageSquare, label: 'Messages', badge: unreadCount },
                    { href: '/friends', icon: Heart, label: 'Friends', badge: pendingCount },
                    { href: '/create', icon: Wand2, label: 'Game Creator' },
                    { href: '/gallery', icon: Gamepad2, label: 'Game Gallery' },
                  ].map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                        item.active
                          ? 'bg-primary-500/20 text-primary-400'
                          : 'text-surface-300 hover:bg-surface-800 hover:text-white'
                      }`}
                    >
                      <item.icon className="w-5 h-5" />
                      {item.label}
                      {item.badge > 0 && (
                        <span className="ml-auto bg-primary-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-bold">
                          {item.badge > 9 ? '9+' : item.badge}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>

                {/* Quick action in mobile menu */}
                <div className="mt-8 pt-8 border-t border-surface-800">
                  <Button
                    variant="primary"
                    fullWidth
                    onClick={() => {
                      setMobileMenuOpen(false);
                      router.push('/matchmaking');
                    }}
                    className="justify-center"
                  >
                    <Swords className="w-5 h-5 mr-2" />
                    Find Match
                  </Button>
                </div>
              </motion.nav>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header */}
        <header className="relative z-20 px-4 md:px-5 xl:px-6 py-4 border-b border-surface-800/50 bg-surface-950/80 backdrop-blur-md sticky top-0">
          <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-5 xl:gap-7 min-w-0">
              <Link href="/dashboard" className="flex items-center gap-2 flex-shrink-0">
                <Logo size="sm" />
              </Link>
              <nav className="hidden lg:flex items-center justify-start gap-4 xl:gap-6 2xl:gap-8 min-w-0 text-sm">
                <Link href="/dashboard" className="text-white font-medium flex items-center gap-1.5 whitespace-nowrap">
                  <Activity className="w-4 h-4" />
                  Dashboard
                </Link>
                <Link href="/modes" className="text-surface-400 hover:text-white transition-colors flex items-center gap-1.5 whitespace-nowrap">
                  <Play className="w-4 h-4" />
                  Play
                </Link>
                <Link href="/problems" className="text-surface-400 hover:text-white transition-colors flex items-center gap-1.5 whitespace-nowrap">
                  <BookOpen className="w-4 h-4" />
                  Problems
                </Link>
                <Link href="/players" className="text-surface-400 hover:text-white transition-colors flex items-center gap-1.5 whitespace-nowrap">
                  <Trophy className="w-4 h-4" />
                  Leaderboard
                </Link>
                <Link href="/create" className="text-surface-400 hover:text-white transition-colors flex items-center gap-1.5 whitespace-nowrap">
                  <Wand2 className="w-4 h-4" />
                  Create
                </Link>
                <Link href="/gallery" className="text-surface-400 hover:text-white transition-colors flex items-center gap-1.5 whitespace-nowrap">
                  <Gamepad2 className="w-4 h-4" />
                  Gallery
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-3 xl:gap-4 flex-1 min-w-0">
              {/* Search & Notifications */}
              <div className="hidden xl:flex items-center gap-3 2xl:gap-4 flex-1 ml-3">
                <div className="flex-1 max-w-sm">
                  <SearchBar inputClassName="w-full" />
                </div>
                <NotificationBell />
              </div>
              {/* Messages & Friends - desktop only */}
              <div className="hidden lg:flex items-center gap-2 xl:gap-3">
                <Link
                  href="/messages"
                  className="relative flex items-center px-2.5 xl:px-3 py-2 rounded-lg text-surface-300 hover:text-white hover:bg-surface-800/60 transition-all duration-200"
                  aria-label={`Messages${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
                >
                  <MessageSquare className="h-4 w-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-error text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-bold">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </Link>
                <Link
                  href="/friends"
                  className="relative flex items-center px-2.5 xl:px-3 py-2 rounded-lg text-surface-300 hover:text-white hover:bg-surface-800/60 transition-all duration-200"
                  aria-label={`Friends${pendingCount > 0 ? ` (${pendingCount} pending)` : ''}`}
                >
                  <Users className="h-4 w-4" />
                  {pendingCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-primary-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-bold">
                      {pendingCount > 9 ? '9+' : pendingCount}
                    </span>
                  )}
                </Link>
              </div>

              <motion.button
                onClick={handleRefresh}
                disabled={refreshing}
                className="relative p-2 md:p-2.5 text-surface-400 hover:text-white hover:bg-surface-800 rounded-xl transition-colors disabled:opacity-50 overflow-hidden"
                title="Refresh data"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {/* Ripple effect on press */}
                <AnimatePresence>
                  {refreshRipple > 0 && (
                    <motion.span
                      key={refreshRipple}
                      className="absolute inset-0 rounded-xl border-2 border-primary-400"
                      initial={{ scale: 0.5, opacity: 1 }}
                      animate={{ scale: 1.8, opacity: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  )}
                </AnimatePresence>
                <RefreshCw className={`relative z-10 w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
              </motion.button>

              {/* Mobile menu button */}
              <motion.button
                onClick={() => setMobileMenuOpen(true)}
                className="p-2 text-surface-400 hover:text-white hover:bg-surface-800 rounded-xl transition-colors lg:hidden"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Menu className="w-5 h-5" />
              </motion.button>

              <div className="hidden md:block">
                <ProfileDropdown
                  isOpen={profileDropdownOpen}
                  onToggle={() => setProfileDropdownOpen(!profileDropdownOpen)}
                  onClose={() => setProfileDropdownOpen(false)}
                />
              </div>
            </div>
          </div>
        </header>

        <main className="relative z-10 px-4 md:px-6 pt-6 pb-24 md:py-8 max-w-7xl mx-auto">
          {/* Quick Play Section - Primary CTA */}
          <QuickPlaySection router={router} lastBattleTime={lastBattleTime} stats={stats} />

          {/* Hero Section - Mobile optimized */}
          <FadeIn className="mb-6 md:mb-8">
            <TiltCard tiltAmount={3} glareEnabled={false}>
              <Card className="p-5 md:p-8 bg-gradient-to-br from-surface-800/90 via-surface-850/90 to-surface-900/90 border-surface-700/50 overflow-hidden relative">
                {/* Animated background elements */}
                <div className="absolute top-0 right-0 w-48 md:w-96 h-48 md:h-96 bg-gradient-to-br from-primary-500/10 via-secondary-500/5 to-transparent rounded-full blur-3xl" />
                <div className="absolute bottom-0 left-0 w-32 md:w-64 h-32 md:h-64 bg-gradient-to-tr from-secondary-500/10 to-transparent rounded-full blur-3xl" />

                <div className="relative z-10">
                  {/* Recent Activity: top right corner */}
                  <motion.div
                    className="hidden lg:block absolute top-0 right-0 left-[400px]"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                  >
                    <div className="bg-surface-700/40 border border-surface-600/30 rounded-lg px-4 py-3.5 max-h-[200px] flex flex-col">
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <Activity className="w-3.5 h-3.5 text-surface-400" />
                        <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">Recent Activity</span>
                      </div>
                      <div className="space-y-1.5 overflow-y-auto flex-1 min-h-0 scrollbar-thin">
                        {recentActivity.length > 0 ? (
                          recentActivity.map((activity, i) => {
                            const config = ACTIVITY_TYPE_CONFIG[activity.type] || ACTIVITY_TYPE_CONFIG.solo_practice;
                            const IconComponent = {
                              Swords, Bot, Code, MessageSquare, Gamepad2, Zap
                            }[config.icon] || Activity;
                            const promptScores = activity.type === 'prompt_practice' && activity.metadata?.challenge_id
                              ? promptScoreHistory[activity.metadata.challenge_id]
                              : null;
                            return (
                              <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
                                <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${config.bgColor}`}>
                                  <IconComponent className={`w-3 h-3 ${config.color}`} />
                                </div>
                                <span className="text-surface-300 truncate flex-1 min-w-0">{activity.title}</span>
                                {promptScores && <MiniSparkline scores={promptScores} color="#f59e0b" />}
                                {activity.result && !promptScores && (
                                  <span className={`font-medium flex-shrink-0 ${
                                    activity.result === 'win' || activity.result === 'solved' ? 'text-green-400' :
                                    activity.result === 'loss' ? 'text-red-400' :
                                    activity.result === 'draw' ? 'text-surface-400' : 'text-surface-400'
                                  }`}>
                                    {activity.result === 'win' ? 'W' : activity.result === 'loss' ? 'L' :
                                     activity.result === 'draw' ? 'D' : activity.result === 'solved' ? '✓' : '-'}
                                  </span>
                                )}
                                {activity.score != null && (
                                  <span className="text-amber-400 font-medium flex-shrink-0">{activity.score}%</span>
                                )}
                                <span className="text-surface-500 flex-shrink-0 ml-1">{formatRelativeTime(activity.timestamp)}</span>
                              </div>
                            );
                          })
                        ) : (
                          <div className="flex flex-col items-center justify-center py-6 text-center">
                            <Swords className="w-7 h-7 text-surface-600 mb-2" />
                            <span className="text-xs text-surface-500">No activity yet</span>
                            <span className="text-[10px] text-surface-600 mt-0.5">Play your first match!</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>

                  <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 md:gap-8">
                    {/* Profile & Rating */}
                    <div className="flex flex-col gap-4 md:gap-5 w-full">
                      {/* Avatar + Greeting row */}
                      <div className="flex items-center gap-4 md:gap-5">
                        {/* Avatar with rank badge */}
                        <div className="relative flex-shrink-0">
                          <motion.div
                            className="w-[72px] h-[72px] md:w-24 md:h-24 rounded-2xl overflow-hidden border-2 border-surface-600 shadow-xl"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                          >
                            <AvatarDisplay
                              avatar={user?.avatar}
                              avatarUrl={user?.avatar_url}
                              user={user}
                              size="3xl"
                              rounded="2xl"
                              fill
                            />
                          </motion.div>
                          <div className="absolute -bottom-1 -right-1 md:-bottom-2 md:-right-2">
                            <AnimatedRankBadge rating={stats.rating || 1000} size="sm" />
                          </div>
                          <StreakFire streak={stats.currentStreak || 0} />
                        </div>

                        {/* Greeting + Username */}
                        <div className="min-w-0 flex flex-col items-start text-left">
                          <motion.p
                            className="text-surface-400 text-sm md:text-base mb-1 truncate"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                          >
                            {getGreeting(user?.username)}
                          </motion.p>
                          <motion.h1
                            className="text-2xl md:text-3xl lg:text-4xl font-bold text-white truncate leading-none"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.1 }}
                          >
                            {user?.username || 'Coder'}
                          </motion.h1>
                        </div>
                      </div>

                      {/* Rating, rank & progress: full width below the avatar row */}
                      <div className="flex flex-col items-start gap-1.5 w-full">
                        <motion.div
                          className="flex items-baseline gap-3"
                          initial={{ opacity: 0, scale: 0.5 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.2, type: 'spring' }}
                        >
                          <div className="dashboard-elo-value text-4xl md:text-5xl lg:text-6xl font-black leading-none" style={getRankTextStyle(rankTier)}>
                            <CountUp end={stats.rating || 1000} duration={2} />
                          </div>
                          <span className="text-sm md:text-base text-surface-500 uppercase tracking-[0.18em] leading-none">Elo</span>
                        </motion.div>
                        <motion.div
                          className={`text-base md:text-lg font-black uppercase tracking-[0.14em] ${rankTier.textColor}`}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.3 }}
                        >
                          {rankTier.name} Ranking
                        </motion.div>

                        {/* Progress to next rank: full width */}
                        {nextRank && (
                          <motion.div
                            className="w-full mt-2"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.4 }}
                          >
                            <div className="flex items-baseline justify-between mb-1.5 gap-2">
                              <span className="text-xs md:text-sm text-surface-400">
                                Progress to <span className={`font-semibold ${nextRank.textColor}`}>{nextRank.name}</span>
                              </span>
                              <span className="text-xs md:text-sm text-surface-300 font-medium whitespace-nowrap">
                                {nextRank.min - (stats.rating || 1000)} pts to go
                              </span>
                            </div>
                            <div className="h-2.5 md:h-3 bg-surface-700/50 rounded-full overflow-hidden">
                              <motion.div
                                className={`h-full bg-gradient-to-r ${rankTier.color} relative`}
                                initial={{ width: 0 }}
                                animate={{ width: `${progressToNextRank}%` }}
                                transition={{ duration: 1, delay: 0.5, ease: 'easeOut' }}
                              >
                                <motion.div
                                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                                  animate={{ x: ['-100%', '200%'] }}
                                  transition={{ duration: 2, repeat: Infinity, repeatDelay: 1 }}
                                />
                              </motion.div>
                            </div>
                            <div className="mt-1 flex justify-between text-[10px] md:text-xs text-surface-500 tabular-nums">
                              <span>{stats.rating || 1000} ELO</span>
                              <span>{nextRank.min} ELO</span>
                            </div>
                          </motion.div>
                        )}
                      </div>
                    </div>

                  </div>

                  {/* Motivational message */}
                  <motion.p
                    className="mt-4 md:mt-6 text-surface-400 text-xs md:text-sm flex items-center gap-2"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                  >
                    <Sparkles className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                    <span className="line-clamp-2">{motivationalMessage}</span>
                  </motion.p>

                </div>
              </Card>
            </TiltCard>
          </FadeIn>

          {/* Stats Grid - mobile optimized */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">
            <StatCard
              icon={Trophy}
              label="Wins"
              value={stats.wins || 0}
              color="success"
              delay={0.1}
            />
            <StatCard
              icon={Target}
              label="Losses"
              value={stats.losses || 0}
              color="danger"
              delay={0.15}
            />
            <StatCard
              icon={Activity}
              label="Win Rate"
              value={`${stats.winRate || 0}%`}
              color="primary"
              delay={0.2}
              highlight={stats.winRate >= 60}
            />
            <StatCard
              icon={Flame}
              label="Current Streak"
              value={stats.currentStreak || 0}
              subValue={stats.bestStreak ? `Best: ${stats.bestStreak}` : null}
              color="warning"
              delay={0.25}
              highlight={stats.currentStreak >= 3}
            />
          </div>

          {/* Main Content Grid - stacked on mobile */}
          <div className="grid lg:grid-cols-3 gap-4 md:gap-6">
            {/* Left Column */}
            <div className="lg:col-span-2 space-y-4 md:space-y-6">
              {/* Rating History */}
              <FadeIn delay={0.3}>
                <Card className="p-4 md:p-6">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-2">
                    <h3 className="text-base md:text-lg font-semibold flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-primary-400" />
                      Rating History
                    </h3>
                    <div className="flex items-center gap-3 md:gap-4">
                      {lastBattleTime && (
                        <span className="text-[10px] md:text-xs text-surface-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Last: {lastBattleTime}
                        </span>
                      )}
                    </div>
                  </div>
                  <RatingChart data={dashboardData?.ratingHistory || []} />
                </Card>
              </FadeIn>

              {/* Activity Heatmap */}
              <FadeIn delay={0.4}>
                <Card className="p-4 md:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base md:text-lg font-semibold flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-emerald-400" />
                      <span className="hidden sm:inline">Activity (Last 90 Days)</span>
                      <span className="sm:hidden">Activity</span>
                    </h3>
                  </div>
                  <ActivityHeatmap data={dashboardData?.activityHeatmap} />
                </Card>
              </FadeIn>

              {/* Performance Comparison */}
              <FadeIn delay={0.5}>
                <Card className="p-4 md:p-6">
                  <h3 className="text-base md:text-lg font-semibold mb-4 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-primary-400" />
                    Recent Performance
                  </h3>
                  <div className="grid grid-cols-2 gap-3 md:gap-4">
                    <motion.div
                      className="p-3 md:p-5 bg-surface-800/50 rounded-xl border border-surface-700/50"
                      whileHover={{ borderColor: 'rgba(139, 92, 246, 0.3)' }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <div className="flex items-center gap-1.5 md:gap-2 text-surface-400 text-xs md:text-sm mb-2 md:mb-3">
                        <Timer className="w-3 md:w-4 h-3 md:h-4" />
                        <span className="hidden sm:inline">Last 7 Days</span>
                        <span className="sm:hidden">7 Days</span>
                      </div>
                      <div className="flex flex-col sm:flex-row items-start sm:items-baseline justify-between gap-1">
                        <div>
                          <span className="text-2xl md:text-3xl font-bold text-white">
                            <CountUp end={dashboardData?.trends?.last7Days?.battles || 0} duration={1} />
                          </span>
                          <span className="text-surface-500 ml-1 text-xs md:text-base">battles</span>
                        </div>
                        <div className={`text-base md:text-lg font-semibold ${
                          (dashboardData?.trends?.last7Days?.winRate || 0) >= 50 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {dashboardData?.trends?.last7Days?.winRate || 0}%
                        </div>
                      </div>
                    </motion.div>
                    <motion.div
                      className="p-3 md:p-5 bg-surface-800/50 rounded-xl border border-surface-700/50"
                      whileHover={{ borderColor: 'rgba(139, 92, 246, 0.3)' }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <div className="flex items-center gap-1.5 md:gap-2 text-surface-400 text-xs md:text-sm mb-2 md:mb-3">
                        <Calendar className="w-3 md:w-4 h-3 md:h-4" />
                        <span className="hidden sm:inline">Last 30 Days</span>
                        <span className="sm:hidden">30 Days</span>
                      </div>
                      <div className="flex flex-col sm:flex-row items-start sm:items-baseline justify-between gap-1">
                        <div>
                          <span className="text-2xl md:text-3xl font-bold text-white">
                            <CountUp end={dashboardData?.trends?.last30Days?.battles || 0} duration={1} />
                          </span>
                          <span className="text-surface-500 ml-1 text-xs md:text-base">battles</span>
                        </div>
                        <div className={`text-base md:text-lg font-semibold ${
                          (dashboardData?.trends?.last30Days?.winRate || 0) >= 50 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {dashboardData?.trends?.last30Days?.winRate || 0}%
                        </div>
                      </div>
                    </motion.div>
                  </div>
                </Card>
              </FadeIn>
            </div>

            {/* Right Column */}
            <div className="space-y-4 md:space-y-6">
              {/* Recent Battles */}
              <FadeIn delay={0.35}>
                <Card className="p-4 md:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base md:text-lg font-semibold flex items-center gap-2">
                      <Swords className="w-5 h-5 text-secondary-400" />
                      Recent Battles
                    </h3>
                    <Link href={`/profile/${user?.username}`} className="text-xs md:text-sm text-primary-400 hover:text-primary-300 flex items-center gap-1">
                      View All <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                  {dashboardData?.ratingHistory?.length > 0 ? (
                    <div className="space-y-2">
                      {dashboardData?.ratingHistory?.slice(0, 5).map((battle, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.4 + i * 0.08 }}
                          whileHover={{ x: 4, backgroundColor: 'rgba(255,255,255,0.03)' }}
                          whileTap={{ scale: 0.98, backgroundColor: 'rgba(255,255,255,0.05)' }}
                          className="flex items-center justify-between p-2.5 md:p-3 bg-surface-800/40 rounded-xl cursor-pointer transition-colors active:bg-surface-800/60"
                        >
                          <div className="flex items-center gap-2.5 md:gap-3">
                            <motion.div
                              className={`w-9 h-9 md:w-10 md:h-10 rounded-xl flex items-center justify-center text-sm font-bold ${
                                battle.result === 'tie' ? 'bg-yellow-500/20 text-yellow-400' :
                                battle.result === 'win' ? 'bg-green-500/20 text-green-400' :
                                'bg-red-500/20 text-red-400'
                              }`}
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                            >
                              {battle.result === 'tie' ? 'T' : battle.result === 'win' ? 'W' : 'L'}
                            </motion.div>
                            <div>
                              <div className="text-sm font-medium text-white">
                                {battle.result === 'win' ? 'Victory' : battle.result === 'loss' ? 'Defeat' : 'Tie'}
                              </div>
                              <div className="text-[10px] md:text-xs text-surface-500">
                                {getTimeSince(battle.date)}
                              </div>
                            </div>
                          </div>
                          <motion.div
                            className={`text-xs md:text-sm font-bold px-2 py-1 rounded-lg ${
                              battle.change > 0 ? 'text-green-400 bg-green-500/10' :
                              battle.change < 0 ? 'text-red-400 bg-red-500/10' :
                              'text-surface-400 bg-surface-700/50'
                            }`}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                          >
                            {battle.change > 0 ? '+' : ''}{battle.change || 0}
                          </motion.div>
                        </motion.div>
                      ))}
                    </div>
                  ) : (
                    <motion.div
                      className="text-center py-8 md:py-10"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <motion.div
                        animate={{ y: [0, -5, 0] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        <Swords className="w-10 md:w-12 h-10 md:h-12 mx-auto mb-3 text-surface-600" />
                      </motion.div>
                      <p className="text-surface-500 mb-1 text-sm md:text-base">No battles yet</p>
                      <p className="text-surface-600 text-xs md:text-sm mb-4">Your legend begins with a single battle</p>
                      <Button variant="primary" size="sm" onClick={() => router.push('/matchmaking')}>
                        <Rocket className="w-4 h-4 mr-2" />
                        Start First Battle
                      </Button>
                    </motion.div>
                  )}
                </Card>
              </FadeIn>

              {/* Badges */}
              <FadeIn delay={0.45}>
                <Card className="p-4 md:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base md:text-lg font-semibold flex items-center gap-2">
                      <Award className="w-5 h-5 text-yellow-400" />
                      Badges
                      {badges.length > 0 && (
                        <span className="text-[10px] md:text-xs bg-yellow-500/20 text-yellow-400 px-1.5 md:px-2 py-0.5 rounded-full">
                          {badges.length}
                        </span>
                      )}
                    </h3>
                    <Link href={`/badges/${user?.username}`} className="text-xs md:text-sm text-primary-400 hover:text-primary-300 flex items-center gap-1">
                      View All <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                  {badges.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2 md:gap-3">
                      {badges.slice(0, 6).map((badge, i) => (
                        <motion.div
                          key={badge.id || i}
                          initial={{ scale: 0, rotate: -180 }}
                          animate={{ scale: 1, rotate: 0 }}
                          transition={{ delay: 0.5 + i * 0.08, type: 'spring' }}
                          whileHover={{ scale: 1.1, y: -2 }}
                          whileTap={{ scale: 0.95 }}
                          className="flex flex-col items-center p-2 md:p-3 bg-surface-800/50 rounded-xl hover:bg-surface-800 active:bg-surface-700 transition-all cursor-pointer border border-transparent hover:border-surface-600"
                          title={badge.description}
                        >
                          <span className="text-xl md:text-2xl mb-1">{badge.icon}</span>
                          <span className="text-[10px] md:text-xs text-surface-400 text-center line-clamp-1">{badge.name}</span>
                        </motion.div>
                      ))}
                    </div>
                  ) : (
                    <motion.div
                      className="text-center py-8 md:py-10"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <motion.div
                        animate={{ rotate: [0, 10, -10, 0] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        <Award className="w-10 md:w-12 h-10 md:h-12 mx-auto mb-3 text-surface-600" />
                      </motion.div>
                      <p className="text-surface-500 mb-1 text-sm md:text-base">No badges yet</p>
                      <p className="text-surface-600 text-xs md:text-sm">Win battles to earn achievements!</p>
                    </motion.div>
                  )}
                </Card>
              </FadeIn>

            </div>
          </div>
        </main>
      </div>
    </>
  );
}
