// Global feedback modals that can be triggered from anywhere in the app
import { AnimatePresence } from 'framer-motion';
import { useFeedback } from '../contexts/FeedbackContext';
import EnhancedFeedbackForm from './EnhancedFeedbackForm';
import BugReportModal from './BugReportModal';
import FeatureRequestModal from './FeatureRequestModal';
import { config } from '../config/env';

export default function GlobalFeedbackModals() {
  const { showFeedback, showBugReport, showFeatureRequest, closeFeedback, closeBugReport, closeFeatureRequest } = useFeedback();

  const handleFeedbackSubmit = async (feedbackData) => {
    const response = await fetch(`${config.backend_url}/api/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        battleId: null,
        playerId: '00000000-0000-0000-0000-000000000000',
        playerName: 'Anonymous',
        rating: feedbackData.rating,
        suggestion: feedbackData.suggestion,
        email: feedbackData.email,
        winner: null,
        source: 'global_dropdown',
        timestamp: feedbackData.timestamp
      })
    });

    if (!response.ok) {
      throw new Error('Failed to submit feedback');
    }

    return response.json();
  };

  return (
    <AnimatePresence>
      {showFeedback && (
        <EnhancedFeedbackForm
          key="feedback"
          onSubmit={handleFeedbackSubmit}
          onClose={closeFeedback}
          standalone={true}
        />
      )}

      <BugReportModal
        key="bug-report"
        isOpen={showBugReport}
        onClose={closeBugReport}
      />

      <FeatureRequestModal
        key="feature-request"
        isOpen={showFeatureRequest}
        onClose={closeFeatureRequest}
      />
    </AnimatePresence>
  );
}
