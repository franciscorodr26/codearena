import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { config } from '../config/env';
import { io } from 'socket.io-client';
import { BadgeNotificationContainer, BadgeCelebrationModal } from '../components/BadgeNotification';

const BadgeContext = createContext(null);

export function BadgeProvider({ children }) {
  const { user, token } = useAuth();
  const [socket, setSocket] = useState(null);
  const [pendingBadges, setPendingBadges] = useState([]);
  const [celebrationBadges, setCelebrationBadges] = useState([]);
  const [showCelebration, setShowCelebration] = useState(false);
  const mountedRef = useRef(true);

  // Mark badges as notified on the server
  const markBadgesNotified = useCallback(async (badgeIds) => {
    if (!token || !badgeIds || badgeIds.length === 0) return;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      await fetch(`${config.backend_url}/api/badges/me/mark-notified`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ badgeIds }),
        signal: controller.signal
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('Failed to mark badges as notified:', err);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }, [token]);

  // Connect to socket for badge notifications
  useEffect(() => {
    if (!user || !token) return;

    const newSocket = io(config.backend_url, {
      auth: { token }
    });

    newSocket.on('connect', () => {
      // Socket connected
    });

    newSocket.on('badges-earned', ({ badges, context }) => {
      if (!badges || badges.length === 0) return;

      // Check if any legendary badges - show celebration modal
      const hasLegendary = badges.some(b => b.rarity === 'legendary');

      if (hasLegendary || badges.length >= 3) {
        // Show celebration modal for legendary badges or multiple badges
        setCelebrationBadges(badges);
        setShowCelebration(true);
      } else {
        // Show toast notifications for regular badges
        setPendingBadges(prev => [...prev, ...badges]);
      }

      // Mark badges as notified on the server
      markBadgesNotified(badges.map(b => b.id));
    });

    newSocket.on('disconnect', () => {
      // Socket disconnected
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [user, token, markBadgesNotified]);

  // Check for unnotified badges on load
  useEffect(() => {
    mountedRef.current = true;
    if (!user || !token) return;

    const controller = new AbortController();

    const checkUnnotifiedBadges = async () => {
      try {
        const res = await fetch(`${config.backend_url}/api/badges/me/unnotified`, {
          headers: { 'Authorization': `Bearer ${token}` },
          signal: controller.signal
        });

        // Check if still mounted before updating state
        if (!mountedRef.current) return;

        if (res.ok) {
          const data = await res.json();
          if (data.badges && data.badges.length > 0) {
            // Show notifications for unnotified badges
            const hasLegendary = data.badges.some(b => b.rarity === 'legendary');

            if (hasLegendary || data.badges.length >= 3) {
              setCelebrationBadges(data.badges);
              setShowCelebration(true);
            } else {
              setPendingBadges(data.badges);
            }

            markBadgesNotified(data.badges.map(b => b.id));
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('Failed to check unnotified badges:', err);
        }
      }
    };

    // Small delay to let app initialize
    const timer = setTimeout(checkUnnotifiedBadges, 2000);
    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [user, token, markBadgesNotified]);

  // Dismiss a single badge notification
  const dismissBadge = useCallback((badgeId) => {
    setPendingBadges(prev => prev.filter(b => (b.id || b.slug) !== badgeId));
  }, []);

  // Dismiss all badge notifications
  const dismissAllBadges = useCallback(() => {
    setPendingBadges([]);
  }, []);

  // Close celebration modal
  const closeCelebration = useCallback(() => {
    setShowCelebration(false);
    setCelebrationBadges([]);
  }, []);

  // Manually show badge notification (for testing or after API calls)
  const showBadgeNotification = useCallback((badges) => {
    if (!Array.isArray(badges)) badges = [badges];
    setPendingBadges(prev => [...prev, ...badges]);
  }, []);

  const value = {
    pendingBadges,
    showBadgeNotification,
    dismissBadge,
    dismissAllBadges
  };

  return (
    <BadgeContext.Provider value={value}>
      {children}

      {/* Toast Notifications */}
      <BadgeNotificationContainer
        badges={pendingBadges}
        onDismiss={dismissBadge}
        onDismissAll={dismissAllBadges}
      />

      {/* Celebration Modal */}
      <BadgeCelebrationModal
        badges={celebrationBadges}
        isOpen={showCelebration}
        onClose={closeCelebration}
      />
    </BadgeContext.Provider>
  );
}

export function useBadges() {
  const context = useContext(BadgeContext);
  if (!context) {
    throw new Error('useBadges must be used within a BadgeProvider');
  }
  return context;
}

export default BadgeContext;
