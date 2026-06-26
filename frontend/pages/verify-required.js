import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import { Mail, Loader2, CheckCircle, LogOut } from 'lucide-react';
import Logo from '../components/ui/Logo';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/ui/Button';
import { FadeIn, Float } from '../components/ui/Motion';
import FloatingOrbs from '../components/ui/FloatingOrbs';
import { postAuthDestination } from '../utils/authRedirect';

export default function VerifyRequired() {
  const router = useRouter();
  const { user, isAuthenticated, loading, logout, resendVerificationEmail } = useAuth();

  const [resendStatus, setResendStatus] = useState('idle'); // idle, sending, sent, error
  const [resendError, setResendError] = useState('');

  // If not authenticated, redirect to login
  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [loading, isAuthenticated, router]);

  // If already verified, redirect to home
  useEffect(() => {
    if (!loading && isAuthenticated && user?.email_verified) {
      router.replace(postAuthDestination(user));
    }
  }, [loading, isAuthenticated, user, router]);

  const handleResend = async () => {
    if (resendStatus === 'sending') return;
    setResendStatus('sending');
    setResendError('');

    try {
      await resendVerificationEmail(user.email);
      setResendStatus('sent');
    } catch (err) {
      setResendStatus('error');
      setResendError(err.message || 'Failed to resend verification email');
    }
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="h-8 w-8 text-primary-400" />
        </motion.div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Verify Your Email - CodeArena</title>
        <meta name="robots" content="noindex, nofollow" />
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

        {/* Content */}
        <div className="flex-1 flex items-center justify-center px-6 py-12 relative z-10">
          <FadeIn className="text-center max-w-md">
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

            <h1 className="text-3xl font-bold mb-4">Check Your Email</h1>
            <p className="text-surface-400 mb-2">
              We sent a verification link to
            </p>
            <p className="text-white font-medium mb-6">
              {user.email}
            </p>
            <p className="text-surface-500 text-sm mb-8">
              Click the link in your email to verify your account and start using CodeArena.
            </p>

            <div className="flex flex-col gap-3">
              {resendStatus === 'sent' ? (
                <div className="flex items-center justify-center gap-2 text-success bg-success/10 border border-success/30 rounded-xl p-3">
                  <CheckCircle className="h-5 w-5" />
                  <span className="text-sm">Verification email sent! Check your inbox.</span>
                </div>
              ) : resendStatus === 'error' ? (
                <div className="text-center">
                  <p className="text-danger text-sm mb-3">{resendError}</p>
                  <Button
                    variant="primary"
                    fullWidth
                    onClick={handleResend}
                    icon={Mail}
                  >
                    Try Again
                  </Button>
                </div>
              ) : (
                <Button
                  variant="primary"
                  fullWidth
                  onClick={handleResend}
                  loading={resendStatus === 'sending'}
                  icon={resendStatus !== 'sending' ? Mail : undefined}
                >
                  {resendStatus === 'sending' ? 'Sending...' : 'Resend Verification Email'}
                </Button>
              )}

              <Button
                variant="ghost"
                fullWidth
                onClick={handleLogout}
                icon={LogOut}
              >
                Log Out
              </Button>
            </div>
          </FadeIn>
        </div>
      </div>
    </>
  );
}
