import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Logo from './Logo';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, LogIn, LogOut, User, MessageSquare,
  Settings, Users, Crown, Trophy, Swords, Activity,
  Menu, X, Home, BarChart3, Calendar, Shield,
  MessageCircle, Bug, Lightbulb, FileCode, LayoutDashboard, Wand2, Gamepad2, Target
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useMessaging } from '../contexts/MessagingContext';
import { useFriends } from '../contexts/FriendContext';
import { useFeedback } from '../contexts/FeedbackContext';
import AvatarDisplay from './ui/AvatarDisplay';
import { getModifierKey } from '../utils/platform';
import ProfileDropdown from './ProfileDropdown';
import PlayMenu from './PlayMenu';

/**
 * Header - Shared navigation header with mobile menu
 * Last updated: 2026-01-16 - Added admin panel link
 */
const Header = ({ transparent = false }) => {
  const router = useRouter();
  const { user, isAuthenticated, logout, loading: authLoading } = useAuth();
  const { unreadCount } = useMessaging();
  const { pendingCount } = useFriends();
  const { openFeedback, openBugReport, openFeatureRequest } = useFeedback();

  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowProfileDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setShowMobileMenu(false);
  }, [router.pathname]);

  // Prevent scroll when mobile menu is open
  useEffect(() => {
    if (showMobileMenu) {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }
    return () => { document.body.classList.remove('overflow-hidden'); };
  }, [showMobileMenu]);

  const navLinks = [
    { href: '/practice', label: 'Practice', icon: Target, requiresAuth: true },
    { href: '/matchmaking', label: 'Battle', icon: Swords, requiresAuth: true },
    { href: '/problems', label: 'Problems', icon: FileCode },
    { href: '/challenge', label: 'Challenge', icon: Trophy },
    { href: '/players', label: 'Leaderboard', icon: Crown },
    { href: '/tournaments', label: 'Tournaments', icon: Calendar },
    { href: '/create', label: 'Create', icon: Wand2, requiresAuth: true },
    { href: '/gallery', label: 'Gallery', icon: Gamepad2 },
  ];

  const mobileNavLinks = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, requiresAuth: true },
    { href: '/practice', label: 'Practice', icon: Target, requiresAuth: true },
    { href: '/matchmaking', label: 'Quick Battle', icon: Swords, requiresAuth: true },
    { href: '/problems', label: 'Problem Library', icon: FileCode },
    { href: '/challenge', label: 'Weekly Challenge', icon: Trophy },
    { href: '/players', label: 'Leaderboard', icon: Crown },
    { href: '/tournaments', label: 'Tournaments', icon: Calendar },
    { href: '/friends', label: 'Friends', icon: Users, requiresAuth: true, badge: pendingCount },
    { href: '/messages', label: 'Messages', icon: MessageSquare, requiresAuth: true, badge: unreadCount },
    { href: '/analytics', label: 'My Analytics', icon: BarChart3, requiresAuth: true },
    { href: '/create', label: 'Game Creator', icon: Wand2, requiresAuth: true },
    { href: '/gallery', label: 'Game Gallery', icon: Gamepad2 },
  ];

  return (
    <>
      <motion.header
        className={`sticky top-0 z-50 px-3 sm:px-6 lg:px-8 py-3.5 bg-surface-950/80 backdrop-blur ${transparent ? '' : 'border-b border-white/5'}`}
      >
        <nav className="max-w-[1400px] mx-auto flex items-center justify-between" aria-label="Main navigation">
          {/* Logo */}
          <Link
            href={isAuthenticated ? '/dashboard' : '/'}
            className="flex items-center mr-2 lg:mr-4"
          >
            <Logo size="lg" />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden xl:flex items-center space-x-1">
            {navLinks.map((link) => {
              if (link.requiresAuth && !isAuthenticated) return null;
              const Icon = link.icon;
              const isActive = router.pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative flex items-center space-x-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-primary-400'
                      : 'text-surface-300 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span>{link.label}</span>
                  {isActive && (
                    <span className="absolute -bottom-px left-3 right-3 h-0.5 rounded-full bg-primary-500" aria-hidden="true" />
                  )}
                </Link>
              );
            })}
          </div>

          {/* Right Side - Auth + Mobile Menu */}
          <div className="flex items-center space-x-1 sm:space-x-2">
            {/* Play Menu for authenticated users */}
            {!authLoading && isAuthenticated && (
              <PlayMenu />
            )}

            {/* Separator between nav and account area */}
            {!authLoading && isAuthenticated && (
              <div className="hidden md:block border-l border-white/10 h-6 mx-1" />
            )}

            {/* Desktop: Messages & Friends (when logged in) */}
            {!authLoading && isAuthenticated && (
              <div className="hidden md:flex items-center space-x-2">
                <Link
                  href="/messages"
                  className="relative flex items-center space-x-2 px-3 py-2 rounded-lg text-surface-300 hover:text-white hover:bg-white/5 transition-all duration-200"
                  aria-label={`Messages${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
                >
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  {unreadCount > 0 && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute -top-1 -right-1 bg-error text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-bold"
                      aria-hidden="true"
                    >
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </motion.span>
                  )}
                </Link>
                <Link
                  href="/friends"
                  className="relative flex items-center space-x-2 px-3 py-2 rounded-lg text-surface-300 hover:text-white hover:bg-white/5 transition-all duration-200"
                  aria-label={`Friends${pendingCount > 0 ? ` (${pendingCount} pending)` : ''}`}
                >
                  <Users className="h-4 w-4" aria-hidden="true" />
                  {pendingCount > 0 && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute -top-1 -right-1 bg-primary-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-bold"
                      aria-hidden="true"
                    >
                      {pendingCount > 9 ? '9+' : pendingCount}
                    </motion.span>
                  )}
                </Link>
              </div>
            )}

            {/* Profile Dropdown (Desktop) */}
            {!authLoading && isAuthenticated && (
              <div className="hidden sm:block">
                <ProfileDropdown
                  isOpen={showProfileDropdown}
                  onToggle={() => setShowProfileDropdown(!showProfileDropdown)}
                  onClose={() => setShowProfileDropdown(false)}
                />
              </div>
            )}

            {/* Login/Signup buttons (when not authenticated) */}
            {!authLoading && !isAuthenticated && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => router.push('/login')}
                  className="inline-flex items-center gap-2 rounded-xl border border-surface-700 px-4 py-2 text-sm font-semibold text-surface-200 transition hover:border-primary-500/60 hover:text-white whitespace-nowrap"
                >
                  Login
                </button>
                <button
                  onClick={() => router.push('/register')}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-surface-950 transition-colors hover:bg-primary-400 whitespace-nowrap"
                >
                  Sign Up
                </button>
              </div>
            )}

            {/* Mobile Menu Button */}
            <button
              onClick={() => setShowMobileMenu(true)}
              className="xl:hidden p-2 text-surface-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              aria-label="Open menu"
              aria-expanded={showMobileMenu}
            >
              <Menu className="h-6 w-6" />
            </button>
          </div>
        </nav>
      </motion.header>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {showMobileMenu && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMobileMenu(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] xl:hidden"
            />

            {/* Slide-out Menu */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-sm bg-surface-950/95 backdrop-blur-xl border-l border-white/5 z-[101] xl:hidden overflow-y-auto"
              role="dialog"
              aria-label="Mobile menu"
              aria-modal="true"
            >
              {/* Menu Header */}
              <div className="flex items-center justify-between p-4 border-b border-white/5">
                <span className="text-lg font-display font-bold text-white">Menu</span>
                <button
                  onClick={() => setShowMobileMenu(false)}
                  className="p-2 text-surface-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                  aria-label="Close menu"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              {/* User Info (if authenticated) */}
              {isAuthenticated && user && (
                <div className="p-4 border-b border-white/5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center space-x-3 min-w-0">
                      <AvatarDisplay user={user} size="lg" className="shadow-lg shadow-primary-500/20" />
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate">{user?.username}</p>
                        <p className="text-sm text-surface-400 truncate">{user?.email}</p>
                      </div>
                    </div>
                    {/* Logout lives at the top of the menu so it's reachable the
                        instant the menu opens, without scrolling past every link. */}
                    <button
                      onClick={() => { setShowMobileMenu(false); router.push('/'); logout(); }}
                      className="flex items-center gap-1.5 shrink-0 px-3 py-2 rounded-lg text-sm font-medium text-error-light bg-error/10 hover:bg-error/20 transition-colors"
                      aria-label="Logout"
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                      <span>Log out</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Navigation Links */}
              <div className="p-2">
                {mobileNavLinks.map((link) => {
                  if (link.requiresAuth && !isAuthenticated) return null;
                  const Icon = link.icon;
                  const isActive = router.pathname === link.href;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setShowMobileMenu(false)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${
                        isActive
                          ? 'bg-primary-500/10 text-primary-400 border border-primary-500/20'
                          : 'text-surface-300 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <span className="flex items-center space-x-3">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                        <span className="font-medium">{link.label}</span>
                      </span>
                      {link.badge > 0 && (
                        <span className="bg-primary-500 text-white text-xs rounded-full px-2 py-0.5 font-bold">
                          {link.badge > 9 ? '9+' : link.badge}
                        </span>
                      )}
                      {link.isPro && !user?.is_pro && (
                        <span className="text-xs font-bold text-warning bg-warning/20 px-2 py-0.5 rounded">PRO</span>
                      )}
                    </Link>
                  );
                })}

                {/* Settings & Profile (if authenticated) */}
                {isAuthenticated && (
                  <>
                    <div className="border-t border-white/5 my-2" />
                    <Link
                      href={user?.username ? `/profile/${user.username}` : '/profile'}
                      onClick={() => setShowMobileMenu(false)}
                      className="flex items-center space-x-3 px-4 py-3 text-surface-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                    >
                      <User className="h-5 w-5" />
                      <span className="font-medium">My Profile</span>
                    </Link>
                    <Link
                      href="/settings/profile"
                      onClick={() => setShowMobileMenu(false)}
                      className="flex items-center space-x-3 px-4 py-3 text-surface-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                    >
                      <Settings className="h-5 w-5" />
                      <span className="font-medium">Settings</span>
                    </Link>
                    <div className="border-t border-white/5 my-2" />
                    <button
                      type="button"
                      onClick={() => { setShowMobileMenu(false); openFeedback(); }}
                      className="flex items-center space-x-3 w-full px-4 py-3 text-surface-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-left"
                    >
                      <MessageCircle className="h-5 w-5" />
                      <span className="font-medium">Send Feedback</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowMobileMenu(false); openBugReport(); }}
                      className="flex items-center space-x-3 w-full px-4 py-3 text-surface-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-left"
                    >
                      <Bug className="h-5 w-5" />
                      <span className="font-medium">Report Bug</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowMobileMenu(false); openFeatureRequest(); }}
                      className="flex items-center space-x-3 w-full px-4 py-3 text-surface-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-left"
                    >
                      <Lightbulb className="h-5 w-5" />
                      <span className="font-medium">Request Feature</span>
                    </button>
                    {user?.is_admin && (
                      <Link
                        href="/admin"
                        onClick={() => setShowMobileMenu(false)}
                        className="flex items-center space-x-3 px-4 py-3 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Shield className="h-5 w-5" />
                        <span className="font-medium">Admin Panel</span>
                      </Link>
                    )}
                  </>
                )}

                {/* Feedback links for signed-out visitors */}
                {!isAuthenticated && (
                  <>
                    <div className="border-t border-white/5 my-2" />
                    <button
                      type="button"
                      onClick={() => { setShowMobileMenu(false); openFeedback(); }}
                      className="flex items-center space-x-3 w-full px-4 py-3 text-surface-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-left"
                    >
                      <MessageCircle className="h-5 w-5" />
                      <span className="font-medium">Send Feedback</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowMobileMenu(false); openBugReport(); }}
                      className="flex items-center space-x-3 w-full px-4 py-3 text-surface-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-left"
                    >
                      <Bug className="h-5 w-5" />
                      <span className="font-medium">Report Bug</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowMobileMenu(false); openFeatureRequest(); }}
                      className="flex items-center space-x-3 w-full px-4 py-3 text-surface-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-left"
                    >
                      <Lightbulb className="h-5 w-5" />
                      <span className="font-medium">Request Feature</span>
                    </button>
                  </>
                )}

                {/* Login/Signup (if not authenticated) */}
                {!isAuthenticated && (
                  <>
                    <div className="border-t border-white/5 my-2" />
                    <div className="p-4 space-y-3">
                      <button
                        onClick={() => { setShowMobileMenu(false); router.push('/login'); }}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-surface-700 px-4 py-3 text-sm font-semibold text-surface-200 transition hover:border-primary-500/60 hover:text-white"
                      >
                        Login
                      </button>
                      <button
                        onClick={() => { setShowMobileMenu(false); router.push('/register'); }}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 py-3 text-sm font-semibold text-surface-950 transition-colors hover:bg-primary-400"
                      >
                        Sign Up
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Keyboard Shortcut Hint */}
              <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-white/5 bg-surface-950/95 backdrop-blur-xl">
                <p className="text-xs text-surface-500 text-center">
                  Press <kbd className="px-1.5 py-0.5 bg-surface-800 rounded text-surface-400">{getModifierKey()}K</kbd> for quick navigation
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default Header;
