import { useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Cookie, X, Settings, Check, Shield } from 'lucide-react';
import { useCookieConsent } from '../contexts/CookieConsentContext';

export default function CookieConsentBanner() {
  const {
    consent,
    showBanner,
    showSettings,
    acceptAll,
    rejectAll,
    openSettings,
    closeSettings,
    saveCustomPreferences
  } = useCookieConsent();

  const [localConsent, setLocalConsent] = useState({
    analytics: consent.analytics,
    functional: consent.functional
  });

  // Update local state when opening settings
  const handleOpenSettings = () => {
    setLocalConsent({
      analytics: consent.analytics,
      functional: consent.functional
    });
    openSettings();
  };

  // Save customized preferences
  const handleSavePreferences = () => {
    // Check if anything changed
    const hasChanges =
      localConsent.analytics !== consent.analytics ||
      localConsent.functional !== consent.functional;

    if (hasChanges) {
      saveCustomPreferences(localConsent);
    }
    closeSettings();
  };

  return (
    <>
      {/* Cookie Banner */}
      <AnimatePresence>
        {showBanner && !showSettings && (
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 px-4 py-2"
          >
            <div className="max-w-4xl mx-auto bg-surface-800 border border-surface-600 rounded-xl shadow-2xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5">
                <p className="text-surface-300 text-xs sm:text-sm leading-tight">
                  We use cookies to improve your experience.{' '}
                  <Link href="/privacy" className="text-primary-400 hover:text-primary-300 underline">Privacy Policy</Link>
                </p>
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                  <button
                    onClick={handleOpenSettings}
                    className="text-surface-400 hover:text-white p-1.5 rounded-lg hover:bg-surface-700 transition-colors"
                    title="Customize"
                    aria-label="Cookie settings"
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                  <button
                    onClick={rejectAll}
                    className="px-3 py-1.5 bg-surface-700 hover:bg-surface-600 text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    Reject
                  </button>
                  <button
                    onClick={acceptAll}
                    className="px-3 py-1.5 bg-gradient-to-r from-primary-500 to-secondary-600 hover:from-primary-400 hover:to-secondary-500 text-white rounded-lg text-xs font-semibold transition-all"
                  >
                    Accept
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={closeSettings}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="w-full max-w-lg bg-surface-800 border border-surface-600 rounded-xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-surface-700">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary-500/20 rounded-lg">
                    <Settings className="h-5 w-5 text-primary-400" />
                  </div>
                  <h2 className="text-lg font-semibold text-white">Cookie Settings</h2>
                </div>
                <button
                  onClick={closeSettings}
                  className="p-2 hover:bg-surface-700 rounded-lg text-surface-400 hover:text-white transition-colors"
                  aria-label="Close settings"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
                {/* Essential Cookies - Always On */}
                <div className="p-4 bg-surface-700/50 rounded-lg border border-surface-600">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="p-1.5 bg-green-500/20 rounded-lg mt-0.5">
                        <Shield className="h-4 w-4 text-green-400" />
                      </div>
                      <div>
                        <h3 className="font-medium text-white">Essential Cookies</h3>
                        <p className="text-sm text-surface-400 mt-1">
                          Required for the website to function. Includes authentication, session management, and anti-cheat protection to ensure fair play in battles.
                        </p>
                      </div>
                    </div>
                    <div className="px-3 py-1 bg-green-500/20 text-green-400 text-xs font-medium rounded-full shrink-0">
                      Always On
                    </div>
                  </div>
                </div>

                {/* Analytics Cookies */}
                <div className="p-4 bg-surface-700/50 rounded-lg border border-surface-600">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h3 className="font-medium text-white">Analytics Cookies</h3>
                      <p className="text-sm text-surface-400 mt-1">
                        Help us understand how you use CodeArena so we can improve the experience.
                        Includes page views, feature usage, and performance metrics.
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={localConsent.analytics}
                        onChange={(e) => setLocalConsent(prev => ({ ...prev, analytics: e.target.checked }))}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-surface-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
                    </label>
                  </div>
                </div>

                {/* Functional Cookies */}
                <div className="p-4 bg-surface-700/50 rounded-lg border border-surface-600">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h3 className="font-medium text-white">Functional Cookies</h3>
                      <p className="text-sm text-surface-400 mt-1">
                        Enable personalization features like remembering your preferences and settings across sessions.
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={localConsent.functional}
                        onChange={(e) => setLocalConsent(prev => ({ ...prev, functional: e.target.checked }))}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-surface-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
                    </label>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between p-4 border-t border-surface-700 bg-surface-850">
                <Link
                  href="/privacy"
                  className="text-sm text-surface-400 hover:text-primary-400 transition-colors"
                >
                  Privacy Policy
                </Link>
                <div className="flex items-center gap-2">
                  <button
                    onClick={rejectAll}
                    className="px-4 py-2 text-surface-300 hover:text-white hover:bg-surface-700 rounded-lg text-sm font-medium transition-colors"
                  >
                    Reject All
                  </button>
                  <button
                    onClick={handleSavePreferences}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-secondary-600 hover:from-primary-400 hover:to-secondary-500 text-white rounded-lg text-sm font-semibold transition-all"
                  >
                    <Check className="h-4 w-4" />
                    Save Preferences
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// Standalone button to open cookie settings (for use in footer/privacy page)
export function CookieSettingsButton({ className = '' }) {
  const { openSettings } = useCookieConsent();

  return (
    <button
      onClick={openSettings}
      className={`flex items-center gap-2 text-surface-400 hover:text-primary-400 transition-colors ${className}`}
    >
      <Cookie className="h-4 w-4" />
      <span>Cookie Settings</span>
    </button>
  );
}
