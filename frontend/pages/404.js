import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Home, ArrowLeft, Swords, Search } from 'lucide-react';
import Button from '../components/ui/Button';

export default function Custom404() {
  return (
    <>
      <Head>
        <title>404 - Page Not Found | CodeArena</title>
        <meta name="description" content="The page you're looking for doesn't exist." />
      </Head>

      <div className="min-h-screen bg-surface-950 text-white flex items-center justify-center px-6">
        {/* Background effect */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <motion.div
            className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary-500/10 rounded-full blur-3xl"
            animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-secondary-500/10 rounded-full blur-3xl"
            animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.4, 0.3] }}
            transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 text-center max-w-md"
        >
          {/* 404 Display */}
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            className="mb-8"
          >
            <span className="text-8xl font-bold bg-gradient-to-r from-primary-400 to-secondary-400 bg-clip-text text-transparent">
              404
            </span>
          </motion.div>

          <h1 className="text-2xl font-bold text-white mb-3">
            Page Not Found
          </h1>

          <p className="text-surface-400 mb-8">
            Looks like this page got lost in the code. Let's get you back on track.
          </p>

          {/* Action buttons */}
          <div className="space-y-3">
            <Link href="/" className="block">
              <Button variant="primary" fullWidth icon={Home}>
                Back to Home
              </Button>
            </Link>

            <div className="flex gap-3">
              <Link href="/matchmaking" className="flex-1">
                <Button variant="ghost" fullWidth icon={Search}>
                  Find Match
                </Button>
              </Link>
              <Link href="/practice" className="flex-1">
                <Button variant="ghost" fullWidth icon={Swords}>
                  Practice
                </Button>
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
}
