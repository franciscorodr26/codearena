import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, AlertCircle, Loader2, CheckCircle, ArrowLeft, KeyRound } from 'lucide-react';
import Logo from '../components/ui/Logo';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { FadeIn, Float } from '../components/ui/Motion';
import FloatingOrbs from '../components/ui/FloatingOrbs';

export default function ForgotPassword() {
  const { forgotPassword } = useAuth();

  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLoading) return; // Prevent double-click
    setError('');
    setIsLoading(true);

    try {
      await forgotPassword(email);
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Failed to send reset email');
    } finally {
      setIsLoading(false);
    }
  };

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
              {/* Back Link */}
              <Link
                href="/login"
                className="inline-flex items-center gap-2 text-surface-400 hover:text-white transition-colors mb-6 group"
              >
                <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
                <span>Back to login</span>
              </Link>

              <AnimatePresence mode="wait">
                {success ? (
                  // Success State
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="text-center py-4"
                  >
                    <Float amplitude={8} duration={3}>
                      <motion.div
                        className="bg-gradient-to-br from-success to-green-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-glow"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', delay: 0.2 }}
                      >
                        <CheckCircle className="h-8 w-8 text-white" />
                      </motion.div>
                    </Float>
                    <h1 className="text-2xl font-bold mb-4">Check Your Email</h1>
                    <p className="text-surface-400 mb-6">
                      We've sent a password reset link to{' '}
                      <span className="text-white font-medium">{email}</span>
                    </p>
                    <p className="text-sm text-surface-500 mb-8">
                      Didn't receive the email? Check your spam folder or{' '}
                      <button
                        onClick={() => setSuccess(false)}
                        className="text-primary-400 hover:text-primary-300 transition-colors"
                      >
                        try again
                      </button>
                    </p>
                    <Link href="/login" className="block">
                      <Button
                        variant="primary"
                        fullWidth
                      >
                        Return to Login
                      </Button>
                    </Link>
                  </motion.div>
                ) : (
                  // Form State
                  <motion.div
                    key="form"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
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
                      <h1 className="text-3xl font-bold mb-2">Forgot Password?</h1>
                      <p className="text-surface-400">
                        No worries, we'll send you reset instructions
                      </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                      {/* Email Input */}
                      <div>
                        <label htmlFor="email" className="block text-sm font-medium text-surface-300 mb-2">
                          Email Address
                        </label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-surface-500" />
                          <input
                            id="email"
                            name="email"
                            type="email"
                            autoComplete="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            placeholder="Enter your email"
                            className="w-full pl-10 pr-4 py-3 bg-surface-800/50 border border-surface-700 rounded-xl text-white text-base placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition-all"
                          />
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
                        disabled={isLoading}
                      >
                        {isLoading ? 'Sending...' : 'Send Reset Link'}
                      </Button>
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
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          </FadeIn>
        </div>
      </div>
    </>
  );
}

