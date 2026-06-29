import { useState, useEffect, useCallback } from 'react';
import { fetchWithTimeout } from '../utils/fetch';
import { config } from '../config/env';
import { useToast } from '../contexts/ToastContext';

const DEFAULT_PREFS = {
  weeklyChallenge: false,
  marketing: false,
  progressDigest: true,
  tournamentNotifications: false,
  activityReminders: true,
  creatorArenaEmails: true,
  messageDigest: true
};

/**
 * Custom hook for notification/email preference state management.
 * Handles fetching, toggling, and saving email notification preferences.
 */
export function useNotificationSettings() {
  const toast = useToast();
  const [emailPrefs, setEmailPrefs] = useState(DEFAULT_PREFS);
  const [emailPrefsLoading, setEmailPrefsLoading] = useState(true);
  const [emailPrefsSaving, setEmailPrefsSaving] = useState(false);

  const fetchEmailPrefs = useCallback(async () => {
    const authToken = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
    if (!authToken) {
      setEmailPrefsLoading(false);
      return;
    }

    try {
      const res = await fetchWithTimeout(`${config.backend_url}/api/notifications/preferences`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setEmailPrefs(data.preferences || DEFAULT_PREFS);
      }
    } catch (err) {
      console.error('Failed to fetch email preferences:', err);
    } finally {
      setEmailPrefsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmailPrefs();
  }, [fetchEmailPrefs]);

  // Re-fetch when the tab regains visibility so an unsubscribe action taken
  // in another tab (e.g. clicking an unsubscribe link from a changelog email)
  // is reflected here instead of the toggles showing stale state.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchEmailPrefs();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', fetchEmailPrefs);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', fetchEmailPrefs);
    };
  }, [fetchEmailPrefs]);

  // Save email preferences. On failure, revert UI and tell the user — the old
  // behavior silently swallowed errors so the toggle looked saved but wasn't.
  const saveEmailPrefs = async (newPrefs, previousPrefs) => {
    const authToken = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
    if (!authToken || emailPrefsSaving) return;

    setEmailPrefsSaving(true);
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/api/notifications/preferences`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify(newPrefs)
      });

      if (res.ok) {
        const data = await res.json().catch(() => null);
        setEmailPrefs(data?.preferences || newPrefs);
      } else {
        setEmailPrefs(previousPrefs);
        toast.error("Couldn't save email preferences. Please try again.");
      }
    } catch (err) {
      console.error('Failed to save email preferences:', err);
      setEmailPrefs(previousPrefs);
      toast.error("Couldn't save email preferences. Check your connection and try again.");
    } finally {
      setEmailPrefsSaving(false);
    }
  };

  const handleEmailPrefChange = (key) => {
    const previousPrefs = emailPrefs;
    const newPrefs = { ...emailPrefs, [key]: !emailPrefs[key] };
    setEmailPrefs(newPrefs);
    saveEmailPrefs(newPrefs, previousPrefs);
  };

  return {
    emailPrefs,
    emailPrefsLoading,
    emailPrefsSaving,
    handleEmailPrefChange,
  };
}
