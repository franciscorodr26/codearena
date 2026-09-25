import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';

/**
 * Industry-standard 6-digit 2FA code input component
 * Supports both single input mode and 6 separate boxes mode
 */
export default function TwoFactorCodeInput({
  value = '',
  onChange,
  onComplete,
  mode = 'boxes', // 'boxes' or 'single'
  autoFocus = true,
  disabled = false,
  error = false,
  className = ''
}) {
  const [digits, setDigits] = useState(Array(6).fill(''));
  const inputRefs = useRef([]);

  // Sync external value with internal state
  useEffect(() => {
    if (value) {
      const newDigits = value.split('').slice(0, 6);
      while (newDigits.length < 6) newDigits.push('');
      setDigits(newDigits);
    } else {
      setDigits(Array(6).fill(''));
    }
  }, [value]);

  // Focus first input on mount
  useEffect(() => {
    if (autoFocus && mode === 'boxes' && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [autoFocus, mode]);

  const handleChange = (index, newValue) => {
    // Only allow digits
    const digit = newValue.replace(/\D/g, '').slice(-1);

    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);

    const fullCode = newDigits.join('');
    if (onChange) onChange(fullCode);

    // Auto-advance to next input
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Trigger onComplete when all 6 digits are entered
    if (fullCode.length === 6 && onComplete) {
      onComplete(fullCode);
    }
  };

  const handleKeyDown = (index, e) => {
    // Handle backspace - move to previous input
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }

    // Handle arrow keys
    if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);

    if (pastedData) {
      const newDigits = pastedData.split('');
      while (newDigits.length < 6) newDigits.push('');
      setDigits(newDigits);

      if (onChange) onChange(pastedData);

      // Focus the appropriate input
      const nextEmptyIndex = newDigits.findIndex(d => !d);
      if (nextEmptyIndex !== -1) {
        inputRefs.current[nextEmptyIndex]?.focus();
      } else if (pastedData.length === 6) {
        inputRefs.current[5]?.focus();
        if (onComplete) onComplete(pastedData);
      }
    }
  };

  const handleSingleInputChange = (e) => {
    const newValue = e.target.value.replace(/\D/g, '').slice(0, 6);
    if (onChange) onChange(newValue);
    if (newValue.length === 6 && onComplete) {
      onComplete(newValue);
    }
  };

  // Single input mode
  if (mode === 'single') {
    return (
      <div className={className}>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={value}
          onChange={handleSingleInputChange}
          onPaste={handlePaste}
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder="000000"
          className={`w-full text-center text-2xl tracking-[0.5em] font-mono py-4 bg-surface-800/50 border rounded-xl text-white placeholder-surface-600 focus:outline-none transition-all ${
            error
              ? 'border-danger focus:border-danger focus:ring-1 focus:ring-danger/50'
              : 'border-surface-700 focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        />
      </div>
    );
  }

  // Six boxes mode (default)
  return (
    <div className={`flex justify-center space-x-2 sm:space-x-3 ${className}`}>
      {digits.map((digit, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
        >
          <input
            ref={(el) => (inputRefs.current[index] = el)}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={handlePaste}
            disabled={disabled}
            className={`w-10 h-12 sm:w-12 sm:h-14 text-center text-xl sm:text-2xl font-mono rounded-xl bg-surface-800/50 border transition-all focus:outline-none ${
              error
                ? 'border-danger focus:border-danger focus:ring-1 focus:ring-danger/50 text-danger'
                : digit
                  ? 'border-primary-500/50 text-white'
                  : 'border-surface-700 focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 text-white'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          />
        </motion.div>
      ))}
    </div>
  );
}

/**
 * Timer display for TOTP code expiry
 */
export function TwoFactorTimer({ secondsRemaining = 30 }) {
  const percentage = (secondsRemaining / 30) * 100;
  const isLow = secondsRemaining <= 5;

  return (
    <div className="flex items-center justify-center space-x-2 text-sm">
      <div className={`relative w-6 h-6 ${isLow ? 'animate-pulse' : ''}`}>
        <svg className="w-6 h-6 transform -rotate-90" viewBox="0 0 24 24">
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            className="text-surface-700"
          />
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeDasharray={`${percentage * 0.628} 62.8`}
            className={isLow ? 'text-warning' : 'text-primary-400'}
            strokeLinecap="round"
          />
        </svg>
      </div>
      <span className={isLow ? 'text-warning' : 'text-surface-400'}>
        {secondsRemaining}s
      </span>
    </div>
  );
}
