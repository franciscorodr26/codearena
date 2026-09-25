// AttentionCheck.js - Random attention verification during battles
// Forces users to stay engaged, making it harder to use external resources

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle, XCircle, Zap } from 'lucide-react';

// Challenge types
const CHALLENGE_TYPES = {
  CLICK_BUTTON: 'click_button',
  TYPE_CODE: 'type_code',
  MATH_PROBLEM: 'math_problem',
  PATTERN_MATCH: 'pattern_match',
  COLOR_SELECT: 'color_select'
};

// Generate random challenges
function generateChallenge() {
  const types = Object.values(CHALLENGE_TYPES);
  const type = types[Math.floor(Math.random() * types.length)];

  switch (type) {
    case CHALLENGE_TYPES.CLICK_BUTTON: {
      const colors = ['cyan', 'purple', 'green', 'yellow', 'red'];
      const targetColor = colors[Math.floor(Math.random() * colors.length)];
      const shuffledColors = [...colors].sort(() => Math.random() - 0.5);
      return {
        type,
        instruction: `Quick! Click the ${targetColor} button`,
        targetColor,
        options: shuffledColors,
        timeLimit: 5000
      };
    }

    case CHALLENGE_TYPES.TYPE_CODE: {
      const codes = ['FOCUS', 'CODE', 'ARENA', 'BATTLE', 'SOLVE', 'WIN'];
      const targetCode = codes[Math.floor(Math.random() * codes.length)];
      return {
        type,
        instruction: `Type: ${targetCode}`,
        targetCode,
        timeLimit: 6000
      };
    }

    case CHALLENGE_TYPES.MATH_PROBLEM: {
      const a = Math.floor(Math.random() * 10) + 1;
      const b = Math.floor(Math.random() * 10) + 1;
      const ops = ['+', '-', '*'];
      const op = ops[Math.floor(Math.random() * ops.length)];
      let answer;
      switch (op) {
        case '+': answer = a + b; break;
        case '-': answer = a - b; break;
        case '*': answer = a * b; break;
      }
      return {
        type,
        instruction: `Solve: ${a} ${op} ${b} = ?`,
        answer: answer.toString(),
        timeLimit: 7000
      };
    }

    case CHALLENGE_TYPES.PATTERN_MATCH: {
      const patterns = ['▲▲▲', '●●●', '■■■', '◆◆◆', '★★★'];
      const target = patterns[Math.floor(Math.random() * patterns.length)];
      const shuffled = [...patterns].sort(() => Math.random() - 0.5);
      return {
        type,
        instruction: `Find: ${target}`,
        targetPattern: target,
        options: shuffled,
        timeLimit: 5000
      };
    }

    case CHALLENGE_TYPES.COLOR_SELECT: {
      const positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
      const target = positions[Math.floor(Math.random() * positions.length)];
      return {
        type,
        instruction: `Click the ${target.replace('-', ' ')} square`,
        targetPosition: target,
        timeLimit: 4000
      };
    }

    default:
      return generateChallenge();
  }
}

const colorMap = {
  cyan: 'bg-cyan-500 hover:bg-cyan-400',
  purple: 'bg-purple-500 hover:bg-purple-400',
  green: 'bg-green-500 hover:bg-green-400',
  yellow: 'bg-yellow-500 hover:bg-yellow-400',
  red: 'bg-red-500 hover:bg-red-400'
};

