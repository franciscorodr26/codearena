import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useRouter } from 'next/router'
import io from 'socket.io-client'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, X } from 'lucide-react'
import { config } from '../config/env'
import PlayWhileYouWait from '../components/PlayWhileYouWait'
import { ImprovedMatchFoundNotification } from '../components/ImprovedMatchFoundNotification'
import { useAuth } from './AuthContext'
import { trackBeginMatchmaking, trackEndMatchmaking } from '../utils/analytics'
import logger from '../utils/logger'
import { MatchmakingQueueDock } from '../components/MatchmakingQueueDock'

const MatchmakingQueueContext = createContext(null)

const SEARCH_TIMEOUT = 60000

export function MatchmakingQueueProvider({ children }) {
  const router = useRouter()
  const { user, token } = useAuth()

  const [isSearching, setIsSearching] = useState(false)
  const [queueStatus, setQueueStatus] = useState(null)
  const [playerId, setPlayerId] = useState(null)
  const [error, setError] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('disconnected')
  const [waitTime, setWaitTime] = useState(0)
  const [showPlayWhileWait, setShowPlayWhileWait] = useState(false)
  const [emptyQueueTimer, setEmptyQueueTimer] = useState(null)
  const [matchFound, setMatchFound] = useState(false)
  const [matchBattleId, setMatchBattleId] = useState('')
  const [matchPlayerId, setMatchPlayerId] = useState('')
  const [matchOpponentName, setMatchOpponentName] = useState('')
  const [matchYourName, setMatchYourName] = useState('')
  const [matchUrl, setMatchUrl] = useState('')
  const [opponentDeclinedNotice, setOpponentDeclinedNotice] = useState(null)
  const [alreadyInQueue, setAlreadyInQueue] = useState(false)
  const [existingPlayerId, setExistingPlayerId] = useState(null)
  const [activeSearchMeta, setActiveSearchMeta] = useState(null)

  const socketRef = useRef(null)
  const playerIdRef = useRef(null)
  const playerNameRef = useRef('')
  const waitTimeIntervalRef = useRef(null)
  const timeoutRef = useRef(null)
  const selectedLanguageRef = useRef('python')
  const isSearchingRef = useRef(false)
  const emptyQueueTimerRef = useRef(null)
  const quickMatchPrefsRef = useRef({
    battleType: 'coding',
    promptDurationMinutes: 5,
    promptModelId: null
  })
  const joinSnapshotRef = useRef(null)
  const timeoutHandledRef = useRef(false)
  const waitTimeRef = useRef(0)
  const userRef = useRef(user)

  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
    waitTimeRef.current = waitTime
  }, [waitTime])

  useEffect(() => {
    isSearchingRef.current = isSearching
  }, [isSearching])

  const cleanupSocket = useCallback((socket) => {
    if (!socket) return
    socket.off('connect')
    socket.off('disconnect')
    socket.off('connect_error')
    socket.off('error')
    socket.off('match-found')
    socket.off('opponent-declined-match')
    socket.off('queue-status-update')
    socket.off('queue-position-update')
    socket.off('matchmaking-timeout')
    socket.disconnect()
  }, [])

  const stopWaitTimer = useCallback(() => {
    if (waitTimeIntervalRef.current) {
      clearInterval(waitTimeIntervalRef.current)
      waitTimeIntervalRef.current = null
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const clearEmptyQueueTimer = useCallback(() => {
    if (emptyQueueTimerRef.current) {
      clearTimeout(emptyQueueTimerRef.current)
      emptyQueueTimerRef.current = null
    }
    setEmptyQueueTimer(null)
  }, [])

  // L4 fix: ensure the empty-queue timer is cleared if the provider unmounts
  // mid-search (e.g. user navigates away). cancelSearchInternal handles the
  // cancel path; this useEffect covers the silent-unmount path.
  useEffect(() => {
    return () => {
      if (emptyQueueTimerRef.current) {
        clearTimeout(emptyQueueTimerRef.current)
        emptyQueueTimerRef.current = null
      }
    }
  }, [])

  const cancelSearchInternal = useCallback(
    ({ trackOutcome = true, clearError = true } = {}) => {
      if (trackOutcome && isSearchingRef.current) {
        trackEndMatchmaking(
          { outcome: 'CANCELLED', waitTimeSeconds: waitTimeRef.current },
          userRef.current
        )
      }
      clearEmptyQueueTimer()
      setIsSearching(false)
      setQueueStatus(null)
      setShowPlayWhileWait(false)
      stopWaitTimer()
      if (playerIdRef.current) {
        fetch(`${config.backend_url}/api/matchmaking/leave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId: playerIdRef.current }),
          signal: AbortSignal.timeout(5000)
        }).catch((err) => logger.error('Error leaving queue:', err))
      }
      setPlayerId(null)
      playerIdRef.current = null
      setWaitTime(0)
      waitTimeRef.current = 0
      if (socketRef.current) {
        cleanupSocket(socketRef.current)
        socketRef.current = null
      }
      setConnectionStatus('disconnected')
      if (clearError) setError('')
      setActiveSearchMeta(null)
      joinSnapshotRef.current = null
    },
    [stopWaitTimer, clearEmptyQueueTimer, cleanupSocket]
  )

  useEffect(() => {
    if (!token && isSearchingRef.current) {
      cancelSearchInternal({ trackOutcome: false, clearError: true })
    }
  }, [token, cancelSearchInternal])

  const handleSearchTimeout = useCallback(() => {
    if (timeoutHandledRef.current) return
    timeoutHandledRef.current = true

    trackEndMatchmaking({ outcome: 'TIMEOUT', waitTimeSeconds: 60 }, userRef.current)
    setIsSearching(false)
    setError('Search timed out after 60 seconds. Try again or practice solo!')
    setQueueStatus(null)
    setShowPlayWhileWait(false)
    stopWaitTimer()
    clearEmptyQueueTimer()
    if (playerIdRef.current) {
      fetch(`${config.backend_url}/api/matchmaking/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: playerIdRef.current })
      }).catch((err) => logger.error('Leave queue error:', err))
    }
    if (socketRef.current) {
      cleanupSocket(socketRef.current)
      socketRef.current = null
    }
    setConnectionStatus('disconnected')
    setPlayerId(null)
    playerIdRef.current = null
    waitTimeRef.current = 0
    setActiveSearchMeta(null)
    joinSnapshotRef.current = null
  }, [stopWaitTimer, clearEmptyQueueTimer, cleanupSocket])

  const startWaitTimer = useCallback(() => {
    if (waitTimeIntervalRef.current) clearInterval(waitTimeIntervalRef.current)
    timeoutHandledRef.current = false
    const startTime = Date.now()
    setWaitTime(0)
    waitTimeRef.current = 0
    waitTimeIntervalRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      waitTimeRef.current = elapsed
      setWaitTime(elapsed)
    }, 1000)
    timeoutRef.current = setTimeout(() => {
      if (isSearchingRef.current) handleSearchTimeout()
    }, SEARCH_TIMEOUT)
  }, [handleSearchTimeout])

  const createSocketConnection = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (socketRef.current) cleanupSocket(socketRef.current)
      const socket = io(config.backend_url, {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        reconnection: false,
        forceNew: true,
        auth: { token }
      })
      const connectionTimeout = setTimeout(() => {
        if (!socket.connected) {
          socket.disconnect()
          reject(new Error('Connection timeout'))
        }
      }, 10000)

      socket.on('connect', () => {
        clearTimeout(connectionTimeout)
        setConnectionStatus('connected')
        setError('')
        resolve(socket)
      })
      socket.on('disconnect', () => setConnectionStatus('disconnected'))
      socket.on('connect_error', (err) => {
        clearTimeout(connectionTimeout)
        setConnectionStatus('error')
        setError(`Connection failed: ${err.message}`)
        reject(err)
      })
      socket.on('error', (socketErr) => setError('Socket error: ' + socketErr))

      socket.on('match-found', (payload) => {
        const {
          battleType = 'coding',
          battleId,
          playerId: foundPlayerId,
          roomCode,
          opponent,
          yourName,
          sameLanguage,
          skipLanguageSelection,
          language,
          matchedLanguage,
          isAgainstBot,
          botDifficulty
        } = payload || {}

        trackEndMatchmaking(
          {
            outcome: isAgainstBot ? 'BOT_MATCH' : 'MATCH_FOUND',
            waitTimeSeconds: waitTimeRef.current,
            battleId: battleId || roomCode,
            opponentName: opponent
          },
          userRef.current
        )

        if (battleType === 'prompt' && roomCode) {
          clearEmptyQueueTimer()
          setIsSearching(false)
          setShowPlayWhileWait(false)
          stopWaitTimer()
          const opponentNameFinal = opponent || 'Opponent'
          const yourNameParam =
            yourName || playerNameRef.current || joinSnapshotRef.current?.playerName || 'Player'
          const url = `/prompt-battle?room=${encodeURIComponent(roomCode)}`
          setMatchBattleId('')
          setMatchPlayerId(foundPlayerId || playerIdRef.current || '')
          setMatchOpponentName(opponentNameFinal)
          setMatchYourName(yourNameParam)
          setMatchUrl(url)
          setMatchFound(true)
          return
        }

        if (battleId && foundPlayerId) {
          socket.emit('join-battle-room', { battleId, playerId: foundPlayerId })
        }
        clearEmptyQueueTimer()
        setIsSearching(false)
        setShowPlayWhileWait(false)
        stopWaitTimer()
        const opponentNameFinal = opponent || 'Opponent'
        const yourNameParam =
          yourName || playerNameRef.current || joinSnapshotRef.current?.playerName || 'Player'
        let url = `/battle?id=${battleId}&playerId=${foundPlayerId}&opponent=${encodeURIComponent(opponentNameFinal)}&yourName=${encodeURIComponent(yourNameParam)}&matchmaking=true`
        if (battleType !== 'prompt') {
          const actualLanguage =
            matchedLanguage ||
            language ||
            selectedLanguageRef.current ||
            joinSnapshotRef.current?.language ||
            'python'
          url += `&language=${actualLanguage}`
          if (sameLanguage === true || skipLanguageSelection === true) {
            url += '&skipLanguageSelection=true'
          }
        }
        if (isAgainstBot) {
          url += '&isAgainstBot=true'
          if (botDifficulty) url += `&botDifficulty=${botDifficulty}`
        }
        setMatchBattleId(battleId)
        setMatchPlayerId(foundPlayerId)
        setMatchOpponentName(opponentNameFinal)
        setMatchYourName(yourNameParam)
        setMatchUrl(url)
        setMatchFound(true)
      })

      socket.on('opponent-declined-match', (data) => {
        setMatchFound(false)
        setMatchOpponentName('')
        setMatchBattleId('')
        setMatchPlayerId('')
        setMatchUrl('')
        setOpponentDeclinedNotice(data.declinerName || 'Your opponent')
        setIsSearching(true)
        setConnectionStatus(socket.connected ? 'connected' : 'disconnected')
        startWaitTimer()
      })

      socket.on('queue-status-update', (status) => setQueueStatus(status))
      socket.on('queue-position-update', (status) => setQueueStatus(status))
      socket.on('matchmaking-timeout', () => handleSearchTimeout())
    })
  }, [token, cleanupSocket, stopWaitTimer, clearEmptyQueueTimer, handleSearchTimeout, startWaitTimer])

  const handleAcceptMatch = useCallback(() => {
    setMatchFound(false)
    if (socketRef.current) {
      cleanupSocket(socketRef.current)
      socketRef.current = null
    }
    if (matchUrl) router.replace(matchUrl)
  }, [matchUrl, router, cleanupSocket])

  const handleDeclineAndStay = useCallback(() => {
    const snap = joinSnapshotRef.current
    const currentBattleId = matchBattleId
    const currentPlayerId = matchPlayerId
    const currentMatchUrl = matchUrl
    const prefs = quickMatchPrefsRef.current
    setMatchFound(false)
    setMatchOpponentName('')
    setMatchBattleId('')
    setMatchPlayerId('')
    setMatchUrl('')

    const canDeclineOnServer = Boolean(
      socketRef.current &&
        currentPlayerId &&
        (currentBattleId || (currentMatchUrl && currentMatchUrl.includes('/prompt-battle')))
    )
    if (canDeclineOnServer) {
      socketRef.current.emit('decline-match-stay-in-queue', {
        playerId: currentPlayerId,
        playerName: matchYourName,
        language: snap?.language || selectedLanguageRef.current,
        battleId: currentBattleId || undefined,
        battleType: prefs.battleType,
        promptDurationMinutes: prefs.battleType === 'prompt' ? prefs.promptDurationMinutes : undefined,
        promptModelId: prefs.battleType === 'prompt' ? prefs.promptModelId : undefined
      })
    }
    setIsSearching(true)
    setConnectionStatus(socketRef.current?.connected ? 'connected' : 'disconnected')
    startWaitTimer()
  }, [matchBattleId, matchPlayerId, matchUrl, matchYourName, startWaitTimer])

  const handleDeclineAndLeave = useCallback(async () => {
    const snap = joinSnapshotRef.current
    const currentBattleId = matchBattleId
    const currentPlayerId = matchPlayerId
    const currentMatchUrl = matchUrl
    const prefs = quickMatchPrefsRef.current
    setMatchFound(false)
    setMatchOpponentName('')
    setMatchBattleId('')
    setMatchPlayerId('')
    setMatchUrl('')

    const canDeclineOnServer = Boolean(
      socketRef.current &&
        currentPlayerId &&
        (currentBattleId || (currentMatchUrl && currentMatchUrl.includes('/prompt-battle')))
    )
    if (canDeclineOnServer) {
      socketRef.current.emit('decline-match-stay-in-queue', {
        playerId: currentPlayerId,
        playerName: matchYourName,
        language: snap?.language || selectedLanguageRef.current,
        battleId: currentBattleId || undefined,
        battleType: prefs.battleType,
        promptDurationMinutes: prefs.battleType === 'prompt' ? prefs.promptDurationMinutes : undefined,
        promptModelId: prefs.battleType === 'prompt' ? prefs.promptModelId : undefined
      })
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    cancelSearchInternal({ trackOutcome: false })
  }, [matchBattleId, matchPlayerId, matchUrl, matchYourName, cancelSearchInternal])

  const startQuickMatch = useCallback(
    async ({
      selectedLanguage,
      isRanked,
      selectedTimeLimit,
      quickBattleMode,
      battleTypes = null,
      promptDurationMinutes,
      selectedPromptModelId,
      promptModelLabel = ''
    }) => {
      if (!token) {
        setError('You must be signed in to join matchmaking.')
        return
      }
      setError('')
      const languageToSend = selectedLanguage
      selectedLanguageRef.current = languageToSend
      const nameToUse = user?.username
      playerNameRef.current = (nameToUse || '').trim()
      // Multi-type matchmaking: accept supported consumer modes only.
      const supportedBattleTypes = Array.isArray(battleTypes)
        ? battleTypes.filter((type) => type === 'coding' || type === 'prompt')
        : []
      const acceptedBattleTypes = supportedBattleTypes.length > 1 ? supportedBattleTypes : null
      quickMatchPrefsRef.current = {
        battleType: quickBattleMode === 'prompt' ? 'prompt' : 'coding',
        acceptedTypes: acceptedBattleTypes,
        promptDurationMinutes,
        promptModelId: quickBattleMode === 'prompt' ? selectedPromptModelId || null : null
      }
      joinSnapshotRef.current = {
        language: languageToSend,
        playerName: playerNameRef.current,
        battleType: quickMatchPrefsRef.current.battleType,
        promptDurationMinutes,
        promptModelId: quickMatchPrefsRef.current.promptModelId
      }
      setActiveSearchMeta({
        battleType: quickBattleMode === 'prompt' ? 'prompt' : 'coding',
        promptDurationMinutes,
        language: languageToSend,
        playerName: playerNameRef.current,
        ...(quickBattleMode === 'prompt'
          ? {
              promptModelId: selectedPromptModelId || null,
              promptModelLabel: typeof promptModelLabel === 'string' ? promptModelLabel.trim() : ''
            }
          : {})
      })

      setIsSearching(true)
      setConnectionStatus('connecting')
      trackBeginMatchmaking(
        {
          playerName: nameToUse,
          language: languageToSend,
          queueType: 'QUICK_MATCH',
          battleType: quickBattleMode === 'prompt' ? 'prompt' : 'coding'
        },
        user
      )
      startWaitTimer()

      try {
        const socket = await createSocketConnection()
        socketRef.current = socket
        const playerNameToSend = (nameToUse || '').trim()

        const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
        if (token) headers.Authorization = `Bearer ${token}`

        const joinBody = {
          playerName: playerNameToSend,
          language: languageToSend,
          socketId: socket.id,
          ranked: isRanked,
          timeLimit: selectedTimeLimit,
          battleType: quickBattleMode === 'prompt' ? 'prompt' : 'coding',
          ...(acceptedBattleTypes ? { battleTypes: acceptedBattleTypes } : {}),
          ...((quickBattleMode === 'prompt' || (acceptedBattleTypes && acceptedBattleTypes.includes('prompt')))
            ? {
                promptDurationMinutes,
                ...(selectedPromptModelId ? { promptModelId: selectedPromptModelId } : {})
              }
            : {})
        }

        const response = await fetch(`${config.backend_url}/api/matchmaking/join`, {
          method: 'POST',
          headers,
          body: JSON.stringify(joinBody),
          signal: AbortSignal.timeout(SEARCH_TIMEOUT + 5000)
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Network error' }))

          if (response.status === 400 && errorData.error === 'Already in matchmaking queue') {
            setAlreadyInQueue(true)
            setExistingPlayerId(errorData.existingPlayerId || null)
            setError("You're already in the matchmaking queue.")
            setIsSearching(false)
            stopWaitTimer()
            if (socketRef.current) {
              cleanupSocket(socketRef.current)
              socketRef.current = null
            }
            setActiveSearchMeta(null)
            joinSnapshotRef.current = null
            return
          }

          if (response.status === 403 || response.status === 429) {
            if (errorData.emailVerificationRequired) {
              setError(
                'Please verify your email to join battles. Check your inbox for the verification link, or visit your profile to resend it.'
              )
              setIsSearching(false)
              stopWaitTimer()
              if (socketRef.current) {
                cleanupSocket(socketRef.current)
                socketRef.current = null
              }
              setActiveSearchMeta(null)
              joinSnapshotRef.current = null
              return
            }
            if (errorData.limitReached) {
              setError(errorData.message || "You've reached today's fair-use battle limit. Try again tomorrow.")
              setIsSearching(false)
              stopWaitTimer()
              if (socketRef.current) {
                cleanupSocket(socketRef.current)
                socketRef.current = null
              }
              setActiveSearchMeta(null)
              joinSnapshotRef.current = null
              return
            }
            if (errorData.languageRestricted) {
              setError(errorData.message || 'That language is not available for this battle.')
              setIsSearching(false)
              stopWaitTimer()
              if (socketRef.current) {
                cleanupSocket(socketRef.current)
                socketRef.current = null
              }
              setActiveSearchMeta(null)
              joinSnapshotRef.current = null
              return
            }
          }

          throw new Error(errorData.error || `Server error: ${response.status}`)
        }

        const data = await response.json()
        if (!data.success) throw new Error(data.error || 'Unknown error occurred')
        setPlayerId(data.playerId)
        playerIdRef.current = data.playerId

        if (data.matched) {
          const isPrompt = data.battleType === 'prompt' && data.roomCode
          trackEndMatchmaking(
            {
              outcome: 'MATCH_FOUND',
              waitTimeSeconds: 0,
              battleId: isPrompt ? data.roomCode : data.battleId,
              opponentName: data.opponent
            },
            user
          )
          setIsSearching(false)
          stopWaitTimer()
          const opponentName = data.opponent || 'Opponent'
          const yourName = data.yourName || playerNameToSend
          if (isPrompt) {
            const url = `/prompt-battle?room=${encodeURIComponent(data.roomCode)}`
            setMatchBattleId('')
            setMatchPlayerId(data.playerId)
            setMatchOpponentName(opponentName)
            setMatchYourName(yourName)
            setMatchUrl(url)
            setMatchFound(true)
            setActiveSearchMeta(null)
            return
          }
          const battleLanguage = data.matchedLanguage || languageToSend
          let url = `/battle?id=${data.battleId}&playerId=${data.playerId}&opponent=${encodeURIComponent(opponentName)}&yourName=${encodeURIComponent(yourName)}&matchmaking=true`
          if (data.battleType !== 'prompt') {
            url += `&language=${battleLanguage}`
            if (data.sameLanguage || data.skipLanguageSelection) url += '&skipLanguageSelection=true'
          }
          if (socket && data.battleId && data.playerId) {
            socket.emit('join-battle-room', { battleId: data.battleId, playerId: data.playerId })
          }
          setMatchBattleId(data.battleId)
          setMatchPlayerId(data.playerId)
          setMatchOpponentName(opponentName)
          setMatchYourName(yourName)
          setMatchUrl(url)
          setMatchFound(true)
          setActiveSearchMeta(null)
          return
        }

        socket.emit('update-queue-socket', {
          playerId: data.playerId,
          language: languageToSend,
          playerName: user?.username || 'Player',
          rating: user?.rating || 1000
        })
        setQueueStatus({
          queuePosition: data.queuePosition || 1,
          // Total players in queue must come from the canonical total field
          // (server sends playersInQueue on agent-queue-update / totalInQueue on HTTP join),
          // NOT from this player's queue position.
          totalInQueue: data.totalInQueue || data.playersInQueue || data.queuePosition || 1
        })

        const totalInQueue = data.totalInQueue || data.queuePosition || 1
        const queuePosition = data.queuePosition || 1
        if (queuePosition === 1 && totalInQueue === 1) {
          const timer = setTimeout(() => {
            if (isSearchingRef.current) setShowPlayWhileWait(true)
          }, 5000)
          setEmptyQueueTimer(timer)
          emptyQueueTimerRef.current = timer
        }
      } catch (err) {
        let errorMessage = 'Failed to join matchmaking'
        if (err.name === 'AbortError') {
          errorMessage = 'Request timed out. Please check your connection.'
        } else if (err.message) errorMessage = err.message
        setError(errorMessage)
        setIsSearching(false)
        setQueueStatus(null)
        setConnectionStatus('disconnected')
        stopWaitTimer()
        if (socketRef.current) {
          cleanupSocket(socketRef.current)
          socketRef.current = null
        }
        setActiveSearchMeta(null)
        joinSnapshotRef.current = null
      }
    },
    [token, user, createSocketConnection, startWaitTimer, stopWaitTimer, cleanupSocket]
  )

  const cancelSearch = useCallback(() => {
    cancelSearchInternal({ trackOutcome: true })
  }, [cancelSearchInternal])

  const leaveExistingQueue = useCallback(async () => {
    try {
      if (existingPlayerId) {
        await fetch(`${config.backend_url}/api/matchmaking/leave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId: existingPlayerId }),
          signal: AbortSignal.timeout(5000)
        })
      }
    } catch (e) {
      logger.error('Error leaving existing queue:', e)
    }
    setAlreadyInQueue(false)
    setExistingPlayerId(null)
    setError('')
  }, [existingPlayerId])

  const handleStartPracticeWhileWaiting = useCallback(() => {
    setShowPlayWhileWait(false)
    const lang = activeSearchMeta?.language || selectedLanguageRef.current
    router.push(
      `/practice?queueActive=true&playerId=${playerIdRef.current}&playerName=${encodeURIComponent(playerNameRef.current)}&language=${lang}&queueTime=${waitTime}`
    )
  }, [router, waitTime, activeSearchMeta])

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(''), 8000)
      return () => clearTimeout(t)
    }
  }, [error])

  useEffect(() => {
    if (opponentDeclinedNotice) {
      const t = setTimeout(() => setOpponentDeclinedNotice(null), 5000)
      return () => clearTimeout(t)
    }
  }, [opponentDeclinedNotice])

  const value = useMemo(
    () => ({
      isSearching,
      queueStatus,
      playerId,
      error,
      setError,
      connectionStatus,
      waitTime,
      showPlayWhileWait,
      matchFound,
      matchOpponentName,
      matchYourName,
      matchUrl,
      alreadyInQueue,
      existingPlayerId,
      opponentDeclinedNotice,
      setOpponentDeclinedNotice,
      activeSearchMeta,
      startQuickMatch,
      cancelSearch,
      leaveExistingQueue,
      handleStartPracticeWhileWaiting,
      handleAcceptMatch,
      handleDeclineAndStay,
      handleDeclineAndLeave
    }),
    [
      isSearching,
      queueStatus,
      playerId,
      error,
      connectionStatus,
      waitTime,
      showPlayWhileWait,
      matchFound,
      matchOpponentName,
      matchYourName,
      matchUrl,
      alreadyInQueue,
      existingPlayerId,
      opponentDeclinedNotice,
      activeSearchMeta,
      startQuickMatch,
      cancelSearch,
      leaveExistingQueue,
      handleStartPracticeWhileWaiting,
      handleAcceptMatch,
      handleDeclineAndStay,
      handleDeclineAndLeave
    ]
  )

  const dockVisible =
    isSearching && !matchFound && router.pathname !== '/matchmaking'

  return (
    <MatchmakingQueueContext.Provider value={value}>
      {children}
      <MatchmakingQueueDock
        visible={dockVisible}
        queueStatus={queueStatus}
        connectionStatus={connectionStatus}
        waitTime={waitTime}
        activeSearchMeta={activeSearchMeta}
        onCancel={cancelSearch}
      />
      {showPlayWhileWait && router.pathname !== '/practice' && (
        <PlayWhileYouWait
          onStartPractice={handleStartPracticeWhileWaiting}
          onDismiss={() => setShowPlayWhileWait(false)}
          queueTime={waitTime}
          playersInQueue={queueStatus?.totalInQueue || 1}
          isSearching={isSearching}
          playerName={activeSearchMeta?.playerName || user?.username || 'Player'}
          selectedLanguage={activeSearchMeta?.language || 'python'}
        />
      )}
      {matchFound && (
        <ImprovedMatchFoundNotification
          opponentName={matchOpponentName}
          yourName={matchYourName}
          onAccept={handleAcceptMatch}
          onDeclineAndStay={handleDeclineAndStay}
          onDecline={handleDeclineAndLeave}
          autoAcceptTime={30}
        />
      )}
      <AnimatePresence>
        {opponentDeclinedNotice && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.95 }}
            className="fixed bottom-24 lg:bottom-6 left-1/2 transform -translate-x-1/2 z-[58] max-w-[calc(100vw-2rem)]"
          >
            <div className="bg-surface-800 border border-warning/30 rounded-xl px-6 py-4 shadow-xl flex items-center space-x-3">
              <div className="w-10 h-10 bg-warning/20 rounded-full flex items-center justify-center flex-shrink-0">
                <Users className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-white font-medium">{opponentDeclinedNotice} skipped this match</p>
                <p className="text-surface-400 text-sm">Continuing to search for opponents...</p>
              </div>
              <button
                type="button"
                onClick={() => setOpponentDeclinedNotice(null)}
                className="ml-2 text-surface-400 hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </MatchmakingQueueContext.Provider>
  )
}

export function useMatchmakingQueue() {
  const ctx = useContext(MatchmakingQueueContext)
  if (!ctx) {
    throw new Error('useMatchmakingQueue must be used within MatchmakingQueueProvider')
  }
  return ctx
}
