// frontend/pages/terms.js
import React, { useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Logo from '../components/Logo';
import { useRouter } from 'next/router';

import { trackViewTerms } from '../utils/analytics';

export default function Terms() {
  const router = useRouter();
  const lastUpdated = 'January 13, 2026';

  // Scroll to top on mount and track page view
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    trackViewTerms();
  }, []);

  return (
    <>
      <Head>
        <title>Terms of Service - CodeArena</title>
        <meta name="description" content="Terms of Service for CodeArena. Rules, guidelines, and legal terms for using our competitive coding platform." />
        <link rel="canonical" href="https://codearena.co/terms" />
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
              <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
              <p className="text-surface-400">Last updated: {lastUpdated}</p>
            </div>

            <div className="prose prose-invert max-w-none space-y-6">
              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Agreement to Terms</h2>
                <p className="text-surface-300 leading-relaxed">
                  These Terms of Service ("Terms") govern your access to and use of CodeArena ("Service," "we," "our," or "us"), including our website, applications, and related services. By accessing or using the service, you agree to be bound by these Terms. If you do not agree to these Terms, you may not access or use the service.
                </p>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Eligibility</h2>
                <p className="text-surface-300 mb-3">To use the service, you must:</p>
                <ul className="text-surface-300 space-y-2 list-disc list-inside">
                  <li>Be at least 13 years of age</li>
                  <li>Have the legal capacity to enter into binding contracts</li>
                  <li>Not be prohibited from using the service under applicable laws</li>
                  <li>Comply with all local, state, national, and international laws</li>
                </ul>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Use of Service</h2>
                
                <h3 className="text-xl font-semibold mb-3 text-white">Acceptable Use</h3>
                <p className="text-surface-300 mb-3">You agree to use CodeArena only for lawful purposes. You agree NOT to:</p>
                <ul className="text-surface-300 space-y-2 list-disc list-inside mb-4">
                  <li>Use cheating, hacking, bots, or automated tools to gain unfair advantages</li>
                  <li>Submit malicious code, viruses, or attempt to exploit system vulnerabilities</li>
                  <li>Harass, threaten, abuse, or harm other users</li>
                  <li>Impersonate others or provide false, inaccurate, or misleading information</li>
                  <li>Interfere with, disrupt, or impose unreasonable burdens on the service</li>
                  <li>Violate intellectual property rights</li>
                  <li>Use the service for any illegal or unauthorized purpose</li>
                  <li>Attempt to reverse engineer, decompile, or extract source code</li>
                  <li>Scrape, data mine, or use automated systems to collect data</li>
                </ul>

                <h3 className="text-xl font-semibold mb-3 text-white">License to Use</h3>
                <p className="text-surface-300">
                  Subject to these Terms, we grant you a limited, non-exclusive, non-transferable, revocable license to access and use the service for personal, non-commercial purposes.
                </p>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">User Accounts</h2>
                <ul className="text-surface-300 space-y-2 list-disc list-inside">
                  <li>You are responsible for maintaining the confidentiality of your account credentials</li>
                  <li>You are responsible for all activities that occur under your account</li>
                  <li>You must provide accurate, current, and complete information</li>
                  <li>You must notify us immediately of any unauthorized account access</li>
                  <li>We reserve the right to suspend, disable, or terminate accounts that violate these Terms</li>
                  <li>You may not transfer or share your account with others</li>
                </ul>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Fair Play Policy</h2>
                <p className="text-surface-300 mb-3">
                  CodeArena is built on fair competition and integrity. We have <strong>zero tolerance</strong> for:
                </p>
                <ul className="text-surface-300 space-y-2 list-disc list-inside mb-4">
                  <li>Using external AI tools (ChatGPT, GitHub Copilot, etc.) during live battles</li>
                  <li>Copying solutions from the internet or external sources during battles</li>
                  <li>Running automated scripts, bots, or multiple accounts</li>
                  <li>Colluding with opponents or sharing solutions in real-time</li>
                  <li>Exploiting bugs, glitches, or vulnerabilities for competitive advantage</li>
                  <li>Any form of cheating, fraud, or manipulation</li>
                </ul>
                <div className="bg-red-900/20 border border-red-600 rounded-lg p-4">
                  <p className="text-red-400 font-semibold">
                    Violations will result in immediate account suspension or permanent termination without warning.
                  </p>
                </div>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Tournaments</h2>
                <p className="text-surface-300 mb-3">CodeArena offers bracket-style tournament competitions:</p>
                <ul className="text-surface-300 space-y-2 list-disc list-inside mb-4">
                  <li><strong>Registration:</strong> You must register before the deadline to participate. Late entries are not accepted</li>
                  <li><strong>Match Commitment:</strong> Once registered, you are expected to show up for your matches. Repeated no-shows may result in tournament bans</li>
                  <li><strong>Fair Play:</strong> All Fair Play Policy rules apply to tournaments. Cheating results in immediate disqualification and potential account suspension</li>
                  <li><strong>Prizes:</strong> Any prizes or rewards are distributed at our discretion. Prize eligibility may require identity verification</li>
                  <li><strong>Disputes:</strong> Tournament results are final. In case of technical issues, our decision on match outcomes is binding</li>
                  <li><strong>User-Created Tournaments:</strong> Users may create tournaments subject to our guidelines. We reserve the right to remove inappropriate tournaments</li>
                </ul>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Messaging and Social Features</h2>
                <p className="text-surface-300 mb-3">CodeArena provides messaging and friend features. You agree to:</p>
                <ul className="text-surface-300 space-y-2 list-disc list-inside mb-4">
                  <li>Not use messaging for spam, harassment, or solicitation</li>
                  <li>Not share inappropriate, offensive, or illegal content</li>
                  <li>Not impersonate others or create fake accounts to circumvent blocks</li>
                  <li>Report any abuse or violations you encounter</li>
                  <li>Respect other users' privacy and not share their information without consent</li>
                </ul>
                <p className="text-surface-300">
                  We may monitor messages for safety and terms compliance. Violations may result in messaging restrictions or account suspension.
                </p>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Payments and Creator Credits</h2>
                <p className="text-surface-300 mb-3">
                  CodeArena's core practice, battle, and social features are free. Some compute-intensive CreatorArena actions use credits, which may be available through one-time credit packs.
                </p>
                <ul className="text-surface-300 space-y-2 list-disc list-inside">
                  <li><strong>Billing:</strong> Payments are processed securely by Stripe</li>
                  <li><strong>Refunds:</strong> Except when required by law, used credit packs are non-refundable</li>
                  <li><strong>Price Changes:</strong> We may change credit-pack prices with notice before purchase</li>
                  <li><strong>Service Changes:</strong> Credit costs and CreatorArena features may change as the service evolves</li>
                </ul>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Intellectual Property</h2>
                
                <h3 className="text-xl font-semibold mb-3 text-white">Our Content</h3>
                <p className="text-surface-300 mb-4">
                  The service, including its original content, features, functionality, design, and branding, is owned by CodeArena and is protected by international copyright, trademark, patent, trade secret, and other intellectual property laws. You may not copy, modify, distribute, sell, or lease any part of our service without express written permission.
                </p>

                <h3 className="text-xl font-semibold mb-3 text-white">Your Content</h3>
                <p className="text-surface-300 mb-3">
                  You retain ownership of code and content you submit ("User Content"). By submitting user content, you grant us a worldwide, non-exclusive, royalty-free license to:
                </p>
                <ul className="text-surface-300 space-y-2 list-disc list-inside">
                  <li>Store, display, reproduce, and distribute your submissions</li>
                  <li>Use your code to provide, maintain, and improve the service</li>
                  <li>Analyze submissions for fair play enforcement and service improvement</li>
                </ul>
                <p className="text-surface-300 mt-3">
                  You represent that you have all necessary rights to grant this license and that your user content does not violate any third-party rights.
                </p>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Prohibited Content</h2>
                <p className="text-surface-300 mb-3">You may not submit user content that:</p>
                <ul className="text-surface-300 space-y-2 list-disc list-inside">
                  <li>Is illegal, harmful, threatening, abusive, harassing, defamatory, or hateful</li>
                  <li>Infringes intellectual property or privacy rights</li>
                  <li>Contains viruses, malware, or malicious code</li>
                  <li>Is spam, advertising, or promotional material</li>
                  <li>Impersonates others or misrepresents your affiliation</li>
                </ul>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Disclaimer of Warranties</h2>
                <p className="text-surface-300 mb-3">
                  THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED. TO THE FULLEST EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, INCLUDING:
                </p>
                <ul className="text-surface-300 space-y-2 list-disc list-inside">
                  <li>Merchantability, fitness for a particular purpose, and non-infringement</li>
                  <li>That the service will be uninterrupted, secure, or error-free</li>
                  <li>That defects will be corrected</li>
                  <li>That the service is free of viruses or harmful components</li>
                  <li>The accuracy, reliability, or completeness of content or results</li>
                </ul>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Limitation of Liability</h2>
                <p className="text-surface-300 mb-3">
                  TO THE MAXIMUM EXTENT PERMITTED BY LAW, CODEARENA SHALL NOT BE LIABLE FOR:
                </p>
                <ul className="text-surface-300 space-y-2 list-disc list-inside">
                  <li>Indirect, incidental, special, consequential, or punitive damages</li>
                  <li>Loss of profits, data, use, goodwill, or other intangible losses</li>
                  <li>Damages resulting from unauthorized access, use, or alteration of your content</li>
                  <li>User conduct or content</li>
                  <li>Service interruptions, errors, or downtime</li>
                </ul>
                <p className="text-surface-300 mt-4">
                  Our total liability shall not exceed the amount you paid us in the past 12 months, or $100, whichever is greater.
                </p>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Indemnification</h2>
                <p className="text-surface-300">
                  You agree to indemnify, defend, and hold harmless CodeArena and its officers, directors, employees, and agents from any claims, damages, losses, liabilities, and expenses (including legal fees) arising from: (a) your use of the Service; (b) your violation of these Terms; (c) your User Content; or (d) your violation of any third-party rights.
                </p>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Service Modifications and Termination</h2>
                <p className="text-surface-300 mb-3">We reserve the right to:</p>
                <ul className="text-surface-300 space-y-2 list-disc list-inside">
                  <li>Modify, suspend, or discontinue the service at any time without notice</li>
                  <li>Change these Terms at any time (we will notify you of material changes)</li>
                  <li>Refuse, restrict, or terminate service to anyone for any reason</li>
                  <li>Remove or refuse to display any User Content</li>
                </ul>
                <p className="text-surface-300 mt-4">
                  We are not liable for any modification, suspension, or discontinuation of the service.
                </p>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Dispute Resolution</h2>
                <p className="text-surface-300 mb-4">
                  Any dispute arising from these terms or the service shall be resolved through binding arbitration in accordance with the rules of the American Arbitration Association. You waive the right to participate in class actions.
                </p>
                <p className="text-surface-300">
                  These Terms shall be governed by and construed in accordance with the laws of California, United States, without regard to conflict of law principles.
                </p>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Miscellaneous</h2>
                <ul className="text-surface-300 space-y-2 list-disc list-inside">
                  <li><strong>Entire Agreement:</strong> These terms constitute the entire agreement between you and CodeArena</li>
                  <li><strong>Severability:</strong> If any provision is found unenforceable, the remainder shall remain in effect</li>
                  <li><strong>No Waiver:</strong> Our failure to enforce any right does not waive that right</li>
                  <li><strong>Assignment:</strong> You may not assign these terms without our consent</li>
                  <li><strong>Force Majeure:</strong> We are not liable for delays or failures due to circumstances beyond our control</li>
                </ul>
              </section>

              <section className="bg-surface-800/50 border border-surface-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4">Contact Us</h2>
                <p className="text-surface-300 mb-4">
                  If you have questions about these Terms of Service, please contact us at{' '}
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
                <Link href="/privacy" className="text-surface-400 hover:text-white transition-colors text-sm">Privacy</Link>
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
