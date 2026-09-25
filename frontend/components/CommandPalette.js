import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import { Search } from 'lucide-react';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { useAuth } from '../contexts/AuthContext';
import { getModifierKey } from '../utils/platform';
import { NAV_COMMANDS, resolveCommandPath } from '../lib/navCommands';

/**
 * CommandPalette - Cmd+K spotlight search for quick navigation
 */
const CommandPalette = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();

  // Navigation commands (single source of truth in lib/navCommands)
  const commands = NAV_COMMANDS;

  // Filter commands based on query and auth status
  const filteredCommands = commands.filter(cmd => {
    if (cmd.requiresAuth && !isAuthenticated) return false;
    if (!query) return true;

    const q = query.toLowerCase();
    return cmd.label.toLowerCase().includes(q) ||
           cmd.keywords.some(k => k.includes(q));
  });

  // Keyboard shortcut to open
  useKeyboardShortcut('k', () => setIsOpen(true), { meta: true });

  // Close on escape
  useKeyboardShortcut('Escape', () => setIsOpen(false), { enabled: isOpen });

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filteredCommands.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          router.push(resolveCommandPath(filteredCommands[selectedIndex], user));
          setIsOpen(false);
        }
        break;
    }
  }, [isOpen, filteredCommands, selectedIndex, router]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = (cmd) => {
    router.push(resolveCommandPath(cmd, user));
    setIsOpen(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200]"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg z-[201]"
          >
            <div className="mx-4 bg-surface-900 border border-surface-700 rounded-xl shadow-2xl overflow-hidden">
              {/* Search Input */}
              <div className="flex items-center px-4 border-b border-surface-700">
                <Search className="h-5 w-5 text-surface-400" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search or jump to..."
                  className="flex-1 bg-transparent px-3 py-4 text-white placeholder-surface-500 outline-none"
                />
                <kbd className="hidden sm:flex items-center gap-1 px-2 py-1 text-xs text-surface-500 bg-surface-800 rounded">
                  esc
                </kbd>
              </div>

              {/* Results */}
              <div className="max-h-80 overflow-y-auto py-2">
                {filteredCommands.length === 0 ? (
                  <div className="px-4 py-8 text-center text-surface-500">
                    No results found
                  </div>
                ) : (
                  filteredCommands.map((cmd, index) => {
                    const Icon = cmd.icon;
                    const isSelected = index === selectedIndex;

                    return (
                      <button
                        key={cmd.id}
                        onClick={() => handleSelect(cmd)}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                          isSelected
                            ? 'bg-primary-500/20 text-white'
                            : 'text-surface-300 hover:bg-surface-800'
                        }`}
                      >
                        <Icon className={`h-5 w-5 ${isSelected ? 'text-primary-400' : 'text-surface-500'}`} />
                        <span className="flex-1">{cmd.label}</span>
                        {isSelected && (
                          <kbd className="text-xs text-surface-500">↵</kbd>
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Footer */}
              <div className="px-4 py-2 border-t border-surface-700 flex items-center justify-between text-xs text-surface-500">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 bg-surface-800 rounded">↑↓</kbd> navigate
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 bg-surface-800 rounded">↵</kbd> select
                  </span>
                </div>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-surface-800 rounded">{getModifierKey()}</kbd>
                  <kbd className="px-1.5 py-0.5 bg-surface-800 rounded">K</kbd> to open
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default CommandPalette;
