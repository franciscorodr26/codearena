/**
 * Platform detection and keyboard shortcut utilities
 * Provides platform-aware keyboard shortcut display
 */

/**
 * Detect if the current platform is macOS
 * Works on both client and server (returns false on server)
 */
export const isMac = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  return navigator.platform?.toLowerCase().includes('mac') ||
         navigator.userAgent?.toLowerCase().includes('mac');
};

/**
 * Get the platform-appropriate modifier key symbol/text
 * @param {boolean} useSymbol - Whether to use symbols (true) or text (false)
 * @returns {string} The modifier key representation
 */
export const getModifierKey = (useSymbol = true) => {
  if (isMac()) {
    return useSymbol ? '\u2318' : 'Cmd';
  }
  return useSymbol ? 'Ctrl' : 'Ctrl';
};

/**
 * Get platform-appropriate keyboard shortcut display
 * @param {string} key - The key (e.g., 'K', 'Enter', 'S')
 * @param {Object} options - Options for display
 * @param {boolean} options.useSymbol - Use symbols instead of text (default: true)
 * @param {boolean} options.includeModifier - Include Cmd/Ctrl modifier (default: true)
 * @returns {string} The formatted shortcut string
 */
export const getShortcut = (key, options = {}) => {
  const { useSymbol = true, includeModifier = true } = options;

  const modifier = includeModifier ? getModifierKey(useSymbol) : '';

  // Map special keys to symbols/display names
  const keyMap = {
    'enter': useSymbol ? '\u21B5' : 'Enter',
    'return': useSymbol ? '\u21B5' : 'Enter',
    'escape': 'Esc',
    'esc': 'Esc',
    'shift': useSymbol ? '\u21E7' : 'Shift',
    'alt': isMac() ? (useSymbol ? '\u2325' : 'Option') : 'Alt',
    'option': useSymbol ? '\u2325' : 'Option',
    'tab': useSymbol ? '\u21E5' : 'Tab',
    'backspace': useSymbol ? '\u232B' : 'Backspace',
    'delete': useSymbol ? '\u2326' : 'Delete',
    'space': 'Space',
    'arrowup': '\u2191',
    'arrowdown': '\u2193',
    'arrowleft': '\u2190',
    'arrowright': '\u2192',
  };

  const displayKey = keyMap[key.toLowerCase()] || key.toUpperCase();

  if (includeModifier) {
    return `${modifier}${displayKey}`;
  }
  return displayKey;
};

/**
 * React hook for platform detection (use in components)
 * Properly handles SSR hydration to avoid mismatches
 * @returns {Object} Platform info with isMac, modifier symbol, and text
 */
export const usePlatform = () => {
  // Import React hooks inline to avoid issues with non-React contexts
  const { useState, useEffect } = require('react');

  // Start with null to indicate "not yet determined" during SSR
  // This prevents hydration mismatches
  const [platform, setPlatform] = useState(null);

  useEffect(() => {
    const mac = isMac();
    setPlatform({
      isMac: mac,
      modifier: mac ? '\u2318' : 'Ctrl',
      modifierText: mac ? 'Cmd' : 'Ctrl',
    });
  }, []);

  // Return default values during SSR and initial render
  // Component should handle null/undefined gracefully or use getShortcut directly
  return platform || {
    isMac: false,
    modifier: 'Ctrl',
    modifierText: 'Ctrl',
  };
};

export default {
  isMac,
  getModifierKey,
  getShortcut,
  usePlatform,
};
