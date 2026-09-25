import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Home, RefreshCw, AlertTriangle } from 'lucide-react';
import Button from '../components/ui/Button';

export default function Custom500() {
  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <>
      <Head>
        <title>500 - Server Error | CodeArena</title>
        <meta name="description" content="Something went wrong on our end." />
      </Head>

      <div className="min-h-screen bg-surface-950 text-white flex items-center justify-center px-6">
        {/* Background effect */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <motion.div
            className="absolute top-1/4 left-1/4 w-96 h-96 bg-error/10 rounded-full blur-3xl"
            animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 text-center max-w-md"
        >
          {/* Error icon */}
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            className="mb-6 flex justify-center"
          >
            <div className="w-20 h-20 rounded-full bg-error/20 flex items-center justify-center">
              <AlertTriangle className="w-10 h-10 text-error" />
            </div>
          </motion.div>

          <h1 className="text-2xl font-bold text-white mb-3">
            Something Went Wrong
          </h1>

          <p className="text-surface-400 mb-8">
            We hit a bug on our end. Our team has been notified. Try refreshing or come back in a bit.
          </p>

          {/* Action buttons */}
          <div className="space-y-3">
            <Button variant="primary" fullWidth icon={RefreshCw} onClick={handleRefresh}>
              Refresh Page
            </Button>

            <Link href="/" className="block">
              <Button variant="ghost" fullWidth icon={Home}>
                Back to Home
              </Button>
            </Link>
          </div>
        </motion.div>
      </div>
    </>
  );
}
