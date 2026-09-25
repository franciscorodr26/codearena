import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User,
  Lock,
  Mail,
  Bell,
  Shield,
  Code2,
  Download,
  Crown,
  HelpCircle,
  Trash2,
  Search,
  X,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { usePlatform } from '../../utils/platform';

const sections = [
  { id: 'profile', label: 'Profile', icon: User, color: 'text-primary-400', keywords: ['avatar', 'username', 'bio', 'picture'] },
  { id: 'security', label: 'Security', icon: Lock, color: 'text-warning', keywords: ['password', 'change password', 'authentication', '2fa'] },
  { id: 'email', label: 'Email', icon: Mail, color: 'text-primary-400', keywords: ['email address', 'change email', 'verify'] },
  { id: 'notifications', label: 'Notifications', icon: Bell, color: 'text-secondary-400', keywords: ['alerts', 'push', 'weekly', 'tournament', 'digest'] },
  { id: 'privacy', label: 'Privacy', icon: Shield, color: 'text-primary-400', keywords: ['read receipts', 'visibility', 'data'] },
  { id: 'editor', label: 'Editor', icon: Code2, color: 'text-secondary-400', keywords: ['vim', 'keybindings', 'code', 'theme'] },
  { id: 'subscription', label: 'Subscription', icon: Crown, color: 'text-warning', keywords: ['pro', 'plan', 'upgrade', 'billing', 'payment'] },
  { id: 'data', label: 'Data Export', icon: Download, color: 'text-surface-400', keywords: ['export', 'download', 'gdpr', 'backup'] },
  { id: 'help', label: 'Help', icon: HelpCircle, color: 'text-primary-400', keywords: ['support', 'tour', 'tutorial', 'guide'] },
  { id: 'danger', label: 'Delete Account', icon: Trash2, color: 'text-danger', keywords: ['delete', 'remove', 'close account'] }
];

export default function SettingsSidebar({
  activeSection,
  onSectionChange,
  onSearch,
  searchQuery = ''
}) {
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef(null);
  // SSR-safe: returns "Ctrl" on first render (matching server), updates to "⌘"
  // on Mac after the post-mount effect. Calling getModifierKey() directly in
  // render would cause a hydration mismatch because navigator is unavailable
  // server-side. (iPhone userAgent also contains "Mac OS X": same problem.)
  const { modifier } = usePlatform();

  // Filter sections based on search
  const filteredSections = localSearch
    ? sections.filter(section =>
        section.label.toLowerCase().includes(localSearch.toLowerCase()) ||
        section.keywords.some(k => k.toLowerCase().includes(localSearch.toLowerCase()))
      )
    : sections;

  // Handle search input
  const handleSearchChange = (value) => {
    setLocalSearch(value);
    if (onSearch) onSearch(value);
  };

  // Keyboard shortcut to focus search (Cmd/Ctrl + K)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape' && isSearchFocused) {
        setLocalSearch('');
        searchInputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchFocused]);

  // Get current section index for keyboard nav hints
  const currentIndex = sections.findIndex(s => s.id === activeSection);
  const canGoUp = currentIndex > 0;
  const canGoDown = currentIndex < sections.length - 1;

  return (
    <nav className="w-56 flex-shrink-0">
      <div className="sticky top-24 space-y-3">
        {/* Search Input */}
        <div className="relative">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 transition-colors ${
            isSearchFocused ? 'text-primary-400' : 'text-surface-500'
          }`} />
          <input
            ref={searchInputRef}
            type="text"
            value={localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            placeholder="Search settings..."
            className="w-full pl-9 pr-16 py-2 bg-surface-800/50 border border-surface-700 rounded-xl text-sm text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition-all"
          />
          {localSearch ? (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-medium text-surface-500 bg-surface-700/50 rounded border border-surface-600">
              {modifier}K
            </kbd>
          )}
        </div>

        {/* Section List */}
        <div className="space-y-1">
          <AnimatePresence mode="popLayout">
            {filteredSections.map((section, index) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;

              return (
                <motion.button
                  key={section.id}
                  layout
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.15, delay: index * 0.02 }}
                  type="button"
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onSectionChange(section.id)}
                  className={`w-full flex items-center space-x-3 px-4 py-2.5 rounded-xl text-left text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-surface-800 text-white border-l-2 border-primary-500 shadow-lg shadow-primary-500/10'
                      : 'text-surface-400 hover:text-white hover:bg-surface-800/50'
                  }`}
                >
                  <Icon className={`h-4 w-4 flex-shrink-0 ${isActive ? section.color : ''}`} />
                  <span className="truncate">{section.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="activeIndicator"
                      className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-400"
                    />
                  )}
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>

        {/* No results */}
        {localSearch && filteredSections.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-4 text-sm text-surface-500"
          >
            No settings found for "{localSearch}"
          </motion.div>
        )}

        {/* Keyboard nav hint */}
        {!localSearch && (
          <div className="pt-4 border-t border-surface-800">
            <p className="text-[10px] text-surface-600 uppercase tracking-wider mb-2">Keyboard</p>
            <div className="flex items-center justify-between text-xs text-surface-500">
              <div className="flex items-center space-x-1">
                <kbd className="px-1.5 py-0.5 bg-surface-800 rounded border border-surface-700">↑</kbd>
                <kbd className="px-1.5 py-0.5 bg-surface-800 rounded border border-surface-700">↓</kbd>
                <span>Navigate</span>
              </div>
              <div className="flex items-center space-x-1">
                <kbd className="px-1.5 py-0.5 bg-surface-800 rounded border border-surface-700">↵</kbd>
                <span>Select</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}

export { sections };
