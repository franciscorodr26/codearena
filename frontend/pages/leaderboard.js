import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Fallback redirect for /leaderboard → /players
// Primary redirect is handled server-side in next.config.js (301 for SEO)
// This page only runs if server redirect fails (shouldn't happen)
export default function LeaderboardRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/players');
  }, [router]);

  return (
    <div className="min-h-screen bg-surface-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-surface-400">Loading leaderboard...</p>
      </div>
    </div>
  );
}
