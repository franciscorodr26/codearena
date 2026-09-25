import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Eye, EyeOff, AlertCircle, Loader2, CheckCircle, XCircle, KeyRound } from 'lucide-react';
import Logo from '../components/ui/Logo';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { FadeIn, Float } from '../components/ui/Motion';
import FloatingOrbs from '../components/ui/FloatingOrbs';

export default function ResetPassword() {
  const router = useRouter();
  const { resetPassword } = useAuth();
  const { token, email } = router.query;

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [invalidToken, setInvalidToken] = useState(false);

  // Check if token is present
  useEffect(() => {
    if (router.isReady && !token) {
      setInvalidToken(true);
    }
  }, [router.isReady, token]);

  // Password validation
  const passwordRequirements = [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'Contains a number', met: /\d/.test(password) },
    { label: 'Contains uppercase letter', met: /[A-Z]/.test(password) },
  ];

  const isPasswordValid = passwordRequirements.every((req) => req.met);
  const doPasswordsMatch = password === confirmPassword && confirmPassword.length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLoading) return; // Prevent double-click
    setError('');

    if (!isPasswordValid) {
      setError('Please meet all password requirements');
      return;
    }

    if (!doPasswordsMatch) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);

    try {
      await resetPassword(token, password);
      setSuccess(true);
      // Redirect to login after 3 seconds
      setTimeout(() => {
        router.push('/login');
      }, 3000);
    } catch (err) {
      if (err.message.includes('expired') || err.message.includes('invalid')) {
        setInvalidToken(true);
      } else {
        setError(err.message || 'Failed to reset password');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Invalid/Expired Token State
  if (invalidToken) {
    return (
      <>
        <Head>
          <title>Invalid Link - CodeArena</title>
        </Head>
        <div className="min-h-screen bg-surface-950 text-white flex flex-col">
          <FloatingOrbs showCenterOrb />

          <motion.header
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="relative z-10 px-6 py-6"
          >
            <nav className="max-w-7xl mx-auto flex items-center justify-between">
              <Link href="/" className="flex items-center space-x-2 group">
                <Logo size="lg" />
              </Link>
            </nav>
          </motion.header>

          <div className="flex-1 flex items-center justify-center px-6 py-12 relative z-10">
            <FadeIn className="text-center">
              <Float amplitude={8} duration={3}>
                <motion.div
                  className="bg-gradient-to-br from-danger to-red-600 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-glow"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring' }}
                >
                  <XCircle className="h-10 w-10 text-white" />
                </motion.div>
              </Float>
              <h1 className="text-3xl font-bold mb-4">Invalid or Expired Link</h1>
              <p className="text-surface-400 mb-8 max-w-md mx-auto">
                This password reset link is invalid or has expired. Please request a new one.
              </p>
              <Link href="/forgot-password">
                <Button
                  variant="primary"
                  size="lg"
                >
                  Request New Link
                </Button>
              </Link>
            </FadeIn>
          </div>
        </div>
      </>
      
    );
  }

  // Success State
  if (success) {
    return (
      <>
        <Head>
          <title>Password Reset - CodeArena</title>
        </Head>
        <div className="min-h-screen bg-surface-950 text-white flex items-center justify-center px-6">
          <FloatingOrbs showCenterOrb />
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center relative z-10"
          >
            <Float amplitude={8} duration={3}>
              <motion.div
                className="bg-gradient-to-br from-success to-green-600 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-glow"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', delay: 0.2 }}
              >
                <CheckCircle className="h-10 w-10 text-white" />
              </motion.div>
            </Float>
            <h1 className="text-3xl font-bold mb-4 gradient-text">Password Reset!</h1>
            <p className="text-surface-400 mb-4">Your password has been successfully changed.</p>
            <p className="text-surface-500 mb-6">Redirecting to login...</p>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            >
              <Loader2 className="h-6 w-6 text-primary-400 mx-auto" />
            </motion.div>
          </motion.div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Reset Password - CodeArena</title>
      </Head>

      <div className="min-h-screen bg-surface-950 text-white flex flex-col">
        <FloatingOrbs showCenterOrb />

        {/* Header */}
        <motion.header
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="relative z-10 px-6 py-6"
        >
          <nav className="max-w-7xl mx-auto flex items-center justify-between">
            <Link href="/" className="flex items-center space-x-2 group">
              <Logo size="lg" />
            </Link>
          </nav>
        </motion.header>

        {/* Form Container */}
        <div className="flex-1 flex items-center justify-center px-6 py-12 relative z-10">
          <FadeIn className="w-full max-w-md">
            <Card variant="glass" className="p-8">
              {/* Header */}
              <div className="text-center mb-8">
                <Float amplitude={8} duration={3}>
                  <motion.div
                    className="bg-gradient-to-br from-primary-500 to-secondary-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-glow"
                    whileHover={{ scale: 1.1, rotate: 5 }}
                  >
                    <KeyRound className="h-8 w-8 text-white" />
                  </motion.div>
                </Float>
                <h1 className="text-3xl font-bold mb-2">Reset Password</h1>
                <p className="text-surface-400">
                  {email ? `Create a new password for ${decodeURIComponent(email)}` : 'Create your new password'}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                {/* New Password Input */}
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-surface-300 mb-2">
                    New Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-surface-500" />
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="Enter new password"
                      className="w-full pl-10 pr-12 py-3 bg-surface-800/50 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-surface-500 hover:text-white transition-colors"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>

                  {/* Password Requirements */}
                  {password.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {passwordRequirements.map((req, index) => (
                        <motion.div
                          key={index}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.1 }}
                          className={`flex items-center space-x-2 text-xs ${
                            req.met ? 'text-success' : 'text-surface-500'
                          }`}
                        >
                          <CheckCircle className={`h-3 w-3 ${req.met ? 'opacity-100' : 'opacity-30'}`} />
                          <span>{req.label}</span>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Confirm Password Input */}
                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-surface-300 mb-2">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-surface-500" />
                    <input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      placeholder="Confirm new password"
                      className={`w-full pl-10 pr-12 py-3 bg-surface-800/50 border rounded-xl text-white placeholder-surface-500 focus:outline-none transition-all ${
                        confirmPassword.length > 0
                          ? doPasswordsMatch
                            ? 'border-success focus:ring-success/50'
                            : 'border-danger focus:ring-danger/50'
                          : 'border-surface-700 focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-surface-500 hover:text-white transition-colors"
                    >
                      {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  {confirmPassword.length > 0 && !doPasswordsMatch && (
                    <p className="mt-1 text-xs text-danger">Passwords do not match</p>
                  )}
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
                      <AlertCircle className="h-5 w-5 flex-shrink-0" />
                      <span className="text-sm">{error}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Submit Button */}
                <Button
                  type="submit"
                  variant="primary"
                  fullWidth
                  size="lg"
                  loading={isLoading}
                  disabled={isLoading || !isPasswordValid || !doPasswordsMatch}
                >
                  {isLoading ? 'Resetting...' : 'Reset Password'}
                </Button>
              </form>

              {/* Login Link */}
              <div className="mt-8 text-center">
                <p className="text-surface-400">
                  Remember your password?{' '}
                  <Link
                    href="/login"
                    className="text-primary-400 hover:underline transition-all"
                  >
                    Sign in
                  </Link>
                </p>
              </div>
            </Card>
          </FadeIn>
        </div>
      </div>
    </>
  );
}
