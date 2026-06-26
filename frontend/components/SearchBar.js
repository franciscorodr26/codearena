import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Gamepad2, Code2, X } from 'lucide-react';
import { config } from '../config/env';
import { useAuth } from '../contexts/AuthContext';
import AvatarDisplay from './ui/AvatarDisplay';
import { NAV_COMMANDS } from '../lib/navCommands';

export default function SearchBar({ inputClassName } = {}) {
  const router = useRouter();
  const { user, token } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const ref = useRef(null);
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const searchSeqRef = useRef(0);

  const isSearchMode = query.trim().length >= 2;

  // Get filtered nav commands for idle mode
  const filteredNav = NAV_COMMANDS.filter(cmd => {
    if (cmd.requiresAuth && !token) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return cmd.label.toLowerCase().includes(q) || cmd.keywords.some(k => k.includes(q));
  });

  const doSearch = async (term) => {
    const seq = ++searchSeqRef.current;
    setLoading(true);
    try {
      const res = await fetch(`${config.backend_url}/api/search?q=${encodeURIComponent(term.trim())}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      if (seq === searchSeqRef.current) setResults(data);
    } catch (e) {
      if (seq === searchSeqRef.current) setResults(null);
    } finally {
      if (seq === searchSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      searchSeqRef.current += 1;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const clearSearch = () => {
    searchSeqRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    setQuery('');
    setLoading(false);
    setResults(null);
    setOpen(false);
  };

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    setSelectedIndex(0);
    setOpen(true);

    if (timerRef.current) clearTimeout(timerRef.current);
    if (val.trim().length >= 2) {
      timerRef.current = setTimeout(() => doSearch(val), 300);
    } else {
      searchSeqRef.current += 1;
      setLoading(false);
      setResults(null);
    }
  };

  const handleFocus = () => {
    setOpen(true);
    setSelectedIndex(0);
  };

  // Get all selectable items for keyboard nav
  const getSelectableItems = () => {
    if (!isSearchMode) return filteredNav.map(cmd => ({ type: 'nav', ...cmd }));
    const items = [];
    if (results?.users) results.users.forEach(u => items.push({ type: 'user', ...u }));
    if (results?.games) results.games.forEach(g => items.push({ type: 'game', ...g }));
    if (results?.problems) results.problems.forEach(p => items.push({ type: 'problem', ...p }));
    return items;
  };

  const navigateTo = (path) => {
    setOpen(false);
    setQuery('');
    router.push(path);
  };

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    // Use capture phase to beat the CommandPalette
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, []);

  // Arrow/Enter/Escape when open
  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      const items = getSelectableItems();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = items[selectedIndex];
        if (!item) return;
        if (item.type === 'nav') {
          const path = item.dynamic && user ? `${item.path}/${user.username}` : item.path;
          navigateTo(path);
        } else if (item.type === 'user') navigateTo(`/profile/${item.username}`);
        else if (item.type === 'game') navigateTo(`/gallery/${item.id}`);
        else if (item.type === 'problem') navigateTo(`/problems/${item.id}`);
      } else if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, selectedIndex, isSearchMode, filteredNav, results, user]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const hasSearchResults = results && (results.users?.length > 0 || results.games?.length > 0 || results.problems?.length > 0);
  let itemIndex = -1;

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500" />
        <input
          ref={inputRef}
          value={query}
          onChange={handleChange}
          onFocus={handleFocus}
          placeholder="Search..."
          className={`${inputClassName || 'w-36 lg:w-48'} pl-8 pr-8 py-1.5 bg-surface-800/60 border border-surface-700 rounded-lg text-xs text-surface-200 placeholder-surface-500 focus:outline-none focus:border-primary-500`}
        />
        {query ? (
          <button onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-500 hover:text-white">
            <X className="h-3 w-3" />
          </button>
        ) : (
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-surface-600 bg-surface-800 px-1 py-0.5 rounded border border-surface-700">⌘K</kbd>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 top-full mt-2 w-80 bg-surface-900 border border-surface-700 rounded-xl shadow-2xl overflow-hidden z-50"
          >
            <div className="max-h-80 overflow-y-auto">
              {/* Navigation links (always shown if any match) */}
              {filteredNav.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-[10px] font-semibold text-surface-500 uppercase tracking-wider bg-surface-800/50">
                    {query.trim() ? 'Pages' : 'Quick Navigation'}
                  </div>
                  {filteredNav.slice(0, query.trim() ? 6 : 30).map((cmd) => {
                    itemIndex++;
                    const idx = itemIndex;
                    const Icon = cmd.icon;
                    const path = cmd.dynamic && user ? `${cmd.path}/${user.username}` : cmd.path;
                    return (
                      <button
                        key={cmd.path}
                        onClick={() => navigateTo(path)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                          idx === selectedIndex ? 'bg-primary-500/10 text-white' : 'hover:bg-surface-800/50 text-surface-300'
                        }`}
                      >
                        <Icon className="h-4 w-4 text-surface-500 flex-shrink-0" />
                        <span className="text-xs">{cmd.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* API search results (when 2+ chars typed) */}
              {isSearchMode && loading && (
                <div className="py-4 text-center text-xs text-surface-500">Searching...</div>
              )}

              {isSearchMode && !loading && results?.users?.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-[10px] font-semibold text-surface-500 uppercase tracking-wider bg-surface-800/50">Players</div>
                  {results.users.map(u => {
                    itemIndex++;
                    const idx = itemIndex;
                    return (
                      <button key={u.id} onClick={() => navigateTo(`/profile/${u.username}`)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 transition-colors text-left ${idx === selectedIndex ? 'bg-primary-500/10 text-white' : 'hover:bg-surface-800/50'}`}>
                        <AvatarDisplay avatar={u.avatar} username={u.username} size="xs" />
                        <span className="text-xs text-surface-200">{u.username}</span>
                        <span className="text-[10px] text-surface-600 ml-auto">{u.rating} ELO</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {isSearchMode && !loading && results?.games?.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-[10px] font-semibold text-surface-500 uppercase tracking-wider bg-surface-800/50">Games</div>
                  {results.games.map(g => {
                    itemIndex++;
                    const idx = itemIndex;
                    return (
                      <button key={g.id} onClick={() => navigateTo(`/gallery/${g.id}`)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 transition-colors text-left ${idx === selectedIndex ? 'bg-primary-500/10 text-white' : 'hover:bg-surface-800/50'}`}>
                        <Gamepad2 className="h-3.5 w-3.5 text-surface-500 flex-shrink-0" />
                        <span className="text-xs text-surface-200 truncate">{g.title}</span>
                        <span className="text-[10px] text-surface-600 ml-auto flex-shrink-0">by {g.creator_username}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {isSearchMode && !loading && results?.problems?.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-[10px] font-semibold text-surface-500 uppercase tracking-wider bg-surface-800/50">Problems</div>
                  {results.problems.map(p => {
                    itemIndex++;
                    const idx = itemIndex;
                    return (
                      <button key={p.id} onClick={() => navigateTo(`/problems/${p.id}`)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 transition-colors text-left ${idx === selectedIndex ? 'bg-primary-500/10 text-white' : 'hover:bg-surface-800/50'}`}>
                        <Code2 className="h-3.5 w-3.5 text-surface-500 flex-shrink-0" />
                        <span className="text-xs text-surface-200 truncate">{p.title}</span>
                        <span className={`text-[10px] ml-auto flex-shrink-0 ${
                          p.difficulty === 'Easy' ? 'text-green-500' : p.difficulty === 'Medium' ? 'text-yellow-500' : 'text-red-500'
                        }`}>{p.difficulty}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* No results at all */}
              {isSearchMode && !loading && !hasSearchResults && filteredNav.length === 0 && (
                <div className="py-4 text-center text-xs text-surface-500">No results for &ldquo;{query}&rdquo;</div>
              )}
            </div>

            {/* Footer hint */}
            <div className="px-3 py-1.5 border-t border-surface-800 flex items-center gap-3 text-[10px] text-surface-600">
              <span>↑↓ navigate</span>
              <span>↵ select</span>
              <span>esc close</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
