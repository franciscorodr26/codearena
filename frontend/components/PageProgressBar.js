import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

/**
 * PageProgressBar - Shows loading progress during page transitions
 * Appears at the top of the viewport during navigation
 */
const PageProgressBar = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let progressInterval;

    const startLoading = () => {
      setLoading(true);
      setProgress(0);

      // Simulate progress
      progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          // Slow down as we approach 90%
          const increment = Math.max(1, (90 - prev) / 12);
          return Math.min(90, prev + increment);
        });
      }, 120);
    };

    const stopLoading = () => {
      clearInterval(progressInterval);
      setProgress(100);

      // Hide bar after completion animation
      setTimeout(() => {
        setLoading(false);
        setProgress(0);
      }, 200);
    };

    router.events.on('routeChangeStart', startLoading);
    router.events.on('routeChangeComplete', stopLoading);
    router.events.on('routeChangeError', stopLoading);

    return () => {
      clearInterval(progressInterval);
      router.events.off('routeChangeStart', startLoading);
      router.events.off('routeChangeComplete', stopLoading);
      router.events.off('routeChangeError', stopLoading);
    };
  }, [router]);

  if (!loading && progress === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-1 bg-transparent">
      <div
        className="h-full bg-gradient-to-r from-primary-500 to-primary-400 transition-all duration-200 ease-out"
        style={{
          width: `${progress}%`,
          boxShadow: '0 0 10px rgba(var(--primary-500), 0.5)',
        }}
      />
    </div>
  );
};

export default PageProgressBar;
