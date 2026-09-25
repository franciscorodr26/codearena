import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../contexts/AuthContext';
import { config } from '../config/env';
import { Loader2 } from 'lucide-react';

// Pages that don't require username to be chosen
const PUBLIC_PAGES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/complete-profile',
  '/terms',
  '/privacy',
  '/about'
];

export default function ProfileGate({ children }) {
  const router = useRouter();
  const { user, token, loading: authLoading } = useAuth();
  const [checkState, setCheckState] = useState('idle'); // idle, checking, done, redirecting

  useEffect(() => {
    // Skip check for public pages
    if (PUBLIC_PAGES.some(page => router.pathname.startsWith(page))) {
      setCheckState('done');
      return;
    }

    // Wait for auth to finish loading
    if (authLoading) {
      setCheckState('checking');
      return;
    }

    // Skip if not logged in
    if (!token || !user) {
      setCheckState('done');
      return;
    }

    // If user already chose username, allow through immediately
    // username_chosen is 0 for new Google users who need to pick username
    // username_chosen is 1 or NULL/undefined for users who already have a username
    if (user.username_chosen !== 0) {
      setCheckState('done');
      return;
    }

    // If username_chosen is 0/false/undefined, verify via API to handle race conditions
    // where local state hasn't updated yet but server has the correct value
    const checkUsername = async () => {
      setCheckState('checking');
      try {
        const res = await fetch(`${config.backend_url}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (res.ok) {
          const data = await res.json();
          // Only redirect if username_chosen is explicitly 0 (new Google users)
          // NULL/undefined means existing user who already has a username
          if (data.user.username_chosen === 0) {
            setCheckState('redirecting');
            router.replace('/complete-profile');
            return;
          }
        }
        setCheckState('done');
      } catch (err) {
        console.error('Username check failed:', err);
        setCheckState('done'); // Allow through on error
      }
    };

    checkUsername();
  }, [token, user, authLoading, router]);

  // Show loading spinner while checking
  const isPublicPage = PUBLIC_PAGES.some(page => router.pathname.startsWith(page));
  if (!isPublicPage && token && (checkState === 'checking' || checkState === 'idle')) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-primary-400 animate-spin" />
      </div>
    );
  }

  // Redirect happening
  if (checkState === 'redirecting') {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-primary-400 animate-spin" />
      </div>
    );
  }

  return children;
}
