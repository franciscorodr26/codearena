// Warm-up practice: a quick problem between battles, while waiting in the
// queue, or right after a match. Deliberately small, with no study navigation,
// editorials or bookmarks. Starter code and tests come from the server.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shuffle, Timer, Flame, Zap, Trophy, RotateCcw, ArrowRight,
  Users, Terminal, Check, X, AlertTriangle, ChevronDown, ChevronUp, Swords
} from 'lucide-react'
import Header from '../Header'
import CodeEditor from '../CodeEditor'
import ResizablePanel from '../ResizablePanel'
import ReportProblemModal from '../ReportProblemModal'
import ProblemDescriptionPanel from '../ProblemDescriptionPanel'
import { ProblemDescription } from '../ProblemDescription'
import SubmitButton from '../ui/SubmitButton'
import { config } from '../../config/env'
import { useAuth } from '../../contexts/AuthContext'
import { useMatchmakingQueue } from '../../contexts/MatchmakingQueueContext'
import { getRunnableLanguages } from '../../utils/languages'
import { fetchWithTimeout } from '../../utils/fetch'

const DIFFICULTY_CHIPS = [
  { id: 'any', label: 'Any' },
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' }
]
const XP_BY_DIFFICULTY = { easy: 10, medium: 20, hard: 35 }
const DIFFICULTY_KEY = 'codearena_practice_difficulty'
const PREFERRED_LANGUAGE_KEY = 'codearena-preferred-language'
const STREAK_KEY = 'codearena_streak'
const FASTEST_KEY = 'codearena_fastest_solve'

// Shared with battle.js "Go to practice", which stashes the battle code here
const codeKey = (problemId, language) => `practice-code-${problemId}-${language}`
const dayKey = (offsetDays = 0) => new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10)
const xpKey = () => `codearena_xp_${dayKey()}`

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ }
}

function readStats() {
  if (typeof window === 'undefined') return { streak: 0, xp: 0, fastest: null }
  const streak = readJson(STREAK_KEY, { count: 0, lastDate: null })
  const alive = streak.lastDate === dayKey() || streak.lastDate === dayKey(1)
  let xp = 0
  try { xp = parseInt(localStorage.getItem(xpKey()) || '0', 10) || 0 } catch { /* ignore */ }
  return { streak: alive ? streak.count || 0 : 0, xp, fastest: readJson(FASTEST_KEY, null) }
}

// One accepted solution: extend the streak, add XP, remember the fastest clean solve.
function recordSolve({ difficulty, seconds, problemId, title }) {
  const streak = readJson(STREAK_KEY, { count: 0, lastDate: null })
  if (streak.lastDate !== dayKey()) {
    streak.count = streak.lastDate === dayKey(1) ? (streak.count || 0) + 1 : 1
    streak.lastDate = dayKey()
    writeJson(STREAK_KEY, streak)
  }
  const gained = XP_BY_DIFFICULTY[String(difficulty || '').toLowerCase()] || 10
  try {
    const xp = (parseInt(localStorage.getItem(xpKey()) || '0', 10) || 0) + gained
    localStorage.setItem(xpKey(), String(xp))
  } catch { /* ignore */ }
  const fastest = readJson(FASTEST_KEY, null)
  if (Number.isFinite(seconds) && seconds > 0 && (!fastest || seconds < fastest.seconds)) {
    writeJson(FASTEST_KEY, { seconds, problemId, title })
  }
  return { ...readStats(), gained }
}

function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0))
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

function unwrapProblem(data) {
  if (data?.problem?.id) return data.problem
  return data?.id ? data : null
}

function stringify(value) {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return String(value) }
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? 'border-primary-400 bg-primary-500/15 text-primary-200'
          : 'border-surface-700 text-surface-300 hover:border-surface-500 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

function StatPill({ icon: Icon, label, value, tone = 'text-surface-200' }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-surface-800 bg-surface-900/70 px-3 py-1.5">
      <Icon className={`h-4 w-4 ${tone}`} />
      <span className="text-xs text-surface-400">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${tone}`}>{value}</span>
    </div>
  )
}

function Notice({ notice, onClose }) {
  if (!notice) return null
  const tone = notice.tone === 'error'
    ? 'border-error/40 bg-error/10 text-error-light'
    : 'border-warning/40 bg-warning/10 text-warning'
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${tone}`} role="status">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span className="flex-1">{notice.text}</span>
      {notice.href && (
        <Link href={notice.href} className="font-semibold underline underline-offset-2">{notice.label || 'Open'}</Link>
      )}
      <button type="button" onClick={onClose} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

