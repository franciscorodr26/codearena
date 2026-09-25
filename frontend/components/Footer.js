import React, { useState } from 'react';
import Link from 'next/link';
import Logo from './Logo';
import { Linkedin, ArrowUp } from 'lucide-react';
import { config } from '../config/env';

export default function Footer({ onFeedbackClick, onBugReportClick, onFeatureRequestClick }) {
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [newsletterStatus, setNewsletterStatus] = useState(''); // '', 'sending', 'success', 'error'

  const handleNewsletterSubmit = async (e) => {
    e.preventDefault();
    if (!newsletterEmail || !newsletterEmail.includes('@')) return;
    setNewsletterStatus('sending');
    try {
      const response = await fetch(`${config.backend_url}/api/newsletter/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newsletterEmail }),
      });
      if (response.ok) {
        setNewsletterStatus('success');
        setNewsletterEmail('');
      } else {
        setNewsletterStatus('error');
      }
    } catch {
      setNewsletterStatus('error');
    }
    setTimeout(() => setNewsletterStatus(''), 4000);
  };

  const linkClass = 'text-sm text-surface-400 hover:text-primary-400 transition-colors duration-200';
  const headerClass = 'mb-4 text-xs font-semibold uppercase tracking-wider text-surface-500';

  return (
    <footer className="relative z-10 bg-surface-950 border-t border-white/5">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 sm:grid-cols-3 lg:grid-cols-12">
          {/* Brand Column */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-4 lg:pr-8">
            <Link href="/" className="inline-flex items-center mb-5">
              <Logo size="md" />
            </Link>
            <p className="max-w-xs text-sm leading-relaxed text-surface-300">
              The community that makes developers great.
            </p>
            <address className="mt-5 text-xs not-italic leading-relaxed text-surface-500">
              447 Sutter St, Ste 506-1440<br />
              San Francisco, CA 94108
            </address>
            <a
              href="https://www.linkedin.com/company/codearenateam/"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 text-sm text-surface-400 hover:text-primary-400 transition-colors duration-200"
            >
              <Linkedin className="h-4 w-4" />
              <span>Follow us</span>
            </a>
          </div>

          {/* For Developers Column */}
          <div className="lg:col-span-2">
            <h3 className={headerClass}>For Developers</h3>
            <ul className="space-y-3">
              {[
                { href: '/practice', label: 'Practice Mode' },
                { href: '/problems', label: 'Problem Library' },
                { href: '/tournaments', label: 'Tournaments' },
                { href: '/leaderboard', label: 'Leaderboard' },
              ].map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={linkClass}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Community Column */}
          <div className="lg:col-span-2">
            <h3 className={headerClass}>Community</h3>
            <ul className="space-y-3">
              <li>
                <Link href="/friends" className={linkClass}>
                  Friends
                </Link>
              </li>
              <li>
                <Link href="/gallery" className={linkClass}>
                  Game Gallery
                </Link>
              </li>
              <li>
                <Link href="/create" className={linkClass}>
                  Create a Game
                </Link>
              </li>
              <li>
                <Link href="/challenge" className={linkClass}>
                  Weekly Challenge
                </Link>
              </li>
            </ul>
          </div>

          {/* Company Column */}
          <div className="lg:col-span-2">
            <h3 className={headerClass}>Company</h3>
            <ul className="space-y-3">
              <li>
                <Link href="/about" className={linkClass}>
                  About Us
                </Link>
              </li>
              {onFeedbackClick && (
                <li>
                  <button onClick={onFeedbackClick} className={`${linkClass} text-left`}>
                    Send Feedback
                  </button>
                </li>
              )}
              {onBugReportClick && (
                <li>
                  <button onClick={onBugReportClick} className={`${linkClass} text-left`}>
                    Report Bug
                  </button>
                </li>
              )}
              {onFeatureRequestClick && (
                <li>
                  <button onClick={onFeatureRequestClick} className={`${linkClass} text-left`}>
                    Request Feature
                  </button>
                </li>
              )}
              <li>
                <Link href="/privacy" className={linkClass}>
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className={linkClass}>
                  Terms of Service
                </Link>
              </li>
            </ul>
          </div>

          {/* Newsletter Column */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-2">
            <h3 className={headerClass}>Stay in the loop</h3>
            <form onSubmit={handleNewsletterSubmit} className="flex flex-col gap-2">
              <input
                type="email"
                value={newsletterEmail}
                onChange={(e) => setNewsletterEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full min-w-0 rounded-lg border border-surface-800 bg-surface-900 px-3 py-2.5 text-sm text-white placeholder:text-surface-500 transition-colors focus:border-primary-500/60 focus:outline-none"
              />
              <button
                type="submit"
                disabled={newsletterStatus === 'sending'}
                className="w-full rounded-lg bg-primary-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-400 disabled:opacity-50"
              >
                {newsletterStatus === 'sending' ? 'Subscribing...' : 'Subscribe'}
              </button>
            </form>
            {newsletterStatus === 'success' && (
              <p className="mt-2 text-sm text-primary-400">You&apos;re subscribed!</p>
            )}
            {newsletterStatus === 'error' && (
              <p className="mt-2 text-sm text-error-light">Something went wrong. Try again.</p>
            )}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-white/5 pt-8 sm:flex-row">
          <p className="text-xs text-surface-500" suppressHydrationWarning>
            &copy; {new Date().getFullYear()} CodeArena. All rights reserved.
          </p>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-surface-500 transition-colors hover:bg-surface-900 hover:text-primary-400"
            aria-label="Back to top"
          >
            <ArrowUp className="h-3.5 w-3.5" />
            <span>Back to top</span>
          </button>
        </div>
      </div>
    </footer>
  );
}
