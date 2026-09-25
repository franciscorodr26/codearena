import { useCallback } from 'react';

/**
 * Tiny haptics wrapper around navigator.vibrate. Safe no-op where vibration is
 * unsupported (notably iOS Safari), so callers never need to guard.
 * Pair these with the audio cues from useSoundEffects at every feedback point.
 */
export function useHaptics(enabled = true) {
  const vibrate = useCallback((pattern) => {
    if (!enabled) return;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      /* silent */
    }
  }, [enabled]);

  const tap = useCallback(() => vibrate(8), [vibrate]);
  const success = useCallback(() => vibrate([12, 30, 12]), [vibrate]);
  const error = useCallback(() => vibrate(40), [vibrate]);

  return { tap, success, error, vibrate };
}

export default useHaptics;
