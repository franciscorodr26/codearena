import React, { useState, useEffect } from 'react';
import { Search, Users, Clock, X, Code, Bell } from 'lucide-react';

const PlayWhileYouWait = ({
  onStartPractice,
  onDismiss = () => {},
  queueTime = 0,
  playersInQueue = 1,
  isSearching = true,
  playerName = '',
  selectedLanguage = 'python'
}) => {
  const [showPulse, setShowPulse] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setShowPulse(prev => !prev);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="relative max-w-lg w-full">
        {/* Main card - much more compact */}
        <div className="relative bg-gradient-to-br from-slate-800 to-slate-900 border-2 border-orange-400/50 rounded-xl shadow-2xl shadow-orange-400/20 overflow-hidden">
          {/* Top accent bar */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-orange-400 via-red-500 to-pink-500"></div>

          <div className="p-6">
            {/* Compact header with icon inline */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className={`w-12 h-12 bg-gradient-to-br from-orange-500 to-red-600 rounded-full flex items-center justify-center transition-all duration-500 ${showPulse ? 'scale-110 shadow-xl shadow-orange-500/50' : 'scale-100'}`}>
                  <Users className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Nobody's Here Yet!</h2>
                  <p className="text-sm text-gray-400">Practice while we search</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onDismiss}
                className="text-gray-400 hover:text-white transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Player info - compact version */}
            {playerName && (
              <div className="bg-slate-700/40 rounded-lg p-3 mb-4 flex items-center space-x-3">
                <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <Users className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-400">Searching as</div>
                  <div className="font-bold text-white truncate">{playerName}</div>
                </div>
                <div className="text-xs text-cyan-400 font-medium">
                  {selectedLanguage.charAt(0).toUpperCase() + selectedLanguage.slice(1)}
                </div>
              </div>
            )}

            {/* Compact queue status */}
            <div className="bg-slate-700/40 rounded-lg p-3 mb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <div className="relative">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    <div className="absolute inset-0 w-2 h-2 bg-green-400 rounded-full animate-ping"></div>
                  </div>
                  <span className="text-xs font-bold text-green-400">SEARCHING</span>
                </div>
                <div className="flex items-center space-x-1.5 text-cyan-400">
                  <Clock className="h-3.5 w-3.5" />
                  <span className="font-mono text-sm font-bold">
                    {Math.floor(queueTime / 60)}:{(queueTime % 60).toString().padStart(2, '0')}
                  </span>
                </div>
              </div>
              
              <div className="h-1 bg-slate-600 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-cyan-400 via-purple-500 to-pink-500 rounded-full animate-pulse" style={{ width: '100%' }}></div>
              </div>
            </div>

            {/* Compact "what happens next" - single line items */}
            <div className="space-y-2 mb-4">
              <div className="flex items-center space-x-2 text-sm">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center flex-shrink-0">
                  <Code className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="text-gray-300">Practice while we find your match</span>
              </div>
              
              <div className="flex items-center space-x-2 text-sm">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center flex-shrink-0">
                  <Bell className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="text-gray-300">Get notified instantly when matched</span>
              </div>
              
              <div className="flex items-center space-x-2 text-sm">
                <div className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />
                <span className="text-gray-300">Battle launches automatically</span>
              </div>
            </div>

            {/* CTA Button - more compact */}
            <button
              onClick={onStartPractice}
              className="w-full bg-primary-500 hover:bg-primary-400 px-5 py-3 rounded-lg font-semibold text-base text-white transition-colors"
            >
              Start Practicing Now
            </button>

            {/* Compact status message */}
            <div className="text-center mt-3">
              <div className="inline-flex items-center space-x-1.5 text-xs text-green-400">
                <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
                <span>Queue stays active while you practice</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlayWhileYouWait;