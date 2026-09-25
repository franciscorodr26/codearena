import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { config } from '../../config/env';
import FloatingOrbs from '../../components/ui/FloatingOrbs';

export default function ProfileRedirect() {
  const router = useRouter();
  const { user, token, isAuthenticated, loading } = useAuth();
  const [fetchAttempted, setFetchAttempted] = useState(false);

  useEffect(() => {
    if (loading) return;

    if (!isAuthenticated) {
      router.replace('/login?redirect=/profile');
      return;
    }

    if (user?.username) {
      router.replace(`/profile/${user.username}`);
      return;
    }

    if (isAuthenticated && !user?.username && !fetchAttempted) {
      setFetchAttempted(true);
      fetch(`${config.backend_url}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data.user?.username) {
            router.replace(`/profile/${data.user.username}`);
          } else {
            router.replace('/settings/profile');
          }
        })
        .catch(() => {
          router.replace('/settings/profile');
        });
    }
  }, [user, token, isAuthenticated, loading, router, fetchAttempted]);

  return (
    <div className="min-h-screen bg-surface-950 flex items-center justify-center">
      <FloatingOrbs />
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center relative z-10"
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="mx-auto mb-4"
        >
          <Loader2 className="h-8 w-8 text-primary-400" />
        </motion.div>
        <p className="text-surface-400">Redirecting to profile...</p>
      </motion.div>
    </div>
  );
}
