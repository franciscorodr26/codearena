import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

// Toast types with their styles
const toastConfig = {
  success: {
    icon: CheckCircle,
    className: 'bg-success/10 border-success/30 text-success',
    iconClass: 'text-success'
  },
  error: {
    icon: XCircle,
    className: 'bg-danger/10 border-danger/30 text-danger',
    iconClass: 'text-danger'
  },
  warning: {
    icon: AlertCircle,
    className: 'bg-warning/10 border-warning/30 text-warning',
    iconClass: 'text-warning'
  },
  info: {
    icon: Info,
    className: 'bg-primary-500/10 border-primary-500/30 text-primary-400',
    iconClass: 'text-primary-400'
  }
};

let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++toastId;

    setToasts(prev => [...prev, { id, message, type }]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }

    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useMemo(() => ({
    success: (message, duration) => addToast(message, 'success', duration),
    error: (message, duration) => addToast(message, 'error', duration),
    warning: (message, duration) => addToast(message, 'warning', duration),
    info: (message, duration) => addToast(message, 'info', duration),
    dismiss: removeToast
  }), [addToast, removeToast]);

  return (
    <ToastContext.Provider value={toast}>
      {children}

      {/* Toast Container */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {toasts.map(({ id, message, type }) => {
            const config = toastConfig[type] || toastConfig.info;
            const Icon = config.icon;

            return (
              <motion.div
                key={id}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 100, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg border backdrop-blur-sm shadow-lg max-w-sm ${config.className}`}
              >
                <Icon className={`h-5 w-5 flex-shrink-0 ${config.iconClass}`} />
                <span className="text-sm text-white flex-1">{message}</span>
                <button
                  onClick={() => removeToast(id)}
                  className="flex-shrink-0 text-surface-400 hover:text-white transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export default ToastContext;
