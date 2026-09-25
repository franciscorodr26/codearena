import React, { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Logo from '../components/Logo';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Loader2,
  Code2,
  UserCheck
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useFriends } from '../contexts/FriendContext';
import Button from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { FadeIn, CountUp } from '../components/ui/Motion';
import { SkeletonPlayerCard } from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import { withRetry, classifyError, ErrorType } from '../utils/errorHandling';
import AvatarDisplay from '../components/ui/AvatarDisplay';

// Rank tier calculation matching backend elo.js: muted, professional colors
const getRankTier = (rating, apiRankData = null) => {
  if (apiRankData?.rankTier) {
    const colorMap = {
      'Bronze': 'text-amber-600',
      'Silver': 'text-surface-400',
      'Gold': 'text-amber-500',
      'Platinum': 'text-blue-400/80',
      'Diamond': 'text-cyan-500/80',
      'Master': 'text-violet-400/80',
      'Grandmaster': 'text-rose-400/80'
    };
    return {
      name: apiRankData.rankDisplay || apiRankData.rankTier,
      color: colorMap[apiRankData.rankTier] || 'text-surface-400',
    };
  }

  if (rating >= 2200) return { name: 'Grandmaster', color: 'text-rose-400/80' };
  if (rating >= 2000) return { name: 'Master', color: 'text-violet-400/80' };
  if (rating >= 1800) return { name: 'Diamond', color: 'text-cyan-500/80' };
  if (rating >= 1600) return { name: 'Platinum', color: 'text-blue-400/80' };
  if (rating >= 1400) return { name: 'Gold', color: 'text-amber-500' };
  if (rating >= 1200) return { name: 'Silver', color: 'text-surface-400' };
  return { name: 'Bronze', color: 'text-amber-600' };
};

