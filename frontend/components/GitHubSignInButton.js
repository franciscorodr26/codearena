import React, { useState } from 'react';
import { Github } from 'lucide-react';
import { config } from '../config/env';
import { createGitHubAuthorizationUrl } from '../utils/githubOAuth'

/**
 * GitHub Sign-In Button
 * Redirects to GitHub OAuth authorization page
 */
export default function GitHubSignInButton({ text = 'Continue with GitHub', disabled = false, className = '' }) {
  const [error, setError] = useState('')
  // If GitHub OAuth is not configured, don't render anything
  if (!config.github_client_id) {
    return null;
  }

  const handleGitHubSignIn = () => {
    try {
      window.location.href = createGitHubAuthorizationUrl(config.github_client_id)
    } catch {
      setError('Allow browser storage to sign in with GitHub, then try again.')
    }
  };

  return (
    <>
    <button
      type="button"
      onClick={handleGitHubSignIn}
      disabled={disabled}
      className={`w-full flex items-center justify-center gap-3 px-4 py-3 bg-[#24292e] hover:bg-[#1b1f23] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-all shadow-sm hover:shadow ${className}`}
    >
      <Github className="w-5 h-5" />
      <span>{text}</span>
    </button>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </>
  );
}

/**
 * Custom styled GitHub button with white theme
 */
export function GitHubSignInButtonLight({ text = 'Continue with GitHub', disabled = false, className = '' }) {
  const [error, setError] = useState('')
  if (!config.github_client_id) {
    return null;
  }

  const handleGitHubSignIn = () => {
    try {
      window.location.href = createGitHubAuthorizationUrl(config.github_client_id)
    } catch {
      setError('Allow browser storage to sign in with GitHub, then try again.')
    }
  };

  return (
    <>
    <button
      type="button"
      onClick={handleGitHubSignIn}
      disabled={disabled}
      className={`w-full flex items-center justify-center gap-3 px-4 py-3 bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 font-medium rounded-xl transition-all border border-gray-300 shadow-sm hover:shadow ${className}`}
    >
      <Github className="w-5 h-5" />
      <span>{text}</span>
    </button>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </>
  );
}
