import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import { CheckCircle, XCircle, Loader2, Mail } from 'lucide-react';
import Logo from '../components/ui/Logo';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/ui/Button';
import { FadeIn, Float } from '../components/ui/Motion';
import FloatingOrbs from '../components/ui/FloatingOrbs';

export default function VerifyEmail() {
  const router = useRouter();
  const { token, type } = router.query;
  const { verifyEmailChange, verifyEmail, isAuthenticated, setEmailVerified } = useAuth();

  const [status, setStatus] = useState('loading'); // loading, success, error
  const [error, setError] = useState('');
  const [verificationType, setVerificationType] = useState('account'); // account or email-change

  useEffect(() => {
    if (!router.isReady) return;

    if (!token) {
      setStatus('error');
      setError('No verification token provided');
      return;
    }

    const verify = async () => {
      // Try new account verification first, then fall back to email change
      try {
        if (type === 'email-change') {
          // Explicit email change verification
          await verifyEmailChange(token);
          setVerificationType('email-change');
        } else {
          // Try new account verification first
          try {
            await verifyEmail(token);
            setVerificationType('account');
          } catch (accountErr) {
            // If that fails, try email change verification
            await verifyEmailChange(token);
            setVerificationType('email-change');
          }
        }
        setStatus('success');
        // Update local user state so withAuth gate allows access
        if (isAuthenticated) {
          setEmailVerified();
        }
      } catch (err) {
        setStatus('error');
        setError(err.message || 'Verification failed');
      }
    };

    verify();
  }, [router.isReady, token, type, verifyEmailChange, verifyEmail, isAuthenticated, setEmailVerified]);

  // The success screen promises "Redirecting you to CodeArena..." for a verified
  // account while logged in: actually perform that redirect (a button remains as fallback).
  useEffect(() => {
    if (status === 'success' && verificationType === 'account' && isAuthenticated) {
      const t = setTimeout(() => router.push('/'), 2500);
      return () => clearTimeout(t);
    }
  }, [status, verificationType, isAuthenticated, router]);

  // Loading State
  if (status === 'loading') {
    return (
      <>
        <Head>
          <title>Verifying Email - CodeArena</title>
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
                className="bg-gradient-to-br from-primary-500 to-secondary-600 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-glow"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring' }}
              >
                <Mail className="h-10 w-10 text-white" />
              </motion.div>
            </Float>
            <h1 className="text-3xl font-bold mb-4">Verifying Email...</h1>
            <p className="text-surface-400 mb-6">Please wait while we verify your new email address.</p>
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

  // Success State
  if (status === 'success') {
    return (
      <>
        <Head>
          <title>Email Verified - CodeArena</title>
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
                  className="bg-gradient-to-br from-success to-green-600 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-glow"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring' }}
                >
                  <CheckCircle className="h-10 w-10 text-white" />
                </motion.div>
              </Float>
              <h1 className="text-3xl font-bold mb-4 gradient-text">Email Verified!</h1>
              <p className="text-surface-400 mb-8 max-w-md mx-auto">
                {verificationType === 'account'
                  ? isAuthenticated
                    ? 'Your account has been verified! Redirecting you to CodeArena...'
                    : 'Your account has been verified! You can now log in and get started.'
                  : 'Your email address has been successfully updated. You can now use your new email to log in.'}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                {isAuthenticated && verificationType === 'account' ? (
                  <Link href="/">
                    <Button variant="primary" size="lg">
                      Go to CodeArena
                    </Button>
                  </Link>
                ) : isAuthenticated ? (
                  <Link href="/settings/profile">
                    <Button variant="primary" size="lg">
                      Go to Settings
                    </Button>
                  </Link>
                ) : (
                  <Link href="/login">
                    <Button variant="primary" size="lg">
                      Sign In
                    </Button>
                  </Link>
                )}
                {!(isAuthenticated && verificationType === 'account') && (
                  <Link href="/">
                    <Button variant="ghost" size="lg">
                      Go Home
                    </Button>
                  </Link>
                )}
              </div>
            </FadeIn>
          </div>
        </div>
      </>
    );
  }

  // Error State
  return (
    <>
      <Head>
        <title>Verification Failed - CodeArena</title>
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
            <h1 className="text-3xl font-bold mb-4">Verification Failed</h1>
            <p className="text-surface-400 mb-8 max-w-md mx-auto">
              {error || 'The verification link is invalid or has expired. Please try changing your email again.'}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {isAuthenticated ? (
                <Link href="/settings/profile">
                  <Button variant="primary" size="lg">
                    Try Again
                  </Button>
                </Link>
              ) : (
                <Link href="/login">
                  <Button variant="primary" size="lg">
                    Sign In
                  </Button>
                </Link>
              )}
              <Link href="/">
                <Button variant="ghost" size="lg">
                  Go Home
                </Button>
              </Link>
            </div>
          </FadeIn>
        </div>
      </div>
    </>
  );
}
