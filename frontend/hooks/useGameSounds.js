import { useCallback, useRef, useEffect, useState } from 'react';

/**
 * Game sound effects hook for agent battles
 * Uses Web Audio API to generate sounds programmatically
 * Includes volume control and localStorage persistence
 */
export const useGameSounds = () => {
  const audioContextRef = useRef(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [volume, setVolume] = useState(1.0);

  // Initialize from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('gameSoundsEnabled');
      const savedVolume = localStorage.getItem('gameSoundsVolume');

      if (saved !== null) {
        setSoundEnabled(saved === 'true');
      }
      if (savedVolume !== null) {
        setVolume(parseFloat(savedVolume));
      }
    }
  }, []);

  // Save preferences to localStorage
  const toggleSound = useCallback(() => {
    setSoundEnabled(prev => {
      const newValue = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('gameSoundsEnabled', String(newValue));
      }
      return newValue;
    });
  }, []);

  const setVolumeLevel = useCallback((level) => {
    const clampedVolume = Math.max(0, Math.min(1, level));
    setVolume(clampedVolume);
    if (typeof window !== 'undefined') {
      localStorage.setItem('gameSoundsVolume', String(clampedVolume));
    }
  }, []);

  // Initialize audio context on first interaction
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current && typeof window !== 'undefined') {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  // Victory sound - Triumphant ascending notes (C-E-G chord arpeggio)
  const victory = useCallback(() => {
    if (!soundEnabled) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;
      const frequencies = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6

      frequencies.forEach((freq, i) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(freq, now + i * 0.1);

        // Victory envelope - bright and triumphant
        gainNode.gain.setValueAtTime(0, now + i * 0.1);
        gainNode.gain.linearRampToValueAtTime(0.25 * volume, now + i * 0.1 + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.5);

        oscillator.start(now + i * 0.1);
        oscillator.stop(now + i * 0.1 + 0.55);
      });
    } catch (e) {
      console.error('Victory sound error:', e);
    }
  }, [soundEnabled, volume, getAudioContext]);

  // Defeat sound - Descending minor notes
  const defeat = useCallback(() => {
    if (!soundEnabled) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;
      const frequencies = [440, 392, 349.23]; // A4, G4, F4 (descending)

      frequencies.forEach((freq, i) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'triangle'; // Warmer, softer tone for defeat
        oscillator.frequency.setValueAtTime(freq, now + i * 0.15);

        // Defeat envelope - somber
        gainNode.gain.setValueAtTime(0, now + i * 0.15);
        gainNode.gain.linearRampToValueAtTime(0.18 * volume, now + i * 0.15 + 0.03);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + i * 0.15 + 0.4);

        oscillator.start(now + i * 0.15);
        oscillator.stop(now + i * 0.15 + 0.45);
      });
    } catch (e) {
      console.error('Defeat sound error:', e);
    }
  }, [soundEnabled, volume, getAudioContext]);

  // Streak milestone sound - Quick ascending beeps
  const streakUp = useCallback(() => {
    if (!soundEnabled) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;
      const frequencies = [659.25, 783.99, 987.77, 1318.51]; // E5, G5, B5, E6

      frequencies.forEach((freq, i) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'square'; // Sharper, more digital sound
        oscillator.frequency.setValueAtTime(freq, now + i * 0.05);

        // Quick beep envelope
        gainNode.gain.setValueAtTime(0, now + i * 0.05);
        gainNode.gain.linearRampToValueAtTime(0.15 * volume, now + i * 0.05 + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + i * 0.05 + 0.08);

        oscillator.start(now + i * 0.05);
        oscillator.stop(now + i * 0.05 + 0.1);
      });
    } catch (e) {
      console.error('Streak sound error:', e);
    }
  }, [soundEnabled, volume, getAudioContext]);

  // Badge unlock sound - Magical chime
  const badgeUnlock = useCallback(() => {
    if (!soundEnabled) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;

      // Play harmonious chord with shimmer
      const baseFrequencies = [523.25, 659.25, 783.99]; // C5, E5, G5
      const shimmer = [1046.50, 1318.51]; // C6, E6 (octave higher)

      // Base chord
      baseFrequencies.forEach((freq, i) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(freq, now);

        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.12 * volume, now + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 1.2);

        oscillator.start(now);
        oscillator.stop(now + 1.3);
      });

      // Shimmer effect (delayed high notes)
      shimmer.forEach((freq, i) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(freq, now + 0.15 + i * 0.08);

        gainNode.gain.setValueAtTime(0, now + 0.15 + i * 0.08);
        gainNode.gain.linearRampToValueAtTime(0.08 * volume, now + 0.17 + i * 0.08);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.9 + i * 0.08);

        oscillator.start(now + 0.15 + i * 0.08);
        oscillator.stop(now + 1.0 + i * 0.08);
      });
    } catch (e) {
      console.error('Badge unlock sound error:', e);
    }
  }, [soundEnabled, volume, getAudioContext]);

  // Match found sound - Alert/ready sound
  const matchFound = useCallback(() => {
    if (!soundEnabled) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;

      // Two-tone alert
      const frequencies = [880, 1046.50]; // A5, C6

      frequencies.forEach((freq, i) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(freq, now + i * 0.12);

        gainNode.gain.setValueAtTime(0, now + i * 0.12);
        gainNode.gain.linearRampToValueAtTime(0.2 * volume, now + i * 0.12 + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + i * 0.12 + 0.15);

        oscillator.start(now + i * 0.12);
        oscillator.stop(now + i * 0.12 + 0.18);
      });
    } catch (e) {
      console.error('Match found sound error:', e);
    }
  }, [soundEnabled, volume, getAudioContext]);

  // Code chunk sound - Subtle typing click (very quiet)
  const codeChunk = useCallback(() => {
    if (!soundEnabled) return;

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
      oscillator.frequency.setValueAtTime(1200, now);

      // Very subtle click
      gainNode.gain.setValueAtTime(0.03 * volume, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.02);

      oscillator.start(now);
      oscillator.stop(now + 0.025);
    } catch (e) {
      // Silent fail for subtle effects
    }
  }, [soundEnabled, volume, getAudioContext]);

  // Countdown tick sound
  const countdown = useCallback(() => {
    if (!soundEnabled) return;

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

      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.1 * volume, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

      oscillator.start(now);
      oscillator.stop(now + 0.1);
    } catch (e) {
      console.error('Countdown sound error:', e);
    }
  }, [soundEnabled, volume, getAudioContext]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  return {
    // Sound functions
    victory,
    defeat,
    streakUp,
    badgeUnlock,
    matchFound,
    codeChunk,
    countdown,

    // Controls
    soundEnabled,
    toggleSound,
    volume,
    setVolume: setVolumeLevel
  };
};

export default useGameSounds;
