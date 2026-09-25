import { motion, AnimatePresence } from 'framer-motion';
import { Play, Check, X, Zap, Send } from 'lucide-react';
import { forwardRef, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import confetti from 'canvas-confetti';

// Design system colors for canvas/confetti contexts where Tailwind classes can't be used
const CONFETTI_COLORS = [
  '#22c55e',  // success
  '#a855f7',  // secondary-500
  '#f59e0b',  // warning
  '#06b6d4',  // primary-500
  '#d946ef',  // accent-500
];

/**
 * Unified Submit Button Component
 * Used across Practice, Battle, and Challenge modes for consistent UX
 *
 * Features:
 * - Shine effect on hover
 * - Pulse ring when ready
 * - Success/error state animations
 * - Sound effects (optional)
 * - Confetti burst on success (optional)
 * - Keyboard shortcut badge
 */

// Sound effects using Web Audio API
const createAudioContext = () => {
  if (typeof window === 'undefined') return null;
  return new (window.AudioContext || window.webkitAudioContext)();
};

const playSuccessSound = (ctx) => {
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const frequencies = [523.25, 659.25, 783.99]; // C5, E5, G5

    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.08);
      gain.gain.setValueAtTime(0, now + i * 0.08);
      gain.gain.linearRampToValueAtTime(0.12, now + i * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.08 + 0.25);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.3);
    });
  } catch (e) { /* silent */ }
};

const playErrorSound = (ctx) => {
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.linearRampToValueAtTime(349.23, now + 0.12);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.25);
  } catch (e) { /* silent */ }
};

// Confetti burst effect
const triggerConfetti = () => {
  if (typeof window === 'undefined') return;

  const duration = 600;
  const end = Date.now() + duration;

  const frame = () => {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.65 },
      colors: CONFETTI_COLORS
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.65 },
      colors: CONFETTI_COLORS
    });

    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  };
  frame();
};