export default function AttentionCheck({
  isActive,
  onComplete,
  onFail,
  minInterval = 60000, // Minimum 1 minute between checks
  maxInterval = 180000 // Maximum 3 minutes between checks
}) {
  const [showCheck, setShowCheck] = useState(false);
  const [challenge, setChallenge] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [result, setResult] = useState(null); // 'success' | 'fail' | null

  // Schedule next attention check
  const scheduleNextCheck = useCallback(() => {
    if (!isActive) return;

    const delay = Math.floor(Math.random() * (maxInterval - minInterval)) + minInterval;

    const timeout = setTimeout(() => {
      if (isActive) {
        const newChallenge = generateChallenge();
        setChallenge(newChallenge);
        setTimeRemaining(newChallenge.timeLimit);
        setInputValue('');
        setResult(null);
        setShowCheck(true);
      }
    }, delay);

    return () => clearTimeout(timeout);
  }, [isActive, minInterval, maxInterval]);

  // Start scheduling when active
  useEffect(() => {
    if (isActive) {
      return scheduleNextCheck();
    }
  }, [isActive, scheduleNextCheck]);

  const handleSuccess = useCallback(() => {
    setResult('success');
    setTimeout(() => {
      setShowCheck(false);
      setChallenge(null);
      onComplete?.();
      scheduleNextCheck();
    }, 800);
  }, [onComplete, scheduleNextCheck]);

  const handleFail = useCallback((reason = 'wrong_answer') => {
    setResult('fail');
    setTimeout(() => {
      setShowCheck(false);
      setChallenge(null);
      onFail?.(reason);
      scheduleNextCheck();
    }, 1500);
  }, [onFail, scheduleNextCheck]);

  // Countdown timer
  useEffect(() => {
    if (!showCheck || timeRemaining <= 0) return;

    const interval = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 100) {
          // Time's up!
          handleFail('timeout');
          return 0;
        }
        return prev - 100;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [showCheck, timeRemaining, handleFail]);

  const handleButtonClick = (value) => {
    if (challenge.type === CHALLENGE_TYPES.CLICK_BUTTON) {
      if (value === challenge.targetColor) {
        handleSuccess();
      } else {
        handleFail('wrong_color');
      }
    } else if (challenge.type === CHALLENGE_TYPES.PATTERN_MATCH) {
      if (value === challenge.targetPattern) {
        handleSuccess();
      } else {
        handleFail('wrong_pattern');
      }
    } else if (challenge.type === CHALLENGE_TYPES.COLOR_SELECT) {
      if (value === challenge.targetPosition) {
        handleSuccess();
      } else {
        handleFail('wrong_position');
      }
    }
  };

  const handleInputSubmit = (e) => {
    e.preventDefault();
    if (challenge.type === CHALLENGE_TYPES.TYPE_CODE) {
      if (inputValue.toUpperCase() === challenge.targetCode) {
        handleSuccess();
      } else {
        handleFail('wrong_code');
      }
    } else if (challenge.type === CHALLENGE_TYPES.MATH_PROBLEM) {
      if (inputValue === challenge.answer) {
        handleSuccess();
      } else {
        handleFail('wrong_answer');
      }
    }
  };

  if (!showCheck || !challenge) return null;

  const progressPercent = (timeRemaining / challenge.timeLimit) * 100;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center"
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-gradient-to-br from-surface-800 to-surface-900 border border-surface-600 rounded-xl p-6 max-w-md w-full mx-4 relative overflow-hidden"
        >
          {/* Progress bar */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-surface-700">
            <motion.div
              className={`h-full ${progressPercent > 30 ? 'bg-primary-500' : 'bg-red-500'}`}
              style={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.1 }}
            />
          </div>

          {/* Header */}
          <div className="flex items-center justify-center mb-4 pt-2">
            <Zap className="h-6 w-6 text-yellow-400 mr-2" />
            <h3 className="text-lg font-bold text-white">Attention Check</h3>
          </div>

          {/* Result overlay */}
          {result && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 flex items-center justify-center bg-surface-900/90 z-10"
            >
              {result === 'success' ? (
                <div className="text-center">
                  <CheckCircle className="h-16 w-16 text-green-400 mx-auto mb-2" />
                  <p className="text-green-400 font-bold">Verified!</p>
                </div>
              ) : (
                <div className="text-center">
                  <XCircle className="h-16 w-16 text-red-400 mx-auto mb-2" />
                  <p className="text-red-400 font-bold">Too slow or incorrect</p>
                  <p className="text-surface-400 text-sm mt-1">This has been logged</p>
                </div>
              )}
            </motion.div>
          )}

          {/* Challenge content */}
          <div className="text-center">
            <p className="text-white text-lg mb-4">{challenge.instruction}</p>

            {/* Click Button Challenge */}
            {challenge.type === CHALLENGE_TYPES.CLICK_BUTTON && (
              <div className="flex justify-center gap-3 flex-wrap">
                {challenge.options.map((color) => (
                  <button
                    key={color}
                    onClick={() => handleButtonClick(color)}
                    className={`w-16 h-16 rounded-lg ${colorMap[color]} transition-transform hover:scale-110 active:scale-95`}
                  />
                ))}
              </div>
            )}

            {/* Type Code Challenge */}
            {challenge.type === CHALLENGE_TYPES.TYPE_CODE && (
              <form onSubmit={handleInputSubmit}>
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  autoFocus
                  className="w-full px-4 py-3 bg-surface-700 border border-surface-600 rounded-lg text-white text-center text-xl font-mono uppercase tracking-widest focus:outline-none focus:border-primary-500"
                  placeholder="Type here..."
                />
                <button
                  type="submit"
                  className="mt-3 px-6 py-2 bg-primary-500 hover:bg-primary-400 text-white rounded-lg font-medium transition-colors"
                >
                  Submit
                </button>
              </form>
            )}

            {/* Math Problem Challenge */}
            {challenge.type === CHALLENGE_TYPES.MATH_PROBLEM && (
              <form onSubmit={handleInputSubmit}>
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value.replace(/[^0-9-]/g, ''))}
                  autoFocus
                  className="w-32 px-4 py-3 bg-surface-700 border border-surface-600 rounded-lg text-white text-center text-2xl font-mono focus:outline-none focus:border-primary-500"
                  placeholder="?"
                />
                <button
                  type="submit"
                  className="ml-3 px-6 py-3 bg-primary-500 hover:bg-primary-400 text-white rounded-lg font-medium transition-colors"
                >
                  Submit
                </button>
              </form>
            )}

            {/* Pattern Match Challenge */}
            {challenge.type === CHALLENGE_TYPES.PATTERN_MATCH && (
              <div className="flex justify-center gap-3 flex-wrap">
                {challenge.options.map((pattern, i) => (
                  <button
                    key={i}
                    onClick={() => handleButtonClick(pattern)}
                    className="w-20 h-16 rounded-lg bg-surface-700 hover:bg-surface-600 border border-surface-600 text-2xl transition-all hover:scale-105"
                  >
                    {pattern}
                  </button>
                ))}
              </div>
            )}

            {/* Color Select Challenge */}
            {challenge.type === CHALLENGE_TYPES.COLOR_SELECT && (
              <div className="grid grid-cols-2 gap-3 w-48 mx-auto">
                <button
                  onClick={() => handleButtonClick('top-left')}
                  className="h-20 rounded-lg bg-cyan-500 hover:bg-cyan-400 transition-all hover:scale-105"
                />
                <button
                  onClick={() => handleButtonClick('top-right')}
                  className="h-20 rounded-lg bg-purple-500 hover:bg-purple-400 transition-all hover:scale-105"
                />
                <button
                  onClick={() => handleButtonClick('bottom-left')}
                  className="h-20 rounded-lg bg-green-500 hover:bg-green-400 transition-all hover:scale-105"
                />
                <button
                  onClick={() => handleButtonClick('bottom-right')}
                  className="h-20 rounded-lg bg-yellow-500 hover:bg-yellow-400 transition-all hover:scale-105"
                />
              </div>
            )}

            {/* Time warning */}
            <div className="mt-4 flex items-center justify-center text-surface-400 text-sm">
              <AlertTriangle className={`h-4 w-4 mr-1 ${progressPercent < 30 ? 'text-red-400' : ''}`} />
              <span className={progressPercent < 30 ? 'text-red-400' : ''}>
                {Math.ceil(timeRemaining / 1000)}s remaining
              </span>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
