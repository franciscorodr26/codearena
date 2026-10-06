import React, { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Logo from '../../components/Logo';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock,
  TrendingUp,
  Calendar,
  MessageSquare,
  Settings,
  Loader2,
  Play,
  Code2,
  UserPlus,
  UserMinus,
  UserCheck,
  X,
  Check,
  BarChart3,
  Camera,
  MoreVertical,
  Flag,
  Ban,
  Sparkles,
  ArrowLeft
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useChallenge } from '../../contexts/ChallengeContext';
import { useFriends } from '../../contexts/FriendContext';
import { config } from '../../config/env';
import { withOptionalAuth } from '../../components/withAuth';
import Button from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { FadeIn } from '../../components/ui/Motion';
import ErrorState from '../../components/ErrorState';
import { AchievementBadge, BadgeStats, BadgeRow, BadgeDetailModal } from '../../components/AchievementBadge';
import ReportUserModal, { BlockUserModal } from '../../components/ReportUserModal';
import { withRetry, classifyError, ErrorType } from '../../utils/errorHandling';
import AvatarDisplay from '../../components/ui/AvatarDisplay';
import { getLanguageDisplayName } from '../../utils/languages';

// Rank thresholds matching backend/elo.js
const getRankTier = (rating) => {
  if (rating >= 2200) return { name: 'Grandmaster', color: 'text-danger', bg: 'bg-danger/10' };
  if (rating >= 2000) return { name: 'Master', color: 'text-secondary-400', bg: 'bg-secondary-400/10' };
  if (rating >= 1800) return { name: 'Diamond', color: 'text-cyan-400', bg: 'bg-cyan-400/10' };
  if (rating >= 1600) return { name: 'Platinum', color: 'text-blue-400', bg: 'bg-blue-400/10' };
  if (rating >= 1400) return { name: 'Gold', color: 'text-warning', bg: 'bg-warning/10' };
  if (rating >= 1200) return { name: 'Silver', color: 'text-surface-300', bg: 'bg-surface-300/10' };
  return { name: 'Bronze', color: 'text-orange-400', bg: 'bg-orange-400/10' };
};

