import { useCallback, useEffect, useRef, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { io } from 'socket.io-client'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, AlertCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { config } from '../config/env'
import { withAuth } from '../components/withAuth'
import Button from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import PromptBattleHistory from '../components/PromptBattleHistory'

const DURATION_LABELS = {
  5: { difficulty: 'Easy', hint: '5 min · Easy problem' },
  10: { difficulty: 'Medium', hint: '10 min · Medium problem' },
  15: { difficulty: 'Hard', hint: '15 min · Hard problem' }
}

function PromptBattlePage() {
  const router = useRouter()
  const { token, user, loading: authLoading } = useAuth()
  const socketRef = useRef(null)
  const roomCodeRef = useRef('')
  const [durationMinutes, setDurationMinutes] = useState(5)
  const [roomCode, setRoomCode] = useState('')
  const [room, setRoom] = useState(null)
  const [phase, setPhase] = useState('setup')
  const phaseRef = useRef('setup')
  const [endsAt, setEndsAt] = useState(null)
  const [timeLeftSec, setTimeLeftSec] = useState(null)
  const [promptText, setPromptText] = useState('')
  const promptTextRef = useRef('')
  const [submitCount, setSubmitCount] = useState(0)
  const [results, setResults] = useState(null)
  const [banner, setBanner] = useState('')
  const [busy, setBusy] = useState(false)
  const [queueWaitingCount, setQueueWaitingCount] = useState(0)
  const [matchedDifficulty, setMatchedDifficulty] = useState(null)
  const [availableModels, setAvailableModels] = useState([])
  const [selectedModelId, setSelectedModelId] = useState('')
  const [previewStatus, setPreviewStatus] = useState('idle')
  const [previewEnabled, setPreviewEnabled] = useState(true)
  const [previewData, setPreviewData] = useState(null)
  const [previewError, setPreviewError] = useState('')
  // Anti-cheat (mirrors solo practice "hard-block paste" parity).
  const [pasteDetected, setPasteDetected] = useState(false)
  const [tabSwitchCount, setTabSwitchCount] = useState(0)

  const meId = user?.id
  const rejoinHandledRef = useRef('')

  useEffect(() => {
    roomCodeRef.current = roomCode
  }, [roomCode])

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const leaveQueue = useCallback(() => {
    const s = socketRef.current
    if (!s?.connected) return
    s.emit('pb-leave-queue', {}, () => {})
  }, [])

  const attachSocket = useCallback(() => {
    if (!token) return null
    const authPayload = { token }
    const authKey = JSON.stringify(authPayload)
    if (socketRef.current) {
      if (socketRef.current.__authKey === authKey) return socketRef.current
      socketRef.current.removeAllListeners()
      socketRef.current.disconnect()
      socketRef.current = null
    }
    const s = io(config.backend_url, {
      transports: ['websocket', 'polling'],
      timeout: 20000,
      auth: authPayload
    })
    s.__authKey = authKey
    socketRef.current = s

    s.on('connect', () => {
      const code = roomCodeRef.current
      if (!code || !['playing', 'scoring'].includes(phaseRef.current)) return
      // Socket.IO rooms are lost on reconnect. Restore membership without
      // clearing the draft, submission count, or sticky anti-cheat state.
      s.emit('pb-rejoin-running-room', { roomCode: code }, (res) => {
        if (!res?.ok) {
          setBanner(res?.error || 'Could not reconnect to this battle. Try refreshing.')
          return
        }
        if (res.room) {
          setRoom(res.room)
          if (typeof res.room.previewEnabled === 'boolean') setPreviewEnabled(res.room.previewEnabled)
          const me = res.room.players?.find((p) => String(p.userId) === String(meId))
          if (typeof me?.submitCount === 'number') setSubmitCount(me.submitCount)
          setPasteDetected(prev => prev || !!me?.pasteDetected)
          setTabSwitchCount(prev => Math.max(prev, me?.tabSwitchCount || 0))
        }
        if (typeof res.endsAt === 'number') setEndsAt(res.endsAt)
        if (res.phase === 'results' && res.results) {
          setResults(res.results)
          setPhase('results')
        } else {
          setPhase(res.phase === 'scoring' ? 'scoring' : 'playing')
        }
        setBusy(false)
        setBanner('')
      })
    })

    s.on('disconnect', () => {
      setBusy(false)
      if (['playing', 'scoring'].includes(phaseRef.current)) {
        setBanner('Connection lost. Reconnecting. Your draft is still here.')
      }
    })

    s.on('connect_error', () => {
      setBusy(false)
      setBanner('Could not connect. Check your connection and try again.')
    })

    s.on('pb-queue-update', ({ waitingCount }) => {
      if (typeof waitingCount === 'number') setQueueWaitingCount(waitingCount)
    })

    s.on('pb-config', ({ availableModels: models, defaultModelId, previewEnabled: canPreview }) => {
      if (typeof canPreview === 'boolean') setPreviewEnabled(canPreview)
      const safeModels = Array.isArray(models) ? models : []
      setAvailableModels(safeModels)
      if (!safeModels.length) {
        setSelectedModelId('')
        return
      }
      setSelectedModelId((curr) => {
        if (curr && safeModels.some((m) => m.id === curr)) return curr
        if (defaultModelId && safeModels.some((m) => m.id === defaultModelId)) return defaultModelId
        return safeModels[0].id
      })
    })

    s.on('pb-match-found', (payload) => {
      const r = payload?.room
      if (r) setRoom(r)
      if (typeof r?.previewEnabled === 'boolean') setPreviewEnabled(r.previewEnabled)
      if (payload?.roomCode) setRoomCode(payload.roomCode)
      if (payload?.endsAt) setEndsAt(payload.endsAt)
      if (payload?.difficulty) setMatchedDifficulty(payload.difficulty)
      if (payload?.modelId) setSelectedModelId(payload.modelId)
      setPhase('playing')
      setSubmitCount(0)
      setPromptText('')
      promptTextRef.current = ''
      setResults(null)
      setPreviewStatus('idle')
      setPreviewData(null)
      setPreviewError('')
      setPasteDetected(false)
      setTabSwitchCount(0)
      setBanner('')
    })

    s.on('pb-room-update', (r) => {
      setRoom(r)
      if (r?.modelId) setSelectedModelId(r.modelId)
      const me = r?.players?.find((p) => String(p.userId) === String(meId))
      if (typeof me?.submitCount === 'number') setSubmitCount(me.submitCount)
      setBanner('')
    })

    s.on('pb-scoring', ({ message }) => {
      setPhase('scoring')
      setPreviewStatus('idle')
      setBanner(message || 'Scoring…')
    })

    s.on('pb-results', (payload) => {
      setResults(payload)
      setPhase('results')
      setBanner('')
    })

    s.on('pb-preview-status', (payload) => {
      if (payload?.roomCode && payload.roomCode !== roomCodeRef.current) return
      if (payload?.status === 'running') {
        setPreviewStatus('running')
        setPreviewError('')
      }
    })

    s.on('pb-preview-ready', (payload) => {
      if (payload?.roomCode && payload.roomCode !== roomCodeRef.current) return
      setPreviewStatus('ready')
      setPreviewError('')
      setPreviewData(payload)
    })

    s.on('pb-preview-error', (payload) => {
      if (payload?.roomCode && payload.roomCode !== roomCodeRef.current) return
      setPreviewStatus('error')
      setPreviewError(payload?.message || 'Preview failed')
    })

    s.on('pb-error', ({ message }) => {
      setBanner(message || 'Error')
    })

    return s
  }, [token, meId])

  useEffect(() => {
    if (!token) return
    attachSocket()
    return () => {
      leaveQueue()
      if (socketRef.current) {
        socketRef.current.removeAllListeners()
        socketRef.current.disconnect()
        socketRef.current = null
      }
    }
  }, [token, attachSocket, leaveQueue])

  useEffect(() => {
    if (!router.isReady || !token || !meId) return
    const raw = router.query.room ?? router.query.roomCode
    const code = typeof raw === 'string'
      ? raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
      : ''
    if (!code) return
    if (rejoinHandledRef.current === code) return
    rejoinHandledRef.current = code

    const tryRejoin = () => {
      const s = socketRef.current
      if (!s) return
      const emitRejoin = () => {
        s.emit('pb-rejoin-running-room', { roomCode: code }, (res) => {
          if (!res?.ok) {
            rejoinHandledRef.current = ''
            setBanner(res?.error || 'Could not rejoin this battle')
            setPhase('setup')
            return
          }
          setRoomCode(res.roomCode || code)
          if (res.room) setRoom(res.room)
          if (typeof res.room?.previewEnabled === 'boolean') setPreviewEnabled(res.room.previewEnabled)
          if (typeof res.endsAt === 'number') setEndsAt(res.endsAt)
          if (res.difficulty) setMatchedDifficulty(res.difficulty)
          if (res.modelId) setSelectedModelId(res.modelId)
          setPhase(res.phase === 'results' ? 'results' : res.phase === 'scoring' ? 'scoring' : 'playing')
          const meRoomPlayer = res.room?.players?.find((p) => String(p.userId) === String(meId))
          setSubmitCount(meRoomPlayer?.submitCount || 0)
          setPromptText('')
          promptTextRef.current = ''
          setResults(res.results || null)
          setPreviewStatus('idle')
          setPreviewData(null)
          setPreviewError('')
          // Seed anti-cheat flags from the server's sticky state so a mid-battle
          // reconnect doesn't hide a flag the server still enforces (score is capped server-side).
          setPasteDetected(!!meRoomPlayer?.pasteDetected)
          setTabSwitchCount(meRoomPlayer?.tabSwitchCount || 0)
          setBanner('')
        })
      }
      if (s.connected) emitRejoin()
      else s.once('connect', emitRejoin)
    }

    attachSocket()
    tryRejoin()
  }, [router.isReady, router.query.room, router.query.roomCode, token, meId, attachSocket])

  useEffect(() => {
    if (!endsAt || phase !== 'playing') {
      setTimeLeftSec(null)
      return
    }
    const tick = () => {
      const sec = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      setTimeLeftSec(sec)
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [endsAt, phase])

  // Tab-switch telemetry (advisory only; the count is reported to the server but does NOT
  // affect score: the paste hard-block is the scoring-relevant anti-cheat signal).
  // Uses promptTextRef (not promptText state) so the listener isn't re-registered on every keystroke.
  // Debounces 300ms so blur + visibilitychange from the same switch only count once.
  useEffect(() => {
    if (phase !== 'playing') return
    let lastFocusLostTime = 0
    const handleFocusLost = () => {
      const now = Date.now()
      if (now - lastFocusLostTime < 300) return
      lastFocusLostTime = now
      if (promptTextRef.current.trim().length > 0) {
        setTabSwitchCount((prev) => prev + 1)
      }
    }
    const handleVisibilityChange = () => {
      if (document.hidden) handleFocusLost()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('blur', handleFocusLost)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('blur', handleFocusLost)
    }
  }, [phase])

  const findMatch = () => {
    const s = attachSocket()
    if (!s?.connected) {
      setBanner('Connecting…')
      s.once('connect', () => findMatch())
      return
    }
    setBusy(true)
    setBanner('')
    s.emit('pb-join-queue', { durationMinutes, modelId: selectedModelId }, (res) => {
      setBusy(false)
      if (!res?.ok) {
        setBanner(res?.error || 'Could not join queue')
        return
      }
      setPhase('searching')
      if (typeof res.waitingCount === 'number') setQueueWaitingCount(res.waitingCount)
      if (res.modelId) setSelectedModelId(res.modelId)
    })
  }

  const cancelSearch = () => {
    leaveQueue()
    setPhase('setup')
    setQueueWaitingCount(0)
    setBanner('')
  }

  const submitPrompt = () => {
    const s = socketRef.current
    if (!s?.connected) {
      setBanner('Reconnecting. Wait for the connection before submitting.')
      return
    }
    setBusy(true)
    s.emit('pb-submit', { prompt: promptText, pasteDetected, tabSwitchCount }, (res) => {
      setBusy(false)
      if (!res?.ok) {
        setBanner(res?.error || 'Submit failed')
        return
      }
      const canPreview = res.previewEnabled ?? res.room?.previewEnabled ?? previewEnabled
      setPreviewEnabled(canPreview)
      setPreviewStatus(canPreview ? 'running' : 'idle')
      setPreviewError('')
      setRoom(res.room)
      const me = res.room?.players?.find((p) => String(p.userId) === String(meId))
      if (typeof me?.submitCount === 'number') setSubmitCount(me.submitCount)
    })
  }

  const opponent =
    room?.players?.find((p) => String(p.userId) !== String(meId)) || null

  if (authLoading) {
    return (
      <div className="min-h-screen bg-surface-950 text-surface-100 flex items-center justify-center">
        Loading…
      </div>
    )
  }

  return (
    <>
      <Head>
        <title>Prompt Battle (Beta) | CodeArena</title>
      </Head>
      {(phase === 'setup' || phase === 'searching') && <div className="min-h-screen bg-surface-950 text-white">
        <div className="min-h-screen flex flex-col">
          <header className="px-6 py-6">
            <div className="flex items-center gap-4">
              {phase === 'searching' ? (
                <button onClick={cancelSearch} className="flex items-center gap-2 text-surface-400 hover:text-white transition-colors group">
                  <ArrowLeft className="h-5 w-5 group-hover:-translate-x-1 transition-transform" />
                  <span className="font-medium">Back</span>
                </button>
              ) : (
                <Link href="/modes" className="flex items-center gap-2 text-surface-400 hover:text-white transition-colors group">
                  <ArrowLeft className="h-5 w-5 group-hover:-translate-x-1 transition-transform" />
                  <span className="font-medium">Back</span>
                </Link>
              )}
            </div>
          </header>

          <div className="flex-1 flex items-center justify-center px-6">
            {(phase === 'setup' || phase === 'searching') && (
              <motion.div className="max-w-md w-full" key={`phase-${phase}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <Card variant="glass" className="p-8">
                  {phase === 'setup' && (
                    <>
                      <div className="text-center mb-8">
                        <h1 className="text-2xl font-bold mb-2 text-white">Prompt Battle</h1>
                        <p className="text-surface-400 text-sm">Engineer the better prompt</p>
                      </div>

                      <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-medium text-surface-300 mb-3">AI Model</label>
                      {!availableModels.length ? (
                        <p className="text-xs text-warning-light">
                          No AI models are configured on the server.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {availableModels.map((model) => (
                            <button
                              key={model.id}
                              type="button"
                              onClick={() => setSelectedModelId(model.id)}
                              className={`rounded-lg px-4 py-2 text-sm border transition-all ${
                                selectedModelId === model.id
                                  ? 'border-primary-500 bg-primary-500/10 text-white'
                                  : 'border-surface-600 hover:border-surface-500 text-surface-400'
                              }`}
                            >
                              <span className="block font-medium">{model.label}</span>
                              <span className="block text-xs text-surface-500 mt-0.5">
                                {model.provider}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-surface-300 mb-3">Time Limit & Difficulty</label>
                      <div className="flex flex-wrap gap-2">
                        {[5, 10, 15].map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setDurationMinutes(m)}
                            className={`rounded-lg px-4 py-2 text-sm border transition-all ${
                              durationMinutes === m
                                ? 'border-primary-500 bg-primary-500/10 text-white'
                                : 'border-surface-600 hover:border-surface-500 text-surface-400'
                            }`}
                          >
                            <span className="block font-medium">{m} min</span>
                            <span className="block text-xs text-surface-500 mt-0.5">
                              {DURATION_LABELS[m].difficulty}
                            </span>
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-surface-500 mt-3 text-center">{DURATION_LABELS[durationMinutes].hint}</p>
                    </div>

                    {banner && <p className="text-warning-light text-sm text-center">{banner}</p>}

                    <Button
                      variant="primary"
                      fullWidth
                      onClick={findMatch}
                      disabled={busy || !selectedModelId}
                      loading={busy}
                    >
                      {busy ? 'Connecting…' : 'Find Match'}
                    </Button>

                      <div className="text-center">
                        <p className="text-surface-500 text-sm mb-3">or</p>
                        <Link href="/modes" className="text-primary-400 hover:text-primary-300 text-sm font-medium">
                          Browse other modes
                        </Link>
                      </div>
                    </div>
                    </>
                  )}

                  {phase === 'searching' && (
                    <div className="text-center">
                      <div className="mb-6">
                        <div className="w-10 h-10 border-2 border-surface-600 border-t-primary-400 rounded-full animate-spin mx-auto mb-4"></div>
                        <h2 className="text-xl font-semibold mb-2 text-white">Searching</h2>
                        <p className="text-surface-400 text-sm">{DURATION_LABELS[durationMinutes].hint}</p>
                      </div>
                      {selectedModelId && (
                        <p className="text-xs text-surface-500 mb-4">Model: {modelLabelById(selectedModelId, availableModels)}</p>
                      )}
                      {queueWaitingCount > 0 && (
                        <p className="text-xs text-surface-400 mb-4">Players in queue: {queueWaitingCount}</p>
                      )}
                      <Button variant="secondary" onClick={cancelSearch} disabled={busy} fullWidth>
                        Cancel Search
                      </Button>
                    </div>
                  )}
                </Card>
              </motion.div>
            )}
          </div>
        </div>
      </div>}

      {(phase === 'playing' || phase === 'scoring' || phase === 'results') && room && (
        <div className="min-h-screen bg-surface-950 text-white p-4 md:p-8">
          <div className="mx-auto max-w-4xl">
            <div className="flex items-center gap-4 mb-6">
              <Link href="/modes" className="flex items-center gap-2 text-surface-400 hover:text-white transition-colors group">
                <ArrowLeft className="h-5 w-5 group-hover:-translate-x-1 transition-transform" />
                <span className="font-medium">Back</span>
              </Link>
              <h1 className="text-2xl font-bold text-white">Prompt Battle</h1>
            </div>
            {banner && <p role="status" className="text-warning-light text-sm mb-4">{banner}</p>}
            <Card className="p-6 space-y-3 bg-surface-900/80 border-surface-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-surface-400 text-sm">Opponent</span>
                <span className="font-medium text-white">{opponent?.username || '-'}</span>
              </div>
              {matchedDifficulty && (
                <p className="text-xs text-surface-500">
                  Problem difficulty: <span className="text-surface-400">{matchedDifficulty}</span>
                </p>
              )}
              {room?.modelId && (
                <p className="text-xs text-surface-500">
                  AI model: <span className="text-surface-400">{modelLabelById(room.modelId, availableModels)}</span>
                </p>
              )}
              {typeof opponent?.submitCount === 'number' && opponent.submitCount > 0 && (
                <p className="text-xs text-surface-500">
                  Opponent submissions: <span className="text-surface-400">{opponent.submitCount}</span>
                </p>
              )}
              <p className="text-xs text-surface-600 font-mono">Session {roomCode}</p>
            </Card>

            {phase === 'playing' && room?.problem && (
              <Card className="p-6 space-y-4 bg-surface-900/80 border-surface-700 mt-6">
              <div className="flex justify-between items-center">
                <h2 className="font-semibold">{room.problem.title}</h2>
                <span className="font-mono text-lg text-warning-light">
                  {timeLeftSec != null ? formatClock(timeLeftSec) : '-'}
                </span>
              </div>
              <div className="text-sm space-y-2 text-surface-300">
                <p className="whitespace-pre-wrap">{room.problem.scenario}</p>
                <p className="text-surface-400">{room.problem.description}</p>
                <p className="text-surface-500 text-xs">Target: {room.problem.targetOutput}</p>
              </div>
              <AnimatePresence>
                {pasteDetected && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="px-4 py-2 bg-amber-900/40 border border-amber-700/50 rounded-lg text-amber-300 text-xs flex items-center gap-2"
                  >
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>Paste detected. Your submission will be flagged.</span>
                  </motion.div>
                )}
              </AnimatePresence>
              {tabSwitchCount > 0 && (
                <div className="px-4 py-2 bg-amber-900/30 border border-amber-700/40 rounded-lg text-amber-300/90 text-xs flex items-center gap-2">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>Heads up: tab switches are tracked during a battle ({tabSwitchCount}).</span>
                </div>
              )}
              <textarea
                value={promptText}
                onChange={(e) => { setPromptText(e.target.value); promptTextRef.current = e.target.value }}
                onPaste={(e) => { e.preventDefault(); if (!pasteDetected) setPasteDetected(true) }}
                onDrop={(e) => { e.preventDefault(); if (!pasteDetected) setPasteDetected(true) }}
                onDragOver={(e) => e.preventDefault()}
                rows={10}
                placeholder="Write the prompt you want to send to the model…  (COPYING AND PASTING IS BLOCKED)"
                className="w-full rounded-lg bg-surface-800 border border-surface-600 px-3 py-2 text-sm font-mono"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-surface-500 font-mono">
                  {promptText.length} chars · ~{estimateTokens(promptText)} tokens (est.)
                  {submitCount > 0 && (
                    <span className="block mt-1 text-surface-400">
                      Your submissions this round: {submitCount}
                    </span>
                  )}
                </span>
                <Button onClick={submitPrompt} disabled={busy}>
                  {submitCount > 0 ? 'Submit again' : 'Submit prompt'}
                </Button>
              </div>
              </Card>
            )}

            {phase === 'playing' && (
              <Card className="p-6 space-y-3 bg-surface-900/80 border-surface-700 mt-6">
                <h3 className="font-semibold">Your latest model output</h3>
                {!previewEnabled && (
                  <p className="text-sm text-surface-400">Prompts are scored when the round ends. Live previews are disabled to keep battles free.</p>
                )}
                {previewEnabled && previewStatus === 'idle' && (
                  <p className="text-sm text-surface-400">
                    Submit a prompt to preview what the model returns.
                  </p>
                )}
                {previewStatus === 'running' && (
                  <p className="text-sm text-surface-300 animate-pulse">Running preview…</p>
                )}
                {previewStatus === 'error' && (
                  <p className="text-sm text-error-light">{previewError || 'Preview failed'}</p>
                )}
                {previewStatus === 'ready' && previewData && (
                  <>
                    <div className="text-xs text-surface-500 font-mono flex flex-wrap gap-3">
                      {typeof previewData.scorePreview === 'number' && (
                        <span>preview score {previewData.scorePreview}%</span>
                      )}
                      {previewData.tokenUsage && (
                        <>
                          <span>{previewData.tokenUsage.promptTokens} prompt tokens</span>
                          <span>{previewData.tokenUsage.outputTokens} output tokens</span>
                          <span>{previewData.tokenUsage.totalTokens} total tokens</span>
                        </>
                      )}
                    </div>
                    <pre className="mt-1 whitespace-pre-wrap text-surface-300 text-xs max-h-72 overflow-y-auto bg-surface-800/70 border border-surface-700 rounded-lg p-3">
                      {previewData.modelOutput}
                    </pre>
                  </>
                )}
              </Card>
            )}

            {phase === 'scoring' && (
              <p className="text-surface-300 animate-pulse mt-6">Running model and scoring…</p>
            )}

            {phase === 'results' && results && (
              <Card className="p-6 space-y-4 bg-surface-900/80 border-surface-700 mt-6">
                <h2 className="text-xl font-bold">Results</h2>
                {results.tie && <p className="text-warning-light">Tie: same adjusted score.</p>}
                {!results.tie && results.winnerUserId != null && (
                  <p className="text-success-light">
                    Winner:{' '}
                    <strong>
                      {results.results.find(
                        (r) => String(r.userId) === String(results.winnerUserId)
                      )?.username || 'Player'}
                    </strong>
                  </p>
                )}
                <ul className="space-y-3">
                  {results.results.map((r) => (
                    <li
                      key={r.userId}
                      className={`rounded-lg border p-3 ${
                        String(r.userId) === String(results.winnerUserId)
                          ? 'border-success-500/50 bg-success-500/10'
                          : 'border-surface-600 bg-surface-800/50'
                      }`}
                    >
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">{r.username}</span>
                        <div className="text-right">
                          <span className="font-mono text-accent-light block">
                            {r.adjustedScorePercent != null ? r.adjustedScorePercent : r.scorePercent}% adjusted
                          </span>
                          {r.adjustedScorePercent != null && r.adjustedScorePercent !== r.scorePercent && (
                            <span className="text-xs text-surface-500 font-mono">
                              {r.scorePercent}% raw
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-surface-500 font-mono">
                        <span>{r.submitCount ?? 0} submissions</span>
                        <span>{r.promptCharCount ?? 0} chars</span>
                        {r.tokenUsage && (
                          <>
                            <span>{r.tokenUsage.promptTokens} prompt tokens</span>
                            <span>{r.tokenUsage.outputTokens} output tokens</span>
                            <span>{r.tokenUsage.totalTokens} total tokens</span>
                          </>
                        )}
                      </div>
                      {r.pasteDetected && (
                        <p className="mt-2 text-xs text-amber-400 flex items-center gap-1.5">
                          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                          Paste detected: score capped for this submission.
                        </p>
                      )}
                      <details className="mt-2 text-xs text-surface-400">
                        <summary className="cursor-pointer">Model output</summary>
                        <pre className="mt-2 whitespace-pre-wrap text-surface-300 max-h-48 overflow-y-auto">
                          {r.modelOutput}
                        </pre>
                      </details>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="secondary"
                  onClick={() => {
                    leaveQueue()
                    setPhase('setup')
                    setRoom(null)
                    setRoomCode('')
                    setResults(null)
                    setEndsAt(null)
                    setMatchedDifficulty(null)
                    setQueueWaitingCount(0)
                    setSubmitCount(0)
                    setPreviewStatus('idle')
                    setPreviewData(null)
                    setPreviewError('')
                    setPasteDetected(false)
                    setTabSwitchCount(0)
                    setBanner('')
                  }}
                >
                  Find another match
                </Button>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function formatClock(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Rough client-side token estimate (~4 chars per token for English text) */
function estimateTokens(text) {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

function modelLabelById(modelId, models = []) {
  return models.find((m) => m.id === modelId)?.label || modelId
}

export default withAuth(PromptBattlePage)
