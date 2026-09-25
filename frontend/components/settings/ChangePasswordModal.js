import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Lock,
  Eye,
  EyeOff,
  X,
  Check,
  AlertCircle,
  CheckCircle,
  Shield,
  LogOut
} from 'lucide-react';
import Button from '../ui/Button';

// Password strength calculation
function calculatePasswordStrength(password) {
  if (!password) return { score: 0, label: '', color: '' };

  let score = 0;
  const checks = {
    length: password.length >= 8,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    numbers: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
    longLength: password.length >= 12
  };

  if (checks.length) score += 1;
  if (checks.lowercase) score += 1;
  if (checks.uppercase) score += 1;
  if (checks.numbers) score += 1;
  if (checks.special) score += 1;
  if (checks.longLength) score += 1;

  const strengthMap = {
    0: { label: '', color: '' },
    1: { label: 'Very Weak', color: 'bg-danger' },
    2: { label: 'Weak', color: 'bg-orange-500' },
    3: { label: 'Fair', color: 'bg-warning' },
    4: { label: 'Good', color: 'bg-lime-500' },
    5: { label: 'Strong', color: 'bg-success' },
    6: { label: 'Very Strong', color: 'bg-success' }
  };

  return { score, checks, ...strengthMap[score] };
}

export default function ChangePasswordModal({
  isOpen,
  onClose,
  hasPassword = true,
  onSubmit,
  loading = false
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [signOutOtherDevices, setSignOutOtherDevices] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setSignOutOtherDevices(false);
      setError('');
      setSuccess('');
    }
  }, [isOpen]);

  const strength = useMemo(() => calculatePasswordStrength(newPassword), [newPassword]);

  const passwordsMatch = newPassword && confirmPassword && newPassword === confirmPassword;
  const passwordsMismatch = confirmPassword && newPassword !== confirmPassword;

  const canSubmit =
    (!hasPassword || currentPassword) &&
    newPassword.length >= 8 &&
    passwordsMatch &&
    !loading;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setError('');
    setSuccess('');

    try {
      await onSubmit({
        currentPassword: hasPassword ? currentPassword : null,
        newPassword,
        signOutOtherDevices
      });
      setSuccess(hasPassword ? 'Password changed successfully!' : 'Password set successfully!');
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.message || 'Failed to update password');
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={() => !loading && onClose()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-surface-900 border border-surface-700 rounded-2xl max-w-md w-full overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-surface-800">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-primary-500/20 rounded-xl">
                <Shield className="h-5 w-5 text-primary-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {hasPassword ? 'Change Password' : 'Set Password'}
                </h2>
                <p className="text-sm text-surface-400">
                  {hasPassword ? 'Update your account password' : 'Add password login to your account'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={loading}
              className="p-2 text-surface-400 hover:text-white hover:bg-surface-800 rounded-lg transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Google signup notice */}
            {!hasPassword && (
              <div className="p-3 bg-primary-500/10 border border-primary-500/30 rounded-xl">
                <p className="text-sm text-primary-300">
                  You signed up with Google. Setting a password lets you also log in with email.
                </p>
              </div>
            )}

            {/* Current Password */}
            {hasPassword && (
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-2">
                  Current Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-surface-500" />
                  <input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full pl-10 pr-12 py-3 bg-surface-800/50 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition-all"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-white transition-colors"
                  >
                    {showCurrentPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
            )}

            {/* New Password */}
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-2">
                New Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-surface-500" />
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full pl-10 pr-12 py-3 bg-surface-800/50 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition-all"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-white transition-colors"
                >
                  {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>

              {/* Strength meter */}
              {newPassword && (
                <div className="mt-3 space-y-2">
                  {/* Strength bar */}
                  <div className="flex items-center space-x-2">
                    <div className="flex-1 h-1.5 bg-surface-700 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(strength.score / 6) * 100}%` }}
                        className={`h-full rounded-full transition-colors ${strength.color}`}
                      />
                    </div>
                    <span className={`text-xs font-medium ${
                      strength.score >= 5 ? 'text-success' :
                      strength.score >= 4 ? 'text-lime-400' :
                      strength.score >= 3 ? 'text-warning' : 'text-danger'
                    }`}>
                      {strength.label}
                    </span>
                  </div>

                  {/* Requirements checklist */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <RequirementCheck met={strength.checks?.length} label="8+ characters" />
                    <RequirementCheck met={strength.checks?.uppercase} label="Uppercase letter" />
                    <RequirementCheck met={strength.checks?.lowercase} label="Lowercase letter" />
                    <RequirementCheck met={strength.checks?.numbers} label="Number" />
                    <RequirementCheck met={strength.checks?.special} label="Special character" />
                    <RequirementCheck met={strength.checks?.longLength} label="12+ characters" />
                  </div>
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-2">
                Confirm New Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-surface-500" />
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className={`w-full pl-10 pr-12 py-3 bg-surface-800/50 border rounded-xl text-white placeholder-surface-500 focus:outline-none transition-all ${
                    passwordsMismatch
                      ? 'border-danger focus:ring-danger/50'
                      : passwordsMatch
                        ? 'border-success focus:ring-success/50'
                        : 'border-surface-700 focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50'
                  }`}
                  autoComplete="new-password"
                />
                {confirmPassword && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {passwordsMatch ? (
                      <Check className="h-5 w-5 text-success" />
                    ) : (
                      <X className="h-5 w-5 text-danger" />
                    )}
                  </div>
                )}
              </div>
              {passwordsMismatch && (
                <p className="mt-1.5 text-xs text-danger">Passwords don't match</p>
              )}
            </div>

            {/* Sign out other devices option */}
            {hasPassword && (
              <label className="flex items-center space-x-3 p-3 bg-surface-800/30 rounded-xl cursor-pointer hover:bg-surface-800/50 transition-colors">
                <input
                  type="checkbox"
                  checked={signOutOtherDevices}
                  onChange={(e) => setSignOutOtherDevices(e.target.checked)}
                  className="w-4 h-4 rounded border-surface-600 bg-surface-700 text-primary-500 focus:ring-primary-500 focus:ring-offset-0"
                />
                <div className="flex items-center space-x-2">
                  <LogOut className="h-4 w-4 text-surface-400" />
                  <span className="text-sm text-surface-300">Sign out all other devices</span>
                </div>
              </label>
            )}

            {/* Error/Success Messages */}
            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex items-center space-x-2 text-danger bg-danger/10 border border-danger/30 rounded-xl p-3"
                >
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm">{error}</span>
                </motion.div>
              )}

              {success && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex items-center space-x-2 text-success bg-success/10 border border-success/30 rounded-xl p-3"
                >
                  <CheckCircle className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm">{success}</span>
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
                variant={success ? 'success' : 'primary'}
                fullWidth
                icon={success ? CheckCircle : Lock}
                loading={loading}
                disabled={!canSubmit}
              >
                {loading ? 'Updating...' : success ? 'Done!' : hasPassword ? 'Change Password' : 'Set Password'}
              </Button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// Small requirement check component
function RequirementCheck({ met, label }) {
  return (
    <div className={`flex items-center space-x-1.5 text-xs ${met ? 'text-success' : 'text-surface-500'}`}>
      {met ? (
        <Check className="h-3 w-3" />
      ) : (
        <div className="h-3 w-3 rounded-full border border-surface-600" />
      )}
      <span>{label}</span>
    </div>
  );
}
