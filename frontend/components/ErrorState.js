/**
 * ErrorState Component
 *
 * Displays error states with retry functionality and helpful messages.
 */

import { motion } from 'framer-motion';
import { AlertTriangle, WifiOff, RefreshCw, Lock, ServerCrash } from 'lucide-react';
import Button from './ui/Button';
import { ErrorType, getErrorMessage } from '../utils/errorHandling';

const errorIcons = {
  [ErrorType.NETWORK]: WifiOff,
  [ErrorType.AUTH]: Lock,
  [ErrorType.SERVER]: ServerCrash,
  default: AlertTriangle
};

const errorTitles = {
  [ErrorType.NETWORK]: 'Connection Problem',
  [ErrorType.AUTH]: 'Session Expired',
  [ErrorType.SERVER]: 'Server Error',
  [ErrorType.NOT_FOUND]: 'Not Found',
  [ErrorType.RATE_LIMIT]: 'Slow Down',
  default: 'Something went wrong'
};

export default function ErrorState({
  error = null,
  errorType = ErrorType.UNKNOWN,
  title = null,
  message = null,
  onRetry = null,
  retrying = false,
  className = '',
  size = 'md', // 'sm' | 'md' | 'lg'
  showIcon = true,
  fullScreen = false
}) {
  // Determine the error type from the error object if provided
  const type = error?.errorType || errorType;

  // Get icon component
  const IconComponent = errorIcons[type] || errorIcons.default;

  // Get title and message
  const displayTitle = title || errorTitles[type] || errorTitles.default;
  const displayMessage = message || (error ? getErrorMessage(error) : 'An unexpected error occurred.');

  // Size classes
  const sizeClasses = {
    sm: {
      container: 'py-6 px-4',
      icon: 'w-8 h-8',
      title: 'text-base',
      message: 'text-sm',
      button: 'sm'
    },
    md: {
      container: 'py-12 px-6',
      icon: 'w-12 h-12',
      title: 'text-lg',
      message: 'text-sm',
      button: 'md'
    },
    lg: {
      container: 'py-16 px-8',
      icon: 'w-16 h-16',
      title: 'text-xl',
      message: 'text-base',
      button: 'lg'
    }
  };

  const sizes = sizeClasses[size] || sizeClasses.md;

  const content = (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col items-center justify-center text-center ${sizes.container} ${className}`}
    >
      {showIcon && (
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          className={`${sizes.icon} text-danger-light mb-4`}
        >
          <IconComponent className="w-full h-full" />
        </motion.div>
      )}

      <h3 className={`font-semibold text-white mb-2 ${sizes.title}`}>
        {displayTitle}
      </h3>

      <p className={`text-surface-400 mb-6 max-w-md ${sizes.message}`}>
        {displayMessage}
      </p>

      {onRetry && (
        <Button
          variant="secondary"
          size={sizes.button}
          onClick={onRetry}
          disabled={retrying}
          icon={RefreshCw}
          iconPosition="left"
        >
          {retrying ? 'Retrying...' : 'Try Again'}
        </Button>
      )}

      {type === ErrorType.AUTH && (
        <Button
          variant="primary"
          size={sizes.button}
          onClick={() => window.location.href = '/login'}
          className="mt-2"
        >
          Log In
        </Button>
      )}
    </motion.div>
  );

  if (fullScreen) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center">
        {content}
      </div>
    );
  }

  return content;
}

/**
 * Inline error message for form fields
 */
export function InlineError({ message, className = '' }) {
  if (!message) return null;

  return (
    <motion.p
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className={`text-sm text-danger-light mt-1 ${className}`}
    >
      {message}
    </motion.p>
  );
}

/**
 * Toast-style error notification
 */
export function ErrorToast({ message, onDismiss, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className={`bg-danger/90 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 ${className}`}
    >
      <AlertTriangle className="w-5 h-5 flex-shrink-0" />
      <span className="text-sm">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="ml-auto text-white/70 hover:text-white"
        >
          &times;
        </button>
      )}
    </motion.div>
  );
}
