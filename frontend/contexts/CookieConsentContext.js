import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { config } from '../config/env';

const CookieConsentContext = createContext(null);

const CONSENT_KEY = 'codearena_cookie_consent';

/**
 * Fetch user's consent from backend (for logged-in users)
 */
async function fetchUserConsent(token) {
  try {
    const response = await fetch(`${config.backend_url}/auth/consent`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    if (response.ok) {
      const data = await response.json();
      return data.consent; // null if user hasn't set consent yet
    }
  } catch (error) {
    console.debug('[CookieConsent] Failed to fetch user consent:', error.message);
  }
  return undefined; // Error - don't change anything
}

/**
 * Save user's consent to backend (for logged-in users)
 */
async function saveUserConsentToBackend(token, analytics, functional) {
  try {
    await fetch(`${config.backend_url}/auth/consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify({ analytics, functional })
    });
  } catch (error) {
    console.debug('[CookieConsent] Failed to save user consent:', error.message);
  }
}

/**
 * Send consent event directly to backend (bypasses consent check)
 * This allows us to track all consent choices, even rejections
 */
async function trackConsentEvent(action, consentState) {
  try {
    await fetch(`${config.backend_url}/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        event: 'cookie-consent',
        playerId: null, // Anonymous - we don't have consent to identify yet
        props: {
          action, // 'accept_all', 'reject_all', 'customize'
          analytics: consentState.analytics,
          functional: consentState.functional,
          clientTs: Date.now()
        },
        timestamp: new Date().toISOString()
      })
    });
  } catch (error) {
    // Silently fail - don't disrupt UX for tracking
    console.debug('[CookieConsent] Failed to track consent:', error.message);
  }
}

// Default consent state - all non-essential cookies disabled until user consents
const DEFAULT_CONSENT = {
  analytics: false,
  functional: false,
  timestamp: null
};

export function CookieConsentProvider({ children }) {
  const [consent, setConsent] = useState(DEFAULT_CONSENT);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const authTokenRef = useRef(null); // Store token for backend sync

  // Load consent state from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(CONSENT_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setConsent(parsed);
        setShowBanner(false);
      } else {
        // No stored consent - show banner
        setShowBanner(true);
      }
    } catch (e) {
      console.error('[CookieConsent] Failed to load consent:', e);
      setShowBanner(true);
    }
    setIsLoaded(true);
  }, []);

  // Sync consent from backend when user logs in
  const syncConsentFromBackend = useCallback(async (token) => {
    authTokenRef.current = token;
    if (!token) return;

    const backendConsent = await fetchUserConsent(token);

    if (backendConsent === undefined) {
      // Error fetching - keep current state
      return;
    }

    if (backendConsent === null) {
      // User has never set consent on backend
      // Check if we have localStorage consent - if so, sync it to backend
      const stored = localStorage.getItem(CONSENT_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          // Sync localStorage consent to backend, don't show banner
          saveUserConsentToBackend(token, parsed.analytics, parsed.functional);
        } catch (e) {
          // Parse error - show banner
          setShowBanner(true);
        }
      } else {
        // No localStorage consent either - show banner
        setShowBanner(true);
      }
    } else {
      // User has consent stored - use it
      const consentWithTimestamp = {
        analytics: backendConsent.analytics,
        functional: backendConsent.functional,
        timestamp: backendConsent.updatedAt
      };
      setConsent(consentWithTimestamp);
      setShowBanner(false);
      // Also save to localStorage for current session
      localStorage.setItem(CONSENT_KEY, JSON.stringify(consentWithTimestamp));
    }
  }, []);

  // Clear auth token on logout
  const clearAuthToken = useCallback(() => {
    authTokenRef.current = null;
  }, []);

  // Save consent to localStorage and backend (if logged in)
  const saveConsent = useCallback((newConsent) => {
    const consentWithTimestamp = {
      ...newConsent,
      timestamp: new Date().toISOString()
    };
    setConsent(consentWithTimestamp);
    setShowBanner(false);
    setShowSettings(false);

    if (typeof window !== 'undefined') {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(consentWithTimestamp));
    }

    // Also save to backend if user is logged in
    if (authTokenRef.current) {
      saveUserConsentToBackend(authTokenRef.current, newConsent.analytics, newConsent.functional);
    }
  }, []);

  // Check if a specific category has consent
  const hasConsent = useCallback((category) => {
    if (category === 'essential') return true; // Essential always allowed
    return consent[category] === true;
  }, [consent]);

  // Update consent for a specific category (used internally)
  const updateConsent = useCallback((category, value) => {
    const newConsent = {
      ...consent,
      [category]: value
    };
    saveConsent(newConsent);
  }, [consent, saveConsent]);

  // Save custom preferences (batch update with single tracking event)
  const saveCustomPreferences = useCallback((newConsent) => {
    trackConsentEvent('customize', newConsent);
    saveConsent(newConsent);

    // Clear tracking data if analytics was disabled
    if (!newConsent.analytics && typeof window !== 'undefined') {
      localStorage.removeItem('codearena_anon_id');
    }
  }, [saveConsent]);

  // Accept all cookies
  const acceptAll = useCallback(() => {
    const newConsent = {
      analytics: true,
      functional: true
    };
    trackConsentEvent('accept_all', newConsent);
    saveConsent(newConsent);
  }, [saveConsent]);

  // Reject all non-essential cookies
  const rejectAll = useCallback(() => {
    const newConsent = {
      analytics: false,
      functional: false
    };
    trackConsentEvent('reject_all', newConsent);
    saveConsent(newConsent);

    // Clear any existing tracking data
    if (typeof window !== 'undefined') {
      localStorage.removeItem('codearena_anon_id');
    }
  }, [saveConsent]);

  // Open/close settings modal
  const openSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  // Close banner without making a choice (user can still use site)
  const dismissBanner = useCallback(() => {
    setShowBanner(false);
  }, []);

  const value = {
    consent,
    isLoaded,
    showBanner,
    showSettings,
    hasConsent,
    updateConsent,
    saveCustomPreferences,
    acceptAll,
    rejectAll,
    openSettings,
    closeSettings,
    dismissBanner,
    syncConsentFromBackend,
    clearAuthToken
  };

  return (
    <CookieConsentContext.Provider value={value}>
      {children}
    </CookieConsentContext.Provider>
  );
}

export function useCookieConsent() {
  const context = useContext(CookieConsentContext);
  if (!context) {
    throw new Error('useCookieConsent must be used within a CookieConsentProvider');
  }
  return context;
}

// Standalone function to check consent without React context
// Used by analytics.js which can't use hooks
export function getStoredConsent() {
  if (typeof window === 'undefined') return DEFAULT_CONSENT;

  try {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('[CookieConsent] Failed to read stored consent:', e);
  }
  return DEFAULT_CONSENT;
}

// Check if analytics consent is given (for use outside React)
export function hasAnalyticsConsent() {
  return getStoredConsent().analytics === true;
}

// Check if functional consent is given (for use outside React)
export function hasFunctionalConsent() {
  return getStoredConsent().functional === true;
}

export default CookieConsentContext;
