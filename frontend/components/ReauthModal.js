import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Shield,
  Loader2
} from 'lucide-react';
import Button from './ui/Button';
import BaseModal from './ui/BaseModal';
import { config } from '../config/env';
import { fetchWithTimeout } from '../utils/fetch';

/**
 * Re-authentication Modal Component
 * Used when the backend requires password re-verification for sensitive actions
 *
 * Usage:
 * <ReauthModal
 *   isOpen={showReauth}
 *   onClose={() => setShowReauth(false)}
 *   onSuccess={() => { retryOriginalAction(); setShowReauth(false); }}
 *   token={token}
 *   title="Confirm Your Identity"
 *   description="Please enter your password to continue."
 * />
 */
export default function ReauthModal({
  isOpen,
  onClose,
  onSuccess,
  token,
  title = 'Confirm Your Identity',
  description = 'For your security, please enter your password to continue.',
  actionLabel = 'Confirm'
}) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setPassword('');
      setShowPassword(false);
      setError('');
    }
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!password) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetchWithTimeout(`${config.backend_url}/auth/verify-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ password })
      });

      const data = await res.json();

      if (res.ok) {
        // Password verified successfully
        if (onSuccess) {
          onSuccess(data);
        }
      } else {
        setError(data.error || 'Invalid password. Please try again.');
        setPassword('');
      }
    } catch (err) {
      setError('Failed to verify password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={() => !loading && onClose()} maxWidth="max-w-md">
      {/* Header */}
      <div className="flex items-center space-x-3 p-6 border-b border-surface-800">
        <div className="p-2 bg-primary-500/20 rounded-xl">
          <Shield className="h-5 w-5 text-primary-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="text-sm text-surface-400">{description}</p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-surface-300 mb-2">
            Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-surface-500" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoFocus
              disabled={loading}
              className="w-full pl-10 pr-12 py-3 bg-surface-800/50 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-all disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              disabled={loading}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-white transition-colors disabled:opacity-50"
            >
              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Error Message */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center space-x-2 text-danger bg-danger/10 border border-danger/30 rounded-xl p-3"
            >
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Actions */}
        <div className="flex space-x-3 pt-2">
          <Button
            type="button"
            variant="ghost"
            fullWidth
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={loading}
            disabled={!password || loading}
          >
            {loading ? 'Verifying...' : actionLabel}
          </Button>
        </div>
      </form>
    </BaseModal>
  );
}
