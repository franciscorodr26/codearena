import React, { useState, useEffect, useCallback } from 'react';
import { Search, Users, X, Loader2, UserPlus, Clock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useChallenge } from '../contexts/ChallengeContext';
import { useFriends } from '../contexts/FriendContext';
import { config } from '../config/env';
import AvatarDisplay from './ui/AvatarDisplay';

export default function PlayerInvitePanel({ onClose, ranked = false }) {
  const { token, user } = useAuth();
  const { sendChallenge, outgoingChallenge, cancelChallenge, timeRemaining } = useChallenge();
  const { friends, refreshFriends } = useFriends();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeTab, setActiveTab] = useState('friends'); // 'friends' or 'search'

  // Refresh friends list on mount to get fresh online status
  useEffect(() => {
    refreshFriends();
  }, [refreshFriends]);

  // Get online friends
  const onlineFriends = friends.filter(f => f.is_online);

  // Search for online users
  const searchOnlineUsers = useCallback(async (query) => {
    if (!token) return;

    setIsSearching(true);
    try {
      const res = await fetch(
        `${config.backend_url}/api/users/online?search=${encodeURIComponent(query)}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      const data = await res.json();
      if (data.success) {
        setSearchResults(data.users);
      }
    } catch (err) {
      console.error('Failed to search users:', err);
    } finally {
      setIsSearching(false);
    }
  }, [token]);

  // Debounced search
  useEffect(() => {
    if (activeTab !== 'search') return;

    const timer = setTimeout(() => {
      searchOnlineUsers(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, activeTab, searchOnlineUsers]);

  // Load initial online users when switching to search tab
  useEffect(() => {
    if (activeTab === 'search' && searchResults.length === 0) {
      searchOnlineUsers('');
    }
  }, [activeTab, searchOnlineUsers, searchResults.length]);

  const handleInvite = (userId) => {
    sendChallenge(userId, { ranked });
  };

  const renderUserCard = (user, isFriend = false) => {
    const isPending = outgoingChallenge?.challenged?.id === user.id;

    return (
      <div
        key={user.id}
        className="flex items-center justify-between p-3 bg-surface-800/50 rounded-lg hover:bg-surface-700/50 active:bg-surface-700 transition-colors gap-2"
      >
        <div className="flex items-center space-x-3 min-w-0 flex-1">
          <div className="relative flex-shrink-0">
            <AvatarDisplay user={user} size="md" />
            {/* Online indicator */}
            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 border-2 border-surface-800 rounded-full" title="Online" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-white flex items-center gap-1.5 flex-wrap">
              <span className="truncate max-w-[120px] sm:max-w-[150px]">{user.username}</span>
              <span className="flex items-center gap-1 text-xs text-green-400 flex-shrink-0">
                <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                <span className="hidden xs:inline">Online</span>
              </span>
              {isFriend && (
                <span className="text-xs bg-primary-500/20 text-primary-400 px-1.5 py-0.5 rounded flex-shrink-0">
                  Friend
                </span>
              )}
            </div>
            <div className="text-xs text-surface-400 truncate">
              {user.rating || 1000} • {user.wins || 0}W / {user.losses || 0}L
            </div>
          </div>
        </div>

        {isPending ? (
          <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">
            <div className="flex items-center space-x-1 text-primary-400 text-sm">
              <Clock className="h-4 w-4" />
              <span>{timeRemaining}s</span>
            </div>
            <button
              onClick={() => cancelChallenge(outgoingChallenge.challengeId)}
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-surface-400 hover:text-red-400 active:text-red-500 transition-colors"
              title="Cancel invite"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => handleInvite(user.id)}
            disabled={!!outgoingChallenge}
            className="flex items-center justify-center space-x-1 px-3 py-2 min-h-[44px] bg-primary-600 hover:bg-primary-500 active:bg-primary-700 disabled:bg-surface-700 disabled:text-surface-500 text-white text-sm rounded-lg transition-colors flex-shrink-0"
          >
            <UserPlus className="h-4 w-4" />
            <span className="hidden xs:inline">Invite</span>
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="bg-surface-900/90 border border-surface-700 rounded-xl p-4 w-full max-w-md">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-primary-400" />
          Invite to Battle
        </h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-surface-400 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex space-x-2 mb-4">
        <button
          onClick={() => setActiveTab('friends')}
          className={`flex-1 flex items-center justify-center space-x-1.5 sm:space-x-2 py-2.5 min-h-[44px] rounded-lg transition-colors ${
            activeTab === 'friends'
              ? 'bg-primary-600 text-white'
              : 'bg-surface-800 text-surface-400 hover:text-white active:bg-surface-700'
          }`}
        >
          <Users className="h-4 w-4" />
          <span className="text-sm sm:text-base">Friends</span>
          {onlineFriends.length > 0 && (
            <span className="bg-green-500 text-white text-xs px-1.5 py-0.5 rounded-full">
              {onlineFriends.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('search')}
          className={`flex-1 flex items-center justify-center space-x-1.5 sm:space-x-2 py-2.5 min-h-[44px] rounded-lg transition-colors ${
            activeTab === 'search'
              ? 'bg-primary-600 text-white'
              : 'bg-surface-800 text-surface-400 hover:text-white active:bg-surface-700'
          }`}
        >
          <Search className="h-4 w-4" />
          <span className="text-sm sm:text-base">Find Players</span>
        </button>
      </div>

      {/* Search input (only in search tab) */}
      {activeTab === 'search' && (
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-500" />
          <input
            type="text"
            placeholder="Search online players..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 text-base bg-surface-800 border border-surface-700 rounded-lg text-white placeholder-surface-500 focus:outline-none focus:border-primary-500"
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary-400 animate-spin" />
          )}
        </div>
      )}

      {/* User list - responsive height with scroll */}
      <div className="space-y-2 max-h-48 sm:max-h-64 overflow-y-auto overscroll-contain touch-pan-y -mx-1 px-1 pb-1">
        {activeTab === 'friends' ? (
          onlineFriends.length > 0 ? (
            onlineFriends.map(friend => renderUserCard(friend, true))
          ) : (
            <div className="text-center py-6 text-surface-400">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No friends online</p>
              <p className="text-sm mt-1">Try searching for other players</p>
            </div>
          )
        ) : (
          searchResults.length > 0 ? (
            searchResults.map(user => renderUserCard(user, user.is_friend))
          ) : isSearching ? (
            <div className="text-center py-6 text-surface-400">
              <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin" />
              <p>Searching...</p>
            </div>
          ) : (
            <div className="text-center py-6 text-surface-400">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No online players found</p>
              <p className="text-sm mt-1">Try a different search</p>
            </div>
          )
        )}
      </div>

      {/* Pending invite indicator */}
      {outgoingChallenge && (
        <div className="mt-4 p-3 bg-primary-500/10 border border-primary-500/30 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Loader2 className="h-4 w-4 text-primary-400 animate-spin" />
              <span className="text-primary-400 text-sm">
                Waiting for {outgoingChallenge.challenged?.username}...
              </span>
            </div>
            <span className="text-primary-300 text-sm font-mono">{timeRemaining}s</span>
          </div>
        </div>
      )}
    </div>
  );
}
