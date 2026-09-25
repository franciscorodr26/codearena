import { useEffect, useRef, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { ArrowLeft, ArrowRight, Gamepad2, Loader2, Users } from 'lucide-react'
import Logo from '../components/Logo'
import { withAuth } from '../components/withAuth'
import { useAuth } from '../contexts/AuthContext'
import { modesForPage, modesForPageMore } from '../lib/modes'
import { trackViewModes, trackSelectGameMode } from '../utils/analytics'

const presentation = {
  practice: { category: 'Solo', description: 'Work through coding problems or prompt exercises. Run tests, keep your drafts, and learn at your own pace.', tags: ['Coding & prompting', 'At your pace'], action: 'Start practicing', accent: 'text-primary-400', featured: true },
  'bot-battle': { category: 'Solo', description: 'Warm up against a bot. Choose your language and difficulty without waiting for another player.', tags: ['Adjustable difficulty', 'No opponent needed'], action: 'Play against a bot', accent: 'text-amber-400' },
  matchmaking: { category: 'Multiplayer', description: 'Join the queue for a coding or prompt battle with another developer.', tags: ['Public matchmaking', 'Head-to-head'], action: 'Find a match', accent: 'text-cyan-400' },
  private: { category: 'Multiplayer', description: 'Set up a battle and invite a friend. Pick a problem and see how your solutions compare.', tags: ['Invite a friend', 'Custom setup'], action: 'Challenge a friend', accent: 'text-rose-400' },
  tournaments: { category: 'Multiplayer', description: 'Join a scheduled competition or organize one. Play through the bracket, one match at a time.', tags: ['Live brackets', 'Community events'], action: 'View tournaments', accent: 'text-yellow-400' },
  create: { category: 'Create', title: 'CreatorArena', description: 'Make a playable game, try it out, and share it with the community.', tags: ['Build & share', 'Generation uses credits'], action: 'Open CreatorArena', accent: 'text-primary-400' },
}
const modeOrder = ['practice', 'bot-battle', 'matchmaking', 'private', 'tournaments', 'create']

function ModeCard({ mode, navigating, onSelect }) {
  const details = presentation[mode.id]
  const Icon = mode.icon
  const isOpening = navigating === mode.id
  return (
    <article className={`flex h-full flex-col rounded-xl border bg-surface-900 p-6 ${details.featured ? 'border-primary-500/50' : 'border-surface-700/70'}`}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <Icon className={`h-6 w-6 ${details.accent}`} aria-hidden="true" />
        <span className="text-xs font-medium text-surface-400">{details.category}</span>
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-white">{details.title || mode.title}</h2>
      <p className="mt-3 text-sm leading-6 text-surface-300">{details.description}</p>
      <ul className="mb-6 mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-surface-400" aria-label={`${details.title || mode.title} features`}>
        {details.tags.map(tag => <li key={tag} className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-surface-500" aria-hidden="true" />{tag}</li>)}
      </ul>
      <button type="button" onClick={() => onSelect(mode)} disabled={navigating !== null}
        className={`mt-auto inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-400 disabled:cursor-wait disabled:opacity-60 ${details.featured ? 'bg-primary-500 text-surface-950 hover:bg-primary-400' : 'border border-surface-600 text-surface-100 hover:border-surface-400 hover:bg-surface-800'}`}>
        {isOpening ? 'Opening…' : details.action}
        {isOpening ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
      </button>
    </article>
  )
}

function GameModes() {
  const router = useRouter()
  const { user } = useAuth()
  const [navigating, setNavigating] = useState(null)
  const [error, setError] = useState('')
  const pendingRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    trackViewModes(user)
    return () => { mountedRef.current = false }
  }, [user])

  const allModes = [...modesForPage(), ...modesForPageMore()]
  const modes = modeOrder.map(id => allModes.find(mode => mode.id === id)).filter(Boolean)

  async function openMode(mode) {
    if (pendingRef.current) return
    pendingRef.current = true
    setNavigating(mode.id)
    setError('')
    try {
      trackSelectGameMode(mode.id, user)
      const navigated = await router.push(mode.route)
      if (navigated === false && mountedRef.current) setError('That page did not open. Please try again.')
    } catch {
      if (mountedRef.current) setError('That page did not open. Please try again.')
    } finally {
      pendingRef.current = false
      if (mountedRef.current) setNavigating(null)
    }
  }

  return (
    <div className="min-h-[100dvh] bg-surface-950 text-white">
      <Head>
        <title>Game Modes - CodeArena</title>
        <meta name="description" content="Choose solo coding and prompt practice, bot battles, multiplayer matches, tournaments, or CreatorArena." />
        <link rel="canonical" href="https://codearena.co/modes" />
      </Head>
      <header className="border-b border-surface-800">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6" aria-label="Page navigation">
          <Link href="/dashboard" aria-label="CodeArena dashboard"><Logo /></Link>
          <Link href="/dashboard" className="inline-flex min-h-11 items-center gap-2 text-sm text-surface-300 hover:text-white"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Dashboard</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-28 pt-8 sm:px-6 sm:pt-10 lg:pb-12">
        <div className="mb-8">
          <p className="mb-2 text-sm font-medium text-primary-400">Play CodeArena</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">What do you want to play?</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-surface-400">Practice on your own, challenge someone, or make something to share.</p>
        </div>
        {error && <p role="alert" className="mb-5 rounded-lg border border-red-500/30 p-4 text-sm text-red-300">{error}</p>}
        <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modes.map(mode => <ModeCard key={mode.id} mode={mode} navigating={navigating} onSelect={openMode} />)}
        </div>
        <aside className="mt-6 grid gap-4 sm:grid-cols-2" aria-label="Explore the community">
          <Link href="/gallery" className="flex items-center gap-4 rounded-lg border border-surface-800 px-5 py-4 transition-colors hover:bg-surface-900">
            <Gamepad2 className="h-5 w-5 shrink-0 text-surface-400" aria-hidden="true" /><div className="flex-1"><span className="text-sm font-semibold">Community gallery</span><p className="mt-1 text-sm text-surface-400">Play games made by other developers.</p></div><ArrowRight className="h-4 w-4 shrink-0 text-surface-400" aria-hidden="true" />
          </Link>
          <Link href="/friends" className="flex items-center gap-4 rounded-lg border border-surface-800 px-5 py-4 transition-colors hover:bg-surface-900">
            <Users className="h-5 w-5 shrink-0 text-surface-400" aria-hidden="true" /><div className="flex-1"><span className="text-sm font-semibold">Find your people</span><p className="mt-1 text-sm text-surface-400">Message friends and plan your next match.</p></div><ArrowRight className="h-4 w-4 shrink-0 text-surface-400" aria-hidden="true" />
          </Link>
        </aside>
      </main>
    </div>
  )
}

export default withAuth(GameModes)
