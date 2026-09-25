import React, { useEffect, useRef, useState } from 'react';
import { config } from '../config/env';

/**
 * Google Sign-In Button using Google Identity Services
 * Renders a Google-branded sign-in button that handles OAuth flow
 */
export default function GoogleSignInButton({ onSuccess, onError, text = 'signin_with', disabled = false }) {
  const buttonRef = useRef(null);
  const callbacksRef = useRef({ onSuccess, onError, disabled });
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    callbacksRef.current = { onSuccess, onError, disabled };
  }, [onSuccess, onError, disabled]);

  useEffect(() => {
    if (!config.google_client_id) return;
    if (window.google?.accounts?.id) {
      setStatus('ready');
      return;
    }

    // Reuse an in-flight script across route changes and StrictMode mounts.
    let script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (script?.dataset.googleLoadFailed === 'true') {
      script.remove();
      script = null;
    }
    const isNewScript = !script;
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
    }

    let active = true;
    let timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
    };
    const handleError = () => {
      if (!active) return;
      cleanup();
      script.dataset.googleLoadFailed = 'true';
      setStatus('error');
      callbacksRef.current.onError?.(new Error('Google sign-in could not load. Please retry or sign in with email.'));
    };
    const handleLoad = () => {
      if (!active) return;
      if (!window.google?.accounts?.id) {
        handleError();
        return;
      }
      cleanup();
      setStatus('ready');
    };

    setStatus('loading');
    script.addEventListener('load', handleLoad);
    script.addEventListener('error', handleError);
    timeout = setTimeout(handleError, 15000);
    if (isNewScript) document.body.appendChild(script);

    return () => {
      active = false;
      cleanup();
    };
  }, [attempt]);

  useEffect(() => {
    if (status !== 'ready' || !config.google_client_id || !buttonRef.current) return;
    const container = buttonRef.current;
    let active = true;

    // Parent form renders must not recreate the provider iframe or lose focus.
    try {
      window.google.accounts.id.initialize({
        client_id: config.google_client_id,
        callback: (response) => {
          if (!active || callbacksRef.current.disabled) return;
          if (response?.credential) {
            callbacksRef.current.onSuccess(response.credential);
          } else {
            callbacksRef.current.onError?.(new Error('No credential received'));
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      // Render the button
      container.replaceChildren();
      window.google.accounts.id.renderButton(container, {
        type: 'standard',
        theme: 'filled_black',
        size: 'large',
        text: text,
        shape: 'rectangular',
        width: Math.min(400, container.offsetWidth || 320),
        logo_alignment: 'left',
        locale: 'en',
      });
    } catch (err) {
      setStatus('error');
      callbacksRef.current.onError?.(err);
    }
    return () => {
      active = false;
      container.replaceChildren();
    };
  }, [status, text]);

  // If Google OAuth is not configured, don't render anything
  if (!config.google_client_id) {
    return null;
  }

  if (status === 'loading') {
    return (
      <div role="status" aria-label="Loading Google sign-in" className="w-full h-11 bg-surface-800/50 rounded-lg animate-pulse" />
    );
  }

  if (status === 'error') {
    return (
      <div className="text-sm text-center text-gray-400">
        <p role="alert">Google sign-in is unavailable. You can still sign in with email.</p>
        <button type="button" disabled={disabled} onClick={() => {
          setStatus('loading');
          setAttempt(value => value + 1);
        }} className="mt-2 text-teal-400 underline disabled:opacity-50">
          Retry Google sign-in
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        key="google-provider-button"
        ref={buttonRef}
        inert={disabled ? true : undefined}
        aria-disabled={disabled}
        className={`google-sign-in-touch-target w-full flex justify-center ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
        style={{ minHeight: '44px' }}
      />
      <style jsx>{`
        .google-sign-in-touch-target :global(iframe),
        .google-sign-in-touch-target :global(div[role="button"]) {
          min-height: 44px !important;
        }

        .google-sign-in-touch-target :global(iframe) {
          height: 44px !important;
        }
      `}</style>
    </>
  );
}

/**
 * Custom styled Google button as fallback/alternative
 */
export function GoogleSignInButtonCustom({ onClick, disabled = false, text = 'Continue with Google' }) {
  if (!config.google_client_id) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 font-medium rounded-xl transition-all border border-gray-300 shadow-sm hover:shadow"
    >
      <svg className="w-5 h-5" viewBox="0 0 24 24">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
      <span>{text}</span>
    </button>
  );
}
