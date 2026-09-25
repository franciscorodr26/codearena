// pages/bot-battle.js - Practice against AI bots
import React, { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot, ArrowLeft, Loader2, Swords, Trophy,
  Zap, Target, Crown, Cpu, ChevronRight, Sparkles,
  Shield, Clock, TrendingUp
} from 'lucide-react';
import io from 'socket.io-client';

import Logo from '../components/ui/Logo';
import { config } from '../config/env';
import { withAuth } from '../components/withAuth';
import { useAuth } from '../contexts/AuthContext';
import FloatingOrbs from '../components/ui/FloatingOrbs';
import { fetchWithTimeout } from '../utils/fetch';
import { LAUNCH_LANGUAGES } from '../utils/languages';

// Difficulty configurations
const DIFFICULTIES = [
  {
    id: 'easy',
    name: 'Easy',
    subtitle: 'Beginner Friendly',
    description: 'Makes mistakes and solves slowly. Perfect for learning.',
    rating: 800,
    winRate: 50,
    icon: Target,
    color: 'emerald',
    gradient: 'from-emerald-500 to-green-600',
    bgGlow: 'bg-emerald-500/20',
    traits: ['Slow solver', 'Makes mistakes', 'Great for practice']
  },
  {
    id: 'medium',
    name: 'Medium',
    subtitle: 'Balanced Challenge',
    description: 'Occasionally makes mistakes. Good for improving.',
    rating: 1200,
    winRate: 78,
    icon: Zap,
    color: 'amber',
    gradient: 'from-amber-500 to-orange-500',
    bgGlow: 'bg-amber-500/20',
    traits: ['Moderate speed', 'Occasional errors', 'Fair challenge'],
  },
  {
    id: 'hard',
    name: 'Hard',
    subtitle: 'Serious Competition',
    description: 'Fast and accurate. A real challenge.',
    rating: 1600,
    winRate: 90,
    icon: Swords,
    color: 'rose',
    gradient: 'from-rose-500 to-red-600',
    bgGlow: 'bg-rose-500/20',
    traits: ['Fast solver', 'Rarely fails', 'Tough opponent']
  },
  {
    id: 'grandmaster',
    name: 'Grandmaster',
    subtitle: 'Elite AI',
    description: 'Nearly unbeatable speed. Only for the brave.',
    rating: 2200,
    winRate: 97,
    icon: Crown,
    color: 'violet',
    gradient: 'from-violet-500 to-purple-600',
    bgGlow: 'bg-violet-500/20',
    traits: ['Lightning fast', 'Near perfect', 'Ultimate test']
  }
];

// Language card component
function LanguageCard({ lang, isSelected, onSelect, disabled }) {
  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      onClick={() => !disabled && onSelect(lang.id)}
      disabled={disabled}
      className={`
        relative p-3 rounded-xl border-2 transition-all duration-200
        ${isSelected
          ? 'border-primary-500 bg-primary-500/10 shadow-lg shadow-primary-500/20'
          : 'border-surface-700 bg-surface-800/50 hover:border-surface-500'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <div className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-surface-300'}`}>
        {lang.name}
      </div>
      {isSelected && (
        <motion.div
          layoutId="language-indicator"
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary-500 flex items-center justify-center"
        >
          <div className="w-2 h-2 rounded-full bg-white" />
        </motion.div>
      )}
    </motion.button>
  );
}

