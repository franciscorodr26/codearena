import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// A single stickman at a desk with a monitor
// facing="right" means the stickman is on the left side, facing right
const Stickman = ({ facing = 'right', phase, isWinner }) => {
  const flip = facing === 'left';
  // Stickman color: green for winner, red for loser, gray during typing/idle
  const bodyColor = phase === 'result' ? (isWinner ? '#4ade80' : '#f87171') : '#d1d5db';

  // Arm animation based on phase
  const getArmProps = () => {
    if (phase === 'typing') {
      return {
        animate: { y: [0, -2, 0, 2, 0] },
        transition: { duration: 0.4, repeat: Infinity, ease: 'easeInOut' },
      };
    }
    if (phase === 'result' && !isWinner) {
      return {};
    }
    return {};
  };

  // Head/body tilt for result
  const getBodyProps = () => {
    if (phase === 'result' && isWinner) {
      return {
        animate: { y: [0, -4, 0] },
        transition: { duration: 0.5, repeat: Infinity },
      };
    }
    if (phase === 'result' && !isWinner) {
      return {
        animate: { rotate: 12, y: 5, originX: '60px', originY: '170px' },
        transition: { duration: 0.6 },
      };
    }
    return {};
  };

  return (
    <svg
      viewBox="0 0 200 260"
      className="w-full h-full"
      style={{ transform: flip ? 'scaleX(-1)' : undefined }}
    >
      {/* Desk: static, not part of body group */}
      <rect x="100" y="160" width="80" height="6" rx="2" fill="#4b5563" />
      {/* Desk legs */}
      <line x1="110" y1="166" x2="110" y2="220" stroke="#4b5563" strokeWidth="3" />
      <line x1="170" y1="166" x2="170" y2="220" stroke="#4b5563" strokeWidth="3" />

      {/* Chair: static, not part of body group */}
      {/* Seat */}
      <rect x="40" y="164" width="40" height="6" rx="3" fill="#6b7280" />
      {/* Backrest */}
      <path d="M 40 164 L 36 120 Q 38 115 42 115 L 42 164" fill="#6b7280" rx="2" />
      {/* Center post */}
      <line x1="60" y1="170" x2="60" y2="210" stroke="#6b7280" strokeWidth="3" />
      {/* Base: 5 legs with wheels */}
      <line x1="60" y1="210" x2="42" y2="220" stroke="#6b7280" strokeWidth="2.5" />
      <line x1="60" y1="210" x2="78" y2="220" stroke="#6b7280" strokeWidth="2.5" />
      <line x1="60" y1="210" x2="52" y2="222" stroke="#6b7280" strokeWidth="2.5" />
      <line x1="60" y1="210" x2="68" y2="222" stroke="#6b7280" strokeWidth="2.5" />
      {/* Wheels */}
      <circle cx="42" cy="221" r="2" fill="#4b5563" />
      <circle cx="78" cy="221" r="2" fill="#4b5563" />
      <circle cx="52" cy="223" r="2" fill="#4b5563" />
      <circle cx="68" cy="223" r="2" fill="#4b5563" />

      {/* Monitor: static */}
      <rect x="115" y="110" width="50" height="40" rx="3" fill="#1f2937" stroke="#6b7280" strokeWidth="2" />
      {/* Monitor stand */}
      <rect x="135" y="150" width="10" height="10" fill="#4b5563" />

      {/* Code lines on monitor: winner types fast, loser types slow */}
      {phase === 'typing' && (
        <g>
          <motion.rect
            x="121" y="118" height="3" rx="1" fill="#4ade80"
            initial={{ width: 0 }}
            animate={{ width: 20 }}
            transition={{ duration: isWinner ? 0.6 : 1.4, delay: 0 }}
          />
          <motion.rect
            x="121" y="124" height="3" rx="1" fill="#60a5fa"
            initial={{ width: 0 }}
            animate={{ width: 30 }}
            transition={{ duration: isWinner ? 0.6 : 1.4, delay: isWinner ? 0.4 : 0.8 }}
          />
          <motion.rect
            x="121" y="130" height="3" rx="1" fill="#c084fc"
            initial={{ width: 0 }}
            animate={{ width: 15 }}
            transition={{ duration: isWinner ? 0.6 : 1.4, delay: isWinner ? 0.8 : 1.6 }}
          />
          <motion.rect
            x="121" y="136" height="3" rx="1" fill="#4ade80"
            initial={{ width: 0 }}
            animate={{ width: 25 }}
            transition={{ duration: isWinner ? 0.6 : 1.4, delay: isWinner ? 1.2 : 2.4 }}
          />
          <motion.rect
            x="121" y="142" height="3" rx="1" fill="#fbbf24"
            initial={{ width: 0 }}
            animate={{ width: 18 }}
            transition={{ duration: isWinner ? 0.6 : 1.4, delay: isWinner ? 1.6 : 3.2 }}
          />
        </g>
      )}

      {/* Result indicators on monitor: wrapped in counter-flip group for right stickman */}
      <g transform={flip ? 'translate(280, 0) scale(-1, 1)' : undefined}>
        {phase === 'result' && isWinner && (
          <motion.text
            x="140" y="137" textAnchor="middle" fill="#4ade80" fontSize="14" fontWeight="bold"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
          >
            WIN
          </motion.text>
        )}
        {phase === 'result' && !isWinner && (
          <motion.text
            x="140" y="133" textAnchor="middle" fill="#f87171" fontSize="12" fontWeight="bold"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            FAIL
          </motion.text>
        )}
      </g>

      {/* ELO change badge: floats above stickman head */}
      <g transform={flip ? 'translate(200, 0) scale(-1, 1)' : undefined}>
        {phase === 'result' && isWinner && (
          <motion.g
            initial={{ opacity: 0, y: 75 }}
            animate={{ opacity: 1, y: 50 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            {/* Glow */}
            <rect x="22" y="-10" width="76" height="26" rx="13" fill="#4ade80" opacity="0.15" />
            {/* Badge background */}
            <rect x="25" y="-7" width="70" height="20" rx="10" fill="#052e16" stroke="#4ade80" strokeWidth="1.5" />
            {/* Arrow up */}
            <polygon points="32,6 36,0 40,6" fill="#4ade80" />
            {/* Text */}
            <text x="63" y="7" textAnchor="middle" fill="#4ade80" fontSize="10" fontWeight="bold" fontFamily="monospace">
              +10 ELO
            </text>
          </motion.g>
        )}
        {phase === 'result' && !isWinner && (
          <motion.g
            initial={{ opacity: 0, y: 75 }}
            animate={{ opacity: 1, y: 50 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            {/* Glow */}
            <rect x="25" y="-10" width="70" height="26" rx="13" fill="#f87171" opacity="0.15" />
            {/* Badge background */}
            <rect x="28" y="-7" width="64" height="20" rx="10" fill="#300a0a" stroke="#f87171" strokeWidth="1.5" />
            {/* Arrow down */}
            <polygon points="38,0 42,6 46,0" fill="#f87171" />
            {/* Text */}
            <text x="63" y="7" textAnchor="middle" fill="#f87171" fontSize="10" fontWeight="bold" fontFamily="monospace">
              -5 ELO
            </text>
          </motion.g>
        )}
      </g>

      {/* Stickman body + arms group: moves together on win/lose */}
      <motion.g {...getBodyProps()}>
        {/* Head */}
        <circle cx="60" cy="100" r="16" fill="none" stroke={bodyColor} strokeWidth="3" />
        {/* Eyes */}
        {phase === 'result' && !isWinner ? (
          <>
            {/* Angry eyebrows */}
            <line x1="50" y1="90" x2="58" y2="93" stroke={bodyColor} strokeWidth="2.5" strokeLinecap="round" />
            <line x1="70" y1="90" x2="62" y2="93" stroke={bodyColor} strokeWidth="2.5" strokeLinecap="round" />
            {/* X eyes */}
            <line x1="54" y1="97" x2="58" y2="101" stroke={bodyColor} strokeWidth="2" />
            <line x1="58" y1="97" x2="54" y2="101" stroke={bodyColor} strokeWidth="2" />
            <line x1="62" y1="97" x2="66" y2="101" stroke={bodyColor} strokeWidth="2" />
            <line x1="66" y1="97" x2="62" y2="101" stroke={bodyColor} strokeWidth="2" />
          </>
        ) : (
          <>
            <circle cx="54" cy="98" r="2.5" fill={bodyColor} />
            <circle cx="66" cy="98" r="2.5" fill={bodyColor} />
          </>
        )}
        {/* Smile/frown */}
        {phase === 'result' && isWinner && (
          <path d="M 52 106 Q 60 114 68 106" fill="none" stroke={bodyColor} strokeWidth="2.5" />
        )}
        {phase === 'result' && !isWinner && (
          <path d="M 50 112 Q 60 102 70 112" fill="none" stroke={bodyColor} strokeWidth="3" />
        )}
        {phase === 'typing' && (
          <line x1="54" y1="107" x2="66" y2="107" stroke={bodyColor} strokeWidth="2" />
        )}

        {/* Body */}
        <line x1="60" y1="116" x2="60" y2="170" stroke={bodyColor} strokeWidth="3" />

        {/* Legs (seated) */}
        <line x1="60" y1="170" x2="45" y2="210" stroke={bodyColor} strokeWidth="3" />
        <line x1="60" y1="170" x2="75" y2="210" stroke={bodyColor} strokeWidth="3" />

        {/* Arms: inside body group so they move with torso */}
        {phase === 'result' && isWinner ? (
          <g>
            {/* Victory arms raised */}
            <line x1="60" y1="130" x2="35" y2="95" stroke={bodyColor} strokeWidth="3" />
            <line x1="60" y1="130" x2="85" y2="95" stroke={bodyColor} strokeWidth="3" />
          </g>
        ) : phase === 'result' && !isWinner ? (
          <>
            {/* Left arm: slams down then lifts up */}
            <motion.line
              x1="60" y1="130" x2="100" stroke={bodyColor} strokeWidth="3"
              animate={{ y2: [145, 158, 145, 158] }}
              transition={{ duration: 0.4, repeat: Infinity, ease: 'easeInOut' }}
            />
            {/* Right arm: same motion, offset by half cycle */}
            <motion.line
              x1="60" y1="135" x2="105" stroke={bodyColor} strokeWidth="3"
              animate={{ y2: [158, 145, 158, 145] }}
              transition={{ duration: 0.4, repeat: Infinity, ease: 'easeInOut' }}
            />
          </>
        ) : (
          <motion.g {...getArmProps()}>
            {/* Arms reaching to keyboard area */}
            <line x1="60" y1="130" x2="100" y2="155" stroke={bodyColor} strokeWidth="3" />
            <line x1="60" y1="135" x2="105" y2="155" stroke={bodyColor} strokeWidth="3" />
          </motion.g>
        )}
      </motion.g>


    </svg>
  );
};

const CodingBattleAnimation = () => {
  const [phase, setPhase] = useState('hidden'); // 'hidden' | 'typing' | 'result'
  const [winner, setWinner] = useState('left'); // 'left' | 'right'
  const timeoutsRef = useRef([]);

  const clearAllTimeouts = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  };

  const addTimeout = (fn, delay) => {
    const id = setTimeout(fn, delay);
    timeoutsRef.current.push(id);
    return id;
  };

  useEffect(() => {
    const runCycle = () => {
      clearAllTimeouts();

      // Pick winner upfront so typing speed can differ
      setWinner(Math.random() > 0.5 ? 'left' : 'right');
      setPhase('typing');

      // After winner finishes typing, show result (winner's last line: 1.6s delay + 0.6s duration = 2.2s, plus small buffer)
      addTimeout(() => {
        setPhase('result');
      }, 2500);

      // Hold result, then hide
      addTimeout(() => {
        setPhase('hidden');
      }, 5000);

      // Restart cycle
      addTimeout(() => {
        runCycle();
      }, 6500);
    };

    // Start first cycle after a short delay
    const startId = setTimeout(runCycle, 1500);
    timeoutsRef.current.push(startId);

    return () => {
      clearAllTimeouts();
    };
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden hidden xl:block" aria-hidden="true">
      {/* Left stickman */}
      <AnimatePresence>
        {phase !== 'hidden' && (
          <motion.div
            key="left-stickman"
            className="absolute left-4 2xl:left-12 top-1/2 -translate-y-1/2 w-64 2xl:w-72 h-96 2xl:h-[28rem]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.7 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Stickman facing="right" phase={phase} isWinner={winner === 'left'} />
          </motion.div>
        )}
      </AnimatePresence>


      {/* Lightning bolts connecting the two stickmen: only during typing */}
      <AnimatePresence>
        {phase === 'typing' && (
          <motion.div
            key="lightning"
            className="absolute top-1/2 left-48 right-48 2xl:left-64 2xl:right-64 -translate-y-1/2 h-32"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.35 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <svg viewBox="0 0 400 100" className="w-full h-full" preserveAspectRatio="none">
              {/* Main lightning bolt */}
              <motion.polyline
                points="0,50 40,30 70,55 110,20 150,50 180,35 220,55 260,25 300,50 340,40 400,50"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: [0, 1, 1, 0], opacity: [0, 1, 1, 0] }}
                transition={{ duration: 0.7, repeat: Infinity, ease: 'easeInOut' }}
              />
              {/* Second bolt: offset timing, different path */}
              <motion.polyline
                points="0,55 50,65 90,40 130,70 170,45 210,60 250,35 290,65 330,45 370,55 400,50"
                fill="none"
                stroke="#a78bfa"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: [0, 1, 1, 0], opacity: [0, 0.8, 0.8, 0] }}
                transition={{ duration: 0.6, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
              />
              {/* Spark particles along the path */}
              <motion.circle
                cx="200" cy="45" r="3" fill="#38bdf8"
                animate={{ opacity: [0, 1, 0], scale: [0.5, 1.5, 0.5], cx: [100, 200, 300] }}
                transition={{ duration: 0.4, repeat: Infinity, ease: 'easeInOut' }}
              />
              <motion.circle
                cx="150" cy="55" r="2" fill="#a78bfa"
                animate={{ opacity: [0, 1, 0], scale: [0.5, 1.2, 0.5], cx: [300, 200, 100] }}
                transition={{ duration: 0.4, repeat: Infinity, ease: 'easeInOut', delay: 0.15 }}
              />
            </svg>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Right stickman */}
      <AnimatePresence>
        {phase !== 'hidden' && (
          <motion.div
            key="right-stickman"
            className="absolute right-4 2xl:right-12 top-1/2 -translate-y-1/2 w-64 2xl:w-72 h-96 2xl:h-[28rem]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.7 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Stickman facing="left" phase={phase} isWinner={winner === 'right'} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CodingBattleAnimation;
