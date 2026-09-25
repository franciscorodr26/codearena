import { useState, useCallback } from 'react';

/**
 * Hook for managing battle result state
 * Includes winner info, timing, performance data, and violations
 */
export function useBattleResult() {
  // Winner state
  const [winner, setWinner] = useState(null);
  const [winnerName, setWinnerName] = useState('');
  const [loserName, setLoserName] = useState('');
  const [isTie, setIsTie] = useState(false);
  const [isPartialCredit, setIsPartialCredit] = useState(false);
  const [partialCreditData, setPartialCreditData] = useState(null);

  // Timing state
  const [battleStartTime, setBattleStartTime] = useState(null);
  const [solveTime, setSolveTime] = useState(null);

  // Performance state
  const [performanceData, setPerformanceData] = useState(null);

  // Violations state
  const [battleViolations, setBattleViolations] = useState(null);

  // Rating changes from server
  const [ratingChanges, setRatingChanges] = useState(null);

  // Players' code shown after battle ends
  const [finishedPlayerCode, setFinishedPlayerCode] = useState(null);
  const [finishedOpponentCode, setFinishedOpponentCode] = useState(null);
  const [finishedPlayerLanguage, setFinishedPlayerLanguage] = useState(null);
  const [finishedOpponentLanguage, setFinishedOpponentLanguage] = useState(null);

  // Reset all result state
  const resetResultState = useCallback(() => {
    setWinner(null);
    setWinnerName('');
    setLoserName('');
    setIsTie(false);
    setIsPartialCredit(false);
    setPartialCreditData(null);
    setBattleStartTime(null);
    setSolveTime(null);
    setPerformanceData(null);
    setBattleViolations(null);
    setRatingChanges(null);
    setFinishedPlayerCode(null);
    setFinishedOpponentCode(null);
    setFinishedPlayerLanguage(null);
    setFinishedOpponentLanguage(null);
  }, []);

  return {
    winner, setWinner,
    winnerName, setWinnerName,
    loserName, setLoserName,
    isTie, setIsTie,
    isPartialCredit, setIsPartialCredit,
    partialCreditData, setPartialCreditData,
    battleStartTime, setBattleStartTime,
    solveTime, setSolveTime,
    performanceData, setPerformanceData,
    battleViolations, setBattleViolations,
    ratingChanges, setRatingChanges,
    finishedPlayerCode, setFinishedPlayerCode,
    finishedOpponentCode, setFinishedOpponentCode,
    finishedPlayerLanguage, setFinishedPlayerLanguage,
    finishedOpponentLanguage, setFinishedOpponentLanguage,
    resetResultState
  };
}

export default useBattleResult;
