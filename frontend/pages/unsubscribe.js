import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import Logo from '../components/ui/Logo';
import { config } from '../config/env';

export default function UnsubscribePage() {
  const router = useRouter();
  const [status, setStatus] = useState('loading'); // 'loading' | 'success' | 'error'
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!router.isReady) return;

    const { email, token, type } = router.query;

    if (!email || !token) {
      setStatus('error');
      setMessage('This unsubscribe link is invalid or expired.');
      return;
    }

    const params = new URLSearchParams({ email, token, type: type || 'weekly-challenge' });

    fetch(`${config.backend_url}/api/notifications/unsubscribe?${params}`)
      .then(async (res) => {
        const data = await res.json();
        if (data.ok) {
          setMessage(data.message);
          setStatus('success');
        } else {
          setStatus('error');
          setMessage(data.error || 'Something went wrong. Please try again.');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Something went wrong. Please try again or manage preferences in your settings.');
      });
  }, [router.isReady, router.query]);

  return (
    <>
      <Head>
        <title>Unsubscribe - CodeArena</title>
      </Head>
      <div className="min-h-screen bg-surface-950 text-white flex flex-col items-center justify-center px-4">
        <Link href="/" className="flex items-center space-x-2 mb-10 opacity-80 hover:opacity-100 transition-opacity">
          <Logo size="md" />
        </Link>

        <div className="bg-surface-900 border border-surface-700 rounded-2xl p-8 max-w-md w-full text-center shadow-xl">
          {status === 'loading' && (
            <>
              <Loader2 className="h-10 w-10 text-primary-400 animate-spin mx-auto mb-4" />
              <p className="text-surface-300">Processing your request...</p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle className="h-12 w-12 text-success mx-auto mb-4" />
              <h1 className="text-2xl font-bold mb-2">Unsubscribed</h1>
              <p className="text-surface-300 mb-6">{message}</p>
              <Link
                href="/settings/profile"
                className="text-primary-400 hover:text-primary-300 text-sm underline"
              >
                Manage all email preferences
              </Link>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="h-12 w-12 text-danger mx-auto mb-4" />
              <h1 className="text-2xl font-bold mb-2">Invalid Link</h1>
              <p className="text-surface-300 mb-6">{message}</p>
              <Link
                href="/settings/profile"
                className="text-primary-400 hover:text-primary-300 text-sm underline"
              >
                Manage email preferences in settings
              </Link>
            </>
          )}
        </div>
      </div>
    </>
  );
}
