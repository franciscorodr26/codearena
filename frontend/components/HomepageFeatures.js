import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, ChevronRight } from 'lucide-react';

// Bento Box Feature Components
const BentoCard = ({
  children,
  className = '',
  delay = 0,
  onToggle = null
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      viewport={{ once: true }}
      onClick={onToggle}
      className={`relative rounded-2xl border border-surface-700/50 bg-surface-900 backdrop-blur-sm cursor-pointer transition-all overflow-hidden ${className}`}
    >
      {children}
    </motion.div>
  );
};

// Feature Detail Modal
const FeatureModal = ({ isOpen, onClose, feature, router }) => {
  if (!isOpen || !feature) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(4px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#1a1a2e',
          border: '1px solid #2d2d44',
          borderRadius: '16px',
          padding: '24px',
          maxWidth: '400px',
          width: '100%',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h3 style={{ color: 'white', fontSize: '20px', fontWeight: '700', margin: 0 }}>{feature.title}</h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            <X style={{ width: '20px', height: '20px' }} />
          </button>
        </div>

        {/* Content */}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, marginBottom: '20px' }}>
          {feature.items.map((item, i) => (
            <li
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                marginBottom: i < feature.items.length - 1 ? '14px' : '0',
              }}
            >
              <span style={{ color: '#818cf8', fontSize: '18px', lineHeight: '1.4' }}>✓</span>
              <span style={{ color: '#e2e8f0', fontSize: '15px', lineHeight: '1.5' }}>{item}</span>
            </li>
          ))}
        </ul>

        {/* CTA Button */}
        <button
          type="button"
          onClick={() => {
            onClose();
            router.push(feature.href);
          }}
          style={{
            width: '100%',
            padding: '12px 20px',
            background: 'linear-gradient(to right, #6366f1, #4f46e5)',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            fontSize: '15px',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          {feature.cta}
          <ChevronRight style={{ width: '18px', height: '18px' }} />
        </button>
      </motion.div>
    </motion.div>
  );
};

// Terminal lines for MiniTerminal animation
const TERMINAL_LINES = [
  { text: '$ running tests...', color: 'text-surface-400' },
  { text: '✓ Test 1 passed', color: 'text-success' },
  { text: '✓ Test 2 passed', color: 'text-success' },
  { text: '✓ All tests passed!', color: 'text-success font-bold' },
];

// Mini terminal animation for the "Real Execution" card
// Uses fixed height to prevent layout shifts on mobile
const MiniTerminal = () => {
  const [line, setLine] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setLine(prev => (prev + 1) % (TERMINAL_LINES.length + 2));
    }, 800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="font-mono text-xs h-[72px] overflow-hidden">
      <div className="space-y-1">
        {TERMINAL_LINES.slice(0, Math.min(line, TERMINAL_LINES.length)).map((l, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className={l.color}
          >
            {l.text}
          </motion.div>
        ))}
        {line < TERMINAL_LINES.length && (
          <span className="inline-block w-2 h-4 bg-primary-400 animate-pulse" />
        )}
      </div>
    </div>
  );
};

// Language pills for the languages card
const LanguagePill = ({ icon, name, color }) => (
  <div
    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${color} text-xs font-medium transition-colors hover:border-primary-500/50 hover:shadow-lg`}
  >
    <span>{icon}</span>
    <span>{name}</span>
  </div>
);

// Step card component
const StepCard = ({ number, title, description }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.9 }}
    whileInView={{ opacity: 1, scale: 1 }}
    transition={{ duration: 0.5, delay: number * 0.1 }}
    viewport={{ once: true }}
    className="text-center"
  >
    <motion.div
      className="bg-primary-500 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl font-bold shadow-lg shadow-primary-500/30 text-white"
      whileHover={{ scale: 1.1 }}
      transition={{ duration: 0.3 }}
    >
      {number}
    </motion.div>
    <h3 className="text-xl font-bold mb-3 text-white">{title}</h3>
    <p className="text-surface-400">{description}</p>
  </motion.div>
);

// Billing Toggle Component
const BillingToggle = ({ billingCycle, setBillingCycle }) => (
  <div className="relative inline-flex items-center p-1 rounded-full bg-surface-800/80 border border-surface-700">
    {/* Sliding background indicator */}
    <motion.div
      className="absolute top-1 bottom-1 rounded-full bg-surface-700"
      initial={false}
      animate={{
        left: billingCycle === 'monthly' ? '4px' : '50%',
        width: billingCycle === 'monthly' ? 'calc(50% - 4px)' : 'calc(50% - 4px)',
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    />
    <button
      onClick={() => setBillingCycle('monthly')}
      className={`relative z-10 px-5 py-2 rounded-full text-sm font-medium transition-colors duration-200 ${
        billingCycle === 'monthly' ? 'text-white' : 'text-surface-400 hover:text-surface-300'
      }`}
    >
      Monthly
    </button>
    <button
      onClick={() => setBillingCycle('annual')}
      className={`relative z-10 px-5 py-2 rounded-full text-sm font-medium transition-colors duration-200 flex items-center gap-2 ${
        billingCycle === 'annual' ? 'text-white' : 'text-surface-400 hover:text-surface-300'
      }`}
    >
      Annual
      <span className="text-[10px] font-semibold text-success bg-success/15 px-1.5 py-0.5 rounded-full">
        -17%
      </span>
    </button>
  </div>
);

export { BentoCard, FeatureModal, MiniTerminal, LanguagePill, StepCard, BillingToggle };
