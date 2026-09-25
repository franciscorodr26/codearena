import { useState, useEffect } from 'react';
import { fetchWithTimeout } from '../utils/fetch';
import { config } from '../config/env';

/**
 * Custom hook for privacy preference state management.
 * Handles fetching, toggling, and saving privacy settings (e.g., read receipts).
 */
export function usePrivacySettings() {
  const [privacyPrefs, setPrivacyPrefs] = useState({ showReadReceipts: true });
  const [privacyPrefsLoading, setPrivacyPrefsLoading] = useState(true);
  const [privacyPrefsSaving, setPrivacyPrefsSaving] = useState(false);

  // Load privacy preferences
  useEffect(() => {
    const fetchPrivacyPrefs = async () => {
      const authToken = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
      if (!authToken) {
        setPrivacyPrefsLoading(false);
        return;
      }

      try {
        const res = await fetchWithTimeout(`${config.backend_url}/api/notifications/privacy`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (res.ok) {
          const data = await res.json();
          setPrivacyPrefs(data.privacy || { showReadReceipts: true });
        }
      } catch (err) {
        console.error('Failed to fetch privacy preferences:', err);
      } finally {
        setPrivacyPrefsLoading(false);
      }
    };
    fetchPrivacyPrefs();
  }, []);

  // Save privacy preferences
  const savePrivacyPrefs = async (newPrefs) => {
    const authToken = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
    if (!authToken || privacyPrefsSaving) return;

    setPrivacyPrefsSaving(true);
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/api/notifications/privacy`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify(newPrefs)
      });

      if (res.ok) {
        setPrivacyPrefs(newPrefs);
      }
    } catch (err) {
      console.error('Failed to save privacy preferences:', err);
    } finally {
      setPrivacyPrefsSaving(false);
    }
  };

  const handlePrivacyPrefChange = (key) => {
    const newPrefs = { ...privacyPrefs, [key]: !privacyPrefs[key] };
    setPrivacyPrefs(newPrefs);
    savePrivacyPrefs(newPrefs);
  };

  return {
    privacyPrefs,
    privacyPrefsLoading,
    privacyPrefsSaving,
    handlePrivacyPrefChange,
  };
}
