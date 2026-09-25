import { useState, useCallback } from 'react';
import { useToast } from '../contexts/ToastContext';

/**
 * useClipboard - Copy to clipboard with toast feedback
 *
 * @param {number} resetDelay - Time in ms before resetting copied state (default: 2000)
 * @returns {Object} { copy, copied, supported }
 *
 * @example
 * const { copy, copied } = useClipboard();
 * <button onClick={() => copy(text, 'Link copied!')}>
 *   {copied ? 'Copied!' : 'Copy'}
 * </button>
 */
export function useClipboard(resetDelay = 2000) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  const supported = typeof navigator !== 'undefined' &&
                    navigator.clipboard &&
                    window.isSecureContext;

  const copy = useCallback(async (text, successMessage = 'Copied to clipboard!') => {
    if (!supported) {
      toast.error('Clipboard not supported in this browser');
      return false;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(successMessage);

      setTimeout(() => setCopied(false), resetDelay);
      return true;
    } catch (err) {
      toast.error('Failed to copy');
      return false;
    }
  }, [supported, toast, resetDelay]);

  return { copy, copied, supported };
}

export default useClipboard;
