import { useState, useEffect } from 'react';

const DEFAULT_PREFS = {
  vimMode: false,
};

export function useEditorPreferences() {
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);

  useEffect(() => {
    const saved = localStorage.getItem('editor_preferences');
    if (saved) {
      try {
        setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(saved) });
      } catch (e) {
        console.error('Failed to parse editor preferences:', e);
      }
    }
  }, []);

  return prefs;
}
