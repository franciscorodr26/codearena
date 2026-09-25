import { useCallback, useRef, useState } from 'react'

const emptyMetrics = () => ({
  keystrokes: 0,
  pastes: 0,
  activeTypingTime: 0,
  idleTime: 0,
  linesAdded: 0,
  linesDeleted: 0,
  revisionCount: 0,
  lastActivityTime: null,
  previousCode: '',
  previousLineCount: 0
})

// Battle integrity needs only coarse activity totals at submission time. Keep
// them in the browser; CodeArena does not upload periodic behavioral sessions
// or code snapshots.
export function useBattleActivityMetrics() {
  const [isTracking, setIsTracking] = useState(false)
  const metricsRef = useRef(emptyMetrics())

  const startTracking = useCallback(() => {
    metricsRef.current = {
      ...emptyMetrics(),
      lastActivityTime: Date.now()
    }
    setIsTracking(true)
  }, [])

  const stopTracking = useCallback(() => {
    setIsTracking(false)
  }, [])

  const trackActivity = useCallback(() => {
    if (!isTracking) return

    const now = Date.now()
    const metrics = metricsRef.current
    const elapsed = metrics.lastActivityTime
      ? now - metrics.lastActivityTime
      : 0

    if (elapsed > 0 && elapsed < 2000) {
      metrics.activeTypingTime += elapsed
    } else if (elapsed >= 2000) {
      metrics.idleTime += elapsed
    }

    metrics.keystrokes += 1
    metrics.lastActivityTime = now
  }, [isTracking])

  const trackCodeChange = useCallback((newCode) => {
    if (!isTracking) return

    const metrics = metricsRef.current
    const nextLineCount = newCode.split('\n').length

    if (nextLineCount > metrics.previousLineCount) {
      metrics.linesAdded += nextLineCount - metrics.previousLineCount
    } else if (nextLineCount < metrics.previousLineCount) {
      metrics.linesDeleted += metrics.previousLineCount - nextLineCount
    }

    if (
      metrics.previousCode.length > 50 &&
      Math.abs(newCode.length - metrics.previousCode.length) >
        metrics.previousCode.length * 0.2
    ) {
      metrics.revisionCount += 1
    }

    metrics.previousCode = newCode
    metrics.previousLineCount = nextLineCount
  }, [isTracking])

  const getMetrics = useCallback(() => ({ ...metricsRef.current }), [])

  return {
    isTracking,
    startTracking,
    stopTracking,
    trackActivity,
    trackCodeChange,
    getMetrics
  }
}

export default useBattleActivityMetrics
