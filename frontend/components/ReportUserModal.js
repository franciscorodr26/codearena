import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, Flag, Ban, Loader2, Upload, Image, Trash2 } from 'lucide-react';
import { config } from '../config/env';
import { useAuth } from '../contexts/AuthContext';

const REPORT_REASONS = [
  { value: 'harassment', label: 'Harassment or Bullying' },
  { value: 'spam', label: 'Spam or Scam' },
  { value: 'cheating', label: 'Cheating in Battles' },
  { value: 'inappropriate_content', label: 'Inappropriate Content' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'other', label: 'Other' }
];

export default function ReportUserModal({ isOpen, onClose, userId, username }) {
  const { token } = useAuth();
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [screenshots, setScreenshots] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [viewingImage, setViewingImage] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Limit to 3 screenshots total
    if (screenshots.length + files.length > 3) {
      setError('Maximum 3 screenshots allowed');
      return;
    }

    // Validate file types and sizes
    const validFiles = files.filter(file => {
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
        setError('Only JPEG, PNG, GIF, and WebP images are allowed');
        return false;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError('Images must be under 5MB');
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    setUploading(true);
    setError('');

    try {
      const formData = new FormData();
      validFiles.forEach(file => formData.append('screenshots', file));

      const response = await fetch(`${config.backend_url}/api/moderation/report/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload screenshots');
      }

      setScreenshots(prev => [...prev, ...data.urls]);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const removeScreenshot = (index) => {
    setScreenshots(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reason) {
      setError('Please select a reason');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const response = await fetch(`${config.backend_url}/api/moderation/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          userId,
          reason,
          description: description.trim() || null,
          screenshots: screenshots.length > 0 ? screenshots : null
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit report');
      }

      setSuccess(true);
      setTimeout(() => {
        onClose();
        setSuccess(false);
        setReason('');
        setDescription('');
        setScreenshots([]);
      }, 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!submitting && !uploading) {
      onClose();
      setReason('');
      setDescription('');
      setScreenshots([]);
      setError('');
      setSuccess(false);
    }
  };

  // Escape key to close modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && !submitting && !uploading && !viewingImage) {
        handleClose();
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, submitting, uploading, viewingImage]);

  return (
    <>
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-surface-900 border border-surface-700 rounded-2xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-red-600/20 to-orange-600/20 border-b border-surface-700 p-4 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                  <Flag className="h-5 w-5 text-red-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Report User</h2>
                  <p className="text-sm text-surface-400">@{username}</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                disabled={submitting || uploading}
                className="p-2 hover:bg-surface-800 rounded-lg transition-colors disabled:opacity-50"
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
                    <AlertTriangle className="h-8 w-8 text-green-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">Report Submitted</h3>
                  <p className="text-surface-400">Thank you for helping keep CodeArena safe.</p>
                </motion.div>
              ) : (
                <form onSubmit={handleSubmit}>
                  {/* Warning */}
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-4">
                    <p className="text-sm text-yellow-300">
                      Reports are reviewed by our moderation team. False reports may result in action against your account.
                    </p>
                  </div>

                  {/* Reason Select */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Reason for report *
                    </label>
                    <select
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-lg text-white focus:outline-none focus:border-primary-500"
                      disabled={submitting || uploading}
                    >
                      <option value="">Select a reason...</option>
                      {REPORT_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Description */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Additional details (optional)
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Provide more context about your report..."
                      rows={3}
                      maxLength={500}
                      className="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-lg text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 resize-none"
                      disabled={submitting || uploading}
                    />
                    <p className="text-xs text-surface-500 mt-1">{description.length}/500</p>
                  </div>

                  {/* Screenshots */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Screenshots (optional)
                    </label>
                    <p className="text-xs text-surface-500 mb-2">
                      Add screenshots as evidence to help us investigate
                    </p>

                    {/* Uploaded screenshots preview */}
                    {screenshots.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {screenshots.map((url, index) => (
                          <div key={index} className="relative group">
                            <img
                              src={url}
                              alt={`Screenshot ${index + 1}`}
                              className="w-full h-20 object-cover rounded-lg border border-surface-700 cursor-pointer hover:border-primary-500 transition-colors"
                              onClick={() => setViewingImage(url)}
                            />
                            <button
                              type="button"
                              onClick={() => removeScreenshot(index)}
                              disabled={submitting || uploading}
                              className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Trash2 className="h-3 w-3 text-white" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Upload button */}
                    {screenshots.length < 3 && (
                      <>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/gif,image/webp"
                          multiple
                          onChange={handleFileSelect}
                          className="hidden"
                          disabled={submitting || uploading}
                        />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={submitting || uploading}
                          className="w-full px-4 py-3 bg-surface-800 hover:bg-surface-700 border border-dashed border-surface-600 rounded-lg text-surface-400 hover:text-surface-300 transition-colors flex items-center justify-center space-x-2 disabled:opacity-50"
                        >
                          {uploading ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <>
                              <Upload className="h-4 w-4" />
                              <span>Add Screenshots ({screenshots.length}/3)</span>
                            </>
                          )}
                        </button>
                      </>
                    )}
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
                      disabled={submitting || uploading}
                      className="flex-1 px-4 py-3 bg-surface-800 hover:bg-surface-700 border border-surface-700 rounded-lg text-white transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || uploading || !reason}
                      className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-500 rounded-lg text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
                    >
                      {submitting ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <>
                          <Flag className="h-4 w-4" />
                          <span>Submit Report</span>
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

    {/* Image Lightbox - outside modal */}
    <AnimatePresence>
      {viewingImage && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4"
          onClick={(e) => { e.stopPropagation(); setViewingImage(null); }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setViewingImage(null); }}
            className="absolute top-4 right-4 p-2 bg-surface-800 hover:bg-surface-700 rounded-full transition-colors"
          >
            <X className="h-6 w-6 text-white" />
          </button>
          <motion.img
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            src={viewingImage}
            alt="Screenshot preview"
            className="max-w-full max-h-[85vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}

// Separate component for Block User confirmation
export function BlockUserModal({ isOpen, onClose, userId, username, onBlocked }) {
  const { token } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Escape key to close modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, submitting, onClose]);

  const handleBlock = async () => {
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch(`${config.backend_url}/api/moderation/block`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ userId })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to block user');
      }

      onBlocked?.();
      onClose();
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
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-surface-900 border border-surface-700 rounded-2xl max-w-sm w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                <Ban className="h-8 w-8 text-red-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Block @{username}?</h3>
              <p className="text-surface-400 mb-6">
                They won't be able to message you or send friend requests. You can unblock them later.
              </p>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              <div className="flex space-x-3">
                <button
                  onClick={onClose}
                  disabled={submitting}
                  className="flex-1 px-4 py-3 bg-surface-800 hover:bg-surface-700 border border-surface-700 rounded-lg text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBlock}
                  disabled={submitting}
                  className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-500 rounded-lg text-white font-medium transition-colors flex items-center justify-center space-x-2"
                >
                  {submitting ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <Ban className="h-4 w-4" />
                      <span>Block</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
