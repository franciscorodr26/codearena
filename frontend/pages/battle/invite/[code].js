import React, { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import { io } from 'socket.io-client';
import {
  Swords,
  Clock,
  Loader2,
  AlertCircle,
  CheckCircle,
  LogIn,
  UserPlus,
  Home,
  RefreshCw,
  PlusCircle,
  ExternalLink
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { config } from '../../../config/env';
import FloatingOrbs from '../../../components/ui/FloatingOrbs';

const getTimeRemaining = (expiresAt) => {
  const now = new Date();
  const expiry = new Date(expiresAt);
  const diff = expiry - now;

  if (diff <= 0) return null;

  const minutes = Math.floor(diff / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  if (minutes > 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
  return `${seconds} second${seconds !== 1 ? 's' : ''}`;
};

export default function BattleInvitePage() {
  const router = useRouter();
  const { code } = router.query;
  const { user, token, loading: authLoading } = useAuth();

  const [inviteInfo, setInviteInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState(null);
  const [joining, setJoining] = useState(false);
  const [joinSuccess, setJoinSuccess] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [battleCancelled, setBattleCancelled] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const socketRef = useRef(null);

  // Detect mobile devices (show "Open in Browser" for in-app browser scenarios)
  useEffect(() => {
    const ua = navigator.userAgent || '';
    setIsMobile(/iPhone|iPad|iPod|Android/i.test(ua));
  }, []);

  const loadInviteInfo = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    setError('');
    setErrorCode(null);

    try {
      const res = await fetch(`${config.backend_url}/api/battle/invite/${code}`);
      const data = await res.json();

      if (!data.valid) {
        setError(data.error || 'Invalid invite link');
        setErrorCode(data.errorCode || null);
        setInviteInfo(null);
      } else {
        setInviteInfo(data);
        setErrorCode(null);
      }
    } catch (err) {
      setError('Failed to load invite information');
      setErrorCode(null);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    if (code) {
      loadInviteInfo();
    }
  }, [code, loadInviteInfo]);

  // Update countdown timer
  useEffect(() => {
    if (!inviteInfo?.expiresAt) return;

    const updateTime = () => {
      const remaining = getTimeRemaining(inviteInfo.expiresAt);
      setTimeRemaining(remaining);

      // If expired, reload to show error
      if (!remaining) {
        loadInviteInfo();
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [inviteInfo?.expiresAt, loadInviteInfo]);

  // WebSocket connection for real-time battle cancellation detection
  useEffect(() => {
    if (!code || !inviteInfo || battleCancelled || joinSuccess) return;

    const socket = io(config.backend_url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 3
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('watch-invite', { inviteCode: code });
    });

    socket.on('battle-cancelled', ({ reason }) => {
      setBattleCancelled(true);
      setError('The battle creator has left. This invite is no longer valid.');
      setInviteInfo(null);
    });

    return () => {
      if (socket.connected) {
        socket.emit('unwatch-invite', { inviteCode: code });
      }
      socket.disconnect();
      socketRef.current = null;
    };
  }, [code, inviteInfo, battleCancelled, joinSuccess]);

  const handleJoin = useCallback(async () => {
    if (!user) {
      // Redirect to login with return URL
      router.push(`/login?redirect=/battle/invite/${code}`);
      return;
    }

    setJoining(true);
    setError('');
    setErrorCode(null);

    try {
      const res = await fetch(`${config.backend_url}/api/battle/invite/${code}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await res.json();

      if (data.success) {
        setJoinSuccess(true);
        // Mark that user joined via invite (so withAuth skips email verification)
        sessionStorage.setItem('joinedViaInvite', 'true');
        // Redirect to battle page
        setTimeout(() => {
          router.push(`/battle?id=${data.battleId}&playerId=${data.playerId}`);
        }, 1500);
      } else {
        setError(data.error || 'Failed to join battle');
        setErrorCode(data.errorCode || null);
      }
    } catch (err) {
      setError('Failed to join battle. Please try again.');
    } finally {
      setJoining(false);
    }
  }, [user, code, token, router]);

  // Auto-join if user is logged in and invite is valid
  // Using a ref to track if we've attempted auto-join to prevent multiple calls
  const autoJoinAttempted = React.useRef(false);

  useEffect(() => {
    if (user && inviteInfo && !joining && !joinSuccess && !error && !autoJoinAttempted.current) {
      autoJoinAttempted.current = true;
      handleJoin();
    }
  }, [user, inviteInfo, joining, joinSuccess, error, handleJoin]);

  const handleLoginRedirect = () => {
    router.push(`/login?redirect=/battle/invite/${code}`);
  };

  const handleRegisterRedirect = () => {
    router.push(`/register?redirect=/battle/invite/${code}`);
  };

  return (
    <>
      <Head>
        <title>
          {inviteInfo
            ? `${inviteInfo.inviterUsername} invited you to battle!`
            : 'Battle Invite'} - CodeArena
        </title>
      </Head>

      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <FloatingOrbs variant="secondary" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          {/* Loading state */}
          {loading && (
            <div className="bg-surface-800/50 backdrop-blur-xl border border-surface-700/50 rounded-2xl p-8 text-center">
              <Loader2 className="w-12 h-12 text-primary-400 animate-spin mx-auto mb-4" />
              <p className="text-surface-300">Loading invite...</p>
            </div>
          )}

          {/* Error state */}
          {!loading && error && !inviteInfo && (
            <div className="bg-surface-800/50 backdrop-blur-xl border border-surface-700/50 rounded-2xl p-8 text-center">
              <div className="w-16 h-16 bg-danger/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8 text-danger" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Invalid Invite</h2>
              <p className="text-surface-400 mb-6">{error}</p>
              <Link
                href="/battle"
                className="inline-flex items-center gap-2 px-4 py-2 bg-surface-700 hover:bg-surface-600 text-white rounded-xl transition-colors"
              >
                <Home className="w-4 h-4" />
                Create Your Own Battle
              </Link>
            </div>
          )}

          {/* Invite found */}
          {!loading && inviteInfo && (
            <div className="bg-surface-800/50 backdrop-blur-xl border border-surface-700/50 rounded-2xl overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-r from-primary-500/20 to-accent-500/20 p-6 border-b border-surface-700/50">
                <div className="flex items-center gap-2 text-primary-400 text-sm mb-3">
                  <Swords className="w-4 h-4" />
                  <span>Battle Invite</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-gradient-to-br from-primary-500/30 to-accent-500/30 rounded-xl flex items-center justify-center">
                    <Swords className="w-7 h-7 text-primary-400" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold text-white">
                      {inviteInfo.inviterUsername}
                    </h1>
                    <p className="text-surface-400">invited you to battle!</p>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 space-y-4">
                {/* Timer */}
                {timeRemaining && (
                  <div className="bg-surface-700/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-surface-400 text-sm mb-1">
                      <Clock className="w-4 h-4" />
                      <span>Invite expires in</span>
                    </div>
                    <div className="text-lg font-semibold text-white">
                      {timeRemaining}
                    </div>
                  </div>
                )}

                {/* Error message with contextual actions */}
                {error && inviteInfo && (
                  <div className="bg-danger/10 border border-danger/30 rounded-xl p-4">
                    <p className="text-sm text-danger mb-3">{error}</p>
                    {/* Show retry options based on error type */}
                    {(errorCode === 'INVITE_RACE_LOST' || errorCode === 'INVITE_ALREADY_USED') && (
                      <div className="flex gap-2">
                        <button
                          onClick={loadInviteInfo}
                          className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-surface-700 hover:bg-surface-600 text-white text-sm rounded-lg transition-colors"
                        >
                          <RefreshCw className="w-4 h-4" />
                          Check Again
                        </button>
                        <Link
                          href="/battle"
                          className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-primary-500/20 hover:bg-primary-500/30 text-primary-400 text-sm rounded-lg transition-colors"
                        >
                          <PlusCircle className="w-4 h-4" />
                          Create New
                        </Link>
                      </div>
                    )}
                    {errorCode === 'BATTLE_FULL' && (
                      <Link
                        href="/battle"
                        className="flex items-center justify-center gap-2 py-2 px-3 bg-primary-500/20 hover:bg-primary-500/30 text-primary-400 text-sm rounded-lg transition-colors"
                      >
                        <PlusCircle className="w-4 h-4" />
                        Create Your Own Battle
                      </Link>
                    )}
                  </div>
                )}

                {/* Success message */}
                {joinSuccess && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-success/10 border border-success/30 rounded-xl p-4 text-center"
                  >
                    <CheckCircle className="w-8 h-8 text-success mx-auto mb-2" />
                    <p className="text-success font-medium">Successfully joined!</p>
                    <p className="text-success/70 text-sm">Redirecting to battle...</p>
                  </motion.div>
                )}

                {/* Action buttons */}
                {!joinSuccess && (
                  <div className="space-y-3 pt-2">
                    {authLoading ? (
                      <div className="flex items-center justify-center py-3">
                        <Loader2 className="w-6 h-6 text-primary-400 animate-spin" />
                      </div>
                    ) : user ? (
                      // User is logged in - show join button
                      <button
                        onClick={handleJoin}
                        disabled={joining}
                        className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gradient-to-r from-primary-500 to-accent-500 hover:from-primary-400 hover:to-accent-400 text-white font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {joining ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Joining...
                          </>
                        ) : (
                          <>
                            <Swords className="w-5 h-5" />
                            Join Battle
                          </>
                        )}
                      </button>
                    ) : (
                      // User not logged in - show login/register options
                      <>
                        {isMobile && (
                          <>
                            <a
                              href={typeof window !== 'undefined' ? window.location.href : '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gradient-to-r from-primary-500 to-accent-500 hover:from-primary-400 hover:to-accent-400 text-white font-semibold rounded-xl transition-all"
                            >
                              <ExternalLink className="w-5 h-5" />
                              Open in Browser
                            </a>
                            <p className="text-center text-surface-500 text-sm">
                              Already logged in? Open in your browser to auto-join.
                            </p>
                            <div className="border-t border-surface-700 my-1" />
                          </>
                        )}
                        <button
                          onClick={handleLoginRedirect}
                          className={`w-full flex items-center justify-center gap-2 py-3 px-4 ${isMobile ? 'bg-surface-700 hover:bg-surface-600 text-white font-medium' : 'bg-gradient-to-r from-primary-500 to-accent-500 hover:from-primary-400 hover:to-accent-400 text-white font-semibold'} rounded-xl transition-all`}
                        >
                          <LogIn className="w-5 h-5" />
                          Login to Join
                        </button>

                        <button
                          onClick={handleRegisterRedirect}
                          className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-surface-700 hover:bg-surface-600 text-white font-medium rounded-xl transition-colors"
                        >
                          <UserPlus className="w-5 h-5" />
                          Create Account
                        </button>

                        {!isMobile && (
                          <p className="text-center text-surface-500 text-sm">
                            You need an account to join battles
                          </p>
                        )}
                      </>
                    )}

                    <Link
                      href="/battle"
                      className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-surface-700/50 hover:bg-surface-700 text-surface-300 font-medium rounded-xl transition-colors"
                    >
                      Create Your Own Battle
                    </Link>
                  </div>
                )}
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </>
  );
}
