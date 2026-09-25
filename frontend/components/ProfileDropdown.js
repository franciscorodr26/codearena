import { useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User,
  Settings,
  BarChart3,
  Shield,
  LogOut,
  MessageCircle,
  Activity,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useFeedback } from '../contexts/FeedbackContext';
import AvatarDisplay from './ui/AvatarDisplay';

export default function ProfileDropdown({ isOpen, onToggle, onClose }) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { openFeedback } = useFeedback();
  const dropdownRef = useRef(null);
  const menuRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onClose]);

  // Reposition dropdown if it overflows the viewport
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    // If menu overflows bottom, cap its height
    if (rect.bottom > window.innerHeight - 8) {
      menu.style.maxHeight = `${window.innerHeight - rect.top - 8}px`;
      menu.style.overflowY = 'auto';
    }
    // If menu overflows right side, shift it left
    if (rect.right > window.innerWidth - 8) {
      menu.style.right = 'auto';
      menu.style.left = `${window.innerWidth - rect.width - 8 - menu.offsetParent.getBoundingClientRect().left}px`;
    }
  }, [isOpen]);

  const handleItemClick = () => {
    onClose();
  };

  const handleLogout = () => {
    onClose();
    router.push('/');
    logout();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onToggle}
        className={`w-9 h-9 rounded-full bg-gradient-to-br from-primary-500 to-secondary-600 flex items-center justify-center text-base ring-2 transition-all ${
          isOpen ? 'ring-primary-400' : 'ring-transparent hover:ring-surface-500'
        }`}
        aria-label="Profile menu"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <AvatarDisplay user={user} size="sm+" />
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            ref={menuRef}
            className="absolute right-0 mt-2 w-56 max-w-[calc(100vw-1rem)] bg-surface-900 border border-surface-700 rounded-xl py-2 shadow-xl z-50"
          >
            {/* User Info Header */}
            <div className="px-4 py-3 flex items-center space-x-3">
              <AvatarDisplay user={user} size="md" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{user?.username}</p>
                <p className="text-xs text-surface-400 truncate">{user?.email}</p>
              </div>
            </div>
            <div className="border-t border-surface-700 my-2" />

            {/* Primary Items - Most Used */}
            <Link
              href={user?.username ? `/profile/${user.username}` : '/profile'}
              onClick={handleItemClick}
              className="flex items-center space-x-2 px-4 py-2 text-sm text-surface-300 hover:bg-surface-800 hover:text-white transition-colors"
            >
              <User className="h-4 w-4" />
              <span>My Profile</span>
            </Link>
            <Link
              href="/activity"
              onClick={handleItemClick}
              className="flex items-center space-x-2 px-4 py-2 text-sm text-surface-300 hover:bg-surface-800 hover:text-white transition-colors"
            >
              <Activity className="h-4 w-4" />
              <span>Activity</span>
            </Link>
            <Link
              href="/analytics"
              onClick={handleItemClick}
              className="flex items-center space-x-2 px-4 py-2 text-sm text-surface-300 hover:bg-surface-800 hover:text-white transition-colors"
            >
              <BarChart3 className="h-4 w-4" />
              <span>Analytics</span>
            </Link>
            <Link
              href="/settings/profile"
              onClick={handleItemClick}
              className="flex items-center space-x-2 px-4 py-2 text-sm text-surface-300 hover:bg-surface-800 hover:text-white transition-colors"
            >
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </Link>

            {/* Divider */}
            <div className="border-t border-surface-700 my-2" />

            {/* Secondary Items */}
            <button
              type="button"
              onClick={() => { handleItemClick(); openFeedback(); }}
              className="flex items-center space-x-2 w-full text-left px-4 py-2 text-sm text-surface-300 hover:bg-surface-800 hover:text-white transition-colors"
            >
              <MessageCircle className="h-4 w-4" />
              <span>Feedback</span>
            </button>
            {user?.is_admin && (
              <Link
                href="/admin"
                onClick={handleItemClick}
                className="flex items-center space-x-2 px-4 py-2 text-sm text-error hover:bg-error/10 transition-colors"
              >
                <Shield className="h-4 w-4" />
                <span>Admin</span>
              </Link>
            )}

            {/* Logout */}
            <div className="border-t border-surface-700 my-2" />
            <button
              type="button"
              className="flex items-center space-x-2 w-full text-left px-4 py-2 text-sm text-error-light hover:bg-error/10 hover:text-error transition-colors"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
              <span>Logout</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
