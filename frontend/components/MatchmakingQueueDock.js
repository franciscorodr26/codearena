import React from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, Search, X } from 'lucide-react'
import { formatTimer as formatTime } from '../utils/formatting'
import Button from './ui/Button'

/**
 * Fixed strip when Quick Match is active and the user navigates away from /matchmaking.
 */
export function MatchmakingQueueDock({
  visible,
  queueStatus,
  connectionStatus,
  waitTime,
  activeSearchMeta,
  onCancel
}) {
  const promptModelDisplay =
    (activeSearchMeta?.promptModelLabel && String(activeSearchMeta.promptModelLabel).trim()) ||
    (activeSearchMeta?.promptModelId && String(activeSearchMeta.promptModelId).trim()) ||
    ''
  const battleLabel =
    activeSearchMeta?.battleType === 'prompt'
      ? `Prompt · ${activeSearchMeta.promptDurationMinutes} min${
          promptModelDisplay ? ` · ${promptModelDisplay}` : ''
        }`
      : 'Coding'

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          className="fixed bottom-16 left-0 right-0 z-[60] lg:bottom-0 px-3 safe-area-inset-bottom pointer-events-none"
        >
          <div className="pointer-events-auto max-w-3xl mx-auto">
            <div className="rounded-xl border border-primary-500/40 bg-surface-900/95 backdrop-blur-md shadow-xl shadow-primary-900/20 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary-500/20 flex items-center justify-center border border-primary-500/30">
                  <Search className="w-5 h-5 text-primary-300 animate-pulse" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">Quick Match: Searching</p>
                  <p className="text-xs text-surface-400 truncate">
                    {battleLabel}
                    {activeSearchMeta?.battleType !== 'prompt' && activeSearchMeta?.language
                      ? ` · ${String(activeSearchMeta.language).toUpperCase()}`
                      : ''}
                  </p>
                  <p className="text-xs text-surface-500 mt-0.5">
                    {connectionStatus === 'connected'
                      ? 'Connected'
                      : connectionStatus === 'error'
                        ? 'Connection error'
                        : 'Connecting…'}
                    {queueStatus && connectionStatus === 'connected' && (
                      <span className="text-surface-400">
                        {' '}
                        · #{queueStatus.queuePosition || queueStatus.position || 1} in queue
                      </span>
                    )}
                  </p>
                </div>
                <div className="hidden sm:flex items-center gap-1.5 text-primary-300 font-mono text-sm flex-shrink-0">
                  <Clock className="w-4 h-4" />
                  {formatTime(waitTime)}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto justify-between sm:justify-end">
                <div className="flex sm:hidden items-center gap-1.5 text-primary-300 font-mono text-sm">
                  <Clock className="w-4 h-4" />
                  {formatTime(waitTime)}
                </div>
                <Link
                  href="/matchmaking"
                  className="text-xs font-medium text-primary-300 hover:text-primary-200 underline-offset-2 hover:underline px-2 py-1.5"
                >
                  Details
                </Link>
                <Button variant="danger" size="sm" onClick={onCancel} icon={X} className="!py-2">
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
