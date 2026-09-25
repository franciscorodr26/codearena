import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { config } from '../config/env';
import WelcomeModal from './WelcomeModal';
import { trackOnboardingStarted, trackOnboardingCompleted, trackOnboardingSkipped } from '../utils/analytics';

const ONBOARDING_KEY = 'codearena_onboarded';

const getOnboardingCacheKey = (user) => {
  const userKey = user?.id || user?.sub || user?.email;
  return userKey ? `${ONBOARDING_KEY}:${userKey}` : null;
};

export default function OnboardingWrapper() {
  const router = useRouter();
  const { user, token, refreshUser } = useAuth();
  const [showWelcome, setShowWelcome] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [skipToast, setSkipToast] = useState(false);
  const startTimeRef = useRef(null);

  // Reset hasChecked when route changes to trigger onboarding check
  // This ensures the welcome modal shows after completing profile
  useEffect(() => {
    setHasChecked(false);
  }, [router.pathname]);

  useEffect(() => {
    // Only check once user is authenticated
    if (!user || !token || hasChecked) return;

    // Skip onboarding check on auth-related pages
    const skipPages = ['/complete-profile', '/login', '/register', '/forgot-password', '/reset-password', '/verify-email', '/verify-email-change', '/verify-required'];
    if (skipPages.some(page => router.pathname.startsWith(page))) {
      setHasChecked(true);
      return;
    }

    // If coming from complete-profile with onboarding flag, show immediately
    if (router.query.onboarding === 'true') {
      setShowWelcome(true);
      startTimeRef.current = Date.now();
      trackOnboardingStarted(user);
      setHasChecked(true);
      // Clean up the URL
      router.replace('/', undefined, { shallow: true });
      return;
    }

    // This key is written only after the API confirms onboarding and is scoped
    // per account, so client-side navigation does not refetch /auth/me.
    const onboardingCacheKey = getOnboardingCacheKey(user);
    if (typeof window !== 'undefined' && onboardingCacheKey && localStorage.getItem(onboardingCacheKey) === 'true') {
      setHasChecked(true);
      return;
    }

    // Always check API for onboarding status (don't rely on localStorage alone)
    const checkOnboarding = async () => {
      try {
        const res = await fetch(`${config.backend_url}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (res.ok) {
          const data = await res.json();
          // Don't show onboarding if user hasn't chosen username yet
          // (they should be on /complete-profile first)
          if (data.user.username_chosen === 0) {
            return;
          }
          // Show welcome modal if user hasn't onboarded (API is source of truth)
          if (!data.user.has_onboarded) {
            // Clear any stale localStorage that might interfere
            if (typeof window !== 'undefined') {
              if (onboardingCacheKey) localStorage.removeItem(onboardingCacheKey);
              localStorage.removeItem(ONBOARDING_KEY);
            }
            // Show immediately - modal has its own entrance animation
            setShowWelcome(true);
            startTimeRef.current = Date.now();
            trackOnboardingStarted(user);
          } else {
            // User has onboarded, set localStorage as cache
            if (typeof window !== 'undefined' && onboardingCacheKey) {
              localStorage.setItem(onboardingCacheKey, 'true');
            }
          }
        }
      } catch (err) {
        console.error('Failed to check onboarding status:', err);
      } finally {
        setHasChecked(true);
      }
    };

    checkOnboarding();
  }, [user, token, hasChecked, router]);

  const handleComplete = (skipped = false, completedSteps = 4, totalSteps = 4) => {
    // Calculate time spent
    const timeSpentSeconds = startTimeRef.current
      ? Math.round((Date.now() - startTimeRef.current) / 1000)
      : 0;

    // Track analytics
    if (skipped) {
      trackOnboardingSkipped({
        skippedAtStep: currentStep,
        totalSteps,
        timeSpentSeconds
      }, user);
    } else {
      trackOnboardingCompleted({
        completedSteps,
        totalSteps,
        timeSpentSeconds
      }, user);
    }

    // Close modal immediately
    setShowWelcome(false);

    // Save to localStorage as backup
    if (typeof window !== 'undefined') {
      const onboardingCacheKey = getOnboardingCacheKey(user);
      if (onboardingCacheKey) localStorage.setItem(onboardingCacheKey, 'true');
      localStorage.removeItem(ONBOARDING_KEY);
      // Flag to trigger site tour after onboarding
      sessionStorage.setItem('codearena_show_site_tour', 'true');
    }

    // Show toast if skipped
    if (skipped) {
      setSkipToast(true);
      setTimeout(() => setSkipToast(false), 3000);
    }

    // Stay on current page - don't redirect (preserves browser history)

    // Fire-and-forget API call to mark onboarding complete
    fetch(`${config.backend_url}/auth/onboarding/complete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }).catch(err => {
      console.error('Failed to mark onboarding complete:', err);
    });
  };

  const handleSkip = () => handleComplete(true);
  const handleFinish = () => handleComplete(false);

  return (
    <>
      <WelcomeModal
        isOpen={showWelcome}
        onClose={handleSkip}
        onComplete={handleFinish}
        onStepChange={(step) => setCurrentStep(step)}
        user={user}
        token={token}
        refreshUser={refreshUser}
      />

      {/* Skip Toast */}
      <AnimatePresence>
        {skipToast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-gray-800 border border-gray-700 text-white px-5 py-3 rounded-lg shadow-xl flex items-center gap-3"
          >
            <svg className="w-5 h-5 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm font-medium">Got it! You won't see this tutorial again.</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
