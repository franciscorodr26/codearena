import '../styles/globals.css'
import { useEffect } from 'react'
import Head from 'next/head'
import { config } from '../config/env'
import { AuthProvider, useAuth } from '../contexts/AuthContext'
import { MatchmakingQueueProvider } from '../contexts/MatchmakingQueueContext'
import { MessagingProvider } from '../contexts/MessagingContext'
import { ChallengeProvider } from '../contexts/ChallengeContext'
import { FriendProvider } from '../contexts/FriendContext'
import { BadgeProvider } from '../contexts/BadgeContext'
import { TournamentProvider } from '../contexts/TournamentContext'
import { CookieConsentProvider, useCookieConsent } from '../contexts/CookieConsentContext'
import { ToastProvider } from '../contexts/ToastContext'
import { FeedbackProvider } from '../contexts/FeedbackContext'
import ChallengeModals from '../components/ChallengeModals'
import FriendRequestModal from '../components/FriendRequestModal'
import OnboardingWrapper from '../components/OnboardingWrapper'
import ProfileGate from '../components/ProfileGate'
import CookieConsentBanner from '../components/CookieConsentBanner'
import ErrorBoundary from '../components/ui/ErrorBoundary'
// CommandPalette removed: merged into SearchBar component
import MobileNav from '../components/MobileNav'
import GlobalFeedbackModals from '../components/GlobalFeedbackModals'
import { TutorialProvider, TutorialOverlay, TutorialTrigger } from '../components/tutorial'

// Syncs cookie consent with user account
function ConsentAuthSync() {
  const { token, isAuthenticated } = useAuth();
  const { syncConsentFromBackend, clearAuthToken } = useCookieConsent();

  useEffect(() => {
    if (isAuthenticated && token) {
      syncConsentFromBackend(token);
    } else {
      clearAuthToken();
    }
  }, [isAuthenticated, token, syncConsentFromBackend, clearAuthToken]);

  return null;
}

// Keep backend warm - ping health endpoint on app load and every 4 minutes
function BackendKeepAlive() {
  useEffect(() => {
    const pingBackend = () => {
      fetch(`${config.backend_url}/health`, { method: 'GET' }).catch(() => {});
    };

    // Ping immediately on load to warm up cold server
    pingBackend();

    // Keep pinging every 4 minutes while app is open
    const interval = setInterval(pingBackend, 4 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  return null;
}

export default function App({ Component, pageProps }) {
  // Inject environment into client-side for hydration
  if (typeof window !== 'undefined') {
    window.__ENVIRONMENT__ = config.environment;
  }

  return (
    <>
    <Head>
      <meta key="viewport" name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    </Head>
    <BackendKeepAlive />
    <CookieConsentProvider>
      <ErrorBoundary>
        <ToastProvider>
        <AuthProvider>
          <MatchmakingQueueProvider>
          <ConsentAuthSync />
          <TutorialProvider>
            <MessagingProvider>
              <ChallengeProvider>
                <FriendProvider>
                  <BadgeProvider>
                    <TournamentProvider>
                      <FeedbackProvider>
                        <>
                          <ProfileGate>
                            <Component {...pageProps} />
                          </ProfileGate>
                          <ChallengeModals />
                          <FriendRequestModal />
                          <OnboardingWrapper />
                          {/* CommandPalette removed: merged into SearchBar */}
                          <MobileNav />
                          <GlobalFeedbackModals />
                          <TutorialTrigger />
                          <TutorialOverlay />
                        </>
                      </FeedbackProvider>
                    </TournamentProvider>
                  </BadgeProvider>
                </FriendProvider>
              </ChallengeProvider>
            </MessagingProvider>
          </TutorialProvider>
          </MatchmakingQueueProvider>
        </AuthProvider>
        </ToastProvider>
      </ErrorBoundary>
      <CookieConsentBanner />
    </CookieConsentProvider>
    </>
  )
}