function PlayersPage() {
  const router = useRouter();
  const { searchUsers, getLeaderboard, user } = useAuth();
  const { isFriend } = useFriends();

  const [activeTab, setActiveTab] = useState('leaderboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [errorType, setErrorType] = useState(ErrorType.UNKNOWN);
  const searchTimeoutRef = useRef(null);
  const searchAbortRef = useRef(null);

  const loadLeaderboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await withRetry(
        () => getLeaderboard(50),
        { maxRetries: 3 }
      );
      setLeaderboard(data);
    } catch (err) {
      console.error('Failed to load leaderboard:', err);
      const errType = classifyError(err, err.response);
      setErrorType(errType);
      setError('Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, [getLeaderboard]);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    if (activeTab === 'leaderboard') {
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [activeTab]);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const handleSearch = useCallback((query) => {
    setSearchQuery(query);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (query.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchUsers(query);
        setSearchResults(results);
      } catch (err) {
        console.error('Search failed:', err);
        setError(err.message || 'Search failed');
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [searchUsers]);

  const displayedUsers = activeTab === 'search' ? searchResults : leaderboard;

  return (
    <>
      <Head>
        <title>Leaderboard - Top Coders | CodeArena</title>
        <meta name="description" content="See the top competitive programmers on CodeArena. Browse rankings by ELO rating, find players, and challenge them to coding battles." />
        <link rel="canonical" href="https://codearena.co/players" />
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">
        {/* Header */}
        <header className="bg-surface-900/80 backdrop-blur-md border-b border-surface-800 px-6 py-4 sticky top-0 z-50">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <Link href="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
              <Logo />
            </Link>
            <div className="flex items-center space-x-6">
              <h1 className="text-sm font-medium text-surface-300 tracking-wider">Leaderboard</h1>
              <Button
                variant="primary"
                size="sm"
                onClick={() => router.push('/modes')}
              >
                Play
              </Button>
            </div>
          </div>
        </header>

        <div className="max-w-5xl mx-auto px-6 py-10">
          {/* Tabs */}
          <FadeIn>
            <div className="flex space-x-1 mb-8 border-b border-surface-800">
              <button
                onClick={() => setActiveTab('leaderboard')}
                className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
                  activeTab === 'leaderboard'
                    ? 'border-primary-400 text-white'
                    : 'border-transparent text-surface-500 hover:text-surface-300'
                }`}
              >
                Rankings
              </button>
              <button
                onClick={() => setActiveTab('search')}
                className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
                  activeTab === 'search'
                    ? 'border-primary-400 text-white'
                    : 'border-transparent text-surface-500 hover:text-surface-300'
                }`}
              >
                Search Players
              </button>
            </div>
          </FadeIn>

          {/* Search Input */}
          <AnimatePresence>
            {activeTab === 'search' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="relative mb-8"
              >
                <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-surface-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search for players..."
                  className="w-full pl-10 pr-4 py-2.5 bg-surface-900 border border-surface-700 rounded-lg text-white text-sm placeholder-surface-500 focus:outline-none focus:border-surface-500 transition-colors"
                />
                {searching && (
                  <div className="absolute right-3.5 top-1/2 transform -translate-y-1/2">
                    <Loader2 className="h-4 w-4 text-surface-400 animate-spin" />
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error */}
          <AnimatePresence>
            {error && !loading && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mb-6"
              >
                <ErrorState
                  error={error}
                  errorType={errorType}
                  onRetry={loadLeaderboard}
                  size="sm"
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Results */}
          <FadeIn delay={0.1}>
            {loading && activeTab === 'leaderboard' ? (
              <div className="space-y-px">
                {Array.from({ length: 10 }).map((_, i) => (
                  <SkeletonPlayerCard key={i} className="border-0 rounded-none" />
                ))}
              </div>
            ) : displayedUsers.length === 0 ? (
              <div className="text-center py-16 text-surface-500">
                {activeTab === 'search' ? (
                  searchQuery.length < 2 ? (
                    <p className="text-sm">Type at least 2 characters to search</p>
                  ) : (
                    <p className="text-sm">No players found matching &ldquo;{searchQuery}&rdquo;</p>
                  )
                ) : (
                  <p className="text-sm">No players on the leaderboard yet</p>
                )}
              </div>
            ) : (
              <div className="border border-surface-800 rounded-lg overflow-hidden">
                {/* Table header */}
                {activeTab === 'leaderboard' && (
                  <div className="grid grid-cols-[3rem_1fr_auto] items-center px-4 py-2.5 bg-surface-900/60 border-b border-surface-800 text-xs font-medium text-surface-500 uppercase tracking-wider">
                    <span>#</span>
                    <span>Player</span>
                    <span className="text-right">Rating</span>
                  </div>
                )}
                <div className="divide-y divide-surface-800/60">
                  {displayedUsers.map((player, index) => {
                    const rank = getRankTier(player.rating || 1000, player);
                    const isCurrentUser = player.username === user?.username;

                    return (
                      <motion.div
                        key={player.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: index * 0.02 }}
                        onClick={() => router.push(`/profile/${player.username}?from=leaderboard`)}
                        className={`grid ${activeTab === 'leaderboard' ? 'grid-cols-[3rem_1fr_auto]' : 'grid-cols-[1fr_auto]'} items-center px-4 py-3 hover:bg-surface-800/40 cursor-pointer transition-colors ${
                          isCurrentUser ? 'bg-primary-500/5' : ''
                        }`}
                      >
                        {/* Rank number */}
                        {activeTab === 'leaderboard' && (
                          <span className={`text-sm font-mono tabular-nums ${
                            index === 0 ? 'text-amber-500 font-semibold' :
                            index === 1 ? 'text-surface-400 font-semibold' :
                            index === 2 ? 'text-amber-700 font-semibold' :
                            'text-surface-600'
                          }`}>
                            {player.rank || index + 1}
                          </span>
                        )}

                        {/* Player info */}
                        <div className="flex items-center space-x-3 min-w-0">
                          <AvatarDisplay user={player} size="sm+" />

                          <div className="min-w-0">
                            <div className="flex items-center space-x-2">
                              <span className="font-medium text-sm truncate">{player.username}</span>
                              {player.is_online && (
                                <span className="w-1.5 h-1.5 bg-success rounded-full flex-shrink-0"></span>
                              )}
                              {isCurrentUser && (
                                <span className="text-[11px] text-primary-400 font-medium">(you)</span>
                              )}
                              {!isCurrentUser && isFriend(player.id) && (
                                <span className="flex items-center space-x-0.5 text-[11px] text-surface-400">
                                  <UserCheck className="h-3 w-3" />
                                </span>
                              )}
                            </div>
                            <div className="flex items-center space-x-2 text-xs text-surface-500 mt-0.5">
                              <span className={rank.color}>{rank.name}</span>
                              <span className="text-surface-700">/</span>
                              <span>{player.wins || 0}W {player.losses || 0}L</span>
                            </div>
                          </div>
                        </div>

                        {/* Rating */}
                        <div className="text-right pl-4">
                          <div className={`text-sm font-semibold tabular-nums ${rank.color}`}>
                            <CountUp end={player.rating || 1000} duration={1} />
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}
          </FadeIn>
        </div>
      </div>
    </>
  );
}

export default PlayersPage;
