import { useCallback, useRef, useEffect } from 'react';

/**
 * Sound effects hook for UI feedback
 * Uses Web Audio API for low-latency, crisp sounds
 */
export const useSoundEffects = (enabled = true) => {
  const audioContextRef = useRef(null);

  // Initialize audio context on first interaction
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current && typeof window !== 'undefined') {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  // Play a success chime (ascending notes)
  const playSuccess = useCallback(() => {
    if (!enabled) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      // Resume if suspended (browser autoplay policy)
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;

      // Create a pleasant success sound - two ascending notes
      const frequencies = [523.25, 659.25, 783.99]; // C5, E5, G5 (major chord)

      frequencies.forEach((freq, i) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(freq, now + i * 0.08);

        // Soft attack, quick decay
        gainNode.gain.setValueAtTime(0, now + i * 0.08);
        gainNode.gain.linearRampToValueAtTime(0.15, now + i * 0.08 + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + i * 0.08 + 0.3);

        oscillator.start(now + i * 0.08);
        oscillator.stop(now + i * 0.08 + 0.35);
      });
    } catch (e) {
      // Silent fail - audio not critical
    }
  }, [enabled, getAudioContext]);

  // Play an error sound (descending tone)
  const playError = useCallback(() => {
    if (!enabled) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;

      // Create a soft error sound - descending minor second
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(440, now); // A4
      oscillator.frequency.linearRampToValueAtTime(349.23, now + 0.15); // F4

      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.12, now + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

      oscillator.start(now);
      oscillator.stop(now + 0.3);
    } catch (e) {
      // Silent fail
    }
  }, [enabled, getAudioContext]);

  // Play a click/tap sound
  const playClick = useCallback(() => {
    if (!enabled) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;

      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(800, now);

      gainNode.gain.setValueAtTime(0.08, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.05);

      oscillator.start(now);
      oscillator.stop(now + 0.06);
    } catch (e) {
      // Silent fail
    }
  }, [enabled, getAudioContext]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  return {
    playSuccess,
    playError,
    playClick
  };
};

export default useSoundEffects;
