import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import { config } from '../config/env';
import { trackLogin, trackSignup, trackLogout, trackSessionStart, identifyUser } from '../utils/analytics';
import { fetchWithTimeout, AUTH_ERROR_EVENT } from '../utils/fetch';
import { generateBrowserFingerprint } from '../utils/browserFingerprint';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // Ref for user to avoid callback recreation on user changes
  const userRef = useRef(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Initialize auth: saved session, or local dev auto-login (NEXT_PUBLIC_CODEARENA_DEV_AUTO_LOGIN)
  useEffect(() => {
    let cancelled = false;

    const setDone = () => {
      if (!cancelled) setLoading(false);
    };

    (async () => {
      // Track the storage that supplied the active session. Freshness and
      // invalidation checks must use the same store for non-remembered logins.
      let storage = localStorage;
      let storedToken = localStorage.getItem('auth_token');
      let storedUser = localStorage.getItem('auth_user');

      if (!storedToken || !storedUser) {
        storage = sessionStorage;
        storedToken = sessionStorage.getItem('auth_token');
        storedUser = sessionStorage.getItem('auth_user');
      }

      if (storedToken && storedUser) {
        try {
          const parsedUser = JSON.parse(storedUser);
          setToken(storedToken);
          setUser(parsedUser);
          trackSessionStart(parsedUser, { sessionType: 'returning' });

          fetchWithTimeout(`${config.backend_url}/auth/me`, {
            headers: { Authorization: `Bearer ${storedToken}` }
          }).then((res) => {
            if (res.ok) return res.json();
            if (res.status === 401) {
              if (storage.getItem('auth_token') === storedToken) {
                setToken(null);
                setUser(null);
                localStorage.removeItem('auth_token');
                localStorage.removeItem('auth_user');
                sessionStorage.removeItem('auth_token');
                sessionStorage.removeItem('auth_user');
              }
            }
            return null;
          }).then((data) => {
            if (data?.user) {
              if (storage.getItem('auth_token') === storedToken) {
                const newUserJson = JSON.stringify(data.user);
                const currentUserJson = storage.getItem('auth_user');
                if (newUserJson !== currentUserJson) {
                  setUser(data.user);
                  storage.setItem('auth_user', newUserJson);
                }
              }
            }
          }).catch(() => {});
        } catch (e) {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('auth_user');
          sessionStorage.removeItem('auth_token');
          sessionStorage.removeItem('auth_user');
        }
        setDone();
        return;
      }

      const devAuto =
        typeof process !== 'undefined' &&
        process.env.NEXT_PUBLIC_CODEARENA_DEV_AUTO_LOGIN === '1';

      if (devAuto) {
        try {
          const slotRaw = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_CODEARENA_DEV_LOGIN_SLOT : '';
          const slot = Number(slotRaw) === 2 ? 2 : 1;
          const res = await fetchWithTimeout(`${config.backend_url}/auth/dev-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slot })
          });
          const data = await res.json().catch(() => null);
          if (!cancelled && res.ok && data?.token && data?.user) {
            setToken(data.token);
            setUser(data.user);
            localStorage.setItem('auth_token', data.token);
            localStorage.setItem('auth_user', JSON.stringify(data.user));
            trackSessionStart(data.user, { sessionType: 'returning' });
          }
        } catch (_) {
          /* dev backend may be down, stay logged out */
        }
        setDone();
        return;
      }

      setDone();
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username, password, rememberMe = false, trustedDeviceToken = null) => {
    const response = await fetchWithTimeout(`${config.backend_url}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password, rememberMe, deviceToken: trustedDeviceToken }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }

    // Check if 2FA is required
    if (data.requires2FA) {
      // Return the pending token and signal that 2FA is required
      // The login page will handle showing the 2FA verification UI
      return {
        requires2FA: true,
        tempToken: data.pendingToken,
        email: data.email
      };
    }

    // Get user data from response (includes username, avatar, and Pro status)
    const userData = data.user || {
      id: data.user?.id,
      email: data.user?.email,
      username: data.user?.username,
      avatar: data.user?.avatar || 'default-1',
      is_pro: data.user?.is_pro || false,
      is_admin: data.user?.is_admin || false
    };

    // Fallback: decode JWT if user not in response
    if (!userData.id && data.token) {
      try {
        const tokenParts = data.token.split('.');
        if (tokenParts.length === 3) {
          const payload = JSON.parse(atob(tokenParts[1]));
          userData.id = payload.sub;
          userData.email = payload.email;
          userData.username = payload.username;
          userData.avatar = payload.avatar || 'default-1';
          userData.is_admin = payload.is_admin || false;
        }
      } catch (e) {
        console.error('Failed to decode JWT token:', e);
        throw new Error('Invalid authentication token');
      }
    }

    setToken(data.token);
    setUser(userData);

    // Always use localStorage so auth persists across tabs (JWT expiration controls session lifetime)
    localStorage.setItem('auth_token', data.token);
    localStorage.setItem('auth_user', JSON.stringify(userData));
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('auth_user');
    localStorage.setItem('session_start_time', Date.now().toString());

    // Track login event and identify user in analytics
    trackLogin(userData);
    trackSessionStart(userData, { sessionType: 'new_login' });
    identifyUser(userData);

    return userData;
  }, []);

  const loginWithGoogle = useCallback(async (credential, rememberMe = false, trustedDeviceToken = null) => {
    const response = await fetchWithTimeout(`${config.backend_url}/auth/google`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ credential, rememberMe, deviceToken: trustedDeviceToken }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Google login failed');
    }

    // Check if 2FA is required
    if (data.requires2FA) {
      return {
        requires2FA: true,
        tempToken: data.pendingToken,
        email: data.email
      };
    }

    const userData = data.user || {
      id: data.user?.id,
      email: data.user?.email,
      username: data.user?.username,
      avatar: data.user?.avatar || 'default-1',
      is_pro: data.user?.is_pro || false,
      is_admin: data.user?.is_admin || false
    };

    setToken(data.token);
    setUser(userData);

    // Always use localStorage so auth persists across tabs (JWT expiration controls session lifetime)
    localStorage.setItem('auth_token', data.token);
    localStorage.setItem('auth_user', JSON.stringify(userData));
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('auth_user');
    localStorage.setItem('session_start_time', Date.now().toString());

    // Track login event and identify user in analytics
    if (data.isNewUser) {
      trackSignup(userData.id, { username: userData.username, email: userData.email, method: 'google' });
      trackSessionStart(userData, { sessionType: 'google_signup' });
    } else {
      trackLogin(userData);
      trackSessionStart(userData, { sessionType: 'google_login' });
    }
    identifyUser(userData);

    return { userData, isNewUser: data.isNewUser };
  }, []);

  const loginWithGitHub = useCallback(async (code, rememberMe = false, trustedDeviceToken = null) => {
    const response = await fetchWithTimeout(`${config.backend_url}/auth/github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code, rememberMe, deviceToken: trustedDeviceToken }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'GitHub login failed');
    }

    // Check if 2FA is required
    if (data.requires2FA) {
      return {
        requires2FA: true,
        tempToken: data.pendingToken,
        email: data.email
      };
    }

    const userData = data.user || {
      id: data.user?.id,
      email: data.user?.email,
      username: data.user?.username,
      avatar: data.user?.avatar || 'default-1',
      is_pro: data.user?.is_pro || false,
      is_admin: data.user?.is_admin || false
    };

    setToken(data.token);
    setUser(userData);

    // Always use localStorage so auth persists across tabs (JWT expiration controls session lifetime)
    localStorage.setItem('auth_token', data.token);
    localStorage.setItem('auth_user', JSON.stringify(userData));
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('auth_user');
    localStorage.setItem('session_start_time', Date.now().toString());

    // Track login event and identify user in analytics
    if (data.isNewUser) {
      trackSignup(userData.id, { username: userData.username, email: userData.email, method: 'github' });
      trackSessionStart(userData, { sessionType: 'github_signup' });
    } else {
      trackLogin(userData);
      trackSessionStart(userData, { sessionType: 'github_login' });
    }
    identifyUser(userData);

    return { userData, isNewUser: data.isNewUser };
  }, []);

  // Complete 2FA login after user has verified their 2FA code
  // Called from the login page after successful 2FA verification
  const complete2FALogin = useCallback(async (authToken, userData, rememberMe = false) => {
    setToken(authToken);
    setUser(userData);

    // Always use localStorage so auth persists across tabs (JWT expiration controls session lifetime)
    localStorage.setItem('auth_token', authToken);
    localStorage.setItem('auth_user', JSON.stringify(userData));
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('auth_user');
    localStorage.setItem('session_start_time', Date.now().toString());

    // Track login event and identify user in analytics
    trackLogin(userData);
    trackSessionStart(userData, { sessionType: '2fa_login' });
    identifyUser(userData);

    return userData;
  }, []);

  const register = useCallback(async (email, password, username, avatar = 'default-1', emailOptIn = true, socialLinks = {}, referralCode = null) => {
    // Generate device fingerprint for smurf detection
    const deviceFingerprint = await generateBrowserFingerprint().catch(() => null);

    const response = await fetchWithTimeout(`${config.backend_url}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        username,
        avatar,
        emailOptIn,
        deviceFingerprint,
        linkedin_url: socialLinks.linkedin || null,
        github_url: socialLinks.github || null,
        twitter_url: socialLinks.twitter || null,
        referralCode: referralCode || null
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Registration failed');
    }

    // Track signup event
    if (data.user) {
      trackSignup(data.user.id, {
        username: data.user.username,
        email: data.user.email
      });
    }

    return data;
  }, []);

  const logout = useCallback(() => {
    const activeToken = token || localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');

    if (activeToken) {
      fetchWithTimeout(`${config.backend_url}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${activeToken}` }
      }).catch(() => {});
    }

    // Calculate session duration for analytics
    const sessionStart = localStorage.getItem('session_start_time');
    let sessionDurationSeconds = null;
    if (sessionStart) {
      sessionDurationSeconds = Math.floor((Date.now() - parseInt(sessionStart, 10)) / 1000);
    }

    // Track logout before clearing user data (use ref to avoid callback recreation)
    trackLogout({ sessionDurationSeconds }, userRef.current);

    setToken(null);
    setUser(null);
    // Clear both storages
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    localStorage.removeItem('session_start_time');
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('auth_user');
    // Clear any stored redirect paths to prevent stale redirects
    sessionStorage.removeItem('redirectAfterLogin');
    // Clear cookie consent so next user sees their own banner
    localStorage.removeItem('codearena_cookie_consent');
  }, [token]);

  // Listen for auth errors (401) from fetch utilities and trigger logout
  useEffect(() => {
    const handleAuthError = (event) => {
      const message = event.detail?.message || 'Session expired';
      console.warn('[Auth] Session invalidated:', message);

      // Clear auth state
      setToken(null);
      setUser(null);
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      sessionStorage.removeItem('auth_token');
      sessionStorage.removeItem('auth_user');

      // Store the message to show on login page
      sessionStorage.setItem('auth_error_message', message);

      // Redirect to login (if not already there)
      if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
        window.location.href = '/login?expired=1';
      }
    };

    window.addEventListener(AUTH_ERROR_EVENT, handleAuthError);
    return () => window.removeEventListener(AUTH_ERROR_EVENT, handleAuthError);
  }, []);

  const checkUsernameAvailability = useCallback(async (username) => {
    if (!username || username.length < 3) {
      return { available: false, reason: 'Username must be at least 3 characters' };
    }

    try {
      const response = await fetchWithTimeout(
        `${config.backend_url}/auth/check-username/${encodeURIComponent(username)}`,
        {},
        5000 // Shorter timeout for mobile
      );
      // Handle rate limiting gracefully - allow submission, server will validate
      if (response.status === 429) {
        return { available: true, reason: null, rateLimited: true };
      }
      const data = await response.json().catch(() => ({}));
      return data;
    } catch (err) {
      // On network error, allow form submission - server will validate
      console.warn('Username check failed, allowing form submission:', err.message);
      return { available: true, reason: null, networkError: true };
    }
  }, []);

  const updateProfile = useCallback(async ({ username, avatar, bio, github_url, linkedin_url, twitter_url }) => {
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetchWithTimeout(`${config.backend_url}/auth/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ username, avatar, bio, github_url, linkedin_url, twitter_url }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update profile');
    }

    // Update stored token and user in whichever storage is being used
    if (data.token) {
      setToken(data.token);
      localStorage.setItem('auth_token', data.token);
    }

    if (data.user) {
      setUser(data.user);
      localStorage.setItem('auth_user', JSON.stringify(data.user));
    }

    return data;
  }, [token]);

  const getProfile = useCallback(async () => {
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetchWithTimeout(`${config.backend_url}/auth/me`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get profile');
    }

    return data;
  }, [token]);

  // Refresh user data from server (useful after Pro subscription changes)
  const refreshUser = useCallback(async () => {
    if (!token) return null;

    try {
      const response = await fetchWithTimeout(`${config.backend_url}/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        const userData = data.user || data;
        setUser(userData);
        // Update whichever storage has the token
        localStorage.setItem('auth_user', JSON.stringify(userData));
        return userData;
      }
    } catch (err) {
      console.error('Failed to refresh user:', err);
    }
    return null;
  }, [token]);

  const forgotPassword = useCallback(async (email) => {
    const response = await fetchWithTimeout(`${config.backend_url}/auth/forgot-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Failed to send reset email');
    }

    return data;
  }, []);

  const resetPassword = useCallback(async (resetToken, password) => {
    const response = await fetchWithTimeout(`${config.backend_url}/auth/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: resetToken, password }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Failed to reset password');
    }

    return data;
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetchWithTimeout(`${config.backend_url}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Failed to change password');
    }

    return data;
  }, [token]);

  // Set password for Google OAuth users who don't have one
  const setPassword = useCallback(async (newPassword) => {
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetchWithTimeout(`${config.backend_url}/auth/set-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ newPassword }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Failed to set password');
    }

    return data;
  }, [token]);

  const initiateEmailChange = useCallback(async (newEmail, password) => {
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetchWithTimeout(`${config.backend_url}/auth/change-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ newEmail, password }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Failed to initiate email change');
    }

    return data;
  }, [token]);

  const verifyEmailChange = useCallback(async (verificationToken) => {
    const response = await fetchWithTimeout(`${config.backend_url}/auth/verify-email-change`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: verificationToken }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Failed to verify email change');
    }

    // Update stored token and user if returned
    if (data.token) {
      setToken(data.token);
      localStorage.setItem('auth_token', data.token);
    }

    if (data.user) {
      setUser(data.user);
      localStorage.setItem('auth_user', JSON.stringify(data.user));
    }

    return data;
  }, []);

  // Verify email for new account registration
  const verifyEmail = useCallback(async (verificationToken) => {
    const response = await fetchWithTimeout(`${config.backend_url}/auth/verify-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: verificationToken }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Failed to verify email');
    }

    return data;
  }, []);

  // Resend verification email
  const resendVerificationEmail = useCallback(async (email) => {
    const response = await fetchWithTimeout(`${config.backend_url}/auth/resend-verification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Failed to resend verification email');
    }

    return data;
  }, []);

  // Mark the current user's email as verified (updates state + storage without server round-trip)
  const setEmailVerified = useCallback(() => {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, email_verified: true };
      localStorage.setItem('auth_user', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const searchUsers = useCallback(async (query, limit = 20) => {
    if (!query || query.length < 2) {
      return [];
    }

    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    const response = await fetchWithTimeout(
      `${config.backend_url}/api/users/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      { headers },
      15000 // Shorter timeout for search
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Failed to search users');
    }

    return data.users || [];
  }, [token]);

  const getLeaderboard = useCallback(async (limit = 50, offset = 0) => {
    const response = await fetchWithTimeout(
      `${config.backend_url}/api/users/leaderboard?limit=${limit}&offset=${offset}`,
      {},
      15000 // Shorter timeout for leaderboard
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get leaderboard');
    }

    return data.leaderboard || [];
  }, []);

  // Memoize provider value so consumers don't re-render on every AuthProvider
  // render. All functions below are already useCallback-wrapped, so their
  // references are stable across renders unless their own deps change.
  const value = useMemo(() => ({
    user,
    token,
    loading,
    isAuthenticated: !!user,
    login,
    loginWithGoogle,
    loginWithGitHub,
    complete2FALogin,
    register,
    logout,
    checkUsernameAvailability,
    updateProfile,
    getProfile,
    refreshUser,
    forgotPassword,
    resetPassword,
    changePassword,
    setPassword,
    initiateEmailChange,
    verifyEmailChange,
    verifyEmail,
    resendVerificationEmail,
    setEmailVerified,
    searchUsers,
    getLeaderboard,
  }), [
    user,
    token,
    loading,
    login,
    loginWithGoogle,
    loginWithGitHub,
    complete2FALogin,
    register,
    logout,
    checkUsernameAvailability,
    updateProfile,
    getProfile,
    refreshUser,
    forgotPassword,
    resetPassword,
    changePassword,
    setPassword,
    initiateEmailChange,
    verifyEmailChange,
    verifyEmail,
    resendVerificationEmail,
    setEmailVerified,
    searchUsers,
    getLeaderboard,
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
