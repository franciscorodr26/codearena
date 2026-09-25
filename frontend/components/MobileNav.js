import { useRouter } from 'next/router';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Home, Code2, Target, Users, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useFriends } from '../contexts/FriendContext';

/**
 * MobileNav - Fixed bottom navigation bar for mobile devices
 * Only shows on small screens (below lg breakpoint)
 */
const MobileNav = () => {
  const router = useRouter();
  const { isAuthenticated, user } = useAuth();
  const { pendingCount } = useFriends();

  const navItems = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/practice', label: 'Practice', icon: Target, requiresAuth: true },
    { href: '/matchmaking', label: 'Battle', icon: Code2, requiresAuth: true },
    { href: '/friends', label: 'Friends', icon: Users, requiresAuth: true, badge: pendingCount },
    { href: isAuthenticated && user?.username ? `/profile/${user.username}` : '/login', label: isAuthenticated ? 'Profile' : 'Login', icon: User },
  ];

  // Don't show on full-screen and authentication pages.
  const hiddenPaths = [
    '/auth',
    '/battle',
    '/complete-profile',
    '/forgot-password',
    '/login',
    '/matchmaking',
    '/register',
    '/reset-password',
    '/verify-email',
    '/verify-required'
  ];
  if (hiddenPaths.some(path => router.pathname.startsWith(path))) {
    return null;
  }

  return (
    <>
      {/* Spacer that reserves the bottom area in normal flow so page content
          scrolls fully above the fixed nav (matches nav height + safe-area inset).
          Rendering this here ties the reservation to MobileNav visibility: pages
          where MobileNav returns null get no spacer and no orphaned dark strip. */}
      <div
        aria-hidden="true"
        className="lg:hidden"
        style={{ height: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}
      />
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-surface-900/95 backdrop-blur-md border-t border-surface-800 safe-area-inset-bottom"
        aria-label="Mobile navigation"
      >
      <div className="flex items-center justify-around h-16">
        {navItems.map((item) => {
          if (item.requiresAuth && !isAuthenticated) return null;
          const Icon = item.icon;
          // Active detection. Profile tab's href is dynamic (/profile/<username>) but
          // router.pathname is the route template (/profile/[username]): so a naive
          // === or startsWith on href would never match. Compare by intent instead.
          const isActive = (() => {
            if (item.href.startsWith('/profile/')) {
              return router.pathname.startsWith('/profile/');
            }
            if (item.href === '/login') {
              return router.pathname === '/login';
            }
            if (item.href === '/') {
              return router.pathname === '/' || router.pathname === '/dashboard';
            }
            return router.pathname === item.href || router.pathname.startsWith(item.href + '/');
          })();
          const badgeLabel = item.badge > 0 ? ` (${item.badge} pending)` : '';

          // Mobile-app-like back behavior: tapping any bottom tab should make
          // home the back target, never retrace through other tabs/pages. We do
          // this by rewriting the current history entry to '/' (without navigating)
          // before pushing the destination. End state: [..., '/', destination].
          const handleClick = (e) => {
            if (isActive) {
              e.preventDefault();
              return;
            }
            // If navigating to home, default Link behavior is fine.
            // If on home navigating elsewhere, back will already go to '/': fine.
            // Only intercept when navigating between two non-home tabs.
            if (item.href !== '/' && router.pathname !== '/') {
              e.preventDefault();
              window.history.replaceState(null, '', '/');
              router.push(item.href);
            }
          };

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={handleClick}
              className="relative flex flex-col items-center justify-center flex-1 h-full"
              aria-label={`${item.label}${badgeLabel}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <div className="relative">
                <Icon className={`h-5 w-5 transition-colors ${isActive ? 'text-primary-400' : 'text-surface-400'}`} aria-hidden="true" />
                {item.badge > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-2 bg-primary-500 text-white text-[10px] rounded-full h-4 w-4 flex items-center justify-center font-bold"
                    aria-hidden="true"
                  >
                    {item.badge > 9 ? '9+' : item.badge}
                  </motion.span>
                )}
              </div>
              <span className={`text-[10px] mt-1 font-medium transition-colors ${isActive ? 'text-primary-400' : 'text-surface-500'}`} aria-hidden="true">
                {item.label}
              </span>
              {isActive && (
                // Plain div (no framer-motion layoutId). The shared-layout slide
                // animation made the bar visibly transit across the screen on tap,
                // appearing detached from any icon mid-slide. Instant placement
                // keeps it aligned with the active icon at all times.
                <div
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-0.5 bg-primary-500 rounded-full"
                  aria-hidden="true"
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
    </>
  );
};

export default MobileNav;