function ProfilePage() {
  const router = useRouter();
  const { username: queryUsername, from: fromPage } = router.query;
  const username = queryUsername;
  const { user: currentUser, token } = useAuth();
  const { sendChallenge, connected: challengeConnected } = useChallenge();
  const {
    isFriend,
    hasPendingRequestTo,
    hasPendingRequestFrom,
    getPendingRequest,
    sendFriendRequest,
    acceptRequest,
    declineRequest,
    cancelRequest,
    removeFriend
  } = useFriends();

  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState(null);
  const [battles, setBattles] = useState([]);
  const [badges, setBadges] = useState([]);
  const [badgeStats, setBadgeStats] = useState(null);
  const [selectedBadge, setSelectedBadge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [errorType, setErrorType] = useState(ErrorType.UNKNOWN);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [selectedBattle, setSelectedBattle] = useState(null);
  const [loadingBattle, setLoadingBattle] = useState(false);
  const [battleError, setBattleError] = useState(null);
  const [activeTab, setActiveTab] = useState('coding');
  const [promptStats, setPromptStats] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [allBattles, setAllBattles] = useState([]);
  const [battleOffset, setBattleOffset] = useState(10);
  const [hasMoreBattles, setHasMoreBattles] = useState(false);
  const [loadingMoreBattles, setLoadingMoreBattles] = useState(false);
  const moreMenuRef = useRef(null);
  // Guards against a slower in-flight profile fetch overwriting a newer one
  // when navigating between profiles (the /profile/[username] route does not remount).
  const fetchSeqRef = useRef(0);

  // Close more menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target)) {
        setShowMoreMenu(false);
      }
    };

    if (showMoreMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMoreMenu]);

  const isOwnProfile = currentUser?.username === username;

  const handleChallenge = () => {
    if (profile?.id) {
      sendChallenge(profile.id);
    }
  };

  const fetchProfile = useCallback(async () => {
    if (!username) return;

    const seq = ++fetchSeqRef.current;
    const isStale = () => seq !== fetchSeqRef.current;

    try {
      setLoading(true);
      setError(null);

      const profileData = await withRetry(async () => {
        const profileRes = await fetch(`${config.backend_url}/api/users/${username}`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });

        if (!profileRes.ok) {
          const err = new Error(profileRes.status === 404 ? 'User not found' : 'Failed to load profile');
          err.response = profileRes;
          throw err;
        }

        return profileRes.json();
      }, { maxRetries: 3 });

      if (isStale()) return;

      setProfile(profileData.user);
      setStats(profileData.stats);
      setBattles(profileData.battles || []);
      // There are more battles to page in if we received a full first page.
      setHasMoreBattles((profileData.battles?.length || 0) >= 10);
      setBattleOffset(10);

      // Fetch badges, prompt stats, and performance data in parallel
      if (profileData.user?.id) {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const fetches = [
          fetch(`${config.backend_url}/api/badges/user/${profileData.user.id}`)
            .then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`${config.backend_url}/api/prompt-practice/stats/${encodeURIComponent(profileData.user.username)}`)
            .then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`${config.backend_url}/api/users/${profileData.user.username}/performance`)
            .then(r => r.ok ? r.json() : null).catch(() => null),
        ];
        const [badgesData, promptData, performanceData] = await Promise.all(fetches);

        if (isStale()) return;

        if (badgesData) {
          setBadges(badgesData.badges || []);
          setBadgeStats(badgesData.stats || null);
        }
        if (promptData) {
          setPromptStats(promptData);
        }
        if (performanceData?.success) {
          setPerformance(performanceData);
        }
      }
    } catch (err) {
      if (isStale()) return;
      console.error('Error fetching profile:', err);
      const errType = classifyError(err, err.response);

      // If 404 and logged in user has different username, might be their old username - redirect
      if (errType === ErrorType.NOT_FOUND && currentUser?.username && currentUser.username !== username) {
        router.replace(`/profile/${currentUser.username}`);
        return;
      }

      setErrorType(errType);
      setError(err.message || 'Failed to load profile');
    } finally {
      if (!isStale()) setLoading(false);
    }
    // Refetch per profile and sign-in only; router and the viewer's username are read just
    // for the renamed-profile redirect and must not trigger another fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, token]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const fetchBattleDetail = useCallback(async (battleUuid) => {
    if (!token || !battleUuid) return;
    setLoadingBattle(true);
    setBattleError(null);
    try {
      const res = await fetch(`${config.backend_url}/api/users/battles/${battleUuid}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data.battle) {
        setSelectedBattle(data.battle);
      } else {
        setBattleError(data.error || 'Failed to load battle details');
      }
    } catch (err) {
      setBattleError('Connection error. Please try again.');
    } finally {
      setLoadingBattle(false);
    }
  }, [token]);

  const formatDate = (dateString) => {
    if (!dateString) return 'recently';
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return 'recently';
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTime = (seconds) => {
    if (!seconds) return '--';
    if (seconds < 60) return `${Math.round(seconds)}s`;

    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);

    if (mins >= 60) {
      const hrs = Math.floor(mins / 60);
      const remainingMins = mins % 60;
      return `${hrs}h ${remainingMins}m`;
    }

    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  };

  const getWinRate = () => {
    if (!stats || (stats.wins + stats.losses) === 0) return 0;
    return Math.round((stats.wins / (stats.wins + stats.losses)) * 100);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 text-surface-400 animate-spin mx-auto mb-4" />
          <p className="text-surface-400">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div>
          <ErrorState
            error={error}
            errorType={errorType}
            onRetry={errorType !== ErrorType.NOT_FOUND ? fetchProfile : null}
          />
          <div className="text-center mt-4">
            <Button
              variant="ghost"
              onClick={() => router.push('/')}
            >
              Go back home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const rank = getRankTier(stats?.rating || 1000);

  return (
    <>
      <Head>
        {/* Primary Meta Tags */}
        <title>{profile?.username ? `${profile.username} (${rank.name}) - CodeArena Profile` : 'Profile - CodeArena'}</title>
        <meta
          name="description"
          content={profile?.username
            ? `${profile.username} is a ${rank.name} ranked coder on CodeArena with ${stats?.wins || 0} wins and ${stats?.rating || 1000} rating.${profile.bio ? ` ${profile.bio.slice(0, 100)}${profile.bio.length > 100 ? '...' : ''}` : ''}`
            : 'View coder profile on CodeArena - the competitive coding battle platform.'
          }
        />
        <link rel="canonical" href={`${config.frontend_url}/profile/${profile?.username || username}`} />

        {/* Open Graph / Facebook */}
        <meta property="og:type" content="profile" />
        <meta property="og:url" content={`${config.frontend_url}/profile/${profile?.username || username}`} />
        <meta property="og:title" content={profile?.username ? `${profile.username} - ${rank.name} on CodeArena` : 'CodeArena Profile'} />
        <meta
          property="og:description"
          content={profile?.username
            ? `${rank.name} ranked coder with ${stats?.wins || 0} wins, ${stats?.losses || 0} losses, and ${stats?.rating || 1000} rating. Challenge them on CodeArena!`
            : 'View coder profile on CodeArena.'
          }
        />
        <meta property="og:image" content={`${config.frontend_url}/api/og/profile/${encodeURIComponent(profile?.username || username)}`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:site_name" content="CodeArena" />
        <meta property="profile:username" content={profile?.username || ''} />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:url" content={`${config.frontend_url}/profile/${profile?.username || username}`} />
        <meta name="twitter:title" content={profile?.username ? `${profile.username} - ${rank.name} on CodeArena` : 'CodeArena Profile'} />
        <meta
          name="twitter:description"
          content={profile?.username
            ? `${rank.name} ranked coder with ${stats?.wins || 0} wins and ${stats?.rating || 1000} rating.`
            : 'View coder profile on CodeArena.'
          }
        />
        <meta name="twitter:image" content={`${config.frontend_url}/api/og/profile/${encodeURIComponent(profile?.username || username)}`} />

        {/* Additional SEO */}
        <meta name="robots" content="index, follow" />
        <meta name="author" content={profile?.username || 'CodeArena'} />

        {/* JSON-LD Structured Data */}
        {profile && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'ProfilePage',
                'mainEntity': {
                  '@type': 'Person',
                  'name': profile.username,
                  'url': `${config.frontend_url}/profile/${profile.username}`,
                  'description': profile.bio || `${rank.name} ranked competitive coder on CodeArena`,
                  'sameAs': [
                    profile.github_url,
                    profile.linkedin_url,
                    profile.twitter_url
                  ].filter(Boolean),
                  'interactionStatistic': [
                    {
                      '@type': 'InteractionCounter',
                      'interactionType': 'https://schema.org/WinAction',
                      'userInteractionCount': stats?.wins || 0
                    },
                    {
                      '@type': 'InteractionCounter',
                      'interactionType': 'https://schema.org/LoseAction',
                      'userInteractionCount': stats?.losses || 0
                    }
                  ]
                },
                'dateCreated': profile.created_at,
                'provider': {
                  '@type': 'Organization',
                  'name': 'CodeArena',
                  'url': config.frontend_url
                }
              })
            }}
          />
        )}
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">
        {/* Header */}
        <header className="bg-surface-900 border-b border-surface-800 px-3 sm:px-6 py-4 sticky top-0 z-50">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
            <Link href="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity shrink-0">
              <Logo />
            </Link>

            <div className="flex items-center space-x-1.5 sm:space-x-3">
              {fromPage === 'leaderboard' && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={ArrowLeft}
                  onClick={() => router.push('/players')}
                  aria-label="Back to leaderboard"
                >
                  <span className="hidden sm:inline">Leaderboard</span>
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                icon={Play}
                onClick={() => router.push('/modes')}
                aria-label="Play"
              >
                <span className="hidden sm:inline">Play</span>
              </Button>
              {isOwnProfile && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={BarChart3}
                    onClick={() => router.push('/analytics')}
                    aria-label="Analytics"
                  >
                    <span className="hidden sm:inline">Analytics</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Settings}
                    onClick={() => router.push('/settings/profile')}
                    aria-label="Edit profile"
                  >
                    <span className="hidden sm:inline">Edit Profile</span>
                  </Button>
                </>
              )}
              {!isOwnProfile && profile && (
                <>
                  {/* Friend Button */}
                  {isFriend(profile.id) ? (
                    <Button
                      variant={confirmRemove ? 'danger' : 'ghost'}
                      size="sm"
                      icon={confirmRemove ? UserMinus : UserCheck}
                      onClick={() => {
                        if (confirmRemove) {
                          removeFriend(profile.id);
                          setConfirmRemove(false);
                        } else {
                          setConfirmRemove(true);
                          setTimeout(() => setConfirmRemove(false), 3000);
                        }
                      }}
                    >
                      {confirmRemove ? 'Remove?' : 'Friends'}
                    </Button>
                  ) : hasPendingRequestTo(profile.id) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Clock}
                      onClick={() => {
                        const pending = getPendingRequest(profile.id);
                        if (pending?.request?.id) {
                          cancelRequest(pending.request.id);
                        }
                      }}
                    >
                      Pending
                    </Button>
                  ) : hasPendingRequestFrom(profile.id) ? (
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={X}
                        onClick={() => {
                          const pending = getPendingRequest(profile.id);
                          if (pending?.request?.id) {
                            declineRequest(pending.request.id);
                          }
                        }}
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={Check}
                        onClick={() => {
                          const pending = getPendingRequest(profile.id);
                          if (pending?.request?.id) {
                            acceptRequest(pending.request.id);
                          }
                        }}
                      >
                        Accept
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={UserPlus}
                      onClick={() => sendFriendRequest(profile.id)}
                    >
                      Add Friend
                    </Button>
                  )}
                  <Button
                    variant="accent"
                    size="sm"
                    onClick={handleChallenge}
                    disabled={!challengeConnected || !profile?.is_online}
                  >
                    Challenge
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={MessageSquare}
                    onClick={() => router.push(`/messages/${profile?.id}`)}
                  >
                    Message
                  </Button>
                  {/* More options menu */}
                  <div className="relative" ref={moreMenuRef}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowMoreMenu(!showMoreMenu)}
                      aria-label="More options"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                    <AnimatePresence>
                      {showMoreMenu && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="absolute right-0 top-full mt-2 w-40 max-w-[calc(100vw-1rem)] bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-50 overflow-hidden"
                        >
                          <button
                            onClick={() => {
                              setShowMoreMenu(false);
                              setShowReportModal(true);
                            }}
                            className="w-full flex items-center space-x-2 px-4 py-3 text-left text-surface-300 hover:bg-surface-700 hover:text-white transition-colors"
                          >
                            <Flag className="h-4 w-4" />
                            <span>Report</span>
                          </button>
                          <button
                            onClick={() => {
                              setShowMoreMenu(false);
                              setShowBlockModal(true);
                            }}
                            className="w-full flex items-center space-x-2 px-4 py-3 text-left text-red-400 hover:bg-surface-700 hover:text-red-300 transition-colors"
                          >
                            <Ban className="h-4 w-4" />
                            <span>Block</span>
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <div className="max-w-6xl mx-auto px-6 py-8">
          {/* Profile Header */}
          <FadeIn>
            <Card variant="glass" className="p-8 mb-8">
              <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
                {/* Avatar */}
                {isOwnProfile ? (
                  <Link href="/settings/profile" className="relative group">
                    <AvatarDisplay user={profile} size="4xl" />
                    <div className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Camera className="h-8 w-8 text-white" />
                    </div>
                  </Link>
                ) : (
                  <AvatarDisplay user={profile} size="4xl" />
                )}

                {/* Profile Info */}
                <div className="flex-1 text-center md:text-left">
                  <div className="flex flex-col md:flex-row md:items-center gap-3 mb-3">
                    <h1 className="text-3xl font-bold">{profile?.username}</h1>
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${rank.color} ${rank.bg}`}>
                      {rank.name}
                    </span>
                    {profile?.is_pro && (
                      <span className="inline-block px-3 py-1 rounded-full text-sm font-medium text-warning bg-warning/10 border border-warning/20">
                        Pro
                      </span>
                    )}
                    {profile?.is_online ? (
                      <span className="inline-flex items-center space-x-1 text-success text-sm">
                        <span className="w-2 h-2 bg-success rounded-full animate-pulse"></span>
                        <span>Online</span>
                      </span>
                    ) : (
                      <span className="text-surface-400 text-sm">
                        Last seen {formatDate(profile?.last_seen || profile?.created_at)}
                      </span>
                    )}
                  </div>

                  {profile?.bio && (
                    <p className="text-surface-300 mb-4 max-w-xl">{profile.bio}</p>
                  )}

                  {/* Social Links */}
                  {(profile?.github_url || profile?.linkedin_url || profile?.twitter_url) && (
                    <div className="flex items-center justify-center md:justify-start gap-2 mb-4 flex-wrap">
                      {profile?.github_url && (
                        <a
                          href={profile.github_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="View GitHub profile"
                          className="flex items-center gap-2 px-4 py-2 bg-[#333]/80 hover:bg-[#333] rounded-full text-white transition-all"
                        >
                          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                          </svg>
                          <span className="text-sm font-medium">GitHub</span>
                        </a>
                      )}
                      {profile?.linkedin_url && (
                        <a
                          href={profile.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="View LinkedIn profile"
                          className="flex items-center gap-2 px-4 py-2 bg-[#0A66C2]/90 hover:bg-[#0A66C2] rounded-full text-white transition-all"
                        >
                          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                          </svg>
                          <span className="text-sm font-medium">LinkedIn</span>
                        </a>
                      )}
                      {profile?.twitter_url && (
                        <a
                          href={profile.twitter_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="View Twitter/X profile"
                          className="flex items-center gap-2 px-4 py-2 bg-black/80 hover:bg-black rounded-full text-white transition-all"
                        >
                          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                          </svg>
                          <span className="text-sm font-medium">X</span>
                        </a>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-center md:justify-start gap-4 text-sm text-surface-400">
                    <div className="flex items-center space-x-1">
                      <Calendar className="h-4 w-4" />
                      <span>Joined {formatDate(profile?.created_at)}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <TrendingUp className="h-4 w-4" />
                      <span>{stats?.rating || 1000} Rating</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </FadeIn>

          {/* Statistics Tabs */}
          <div className="flex gap-1 mb-6 bg-surface-900/80 p-1.5 rounded-xl border border-surface-700">
            {[
              { id: 'coding', label: 'Coding Battles', icon: Code2 },
              { id: 'prompt', label: 'Prompt Battles', icon: Sparkles },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium rounded-md transition-all ${
                  activeTab === tab.id
                    ? 'bg-primary-500/20 text-white border border-primary-500/30 shadow-sm'
                    : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/50'
                }`}
              >
                <tab.icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Coding Battles Tab */}
          {activeTab === 'coding' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                {[
                  { value: stats?.wins || 0, label: 'Wins', color: 'text-success' },
                  { value: stats?.losses || 0, label: 'Losses', color: 'text-danger' },
                  { value: `${getWinRate()}%`, label: 'Win Rate', color: 'text-white' },
                  { value: stats?.best_win_streak || 0, label: 'Best Streak', color: 'text-primary-400' },
                ].map((stat) => (
                  <div key={stat.label}>
                    <Card variant="glass" className="p-6 text-center">
                      <div className={`text-3xl font-bold ${stat.color}`}>{stat.value}</div>
                      <div className="text-sm text-surface-400 mt-1">{stat.label}</div>
                    </Card>
                  </div>
                ))}
              </div>

              <div className="grid md:grid-cols-2 gap-4 mb-8">
                <FadeIn delay={0.2}>
                  <Card variant="glass" className="p-6">
                    <h3 className="text-lg font-semibold mb-4">Performance</h3>
                    <div className="space-y-3">
                      {[
                        { label: 'Total Battles', value: stats?.total_battles || 0 },
                        { label: 'Wins', value: stats?.wins || 0, highlight: 'text-success' },
                        { label: 'Losses', value: stats?.losses || 0, highlight: 'text-danger' },
                        { label: 'Ties', value: stats?.ties || 0 },
                        { label: 'Average Solve Time', value: formatTime(stats?.avg_solve_time) },
                        { label: 'Fastest Solve', value: formatTime(stats?.fastest_solve), highlight: 'text-success' },
                        { label: 'Current Streak', value: stats?.win_streak || 0 },
                      ].map((item) => (
                        <div key={item.label} className="flex justify-between items-center">
                          <span className="text-surface-400">{item.label}</span>
                          <span className={`font-medium ${item.highlight || ''}`}>{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </FadeIn>

                <FadeIn delay={0.3}>
                  <Card variant="glass" className="p-6">
                    <h3 className="text-lg font-semibold mb-4">Rating</h3>
                    <div className="flex items-center justify-center h-32">
                      <div className="text-center">
                        <motion.div
                          initial={{ scale: 0.5, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ delay: 0.4, type: 'spring' }}
                          className={`text-5xl font-bold ${rank.color}`}
                        >
                          {stats?.rating || 1000}
                        </motion.div>
                        <div className="text-sm text-surface-400 mt-2">{rank.name} Rank</div>
                      </div>
                    </div>
                  </Card>
                </FadeIn>
              </div>

              {/* Language Breakdown */}
              {performance?.languageStats && Object.keys(performance.languageStats).length > 0 && (
                <FadeIn delay={0.4}>
                  <Card variant="glass" className="p-6 mb-8">
                    <h3 className="text-lg font-semibold mb-4">Language Breakdown</h3>
                    <div className="space-y-4">
                      {Object.entries(performance.languageStats)
                        .sort((a, b) => (b[1].wins + b[1].losses) - (a[1].wins + a[1].losses))
                        .map(([lang, stats]) => {
                          const total = stats.wins + stats.losses;
                          const winRate = total > 0 ? Math.round((stats.wins / total) * 100) : 0;
                          return (
                            <div key={lang}>
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-medium text-sm">{getLanguageDisplayName(lang)}</span>
                                <span className="text-xs text-surface-400">{stats.wins}W · {stats.losses}L · {winRate}%</span>
                              </div>
                              <div className="w-full bg-surface-800 rounded-full h-2 overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-success to-success/70"
                                  style={{ width: `${winRate}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </Card>
                </FadeIn>
              )}

              {/* Difficulty Breakdown */}
              {performance?.difficultyStats && (
                <FadeIn delay={0.5}>
                  <Card variant="glass" className="p-6 mb-8">
                    <h3 className="text-lg font-semibold mb-4">Difficulty Breakdown</h3>
                    <div className="space-y-4">
                      {[
                        { label: 'Easy', key: 'Easy', color: 'bg-success' },
                        { label: 'Medium', key: 'Medium', color: 'bg-warning' },
                        { label: 'Hard', key: 'Hard', color: 'bg-danger' },
                      ].map(({ label, key, color }) => {
                        const diffStats = performance.difficultyStats[key] || { wins: 0, losses: 0 };
                        const total = diffStats.wins + diffStats.losses;
                        const winRate = total > 0 ? Math.round((diffStats.wins / total) * 100) : 0;
                        return (
                          <div key={key}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${color}`} />
                                <span className="font-medium text-sm">{label}</span>
                              </div>
                              <span className="text-xs text-surface-400">{diffStats.wins}W · {diffStats.losses}L · {winRate}%</span>
                            </div>
                            <div className="w-full bg-surface-800 rounded-full h-2 overflow-hidden">
                              <div
                                className={`h-full ${color}`}
                                style={{ width: `${winRate}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                </FadeIn>
              )}
            </>
          )}

          {/* Prompt Practice Tab */}
          {activeTab === 'prompt' && (
            <div className="mb-8">
              {promptStats?.challenges_solved > 0 || promptStats?.total_attempts > 0 ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    {[
                      { value: promptStats.challenges_solved || 0, label: 'Solved', color: 'text-success' },
                      { value: promptStats.challenges_attempted || 0, label: 'Attempted', color: 'text-white' },
                      { value: promptStats.avg_score != null ? `${promptStats.avg_score}%` : '-', label: 'Avg Score', color: 'text-primary-400' },
                      { value: promptStats.best_score != null ? `${promptStats.best_score}%` : '-', label: 'Best Score', color: 'text-warning' },
                    ].map((stat) => (
                      <div key={stat.label}>
                        <Card variant="glass" className="p-6 text-center">
                          <div className={`text-3xl font-bold ${stat.color}`}>{stat.value}</div>
                          <div className="text-sm text-surface-400 mt-1">{stat.label}</div>
                        </Card>
                      </div>
                    ))}
                  </div>
                  <Card variant="glass" className="p-6">
                    <h3 className="text-lg font-semibold mb-4">Prompt Performance</h3>
                    <div className="space-y-3">
                      {[
                        { label: 'Total Attempts', value: promptStats.total_attempts || 0 },
                        { label: 'Challenges Solved', value: promptStats.challenges_solved || 0, highlight: 'text-success' },
                        { label: 'Challenges Attempted', value: promptStats.challenges_attempted || 0 },
                        { label: 'Average Score', value: promptStats.avg_score != null ? `${promptStats.avg_score}%` : '-' },
                        { label: 'Best Score', value: promptStats.best_score != null ? `${promptStats.best_score}%` : '-', highlight: 'text-warning' },
                      ].map((item) => (
                        <div key={item.label} className="flex justify-between items-center">
                          <span className="text-surface-400">{item.label}</span>
                          <span className={`font-medium ${item.highlight || ''}`}>{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </>
              ) : (
                <Card variant="glass" className="p-6 text-center">
                  <Sparkles className="h-8 w-8 text-surface-500 mx-auto mb-3" />
                  <p className="text-surface-400">No prompt practice yet</p>
                  {isOwnProfile && (
                    <Button variant="ghost" size="sm" onClick={() => router.push('/practice')} className="mt-4">
                      Start Practicing
                    </Button>
                  )}
                </Card>
              )}
            </div>
          )}

          {/* Badges Section */}
          <FadeIn delay={0.35}>
            <Card variant="glass" className="p-6 mb-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Badges</h3>
                {badgeStats && <BadgeStats stats={badgeStats} />}
              </div>

              {badges.length === 0 ? (
                <div className="text-center py-8 text-surface-400">
                  <span className="text-4xl mb-3 block"></span>
                  <p>No badges earned yet</p>
                  {isOwnProfile && (
                    <p className="text-sm mt-2">Win battles and complete challenges to earn badges!</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-4">
                    {badges.slice(0, 8).map((badge) => (
                      <AchievementBadge
                        key={badge.id}
                        badge={badge}
                        size="sm"
                        showDetails={true}
                        onClick={() => setSelectedBadge(badge)}
                      />
                    ))}
                  </div>
                  {badges.length > 8 && (
                    <div className="text-center mt-4">
                      <Link href={`/badges/${username}`}>
                        <span className="text-sm text-primary-400 hover:text-primary-300 cursor-pointer">
                          View all {badges.length} badges →
                        </span>
                      </Link>
                    </div>
                  )}
                </>
              )}
            </Card>
          </FadeIn>

          {/* Badge Detail Modal */}
          <BadgeDetailModal
            badge={selectedBadge}
            isOpen={!!selectedBadge}
            onClose={() => setSelectedBadge(null)}
            earned={true}
          />

          {/* Recent Battles */}
          <FadeIn delay={0.4}>
            <Card variant="glass" className="p-6">
              <h3 className="text-lg font-semibold mb-4">Recent Battles</h3>

              {battles.length === 0 ? (
                <div className="text-center py-8 text-surface-400">
                  <p>No battles yet</p>
                  {isOwnProfile && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push('/modes')}
                      className="mt-4"
                    >
                      Start your first battle
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {battles.slice(0, 10).map((battle, index) => {
                    const isWinner = battle.winner_id === profile?.id;
                    const isTie = battle.is_tie;
                    const opponent = isWinner ? battle.loser_username : battle.winner_username;

                    return (
                      <motion.div
                        key={battle.id || index}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        onClick={() => isOwnProfile && battle.battle_uuid && fetchBattleDetail(battle.battle_uuid)}
                        className={`group relative flex items-center justify-between p-4 rounded-xl border transition-all ${
                          isOwnProfile && battle.battle_uuid ? 'cursor-pointer' : ''
                        } ${
                          isTie
                            ? 'bg-surface-800/50 border-surface-700 hover:border-surface-600'
                            : isWinner
                              ? 'bg-success/10 border-success/30 hover:border-success/50'
                              : 'bg-danger/10 border-danger/30 hover:border-danger/50'
                        }`}
                      >
                        <div className="flex items-center space-x-4 min-w-0 flex-1">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                            isTie ? 'bg-surface-700' : isWinner ? 'bg-success/20' : 'bg-danger/20'
                          }`}>
                            {isTie ? '' : isWinner ? '' : ''}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium truncate">
                              {isTie ? 'Tie' : isWinner ? 'Victory' : 'Defeat'}
                              {opponent && ` vs ${opponent}`}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-surface-400">
                              <span className="whitespace-nowrap truncate max-w-full">{battle.problem_title || battle.problem_id}</span>
                              <span>•</span>
                              <span className="whitespace-nowrap">{formatDate(battle.finished_at)}</span>
                              {(isWinner ? battle.winner_language : battle.loser_language) && (
                                <>
                                  <span>•</span>
                                  <span className="px-2 py-0.5 rounded-full bg-surface-700 text-surface-300 text-xs font-medium whitespace-nowrap">
                                    {(isWinner ? battle.winner_language : battle.loser_language).toUpperCase()}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0 pl-2 text-right">
                          <div className="text-right">
                            <div className={`font-medium ${
                              battle.is_matchmade
                                ? (isTie ? 'text-surface-400' : isWinner ? 'text-success' : 'text-danger')
                                : 'text-surface-400'
                            }`}>
                              {battle.is_matchmade
                                ? `${(() => {
                                    const change = isWinner ? battle.winner_rating_change : battle.loser_rating_change;
                                    if (change == null) return isTie ? '0' : isWinner ? '+25' : '-20';
                                    return change > 0 ? `+${change}` : `${change}`;
                                  })()} rating`
                                : 'Unranked'}
                            </div>
                            <div className="text-sm text-surface-400">
                              {formatTime(isWinner ? battle.winner_time : battle.loser_time)}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                  {hasMoreBattles && (
                    <div className="text-center mt-6">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          setLoadingMoreBattles(true);
                          try {
                            const res = await fetch(
                              `${config.backend_url}/api/users/${username}/battles?limit=10&offset=${battleOffset}`,
                              { headers: token ? { 'Authorization': `Bearer ${token}` } : {} }
                            );
                            if (res.ok) {
                              const data = await res.json();
                              const newBattles = data.battles || [];
                              setBattles(prev => [...prev, ...newBattles]);
                              setBattleOffset(prev => prev + newBattles.length);
                              setHasMoreBattles(Boolean(data.pagination?.hasMore));
                            }
                          } catch (err) {
                            console.error('Error loading more battles:', err);
                          } finally {
                            setLoadingMoreBattles(false);
                          }
                        }}
                        disabled={loadingMoreBattles}
                      >
                        {loadingMoreBattles ? 'Loading...' : 'Load More'}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </FadeIn>
        </div>
      </div>

      {/* Report Modal */}
      <ReportUserModal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        userId={profile?.id}
        username={profile?.username}
      />

      {/* Block Modal */}
      <BlockUserModal
        isOpen={showBlockModal}
        onClose={() => setShowBlockModal(false)}
        userId={profile?.id}
        username={profile?.username}
        onBlocked={() => {
          // Redirect after blocking
          router.push('/friends');
        }}
      />

      {/* Battle Detail Modal */}
      <AnimatePresence>
        {selectedBattle && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setSelectedBattle(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface-900 border border-surface-700 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-surface-700">
                <div>
                  <h2 className="text-xl font-bold text-white">
                    {selectedBattle.problem_title || selectedBattle.problem_id}
                  </h2>
                  <div className="flex items-center gap-3 mt-1 text-sm text-surface-400">
                    {selectedBattle.problem_difficulty && (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        selectedBattle.problem_difficulty === 'Hard' ? 'bg-danger/20 text-danger' :
                        selectedBattle.problem_difficulty === 'Medium' ? 'bg-warning/20 text-warning' :
                        'bg-success/20 text-success'
                      }`}>
                        {selectedBattle.problem_difficulty}
                      </span>
                    )}
                    {selectedBattle.problem_category && (
                      <span className="text-surface-500">{selectedBattle.problem_category}</span>
                    )}
                    <span>{formatDate(selectedBattle.finished_at)}</span>
                    {selectedBattle.is_matchmade ? (
                      <span className="text-primary-400">Ranked</span>
                    ) : (
                      <span className="text-surface-500">Unranked</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedBattle(null)}
                  className="p-2 rounded-lg hover:bg-surface-700 transition-colors"
                >
                  <X className="h-5 w-5 text-surface-400" />
                </button>
              </div>

              {/* Players */}
              <div className="grid grid-cols-2 gap-4 p-6 border-b border-surface-700">
                {/* Winner */}
                <div className={`p-4 rounded-xl border ${
                  selectedBattle.is_tie ? 'border-surface-600 bg-surface-800/50' : 'border-success/30 bg-success/10'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    {!selectedBattle.is_tie && <span className="text-xs font-medium text-success uppercase">Winner</span>}
                    <span className="font-semibold text-white">
                      {selectedBattle.winner_username || 'Player 1'}
                    </span>
                    {selectedBattle.winner_id === profile?.id && (
                      <span className="text-xs text-surface-400">(you)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-surface-400">
                    {selectedBattle.winner_time && (
                      <span>Solved in {formatTime(selectedBattle.winner_time)}</span>
                    )}
                    <span className="uppercase text-xs">{selectedBattle.winner_language}</span>
                    {selectedBattle.winner_rating_change != null && selectedBattle.is_matchmade && (
                      <span className={selectedBattle.winner_rating_change >= 0 ? 'text-success' : 'text-danger'}>
                        {selectedBattle.winner_rating_change > 0 ? '+' : ''}{selectedBattle.winner_rating_change}
                      </span>
                    )}
                  </div>
                </div>

                {/* Loser */}
                <div className={`p-4 rounded-xl border ${
                  selectedBattle.is_tie ? 'border-surface-600 bg-surface-800/50' : 'border-danger/30 bg-danger/10'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-white">
                      {selectedBattle.loser_username || 'Player 2'}
                    </span>
                    {selectedBattle.loser_id === profile?.id && (
                      <span className="text-xs text-surface-400">(you)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-surface-400">
                    {selectedBattle.loser_time && (
                      <span>{selectedBattle.is_forfeit ? 'Forfeit' : `Time: ${formatTime(selectedBattle.loser_time)}`}</span>
                    )}
                    <span className="uppercase text-xs">{selectedBattle.loser_language}</span>
                    {selectedBattle.loser_rating_change != null && selectedBattle.is_matchmade && (
                      <span className={selectedBattle.loser_rating_change >= 0 ? 'text-success' : 'text-danger'}>
                        {selectedBattle.loser_rating_change > 0 ? '+' : ''}{selectedBattle.loser_rating_change}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Code Sections */}
              {(selectedBattle.winner_code || selectedBattle.loser_code) ? (
                <div className="p-6 space-y-4">
                  {/* Your Code */}
                  {(() => {
                    const isWinner = selectedBattle.winner_id === profile?.id;
                    const yourCode = isWinner ? selectedBattle.winner_code : selectedBattle.loser_code;
                    const opponentCode = isWinner ? selectedBattle.loser_code : selectedBattle.winner_code;
                    const yourLang = isWinner ? selectedBattle.winner_language : selectedBattle.loser_language;
                    const opponentLang = isWinner ? selectedBattle.loser_language : selectedBattle.winner_language;
                    const opponentName = isWinner ? selectedBattle.loser_username : selectedBattle.winner_username;

                    return (
                      <>
                        {yourCode && (
                          <div>
                            <h3 className="text-sm font-semibold text-surface-300 mb-2 flex items-center gap-2">
                              <Code2 className="h-4 w-4" />
                              Your Code
                              <span className="text-xs text-surface-500 uppercase">{yourLang}</span>
                            </h3>
                            <pre className="bg-surface-800 border border-surface-700 rounded-xl p-4 text-sm text-surface-200 overflow-x-auto max-h-80 overflow-y-auto font-mono">
                              <code>{yourCode}</code>
                            </pre>
                          </div>
                        )}
                        {opponentCode && (
                          <div>
                            <h3 className="text-sm font-semibold text-surface-300 mb-2 flex items-center gap-2">
                              <Code2 className="h-4 w-4" />
                              {opponentName ? `${opponentName}'s Code` : "Opponent's Code"}
                              <span className="text-xs text-surface-500 uppercase">{opponentLang}</span>
                            </h3>
                            <pre className="bg-surface-800 border border-surface-700 rounded-xl p-4 text-sm text-surface-200 overflow-x-auto max-h-80 overflow-y-auto font-mono">
                              <code>{opponentCode}</code>
                            </pre>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              ) : (
                <div className="p-6 text-center text-surface-500 py-12">
                  <Code2 className="h-8 w-8 mx-auto mb-3 opacity-50" />
                  <p>Code not available for this battle</p>
                  <p className="text-xs mt-1">Code saving was added recently. Newer battles will include code.</p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading overlay for battle detail */}
      {(loadingBattle || battleError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setBattleError(null)}>
          <div className="bg-surface-800 rounded-xl p-6 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {loadingBattle ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-primary-400" />
                <span className="text-surface-300">Loading battle...</span>
              </>
            ) : battleError ? (
              <div className="text-center">
                <p className="text-danger mb-3">{battleError}</p>
                <button
                  onClick={() => setBattleError(null)}
                  className="px-4 py-2 bg-surface-700 hover:bg-surface-600 rounded-lg text-sm transition-colors"
                >
                  Close
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}

export default withOptionalAuth(ProfilePage);
