import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Logo from '../../components/Logo';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import { Code2, Award, Trophy, Zap, Target, Calendar, BookOpen, Star } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { config } from '../../config/env';
import { withAuth } from '../../components/withAuth';
import Button from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { FadeIn } from '../../components/ui/Motion';
import { AchievementBadge, BadgeStats, BadgeCategory, BadgeDetailModal } from '../../components/AchievementBadge';
import { Skeleton } from '../../components/Skeleton';

// Category display names and icons
const categoryConfig = {
  battle: { name: 'Battle Milestones', icon: Trophy, description: 'Earned through winning battles' },
  streak: { name: 'Win Streaks', icon: Zap, description: 'Consecutive battle wins' },
  rank: { name: 'Rank Achievements', icon: Target, description: 'Reaching rating milestones' },
  practice: { name: 'Practice Mode', icon: BookOpen, description: 'Solving practice problems' },
  weekly: { name: 'Weekly Challenge', icon: Calendar, description: 'Completing weekly arena challenges' },
  special: { name: 'Special', icon: Star, description: 'Unique achievements' }
};

function BadgesShowcase() {
  const router = useRouter();
  const { username } = router.query;
  const { user: currentUser, token } = useAuth();

  const [badges, setBadges] = useState({});
  const [stats, setStats] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedBadge, setSelectedBadge] = useState(null);

  const isOwnProfile = currentUser?.username === username;

  useEffect(() => {
    if (!username) return;

    const fetchData = async () => {
      try {
        setLoading(true);

        // Fetch profile first to get user ID
        const profileRes = await fetch(`${config.backend_url}/api/users/${username}`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });

        if (!profileRes.ok) {
          throw new Error(profileRes.status === 404 ? 'User not found' : 'Failed to load profile');
        }

        const profileData = await profileRes.json();
        setProfile(profileData.user);

        // Fetch badge showcase (all badges with earned status)
        const badgesRes = await fetch(`${config.backend_url}/api/badges/showcase/${profileData.user.id}`);
        if (badgesRes.ok) {
          const badgesData = await badgesRes.json();
          setBadges(badgesData.badges || {});
          setStats(badgesData.stats || null);
        }
      } catch (err) {
        console.error('Error fetching badges:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [username, token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-surface-950 via-surface-900 to-surface-950">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <Skeleton className="h-8 w-48 mb-8" />
          <div className="grid grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-surface-950 via-surface-900 to-surface-950 flex items-center justify-center">
        <Card variant="glass" className="p-8 text-center max-w-md">
          <Award className="h-12 w-12 text-surface-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Couldn't load badges</h2>
          <p className="text-surface-400 mb-4">{error}</p>
          <Button onClick={() => router.back()}>Go Back</Button>
        </Card>
      </div>
    );
  }

  const totalBadges = Object.values(badges).flat().length;
  const earnedBadges = Object.values(badges).flat().filter(b => b.earned).length;
  const completionPct = totalBadges > 0 ? (earnedBadges / totalBadges) * 100 : 0;

  return (
    <>
      <Head>
        <title>{username}'s Badges - Code Arena</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-b from-surface-950 via-surface-900 to-surface-950">
        <div className="max-w-5xl mx-auto px-4 py-8">
          {/* Header */}
          <FadeIn>
            <div className="flex items-center gap-4 mb-8">
              <Link href="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
                <Logo />
              </Link>
            </div>

            <Card variant="glass" className="p-6 mb-8">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                    <Award className="h-8 w-8 text-warning" />
                    {isOwnProfile ? 'Your Badges' : `${username}'s Badges`}
                  </h1>
                  <p className="text-surface-400 mt-1">
                    {earnedBadges} of {totalBadges} badges earned
                  </p>
                </div>
                {stats && <BadgeStats stats={stats} />}
              </div>

              {/* Progress bar */}
              <div className="mt-6">
                <div className="h-2 bg-surface-700 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${completionPct}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className="h-full bg-gradient-to-r from-primary-500 to-secondary-500"
                  />
                </div>
                <p className="text-xs text-surface-500 mt-2 text-right">
                  {Math.round(completionPct)}% complete
                </p>
              </div>
            </Card>
          </FadeIn>

          {/* Badge Categories */}
          <div className="space-y-8">
            {Object.entries(categoryConfig).map(([category, config], index) => {
              const categoryBadges = badges[category] || [];
              if (categoryBadges.length === 0) return null;

              const earnedCount = categoryBadges.filter(b => b.earned).length;
              const CategoryIcon = config.icon;

              return (
                <FadeIn key={category} delay={index * 0.1}>
                  <Card variant="glass" className="p-6">
                    <div className="flex items-center gap-3 mb-2">
                      <CategoryIcon className="h-6 w-6 text-primary-400" />
                      <h2 className="text-xl font-bold text-white">{config.name}</h2>
                      <span className="text-sm text-surface-400">
                        ({earnedCount}/{categoryBadges.length})
                      </span>
                    </div>
                    <p className="text-sm text-surface-400 mb-6">{config.description}</p>

                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
                      {categoryBadges.map((badge) => (
                        <AchievementBadge
                          key={badge.id || badge.slug}
                          badge={badge}
                          size="md"
                          earned={badge.earned}
                          showDetails={true}
                          onClick={() => setSelectedBadge(badge)}
                        />
                      ))}
                    </div>
                  </Card>
                </FadeIn>
              );
            })}
          </div>

          {/* Motivational message for own profile */}
          {isOwnProfile && earnedBadges < totalBadges && (
            <FadeIn delay={0.5}>
              <Card variant="glass" className="p-6 mt-8 text-center border-primary-500/20">
                <p className="text-surface-300">
                  Keep battling to unlock more badges! Each badge represents a milestone in your coding journey.
                </p>
                <Button
                  variant="primary"
                  className="mt-4"
                  onClick={() => router.push('/modes')}
                >
                  <Zap className="h-4 w-4 mr-2" />
                  Start a Battle
                </Button>
              </Card>
            </FadeIn>
          )}

          {/* Badge Detail Modal */}
          <BadgeDetailModal
            badge={selectedBadge}
            isOpen={!!selectedBadge}
            onClose={() => setSelectedBadge(null)}
            earned={selectedBadge?.earned !== false}
          />
        </div>
      </div>
    </>
  );
}

export default withAuth(BadgesShowcase, { requireAuth: false });
