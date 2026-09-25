import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Logo from '../components/Logo';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  Users,
  Loader2,
  RefreshCw,
  Globe
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { withAuth } from '../components/withAuth';
import Button from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { FadeIn } from '../components/ui/Motion';
import { config } from '../config/env';
import AvatarDisplay from '../components/ui/AvatarDisplay';
import { CardSkeleton } from '../components/ui/Skeleton';

// Event type display configurations
const eventConfig = {
  battle_win: {
    icon: '',
    color: 'text-success',
    bgColor: 'bg-success/10',
    borderColor: 'border-success/30',
    getMessage: (data, username, isOwn) => {
      if (isOwn) {
        return data.opponent ? `You won a battle against ${data.opponent}!` : 'You won a battle!';
      }
      return data.opponent ? `won a battle against ${data.opponent}` : 'won a battle';
    }
  },
  badge_earned: {
    icon: '',
    color: 'text-warning',
    bgColor: 'bg-warning/10',
    borderColor: 'border-warning/30',
    getMessage: (data, username, isOwn) => {
      const badge = data.badgeIcon ? `${data.badgeIcon} ${data.badgeName}` : data.badgeName;
      if (isOwn) {
        return `You earned the "${badge}" badge!`;
      }
      return `earned the "${badge}" badge`;
    }
  },
  friend_added: {
    icon: '',
    color: 'text-primary-400',
    bgColor: 'bg-primary-400/10',
    borderColor: 'border-primary-400/30',
    getMessage: (data, username, isOwn) => {
      if (isOwn) {
        return `You became friends with ${data.friendName}`;
      }
      return `became friends with ${data.friendName}`;
    }
  },
  rank_up: {
    icon: '',
    color: 'text-secondary-400',
    bgColor: 'bg-secondary-400/10',
    borderColor: 'border-secondary-400/30',
    getMessage: (data, username, isOwn) => {
      if (isOwn) {
        return `You reached ${data.rank}!`;
      }
      return `reached ${data.rank}`;
    }
  },
  streak_milestone: {
    icon: '',
    color: 'text-orange-400',
    bgColor: 'bg-orange-400/10',
    borderColor: 'border-orange-400/30',
    getMessage: (data, username, isOwn) => {
      if (isOwn) {
        return `You're on a ${data.streak}-win streak!`;
      }
      return `is on a ${data.streak}-win streak`;
    }
  },
  weekly_completed: {
    icon: '',
    color: 'text-blue-400',
    bgColor: 'bg-blue-400/10',
    borderColor: 'border-blue-400/30',
    getMessage: (data, username, isOwn) => {
      const rankText = data.rank ? ` (Rank #${data.rank})` : '';
      if (isOwn) {
        return `You completed the weekly challenge${rankText}!`;
      }
      return `completed the weekly challenge${rankText}`;
    }
  },
  practice_milestone: {
    icon: '',
    color: 'text-purple-400',
    bgColor: 'bg-purple-400/10',
    borderColor: 'border-purple-400/30',
    getMessage: (data, username, isOwn) => {
      if (isOwn) {
        return `You solved ${data.count} practice problems!`;
      }
      return `solved ${data.count} practice problems`;
    }
  },
  tournament_registered: {
    icon: '',
    color: 'text-primary-400',
    bgColor: 'bg-primary-400/10',
    borderColor: 'border-primary-400/30',
    getMessage: (data, username, isOwn) => {
      if (isOwn) {
        return `You registered for ${data.tournamentName}`;
      }
      return `registered for ${data.tournamentName}`;
    }
  },
  tournament_match_won: {
    icon: '',
    color: 'text-success',
    bgColor: 'bg-success/10',
    borderColor: 'border-success/30',
    getMessage: (data, username, isOwn) => {
      if (isOwn) {
        return `You won a tournament match in ${data.tournamentName}!`;
      }
      return `won a tournament match in ${data.tournamentName}`;
    }
  },
  tournament_won: {
    icon: '',
    color: 'text-warning',
    bgColor: 'bg-warning/10',
    borderColor: 'border-warning/30',
    getMessage: (data, username, isOwn) => {
      if (isOwn) {
        return `You won the ${data.tournamentName} tournament!`;
      }
      return `won the ${data.tournamentName} tournament`;
    }
  },
  tournament_finalist: {
    icon: '',
    color: 'text-surface-300',
    bgColor: 'bg-surface-400/10',
    borderColor: 'border-surface-400/30',
    getMessage: (data, username, isOwn) => {
      if (isOwn) {
        return `You reached the finals of ${data.tournamentName}`;
      }
      return `reached the finals of ${data.tournamentName}`;
    }
  }
};

