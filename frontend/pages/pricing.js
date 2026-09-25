import Head from 'next/head'
import Link from 'next/link'
import { ArrowRight, Check, Coins, ShieldCheck, Sparkles } from 'lucide-react'
import Logo from '../components/Logo'
import Button from '../components/ui/Button'
import { useAuth } from '../contexts/AuthContext'

const freeFeatures = [
  'Coding and prompt battles with friends, strangers, and bots',
  'Solo coding and prompt Practice',
  'All supported programming languages',
  'Problems, rankings, battle history, and tournaments',
  'Profiles, friends, messages, and notifications'
]

export default function PricingPage() {
  const { user } = useAuth()
  const playHref = user ? '/modes' : '/register'

  return (
    <>
      <Head>
        <title>CodeArena Is Free | Practice, Battle, and Create</title>
        <meta
          name="description"
          content="CodeArena's core coding, prompt practice, battles, rankings, tournaments, and social features are free. Optional CreatorArena AI generations use pay-as-you-go credits."
        />
        <link rel="canonical" href="https://codearena.co/pricing" />
      </Head>

      <main className="min-h-screen bg-surface-950 text-white">
        <header className="border-b border-surface-800 bg-surface-900/80 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="transition-opacity hover:opacity-80">
              <Logo />
            </Link>
            <Button variant="primary" size="sm" onClick={() => { window.location.href = playHref }}>
              {user ? 'Play Now' : 'Create Free Account'}
            </Button>
          </div>
        </header>

        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
          <div className="mx-auto mb-12 max-w-3xl text-center">
            <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-4 py-2 text-sm font-medium text-success-light">
              <Sparkles className="h-4 w-4" />
              Free for developers
            </span>
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">CodeArena is free to play</h1>
            <p className="mt-5 text-lg leading-relaxed text-surface-400">
              Practice alone, compete in real time, and connect with other developers. No recurring
              consumer subscription is required.
            </p>
          </div>

          <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border-2 border-primary-500 bg-surface-900 p-7 shadow-xl shadow-primary-950/20">
              <div className="mb-6">
                <p className="text-sm font-semibold uppercase tracking-wider text-primary-400">Core CodeArena</p>
                <div className="mt-2 flex items-end gap-2">
                  <span className="text-5xl font-bold">$0</span>
                  <span className="pb-1 text-surface-400">forever</span>
                </div>
                <p className="mt-3 text-sm text-surface-400">
                  Generous daily fair-use safeguards keep shared code execution and model-backed modes sustainable.
                </p>
              </div>

              <ul className="mb-8 space-y-3">
                {freeFeatures.map(feature => (
                  <li key={feature} className="flex items-start gap-3 text-surface-200">
                    <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-success" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={playHref}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-500 px-5 py-3 font-semibold text-white transition-colors hover:bg-primary-400"
              >
                {user ? 'Choose a Mode' : 'Start Free'}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </section>

            <section className="rounded-2xl border border-surface-700 bg-surface-900/70 p-7">
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-secondary-500/10 text-secondary-400">
                <Coins className="h-6 w-6" />
              </div>
              <p className="text-sm font-semibold uppercase tracking-wider text-secondary-400">Optional AI creation</p>
              <h2 className="mt-2 text-2xl font-bold">Pay only for CreatorArena compute</h2>
              <p className="mt-3 leading-relaxed text-surface-400">
                CreatorArena generations use credits because they call external AI models. Buy credits only when
                you choose to create; your core CodeArena access stays free.
              </p>

              <div className="my-7 rounded-xl border border-surface-700 bg-surface-950/60 p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-success" />
                  <div>
                    <p className="font-medium text-white">No recurring Pro plan</p>
                    <p className="mt-1 text-sm text-surface-400">Credits meter optional model usage without paywalling the community.</p>
                  </div>
                </div>
              </div>

              <Link
                href="/create"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-surface-600 bg-surface-800 px-5 py-3 font-semibold text-white transition-colors hover:bg-surface-700"
              >
                Open CreatorArena
                <ArrowRight className="h-4 w-4" />
              </Link>
            </section>
          </div>
        </div>
      </main>
    </>
  )
}
