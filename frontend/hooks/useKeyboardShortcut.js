import { useEffect, useCallback } from 'react';

/**
 * useKeyboardShortcut - Register keyboard shortcuts
 *
 * @param {string} key - Key to listen for (e.g., 'k', 'Escape', 'Enter')
 * @param {Function} callback - Function to call when shortcut is triggered
 * @param {Object} options - { ctrl, meta, shift, alt, enabled }
 *
 * @example
 * // Cmd/Ctrl + K to open search
 * useKeyboardShortcut('k', openSearch, { meta: true });
 *
 * // Escape to close modal
 * useKeyboardShortcut('Escape', closeModal, { enabled: isOpen });
 */
export function useKeyboardShortcut(key, callback, options = {}) {
  const {
    ctrl = false,
    meta = false,
    shift = false,
    alt = false,
    enabled = true
  } = options;

  const handleKeyDown = useCallback((event) => {
    // Don't trigger if user is typing in an input/textarea
    const target = event.target;
    const isTyping = target.tagName === 'INPUT' ||
                     target.tagName === 'TEXTAREA' ||
                     target.isContentEditable;

    // Allow Escape even when typing
    if (isTyping && key !== 'Escape') return;

    // Check if the key matches
    const keyMatches = event.key.toLowerCase() === key.toLowerCase() ||
                       event.code.toLowerCase() === `key${key.toLowerCase()}`;

    if (!keyMatches) return;

    // Check modifier keys
    const ctrlMatch = ctrl ? (event.ctrlKey || event.metaKey) : !event.ctrlKey;
    const metaMatch = meta ? (event.metaKey || event.ctrlKey) : true; // Allow both for cross-platform
    const shiftMatch = shift ? event.shiftKey : !event.shiftKey;
    const altMatch = alt ? event.altKey : !event.altKey;

    // For meta shortcuts, we want either Cmd (Mac) or Ctrl (Windows/Linux)
    const modifiersMatch = meta
      ? (event.metaKey || event.ctrlKey) && shiftMatch && altMatch
      : ctrlMatch && shiftMatch && altMatch;

    if (modifiersMatch) {
      event.preventDefault();
      callback(event);
    }
  }, [key, callback, ctrl, meta, shift, alt]);

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, enabled]);
}

export default useKeyboardShortcut;
