import React from 'react';
import { UserPlus, X, Check, AlertCircle, Users } from 'lucide-react';
import { useFriends } from '../contexts/FriendContext';
import AvatarDisplay from './ui/AvatarDisplay';

export default function FriendRequestModal() {
  const {
    latestRequest,
    friendError,
    acceptRequest,
    declineRequest,
    clearLatestRequest,
    clearError
  } = useFriends();

  // Incoming friend request notification
  if (latestRequest) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-blue-500/50 rounded-2xl max-w-md w-full overflow-hidden animate-pulse-border">
          {/* Header with animated gradient */}
          <div className="bg-gradient-to-r from-blue-600 to-cyan-600 p-6 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-600/50 to-cyan-600/50 animate-pulse"></div>
            <div className="relative">
              <UserPlus className="h-12 w-12 mx-auto mb-3 text-white animate-bounce" />
              <h2 className="text-2xl font-bold text-white">Friend Request!</h2>
            </div>
          </div>

          <div className="p-6">
            {/* Requester info */}
            <div className="flex items-center space-x-4 mb-6">
              <AvatarDisplay user={latestRequest.requester} size="xl" />
              <div>
                <div className="text-xl font-bold text-white">
                  {latestRequest.requester.username}
                </div>
                <div className="text-gray-400 text-sm">
                  Rating: {latestRequest.requester.rating} |
                  W: {latestRequest.requester.wins} L: {latestRequest.requester.losses}
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="bg-slate-700/50 rounded-lg p-4 mb-6 text-center">
              <div className="flex items-center justify-center space-x-2 text-blue-400">
                <Users className="h-5 w-5" />
                <span className="text-sm">wants to be your friend</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  declineRequest(latestRequest.id);
                  clearLatestRequest();
                }}
                className="flex-1 flex items-center justify-center space-x-2 bg-slate-700 hover:bg-slate-600 text-gray-300 py-3 rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
                <span>Decline</span>
              </button>
              <button
                onClick={() => {
                  acceptRequest(latestRequest.id);
                  clearLatestRequest();
                }}
                className="flex-1 flex items-center justify-center space-x-2 bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-400 hover:to-cyan-500 text-white py-3 rounded-lg transition-all transform hover:scale-105 font-bold"
              >
                <Check className="h-5 w-5" />
                <span>Accept</span>
              </button>
            </div>

            {/* Dismiss button */}
            <button
              onClick={clearLatestRequest}
              className="w-full mt-3 text-gray-400 hover:text-white text-sm transition-colors"
            >
              Decide later
            </button>
          </div>
        </div>

        <style jsx>{`
          @keyframes pulse-border {
            0%, 100% { border-color: rgba(59, 130, 246, 0.5); }
            50% { border-color: rgba(6, 182, 212, 0.8); }
          }
          .animate-pulse-border {
            animation: pulse-border 2s ease-in-out infinite;
          }
        `}</style>
      </div>
    );
  }

  // Error toast
  if (friendError) {
    return (
      <div className="fixed bottom-6 right-6 z-50 animate-slide-up">
        <div className="bg-red-900/90 border border-red-500 rounded-lg p-4 flex items-center space-x-3 shadow-lg max-w-sm">
          <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
          <span className="text-white text-sm">{friendError}</span>
          <button
            onClick={clearError}
            className="text-red-400 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <style jsx>{`
          @keyframes slide-up {
            from { transform: translateY(100%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
          .animate-slide-up {
            animation: slide-up 0.3s ease-out;
          }
        `}</style>
      </div>
    );
  }

  return null;
}
