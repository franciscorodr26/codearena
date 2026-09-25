// frontend/components/ImprovedMatchFoundNotification.jsx
import React, { useState, useEffect, useRef } from 'react';
import { X, Ban, AlertCircle } from 'lucide-react';

export const ImprovedMatchFoundNotification = ({ 
  opponentName = "Anonymous",
  yourName = "You",
  onAccept,
  onDecline,
  onDeclineAndStay,
  autoAcceptTime = 30
}) => {
  const [timeRemaining, setTimeRemaining] = useState(autoAcceptTime);
  const [isPaused, setIsPaused] = useState(false);
  const startTimeRef = useRef(null);
  const animationFrameRef = useRef(null);
  const hasAutoAcceptedRef = useRef(false);

  useEffect(() => {
    if (startTimeRef.current === null) {
      startTimeRef.current = Date.now();
    }

    if (isPaused || hasAutoAcceptedRef.current) return;

    const updateTimer = () => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const remaining = Math.max(0, autoAcceptTime - elapsed);
      
      setTimeRemaining(remaining);

      if (remaining <= 0 && !hasAutoAcceptedRef.current) {
        hasAutoAcceptedRef.current = true;
        onAccept();
        return;
      }

      animationFrameRef.current = requestAnimationFrame(updateTimer);
    };

    animationFrameRef.current = requestAnimationFrame(updateTimer);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPaused, onAccept, autoAcceptTime]);

  const progressPercent = Math.max(0, Math.min(100, (timeRemaining / autoAcceptTime) * 100));
  const displaySeconds = Math.ceil(timeRemaining);
  
  const getProgressColor = () => {
    if (progressPercent > 66) return 'from-emerald-400 via-emerald-500 to-green-500';
    if (progressPercent > 33) return 'from-yellow-400 via-amber-500 to-orange-500';
    return 'from-orange-500 via-red-500 to-red-600';
  };

  const getUrgencyStyle = () => {
    if (displaySeconds <= 5) return 'animate-pulse scale-110';
    if (displaySeconds <= 10) return 'animate-bounce';
    return '';
  };

  const handleAction = (action) => {
    setIsPaused(true);
    hasAutoAcceptedRef.current = true;
    action();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-40 animate-in fade-in duration-300" />
      
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-surface-800 border border-surface-600 rounded-2xl shadow-xl max-w-lg w-full relative overflow-hidden">
          <div className="relative p-8">
            <div className="text-center mb-6">
              <h2 className="text-3xl font-bold text-white mb-2">
                Match Found
              </h2>
              <p className="text-surface-300 text-sm">
                An opponent is ready to battle
              </p>
            </div>

            <div className="bg-surface-900/50 rounded-xl p-5 mb-6 border border-surface-700">
              <div className="flex items-center justify-between">
                <div className="flex-1 text-center">
                  <p className="text-surface-400 text-xs font-medium mb-2 uppercase tracking-wider">You</p>
                  <p className="text-xl font-bold text-white truncate px-2">{yourName}</p>
                </div>

                <div className="px-4">
                  <span className="text-sm font-medium text-surface-500">vs</span>
                </div>

                <div className="flex-1 text-center">
                  <p className="text-surface-400 text-xs font-medium mb-2 uppercase tracking-wider">Opponent</p>
                  <p className="text-xl font-bold text-white truncate px-2">{opponentName}</p>
                </div>
              </div>
            </div>

            <div className="mb-6">
              <div className="bg-surface-900/50 rounded-xl p-5 border border-surface-700">
                <div className="flex items-center justify-center space-x-3 mb-4">
                  <p className="text-white text-sm font-medium">
                    Auto-accepting in{' '}
                    <span className="inline-block text-xl font-bold">
                      {displaySeconds}s
                    </span>
                  </p>
                </div>

                <div className="relative h-2 bg-surface-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      progressPercent > 66 ? 'bg-success' : progressPercent > 33 ? 'bg-warning' : 'bg-danger'
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => handleAction(onAccept)}
                className="w-full bg-primary-500 hover:bg-primary-400 text-white font-semibold px-6 py-4 rounded-xl transition-colors flex items-center justify-center space-x-3"
              >
                <span className="text-lg">Accept Battle</span>
              </button>

              <button
                onClick={() => handleAction(onDeclineAndStay)}
                className="w-full bg-surface-700/50 hover:bg-surface-700 border border-surface-600 text-surface-200 font-medium px-5 py-3 rounded-xl transition-colors flex items-center justify-center space-x-2"
              >
                <span>Skip & Keep Searching</span>
              </button>

              <button
                onClick={() => handleAction(onDecline)}
                className="w-full bg-surface-800/50 hover:bg-surface-800 border border-surface-700 text-surface-400 hover:text-white font-medium px-5 py-3 rounded-xl transition-colors flex items-center justify-center space-x-2"
              >
                <X className="h-4 w-4" />
                <span>Leave Queue</span>
              </button>
            </div>

            <div className="mt-5 text-center">
              <p className="text-slate-400 text-xs leading-relaxed">
                Battle starts automatically if no action taken
              </p>
            </div>
          </div>
        </div>
      </div>

    </>
  );
};

export default ImprovedMatchFoundNotification;