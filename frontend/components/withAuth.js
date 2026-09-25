import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../contexts/AuthContext';

/**
 * Higher-order component that protects routes requiring authentication.
 * Redirects to /login if user is not authenticated.
 * Waits for authentication before mounting pages that may request private data.
 */
export function withAuth(WrappedComponent) {
  return function AuthProtectedComponent(props) {
    const { isAuthenticated, loading, user } = useAuth();
    const router = useRouter();
    const [inviteAccess, setInviteAccess] = useState(null);
    const redirectRef = useRef(null);
    const { isReady, pathname, asPath, replace } = router;

    useEffect(() => {
      if (loading || !isReady) {
        redirectRef.current = null;
        setInviteAccess(null);
        return;
      }

      let destination = null;
      if (!isAuthenticated) {
        setInviteAccess(null);
        destination = '/login';
        // Store the intended destination so we can redirect after login
        try {
          sessionStorage.setItem('redirectAfterLogin', asPath);
        } catch {
          // Storage may be unavailable in private or restricted browsers.
        }
      } else if (user?.email_verified === false) {
        // Preserve the existing battle-link and joined-invite allowances.
        let cameFromInvite = pathname === '/battle' && asPath.includes('playerId=');
        if (!cameFromInvite) {
          try {
            cameFromInvite = Boolean(sessionStorage.getItem('joinedViaInvite'));
          } catch {
            // Without a stored invite, require verification as usual.
          }
        }
        setInviteAccess({ user, pathname, asPath, allowed: cameFromInvite });
        if (!cameFromInvite) destination = '/verify-required';
      }

      if (!destination) {
        redirectRef.current = null;
        return;
      }

      const redirectKey = `${destination}:${asPath}`;
      if (redirectRef.current !== redirectKey) {
        redirectRef.current = redirectKey;
        // Next.js can reject a navigation when a newer navigation supersedes it.
        Promise.resolve(replace(destination)).catch(() => {
          if (redirectRef.current === redirectKey) redirectRef.current = null;
        });
      }
    }, [isAuthenticated, loading, isReady, pathname, asPath, replace, user]);

    const canRender = !loading && isReady && isAuthenticated && (
      user?.email_verified !== false || (
        inviteAccess?.user === user && inviteAccess?.pathname === pathname &&
        inviteAccess?.asPath === asPath && inviteAccess.allowed
      )
    );

    if (!canRender) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center">
          <div role="status" aria-live="polite" className="text-center">
            <p className="text-gray-400">Checking your session...</p>
          </div>
        </div>
      );
    }

    return <WrappedComponent {...props} />;
  };
}

/**
 * Higher-order component for pages that can be viewed publicly but have extra features when logged in.
 * Does NOT redirect to login if unauthenticated - just renders the page.
 * Use this for public profile pages, public leaderboards, etc.
 */
export function withOptionalAuth(WrappedComponent) {
  return function OptionalAuthComponent(props) {
    // Simply render the component - AuthContext will provide null user if not logged in
    return <WrappedComponent {...props} />;
  };
}

export default withAuth;