const SubmitButton = forwardRef(({
  onClick,
  disabled = false,
  loading = false,
  success = false,
  error = false,
  label = 'Submit',
  loadingLabel = 'Running...',
  successLabel = 'Passed!',
  errorLabel = 'Failed',
  shortcut = 'Enter',
  showShortcut = true,
  fullWidth = false,
  size = 'lg',
  mode = 'default', // 'practice' | 'battle' | 'challenge' | 'default'
  pulseWhenReady = true,
  enableSound = true,
  enableConfetti = true,
  onSuccess,
  onError,
  className = '',
  ...props
}, ref) => {
  const [showSuccessState, setShowSuccessState] = useState(false);
  const [showErrorState, setShowErrorState] = useState(false);
  const audioContextRef = useRef(null);
  const prevSuccessRef = useRef(false);
  const prevErrorRef = useRef(false);

  // Initialize audio context lazily
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = createAudioContext();
    }
    return audioContextRef.current;
  }, []);

  // Handle success state transitions with sound & confetti. The visual state
  // follows the prop: it switches on when success becomes true and off as soon
  // as success is false again (a new problem, a reset), so the label can never
  // stay stuck on the success text.
  useEffect(() => {
    if (success && !prevSuccessRef.current) {
      setShowSuccessState(true);

      // Play success sound
      if (enableSound) {
        playSuccessSound(getAudioContext());
      }

      // Trigger confetti
      if (enableConfetti) {
        triggerConfetti();
      }

      // Call success callback
      onSuccess?.();
    }
    if (!success) setShowSuccessState(false);
    prevSuccessRef.current = success;
  }, [success, enableSound, enableConfetti, getAudioContext, onSuccess]);

  // Handle error state transitions with sound
  useEffect(() => {
    if (error && !prevErrorRef.current) {
      setShowErrorState(true);

      // Play error sound
      if (enableSound) {
        playErrorSound(getAudioContext());
      }

      // Call error callback
      onError?.();
    }
    if (!error) setShowErrorState(false);
    prevErrorRef.current = error;
  }, [error, enableSound, getAudioContext, onError]);

  // The success and error labels show for two seconds, then the button is ready
  // again. Owning the timers here keeps unrelated re-renders from cancelling them.
  useEffect(() => {
    if (!showSuccessState) return undefined;
    const timer = setTimeout(() => setShowSuccessState(false), 2000);
    return () => clearTimeout(timer);
  }, [showSuccessState]);

  useEffect(() => {
    if (!showErrorState) return undefined;
    const timer = setTimeout(() => setShowErrorState(false), 2000);
    return () => clearTimeout(timer);
  }, [showErrorState]);

  // Cleanup audio context
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  // Determine current visual state
  const isSuccess = showSuccessState;
  const isError = showErrorState;
  const isLoading = loading;
  const isDisabled = disabled || isLoading;
  const isReady = !isDisabled && !isLoading && !isSuccess && !isError;

  // Size configurations
  const sizeConfig = {
    sm: {
      padding: 'px-4 py-2',
      text: 'text-sm',
      icon: 'h-4 w-4',
      spinner: 'w-4 h-4',
      gap: 'gap-1.5',
    },
    md: {
      padding: 'px-6 py-3',
      text: 'text-base',
      icon: 'h-5 w-5',
      spinner: 'w-5 h-5',
      gap: 'gap-2',
    },
    lg: {
      padding: 'px-8 py-4',
      text: 'text-base',
      icon: 'h-5 w-5',
      spinner: 'w-5 h-5',
      gap: 'gap-2',
    },
  };

  const config = sizeConfig[size] || sizeConfig.md;

  // Get the appropriate icon based on mode - memoized to avoid creating during render
  const IconComponent = useMemo(() => {
    if (isLoading) return null;
    if (isSuccess) return Check;
    if (isError) return X;

    switch (mode) {
      case 'battle':
        return Send;
      case 'challenge':
        return Zap;
      default:
        return Play;
    }
  }, [isLoading, isSuccess, isError, mode]);

  // Get background gradient based on state and mode
  const getGradient = () => {
    if (isSuccess) return 'from-emerald-500 to-emerald-600';
    if (isError) return 'from-red-500 to-red-600';
    if (mode === 'battle') return 'from-purple-600 via-primary-500 to-pink-600 hover:from-purple-500 hover:via-primary-400 hover:to-pink-500';
    return 'from-success to-success-dark hover:from-success-light hover:to-success';
  };

  // Get shadow based on state and mode
  const getShadow = () => {
    if (isSuccess) return 'shadow-lg shadow-emerald-500/40';
    if (isError) return 'shadow-lg shadow-red-500/40';
    if (mode === 'battle') {
      if (isReady && pulseWhenReady) return 'shadow-xl shadow-purple-500/40 hover:shadow-purple-500/60';
      return 'shadow-xl shadow-purple-500/40';
    }
    if (isReady && pulseWhenReady) return 'shadow-lg shadow-success/30 hover:shadow-success/50';
    return 'shadow-lg shadow-success/30';
  };


  return (
    <motion.button
      ref={ref}
      onClick={onClick}
      disabled={isDisabled}
      className={`
        relative overflow-hidden group
        inline-flex items-center justify-center
        ${config.padding}
        ${fullWidth ? 'w-full' : ''}
        bg-gradient-to-r ${getGradient()}
        ${getShadow()}
        text-white font-bold rounded-xl
        transition-all duration-200
        focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface-900 ${mode === 'battle' ? 'focus:ring-purple-500' : 'focus:ring-success'}
        disabled:opacity-60 disabled:cursor-not-allowed
        ${className}
      `}
      whileHover={{ scale: isDisabled ? 1 : 1.02 }}
      whileTap={{ scale: isDisabled ? 1 : 0.98 }}
      {...props}
    >
      {/* Shine effect on hover */}
      <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/25 to-white/0 -skew-x-12 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out" />

      {/* Pulse ring when ready */}
      {isReady && pulseWhenReady && (
        <motion.div
          className={`absolute inset-0 rounded-xl border-2 ${mode === 'battle' ? 'border-purple-400/50' : 'border-white/30'}`}
          animate={{
            scale: [1, 1.08, 1],
            opacity: [0.5, 0, 0.5],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      )}

      {/* Success ripple effect */}
      <AnimatePresence>
        {isSuccess && (
          <motion.div
            className="absolute inset-0 bg-emerald-400/30 rounded-xl"
            initial={{ scale: 0, opacity: 1 }}
            animate={{ scale: 2.5, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
          />
        )}
      </AnimatePresence>

      {/* Error shake indicator */}
      <AnimatePresence>
        {isError && (
          <motion.div
            className="absolute inset-0 bg-red-400/20 rounded-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 0.3, times: [0, 0.5, 1] }}
          />
        )}
      </AnimatePresence>

      {/* Button content */}
      <motion.div
        className={`relative flex items-center justify-center ${config.gap}`}
        animate={isError ? { x: [0, -4, 4, -4, 4, 0] } : {}}
        transition={{ duration: 0.4 }}
      >
        {/* Loading spinner */}
        {isLoading && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`${config.spinner} border-2 border-white border-t-transparent rounded-full animate-spin`}
          />
        )}

        {/* Icon */}
        {IconComponent && !isLoading && (
          <motion.div
            key={isSuccess ? 'success' : isError ? 'error' : 'default'}
            initial={{ opacity: 0, scale: 0.5, rotate: -180 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          >
            <IconComponent
              className={config.icon}
              fill={mode === 'practice' || mode === 'default' ? 'currentColor' : 'none'}
            />
          </motion.div>
        )}

        {/* Label */}
        <AnimatePresence mode="wait">
          <motion.span
            key={isLoading ? 'loading' : isSuccess ? 'success' : isError ? 'error' : 'default'}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className={`${config.text} font-bold`}
          >
            {isLoading ? loadingLabel : isSuccess ? successLabel : isError ? errorLabel : label}
          </motion.span>
        </AnimatePresence>

        {/* Keyboard shortcut badge */}
        {showShortcut && shortcut && !isLoading && !isSuccess && !isError && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="ml-1 px-1.5 py-0.5 bg-white/20 rounded text-xs font-medium backdrop-blur-sm"
          >
            {shortcut}
          </motion.div>
        )}
      </motion.div>
    </motion.button>
  );
});

SubmitButton.displayName = 'SubmitButton';

export default SubmitButton;
