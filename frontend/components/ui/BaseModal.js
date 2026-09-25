import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

/**
 * BaseModal - Shared modal wrapper providing consistent backdrop, animation,
 * close button, and styling across all modal components.
 *
 * Props:
 *   isOpen         - Whether the modal is visible
 *   onClose        - Called when backdrop is clicked, close button pressed, or Escape key hit
 *   title          - Optional title displayed in header (not rendered if omitted)
 *   children       - Modal body content
 *   maxWidth       - Tailwind max-width class (default: 'max-w-lg')
 *   showCloseButton - Whether to show the X button in top-right (default: true)
 *   className      - Additional classes for the content container
 */
export default function BaseModal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
  showCloseButton = true,
  className = '',
}) {
  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className={`relative bg-surface-900 border border-surface-700 rounded-2xl ${maxWidth} w-full max-h-[calc(100dvh-2rem)] overflow-y-auto ${className}`}
            onClick={(e) => e.stopPropagation()}
          >
            {showCloseButton && !title && (
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 text-surface-400 hover:text-white hover:bg-surface-800 rounded-lg transition-colors z-10"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
