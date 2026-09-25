import { useState, useCallback } from 'react';

/**
 * Hook for managing UI and modal state in battle
 * Includes toast notifications, modals, and evaluation state
 */
export function useBattleUI() {
  // Toast notifications
  const [battleLinkToast, setBattleLinkToast] = useState(null);

  // Evaluation state
  const [isEvaluating, setIsEvaluating] = useState(false);

  // Modal states
  const [showOpponentLeftModal, setShowOpponentLeftModal] = useState(false);
  const [showForfeitModal, setShowForfeitModal] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  // Anti-cheat related UI
  const [showUnderstandingGate, setShowUnderstandingGate] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState(false);

  // Show a toast notification
  const showToast = useCallback((message, success = true) => {
    setBattleLinkToast({ message, success });
  }, []);

  // Clear toast notification
  const clearToast = useCallback(() => {
    setBattleLinkToast(null);
  }, []);

  // Reset all UI state
  const resetUIState = useCallback(() => {
    setBattleLinkToast(null);
    setIsEvaluating(false);
    setShowOpponentLeftModal(false);
    setShowForfeitModal(false);
    setShowFeedback(false);
    setShowUnderstandingGate(false);
    setPendingSubmission(false);
  }, []);

  return {
    battleLinkToast, setBattleLinkToast,
    isEvaluating, setIsEvaluating,
    showOpponentLeftModal, setShowOpponentLeftModal,
    showForfeitModal, setShowForfeitModal,
    showFeedback, setShowFeedback,
    showUnderstandingGate, setShowUnderstandingGate,
    pendingSubmission, setPendingSubmission,
    showToast,
    clearToast,
    resetUIState
  };
}

export default useBattleUI;
