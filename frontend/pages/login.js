import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Logo from '../components/Logo';
import { useRouter } from 'next/router';
import { AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { trackViewLoginForm, trackLoginError } from '../utils/analytics';
import { config } from '../config/env';
import Button from '../components/ui/Button';
import GoogleSignInButton from '../components/GoogleSignInButton';
import GitHubSignInButton from '../components/GitHubSignInButton';
import TwoFactorLogin, { getTrustedDeviceToken } from '../components/TwoFactorLogin';
import { saveAuthRedirect, postAuthDestination } from '../utils/authRedirect';

export default function Login() {
  const router = useRouter();
  const { login, loginWithGoogle, complete2FALogin, user, token, isAuthenticated, loading: authLoading } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  // 2FA state
  const [requires2FA, setRequires2FA] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [twoFAUsername, setTwoFAUsername] = useState('');

  // Track page view on mount and store redirect param
  useEffect(() => {
    if (!router.isReady) return;
    trackViewLoginForm();
    // Store redirect param from URL if present (e.g., from pricing page)
    if (router.query.redirect) {
      saveAuthRedirect(router.query.redirect);
    }
    // Check for auth error message (from 401 redirect)
    let authErrorMessage;
    try {
      authErrorMessage = sessionStorage.getItem('auth_error_message');
      sessionStorage.removeItem('auth_error_message');
    } catch { /* Storage restrictions must not break the login form. */ }
    if (authErrorMessage || router.query.expired) {
      setError(authErrorMessage || 'Your session has expired. Please log in again.');
    }
  }, [router.isReady, router.query.redirect, router.query.expired]);

  // Redirect if already authenticated (wait for router.isReady so redirect param is stored first)
  useEffect(() => {
    if (!router.isReady) return;
    if (!authLoading && isAuthenticated && token) {
      router.replace(postAuthDestination(user));
    }
  }, [router.isReady, isAuthenticated, authLoading, router, user, token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLoading) return; // Prevent double-click
    setError('');
    setIsLoading(true);

    try {
      // Get trusted device token if available
      const trustedDeviceToken = getTrustedDeviceToken();

      // Login sets isAuthenticated=true, which triggers the useEffect redirect above
      // OR returns a 2FA required response
      const result = await login(username, password, rememberMe, trustedDeviceToken);

      // Check if 2FA is required
      if (result?.requires2FA) {
        setRequires2FA(true);
        setTempToken(result.tempToken);
        setTwoFAUsername(username);
      }
      // If no 2FA required, the login function already set auth state
      // and the useEffect will handle redirect
    } catch (err) {
      const errorMessage = err.message || 'Invalid username or password';
      setError(errorMessage);
      trackLoginError({
        errorType: 'login_failed',
        errorMessage,
        username
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSuccess = async (credential) => {
    if (isGoogleLoading || isLoading) return; // Prevent double-click
    setError('');
    setIsGoogleLoading(true);

    try {
      // Get trusted device token if available
      const trustedDeviceToken = getTrustedDeviceToken();

      const result = await loginWithGoogle(credential, rememberMe, trustedDeviceToken);

      // Check if 2FA is required for Google login
      if (result?.requires2FA) {
        setRequires2FA(true);
        setTempToken(result.tempToken);
        setTwoFAUsername(result.email || 'Google User');
        setIsGoogleLoading(false);
        return;
      }

      // The auth-state effect handles onboarding and the intended destination.
    } catch (err) {
      const errorMessage = err.message || 'Google sign-in failed';
      setError(errorMessage);
      trackLoginError({
        errorType: 'google_login_failed',
        errorMessage
      });
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleGoogleError = (err) => {
    console.error('Google Sign-In Error:', err);
    setError('Google sign-in failed. Please try again.');
  };

  // Handle successful 2FA verification
  const handle2FASuccess = async ({ token, user: userData }) => {
    try {
      // Complete the 2FA login in AuthContext
      await complete2FALogin(token, userData, rememberMe);
      // The useEffect will handle redirect when isAuthenticated changes
    } catch (err) {
      setError('Failed to complete login. Please try again.');
      setRequires2FA(false);
      setTempToken('');
    }
  };

  // Handle 2FA cancel - go back to login form
  const handle2FACancel = () => {
    setRequires2FA(false);
    setTempToken('');
    setTwoFAUsername('');
    setPassword('');
    setError('');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-surface-400 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Login - CodeArena</title>
        <meta name="description" content="Sign in to CodeArena to practice coding and prompting, compete in live battles, create games, and connect with developers." />
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="min-h-screen bg-surface-950 text-white flex flex-col">
        {/* Header */}
        <header className="px-6 py-6">
          <nav className="max-w-7xl mx-auto">
            <Link href="/" className="inline-block">
              <Logo />
            </Link>
          </nav>
        </header>

        {/* Login Form */}
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">
            <div className="bg-surface-900 border border-surface-800 rounded-2xl p-8">
              <AnimatePresence mode="wait">
                {requires2FA ? (
                  <TwoFactorLogin
                    key="2fa"
                    tempToken={tempToken}
                    username={twoFAUsername}
                    onSuccess={handle2FASuccess}
                    onCancel={handle2FACancel}
                    rememberMe={rememberMe}
                  />
                ) : (
                  <div key="login">
                    {/* Header */}
                    <div className="text-center mb-8">
                      <h1 className="text-3xl font-bold text-white">
                        {router.query.welcome === 'new' ? 'Welcome!' : 'Welcome Back'}
                      </h1>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                      {/* Username or Email Input */}
                      <div>
                        <label htmlFor="username" className="block text-sm font-medium text-surface-300 mb-2">
                          Username or Email
                        </label>
                        <input
                          id="username"
                          name="username"
                          type="text"
                          autoComplete="username"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          required
                          placeholder="Username or email"
                          className="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-xl text-white text-base placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition-all"
                        />
                      </div>

                      {/* Password Input */}
                      <div>
                        <label htmlFor="password" className="block text-sm font-medium text-surface-300 mb-2">
                          Password
                        </label>
                        <div className="relative">
                          <input
                            id="password"
                            name="password"
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            placeholder="Enter your password"
                            className="w-full px-4 pr-12 py-3 bg-surface-800 border border-surface-700 rounded-xl text-white text-base placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition-all"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-surface-500 hover:text-white transition-colors"
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                          >
                            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                          </button>
                        </div>
                      </div>

                      {/* Remember Me & Forgot Password */}
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 cursor-pointer group">
                          <div className="relative">
                            <input
                              id="rememberMe"
                              name="rememberMe"
                              type="checkbox"
                              checked={rememberMe}
                              onChange={(e) => setRememberMe(e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className="w-4 h-4 border border-surface-600 rounded bg-surface-800 peer-checked:bg-primary-500 peer-checked:border-primary-500 transition-all peer-focus:ring-2 peer-focus:ring-primary-500/50" />
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
                          <span className="text-sm text-surface-400 group-hover:text-surface-300 transition-colors">
                            Remember me on this device
                          </span>
                        </label>
                        <Link
                          href="/forgot-password"
                          className="text-sm text-primary-400 hover:text-primary-300 transition-colors"
                        >
                          Forgot password?
                        </Link>
                      </div>

                      {/* Error Message */}
                      {error && (
                        <p className="text-sm text-red-400">{error}</p>
                      )}

                      {/* Submit Button */}
                      <Button
                        type="submit"
                        variant="primary"
                        fullWidth
                        size="lg"
                        loading={isLoading}
                        disabled={isLoading}
                      >
                        {isLoading ? 'Signing in...' : 'Sign In'}
                      </Button>

                      {/* Divider */}
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-surface-700" />
                        </div>
                        <div className="relative flex justify-center text-sm">
                          <span className="px-4 bg-surface-900 text-surface-500">or</span>
                        </div>
                      </div>

                      {/* Google Sign-In */}
                      <GoogleSignInButton
                        onSuccess={handleGoogleSuccess}
                        onError={handleGoogleError}
                        text="signin_with"
                        disabled={isLoading || isGoogleLoading}
                      />

                      {/* GitHub Sign-In */}
                      <GitHubSignInButton
                        text="Sign in with GitHub"
                        disabled={isLoading || isGoogleLoading}
                      />
                    </form>

                    {/* Register Link */}
                    <div className="mt-8 text-center">
                      <p className="text-surface-400">
                        New to CodeArena?{' '}
                        <Link
                          href="/register"
                          className="text-primary-400 hover:underline transition-all"
                        >
                          Create account
                        </Link>
                      </p>
                    </div>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
