import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Flag, Loader2, CheckCircle } from 'lucide-react';
import { config } from '../config/env';
import { useAuth } from '../contexts/AuthContext';
import BaseModal from './ui/BaseModal';

const REPORT_REASONS = [
  { value: 'wrong_test_cases', label: 'Wrong test cases' },
  { value: 'unclear_description', label: 'Unclear description' },
  { value: 'wrong_expected_output', label: 'Wrong expected output' },
  { value: 'missing_constraints', label: 'Missing constraints' },
  { value: 'other', label: 'Other' },
];

export default function ReportProblemModal({ isOpen, onClose, problemId, problemTitle }) {
  const { user, token } = useAuth();
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const closeTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);


  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reason) { setError('Please select a reason'); return; }
    if (!description.trim()) { setError('Please describe the issue'); return; }

    setSubmitting(true);
    setError('');

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const reasonLabel = REPORT_REASONS.find(r => r.value === reason)?.label || reason;
      const title = `Problem Report: ${problemTitle || problemId}`;
      const fullDescription = `Reason: ${reasonLabel}\nProblem: ${problemTitle || 'Unknown'} (${problemId})\n\n${description.trim()}`;

      const response = await fetch(`${config.backend_url}/api/bug-reports`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title,
          description: fullDescription,
          email: user?.email || null,
          pageUrl: typeof window !== 'undefined' ? window.location.href : null
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to submit report');

      setSuccess(true);
      closeTimeoutRef.current = setTimeout(() => handleClose(), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    onClose();
    setTimeout(() => {
      setReason('');
      setDescription('');
      setError('');
      setSuccess(false);
    }, 200);
  };

  return (
    <BaseModal isOpen={isOpen} onClose={handleClose} maxWidth="max-w-md">
      {/* Header */}
      <div className="bg-gradient-to-r from-yellow-600/20 to-orange-600/20 border-b border-surface-700 p-4 flex items-center space-x-3">
        <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
          <Flag className="h-5 w-5 text-yellow-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">Report Problem</h2>
          <p className="text-sm text-surface-400 truncate max-w-[250px]">{problemTitle || problemId}</p>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {success ? (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center py-6"
          >
            <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3">
              <CheckCircle className="h-7 w-7 text-green-400" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-1">Report Submitted</h3>
            <p className="text-surface-400 text-sm">Thanks for helping improve CodeArena.</p>
          </motion.div>
        ) : (
          <form onSubmit={handleSubmit}>
            {/* Reason */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-surface-300 mb-2">
                What's wrong? *
              </label>
              <div className="space-y-2">
                {REPORT_REASONS.map((r) => (
                  <label
                    key={r.value}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer border transition-colors ${
                      reason === r.value
                        ? 'bg-yellow-500/10 border-yellow-500/40 text-white'
                        : 'bg-surface-800 border-surface-700 text-surface-300 hover:border-surface-600'
                    }`}
                  >
                    <input
                      type="radio"
                      name="reason"
                      value={r.value}
                      checked={reason === r.value}
                      onChange={(e) => setReason(e.target.value)}
                      className="sr-only"
                    />
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      reason === r.value ? 'border-yellow-400' : 'border-surface-500'
                    }`}>
                      {reason === r.value && <div className="w-2 h-2 rounded-full bg-yellow-400" />}
                    </div>
                    <span className="text-sm">{r.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Description */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-surface-300 mb-2">
                Details *
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what's wrong with this problem..."
                rows={3}
                maxLength={2000}
                className="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-lg text-white text-sm placeholder-surface-500 focus:outline-none focus:border-primary-500 resize-none"
                disabled={submitting}
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={handleClose}
                disabled={submitting}
                className="flex-1 px-4 py-2.5 bg-surface-800 hover:bg-surface-700 border border-surface-700 rounded-lg text-white text-sm transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !reason || !description.trim()}
                className="flex-1 px-4 py-2.5 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
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
    </BaseModal>
  );
}
