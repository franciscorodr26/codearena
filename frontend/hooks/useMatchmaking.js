import { useState, useCallback, useRef } from 'react';

/**
 * Hook for managing matchmaking and ready state
 * Includes matchmaking flags, ready status, and pre-battle screen state
 */
export function useMatchmaking() {
  // Matchmaking flags
  const [isFromMatchmaking, setIsFromMatchmaking] = useState(false);
  const [skipLanguageSelection, setSkipLanguageSelection] = useState(false);

  // Ready state
  const [allPlayersReady, setAllPlayersReady] = useState(false);
  const [canStartBattle, setCanStartBattle] = useState(false);

  // Button states
  const [readyButtonState, setReadyButtonState] = useState('idle');
  const [startButtonState, setStartButtonState] = useState('idle');

  // Pre-battle screen state
  const [showPreBattleScreen, setShowPreBattleScreen] = useState(false);
  const [preloadProgress, setPreloadProgress] = useState(0);
  const [battlePhase, setBattlePhase] = useState('');
  const [countdownNumber, setCountdownNumber] = useState(3);

  // Refs for intervals
  const countdownIntervalRef = useRef(null);
  const loadingIntervalRef = useRef(null);

  // Reset all matchmaking state
  const resetMatchmakingState = useCallback(() => {
    setIsFromMatchmaking(false);
    setSkipLanguageSelection(false);
    setAllPlayersReady(false);
    setCanStartBattle(false);
    setReadyButtonState('idle');
    setStartButtonState('idle');
    setShowPreBattleScreen(false);
    setPreloadProgress(0);
    setBattlePhase('');
    setCountdownNumber(3);
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    if (loadingIntervalRef.current) {
      clearInterval(loadingIntervalRef.current);
      loadingIntervalRef.current = null;
    }
  }, []);

  const cleanupMatchmaking = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    if (loadingIntervalRef.current) {
      clearInterval(loadingIntervalRef.current);
      loadingIntervalRef.current = null;
    }
  }, []);

  return {
    isFromMatchmaking, setIsFromMatchmaking,
    skipLanguageSelection, setSkipLanguageSelection,
    allPlayersReady, setAllPlayersReady,
    canStartBattle, setCanStartBattle,
    readyButtonState, setReadyButtonState,
    startButtonState, setStartButtonState,
    showPreBattleScreen, setShowPreBattleScreen,
    preloadProgress, setPreloadProgress,
    battlePhase, setBattlePhase,
    countdownNumber, setCountdownNumber,
    countdownIntervalRef,
    loadingIntervalRef,
    resetMatchmakingState,
    cleanupMatchmaking
  };
}

export default useMatchmaking;
