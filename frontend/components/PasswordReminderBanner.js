import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, X, ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { config } from '../config/env';

const DISMISSED_KEY = 'password_reminder_dismissed';

export default function PasswordReminderBanner() {
  const router = useRouter();
  const { user, token, isAuthenticated } = useAuth();
  const [showBanner, setShowBanner] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

  // Hide banner when user logs out
  useEffect(() => {
    if (!isAuthenticated || !token) {
      setShowBanner(false);
      setHasChecked(false);
    }
  }, [isAuthenticated, token]);

  useEffect(() => {
    // Only check once and only for authenticated users
    if (hasChecked || !isAuthenticated || !token) return;

    // Check if already dismissed
    if (typeof window !== 'undefined') {
      const dismissed = localStorage.getItem(DISMISSED_KEY);
      if (dismissed === 'true') {
        setHasChecked(true);
        return;
      }
    }

    // Check if user has a password
    const checkPasswordStatus = async () => {
      try {
        const res = await fetch(`${config.backend_url}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          // has_password is false for Google users who haven't set one
          if (data.user.has_password === false) {
            setShowBanner(true);
          }
        }
      } catch (err) {
        console.error('Failed to check password status:', err);
      } finally {
        setHasChecked(true);
      }
    };

    checkPasswordStatus();
  }, [isAuthenticated, token, hasChecked]);

  const handleDismiss = () => {
    setShowBanner(false);
    if (typeof window !== 'undefined') {
      localStorage.setItem(DISMISSED_KEY, 'true');
    }
  };

  const handleSetPassword = () => {
    router.push('/settings/profile');
  };

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          initial={{ opacity: 0, y: -50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -50 }}
          transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          className="relative bg-gradient-to-r from-primary-600 via-secondary-500 to-primary-600 bg-[length:200%_100%] animate-gradient-x border-b border-white/20 overflow-hidden"
        >
          {/* Shimmer overlay */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full animate-shimmer" />

          <div className="relative max-w-7xl mx-auto px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <motion.div
                className="flex items-center gap-3"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
              >
                <motion.div
                  className="p-2 bg-white/20 rounded-xl shadow-lg"
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                >
                  <Shield className="h-5 w-5 text-white drop-shadow-md" />
                </motion.div>
                <p className="text-sm text-white font-medium drop-shadow-sm">
                  <span className="hidden sm:inline">Secure your account: </span>
                  Set a password to log in with email/password too
                </p>
              </motion.div>
              <motion.div
                className="flex items-center gap-2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
              >
                <motion.button
                  onClick={handleSetPassword}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="flex items-center gap-1 px-4 py-2 bg-white/25 hover:bg-white/35 rounded-xl text-sm font-semibold text-white transition-all shadow-lg backdrop-blur-sm border border-white/20"
                >
                  Set Password
                  <ChevronRight className="h-4 w-4" />
                </motion.button>
                <motion.button
                  onClick={handleDismiss}
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  className="p-2 hover:bg-white/20 rounded-xl text-white/70 hover:text-white transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" />
                </motion.button>
              </motion.div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
