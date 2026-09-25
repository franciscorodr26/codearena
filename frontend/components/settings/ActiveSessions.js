import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Monitor,
  Smartphone,
  Tablet,
  Globe,
  MapPin,
  Clock,
  LogOut,
  Shield,
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCw
} from 'lucide-react';
import Button from '../ui/Button';
import { config } from '../../config/env';
import { fetchWithTimeout } from '../../utils/fetch';

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

export default function ActiveSessions({ token }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const [success, setSuccess] = useState('');

  // Fetch active sessions
  const fetchSessions = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/auth/sessions`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      } else {
        // If endpoint fails, show current session without location
        setSessions([
          {
            id: 'current',
            device_type: 'desktop',
            browser: 'This browser',
            os: 'Current device',
            location: null,
            last_active: new Date().toISOString(),
            is_current: true
          }
        ]);
      }
    } catch (err) {
      // Show current session as fallback
      setSessions([
        {
          id: 'current',
          device_type: 'desktop',
          browser: 'This browser',
          os: 'Current device',
          location: null,
          last_active: new Date().toISOString(),
          is_current: true
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchSessions();
    }
  }, [token]);

  // Revoke a specific session
  const revokeSession = async (sessionId) => {
    setRevoking(sessionId);
    setError('');
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/auth/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.ok) {
        setSessions(prev => prev.filter(s => s.id !== sessionId));
        setSuccess('Session revoked successfully');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError('Failed to revoke session');
      }
    } catch (err) {
      setError('Failed to revoke session');
    } finally {
      setRevoking(null);
    }
  };

  // Revoke all other sessions
  const revokeAllOther = async () => {
    setRevokingAll(true);
    setError('');
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/auth/sessions/revoke-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.ok) {
        setSessions(prev => prev.filter(s => s.is_current));
        setSuccess('All other sessions signed out');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError('Failed to sign out other sessions');
      }
    } catch (err) {
      setError('Failed to sign out other sessions');
    } finally {
      setRevokingAll(false);
    }
  };

  const otherSessions = sessions.filter(s => !s.is_current);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Globe className="h-4 w-4 text-surface-400" />
          <span className="text-sm text-surface-400">
            {sessions.length} active session{sessions.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={fetchSessions}
          disabled={loading}
          className="text-sm text-primary-400 hover:text-primary-300 flex items-center space-x-1 transition-colors"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Success/Error messages */}
      <AnimatePresence>
        {success && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center space-x-2 text-success bg-success/10 border border-success/30 rounded-xl p-3"
          >
            <CheckCircle className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">{success}</span>
          </motion.div>
        )}
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

      {/* Sessions list */}
      <div className="space-y-3">
        {sessions.map((session) => {
          const DeviceIcon = getDeviceIcon(session.device_type);
          const isRevoking = revoking === session.id;

          return (
            <motion.div
              key={session.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className={`p-4 rounded-xl border transition-all ${
                session.is_current
                  ? 'bg-primary-500/10 border-primary-500/30'
                  : 'bg-surface-800/50 border-surface-700 hover:border-surface-600'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-3">
                  <div className={`p-2 rounded-lg ${session.is_current ? 'bg-primary-500/20' : 'bg-surface-700'}`}>
                    <DeviceIcon className={`h-5 w-5 ${session.is_current ? 'text-primary-400' : 'text-surface-400'}`} />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-medium text-white">
                        {session.browser || 'Unknown browser'}
                      </span>
                      {session.is_current && (
                        <span className="text-[10px] font-bold text-primary-400 bg-primary-500/20 px-1.5 py-0.5 rounded">
                          THIS DEVICE
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-surface-400 mt-0.5">
                      {session.os || 'Unknown OS'}
                    </p>
                    <div className="flex items-center space-x-4 mt-2 text-xs text-surface-500">
                      {session.location && (
                        <span className="flex items-center space-x-1">
                          <MapPin className="h-3 w-3" />
                          <span>{session.location}</span>
                        </span>
                      )}
                      <span className="flex items-center space-x-1">
                        <Clock className="h-3 w-3" />
                        <span>{formatRelativeTime(session.last_active)}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {!session.is_current && (
                  <button
                    onClick={() => revokeSession(session.id)}
                    disabled={isRevoking}
                    className="text-sm text-danger hover:text-danger-light flex items-center space-x-1 transition-colors disabled:opacity-50"
                  >
                    {isRevoking ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <LogOut className="h-4 w-4" />
                        <span>Sign out</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Sign out all other sessions */}
      {otherSessions.length > 0 && (
        <Button
          variant="secondary"
          size="sm"
          icon={LogOut}
          onClick={revokeAllOther}
          loading={revokingAll}
          disabled={revokingAll}
          className="w-full"
        >
          Sign out all other sessions ({otherSessions.length})
        </Button>
      )}
    </div>
  );
}
