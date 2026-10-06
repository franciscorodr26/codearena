// Agent battles call a paid model API, so a server only offers them when the
// operator turns them on. This wrapper asks the server once and shows a plain
// notice instead of the page when they are off.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import Header from './Header'
import { config } from '../config/env'

export const AGENT_BATTLES_OFF = 'Agent battles are not enabled on this server.'

export default function AgentBattlesGate({ children }) {
  const [state, setState] = useState('checking')

  useEffect(() => {
    let cancelled = false
    fetch(`${config.backend_url}/api/agent/status`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!cancelled) setState(res.status === 503 && data.notEnabled ? 'off' : 'on')
      })
      .catch(() => { if (!cancelled) setState('on') })
    return () => { cancelled = true }
  }, [])

  if (state === 'on') return children
  if (state === 'checking') return <div className="min-h-screen bg-surface-950" />
  return (
    <div className="min-h-screen bg-surface-950 text-white">
      <Header />
      <main className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-2xl font-bold">Agent battles</h1>
        <p className="mt-3 text-surface-300">{AGENT_BATTLES_OFF}</p>
        <p className="mt-1 text-sm text-surface-500">The operator can turn them on with CODEARENA_AGENT_BATTLES=1 and a model API key.</p>
        <Link href="/matchmaking" className="mt-6 inline-flex rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-surface-950 hover:bg-primary-400">Play a coding battle instead</Link>
      </main>
    </div>
  )
}
