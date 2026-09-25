// frontend/pages/privacy.js
import React, { useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Logo from '../components/Logo';
import { useRouter } from 'next/router';
import { Cookie } from 'lucide-react';
import { trackViewPrivacy } from '../utils/analytics';
import { useCookieConsent } from '../contexts/CookieConsentContext';

export default function Privacy() {
  const router = useRouter();
  const { openSettings } = useCookieConsent();
  const lastUpdated = 'September 5, 2026';

  // Scroll to top on mount and track page view
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    trackViewPrivacy();
  }, []);

  return (
    <>
      <Head>
        <title>Privacy Policy - CodeArena</title>
        <meta name="description" content="Privacy Policy for CodeArena. Learn how we collect, use, and protect your personal information and coding data." />
        <link rel="canonical" href="https://codearena.co/privacy" />
        <meta name="robots" content="index, follow" />
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">
        <div className="relative z-10">
          <header className="px-6 py-6 border-b border-surface-800">
            <Link href="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
              <Logo />
            </Link>
          </header>

          <main className="max-w-4xl mx-auto px-6 py-12">
            <div className="mb-12">
              <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
              <p className="text-surface-400">Last updated: {lastUpdated}</p>
            </div>

            <div className="prose prose-invert max-w-none space-y-6">
              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Introduction</h2>
                <p className="text-surface-300 leading-relaxed">
                  CodeArena ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our website and services at codearena.co (the "Service").
                </p>
                <p className="text-surface-300 leading-relaxed mt-4">
                  By using the service, you agree to the collection and use of information in accordance with this policy.
                </p>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Information We Collect</h2>
                
                <h3 className="text-xl font-semibold mb-3 text-white">Personal Information You Provide</h3>
                <ul className="text-surface-300 space-y-2 mb-4 list-disc list-inside">
                  <li><strong>Account Information:</strong> Username, email address, and password when you register</li>
                  <li><strong>Profile Information:</strong> Avatar, bio, and display preferences</li>
                  <li><strong>Payment Information:</strong> Stripe securely processes one-time CreatorArena credit purchases and any existing legacy subscription billing. We do not store your full credit card number</li>
                  <li><strong>Feedback:</strong> Any comments, suggestions, or feedback you submit</li>
                </ul>

                <h3 className="text-xl font-semibold mb-3 text-white">Usage Data Automatically Collected</h3>
                <ul className="text-surface-300 space-y-2 list-disc list-inside">
                  <li><strong>Code Submissions:</strong> Your code solutions during battles, practice sessions, tournaments, and weekly challenges</li>
                  <li><strong>Prompt Submissions:</strong> Your prompts and results during prompt practice and prompt battles</li>
                  <li><strong>Battle Statistics:</strong> Win/loss records, ELO ratings, solve times, streaks, and performance metrics</li>
                  <li><strong>Tournament Data:</strong> Tournament registrations, match results, bracket progression, and tournament history</li>
                  <li><strong>Messages:</strong> Direct messages sent to other users through our messaging feature</li>
                  <li><strong>Friend Connections:</strong> Your friend list, friend requests, and social interactions</li>
                  <li><strong>Navigation Data:</strong> Pages visited, features used, time spent on the service</li>
                  <li><strong>Technical Information:</strong> IP address, browser type, device information, operating system</li>
                  <li><strong>Cookies and Similar Technologies:</strong> Session identifiers, authentication tokens, preferences</li>
                </ul>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">How We Use Your Information</h2>
                <p className="text-surface-300 mb-3">We use the collected information for the following purposes:</p>
                <ul className="text-surface-300 space-y-2 list-disc list-inside">
                  <li><strong>Provide and Maintain the Service:</strong> Enable coding battles, matchmaking, practice mode, tournaments, weekly challenges, and leaderboards</li>
                  <li><strong>Social Features:</strong> Enable messaging between users, friend connections, and social interactions</li>
                  <li><strong>Tournament Operations:</strong> Manage tournament registrations, brackets, match scheduling, and prize distribution</li>
                  <li><strong>Process Payments:</strong> Handle one-time CreatorArena credit purchases and support existing legacy subscription billing through Stripe</li>
                  <li><strong>Improve User Experience:</strong> Analyze usage patterns to enhance functionality and features</li>
                  <li><strong>Communication:</strong> Send tournament notifications, weekly challenge alerts, service updates, and promotional content (if you opted in)</li>
                  <li><strong>Fair Play Enforcement:</strong> Monitor for cheating, abuse, and violations of terms of service</li>
                  <li><strong>Technical Support:</strong> Respond to inquiries and troubleshoot issues</li>
                  <li><strong>Analytics:</strong> Understand how users interact with the service to improve performance</li>
                  <li><strong>Legal Compliance:</strong> Comply with applicable laws and regulations</li>
                </ul>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Data Sharing and Disclosure</h2>
                <p className="text-surface-300 mb-3">
                  <strong>We do not sell your personal information.</strong> We may share your data only in the following circumstances:
                </p>
                <ul className="text-surface-300 space-y-2 list-disc list-inside">
                  <li><strong>During Battles and Tournaments:</strong> Your username, avatar, and ELO rating are visible to opponents, tournament participants, and on leaderboards</li>
                  <li><strong>Messages:</strong> Messages are delivered to recipients you choose. We do not share private messages with third parties except as required by law</li>
                  <li><strong>Friend Lists:</strong> Your friend connections are visible to your friends. You control who can send you friend requests in settings</li>
                  <li><strong>Payment Processing:</strong> Stripe processes one-time CreatorArena credit purchases and existing legacy subscription billing. See Stripe's privacy policy for details</li>
                  <li><strong>Service Providers:</strong> Third-party vendors who help us operate the service (e.g., hosting, analytics, email). These providers are contractually obligated to protect your data</li>
                  <li><strong>Legal Requirements:</strong> When required by law, court order, or to protect our rights and safety</li>
                  <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets (users will be notified)</li>
                  <li><strong>With Your Consent:</strong> When you explicitly agree to share information</li>
                </ul>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Data Security</h2>
                <p className="text-surface-300 mb-3">
                  We implement reasonable security measures to protect your data, including:
                </p>
                <ul className="text-surface-300 space-y-2 list-disc list-inside">
                  <li>Encrypted data transmission (HTTPS/TLS)</li>
                  <li>Secure server infrastructure with access controls</li>
                  <li>Regular security audits and updates</li>
                  <li>Limited employee access to personal data</li>
                  <li>Industry-standard authentication mechanisms</li>
                </ul>
                <p className="text-surface-400 text-sm mt-4 italic">
                  However, no method of transmission over the Internet or electronic storage is 100% secure. While we strive to protect your data, we cannot guarantee absolute security.
                </p>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Your Privacy Rights</h2>
                <p className="text-surface-300 mb-3">Depending on your location, you may have the following rights:</p>
                <ul className="text-surface-300 space-y-2 list-disc list-inside">
                  <li><strong>Access:</strong> Request a copy of your personal data</li>
                  <li><strong>Correction:</strong> Update or correct inaccurate information</li>
                  <li><strong>Deletion:</strong> Request deletion of your data (subject to legal obligations)</li>
                  <li><strong>Opt-Out:</strong> Unsubscribe from marketing communications</li>
                  <li><strong>Data Portability:</strong> Receive your data in a structured, machine-readable format</li>
                  <li><strong>Restriction:</strong> Request limitation of data processing</li>
                  <li><strong>Object:</strong> Object to processing based on legitimate interests</li>
                </ul>
                <p className="text-surface-300 mt-4">
                  You can exercise many of these rights directly in your account Settings: use <strong>Data Privacy → Export</strong> to download your data, and <strong>Danger Zone → Delete Account</strong> to erase your account. For other requests, contact us at support@codearena.co.
                </p>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">California Privacy Rights (CCPA)</h2>
                <p className="text-surface-300 mb-3">
                  If you are a California resident, you have additional rights under the California Consumer Privacy Act (CCPA):
                </p>
                <ul className="text-surface-300 space-y-2 list-disc list-inside mb-4">
                  <li><strong>Right to Know:</strong> You can request information about the categories and specific pieces of personal information we have collected about you, the sources of that information, our business purposes for collecting it, and the categories of third parties with whom we share it.</li>
                  <li><strong>Right to Delete:</strong> You can request deletion of your personal information, subject to certain exceptions.</li>
                  <li><strong>Right to Opt-Out of Sale:</strong> You have the right to opt-out of the sale of your personal information. <strong>We do not sell your personal information.</strong></li>
                  <li><strong>Right to Non-Discrimination:</strong> We will not discriminate against you for exercising any of your CCPA rights.</li>
                </ul>
                <p className="text-surface-300 mb-3">
                  <strong>Categories of Personal Information Collected:</strong> In the past 12 months, we have collected: identifiers (username, email), commercial information (subscription status), internet activity (usage data, battle history), and inferences (skill ratings).
                </p>
                <p className="text-surface-300 mb-3">
                  <strong>Do Not Sell My Personal Information:</strong> CodeArena does not sell, rent, or trade your personal information to third parties for monetary consideration.
                </p>
                <p className="text-surface-300">
                  To exercise your California privacy rights, email us at{' '}
                  <a href="mailto:support@codearena.co" className="text-primary-400 hover:text-primary-300">support@codearena.co</a>{' '}
                  with the subject line "CCPA Request" or use the account deletion feature in Settings.
                </p>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Cookies and Tracking Technologies</h2>
                <p className="text-surface-300 mb-4">We use cookies and similar technologies organized into the following categories:</p>

                <div className="space-y-4 mb-6">
                  <div className="bg-surface-700/30 rounded-lg p-4 border border-surface-600">
                    <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                      Essential Cookies
                    </h3>
                    <p className="text-surface-400 text-sm mb-2">Always active: required for the website to function</p>
                    <ul className="text-surface-300 text-sm space-y-1 list-disc list-inside">
                      <li>Authentication tokens to keep you logged in</li>
                      <li>Session management during battles</li>
                      <li>Security features to protect your account</li>
                      <li>Anti-cheat protection to ensure fair play in battles</li>
                    </ul>
                  </div>

                  <div className="bg-surface-700/30 rounded-lg p-4 border border-surface-600">
                    <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                      Analytics Cookies
                    </h3>
                    <p className="text-surface-400 text-sm mb-2">Optional: help us improve CodeArena</p>
                    <ul className="text-surface-300 text-sm space-y-1 list-disc list-inside">
                      <li>Page views and feature usage statistics</li>
                      <li>Performance metrics and error tracking</li>
                      <li>Anonymous usage patterns to improve UX</li>
                    </ul>
                  </div>

                  <div className="bg-surface-700/30 rounded-lg p-4 border border-surface-600">
                    <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 bg-purple-400 rounded-full"></span>
                      Functional Cookies
                    </h3>
                    <p className="text-surface-400 text-sm mb-2">Optional: enable enhanced features</p>
                    <ul className="text-surface-300 text-sm space-y-1 list-disc list-inside">
                      <li>Remembering your preferred coding language</li>
                      <li>Editor preferences and layout settings</li>
                    </ul>
                  </div>
                </div>

                <p className="text-surface-300 mb-4">
                  You can change your cookie preferences at any time. Rejecting optional cookies will not affect essential site functionality.
                </p>
                <button
                  onClick={openSettings}
                  className="flex items-center gap-2 px-4 py-2 bg-surface-700 hover:bg-surface-600 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  <Cookie className="h-4 w-4" />
                  Manage Cookie Preferences
                </button>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Data Retention</h2>
                <p className="text-surface-300 mb-4">
                  We retain your personal information only as long as necessary to fulfill the purposes outlined in this Privacy Policy. Specific retention periods:
                </p>
                <ul className="text-surface-300 space-y-2 list-disc list-inside mb-4">
                  <li><strong>Account Data:</strong> Retained until you delete your account</li>
                  <li><strong>Battle History & Statistics:</strong> Retained indefinitely for leaderboards and fair play</li>
                  <li><strong>Direct Messages:</strong> Automatically deleted after 12 months of inactivity</li>
                  <li><strong>Code Submissions:</strong> Retained for 6 months, then anonymized for service improvement</li>
                  <li><strong>Activity Logs:</strong> Retained for 90 days for security purposes</li>
                  <li><strong>Cookie Consent Records:</strong> Retained for 3 years for compliance audit</li>
                </ul>
                <p className="text-surface-400 text-sm italic">
                  You can request early deletion of your data by deleting your account in Settings or contacting support@codearena.co.
                </p>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Children's Privacy</h2>
                <p className="text-surface-300">
                  Our service is not intended for users under 13 years of age. We do not knowingly collect personal information from children under 13. If you believe a child has provided us with personal information, please contact us immediately, and we will take steps to delete such information.
                </p>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">International Data Transfers</h2>
                <p className="text-surface-300">
                  Your information may be transferred to and maintained on servers located outside your country of residence. By using the service, you consent to such transfers. We ensure appropriate safeguards are in place for international transfers.
                </p>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Third-Party Links</h2>
                <p className="text-surface-300">
                  Our service may contain links to third-party websites. We are not responsible for the privacy practices of these external sites. We encourage you to read their privacy policies.
                </p>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Changes to This Privacy Policy</h2>
                <p className="text-surface-300">
                  We may update this Privacy Policy periodically to reflect changes in our practices or for legal reasons. We will notify you of significant changes by posting the new policy on this page with an updated "Last updated" date. Your continued use of the service after changes constitutes acceptance of the updated policy.
                </p>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Contact Us</h2>
                <p className="text-surface-300 mb-4">
                  If you have questions about this Privacy Policy, want to exercise your rights, or have privacy concerns, please contact us at{' '}
                  <a href="mailto:support@codearena.co" className="text-primary-400 hover:text-primary-300">
                    support@codearena.co
                  </a>
                </p>
                <address className="text-surface-400 text-sm not-italic mb-4">
                  CodeArena<br />
                  447 Sutter St, Ste 506-1440<br />
                  San Francisco, CA 94108
                </address>
                <button
                  onClick={() => router.push('/')}
                  className="bg-surface-700 hover:bg-surface-600 px-5 py-2 rounded-lg font-medium transition-colors"
                >
                  Back to Home
                </button>
              </section>
            </div>
          </main>

          <footer className="px-6 py-8 border-t border-surface-800">
            <div className="max-w-4xl mx-auto text-center">
              <nav className="flex items-center justify-center space-x-6 mb-4" aria-label="Footer navigation">
                <Link href="/" className="text-surface-400 hover:text-white transition-colors text-sm font-medium">Home</Link>
                <span className="text-surface-600">•</span>
                <Link href="/about" className="text-surface-400 hover:text-white transition-colors text-sm">About</Link>
                <span className="text-surface-600">•</span>
                <Link href="/terms" className="text-surface-400 hover:text-white transition-colors text-sm">Terms</Link>
              </nav>
              <p className="text-surface-500 text-sm" suppressHydrationWarning>
                © {new Date().getFullYear()} CodeArena. All rights reserved.
              </p>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
