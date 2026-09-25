import React, { useEffect } from 'react';
import { X, Check, Clock, Loader2, AlertCircle } from 'lucide-react';
import { useChallenge } from '../contexts/ChallengeContext';

export default function ChallengeModals() {
  const {
    incomingChallenge,
    outgoingChallenge,
    challengeError,
    timeRemaining,
    acceptChallenge,
    declineChallenge,
    cancelChallenge,
    clearError
  } = useChallenge();

  // Lock body scroll when modal is open
  useEffect(() => {
    if (incomingChallenge || outgoingChallenge) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [incomingChallenge, outgoingChallenge]);

  // Incoming challenge modal
  if (incomingChallenge) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 touch-none" role="dialog" aria-label={`Challenge from ${incomingChallenge.challenger.username}`} aria-modal="true">
        <div className="bg-surface-800 border border-surface-600 rounded-2xl max-w-md w-full overflow-hidden">
          {/* Header */}
          <div className="bg-surface-900/50 p-6 text-center">
            <h2 className="text-2xl font-bold text-white">Challenge Received</h2>
          </div>

          <div className="p-6">
            {/* Challenger info */}
            <div className="flex items-center space-x-4 mb-6">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center text-3xl">
                {incomingChallenge.challenger.avatar?.startsWith('gaming') ? 'G' :
                 incomingChallenge.challenger.avatar?.startsWith('dev') ? 'D' : 'U'}
              </div>
              <div>
                <div className="text-xl font-bold text-white">
                  {incomingChallenge.challenger.username}
                </div>
                <div className="text-gray-400 text-sm">
                  Rating: {incomingChallenge.challenger.rating} |
                  W: {incomingChallenge.challenger.wins} L: {incomingChallenge.challenger.losses}
                </div>
              </div>
            </div>

            {/* Timer */}
            <div className="bg-slate-700/50 rounded-lg p-4 mb-6 text-center">
              <div className="flex items-center justify-center space-x-2 text-yellow-400">
                <Clock className="h-5 w-5" aria-hidden="true" />
                <span className="text-2xl font-mono font-bold">{timeRemaining}s</span>
              </div>
              <p className="text-gray-400 text-sm mt-1">Time to respond</p>
            </div>

            {/* Action buttons */}
            <div className="flex space-x-3">
              <button
                onClick={() => declineChallenge(incomingChallenge.id)}
                className="flex-1 flex items-center justify-center space-x-2 bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-gray-300 py-3.5 min-h-[48px] rounded-lg transition-colors"
                aria-label={`Decline challenge from ${incomingChallenge.challenger.username}`}
              >
                <X className="h-5 w-5" aria-hidden="true" />
                <span>Decline</span>
              </button>
              <button
                onClick={() => acceptChallenge(incomingChallenge.id)}
                className="flex-1 flex items-center justify-center space-x-2 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 active:from-green-600 active:to-emerald-700 text-white py-3.5 min-h-[48px] rounded-lg transition-all transform hover:scale-105 active:scale-100 font-bold"
                aria-label={`Accept challenge from ${incomingChallenge.challenger.username}`}
              >
                <Check className="h-5 w-5" aria-hidden="true" />
                <span>Accept</span>
              </button>
            </div>
          </div>
        </div>

        <style jsx>{`
          @keyframes pulse-border {
            0%, 100% { border-color: rgba(168, 85, 247, 0.5); }
            50% { border-color: rgba(236, 72, 153, 0.8); }
          }
          .animate-pulse-border {
            animation: pulse-border 2s ease-in-out infinite;
          }
        `}</style>
      </div>
    );
  }

  // Outgoing challenge modal (waiting for response)
  if (outgoingChallenge) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 touch-none" role="dialog" aria-label={`Waiting for ${outgoingChallenge.challenged.username} to respond`} aria-modal="true">
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-cyan-500/50 rounded-2xl max-w-md w-full overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-cyan-600 to-blue-600 p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-white/20 flex items-center justify-center">
              <Loader2 className="h-8 w-8 text-white animate-spin" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-bold text-white">Challenge Sent!</h2>
          </div>

          <div className="p-6">
            {/* Challenged user info */}
            <div className="flex items-center justify-center space-x-4 mb-6">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center text-2xl">
                {outgoingChallenge.challenged.avatar?.startsWith('gaming') ? 'G' :
                 outgoingChallenge.challenged.avatar?.startsWith('dev') ? 'D' : 'U'}
              </div>
              <div className="text-lg font-medium text-white">
                Waiting for <span className="text-cyan-400">{outgoingChallenge.challenged.username}</span>
              </div>
            </div>

            {/* Timer */}
            <div className="bg-slate-700/50 rounded-lg p-4 mb-6 text-center">
              <div className="flex items-center justify-center space-x-2 text-cyan-400">
                <Clock className="h-5 w-5" aria-hidden="true" />
                <span className="text-2xl font-mono font-bold">{timeRemaining}s</span>
              </div>
              <p className="text-gray-400 text-sm mt-1">Expires in</p>
            </div>

            {/* Waiting animation */}
            <div className="flex justify-center space-x-2 mb-6">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-3 h-3 bg-cyan-400 rounded-full animate-bounce"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>

            {/* Cancel button */}
            <button
              onClick={() => cancelChallenge(outgoingChallenge.challengeId)}
              className="w-full flex items-center justify-center space-x-2 bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-gray-300 py-3.5 min-h-[48px] rounded-lg transition-colors"
              aria-label={`Cancel challenge to ${outgoingChallenge.challenged.username}`}
            >
              <X className="h-5 w-5" aria-hidden="true" />
              <span>Cancel Challenge</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Error toast
  if (challengeError) {
    return (
      <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-50 animate-slide-up">
        <div className="bg-red-900/90 border border-red-500 rounded-lg p-4 flex items-center space-x-3 shadow-lg max-w-sm mx-auto sm:mx-0" role="alert">
          <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" aria-hidden="true" />
          <span className="text-white text-sm flex-1">{challengeError}</span>
          <button
            onClick={clearError}
            className="text-red-400 hover:text-white active:text-red-200 transition-colors p-1 min-w-[32px] min-h-[32px] flex items-center justify-center"
            aria-label="Dismiss error"
          >
            <X className="h-5 w-5" aria-hidden="true" />
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
