import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Target, Clock, Calendar, Gift, CheckCircle, Loader2 } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import { config } from '../config/env';
import { authFetch } from '../utils/fetch';

/**
 * Agent Challenges Component
 * Displays daily and weekly agent battle challenges with progress tracking
 */
export default function AgentChallenges({ onChallengeCompleted }) {
  const [challenges, setChallenges] = useState({ daily: null, weekly: null });
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(null);
  const [error, setError] = useState(null);

  // Fetch challenges on mount
  useEffect(() => {
    fetchChallenges();
  }, []);

  const fetchChallenges = async () => {
    try {
      setLoading(true);
      const response = await authFetch(`${config.backend_url}/api/agent/challenges`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch challenges');
      }

      setChallenges(data.challenges);
    } catch (err) {
      console.error('Error fetching challenges:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClaimReward = async (challengeId) => {
    try {
      setClaiming(challengeId);
      const response = await authFetch(`${config.backend_url}/api/agent/challenges/${challengeId}/claim`, {
        method: 'POST',
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to claim reward');
      }

      // Refresh challenges
      await fetchChallenges();

      // Notify parent component
      if (onChallengeCompleted) {
        onChallengeCompleted(data.reward);
      }

      // Show success feedback
      alert(`Reward claimed: ${data.reward.value.message}`);
    } catch (err) {
      console.error('Error claiming reward:', err);
      alert(err.message);
    } finally {
      setClaiming(null);
    }
  };

  const getTimeRemaining = (endsAt) => {
    const now = new Date();
    const end = new Date(endsAt);
    const diff = end - now;

    if (diff <= 0) return 'Expired';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h remaining`;
    }

    return `${hours}h ${minutes}m remaining`;
  };

  const getChallengeIcon = (requirementType) => {
    switch (requirementType) {
      case 'wins':
        return CheckCircle;
      case 'streak':
        return Target;
      case 'speed':
      case 'speed_multiple':
        return Clock;
      case 'model':
      case 'language':
        return Target;
      default:
        return CheckCircle;
    }
  };

  const renderChallenge = (challenge, type) => {
    if (!challenge) {
      return (
        <Card className="p-6 bg-surface-800/50 border-surface-700">
          <div className="text-center text-surface-400">
            <p className="text-sm">No {type} challenge available</p>
          </div>
        </Card>
      );
    }

    const Icon = getChallengeIcon(challenge.requirementType);
    const progress = challenge.progress || 0;
    const target = challenge.requirementValue.count || 1;
    const progressPercent = Math.min((progress / target) * 100, 100);
    const isCompleted = challenge.completed;

    return (
      <Card className="p-6 bg-surface-800/50 border-surface-700 hover:border-accent-500/50 transition-all">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-lg ${type === 'daily' ? 'bg-blue-500/20' : 'bg-purple-500/20'}`}>
              <Icon className={`w-6 h-6 ${type === 'daily' ? 'text-blue-400' : 'text-purple-400'}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white">{challenge.title}</h3>
                {isCompleted && (
                  <CheckCircle className="w-5 h-5 text-success-500" />
                )}
              </div>
              <p className="text-sm text-surface-300">{challenge.description}</p>
            </div>
          </div>
          {type === 'daily' ? (
            <Calendar className="w-5 h-5 text-blue-400" />
          ) : (
            <Calendar className="w-5 h-5 text-purple-400" />
          )}
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-surface-300">
              Progress: {progress} / {target}
            </span>
            <span className="text-xs text-surface-400">
              {progressPercent.toFixed(0)}%
            </span>
          </div>
          <div className="w-full h-3 bg-surface-700 rounded-full overflow-hidden">
            <motion.div
              className={`h-full ${type === 'daily' ? 'bg-gradient-to-r from-blue-500 to-cyan-500' : 'bg-gradient-to-r from-purple-500 to-pink-500'}`}
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
        </div>

        {/* Reward & Actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gift className="w-5 h-5 text-accent-400" />
            <span className="text-sm font-medium text-surface-200">
              {challenge.rewardValue.message}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-surface-400">
              {getTimeRemaining(challenge.endsAt)}
            </span>
            {isCompleted && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => handleClaimReward(challenge.id)}
                disabled={claiming === challenge.id}
                className="min-w-[80px]"
              >
                {claiming === challenge.id ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Claiming...
                  </>
                ) : (
                  <>
                    <Gift className="w-4 h-4 mr-2" />
                    Claim
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-accent-400 animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6 bg-surface-800/50 border-error-500/50">
        <div className="text-center">
          <p className="text-error-400">Failed to load challenges</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={fetchChallenges}
            className="mt-4"
          >
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex items-center gap-3">
        <Target className="w-5 h-5 text-primary-400" />
        <h2 className="text-2xl font-bold text-white">Challenges</h2>
      </div>

      {/* Daily Challenge */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <h3 className="text-lg font-semibold text-surface-200">Daily Challenge</h3>
        </div>
        {renderChallenge(challenges.daily, 'daily')}
      </div>

      {/* Weekly Challenge */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
          <h3 className="text-lg font-semibold text-surface-200">Weekly Challenge</h3>
        </div>
        {renderChallenge(challenges.weekly, 'weekly')}
      </div>

      {/* Info */}
      <Card className="p-4 bg-surface-800/30 border-surface-700">
        <div className="flex items-start gap-3">
          <Target className="w-5 h-5 text-accent-400 mt-0.5" />
          <div className="text-sm text-surface-300">
            <p className="font-medium text-surface-200 mb-1">How it works:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Complete challenges by winning agent battles</li>
              <li>Daily challenges reset every 24 hours</li>
              <li>Weekly challenges reset every Monday</li>
              <li>Claim rewards after completing challenges</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
