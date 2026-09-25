import { useState, useCallback, useRef } from 'react';

/**
 * Hook for managing rematch functionality
 * Includes rematch status, requester info, and timer management
 */
export function useRematch() {
  const [rematchStatus, setRematchStatus] = useState(null);
  const [rematchRequester, setRematchRequester] = useState(null);
  const [rematchTimeLeft, setRematchTimeLeft] = useState(0);

  const rematchTimerRef = useRef(null);

  const startRematchTimer = useCallback((duration = 30000) => {
    if (rematchTimerRef.current) clearInterval(rematchTimerRef.current);
    setRematchTimeLeft(Math.floor(duration / 1000));
    rematchTimerRef.current = setInterval(() => {
      setRematchTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(rematchTimerRef.current);
          rematchTimerRef.current = null;
          setRematchStatus('expired');
          setRematchRequester(null);
          // Auto-reset after showing expired message
          setTimeout(() => {
            setRematchStatus(current => current === 'expired' ? null : current);
          }, 3000);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const stopRematchTimer = useCallback(() => {
    if (rematchTimerRef.current) {
      clearInterval(rematchTimerRef.current);
      rematchTimerRef.current = null;
    }
    setRematchTimeLeft(0);
  }, []);

  const resetRematchState = useCallback(() => {
    setRematchStatus(null);
    setRematchRequester(null);
    if (rematchTimerRef.current) {
      clearInterval(rematchTimerRef.current);
      rematchTimerRef.current = null;
    }
    setRematchTimeLeft(0);
  }, []);

  const cleanupRematch = useCallback(() => {
    if (rematchTimerRef.current) {
      clearInterval(rematchTimerRef.current);
      rematchTimerRef.current = null;
    }
  }, []);

  return {
    rematchStatus, setRematchStatus,
    rematchRequester, setRematchRequester,
    rematchTimeLeft, setRematchTimeLeft,
    rematchTimerRef,
    startRematchTimer,
    stopRematchTimer,
    resetRematchState,
    cleanupRematch
  };
}

export default useRematch;
