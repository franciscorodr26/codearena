import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../../contexts/AuthContext';
import { useTutorial } from './TutorialProvider';
import { siteTour } from './tours/siteTour';
import {
  trackTourStarted,
  trackTourCompleted,
  trackTourSkipped,
} from '../../utils/analytics';

/**
 * TutorialTrigger - Automatically triggers tours based on page and user state
 *
 * Tour Flow:
 * 1. New user signs up and completes WelcomeModal
 * 2. WelcomeModal sets sessionStorage flag
 * 3. User lands on homepage -> Site Tour triggers (only once)
 */

export default function TutorialTrigger() {
  const router = useRouter();
  const { user, token } = useAuth();
  const { startTour, isTourCompleted, isTourDismissed, hasLoadedPersistedState } = useTutorial();
  const hasTriggeredRef = useRef(false);

  useEffect(() => {
    // Reset trigger on route change
    hasTriggeredRef.current = false;
  }, [router.pathname]);

  useEffect(() => {
    // Prevent multiple triggers
    if (hasTriggeredRef.current) return;
    if (!hasLoadedPersistedState) return;

    // Must be authenticated
    if (!user || !token) return;

    // Must have completed main onboarding (WelcomeModal)
    if (!user.has_onboarded) return;

    // Only show tour if coming from WelcomeModal completion (session flag)
    if (typeof window === 'undefined') return;
    const shouldShowTour = sessionStorage.getItem('codearena_show_site_tour');
    if (!shouldShowTour) return;

    // Site Tour - triggers on homepage after onboarding
    if (router.pathname === '/') {
      // Must not have completed or dismissed site tour
      if (isTourCompleted('site') || isTourDismissed('site')) return;

      // Small delay to ensure page is fully rendered
      const timer = setTimeout(() => {
        hasTriggeredRef.current = true;

        // Clear the session flag so tour doesn't show again on refresh
        sessionStorage.removeItem('codearena_show_site_tour');

        // Start site tour with analytics callbacks
        startTour({
          ...siteTour,
          onComplete: (data) => {
            trackTourCompleted({
              tourId: data.tourId,
              totalTimeSeconds: data.totalTimeSeconds,
              stepsCompleted: data.stepsCompleted,
            }, user);
          },
          onSkip: (data) => {
            trackTourSkipped({
              tourId: data.tourId,
              skippedAtStep: data.skippedAtStep,
              totalSteps: data.totalSteps,
              timeSpentSeconds: data.timeSpentSeconds,
            }, user);
          },
        });

        trackTourStarted({
          tourId: 'site',
          triggerType: 'auto',
        }, user);
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [router.pathname, user, token, startTour, isTourCompleted, isTourDismissed, hasLoadedPersistedState]);

  return null;
}
