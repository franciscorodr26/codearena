import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb, X, Loader2, CheckCircle } from 'lucide-react';
import { config } from '../config/env';
import { useAuth } from '../contexts/AuthContext';

const CATEGORIES = [
  { label: 'Practice', value: 'practice' },
  { label: 'Battles', value: 'battles' },
  { label: 'UI/Design', value: 'ui' },
  { label: 'Social', value: 'social' },
  { label: 'CreatorArena', value: 'creator' },
  { label: 'Other', value: 'other' }
];

export default function FeatureRequestModal({ isOpen, onClose }) {
  const { user, token } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const closeTimeoutRef = useRef(null);

  const handleClose = useCallback(() => {
    if (!submitting) {
      onClose();
      // Reset form after close animation
      setTimeout(() => {
        setTitle('');
        setDescription('');
        setCategory('');
        setError('');
        setSuccess(false);
      }, 200);
    }
  }, [onClose, submitting]);

  // Escape key to close modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && !submitting) {
        handleClose();
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, submitting, handleClose]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!title.trim()) {
      setError('Please enter a title');
      return;
    }

    if (!description.trim()) {
      setError('Please describe the feature');
      return;
    }

    if (!category) {
      setError('Please select a category');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const headers = {
        'Content-Type': 'application/json'
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${config.backend_url}/api/feature-requests`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit feature request');
      }

      setSuccess(true);
      closeTimeoutRef.current = setTimeout(() => {
        handleClose();
      }, 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-surface-950 z-50 flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-surface-900 border border-surface-700 rounded-2xl max-w-lg w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-surface-900 bg-gradient-to-r from-purple-600/20 to-blue-600/20 border-b border-surface-700 p-4 flex items-center justify-between sticky top-0 z-10">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                  <Lightbulb className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Request a Feature</h2>
                  <p className="text-sm text-surface-400">Tell us what you'd like to see</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                disabled={submitting}
                className="p-2 hover:bg-surface-800 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-surface-400" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              {success ? (
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="text-center py-8"
                >
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="h-8 w-8 text-green-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">Feature Request Submitted!</h3>
                  <p className="text-surface-400">Thank you for helping shape CodeArena's future.</p>
                </motion.div>
              ) : (
                <form onSubmit={handleSubmit}>
                  {/* Title */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Feature Title *
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Brief title for your feature idea"
                      maxLength={200}
                      className="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-lg text-white text-base placeholder-surface-500 focus:outline-none focus:border-primary-500"
                      disabled={submitting}
                    />
                    <p className="text-xs text-surface-500 mt-1">{title.length}/200</p>
                  </div>

                  {/* Category */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Category *
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-lg text-white text-base focus:outline-none focus:border-primary-500 appearance-none"
                      disabled={submitting}
                    >
                      <option value="" disabled>Select a category</option>
                      {CATEGORIES.map((cat) => (
                        <option key={cat.value} value={cat.value}>{cat.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Description */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Description *
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Describe the feature you'd like to see..."
                      rows={5}
                      maxLength={5000}
                      className="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-lg text-white text-base placeholder-surface-500 focus:outline-none focus:border-primary-500 resize-none"
                      disabled={submitting}
                    />
                    <p className="text-xs text-surface-500 mt-1">{description.length}/5000</p>
                  </div>

                  {/* Error */}
                  {error && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
                      <p className="text-sm text-red-400">{error}</p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex space-x-3">
                    <button
                      type="button"
                      onClick={handleClose}
                      disabled={submitting}
                      className="flex-1 px-4 py-3 bg-surface-800 hover:bg-surface-700 border border-surface-700 rounded-lg text-white transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || !title.trim() || !description.trim() || !category}
                      className="flex-1 px-4 py-3 bg-primary-600 hover:bg-primary-500 rounded-lg text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
                    >
                      {submitting ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <>
                          <Lightbulb className="h-4 w-4" />
                          <span>Submit Request</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
