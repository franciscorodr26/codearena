import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../../../contexts/AuthContext';
import FloatingOrbs from '../../../components/ui/FloatingOrbs';
import TwoFactorLogin from '../../../components/TwoFactorLogin';
import { consumeGitHubOAuthState } from '../../../utils/githubOAuth'
import { postAuthDestination } from '../../../utils/authRedirect'

/**
 * GitHub OAuth Callback Handler
 * Handles the redirect from GitHub OAuth authorization
 * Extracts the authorization code and completes the login process
 */
export default function GitHubCallback() {
  const router = useRouter();
  const { loginWithGitHub, complete2FALogin } = useAuth();
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(true);
  const callbackStarted = useRef(false)

  // 2FA state
  const [requires2FA, setRequires2FA] = useState(false);
  const [tempToken, setTempToken] = useState('');

  useEffect(() => {
    // Only process once the router is ready and has query params
    if (!router.isReady || callbackStarted.current) return;
    callbackStarted.current = true

    const handleGitHubCallback = async () => {
      const { code, state, error: githubError } = router.query;
      if (!consumeGitHubOAuthState(state)) {
        setError('This GitHub sign-in request is missing, expired, or invalid. Please start again.')
        setIsProcessing(false)
        setTimeout(() => router.push('/login?error=github_auth_failed'), 2000)
        return
      }

      // Check if GitHub returned an error
      if (githubError) {
        console.error('GitHub OAuth error:', githubError);
        setError('GitHub authentication failed. Please try again.');
        setIsProcessing(false);

        // Redirect to login page with error after a short delay
        setTimeout(() => {
          router.push('/login?error=github_auth_failed');
        }, 2000);
        return;
      }

      // Check if we have the authorization code
      if (typeof code !== 'string' || !code) {
        console.error('No authorization code received from GitHub');
        setError('No authorization code received. Please try again.');
        setIsProcessing(false);

        // Redirect to login page with error
        setTimeout(() => {
          router.push('/login?error=github_auth_failed');
        }, 2000);
        return;
      }

      try {
        // Call loginWithGitHub with the authorization code
        const result = await loginWithGitHub(code);

        // Check if 2FA is required
        if (result.requires2FA) {
          setRequires2FA(true);
          setTempToken(result.tempToken);
          setIsProcessing(false);
          return;
        }

        router.push(postAuthDestination(result.userData || (result.isNewUser ? { username_chosen: 0 } : null)));
      } catch (err) {
        console.error('GitHub login error:', err);
        setError(err.message || 'Failed to complete GitHub authentication');
        setIsProcessing(false);

        // Redirect to login page with error after a short delay
        setTimeout(() => {
          router.push('/login?error=github_auth_failed');
        }, 2000);
      }
    };

    handleGitHubCallback();
  }, [router.isReady, router.query, loginWithGitHub, router]);

  // Handle 2FA success
  const handle2FASuccess = async ({ token: authToken, user: userData }) => {
    try {
      await complete2FALogin(authToken, userData, false);
      router.push(postAuthDestination(userData));
    } catch (err) {
      setError('Failed to complete login. Please try again.');
      setRequires2FA(false);
      setTempToken('');
    }
  };

  // Handle 2FA cancel
  const handle2FACancel = () => {
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-surface-900 text-white flex items-center justify-center relative overflow-hidden">
      <FloatingOrbs />

      <div className="relative z-10 text-center">
        <div className="bg-surface-800 border border-surface-700 rounded-2xl p-8 max-w-md mx-auto shadow-2xl">
          {requires2FA ? (
            <TwoFactorLogin
              tempToken={tempToken}
              username="GitHub User"
              onSuccess={handle2FASuccess}
              onCancel={handle2FACancel}
            />
          ) : isProcessing ? (
            <>
              <div className="mb-6">
                <div className="w-16 h-16 mx-auto mb-4 border-4 border-accent-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
              <h1 className="text-2xl font-bold mb-2">Completing GitHub Sign-In</h1>
              <p className="text-surface-300">Please wait while we authenticate your account...</p>
            </>
          ) : error ? (
            <>
              <div className="mb-6">
                <div className="w-16 h-16 mx-auto mb-4 bg-error-500/20 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-error-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
              </div>
              <h1 className="text-2xl font-bold mb-2 text-error-500">Authentication Failed</h1>
              <p className="text-surface-300 mb-4">{error}</p>
              <p className="text-sm text-surface-400">Redirecting to login page...</p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
