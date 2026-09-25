import { useState, useCallback, useRef } from 'react';

/**
 * Hook for managing anti-cheat related state
 * Separate from the AntiCheatSuite component - this manages UI state for violations
 */
export function useAntiCheatState() {
  // Counter for unique IDs (avoids duplicate IDs if warnings added in same millisecond)
  const idCounterRef = useRef(0);
  // Focus tracking
  const [focusLostTime, setFocusLostTime] = useState(null);
  const [totalTimeAway, setTotalTimeAway] = useState(0);
  const [focusWarnings, setFocusWarnings] = useState([]);

  // Copy/paste warnings
  const [pasteWarning, setPasteWarning] = useState(null);
  const [copyWarning, setCopyWarning] = useState(null);

  // Opponent violations
  const [opponentViolation, setOpponentViolation] = useState(null);

  // DevTools detection
  const [devToolsOpen, setDevToolsOpen] = useState(false);

  // Integrity tracking
  const [integrityScore, setIntegrityScore] = useState(100);
  const [violationCount, setViolationCount] = useState(0);

  // Add a focus warning
  const addFocusWarning = useCallback((message, type) => {
    idCounterRef.current += 1;
    const uniqueId = `${Date.now()}-${idCounterRef.current}`;
    setFocusWarnings(prev => [...prev, { id: uniqueId, message, type: type || "warning" }]);
  }, []);

  const removeOldestFocusWarning = useCallback(() => {
    setFocusWarnings(prev => prev.slice(1));
  }, []);

  const updateIntegrityScore = useCallback((severity) => {
    const penalty = severity === 'critical' ? 15 : severity === 'serious' ? 10 : 5;
    setIntegrityScore(prev => Math.max(0, prev - penalty));
    setViolationCount(prev => prev + 1);
  }, []);

  const resetAntiCheatState = useCallback(() => {
    setFocusLostTime(null);
    setTotalTimeAway(0);
    setFocusWarnings([]);
    setPasteWarning(null);
    setCopyWarning(null);
    setOpponentViolation(null);
    setDevToolsOpen(false);
    setIntegrityScore(100);
    setViolationCount(0);
  }, []);

  return {
    focusLostTime, setFocusLostTime,
    totalTimeAway, setTotalTimeAway,
    focusWarnings, setFocusWarnings,
    pasteWarning, setPasteWarning,
    copyWarning, setCopyWarning,
    opponentViolation, setOpponentViolation,
    devToolsOpen, setDevToolsOpen,
    integrityScore, setIntegrityScore,
    violationCount, setViolationCount,
    addFocusWarning,
    removeOldestFocusWarning,
    updateIntegrityScore,
    resetAntiCheatState
  };
}

export default useAntiCheatState;