function ResultRow({ result, index }) {
  const [open, setOpen] = useState(!result.passed)
  return (
    <div className={`rounded-lg border ${result.passed ? 'border-success/30 bg-success/5' : 'border-error/30 bg-error/5'}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        {result.passed
          ? <Check className="h-4 w-4 text-success" />
          : <X className="h-4 w-4 text-error" />}
        <span className="font-medium text-white">Test {index + 1}</span>
        <span className={`ml-auto text-xs ${result.passed ? 'text-success' : 'text-error-light'}`}>
          {result.passed ? 'Passed' : 'Failed'}
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-surface-500" /> : <ChevronDown className="h-4 w-4 text-surface-500" />}
      </button>
      {open && (
        <dl className="grid gap-1 border-t border-surface-800 px-3 py-2 font-mono text-xs">
          <div><dt className="inline text-surface-500">Input: </dt><dd className="inline break-all text-surface-300">{stringify(result.input)}</dd></div>
          <div><dt className="inline text-surface-500">Expected: </dt><dd className="inline break-all text-surface-300">{stringify(result.expected)}</dd></div>
          <div><dt className="inline text-surface-500">Got: </dt><dd className={`inline break-all ${result.passed ? 'text-surface-300' : 'text-error-light'}`}>{stringify(result.actual)}</dd></div>
          {result.error && <div><dt className="inline text-surface-500">Error: </dt><dd className="inline whitespace-pre-wrap text-error-light">{result.error}</dd></div>}
          {result.stdout && <div><dt className="inline text-surface-500">Output: </dt><dd className="inline whitespace-pre-wrap text-surface-400">{result.stdout}</dd></div>}
        </dl>
      )}
    </div>
  )
}

export default function ArenaPractice() {
  const router = useRouter()
  const { token } = useAuth()
  const queue = useMatchmakingQueue()
  const { problem: problemParam, queueActive, after, difficulty: difficultyParam } = router.query

  const [problem, setProblem] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [difficulty, setDifficulty] = useState('any')
  const [language, setLanguage] = useState('python')
  const [code, setCode] = useState('')
  const [outcome, setOutcome] = useState(null)
  const [runState, setRunState] = useState('idle')
  const [notice, setNotice] = useState(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [customInput, setCustomInput] = useState('')
  const [customResult, setCustomResult] = useState(null)
  const [customRunning, setCustomRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [clockRunning, setClockRunning] = useState(false)
  const [stats, setStats] = useState({ streak: 0, xp: 0, fastest: null })
  const [gained, setGained] = useState(0)
  const [reportOpen, setReportOpen] = useState(false)

  const difficultyRef = useRef('any')
  const requestRef = useRef(0)
  const solvedRef = useRef(new Set())

  const afterBattle = typeof after === 'string' && after.length > 0
  const inQueue = queueActive === 'true' && queue.isSearching && !queue.matchFound
  const languages = useMemo(() => getRunnableLanguages(problem), [problem])

  useEffect(() => {
    setStats(readStats())
    const fromUrl = typeof difficultyParam === 'string' ? difficultyParam.toLowerCase() : null
    let stored = null
    try { stored = localStorage.getItem(DIFFICULTY_KEY) } catch { /* ignore */ }
    const chosen = [fromUrl, stored].find(v => DIFFICULTY_CHIPS.some(c => c.id === v)) || 'any'
    difficultyRef.current = chosen
    setDifficulty(chosen)
  }, [difficultyParam])

  const chooseDifficulty = useCallback((id) => {
    difficultyRef.current = id
    setDifficulty(id)
    try { localStorage.setItem(DIFFICULTY_KEY, id) } catch { /* ignore */ }
  }, [])

  const loadProblem = useCallback(async ({ id, excludeId } = {}) => {
    const seq = ++requestRef.current
    setLoading(true)
    setLoadError('')
    setOutcome(null)
    setRunState('idle')
    setNotice(null)
    setCustomResult(null)
    setGained(0)
    try {
      const params = new URLSearchParams()
      if (!id && difficultyRef.current !== 'any') params.set('difficulty', difficultyRef.current)
      if (!id && excludeId) params.set('exclude', excludeId)
      const url = id
        ? `${config.backend_url}/api/problems/${encodeURIComponent(id)}`
        : `${config.backend_url}/api/problems/random${params.toString() ? `?${params}` : ''}`
      const res = await fetchWithTimeout(url, {}, 15000)
      const data = await res.json().catch(() => ({}))
      if (seq !== requestRef.current) return
      const next = res.ok ? unwrapProblem(data) : null
      if (!next) {
        setProblem(null)
        setLoadError(res.status === 404 ? 'That problem does not exist.' : (data.error || 'No problem is available right now.'))
        return
      }
      setProblem(next)
      setElapsed(0)
      setClockRunning(!afterBattle)
    } catch {
      if (seq === requestRef.current) {
        setProblem(null)
        setLoadError('Could not reach the server.')
      }
    } finally {
      if (seq === requestRef.current) setLoading(false)
    }
  }, [afterBattle])

  useEffect(() => {
    if (!router.isReady) return
    if (typeof problemParam === 'string' && problemParam) loadProblem({ id: problemParam })
    else loadProblem()
  }, [router.isReady, problemParam, loadProblem])

  // Pick a language the problem supports, preferring the player's usual one
  useEffect(() => {
    if (!problem) return
    const ids = languages.map(l => l.id)
    let preferred = null
    try { preferred = localStorage.getItem(PREFERRED_LANGUAGE_KEY) } catch { /* ignore */ }
    setLanguage(prev => (ids.includes(prev) ? prev : ids.includes(preferred) ? preferred : ids[0] || 'python'))
  }, [problem, languages])

  // Saved work wins over the starter so a refresh (or a battle hand-off) keeps the code
  useEffect(() => {
    if (!problem) return
    let saved = null
    try { saved = localStorage.getItem(codeKey(problem.id, language)) } catch { /* ignore */ }
    setCode(saved || problem.starterCode?.[language] || '')
    setCustomInput(problem.testCases?.[0]?.input ?? '')
  }, [problem, language])

  useEffect(() => {
    if (!clockRunning) return undefined
    const id = setInterval(() => setElapsed(v => v + 1), 1000)
    return () => clearInterval(id)
  }, [clockRunning])

  const handleCodeChange = useCallback((value) => {
    setCode(value)
    if (problem) {
      try { localStorage.setItem(codeKey(problem.id, language), value) } catch { /* ignore */ }
    }
  }, [problem, language])

  const changeLanguage = useCallback((next) => {
    setLanguage(next)
    try { localStorage.setItem(PREFERRED_LANGUAGE_KEY, next) } catch { /* ignore */ }
  }, [])

  const resetToStarter = useCallback(() => {
    if (!problem) return
    try { localStorage.removeItem(codeKey(problem.id, language)) } catch { /* ignore */ }
    setCode(problem.starterCode?.[language] || '')
    setOutcome(null)
    setRunState('idle')
  }, [problem, language])

  const signInNotice = useMemo(() => ({
    tone: 'warn',
    text: 'Sign in to run your code. Your draft stays on this device.',
    href: `/login?redirect=${encodeURIComponent(router.asPath || '/practice')}`,
    label: 'Sign in'
  }), [router.asPath])

  const runTests = useCallback(async () => {
    if (!problem || runState === 'running') return
    if (!token) { setNotice(signInNotice); return }
    setRunState('running')
    setNotice(null)
    const seconds = elapsed
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/api/practice/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          code,
          language,
          problemId: problem.id,
          solveTime: afterBattle ? undefined : seconds
        })
      }, 60000, 0)
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) { setNotice(signInNotice); setRunState('idle'); return }
      if (res.status === 403 && data.emailVerificationRequired) {
        setNotice({ tone: 'warn', text: 'Verify your email to run code.', href: '/verify-required', label: 'Verify email' })
        setRunState('idle')
        return
      }
      if (res.status === 429 || data.limitReached) {
        setNotice({ tone: 'warn', text: data.message || 'Daily limit reached. Try again tomorrow.' })
        setRunState('idle')
        return
      }
      if (res.status === 503 || data.executionUnavailable) {
        setNotice({ tone: 'warn', text: 'The code runner is unavailable right now. This attempt was not counted. Try again in a moment.' })
        setRunState('idle')
        return
      }
      if (!res.ok || !data.success) {
        setNotice({ tone: 'error', text: data.message || data.error || 'Could not run your code.' })
        setRunState('idle')
        return
      }
      setOutcome({ results: data.results || [], hiddenTests: data.hiddenTests || null, allPassed: !!data.allPassed })
      if (data.allPassed) {
        setRunState('passed')
        setClockRunning(false)
        if (!solvedRef.current.has(problem.id)) {
          solvedRef.current.add(problem.id)
          const next = recordSolve({
            difficulty: problem.difficulty,
            seconds: afterBattle ? null : seconds,
            problemId: problem.id,
            title: problem.title
          })
          setStats(next)
          setGained(next.gained)
        }
      } else {
        setRunState('failed')
      }
    } catch {
      setNotice({ tone: 'error', text: 'Could not reach the server.' })
      setRunState('idle')
    }
  }, [problem, runState, token, signInNotice, elapsed, code, language, afterBattle])

  const runCustom = useCallback(async () => {
    if (!problem || customRunning) return
    if (!token) { setNotice(signInNotice); return }
    setCustomRunning(true)
    setCustomResult(null)
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/api/practice/run-custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code, language, problemId: problem.id, customInput })
      }, 60000, 0)
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) { setNotice(signInNotice); return }
      if (res.status === 429 || data.limitReached) {
        setNotice({ tone: 'warn', text: data.message || 'Daily limit reached. Try again tomorrow.' })
        return
      }
      if (data.executionUnavailable || res.status === 503) {
        setNotice({ tone: 'warn', text: 'The code runner is unavailable right now. Try again in a moment.' })
        return
      }
      if (!res.ok) {
        setNotice({ tone: 'error', text: data.message || data.error || 'Could not run your code.' })
        return
      }
      setCustomResult(data)
    } catch {
      setNotice({ tone: 'error', text: 'Could not reach the server.' })
    } finally {
      setCustomRunning(false)
    }
  }, [problem, customRunning, token, signInNotice, code, language, customInput])

  const nextWarmup = useCallback(() => {
    const query = { ...router.query }
    delete query.problem
    delete query.after
    router.replace({ pathname: '/practice', query }, undefined, { shallow: true })
    loadProblem({ excludeId: problem?.id })
  }, [router, loadProblem, problem])

  const passedCount = outcome ? outcome.results.filter(r => r.passed).length + (outcome.hiddenTests?.passed || 0) : 0
  const totalCount = outcome ? outcome.results.length + (outcome.hiddenTests?.total || 0) : 0

  const leftPanel = (
    <div className="h-full overflow-y-auto p-3 sm:p-4">
      {loading && (
        <div className="space-y-3 animate-pulse">
          <div className="h-5 w-1/3 rounded bg-surface-800" />
          <div className="h-8 w-2/3 rounded bg-surface-800" />
          <div className="h-32 rounded bg-surface-800" />
        </div>
      )}
      {!loading && loadError && (
        <div className="rounded-xl border border-surface-800 bg-surface-900/70 p-5 text-center">
          <p className="text-surface-300">{loadError}</p>
          <button type="button" onClick={() => loadProblem()} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-surface-950 hover:bg-primary-400">
            <Shuffle className="h-4 w-4" /> Pick another
          </button>
        </div>
      )}
      {!loading && problem && (
        <ProblemDescriptionPanel
          problem={problem}
          onReportProblem={() => setReportOpen(true)}
          ProblemDescriptionRenderer={ProblemDescription}
        />
      )}
    </div>
  )

  const rightPanel = (
    <div className="flex h-full min-h-0 flex-col bg-surface-900/50">
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-surface-700 bg-surface-800/80 px-3 py-2">
        <SubmitButton
          onClick={runTests}
          disabled={!problem || !code.trim()}
          loading={runState === 'running'}
          success={runState === 'passed'}
          error={runState === 'failed'}
          label="Run tests"
          loadingLabel="Running..."
          successLabel="All passed"
          errorLabel="Not yet"
          mode="practice"
          size="md"
        />
        <select
          value={language}
          onChange={e => changeLanguage(e.target.value)}
          aria-label="Language"
          className="rounded-lg border border-surface-600 bg-surface-700 px-3 py-1.5 text-sm text-white focus:border-primary-500 focus:outline-none"
        >
          {languages.map(lang => (
            <option key={lang.id} value={lang.id}>{lang.name}</option>
          ))}
        </select>
        <button type="button" onClick={resetToStarter} title="Reset to starter code" className="inline-flex items-center gap-1 rounded-lg border border-surface-700 px-2.5 py-1.5 text-xs text-surface-300 hover:border-surface-500 hover:text-white">
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
        <div className="ml-auto flex items-center gap-2 text-sm">
          {afterBattle ? (
            <span className="text-xs text-surface-400">No clock</span>
          ) : (
            <span className={`inline-flex items-center gap-1 font-mono tabular-nums ${clockRunning ? 'text-surface-200' : 'text-success'}`}>
              <Timer className="h-4 w-4" /> {formatClock(elapsed)}
            </span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <CodeEditor value={code} onChange={handleCodeChange} language={language} height="100%" />
      </div>

      <div className="max-h-[45%] flex-shrink-0 space-y-2 overflow-y-auto border-t border-surface-700 bg-surface-900/80 p-3">
        <Notice notice={notice} onClose={() => setNotice(null)} />

        <AnimatePresence>
          {outcome?.allPassed && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-success/40 bg-success/10 px-4 py-3"
            >
              <Trophy className="h-5 w-5 text-success" />
              <div className="flex-1">
                <p className="font-semibold text-white">Solved{!afterBattle && elapsed > 0 ? ` in ${formatClock(elapsed)}` : ''}</p>
                <p className="text-xs text-surface-300">{gained > 0 ? `+${gained} XP today. ` : ''}Every test passed, hidden ones included.</p>
              </div>
              <button type="button" onClick={nextWarmup} className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-surface-950 hover:bg-primary-400">
                Next warm-up <ArrowRight className="h-4 w-4" />
              </button>
              <Link href="/matchmaking" className="inline-flex items-center gap-2 rounded-lg border border-surface-600 px-4 py-2 text-sm font-semibold text-surface-200 hover:border-surface-400 hover:text-white">
                <Swords className="h-4 w-4" /> Battle
              </Link>
            </motion.div>
          )}
        </AnimatePresence>

        {outcome && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-surface-400">
              <span>{passedCount} of {totalCount} tests passed</span>
              {outcome.hiddenTests?.total > 0 && (
                <span>{outcome.hiddenTests.passed} of {outcome.hiddenTests.total} hidden</span>
              )}
            </div>
            {outcome.results.map((result, index) => (
              <ResultRow key={index} result={result} index={index} />
            ))}
          </div>
        )}

        <div className="rounded-lg border border-surface-800">
          <button
            type="button"
            onClick={() => setCustomOpen(v => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-surface-300 hover:text-white"
          >
            <Terminal className="h-4 w-4" />
            Try your own input
            {customOpen ? <ChevronUp className="ml-auto h-4 w-4" /> : <ChevronDown className="ml-auto h-4 w-4" />}
          </button>
          {customOpen && (
            <div className="space-y-2 border-t border-surface-800 p-3">
              <label className="block text-xs text-surface-400" htmlFor="practice-custom-input">
                Arguments, comma separated, as JSON
              </label>
              <textarea
                id="practice-custom-input"
                value={customInput}
                onChange={e => setCustomInput(e.target.value)}
                rows={2}
                spellCheck={false}
                className="w-full rounded-lg border border-surface-700 bg-surface-950 px-3 py-2 font-mono text-xs text-surface-200 focus:border-primary-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={runCustom}
                disabled={customRunning || !code.trim()}
                className="inline-flex items-center gap-2 rounded-lg border border-surface-600 px-3 py-1.5 text-xs font-semibold text-surface-200 hover:border-surface-400 hover:text-white disabled:opacity-50"
              >
                {customRunning ? 'Running...' : 'Run with this input'}
              </button>
              {customResult && (
                <dl className="space-y-1 font-mono text-xs">
                  {customResult.timedOut && <dd className="text-warning">Time limit exceeded</dd>}
                  {customResult.isCompileError && <dd className="text-error-light">Compile error</dd>}
                  {customResult.output !== undefined && customResult.output !== '' && (
                    <div><dt className="inline text-surface-500">Returned: </dt><dd className="inline break-all text-surface-200">{stringify(customResult.output)}</dd></div>
                  )}
                  {customResult.stdout && <div><dt className="inline text-surface-500">Output: </dt><dd className="inline whitespace-pre-wrap text-surface-400">{customResult.stdout}</dd></div>}
                  {customResult.stderr && <div><dt className="inline text-surface-500">Error: </dt><dd className="inline whitespace-pre-wrap text-error-light">{customResult.stderr}</dd></div>}
                  {!customResult.output && !customResult.stdout && !customResult.stderr && !customResult.timedOut && (
                    <dd className="text-surface-500">No output</dd>
                  )}
                </dl>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-surface-950 text-white">
      <Head>
        <title>Warm-up - CodeArena</title>
        <meta name="description" content="Quick coding warm-ups between battles. Pick a problem, run the tests, keep your streak alive." />
        <link rel="canonical" href="https://codearena.co/practice" />
      </Head>
      <Header />

      <main className="mx-auto max-w-[1600px] px-3 pb-6 pt-3 sm:px-4">
        {inQueue && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-primary-500/40 bg-primary-500/10 px-4 py-3">
            <Users className="h-5 w-5 text-primary-300" />
            <div className="flex-1 text-sm">
              <p className="font-semibold text-white">In queue for {formatClock(queue.waitTime)}. We will pull you into the match when it is found.</p>
              <p className="text-xs text-surface-300">{queue.queueStatus?.totalInQueue || 1} in queue. Keep warming up here.</p>
            </div>
            <button type="button" onClick={queue.cancelSearch} className="rounded-lg border border-surface-600 px-3 py-1.5 text-xs font-semibold text-surface-200 hover:border-surface-400 hover:text-white">
              Leave queue
            </button>
          </div>
        )}
        {afterBattle && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-surface-700 bg-surface-900/70 px-4 py-3">
            <RotateCcw className="h-5 w-5 text-primary-300" />
            <p className="flex-1 text-sm text-surface-200">Battle over. Try it again with no clock, then jump back in when you are ready.</p>
            <Link href="/matchmaking" className="inline-flex items-center gap-1 text-sm font-semibold text-primary-300 hover:text-primary-200">
              Find a match <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary-300" />
            <h1 className="text-lg font-bold">Warm-up</h1>
          </div>
          <div className="flex items-center gap-1.5">
            {DIFFICULTY_CHIPS.map(chip => (
              <Chip key={chip.id} active={difficulty === chip.id} onClick={() => chooseDifficulty(chip.id)}>{chip.label}</Chip>
            ))}
          </div>
          <button
            type="button"
            onClick={nextWarmup}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-surface-700 px-3 py-1.5 text-sm font-semibold text-surface-200 hover:border-surface-500 hover:text-white disabled:opacity-50"
          >
            <Shuffle className="h-4 w-4" /> Quick warm-up
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <StatPill icon={Flame} label="Streak" value={`${stats.streak}d`} tone={stats.streak > 0 ? 'text-orange-300' : 'text-surface-400'} />
            <StatPill icon={Zap} label="XP today" value={stats.xp} tone="text-primary-200" />
            {stats.fastest?.seconds > 0 && (
              <StatPill icon={Timer} label="Fastest" value={formatClock(stats.fastest.seconds)} tone="text-success" />
            )}
          </div>
        </div>

        <div className="h-[calc(100vh-13rem)] min-h-[560px] overflow-hidden rounded-xl border border-surface-800">
          <ResizablePanel
            storageKey="practicePanelWidth"
            defaultLeftWidth={42}
            minLeftWidth={28}
            leftPanel={leftPanel}
            rightPanel={rightPanel}
          />
        </div>
      </main>

      {problem && (
        <ReportProblemModal
          isOpen={reportOpen}
          onClose={() => setReportOpen(false)}
          problemId={problem.id}
          problemTitle={problem.title}
        />
      )}
    </div>
  )
}

