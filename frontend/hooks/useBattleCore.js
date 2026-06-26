import { useState, useCallback, useEffect, useRef } from 'react';

// localStorage keys
const CODE_STORAGE_PREFIX = 'codearena-code-';
const LANGUAGE_STORAGE_PREFIX = 'codearena-lang-';

/**
 * Hook for managing core battle state
 * Includes battle identification, player info, and fundamental battle data
 */
export function useBattleCore() {
  // Battle identification
  const [battleState, setBattleState] = useState('menu');
  const [battleId, setBattleId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [joinBattleId, setJoinBattleId] = useState('');

  // Battle data
  const [battle, setBattle] = useState(null);
  const [opponent, setOpponent] = useState(null);

  // Code state
  const [selectedLanguage, setSelectedLanguage] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('codearena-preferred-language') || 'python';
    }
    return 'python';
  });
  const [code, setCode] = useState('');

  // Track if code was loaded from storage to prevent overwriting with starter code
  const codeLoadedFromStorageRef = useRef(false);

  // Timer and results
  const [timeLeft, setTimeLeft] = useState(3600);
  const [testResults, setTestResults] = useState([]);
  const [hiddenTestResults, setHiddenTestResults] = useState(null);

  // Connection
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [error, setError] = useState('');

  // Server time synchronization
  const [serverTimeSync, setServerTimeSync] = useState(null);

  // Load saved code from localStorage when battleId changes
  useEffect(() => {
    if (battleId && typeof window !== 'undefined') {
      try {
        const savedCode = localStorage.getItem(`${CODE_STORAGE_PREFIX}${battleId}`);
        const savedLanguage = localStorage.getItem(`${LANGUAGE_STORAGE_PREFIX}${battleId}`);

        if (savedCode) {
          setCode(savedCode);
          codeLoadedFromStorageRef.current = true;
        }
        if (savedLanguage) {
          setSelectedLanguage(savedLanguage);
        }
      } catch (e) {
        console.warn('Failed to load code from localStorage:', e);
      }
    }
  }, [battleId]);

  // Save code to localStorage when it changes (debounced)
  useEffect(() => {
    if (battleId && code && typeof window !== 'undefined') {
      // Only save if we have meaningful code (not just starter code on first load)
      const timeoutId = setTimeout(() => {
        try {
          localStorage.setItem(`${CODE_STORAGE_PREFIX}${battleId}`, code);
          localStorage.setItem(`${LANGUAGE_STORAGE_PREFIX}${battleId}`, selectedLanguage);
        } catch (e) {
          console.warn('Failed to save code to localStorage:', e);
        }
      }, 500); // Debounce saves by 500ms

      return () => clearTimeout(timeoutId);
    }
  }, [battleId, code, selectedLanguage]);

  // Clean up old battle code from localStorage (keep only last 10 battles)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const keys = Object.keys(localStorage).filter(k => k.startsWith(CODE_STORAGE_PREFIX));
        if (keys.length > 10) {
          // Remove oldest entries (simple approach - just remove extras)
          keys.slice(0, keys.length - 10).forEach(key => {
            localStorage.removeItem(key);
            localStorage.removeItem(key.replace(CODE_STORAGE_PREFIX, LANGUAGE_STORAGE_PREFIX));
          });
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }, [battleId]);

  // Reset all core state
  const resetCoreState = useCallback(() => {
    setBattleState('menu');
    setBattleId('');
    setPlayerId('');
    setPlayerName('');
    setJoinBattleId('');
    setBattle(null);
    setOpponent(null);
    setSelectedLanguage(
      (typeof window !== 'undefined' && localStorage.getItem('codearena-preferred-language')) || 'python'
    );
    setCode('');
    setTimeLeft(3600);
    setTestResults([]);
    setHiddenTestResults(null);
    setConnectionStatus('disconnected');
    setError('');
    setServerTimeSync(null);
    codeLoadedFromStorageRef.current = false;
  }, []);

  // Prepare state for a rematch (partial reset with new IDs)
  const prepareForRematch = useCallback((newBattleId, newPlayerId) => {
    setBattleState('waiting');
    setPlayerId(newPlayerId);
    setBattle(null);
    setOpponent(null);
    setCode('');
    setTestResults([]);
    setHiddenTestResults(null);
    setTimeLeft(3600);
    setError('');
    setServerTimeSync(null);
    codeLoadedFromStorageRef.current = false;
    // Proactively clear any localStorage for the new battle ID to prevent
    // stale data from a debounced save leaking into the new battle
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(`${CODE_STORAGE_PREFIX}${newBattleId}`);
        localStorage.removeItem(`${LANGUAGE_STORAGE_PREFIX}${newBattleId}`);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    // Set battleId LAST to prevent the localStorage save effect from
    // firing with stale code + new battleId before code is cleared
    setBattleId(newBattleId);
  }, []);

  return {
    battleState, setBattleState,
    battleId, setBattleId,
    playerId, setPlayerId,
    playerName, setPlayerName,
    joinBattleId, setJoinBattleId,
    battle, setBattle,
    opponent, setOpponent,
    selectedLanguage, setSelectedLanguage,
    code, setCode,
    timeLeft, setTimeLeft,
    testResults, setTestResults,
    hiddenTestResults, setHiddenTestResults,
    connectionStatus, setConnectionStatus,
    error, setError,
    serverTimeSync, setServerTimeSync,
    resetCoreState,
    prepareForRematch,
    codeLoadedFromStorageRef
  };
}

export default useBattleCore;
