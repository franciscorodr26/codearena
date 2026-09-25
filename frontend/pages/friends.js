import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Loader2,
  UserPlus,
  UserMinus,
  MessageCircle,
  Swords,
  Play,
  Check,
  X,
  Clock
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useFriends } from '../contexts/FriendContext';
import { useChallenge } from '../contexts/ChallengeContext';
import { withAuth } from '../components/withAuth';
import Button from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { FadeIn } from '../components/ui/Motion';
import PageHeader from '../components/ui/PageHeader';
import FloatingOrbs from '../components/ui/FloatingOrbs';
import ErrorState from '../components/ErrorState';
import { ErrorType } from '../utils/errorHandling';
import AvatarDisplay from '../components/ui/AvatarDisplay';

const getRankTier = (rating) => {
  if (rating >= 2200) return { name: 'Grandmaster', color: 'text-danger' };
  if (rating >= 2000) return { name: 'Master', color: 'text-secondary-400' };
  if (rating >= 1800) return { name: 'Diamond', color: 'text-primary-400' };
  if (rating >= 1600) return { name: 'Platinum', color: 'text-blue-400' };
  if (rating >= 1400) return { name: 'Gold', color: 'text-warning' };
  if (rating >= 1200) return { name: 'Silver', color: 'text-surface-300' };
  return { name: 'Bronze', color: 'text-orange-400' };
};

function FriendsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { sendChallenge } = useChallenge();
  const {
    friends,
    friendsLoading,
    incomingRequests,
    outgoingRequests,
    pendingCount,
    acceptRequest,
    declineRequest,
    cancelRequest,
    removeFriend,
    friendError,
    refreshFriends
  } = useFriends();

  const [activeTab, setActiveTab] = useState('friends');
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [actionLoading, setActionLoading] = useState({}); // Track loading state per action
  const [challengeSent, setChallengeSent] = useState(null); // Track challenge feedback

  // Auto-dismiss error messages
  useEffect(() => {
    if (friendError) {
      const timer = setTimeout(() => {
        refreshFriends();
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [friendError, refreshFriends]);

  // Auto-dismiss challenge feedback
  useEffect(() => {
    if (challengeSent) {
      const timer = setTimeout(() => setChallengeSent(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [challengeSent]);

  const handleChallenge = async (friendId) => {
    if (actionLoading[`challenge-${friendId}`]) return; // Prevent double-click
    setActionLoading(prev => ({ ...prev, [`challenge-${friendId}`]: true }));
    try {
      await sendChallenge(friendId);
      setChallengeSent(friendId);
    } finally {
      setActionLoading(prev => ({ ...prev, [`challenge-${friendId}`]: false }));
    }
  };

  const handleAcceptRequest = async (requestId) => {
    if (actionLoading[`accept-${requestId}`]) return;
    setActionLoading(prev => ({ ...prev, [`accept-${requestId}`]: true }));
    try {
      await acceptRequest(requestId);
    } finally {
      setActionLoading(prev => ({ ...prev, [`accept-${requestId}`]: false }));
    }
  };

  const handleDeclineRequest = async (requestId) => {
    if (actionLoading[`decline-${requestId}`]) return;
    setActionLoading(prev => ({ ...prev, [`decline-${requestId}`]: true }));
    try {
      await declineRequest(requestId);
    } finally {
      setActionLoading(prev => ({ ...prev, [`decline-${requestId}`]: false }));
    }
  };

  const handleCancelRequest = async (requestId) => {
    if (actionLoading[`cancel-${requestId}`]) return;
    setActionLoading(prev => ({ ...prev, [`cancel-${requestId}`]: true }));
    try {
      await cancelRequest(requestId);
    } finally {
      setActionLoading(prev => ({ ...prev, [`cancel-${requestId}`]: false }));
    }
  };

  const handleRemoveFriendAction = async (friendId) => {
    if (actionLoading[`remove-${friendId}`]) return;

    if (confirmRemove === friendId) {
      setActionLoading(prev => ({ ...prev, [`remove-${friendId}`]: true }));
      try {
        await removeFriend(friendId);
      } finally {
        setActionLoading(prev => ({ ...prev, [`remove-${friendId}`]: false }));
      }
      setConfirmRemove(null);
    } else {
      setConfirmRemove(friendId);
      setTimeout(() => setConfirmRemove(null), 3000);
    }
  };

  const handleMessage = (friendId) => {
    router.push(`/messages?userId=${friendId}`);
  };

  return (
    <>
      <Head>
        <title>Friends - CodeArena</title>
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">
        <FloatingOrbs variant="secondary" />

        {/* Header */}
        <PageHeader>
          <h1 className="text-lg font-semibold flex items-center space-x-2">
            <Users className="h-5 w-5 text-secondary-400" />
            <span>Friends</span>
            {pendingCount > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="bg-secondary-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center"
              >
                {pendingCount}
              </motion.span>
            )}
          </h1>
          <Button
            variant="primary"
            size="sm"
            icon={Play}
            onClick={() => router.push('/modes')}
          >
            Play
          </Button>
        </PageHeader>

        <div className="max-w-4xl mx-auto px-6 py-8 relative z-10">
          {/* Tabs */}
          <FadeIn>
            <div className="flex space-x-2 mb-6">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setActiveTab('friends')}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl font-medium transition-all ${
                  activeTab === 'friends'
                    ? 'bg-secondary-500/20 text-secondary-400 border border-secondary-500/50'
                    : 'bg-surface-800/50 text-surface-400 hover:text-white border border-transparent'
                }`}
              >
                <Users className="h-4 w-4" />
                <span>Friends ({friends.length})</span>
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setActiveTab('incoming')}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl font-medium transition-all ${
                  activeTab === 'incoming'
                    ? 'bg-secondary-500/20 text-secondary-400 border border-secondary-500/50'
                    : 'bg-surface-800/50 text-surface-400 hover:text-white border border-transparent'
                }`}
              >
                <UserPlus className="h-4 w-4" />
                <span>Requests</span>
                {incomingRequests.length > 0 && (
                  <span className="bg-secondary-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {incomingRequests.length}
                  </span>
                )}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setActiveTab('outgoing')}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl font-medium transition-all ${
                  activeTab === 'outgoing'
                    ? 'bg-secondary-500/20 text-secondary-400 border border-secondary-500/50'
                    : 'bg-surface-800/50 text-surface-400 hover:text-white border border-transparent'
                }`}
              >
                <Clock className="h-4 w-4" />
                <span>Sent ({outgoingRequests.length})</span>
              </motion.button>
            </div>
          </FadeIn>

          {/* Error with retry */}
          <AnimatePresence>
            {friendError && !friendsLoading && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mb-6"
              >
                <ErrorState
                  error={friendError}
                  errorType={ErrorType.NETWORK}
                  onRetry={refreshFriends}
                  size="sm"
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Friends List */}
          <AnimatePresence mode="wait">
            {activeTab === 'friends' && (
              <FadeIn key="friends">
                <Card variant="glass" className="overflow-hidden">
                  {friendsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      >
                        <Loader2 className="h-8 w-8 text-secondary-400" />
                      </motion.div>
                    </div>
                  ) : friends.length === 0 ? (
                    <div className="text-center py-12 text-surface-400">
                      <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p className="mb-4">No friends yet</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => router.push('/players')}
                      >
                        Find Players
                      </Button>
                    </div>
                  ) : (
                    <div className="divide-y divide-surface-700/50">
                      {[...friends].sort((a, b) => (b.rating || 1000) - (a.rating || 1000)).map((friend, index) => {
                        const rank = getRankTier(friend.rating || 1000);

                        return (
                          <motion.div
                            key={friend.id}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.05 }}
                            className="flex items-center justify-between p-4 hover:bg-surface-800/50 transition-all"
                          >
                            <div
                              className="flex items-center space-x-4 cursor-pointer flex-1"
                              onClick={() => router.push(`/profile/${friend.username}`)}
                            >
                              {/* Avatar */}
                              <motion.div
                                whileHover={{ scale: 1.1 }}
                                className="relative"
                              >
                                <AvatarDisplay user={friend} size="lg" />
                                {!!friend.is_online && (
                                  <span className="absolute bottom-0 right-0 w-3 h-3 bg-success rounded-full border-2 border-surface-900"></span>
                                )}
                              </motion.div>

                              {/* User info */}
                              <div>
                                <div className="flex items-center space-x-2">
                                  <span className="font-medium">{friend.username}</span>
                                  {!!friend.is_online && (
                                    <span className="text-xs text-success">Online</span>
                                  )}
                                </div>
                                <div className="flex items-center space-x-2 text-sm text-surface-400">
                                  <span className={rank.color}>{rank.name}</span>
                                  <span className="text-surface-600">·</span>
                                  <span className="text-white font-medium">{friend.rating || 1000}</span>
                                  <span className="text-surface-600">|</span>
                                  <span>{friend.wins || 0}W - {friend.losses || 0}L</span>
                                </div>
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center space-x-2">
                              <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleMessage(friend.id)}
                                className="p-2 text-surface-400 hover:text-white hover:bg-surface-700/50 rounded-xl transition-colors"
                                title="Message"
                              >
                                <MessageCircle className="h-5 w-5" />
                              </motion.button>
                              <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleChallenge(friend.id)}
                                disabled={actionLoading[`challenge-${friend.id}`]}
                                className={`p-2 rounded-xl transition-colors ${
                                  challengeSent === friend.id
                                    ? 'text-success bg-success/20'
                                    : 'text-surface-400 hover:text-primary-400 hover:bg-primary-500/20'
                                } disabled:opacity-50`}
                                title={challengeSent === friend.id ? 'Challenge sent!' : 'Challenge'}
                              >
                                {actionLoading[`challenge-${friend.id}`] ? (
                                  <Loader2 className="h-5 w-5 animate-spin" />
                                ) : challengeSent === friend.id ? (
                                  <Check className="h-5 w-5" />
                                ) : (
                                  <Swords className="h-5 w-5" />
                                )}
                              </motion.button>
                              <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleRemoveFriendAction(friend.id)}
                                disabled={actionLoading[`remove-${friend.id}`]}
                                className={`p-2 rounded-xl transition-colors ${
                                  confirmRemove === friend.id
                                    ? 'text-danger bg-danger/20'
                                    : 'text-surface-400 hover:text-danger hover:bg-danger/20'
                                } disabled:opacity-50`}
                                title={confirmRemove === friend.id ? 'Click again to confirm' : 'Remove friend'}
                              >
                                {actionLoading[`remove-${friend.id}`] ? (
                                  <Loader2 className="h-5 w-5 animate-spin" />
                                ) : (
                                  <UserMinus className="h-5 w-5" />
                                )}
                              </motion.button>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </FadeIn>
            )}

            {/* Incoming Requests */}
            {activeTab === 'incoming' && (
              <FadeIn key="incoming">
                <Card variant="glass" className="overflow-hidden">
                  {incomingRequests.length === 0 ? (
                    <div className="text-center py-12 text-surface-400">
                      <UserPlus className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No pending friend requests</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-surface-700/50">
                      {incomingRequests.map((request, index) => {
                        const rank = getRankTier(request.requester_rating || 1000);

                        return (
                          <motion.div
                            key={request.id}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.05 }}
                            className="flex items-center justify-between p-4 hover:bg-surface-800/50 transition-all"
                          >
                            <div
                              className="flex items-center space-x-4 cursor-pointer flex-1"
                              onClick={() => router.push(`/profile/${request.requester_username}`)}
                            >
                              {/* Avatar */}
                              <motion.div
                                whileHover={{ scale: 1.1 }}
                              >
                                <AvatarDisplay avatar={request.requester_avatar} avatarUrl={request.requester_avatar_url} size="lg" />
                              </motion.div>

                              {/* User info */}
                              <div>
                                <div className="font-medium">{request.requester_username}</div>
                                <div className="flex items-center space-x-2 text-sm text-surface-400">
                                  <span className={rank.color}>{rank.name}</span>
                                  <span className="text-surface-600">|</span>
                                  <span>{request.requester_wins || 0}W - {request.requester_losses || 0}L</span>
                                </div>
                              </div>
                            </div>

                            {/* Accept/Decline */}
                            <div className="flex items-center space-x-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeclineRequest(request.id)}
                                disabled={actionLoading[`decline-${request.id}`] || actionLoading[`accept-${request.id}`]}
                                loading={actionLoading[`decline-${request.id}`]}
                                icon={actionLoading[`decline-${request.id}`] ? undefined : X}
                              >
                                Decline
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleAcceptRequest(request.id)}
                                disabled={actionLoading[`accept-${request.id}`] || actionLoading[`decline-${request.id}`]}
                                loading={actionLoading[`accept-${request.id}`]}
                                icon={actionLoading[`accept-${request.id}`] ? undefined : Check}
                              >
                                Accept
                              </Button>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </FadeIn>
            )}

            {/* Outgoing Requests */}
            {activeTab === 'outgoing' && (
              <FadeIn key="outgoing">
                <Card variant="glass" className="overflow-hidden">
                  {outgoingRequests.length === 0 ? (
                    <div className="text-center py-12 text-surface-400">
                      <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No pending sent requests</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-surface-700/50">
                      {outgoingRequests.map((request, index) => (
                        <motion.div
                          key={request.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.05 }}
                          className="flex items-center justify-between p-4 hover:bg-surface-800/50 transition-all"
                        >
                          <div
                            className="flex items-center space-x-4 cursor-pointer flex-1"
                            onClick={() => router.push(`/profile/${request.requested_username}`)}
                          >
                            {/* Avatar */}
                            <motion.div
                              whileHover={{ scale: 1.1 }}
                            >
                              <AvatarDisplay avatar={request.requested_avatar} avatarUrl={request.requested_avatar_url} size="lg" />
                            </motion.div>

                            {/* User info */}
                            <div>
                              <div className="font-medium">{request.requested_username}</div>
                              <div className="text-sm text-surface-500">Waiting for response...</div>
                            </div>
                          </div>

                          {/* Cancel */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCancelRequest(request.id)}
                            disabled={actionLoading[`cancel-${request.id}`]}
                            loading={actionLoading[`cancel-${request.id}`]}
                            icon={actionLoading[`cancel-${request.id}`] ? undefined : X}
                          >
                            Cancel
                          </Button>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </Card>
              </FadeIn>
            )}
          </AnimatePresence>

          {/* Find Players Link */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-6 text-center"
          >
            <Link
              href="/players"
              className="text-surface-400 hover:text-white text-sm transition-colors"
            >
              Looking for more players? Browse the leaderboard
            </Link>
          </motion.div>
        </div>
      </div>
    </>
  );
}

export default withAuth(FriendsPage);
