// Prompt warm-ups: pick a challenge, write a prompt, see how the model's output
// scores. Talks to /api/prompt-practice and says so plainly when the server has
// no model configured.
import { useCallback, useEffect, useRef, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import {
  MessageSquare, Sparkles, Lightbulb, History, AlertTriangle, Check, X,
  ChevronDown, ChevronUp, Lock
} from 'lucide-react'
import Header from '../Header'
import { config } from '../../config/env'
import { useAuth } from '../../contexts/AuthContext'
import { fetchWithTimeout } from '../../utils/fetch'

const DIFFICULTIES = ['All', 'Easy', 'Medium', 'Hard']
const NOT_ENABLED = 'Prompt evaluation is not enabled on this server.'
const difficultyTone = {
  Easy: 'text-success',
  Medium: 'text-warning',
  Hard: 'text-error-light'
}

const authHeaders = token => (token ? { Authorization: `Bearer ${token}` } : {})

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

function labelOf(item) {
  if (typeof item === 'string') return item
  return item?.label || item?.name || item?.criterion || item?.id || ''
}

function passOf(item) {
  if (typeof item !== 'object' || item === null) return null
  if (typeof item.pass === 'boolean') return item.pass
  if (typeof item.met === 'boolean') return item.met
  if (typeof item.passed === 'boolean') return item.passed
  return null
}

export default function PromptPractice() {
  const router = useRouter()
  const { token } = useAuth()
  const [challenges, setChallenges] = useState([])
  const [listState, setListState] = useState('loading')
  const [difficulty, setDifficulty] = useState('All')
  const [selectedId, setSelectedId] = useState(null)
  const [challenge, setChallenge] = useState(null)
  const [promptText, setPromptText] = useState('')
  const [evaluating, setEvaluating] = useState(false)
  const [result, setResult] = useState(null)
  const [history, setHistory] = useState(null)
  const [stats, setStats] = useState(null)
  const [hints, setHints] = useState([])
  const [notice, setNotice] = useState(null)
  const [disabledReason, setDisabledReason] = useState(null)
  const [showOutput, setShowOutput] = useState(false)
  const startRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setListState('loading')
    const params = difficulty !== 'All' ? `?difficulty=${difficulty}` : ''
    fetchWithTimeout(`${config.backend_url}/api/prompt-practice/challenges${params}`, {}, 15000)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) { setListState('error'); return }
        setChallenges(Array.isArray(data.challenges) ? data.challenges : [])
        if (data.modelConfigured === false) setDisabledReason(NOT_ENABLED)
        setListState('ready')
      })
      .catch(() => { if (!cancelled) setListState('error') })
    return () => { cancelled = true }
  }, [difficulty])

  const refreshStats = useCallback(async () => {
    if (!token) { setStats(null); return }
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/api/prompt-practice/stats`, { headers: authHeaders(token) }, 15000)
      if (!res.ok) return
      setStats(await res.json())
    } catch { /* stats are decorative */ }
  }, [token])

  useEffect(() => { refreshStats() }, [refreshStats])

  useEffect(() => {
    if (router.isReady && typeof router.query.challenge === 'string') setSelectedId(router.query.challenge)
  }, [router.isReady, router.query.challenge])

  const refreshHistory = useCallback(async (id) => {
    if (!token || !id) { setHistory(null); return }
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/api/prompt-practice/challenges/${encodeURIComponent(id)}/history`, { headers: authHeaders(token) }, 15000)
      if (!res.ok) { setHistory(null); return }
      setHistory(await res.json())
    } catch { setHistory(null) }
  }, [token])

  useEffect(() => {
    if (!selectedId) { setChallenge(null); return undefined }
    let cancelled = false
    setChallenge(null)
    setResult(null)
    setHints([])
    setNotice(null)
    setShowOutput(false)
    startRef.current = Date.now()
    fetchWithTimeout(`${config.backend_url}/api/prompt-practice/challenges/${encodeURIComponent(selectedId)}`, {}, 15000)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok || !data.challenge) {
          setNotice({ tone: 'error', text: 'That challenge could not be loaded.' })
          return
        }
        setChallenge(data.challenge)
      })
      .catch(() => { if (!cancelled) setNotice({ tone: 'error', text: 'Could not reach the server.' }) })
    refreshHistory(selectedId)
    return () => { cancelled = true }
  }, [selectedId, refreshHistory])

  const selectChallenge = (id) => {
    setSelectedId(id)
    setPromptText('')
    router.replace({ pathname: router.pathname, query: { ...router.query, challenge: id } }, undefined, { shallow: true })
  }

  const signInNotice = {
    tone: 'warn',
    text: 'Sign in to evaluate prompts.',
    href: `/login?redirect=${encodeURIComponent(router.asPath || '/practice?mode=prompting')}`,
    label: 'Sign in'
  }

  const evaluate = async () => {
    if (!challenge || evaluating) return
    if (!token) { setNotice(signInNotice); return }
    if (promptText.trim().length < 10) { setNotice({ tone: 'warn', text: 'Write a little more before evaluating.' }); return }
    setEvaluating(true)
    setNotice(null)
    try {
      const timeSpent = Math.max(0, Math.round((Date.now() - (startRef.current || Date.now())) / 1000))
      const res = await fetchWithTimeout(`${config.backend_url}/api/prompt-practice/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ challengeId: challenge.id, promptText, timeSpent })
      }, 90000, 0)
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) { setNotice(signInNotice); return }
      if (res.status === 429 || data.limitReached) {
        setNotice({ tone: 'warn', text: data.error || 'Daily limit reached. Try again tomorrow.' })
        return
      }
      if (res.status === 503 || data.notConfigured || data.modelUnavailable) {
        setDisabledReason(NOT_ENABLED)
        return
      }
      if (!res.ok || data.success === false) {
        setNotice({ tone: 'error', text: data.error || 'Evaluation failed. Please try again.' })
        return
      }
      setResult(data)
      refreshHistory(challenge.id)
      refreshStats()
    } catch {
      setNotice({ tone: 'error', text: 'Could not reach the server.' })
    } finally {
      setEvaluating(false)
    }
  }

  const revealHint = async () => {
    if (!challenge) return
    if (!token) { setNotice(signInNotice); return }
    const index = hints.length
    if (index >= (challenge.hintsCount || 0)) return
    try {
      const res = await fetchWithTimeout(`${config.backend_url}/api/prompt-practice/hints/${encodeURIComponent(challenge.id)}/${index}`, { headers: authHeaders(token) }, 15000)
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.hint) setHints(prev => [...prev, data.hint])
    } catch { /* hints are optional */ }
  }

  const attemptsRemaining = result?.attemptsRemaining ?? stats?.attemptsRemaining

  return (
    <div className="min-h-screen bg-surface-950 text-white">
      <Head>
        <title>Prompt Warm-up - CodeArena</title>
        <meta name="description" content="Practice writing prompts against clear targets and see how the output scores." />
        <link rel="canonical" href="https://codearena.co/practice?mode=prompting" />
      </Head>
      <Header />

      <main className="mx-auto grid max-w-[1400px] gap-4 px-3 pb-8 pt-4 sm:px-4 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary-300" />
            <h1 className="text-lg font-bold">Prompt warm-up</h1>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DIFFICULTIES.map(level => (
              <button
                key={level}
                type="button"
                onClick={() => setDifficulty(level)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  difficulty === level
                    ? 'border-primary-400 bg-primary-500/15 text-primary-200'
                    : 'border-surface-700 text-surface-300 hover:border-surface-500 hover:text-white'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
          {stats && (
            <p className="text-xs text-surface-400">
              {stats.attemptsRemaining ?? 0} of {stats.dailyLimit ?? 0} evaluations left today
            </p>
          )}
          <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
            {listState === 'loading' && (
              <div className="space-y-2 animate-pulse">
                {[0, 1, 2].map(i => <div key={i} className="h-16 rounded-lg bg-surface-800" />)}
              </div>
            )}
            {listState === 'error' && <p className="text-sm text-surface-400">Could not load challenges.</p>}
            {listState === 'ready' && challenges.length === 0 && (
              <p className="text-sm text-surface-400">No prompt challenges on this server yet.</p>
            )}
            {challenges.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectChallenge(item.id)}
                className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  item.id === selectedId
                    ? 'border-primary-400 bg-primary-500/10'
                    : 'border-surface-800 bg-surface-900/60 hover:border-surface-600'
                }`}
              >
                <p className="text-sm font-semibold text-white">{item.title}</p>
                <p className="mt-0.5 text-xs text-surface-400">
                  <span className={difficultyTone[item.difficulty] || 'text-surface-300'}>{item.difficulty}</span>
                  {item.category ? ` · ${item.category}` : ''}
                  {item.tierCount ? ` · ${item.tierCount} tiers` : ''}
                </p>
              </button>
            ))}
          </div>
        </aside>

        <section className="space-y-4">
          {disabledReason && (
            <div className="flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-900/70 px-4 py-3 text-sm text-surface-200">
              <Lock className="h-4 w-4 text-surface-400" /> {disabledReason}
            </div>
          )}
          <Notice notice={notice} onClose={() => setNotice(null)} />

          {!selectedId && (
            <div className="rounded-xl border border-dashed border-surface-700 p-10 text-center text-surface-400">
              Pick a challenge to start. You write the prompt, the model writes the answer, and the score tells you how close it got.
            </div>
          )}

          {selectedId && !challenge && !notice && (
            <div className="h-40 animate-pulse rounded-xl bg-surface-900" />
          )}

          {challenge && (
            <>
              <div className="rounded-xl border border-surface-800 bg-surface-900/70 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold">{challenge.title}</h2>
                  <span className={`text-xs font-semibold ${difficultyTone[challenge.difficulty] || 'text-surface-300'}`}>{challenge.difficulty}</span>
                  {challenge.category && <span className="text-xs text-surface-400">{challenge.category}</span>}
                </div>
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-surface-300">{challenge.description}</p>
                {challenge.scenario && (
                  <div className="mt-3 rounded-lg border border-surface-800 bg-surface-950/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-surface-500">Scenario</p>
                    <p className="mt-1 whitespace-pre-line text-sm text-surface-300">{challenge.scenario}</p>
                  </div>
                )}
                {challenge.targetOutput && (
                  <div className="mt-3 rounded-lg border border-surface-800 bg-surface-950/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-surface-500">What good output looks like</p>
                    <p className="mt-1 whitespace-pre-line text-sm text-surface-300">{challenge.targetOutput}</p>
                  </div>
                )}
                {Array.isArray(challenge.scoringTiers) && challenge.scoringTiers.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {challenge.scoringTiers.map(tier => (
                      <span key={tier.id} className="rounded-full border border-surface-700 px-2.5 py-0.5 text-xs text-surface-300">
                        {tier.label}: {tier.scorePercent}%
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-surface-800 bg-surface-900/70 p-4">
                <label htmlFor="prompt-text" className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Sparkles className="h-4 w-4 text-primary-300" /> Your prompt
                </label>
                <textarea
                  id="prompt-text"
                  value={promptText}
                  onChange={e => setPromptText(e.target.value)}
                  rows={8}
                  maxLength={12000}
                  placeholder="Tell the model exactly what to produce: audience, format, constraints, what to avoid."
                  className="mt-2 w-full rounded-lg border border-surface-700 bg-surface-950 px-3 py-2 text-sm text-surface-100 focus:border-primary-500 focus:outline-none"
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={evaluate}
                    disabled={evaluating || !!disabledReason}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50"
                  >
                    {evaluating ? 'Evaluating...' : 'Evaluate'}
                  </button>
                  {challenge.hintsCount > 0 && (
                    <button
                      type="button"
                      onClick={revealHint}
                      disabled={hints.length >= challenge.hintsCount}
                      className="inline-flex items-center gap-2 rounded-lg border border-surface-700 px-3 py-2 text-sm text-surface-200 hover:border-surface-500 hover:text-white disabled:opacity-50"
                    >
                      <Lightbulb className="h-4 w-4" /> Hint {Math.min(hints.length + 1, challenge.hintsCount)} of {challenge.hintsCount}
                    </button>
                  )}
                  {attemptsRemaining !== undefined && attemptsRemaining !== null && (
                    <span className="ml-auto text-xs text-surface-400">{attemptsRemaining} evaluations left today</span>
                  )}
                </div>
                {hints.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm text-surface-300">
                    {hints.map((hint, i) => (
                      <li key={i} className="flex gap-2"><Lightbulb className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" /> {hint}</li>
                    ))}
                  </ul>
                )}
              </div>

              {result && (
                <div className={`rounded-xl border p-4 ${result.solved ? 'border-success/40 bg-success/10' : 'border-surface-800 bg-surface-900/70'}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-3xl font-bold tabular-nums">{Math.round(result.score ?? 0)}%</span>
                    <span className={`text-sm font-semibold ${result.solved ? 'text-success' : 'text-surface-300'}`}>
                      {result.solved ? 'Solved' : 'Keep refining'}
                    </span>
                    {result.copyPasteDetected && <span className="text-xs text-warning">Copy of the brief detected</span>}
                    {result.pastePenaltyApplied && <span className="text-xs text-warning">Paste penalty applied</span>}
                  </div>
                  {result.rationale && <p className="mt-3 text-sm leading-relaxed text-surface-300">{result.rationale}</p>}
                  {Array.isArray(result.criteria) && result.criteria.length > 0 && (
                    <ul className="mt-3 space-y-1 text-sm">
                      {result.criteria.map((item, i) => {
                        const pass = passOf(item)
                        return (
                          <li key={i} className="flex items-start gap-2 text-surface-300">
                            {pass === true && <Check className="mt-0.5 h-4 w-4 text-success" />}
                            {pass === false && <X className="mt-0.5 h-4 w-4 text-error" />}
                            {pass === null && <span className="mt-2 h-1.5 w-1.5 rounded-full bg-surface-500" />}
                            <span>{labelOf(item)}{typeof item === 'object' && item?.detail ? `: ${item.detail}` : ''}</span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  {Array.isArray(result.tierResults) && result.tierResults.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {result.tierResults.map(tier => (
                        <span key={tier.tierId} className={`rounded-full border px-2.5 py-0.5 text-xs ${tier.pass ? 'border-success/40 text-success' : 'border-surface-700 text-surface-400'}`}>
                          {tier.label} {tier.pass ? 'reached' : 'missed'}
                        </span>
                      ))}
                    </div>
                  )}
                  {result.modelOutput && (
                    <div className="mt-3 rounded-lg border border-surface-800">
                      <button type="button" onClick={() => setShowOutput(v => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-surface-300 hover:text-white">
                        What the model produced
                        {showOutput ? <ChevronUp className="ml-auto h-4 w-4" /> : <ChevronDown className="ml-auto h-4 w-4" />}
                      </button>
                      {showOutput && (
                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-surface-800 p-3 text-xs text-surface-300">{result.modelOutput}</pre>
                      )}
                    </div>
                  )}
                </div>
              )}

              {history?.summary && history.summary.totalAttempts > 0 && (
                <div className="rounded-xl border border-surface-800 bg-surface-900/70 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <History className="h-4 w-4 text-surface-400" /> Your attempts
                    <span className="ml-auto text-xs font-normal text-surface-400">
                      Best {history.summary.bestScore ?? 0}% · {history.summary.totalAttempts} tries
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-surface-400">
                    {(history.attempts || []).slice(0, 8).map(attempt => (
                      <li key={attempt.id} className="flex items-center gap-2">
                        <span className={`font-semibold tabular-nums ${attempt.solved ? 'text-success' : 'text-surface-300'}`}>{Math.round(attempt.score ?? 0)}%</span>
                        <span>{new Date(attempt.created_at).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  )
}
