import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Smartphone,
  Key,
  CheckCircle,
  AlertCircle,
  Loader2,
  Copy,
  Check,
  X,
  QrCode,
  Download,
  RefreshCw,
  Lock,
  Eye,
  EyeOff,
  Calendar,
  Monitor,
  Tablet,
  Globe,
  MapPin,
  Clock,
  Trash2,
  AlertTriangle
} from 'lucide-react';
import Button from '../ui/Button';
import TwoFactorCodeInput from '../TwoFactorCodeInput';
import { config } from '../../config/env';
import { fetchWithTimeout } from '../../utils/fetch';
import { useToast } from '../../contexts/ToastContext';

// Device icon based on user agent
function getDeviceIcon(deviceType) {
  switch (deviceType?.toLowerCase()) {
    case 'mobile':
      return Smartphone;
    case 'tablet':
      return Tablet;
    default:
      return Monitor;
  }
}

// Format relative time
function formatRelativeTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default function TwoFactorAuth({ token, is2FAEnabled = false, twoFAEnabledAt, onStatusChange }) {
  const toast = useToast();

  const [showSetup, setShowSetup] = useState(false);
  const [showDisableModal, setShowDisableModal] = useState(false);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  const [setupStep, setSetupStep] = useState(1);
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedBackup, setCopiedBackup] = useState(false);

  // Disable 2FA modal state
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [showDisablePassword, setShowDisablePassword] = useState(false);
  const [disableError, setDisableError] = useState('');

  // Regenerate codes modal state
  const [regeneratePassword, setRegeneratePassword] = useState('');
  const [showRegeneratePassword, setShowRegeneratePassword] = useState(false);
  const [regenerateError, setRegenerateError] = useState('');
  const [newBackupCodes, setNewBackupCodes] = useState([]);

  // Backup codes count state
  const [backupCodesCount, setBackupCodesCount] = useState(null);
  const [backupCodesLoading, setBackupCodesLoading] = useState(false);

  // Trusted devices state
  const [trustedDevices, setTrustedDevices] = useState([]);
  const [trustedDevicesLoading, setTrustedDevicesLoading] = useState(false);
  const [revokingDevice, setRevokingDevice] = useState(null);
  const [revokingAllDevices, setRevokingAllDevices] = useState(false);
  const [showTrustedDevices, setShowTrustedDevices] = useState(false);

  // Fetch backup codes count
  const fetchBackupCodesCount = useCallback(async () => {
    if (!token || !is2FAEnabled) return;
    setBackupCodesLoading(true);
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/auth/2fa/backup-codes-count`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setBackupCodesCount(data.count);
      }
    } catch (err) {
      console.error('Failed to fetch backup codes count:', err);
    } finally {
      setBackupCodesLoading(false);
    }
  }, [token, is2FAEnabled]);

  // Fetch trusted devices
  const fetchTrustedDevices = useCallback(async () => {
    if (!token || !is2FAEnabled) return;
    setTrustedDevicesLoading(true);
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/auth/2fa/trusted-devices`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTrustedDevices(data.devices || []);
      }
    } catch (err) {
      console.error('Failed to fetch trusted devices:', err);
    } finally {
      setTrustedDevicesLoading(false);
    }
  }, [token, is2FAEnabled]);

  // Load data when 2FA is enabled
  useEffect(() => {
    if (is2FAEnabled) {
      fetchBackupCodesCount();
      fetchTrustedDevices();
    }
  }, [is2FAEnabled, fetchBackupCodesCount, fetchTrustedDevices]);

  // Revoke a trusted device
  const revokeTrustedDevice = async (deviceId) => {
    setRevokingDevice(deviceId);
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/auth/2fa/trusted-devices/${deviceId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setTrustedDevices(prev => prev.filter(d => d.id !== deviceId));
        toast.success('Device removed from trusted list');
      } else {
        toast.error('Failed to revoke device');
      }
    } catch (err) {
      toast.error('Failed to revoke device');
    } finally {
      setRevokingDevice(null);
    }
  };

  // Revoke all trusted devices
  const revokeAllTrustedDevices = async () => {
    setRevokingAllDevices(true);
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/auth/2fa/trusted-devices`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setTrustedDevices([]);
        toast.success('All trusted devices removed');
      } else {
        toast.error('Failed to revoke devices');
      }
    } catch (err) {
      toast.error('Failed to revoke devices');
    } finally {
      setRevokingAllDevices(false);
    }
  };

  // Initialize 2FA setup
  const startSetup = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/auth/2fa/setup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.ok) {
        const data = await res.json();
        setQrCode(data.qrCode);
        setSecret(data.secret);
        setShowSetup(true);
        setSetupStep(1);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to initialize 2FA setup');
      }
    } catch (err) {
      setError('Failed to connect to server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Verify and enable 2FA
  const verifyAndEnable = async () => {
    if (verificationCode.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/auth/2fa/verify-setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ code: verificationCode })
      });

      if (res.ok) {
        const data = await res.json();
        setBackupCodes(data.backupCodes || []);
        setBackupCodesCount(data.backupCodes?.length || 0);
        setSetupStep(3);
        toast.success('Two-factor authentication enabled');
        if (onStatusChange) onStatusChange(true);
      } else {
        const data = await res.json();
        setError(data.error || 'Invalid verification code');
        setVerificationCode('');
      }
    } catch (err) {
      setError('Failed to verify code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Disable 2FA
  const disable2FA = async () => {
    if (!disablePassword || disableCode.length !== 6) {
      setDisableError('Please enter your password and a 6-digit code');
      return;
    }

    setLoading(true);
    setDisableError('');
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/auth/2fa/disable`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ password: disablePassword, code: disableCode })
      });

      if (res.ok) {
        toast.success('Two-factor authentication disabled');
        // Clear trusted device token from localStorage
        localStorage.removeItem('trusted_device_token');
        if (onStatusChange) onStatusChange(false);
        setShowDisableModal(false);
        resetDisableModal();
      } else {
        const data = await res.json();
        setDisableError(data.error || 'Failed to disable 2FA');
      }
    } catch (err) {
      setDisableError('Failed to connect to server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Regenerate backup codes
  const regenerateBackupCodes = async () => {
    if (!regeneratePassword) {
      setRegenerateError('Please enter your password');
      return;
    }

    setLoading(true);
    setRegenerateError('');
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/auth/2fa/regenerate-backup-codes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ password: regeneratePassword })
      });

      if (res.ok) {
        const data = await res.json();
        setNewBackupCodes(data.backupCodes || []);
        setBackupCodesCount(data.backupCodes?.length || 0);
        toast.success('New backup codes generated');
      } else {
        const data = await res.json();
        setRegenerateError(data.error || 'Failed to regenerate backup codes');
      }
    } catch (err) {
      setRegenerateError('Failed to connect to server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text);
    if (type === 'secret') {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    } else {
      setCopiedBackup(true);
      setTimeout(() => setCopiedBackup(false), 2000);
    }
  };

  const downloadBackupCodes = (codes) => {
    const content = `CodeArena 2FA Backup Codes
Generated: ${new Date().toLocaleString()}

IMPORTANT: Store these codes securely. Each code can only be used once.

${codes.join('\n')}

If you lose access to your authenticator app, use one of these codes to log in.`;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'codearena-2fa-backup-codes.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const closeSetup = () => {
    setShowSetup(false);
    setSetupStep(1);
    setVerificationCode('');
    setError('');
    setQrCode('');
    setSecret('');
    setBackupCodes([]);
  };

  const resetDisableModal = () => {
    setDisablePassword('');
    setDisableCode('');
    setShowDisablePassword(false);
    setDisableError('');
  };

  const resetRegenerateModal = () => {
    setRegeneratePassword('');
    setShowRegeneratePassword(false);
    setRegenerateError('');
    setNewBackupCodes([]);
  };

  // Format the enabled date
  const formatEnabledDate = (dateStr) => {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  // Enabled state - show management options
  if (is2FAEnabled && !showSetup) {
    return (
      <>
        <div className="space-y-4">
          {/* Main 2FA Status Card */}
          <div className="p-4 bg-success/10 border border-success/30 rounded-xl">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-success/20 rounded-lg">
                  <Shield className="h-5 w-5 text-success" />
                </div>
                <div>
                  <h3 className="font-medium text-white flex items-center space-x-2">
                    <span>Two-Factor Authentication</span>
                    <CheckCircle className="h-4 w-4 text-success" />
                  </h3>
                  <p className="text-sm text-surface-400">Your account is protected with 2FA</p>
                  {twoFAEnabledAt && (
                    <p className="text-xs text-surface-500 mt-1 flex items-center space-x-1">
                      <Calendar className="h-3 w-3" />
                      <span>Enabled {formatEnabledDate(twoFAEnabledAt)}</span>
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={RefreshCw}
                  onClick={() => setShowRegenerateModal(true)}
                >
                  <span className="hidden sm:inline">Backup Codes</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDisableModal(true)}
                >
                  Disable
                </Button>
              </div>
            </div>
          </div>

          {/* Backup Codes Count */}
          <div className={`p-4 rounded-xl border ${
            backupCodesCount !== null && backupCodesCount <= 2
              ? 'bg-warning/10 border-warning/30'
              : 'bg-surface-800/50 border-surface-700'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-lg ${
                  backupCodesCount !== null && backupCodesCount <= 2
                    ? 'bg-warning/20'
                    : 'bg-surface-700'
                }`}>
                  <Key className={`h-5 w-5 ${
                    backupCodesCount !== null && backupCodesCount <= 2
                      ? 'text-warning'
                      : 'text-surface-400'
                  }`} />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="font-medium text-white">Backup Codes</h3>
                    {backupCodesCount !== null && backupCodesCount <= 2 && (
                      <span className="text-[10px] font-bold text-warning bg-warning/20 px-1.5 py-0.5 rounded">
                        LOW
                      </span>
                    )}
                  </div>
                  {backupCodesLoading ? (
                    <p className="text-sm text-surface-400 flex items-center space-x-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Loading...</span>
                    </p>
                  ) : backupCodesCount !== null ? (
                    <p className={`text-sm ${
                      backupCodesCount <= 2 ? 'text-warning' : 'text-surface-400'
                    }`}>
                      {backupCodesCount} backup code{backupCodesCount !== 1 ? 's' : ''} remaining
                      {backupCodesCount <= 2 && ' - Generate new codes soon'}
                    </p>
                  ) : (
                    <p className="text-sm text-surface-400">Unable to fetch count</p>
                  )}
                </div>
              </div>
              <button
                onClick={fetchBackupCodesCount}
                disabled={backupCodesLoading}
                className="text-sm text-primary-400 hover:text-primary-300 flex items-center space-x-1 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${backupCodesLoading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Trusted Devices Section */}
          <div className="p-4 bg-surface-800/50 rounded-xl border border-surface-700">
            <button
              onClick={() => setShowTrustedDevices(!showTrustedDevices)}
              className="w-full flex items-center justify-between"
            >
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-surface-700 rounded-lg">
                  <Monitor className="h-5 w-5 text-surface-400" />
                </div>
                <div className="text-left">
                  <h3 className="font-medium text-white">Trusted Devices</h3>
                  <p className="text-sm text-surface-400">
                    {trustedDevicesLoading
                      ? 'Loading...'
                      : `${trustedDevices.length} device${trustedDevices.length !== 1 ? 's' : ''} trusted`
                    }
                  </p>
                </div>
              </div>
              <motion.div
                animate={{ rotate: showTrustedDevices ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <svg className="h-5 w-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </motion.div>
            </button>

            <AnimatePresence>
              {showTrustedDevices && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="pt-4 mt-4 border-t border-surface-700 space-y-3">
                    {trustedDevicesLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-5 w-5 animate-spin text-primary-400" />
                      </div>
                    ) : trustedDevices.length === 0 ? (
                      <p className="text-sm text-surface-500 text-center py-4">
                        No trusted devices. Check "Trust this device" when logging in with 2FA.
                      </p>
                    ) : (
                      <>
                        {trustedDevices.map((device) => {
                          const DeviceIcon = getDeviceIcon(device.device_type);
                          const isRevoking = revokingDevice === device.id;

                          return (
                            <motion.div
                              key={device.id}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, x: -20 }}
                              className="p-3 bg-surface-900/50 rounded-lg border border-surface-700"
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex items-start space-x-3">
                                  <DeviceIcon className="h-5 w-5 text-surface-400 mt-0.5" />
                                  <div>
                                    <p className="text-sm font-medium text-white">
                                      {device.browser || 'Unknown browser'} on {device.os || 'Unknown OS'}
                                    </p>
                                    <div className="flex items-center space-x-3 mt-1 text-xs text-surface-500">
                                      {device.ip_address && (
                                        <span className="flex items-center space-x-1">
                                          <Globe className="h-3 w-3" />
                                          <span>{device.ip_address}</span>
                                        </span>
                                      )}
                                      {device.last_used && (
                                        <span className="flex items-center space-x-1">
                                          <Clock className="h-3 w-3" />
                                          <span>Last used {formatRelativeTime(device.last_used)}</span>
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <button
                                  onClick={() => revokeTrustedDevice(device.id)}
                                  disabled={isRevoking}
                                  className="text-xs text-danger hover:text-danger-light transition-colors disabled:opacity-50"
                                >
                                  {isRevoking ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    'Revoke'
                                  )}
                                </button>
                              </div>
                            </motion.div>
                          );
                        })}

                        {trustedDevices.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={Trash2}
                            onClick={revokeAllTrustedDevices}
                            loading={revokingAllDevices}
                            disabled={revokingAllDevices}
                            className="w-full text-danger hover:text-danger-light hover:bg-danger/10"
                          >
                            Revoke All Trusted Devices
                          </Button>
                        )}
                      </>
                    )}

                    <button
                      onClick={fetchTrustedDevices}
                      disabled={trustedDevicesLoading}
                      className="w-full text-center text-sm text-primary-400 hover:text-primary-300 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3 w-3 inline mr-1 ${trustedDevicesLoading ? 'animate-spin' : ''}`} />
                      Refresh list
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Disable 2FA Modal */}
        <AnimatePresence>
          {showDisableModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => {
                if (!loading) {
                  setShowDisableModal(false);
                  resetDisableModal();
                }
              }}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-surface-900 border border-danger/30 rounded-2xl max-w-md w-full overflow-hidden"
              >
                <div className="flex items-center justify-between p-6 border-b border-surface-800">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-danger/20 rounded-xl">
                      <Shield className="h-5 w-5 text-danger" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-white">Disable 2FA</h2>
                      <p className="text-sm text-surface-400">This will remove extra security</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setShowDisableModal(false);
                      resetDisableModal();
                    }}
                    disabled={loading}
                    className="p-2 text-surface-400 hover:text-white hover:bg-surface-800 rounded-lg transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="p-6 space-y-4">
                  <div className="p-3 bg-warning/10 border border-warning/30 rounded-xl">
                    <p className="text-sm text-warning">
                      Disabling 2FA will make your account less secure. You can always re-enable it later.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-surface-500" />
                      <input
                        type={showDisablePassword ? 'text' : 'password'}
                        value={disablePassword}
                        onChange={(e) => setDisablePassword(e.target.value)}
                        placeholder="Enter your password"
                        className="w-full pl-10 pr-12 py-3 bg-surface-800/50 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowDisablePassword(!showDisablePassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-white transition-colors"
                      >
                        {showDisablePassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Authentication Code
                    </label>
                    <TwoFactorCodeInput
                      value={disableCode}
                      onChange={setDisableCode}
                      error={!!disableError}
                    />
                    <p className="mt-2 text-xs text-surface-500 text-center">
                      Enter the code from your authenticator app
                    </p>
                  </div>

                  {disableError && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center space-x-2 text-danger text-sm"
                    >
                      <AlertCircle className="h-4 w-4" />
                      <span>{disableError}</span>
                    </motion.div>
                  )}

                  <div className="flex space-x-3 pt-2">
                    <Button
                      variant="ghost"
                      fullWidth
                      onClick={() => {
                        setShowDisableModal(false);
                        resetDisableModal();
                      }}
                      disabled={loading}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      fullWidth
                      onClick={disable2FA}
                      loading={loading}
                      disabled={!disablePassword || disableCode.length !== 6}
                    >
                      Disable 2FA
                    </Button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Regenerate Backup Codes Modal */}
        <AnimatePresence>
          {showRegenerateModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => {
                if (!loading) {
                  setShowRegenerateModal(false);
                  resetRegenerateModal();
                }
              }}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-surface-900 border border-surface-700 rounded-2xl max-w-md w-full overflow-hidden"
              >
                <div className="flex items-center justify-between p-6 border-b border-surface-800">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-primary-500/20 rounded-xl">
                      <Key className="h-5 w-5 text-primary-400" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-white">Backup Codes</h2>
                      <p className="text-sm text-surface-400">
                        {newBackupCodes.length > 0 ? 'Save your new codes' : 'Generate new backup codes'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setShowRegenerateModal(false);
                      resetRegenerateModal();
                    }}
                    disabled={loading}
                    className="p-2 text-surface-400 hover:text-white hover:bg-surface-800 rounded-lg transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="p-6 space-y-4">
                  {newBackupCodes.length === 0 ? (
                    <>
                      <div className="p-3 bg-warning/10 border border-warning/30 rounded-xl">
                        <p className="text-sm text-warning">
                          Generating new codes will invalidate all existing backup codes. Make sure to save the new ones.
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-surface-300 mb-2">
                          Confirm with Password
                        </label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-surface-500" />
                          <input
                            type={showRegeneratePassword ? 'text' : 'password'}
                            value={regeneratePassword}
                            onChange={(e) => setRegeneratePassword(e.target.value)}
                            placeholder="Enter your password"
                            className="w-full pl-10 pr-12 py-3 bg-surface-800/50 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-all"
                          />
                          <button
                            type="button"
                            onClick={() => setShowRegeneratePassword(!showRegeneratePassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-white transition-colors"
                          >
                            {showRegeneratePassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                          </button>
                        </div>
                      </div>

                      {regenerateError && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="flex items-center space-x-2 text-danger text-sm"
                        >
                          <AlertCircle className="h-4 w-4" />
                          <span>{regenerateError}</span>
                        </motion.div>
                      )}

                      <div className="flex space-x-3 pt-2">
                        <Button
                          variant="ghost"
                          fullWidth
                          onClick={() => {
                            setShowRegenerateModal(false);
                            resetRegenerateModal();
                          }}
                          disabled={loading}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          fullWidth
                          icon={RefreshCw}
                          onClick={regenerateBackupCodes}
                          loading={loading}
                          disabled={!regeneratePassword}
                        >
                          Generate New Codes
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="bg-surface-800/50 rounded-xl p-4 border border-surface-700">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-medium text-surface-300 flex items-center space-x-2">
                            <Key className="h-4 w-4" />
                            <span>New Backup Codes</span>
                          </span>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => copyToClipboard(newBackupCodes.join('\n'), 'backup')}
                              className="text-sm text-primary-400 hover:text-primary-300 flex items-center space-x-1 transition-colors"
                            >
                              {copiedBackup ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                              <span>{copiedBackup ? 'Copied!' : 'Copy'}</span>
                            </button>
                            <button
                              onClick={() => downloadBackupCodes(newBackupCodes)}
                              className="text-sm text-primary-400 hover:text-primary-300 flex items-center space-x-1 transition-colors"
                            >
                              <Download className="h-3 w-3" />
                              <span>Download</span>
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {newBackupCodes.map((code, index) => (
                            <code key={index} className="px-3 py-2 bg-surface-900 rounded-lg text-sm font-mono text-surface-300 text-center">
                              {code}
                            </code>
                          ))}
                        </div>
                      </div>

                      <div className="p-3 bg-warning/10 border border-warning/30 rounded-xl">
                        <p className="text-sm text-warning">
                          Store these codes in a safe place. Your old backup codes are now invalid.
                        </p>
                      </div>

                      <Button
                        variant="primary"
                        fullWidth
                        onClick={() => {
                          setShowRegenerateModal(false);
                          resetRegenerateModal();
                        }}
                      >
                        Done
                      </Button>
                    </>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }

  // Setup not started
  if (!showSetup) {
    return (
      <div className="p-4 bg-surface-800/50 rounded-xl border border-surface-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-warning/20 rounded-lg">
              <Shield className="h-5 w-5 text-warning" />
            </div>
            <div>
              <h3 className="font-medium text-white">Two-Factor Authentication</h3>
              <p className="text-sm text-surface-400">Add an extra layer of security to your account</p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={startSetup}
            loading={loading}
          >
            Enable
          </Button>
        </div>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 flex items-center space-x-2 text-danger text-sm"
          >
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </motion.div>
        )}
      </div>
    );
  }

  // Setup modal
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={closeSetup}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
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
              <h2 className="text-lg font-semibold text-white">Set Up 2FA</h2>
              <p className="text-sm text-surface-400">Step {setupStep} of 3</p>
            </div>
          </div>
          <button
            onClick={closeSetup}
            className="p-2 text-surface-400 hover:text-white hover:bg-surface-800 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-surface-800">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${(setupStep / 3) * 100}%` }}
            className="h-full bg-primary-500"
          />
        </div>

        <div className="p-6">
          <AnimatePresence mode="wait">
            {/* Step 1: Scan QR Code */}
            {setupStep === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="text-center">
                  <p className="text-surface-300 mb-4">
                    Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
                  </p>
                  <div className="inline-flex p-4 bg-white rounded-xl">
                    {qrCode ? (
                      <img src={qrCode} alt="2FA QR Code" className="w-48 h-48" />
                    ) : (
                      <div className="w-48 h-48 flex items-center justify-center">
                        <Loader2 className="h-12 w-12 text-surface-400 animate-spin" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-center">
                  <p className="text-sm text-surface-500 mb-2">Or enter this code manually:</p>
                  <div className="flex items-center justify-center space-x-2">
                    <code className="px-3 py-2 bg-surface-800 rounded-lg text-primary-400 font-mono text-sm break-all">
                      {secret || 'Loading...'}
                    </code>
                    <button
                      onClick={() => copyToClipboard(secret, 'secret')}
                      disabled={!secret}
                      className="p-2 text-surface-400 hover:text-white transition-colors disabled:opacity-50"
                    >
                      {copiedSecret ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  variant="primary"
                  fullWidth
                  onClick={() => setSetupStep(2)}
                  disabled={!qrCode || !secret}
                >
                  I've scanned the code
                </Button>
              </motion.div>
            )}

            {/* Step 2: Verify Code */}
            {setupStep === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="text-center">
                  <Smartphone className="h-12 w-12 text-primary-400 mx-auto mb-4" />
                  <p className="text-surface-300">
                    Enter the 6-digit code from your authenticator app
                  </p>
                </div>

                <TwoFactorCodeInput
                  value={verificationCode}
                  onChange={setVerificationCode}
                  onComplete={verifyAndEnable}
                  error={!!error}
                  autoFocus
                />

                {error && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center justify-center space-x-2 text-danger text-sm"
                  >
                    <AlertCircle className="h-4 w-4" />
                    <span>{error}</span>
                  </motion.div>
                )}

                <div className="flex space-x-3">
                  <Button
                    variant="ghost"
                    fullWidth
                    onClick={() => {
                      setSetupStep(1);
                      setVerificationCode('');
                      setError('');
                    }}
                  >
                    Back
                  </Button>
                  <Button
                    variant="primary"
                    fullWidth
                    onClick={verifyAndEnable}
                    loading={loading}
                    disabled={verificationCode.length !== 6}
                  >
                    Verify & Enable
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Step 3: Backup Codes */}
            {setupStep === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="text-center">
                  <div className="w-16 h-16 bg-success/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="h-8 w-8 text-success" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">2FA Enabled!</h3>
                  <p className="text-surface-400">
                    Save these backup codes in a secure place. You can use them to access your account if you lose your authenticator.
                  </p>
                </div>

                <div className="bg-surface-800/50 rounded-xl p-4 border border-surface-700">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-surface-300 flex items-center space-x-2">
                      <Key className="h-4 w-4" />
                      <span>Backup Codes</span>
                    </span>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => copyToClipboard(backupCodes.join('\n'), 'backup')}
                        className="text-sm text-primary-400 hover:text-primary-300 flex items-center space-x-1 transition-colors"
                      >
                        {copiedBackup ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        <span>{copiedBackup ? 'Copied!' : 'Copy'}</span>
                      </button>
                      <button
                        onClick={() => downloadBackupCodes(backupCodes)}
                        className="text-sm text-primary-400 hover:text-primary-300 flex items-center space-x-1 transition-colors"
                      >
                        <Download className="h-3 w-3" />
                        <span>Download</span>
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {backupCodes.map((code, index) => (
                      <code key={index} className="px-3 py-2 bg-surface-900 rounded-lg text-sm font-mono text-surface-300 text-center">
                        {code}
                      </code>
                    ))}
                  </div>
                </div>

                <div className="p-3 bg-warning/10 border border-warning/30 rounded-xl">
                  <p className="text-sm text-warning">
                    Each code can only be used once. Store them securely!
                  </p>
                </div>

                <Button
                  variant="primary"
                  fullWidth
                  onClick={closeSetup}
                >
                  Done
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
