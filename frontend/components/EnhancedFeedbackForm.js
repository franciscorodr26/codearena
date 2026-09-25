// Shared feedback form component used across the app
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Star, X, Send, CheckCircle } from 'lucide-react';
import Button from './ui/Button';

const EnhancedFeedbackForm = ({ onSubmit, onClose, battleContext = null, standalone = false }) => {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [suggestion, setSuggestion] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showThankYou, setShowThankYou] = useState(false);
  const [error, setError] = useState('');

  const ratingLabels = { 1: "Needs Work", 2: "Could Be Better", 3: "Good", 4: "Great", 5: "Amazing!" };
  const ratingColors = { 1: "text-error-light", 2: "text-warning", 3: "text-yellow-400", 4: "text-primary-400", 5: "text-success-light" };

  // Escape key to close modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && !isSubmitting && onClose) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isSubmitting, onClose]);

  const handleSubmit = async () => {
    if (!rating) { setError('Please select a rating before submitting'); return; }
    setIsSubmitting(true);
    setError('');
    try {
      await onSubmit({ rating, suggestion: suggestion.trim(), email: email.trim(), standalone, timestamp: new Date().toISOString(), ...(battleContext || {}) });
      setShowThankYou(true);
      setTimeout(() => { if (onClose) onClose(); }, 3000);
    } catch (error) {
      setError('Failed to submit feedback. Please try again.');
      setIsSubmitting(false);
    }
  };

  if (showThankYou) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-surface-950 z-50 flex items-center justify-center"
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 20 }}
          className="glass-card p-8 text-center max-w-md mx-4"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', damping: 10 }}
            className="w-20 h-20 bg-gradient-to-br from-success to-success-dark rounded-full flex items-center justify-center mx-auto mb-6"
          >
            <CheckCircle className="h-10 w-10 text-white" />
          </motion.div>
          <h2 className="text-3xl font-bold gradient-text mb-4">Thank You!</h2>
          <p className="text-surface-300 text-lg mb-4">Your feedback helps us make CodeArena better for everyone!</p>
          <div className="flex justify-center space-x-1">
            {[...Array(rating)].map((_, i) => (
              <motion.div key={i} initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.3 + i * 0.1 }}>
                <Star className="h-6 w-6 text-warning fill-current" />
              </motion.div>
            ))}
          </div>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-surface-950 z-50 flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', damping: 20 }}
        className="glass-card max-w-md w-full"
      >
        <div className="flex items-center justify-between p-6 border-b border-surface-700">
          <div>
            <h3 className="text-xl font-bold text-white">{standalone ? 'Share Your Feedback' : 'How Was This Battle?'}</h3>
            <p className="text-surface-400 text-sm mt-1">Help us improve your coding experience</p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="text-surface-400 hover:text-white transition-colors p-2 hover:bg-surface-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Close feedback form"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-3">Rate Your Experience</label>
            <div className="flex items-center space-x-2 mb-2" role="group" aria-label="Rating selection">
              {[1, 2, 3, 4, 5].map((star) => (
                <motion.button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoveredRating(star)}
                  onMouseLeave={() => setHoveredRating(0)}
                  whileHover={{ scale: 1.2 }}
                  whileTap={{ scale: 0.9 }}
                  aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
                  aria-pressed={rating === star}
                >
                  <Star className={`h-8 w-8 transition-all duration-200 ${star <= (hoveredRating || rating) ? 'text-warning fill-current' : 'text-surface-600 hover:text-surface-400'}`} />
                </motion.button>
              ))}
            </div>
            <div className={`text-sm font-medium h-5 ${(hoveredRating || rating) > 0 ? ratingColors[hoveredRating || rating] : 'text-transparent'}`}>
              {(hoveredRating || rating) > 0 ? ratingLabels[hoveredRating || rating] : 'placeholder'}
            </div>
          </div>

          <div>
            <label htmlFor="feedback-suggestion" className="block text-sm font-medium text-surface-300 mb-2">
              What could we improve? <span className="text-surface-500">(optional)</span>
            </label>
            <textarea
              id="feedback-suggestion"
              name="suggestion"
              value={suggestion}
              onChange={(e) => setSuggestion(e.target.value)}
              placeholder="Share your thoughts, ideas, or suggestions..."
              className="input resize-none"
              rows={3}
              maxLength={500}
            />
            <div className="text-right text-xs text-surface-500 mt-1">{suggestion.length}/500</div>
          </div>

          <div>
            <label htmlFor="feedback-email" className="block text-sm font-medium text-surface-300 mb-2">
              Email for updates <span className="text-surface-500">(optional)</span>
            </label>
            <input
              id="feedback-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="input"
            />
            <div className="text-xs text-surface-500 mt-1">We'll only use this to send you updates about new features</div>
          </div>

          {error && (
            <div className="bg-error/10 border border-error/30 rounded-lg p-3" role="alert">
              <p className="text-error-light text-sm">{error}</p>
            </div>
          )}

          <div className="flex space-x-3">
            <Button variant="primary" fullWidth onClick={handleSubmit} disabled={!rating} loading={isSubmitting} icon={Send}>
              Submit Feedback
            </Button>
            {onClose && <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Skip</Button>}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default EnhancedFeedbackForm;
