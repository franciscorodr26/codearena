import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { motion } from 'framer-motion';
import { User, Check, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { config } from '../config/env';
import Button from '../components/ui/Button';
import { postAuthDestination } from '../utils/authRedirect';

export default function CompleteProfile() {
  const router = useRouter();
  const { user, token, refreshUser, loading: authLoading } = useAuth();

  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [usernameSuccess, setUsernameSuccess] = useState(false);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState('');
  const [isPageLoading, setIsPageLoading] = useState(true);

  // Redirect if not logged in or already chose username
  useEffect(() => {
    // Wait for auth to finish loading
    if (authLoading) return;

    if (!token) {
      router.push('/login');
      return;
    }

    // Check if user needs to choose username
    const checkProfile = async () => {
      try {
        const res = await fetch(`${config.backend_url}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          // Only new Google users (username_chosen === 0) need this page
          if (data.user.username_chosen !== 0) {
            router.push(postAuthDestination(data.user));
          } else {
            // Pre-fill username with current one (auto-generated player_xxxxx)
            setUsername(data.user.username || '');
            setIsPageLoading(false);
          }
        } else {
          setIsPageLoading(false);
        }
      } catch (err) {
        console.error('Failed to check profile:', err);
        setIsPageLoading(false);
      }
    };

    checkProfile();
  }, [token, authLoading, router]);

  // Debounced username validation
  useEffect(() => {
    if (!username) {
      setUsernameError('');
      setUsernameSuccess(false);
      return;
    }

    // Basic validation
    if (username.length < 3) {
      setUsernameError('Username must be at least 3 characters');
      setUsernameSuccess(false);
      return;
    }
    if (username.length > 20) {
      setUsernameError('Username must be 20 characters or less');
      setUsernameSuccess(false);
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setUsernameError('Only letters, numbers, and underscores allowed');
      setUsernameSuccess(false);
      return;
    }

    const reserved = ['admin', 'administrator', 'moderator', 'mod', 'support', 'help', 'codearena', 'system'];
    if (reserved.includes(username.toLowerCase())) {
      setUsernameError('This username is reserved');
      setUsernameSuccess(false);
      return;
    }

    // Check availability
    setIsCheckingUsername(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`${config.backend_url}/auth/check-username?username=${encodeURIComponent(username)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        // Handle rate limiting gracefully - allow submission, server will validate
        if (res.status === 429) {
          setUsernameError('');
          setUsernameSuccess(false);
          return;
        }
        const data = await res.json();
        if (data.available) {
          setUsernameError('');
          setUsernameSuccess(true);
        } else {
          setUsernameError(data.reason || 'This username is already taken');
          setUsernameSuccess(false);
        }
      } catch (err) {
        setUsernameError('');
        setUsernameSuccess(false);
      } finally {
        setIsCheckingUsername(false);
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [username, token]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!username || usernameError) {
      return;
    }

    setIsSubmitting(true);
    setGeneralError('');

    try {
      // Update username (this also sets username_chosen = true)
      const res = await fetch(`${config.backend_url}/auth/me`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ username })
      });

      if (res.ok) {
        // Refresh user data and redirect to dashboard
        if (refreshUser) {
          await refreshUser();
        }
        router.push(postAuthDestination({ ...user, username_chosen: 1 }));
      } else {
        const data = await res.json();
        setGeneralError(data.error || 'Failed to save username');
      }
    } catch (err) {
      setGeneralError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = username && !usernameError && usernameSuccess;

  // Show loading while auth is loading or checking profile
  if (authLoading || isPageLoading) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-primary-400 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Choose Your Username | CodeArena</title>
      </Head>

      <div className="min-h-screen bg-surface-950 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="bg-surface-900 rounded-2xl border border-surface-700 p-8 shadow-xl">
            {/* Header */}
            <div className="text-center mb-8">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', damping: 15 }}
                className="w-16 h-16 bg-gradient-to-br from-primary-500 to-secondary-600 rounded-2xl flex items-center justify-center mx-auto mb-4"
              >
                <User className="w-8 h-8 text-white" />
              </motion.div>
              <h1 className="text-2xl font-bold text-white mb-2">Choose Your Username</h1>
              <p className="text-surface-400 text-sm">This is how other players will see you in battles</p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Username */}
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-2">Username</label>
                <div className="relative">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    placeholder="Enter your username"
                    maxLength={20}
                    autoFocus
                    className={`w-full px-4 py-3 bg-surface-800 border rounded-lg text-white placeholder-surface-500 focus:outline-none focus:ring-2 transition-all ${
                      usernameError
                        ? 'border-red-500 focus:ring-red-500/50'
                        : usernameSuccess
                        ? 'border-green-500 focus:ring-green-500/50'
                        : 'border-surface-600 focus:ring-primary-500/50'
                    }`}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {isCheckingUsername ? (
                      <Loader2 className="h-5 w-5 text-surface-400 animate-spin" />
                    ) : usernameSuccess ? (
                      <Check className="h-5 w-5 text-green-500" />
                    ) : usernameError ? (
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    ) : null}
                  </div>
                </div>
                {usernameError && (
                  <p className="text-red-400 text-xs mt-2">{usernameError}</p>
                )}
                {usernameSuccess && (
                  <p className="text-green-400 text-xs mt-2">Username is available!</p>
                )}
                <p className="text-surface-500 text-xs mt-2">3-20 characters, letters, numbers, and underscores only</p>
              </div>

              {/* General Error */}
              {generalError && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3">
                  <p className="text-red-400 text-sm">{generalError}</p>
                </div>
              )}

              {/* Submit Button */}
              <Button
                type="submit"
                variant="primary"
                disabled={!isFormValid || isSubmitting}
                className="w-full py-3"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Continue'
                )}
              </Button>
            </form>
          </div>
        </motion.div>
      </div>
    </>
  );
}