// Format relative time
const formatRelativeTime = (dateString) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Activity event card
function ActivityCard({ event, currentUserId }) {
  const isOwn = event.user_id === currentUserId;
  const config = eventConfig[event.event_type] || {
    icon: '',
    color: 'text-surface-300',
    bgColor: 'bg-surface-700/50',
    borderColor: 'border-surface-600',
    getMessage: () => 'had some activity'
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-4 rounded-xl border ${config.borderColor} ${config.bgColor} backdrop-blur-sm`}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <Link href={`/profile/${event.username}`}>
          <AvatarDisplay avatar={event.avatar} avatarUrl={event.avatar_url} size="md" className="cursor-pointer hover:ring-2 hover:ring-primary-500/50 transition-all" />
        </Link>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xl">{config.icon}</span>
            {!isOwn && (
              <Link href={`/profile/${event.username}`} className="font-semibold text-white hover:text-primary-400 transition-colors">
                {event.username}
              </Link>
            )}
            <span className={`${isOwn ? 'text-white' : 'text-surface-300'}`}>
              {config.getMessage(event.event_data, event.username, isOwn)}
            </span>
          </div>
          <p className="text-xs text-surface-500 mt-1">
            {formatRelativeTime(event.created_at)}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// Empty state
function EmptyState({ type }) {
  return (
    <Card variant="glass" className="p-8 text-center">
      <h3 className="text-lg font-semibold text-white mb-2">No activity yet</h3>
      <p className="text-surface-400 max-w-md mx-auto">
        {type === 'personal'
          ? "Win battles, earn badges, and make friends to see your activity here!"
          : "No community activity to show yet. Be the first to make some noise!"}
      </p>
    </Card>
  );
}

function ActivityFeed() {
  const router = useRouter();
  const { user, token } = useAuth();
  const [activeTab, setActiveTab] = useState('personal');
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchActivity = useCallback(async (showRefresh = false) => {
    if (!token) return;

    try {
      if (showRefresh) setRefreshing(true);
      else setLoading(true);

      const endpoint = activeTab === 'personal'
        ? `${config.backend_url}/api/activity`
        : `${config.backend_url}/api/activity/global`;

      const res = await fetch(endpoint, {
        headers: activeTab === 'personal' ? { 'Authorization': `Bearer ${token}` } : {}
      });

      if (!res.ok) throw new Error('Failed to fetch activity');

      const data = await res.json();
      setEvents(data.events || []);
      setError(null);
    } catch (err) {
      console.error('Error fetching activity:', err);
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, activeTab]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  const handleRefresh = () => {
    fetchActivity(true);
  };

  return (
    <>
      <Head>
        <title>Activity Feed - Code Arena</title>
      </Head>

      <div className="min-h-screen bg-surface-950">
        <div className="max-w-2xl mx-auto px-4 py-8">
          {/* Header */}
          <FadeIn>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <Link href="/" className="hover:opacity-80 transition-opacity">
                  <Logo />
                </Link>
                <h1 className="text-2xl font-bold text-white">Activity</h1>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </FadeIn>

          {/* Tabs */}
          <FadeIn delay={0.1}>
            <div className="flex gap-2 mb-6">
              <Button
                variant={activeTab === 'personal' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('personal')}
              >
                Your Feed
              </Button>
              <Button
                variant={activeTab === 'global' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('global')}
              >
                Community
              </Button>
            </div>
          </FadeIn>

          {/* Content */}
          <FadeIn delay={0.2}>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            ) : error ? (
              <Card variant="glass" className="p-6 text-center">
                <p className="text-danger mb-4">{error}</p>
                <Button variant="outline" onClick={() => fetchActivity()}>
                  Try Again
                </Button>
              </Card>
            ) : events.length === 0 ? (
              <EmptyState type={activeTab} />
            ) : (
              <div className="space-y-3">
                <AnimatePresence mode="popLayout">
                  {events.map((event, index) => (
                    <ActivityCard
                      key={event.id}
                      event={event}
                      currentUserId={user?.id}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </FadeIn>

          {/* Helpful tip */}
          {activeTab === 'personal' && events.length > 0 && (
            <FadeIn delay={0.3}>
              <Card variant="glass" className="p-4 mt-6 text-center border-primary-500/20">
                <p className="text-sm text-surface-400">
                  Your activity feed shows updates from you and your friends. Add more friends to see their achievements!
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => router.push('/players')}
                >
                  Find Players
                </Button>
              </Card>
            </FadeIn>
          )}
        </div>
      </div>
    </>
  );
}

export default withAuth(ActivityFeed);
