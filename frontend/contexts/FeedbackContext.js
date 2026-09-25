import React, { createContext, useContext, useState, useCallback } from 'react';

const FeedbackContext = createContext(null);

export function FeedbackProvider({ children }) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [showBugReport, setShowBugReport] = useState(false);
  const [showFeatureRequest, setShowFeatureRequest] = useState(false);

  const openFeedback = useCallback(() => {
    setShowFeedback(true);
    setShowBugReport(false);
    setShowFeatureRequest(false);
  }, []);

  const openBugReport = useCallback(() => {
    setShowBugReport(true);
    setShowFeedback(false);
    setShowFeatureRequest(false);
  }, []);

  const openFeatureRequest = useCallback(() => {
    setShowFeatureRequest(true);
    setShowFeedback(false);
    setShowBugReport(false);
  }, []);

  const closeFeedback = useCallback(() => {
    setShowFeedback(false);
  }, []);

  const closeBugReport = useCallback(() => {
    setShowBugReport(false);
  }, []);

  const closeFeatureRequest = useCallback(() => {
    setShowFeatureRequest(false);
  }, []);

  const value = {
    showFeedback,
    showBugReport,
    showFeatureRequest,
    openFeedback,
    openBugReport,
    openFeatureRequest,
    closeFeedback,
    closeBugReport,
    closeFeatureRequest
  };

  return (
    <FeedbackContext.Provider value={value}>
      {children}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error('useFeedback must be used within a FeedbackProvider');
  }
  return context;
}
