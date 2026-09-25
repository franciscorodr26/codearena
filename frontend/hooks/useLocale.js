import { useState, useEffect, useCallback } from 'react';
import { LANGUAGES, LANGUAGE_CODES, isRTL } from '../lib/learn/languages';

const STORAGE_KEY = 'codearena_learn_locale';

// Re-exported so the picker has the full list.
export const SUPPORTED_LOCALES = LANGUAGES;

// Map a device locale (BCP-47, e.g. "zh-Hant-HK", "pt-BR") to one of our codes.
// We use specific languages, so Chinese variants resolve to Mandarin/Cantonese.
function detectLocale() {
  if (typeof navigator === 'undefined') return 'en';
  const tag = (navigator.language || 'en').toLowerCase();
  const primary = tag.split('-')[0];

  if (primary === 'zh') {
    if (tag.includes('yue') || tag.includes('hk') || tag.includes('mo')) return 'yue';
    return LANGUAGE_CODES.includes('cmn') ? 'cmn' : 'en';
  }
  if (primary === 'fil' || primary === 'tl') return LANGUAGE_CODES.includes('fil') ? 'fil' : 'en';

  // Try the full tag first (3-letter codes like "ckb"), then the primary subtag.
  if (LANGUAGE_CODES.includes(tag)) return tag;
  if (LANGUAGE_CODES.includes(primary)) return primary;
  return 'en';
}

/**
 * The learner's chosen natural language for lessons + tutor.
 * Auto-detects from the device on first visit, persists an override, and
 * derives text direction. Code/keywords always stay English regardless.
 */
export function useLocale() {
  // Default to 'en' on the server so SSR and first client render agree, then
  // hydrate the real value in an effect to avoid a hydration mismatch.
  const [locale, setLocaleState] = useState('en');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && LANGUAGE_CODES.includes(saved)) {
        setLocaleState(saved);
      } else {
        setLocaleState(detectLocale());
      }
    } catch {
      setLocaleState(detectLocale());
    }
  }, []);

  const setLocale = useCallback((code) => {
    if (!LANGUAGE_CODES.includes(code)) return;
    setLocaleState(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      /* silent */
    }
  }, []);

  const dir = isRTL(locale) ? 'rtl' : 'ltr';

  return { locale, setLocale, dir };
}

export default useLocale;
