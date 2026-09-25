import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';

export default function ToggleRow({
  icon: Icon,
  iconColor = 'text-primary-400',
  iconBg = 'bg-primary-500/20',
  title,
  description,
  badge,
  checked,
  onChange,
  disabled = false,
  showSavedFeedback = true
}) {
  const [justSaved, setJustSaved] = useState(false);

  const handleChange = (newValue) => {
    if (disabled) return;
    onChange(newValue);

    if (showSavedFeedback) {
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-center justify-between p-4 bg-surface-800/50 rounded-xl border transition-all duration-200 ${
        disabled
          ? 'border-surface-700/50 opacity-60'
          : checked
            ? 'border-surface-600 hover:border-surface-500'
            : 'border-surface-700 hover:border-surface-600'
      }`}
    >
      <div className="flex items-start space-x-3 flex-1 min-w-0">
        <motion.div
          whileHover={!disabled ? { scale: 1.05 } : {}}
          className={`p-2 ${iconBg} rounded-lg flex-shrink-0 transition-colors`}
        >
          <Icon className={`h-5 w-5 ${iconColor}`} />
        </motion.div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-white flex items-center gap-2 flex-wrap">
            <span className="truncate">{title}</span>
            {badge && (
              <span className="text-[10px] font-bold text-secondary-400 bg-secondary-500/20 px-1.5 py-0.5 rounded flex-shrink-0">
                {badge}
              </span>
            )}
            <AnimatePresence>
              {justSaved && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.8, x: -10 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="text-xs text-success flex items-center gap-1 flex-shrink-0"
                >
                  <Check className="h-3 w-3" />
                  Saved
                </motion.span>
              )}
            </AnimatePresence>
          </h3>
          <p className="text-sm text-surface-400 mt-0.5 line-clamp-2">{description}</p>
        </div>
      </div>

      {/* Toggle Switch */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => handleChange(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-surface-900 ml-4 ${
          checked ? 'bg-primary-500' : 'bg-surface-600'
        } ${disabled ? 'cursor-not-allowed' : ''}`}
      >
        <span className="sr-only">Toggle {title}</span>
        <motion.span
          initial={false}
          animate={{
            x: checked ? 20 : 0,
            scale: checked ? 1 : 0.95
          }}
          transition={{
            type: 'spring',
            stiffness: 500,
            damping: 30
          }}
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full shadow ring-0 transition-shadow ${
            checked ? 'bg-white shadow-lg' : 'bg-surface-300'
          }`}
        />
      </button>
    </motion.div>
  );
}