// Difficulty card component
function DifficultyCard({ difficulty, isSelected, onSelect, disabled, userRating }) {
  const Icon = difficulty.icon;
  const ratingDiff = difficulty.rating - (userRating || 1000);
  const ratingLabel = ratingDiff > 200 ? 'Above your level' : ratingDiff < -200 ? 'Below your level' : 'Good match';

  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.01, y: disabled ? 0 : -2 }}
      whileTap={{ scale: disabled ? 1 : 0.99 }}
      onClick={() => !disabled && onSelect(difficulty.id)}
      disabled={disabled}
      className={`
        relative w-full p-5 rounded-2xl border-2 text-left transition-all duration-300 overflow-hidden
        ${isSelected
          ? `border-${difficulty.color}-500 bg-gradient-to-br from-${difficulty.color}-500/20 to-transparent shadow-xl shadow-${difficulty.color}-500/20`
          : 'border-surface-700 bg-surface-800/80 hover:border-surface-500 hover:bg-surface-800'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      {/* Background glow effect */}
      {isSelected && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={`absolute inset-0 ${difficulty.bgGlow} blur-2xl`}
        />
      )}


      <div className="relative flex items-start gap-4">
        {/* Icon */}
        <div className={`
          w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0
          bg-gradient-to-br ${difficulty.gradient} shadow-lg
        `}>
          <Icon className="h-7 w-7 text-white" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-lg font-bold text-white">{difficulty.name}</h3>
            <span className="text-xs text-surface-400 font-medium">{difficulty.subtitle}</span>
          </div>

          <p className="text-sm text-surface-400 mb-3">{difficulty.description}</p>

          {/* Stats row */}
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-surface-300">~{difficulty.rating} ELO</span>
            </div>
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-rose-400" />
              <span className="text-surface-300">Bot wins {difficulty.winRate}%</span>
            </div>
          </div>
        </div>

        {/* Selection indicator */}
        <div className={`
          w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all
          ${isSelected
            ? `border-${difficulty.color}-500 bg-${difficulty.color}-500`
            : 'border-surface-600'
          }
        `}>
          {isSelected && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
            >
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </motion.div>
          )}
        </div>
      </div>
    </motion.button>
  );
}

function BotBattlePage() {
  const router = useRouter();
  const { user, token } = useAuth();
  const socketRef = useRef(null);
  const requestTimerRef = useRef(null);
  const pendingPlayerRef = useRef(null);
  const routerRef = useRef(router);

  useEffect(() => { routerRef.current = router; }, [router]);

  const [selectedLanguage, setSelectedLanguage] = useState('python');
  const [selectedDifficulty, setSelectedDifficulty] = useState('medium');
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState(null);
  const [userStats, setUserStats] = useState(null);

  const languages = LAUNCH_LANGUAGES;

  // Fetch user stats for rating
  useEffect(() => {
    if (!user || !token) return;

    const fetchStats = async () => {
      try {
        const response = await fetchWithTimeout(`${config.backend_url}/api/users/${user.id}/stats`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setUserStats(data);
        }
      } catch (err) {
        console.error('Failed to fetch user stats:', err);
      }
    };

    fetchStats();
  }, [user, token]);

  // Initialize socket connection
  useEffect(() => {
    if (!token) return;

    const socket = io(config.backend_url, {
      transports: ['websocket', 'polling'],
      auth: { token }
    });

    socketRef.current = socket;

    const finishRequest = () => {
      clearTimeout(requestTimerRef.current);
      requestTimerRef.current = null;
      pendingPlayerRef.current = null;
      setIsStarting(false);
    };

    socket.on('bot-battle-created', ({ battleId, playerId, bot } = {}) => {
      if (!pendingPlayerRef.current || playerId !== pendingPlayerRef.current) return;
      if (!battleId || !bot?.difficulty || !bot?.name) {
        finishRequest();
        setError('The battle could not be opened. Please try again.');
        return;
      }
      clearTimeout(requestTimerRef.current);
      const query = new URLSearchParams({ id: battleId, playerId, isAgainstBot: 'true', botDifficulty: bot.difficulty, opponent: bot.name });
      Promise.resolve(routerRef.current.push(`/battle?${query}`)).then(navigated => {
        if (socketRef.current !== socket) return;
        if (navigated === false) {
          finishRequest();
          setError('The battle could not be opened. Please try again.');
        }
      }).catch(() => {
        if (socketRef.current !== socket) return;
        finishRequest();
        setError('The battle could not be opened. Please try again.');
      });
    });

    socket.on('bot-battle-error', ({ message } = {}) => {
      finishRequest();
      setError(message || 'Unable to create the bot battle. Please try again.');
    });

    socket.on('connect_error', () => {
      finishRequest();
      setError('Failed to connect to server. Please try again.');
    });

    socket.on('disconnect', () => {
      if (!pendingPlayerRef.current) return;
      finishRequest();
      setError('Connection lost while creating the battle. Reconnect and try again.');
    });

    return () => {
      clearTimeout(requestTimerRef.current);
      pendingPlayerRef.current = null;
      socketRef.current = null;
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [token]);

  const handleStartBattle = () => {
    if (pendingPlayerRef.current) return;
    if (!socketRef.current?.connected || !user) {
      setError('Not connected to server. Please wait a moment and try again.');
      return;
    }

    setIsStarting(true);
    setError(null);

    const playerId = `player-${user.id}-${Date.now()}`;
    pendingPlayerRef.current = playerId;
    requestTimerRef.current = setTimeout(() => {
      pendingPlayerRef.current = null;
      setIsStarting(false);
      setError('Creating the battle took too long. Please try again.');
    }, 30000);

    socketRef.current.emit('request-bot-battle', {
      playerId,
      playerName: user.username || user.name || 'Player',
      language: selectedLanguage,
      difficulty: selectedDifficulty,
      userId: user.id,
      rating: userStats?.rating || 1000
    });
  };

  const selectedDiff = DIFFICULTIES.find(d => d.id === selectedDifficulty);

  return (
    <>
      <Head>
        <title>Practice vs Bot - CodeArena</title>
        <meta name="description" content="Practice coding against AI opponents of varying difficulty" />
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">
        <FloatingOrbs showCenterOrb={false} />

        <div className="relative z-10 min-h-screen flex flex-col">
          {/* Header */}
          <motion.header
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="px-6 py-4 flex items-center justify-between border-b border-surface-800/50"
          >
            <Link href="/modes" className="flex items-center gap-2 text-surface-400 hover:text-white transition-colors group">
              <ArrowLeft className="h-5 w-5 group-hover:-translate-x-1 transition-transform" />
              <span className="font-medium">Back</span>
            </Link>
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Logo size="md" />
            </Link>
          </motion.header>

          {/* Main Content */}
          <div className="flex-1 flex flex-col lg:flex-row">
            {/* Left Panel - Hero Section */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="lg:w-2/5 p-8 lg:p-12 flex flex-col justify-center"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-secondary-500 flex items-center justify-center shadow-lg shadow-primary-500/30">
                  <Cpu className="h-6 w-6 text-white" />
                </div>
                <div className="px-3 py-1 rounded-full bg-primary-500/10 border border-primary-500/20">
                  <span className="text-xs font-semibold text-primary-400">PRACTICE MODE</span>
                </div>
              </div>

              <h1 className="text-4xl lg:text-5xl font-bold mb-4">
                Battle the{' '}
                <span className="bg-gradient-to-r from-primary-400 via-secondary-400 to-primary-400 bg-clip-text text-transparent">
                  AI
                </span>
              </h1>

              <p className="text-lg text-surface-400 mb-8 leading-relaxed">
                Sharpen your coding skills against AI opponents. Choose your difficulty
                and prove your worth in a pressure-free environment.
              </p>

              {/* Features */}
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-surface-300">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <Shield className="h-4 w-4 text-emerald-400" />
                  </div>
                  <span>No ELO impact - practice risk-free</span>
                </div>
                <div className="flex items-center gap-3 text-surface-300">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <Clock className="h-4 w-4 text-amber-400" />
                  </div>
                  <span>10-minute timed challenges</span>
                </div>
                <div className="flex items-center gap-3 text-surface-300">
                  <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                    <TrendingUp className="h-4 w-4 text-violet-400" />
                  </div>
                  <span>4 difficulty levels to master</span>
                </div>
              </div>

              {/* User stats */}
              {userStats && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="mt-8 p-4 rounded-2xl bg-surface-800/50 border border-surface-700"
                >
                  <div className="text-xs text-surface-400 mb-1">Your Rating</div>
                  <div className="text-2xl font-bold text-white">{userStats.rating || 1000} ELO</div>
                </motion.div>
              )}
            </motion.div>

            {/* Right Panel - Selection */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="lg:w-3/5 p-6 lg:p-8 bg-surface-900/50 lg:border-l border-surface-800"
            >
              <div className="max-w-xl mx-auto">
                {/* Language Selection */}
                <div className="mb-8">
                  <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider mb-3">
                    Select Language
                  </h3>
                  <div className="grid grid-cols-4 gap-2">
                    {languages.map((lang) => (
                      <LanguageCard
                        key={lang.id}
                        lang={lang}
                        isSelected={selectedLanguage === lang.id}
                        onSelect={setSelectedLanguage}
                        disabled={isStarting}
                      />
                    ))}
                  </div>
                </div>

                {/* Error message */}
                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm"
                    >
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Difficulty Selection */}
                <div className="mb-8">
                  <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider mb-3">
                    Choose Difficulty
                  </h3>
                  <div className="space-y-3">
                    {DIFFICULTIES.map((diff) => (
                      <DifficultyCard
                        key={diff.id}
                        difficulty={diff}
                        isSelected={selectedDifficulty === diff.id}
                        onSelect={setSelectedDifficulty}
                        disabled={isStarting}
                        userRating={userStats?.rating}
                      />
                    ))}
                  </div>
                </div>

                {/* Start Button */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleStartBattle}
                  disabled={isStarting}
                  className={`
                    w-full py-4 px-6 rounded-2xl font-bold text-lg
                    bg-gradient-to-r ${selectedDiff?.gradient || 'from-primary-500 to-secondary-500'}
                    hover:shadow-xl hover:shadow-${selectedDiff?.color || 'primary'}-500/30
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-all duration-300 flex items-center justify-center gap-3
                  `}
                >
                  {isStarting ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>Creating Battle...</span>
                    </>
                  ) : (
                    <>
                      <Swords className="h-5 w-5" />
                      <span>Start {selectedDiff?.name} Battle</span>
                      <ChevronRight className="h-5 w-5" />
                    </>
                  )}
                </motion.button>

                <p className="text-center text-xs text-surface-500 mt-4">
                  Bot battles don't affect your ELO rating
                </p>
              </div>
            </motion.div>
          </div>
        </div>

        {/* Loading overlay */}
        <AnimatePresence>
          {isStarting && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-center p-8 rounded-3xl bg-surface-900/90 border border-surface-700 shadow-2xl"
              >
                <div className="relative mb-6">
                  <div className={`w-20 h-20 rounded-3xl bg-gradient-to-br ${selectedDiff?.gradient} flex items-center justify-center mx-auto`}>
                    <Bot className="h-10 w-10 text-white" />
                  </div>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    className="absolute inset-0 w-20 h-20 mx-auto rounded-3xl border-2 border-transparent border-t-white/30"
                  />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Initializing Battle</h3>
                <p className="text-surface-400">Finding your {selectedDiff?.name} opponent...</p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

export default withAuth(BotBattlePage);
