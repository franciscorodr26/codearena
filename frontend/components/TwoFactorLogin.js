import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  ArrowLeft,
  Key,
  AlertCircle,
  Loader2,
  Smartphone,
  Monitor
} from 'lucide-react';
import Button from './ui/Button';
import TwoFactorCodeInput from './TwoFactorCodeInput';
import { config } from '../config/env';
import { fetchWithTimeout } from '../utils/fetch';

// Get trusted device token from localStorage
const getTrustedDeviceToken = () => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('trusted_device_token');
};

// Store trusted device token in localStorage
const setTrustedDeviceToken = (token) => {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem('trusted_device_token', token);
  }
};

// Clear trusted device token from localStorage
export const clearTrustedDeviceToken = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('trusted_device_token');
};

// Export getter for use in login flow
export { getTrustedDeviceToken };

/**
 * Two-Factor Authentication login verification component
 * Shows after successful username/password login when 2FA is enabled
 */
export default function TwoFactorLogin({
  tempToken, // Temporary token received after password verification
  username,
  onSuccess, // Called with { token, user } after successful 2FA
  onCancel, // Called when user wants to go back to login
  rememberMe = false
}) {
  const [code, setCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [backupCode, setBackupCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rememberDevice, setRememberDevice] = useState(false);

  // Clear error when switching modes
  useEffect(() => {
    setError('');
    setCode('');
    setBackupCode('');
  }, [useBackupCode]);

  const verify2FA = async (codeToVerify) => {
    if (!codeToVerify || (useBackupCode && backupCode.length < 8) || (!useBackupCode && code.length !== 6)) {
      setError(useBackupCode ? 'Please enter a valid backup code' : 'Please enter a 6-digit code');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Use different endpoints for TOTP vs recovery codes
      const endpoint = useBackupCode ? '/auth/2fa/recovery' : '/auth/2fa/verify';
      const body = useBackupCode
        ? { pendingToken: tempToken, recoveryCode: codeToVerify, rememberMe, trustDevice: rememberDevice }
        : { pendingToken: tempToken, code: codeToVerify, rememberMe, trustDevice: rememberDevice };

      const res = await fetchWithTimeout(`${config.backend_url}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const data = await res.json();

      if (res.ok) {
        // Store trusted device token if returned by the backend
        const trustedDeviceToken = data.trustedDeviceToken || data.deviceToken;
        if (trustedDeviceToken) {
          setTrustedDeviceToken(trustedDeviceToken);
        }

        if (onSuccess) {
          onSuccess({
            token: data.token,
            user: data.user
          });
        }
      } else {
        setError(data.error || 'Invalid code. Please try again.');
        if (!useBackupCode) {
          setCode('');
        }
      }
    } catch (err) {
      setError('Failed to verify code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCodeComplete = (completedCode) => {
    if (!useBackupCode && completedCode.length === 6) {
      verify2FA(completedCode);
    }
  };

  const handleBackupSubmit = (e) => {
    e.preventDefault();
    verify2FA(backupCode);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="w-full"
    >
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-primary-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <Shield className="h-8 w-8 text-primary-400" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">
          Two-Factor Authentication
        </h1>
        <p className="text-surface-400">
          {useBackupCode
            ? 'Enter one of your backup codes'
            : 'Enter the 6-digit code from your authenticator app'}
        </p>
      </div>

      <AnimatePresence mode="wait">
        {!useBackupCode ? (
          /* Authenticator App Code */
          <motion.div
            key="authenticator"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <TwoFactorCodeInput
              value={code}
              onChange={setCode}
              onComplete={handleCodeComplete}
              error={!!error}
              autoFocus
            />

            {/* Error Message */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex items-center justify-center space-x-2 text-danger text-sm"
                >
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Remember Device Option */}
            <label className="flex items-center justify-center gap-2 cursor-pointer group">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-4 h-4 border border-surface-600 rounded bg-surface-800/50 peer-checked:bg-primary-500 peer-checked:border-primary-500 transition-all peer-focus:ring-2 peer-focus:ring-primary-500/50" />
                <svg
                  className="absolute top-0.5 left-0.5 w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="flex items-center space-x-1.5">
                <Monitor className="h-4 w-4 text-surface-500" />
                <span className="text-sm text-surface-400 group-hover:text-surface-300 transition-colors">
                  Trust this device for 30 days
                </span>
              </div>
            </label>

            {/* Verify Button */}
            <Button
              type="button"
              variant="primary"
              fullWidth
              size="lg"
              onClick={() => verify2FA(code)}
              loading={loading}
              disabled={code.length !== 6 || loading}
            >
              {loading ? 'Verifying...' : 'Verify'}
            </Button>

            {/* Use Backup Code Link */}
            <div className="text-center">
              <button
                type="button"
                onClick={() => setUseBackupCode(true)}
                className="text-sm text-primary-400 hover:text-primary-300 transition-colors flex items-center justify-center space-x-1 mx-auto"
              >
                <Key className="h-4 w-4" />
                <span>Use a backup code instead</span>
              </button>
            </div>
          </motion.div>
        ) : (
          /* Backup Code */
          <motion.div
            key="backup"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <form onSubmit={handleBackupSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-2 text-center">
                  Backup Code
                </label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-surface-500" />
                  <input
                    type="text"
                    value={backupCode}
                    onChange={(e) => setBackupCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                    placeholder="XXXX-XXXX-XXXX"
                    className={`w-full pl-10 pr-4 py-3 bg-surface-800/50 border rounded-xl text-white text-center font-mono text-lg tracking-wider placeholder-surface-500 focus:outline-none transition-all ${
                      error
                        ? 'border-danger focus:border-danger focus:ring-1 focus:ring-danger/50'
                        : 'border-surface-700 focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50'
                    }`}
                    autoFocus
                  />
                </div>
                <p className="mt-2 text-xs text-surface-500 text-center">
                  Enter one of your saved backup codes
                </p>
              </div>

              {/* Error Message */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex items-center justify-center space-x-2 text-danger text-sm"
                  >
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    <span>{error}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="p-3 bg-warning/10 border border-warning/30 rounded-xl">
                <p className="text-xs text-warning text-center">
                  Each backup code can only be used once
                </p>
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                variant="primary"
                fullWidth
                size="lg"
                loading={loading}
                disabled={backupCode.length < 8 || loading}
              >
                {loading ? 'Verifying...' : 'Verify Backup Code'}
              </Button>

              {/* Back to Authenticator */}
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setUseBackupCode(false)}
                  className="text-sm text-primary-400 hover:text-primary-300 transition-colors flex items-center justify-center space-x-1 mx-auto"
                >
                  <Smartphone className="h-4 w-4" />
                  <span>Use authenticator app instead</span>
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Back to Login */}
      <div className="mt-8 text-center">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="text-surface-400 hover:text-white transition-colors flex items-center justify-center space-x-1 mx-auto"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to login</span>
        </button>
      </div>
    </motion.div>
  );
}
