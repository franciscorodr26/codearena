import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { AnimatePresence } from 'framer-motion';
import { ArrowRight, Code2, Gamepad2, MessageSquare, Swords, Trophy, Users } from 'lucide-react';

import { config } from '../config/env';
import { useAuth } from '../contexts/AuthContext';
import { trackViewHome, trackHomeCtaClick } from '../utils/analytics';
import logger from '../utils/logger';
import PasswordReminderBanner from '../components/PasswordReminderBanner';
import EnhancedFeedbackForm from '../components/EnhancedFeedbackForm';
import BugReportModal from '../components/BugReportModal';
import FeatureRequestModal from '../components/FeatureRequestModal';
import Footer from '../components/Footer';
import Header from '../components/Header';

const coreModes = [
  { title: 'Coding Practice', description: 'Solve real problems, run tests, explore edge cases, and track every attempt.', href: '/practice', cta: 'Start practicing', Icon: Code2 },
  { title: 'Prompt Practice', description: 'Write, test, and improve prompts against clear objectives and repeatable scoring.', href: '/practice?mode=prompting', cta: 'Practice prompting', Icon: MessageSquare },
  { title: 'Live Battles', description: 'Match with another developer for a coding or prompt battle, or challenge a friend directly.', href: '/matchmaking', cta: 'Find a match', Icon: Swords },
];

const communityModes = [
  { title: 'Tournaments', description: 'Compete through live brackets and climb the rankings.', href: '/tournaments', Icon: Trophy },
  { title: 'Friends and messages', description: 'See who is online, chat, challenge, and rematch.', href: '/friends', Icon: Users },
  { title: 'CreatorArena', description: 'Create coding games and share them with the community.', href: '/create', Icon: Code2 },
  { title: 'Community gallery', description: 'Discover and play games made by other developers.', href: '/gallery', Icon: Gamepad2 },
];

function SectionLabel({ children }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span className="h-px w-8 bg-primary-500/50" aria-hidden="true" />
      <span className="font-mono text-xs font-semibold uppercase tracking-[0.24em] text-surface-300">{children}</span>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [showBugReportModal, setShowBugReportModal] = useState(false);
  const [showFeatureRequestModal, setShowFeatureRequestModal] = useState(false);

  useEffect(() => {
    if (!authLoading && isAuthenticated) router.replace('/dashboard');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) trackViewHome();
  }, [authLoading, isAuthenticated]);

  const go = (destination, cta) => {
    trackHomeCtaClick(cta, destination);
    router.push(destination);
  };

  const handleFeedbackSubmit = async (feedbackData) => {
    try {
      const response = await fetch(`${config.backend_url}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          battleId: null,
          playerId: '00000000-0000-0000-0000-000000000000',
          playerName: 'Anonymous',
          rating: feedbackData.rating,
          suggestion: feedbackData.suggestion,
          email: feedbackData.email,
          timestamp: feedbackData.timestamp,
          standalone: true,
        }),
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to submit feedback');
      setShowFeedbackForm(false);
    } catch (error) {
      logger.error('Feedback submission error:', error);
      throw error;
    }
  };

  if (authLoading || isAuthenticated) {
    return <div className="min-h-screen min-h-[100dvh] bg-surface-900" />;
  }

  return (
    <>
      <Head>
        <title>CodeArena - Practice, Battle, and Build Together</title>
        <meta name="description" content="Practice coding and prompting, battle developers live, challenge friends, climb rankings, and create community coding games on CodeArena." />
        <link rel="canonical" href="https://codearena.co" />
      </Head>

      <div className="min-h-screen min-h-[100dvh] overflow-x-hidden bg-surface-900 text-white">
        <PasswordReminderBanner />
        <Header />
        <main>
          <section className="border-b border-surface-700/60">
            <div className="mx-auto grid max-w-[1400px] gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-8 lg:py-20">
              <div className="max-w-3xl">
                <p className="mb-5 text-sm font-medium text-surface-400">Coding practice & multiplayer battles</p>
                <h1 className="font-display text-4xl font-bold leading-[1.12] tracking-tight sm:text-5xl lg:text-6xl">
                  Practice coding.<span className="mt-2 block">Play against friends.</span>
                </h1>
                <p className="mt-6 max-w-xl text-lg leading-8 text-surface-300">Solve problems at your own pace, compare solutions, and challenge another developer to a live battle. Find people to practice with along the way.</p>
                <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                  <button type="button" onClick={() => go('/register', 'hero_join')} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-500 px-6 py-3 text-sm font-semibold text-surface-950 transition-colors hover:bg-primary-400">Create free account</button>
                  <button type="button" onClick={() => go('/problems', 'hero_explore')} className="inline-flex items-center justify-center gap-2 rounded-lg border border-surface-700 px-6 py-3 text-sm font-semibold text-surface-200 transition-colors hover:border-surface-500 hover:text-white">Browse problems <ArrowRight className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="divide-y divide-surface-700/60 border-y border-surface-700/60">
                {coreModes.map(({ title, description, href, cta, Icon }) => (
                  <article key={title} className="py-6">
                    <div className="flex items-start gap-4">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center text-primary-400"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                      <div><h2 className="font-display text-xl font-bold">{title}</h2><p className="mt-2 text-sm leading-6 text-surface-300">{description}</p><button type="button" onClick={() => go(href, `mode_${title}`)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-400 hover:text-primary-300">{cta}<ArrowRight className="h-4 w-4" /></button></div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="border-b border-surface-700/60 px-4 py-14 sm:px-6 lg:px-8 lg:py-16">
            <div className="mx-auto max-w-[1400px]">
              <SectionLabel>Community</SectionLabel>
              <h2 className="font-display text-3xl font-bold tracking-tight">More than solo practice</h2>
              <p className="mt-4 max-w-3xl text-base leading-7 text-surface-300">Message friends, join a tournament, or share a game you made.</p>
              <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {communityModes.map(({ title, description, href, Icon }) => (
                  <button key={title} type="button" onClick={() => go(href, `community_${title}`)} className="rounded-lg border border-surface-700/60 p-5 text-left transition-colors hover:border-surface-500 hover:bg-surface-800">
                    <Icon className="h-6 w-6 text-primary-400" /><h3 className="mt-5 font-display text-lg font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-surface-300">{description}</p>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="px-4 py-10 sm:px-6 lg:px-8">
            <div className="mx-auto flex max-w-[1400px] flex-col items-start justify-between gap-6 sm:flex-row sm:items-center"><div><h2 className="font-display text-xl font-semibold">Ready to practice?</h2><p className="mt-2 text-surface-300">Your account keeps your attempts, rankings, and friends in one place.</p></div><button type="button" onClick={() => go('/register', 'closing_join')} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary-500 px-6 py-3 text-sm font-semibold text-surface-950 transition-colors hover:bg-primary-400">Create your account<ArrowRight className="h-4 w-4" /></button></div>
          </section>
        </main>

        <AnimatePresence>{showFeedbackForm && <EnhancedFeedbackForm onSubmit={handleFeedbackSubmit} onClose={() => setShowFeedbackForm(false)} standalone />}</AnimatePresence>
        <BugReportModal isOpen={showBugReportModal} onClose={() => setShowBugReportModal(false)} />
        <FeatureRequestModal isOpen={showFeatureRequestModal} onClose={() => setShowFeatureRequestModal(false)} />
        <Footer onFeedbackClick={() => setShowFeedbackForm(true)} onBugReportClick={() => setShowBugReportModal(true)} onFeatureRequestClick={() => setShowFeatureRequestModal(true)} />
      </div>
    </>
  );
}
