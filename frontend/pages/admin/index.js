import React, { useCallback, useEffect, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useAuth } from '../../contexts/AuthContext'
import { config } from '../../config/env'
import { Card } from '../../components/ui/Card'
import Button from '../../components/ui/Button'

const activityLabels = {
  coding_practice: 'Coding practice', prompt_practice: 'Prompt practice',
  coding_battle: 'Coding battle', prompt_battle: 'Prompt battle'
}
const overviewLabels = {
  members: 'Members', verifiedMembers: 'Verified members', onlineMembers: 'Online members',
  friendships: 'Friendships', directMessages: 'Direct messages', groupMessages: 'Group messages',
  groups: 'Groups', codingPracticeAttempts: 'Coding practice attempts',
  promptPracticeAttempts: 'Prompt practice attempts', codingBattles: 'Coding battles', promptBattles: 'Prompt battles'
}
const memberCountLabels = {
  friendships: 'Friends', directMessagesSent: 'Direct messages sent', directMessagesReceived: 'Direct messages received',
  groupMessagesSent: 'Group messages sent', codingPracticeAttempts: 'Coding practice attempts',
  promptPracticeAttempts: 'Prompt practice attempts', codingBattles: 'Coding battles', promptBattles: 'Prompt battles'
}

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString()
}

function useCommunityResource(path, token, denied, onDenied) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState({ path: null, data: null, loading: false, error: '' })
  useEffect(() => {
    if (!path || denied) return
    const controller = new AbortController()
    setState({ path, data: null, loading: true, error: '' })
    async function load() {
      try {
        const response = await fetch(`${config.backend_url}/api/admin/community/${path}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal
        })
        if (controller.signal.aborted) return
        if (response.status === 401 || response.status === 403) {
          onDenied()
          return
        }
        if (!response.ok) throw new Error(response.status === 404 ? 'Member not found.' : 'Could not load this data. Please retry.')
        const data = await response.json()
        if (controller.signal.aborted) return
        if (!data.success) throw new Error('Could not load this data. Please retry.')
        setState({ path, data, loading: false, error: '' })
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({ path, data: null, loading: false, error: error.message || 'Could not load this data. Please retry.' })
        }
      }
    }
    load()
    return () => controller.abort()
  }, [path, token, denied, onDenied, revision])
  return {
    ...(state.path === path ? state : { data: null, loading: Boolean(path), error: '' }),
    retry: () => setRevision(value => value + 1)
  }
}

function ResourceStatus({ resource, label }) {
  if (resource.loading) return <p role="status" className="py-4 text-surface-400">Loading {label}...</p>
  if (resource.error) return (
    <div role="alert" className="py-4">
      <p className="mb-2 text-red-400">{resource.error}</p>
      <Button variant="outline" onClick={resource.retry}>Retry {label}</Button>
    </div>
  )
  return null
}

function Pagination({ data, onPage, label }) {
  if (!data || data.totalPages < 2) return null
  return (
    <nav aria-label={`${label} pages`} className="mt-4 flex flex-wrap items-center gap-3">
      <Button variant="outline" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>Previous {label}</Button>
      <span className="text-sm text-surface-400">Page {data.page} of {data.totalPages}</span>
      <Button variant="outline" disabled={data.page >= data.totalPages} onClick={() => onPage(data.page + 1)}>Next {label}</Button>
    </nav>
  )
}

function AccessDenied() {
  return (
    <main className="min-h-screen bg-surface-950 px-6 py-20 text-white">
      <h1 className="text-2xl font-semibold">CodeArena admin</h1>
      <p role="alert" className="my-4 text-surface-300">Admin access required. Sign in with an authorized CodeArena account.</p>
      <Link href="/login" className="text-primary-400">Sign in</Link>
    </main>
  )
}

function CommunityAdmin({ token }) {
  const [denied, setDenied] = useState(false)
  const onDenied = useCallback(() => setDenied(true), [])
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState({ search: '', page: 1 })
  const [selectedMember, setSelectedMember] = useState(null)
  const [historyPage, setHistoryPage] = useState(1)

  useEffect(() => {
    const timer = setTimeout(() => {
      const search = searchInput.trim()
      setQuery(previous => previous.search === search ? previous : { search, page: 1 })
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const overview = useCommunityResource('overview', token, denied, onDenied)
  const members = useCommunityResource(`members?${new URLSearchParams({ search: query.search, page: query.page, limit: 25 })}`, token, denied, onDenied)
  const history = useCommunityResource(selectedMember ? `members/${selectedMember}/history?page=${historyPage}&limit=25` : null, token, denied, onDenied)

  if (denied) return <AccessDenied />

  return (
    <main className="min-h-screen bg-surface-950 px-4 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <Link href="/dashboard" className="text-sm text-primary-400">Back to CodeArena</Link>
          <h1 className="mt-3 text-3xl font-semibold">CodeArena admin</h1>
          <p className="mt-2 text-surface-400">Community members, activity, and messaging counts. Read-only; private message content is not shown.</p>
          <nav aria-label="Admin tools" className="mt-4 flex flex-wrap gap-4 text-sm text-primary-400">
            <Link href="/admin/accounts">Account audit</Link>
            <Link href="/admin/moderation">Moderation</Link>
            <Link href="/admin/trust">Trust</Link>
            <Link href="/admin/emails">Email tools</Link>
          </nav>
        </header>

        <section aria-labelledby="community-overview">
          <h2 id="community-overview" className="mb-3 text-xl font-semibold">Community overview</h2>
          <ResourceStatus resource={overview} label="overview" />
          {overview.data && <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Object.entries(overviewLabels).map(([key, label]) => (
              <Card key={key} padding="sm">
                <dt className="text-sm text-surface-400">{label}</dt>
                <dd className="mt-1 text-2xl font-semibold">{overview.data.counts[key] ?? '-'}</dd>
              </Card>
            ))}
          </dl>}
          {overview.data && <p className="mt-2 text-xs text-surface-500">Updated {formatDate(overview.data.generatedAt)}</p>}
        </section>

        <Card as="section" aria-labelledby="community-members">
          <h2 id="community-members" className="text-xl font-semibold">Members</h2>
          <label htmlFor="member-search" className="mt-4 block text-sm text-surface-300">Search username or email</label>
          <input id="member-search" type="search" maxLength={100} value={searchInput}
            onChange={event => { setSearchInput(event.target.value); setSelectedMember(null); setHistoryPage(1) }}
            className="mt-2 w-full rounded-lg border border-surface-600 bg-surface-950 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-primary-400" />
          <ResourceStatus resource={members} label="members" />
          {members.data && <>
            <p className="my-3 text-sm text-surface-400">{members.data.pagination.total} matching members</p>
            {members.data.members.length === 0 ? <p>No members found.</p> : (
              <ul className="divide-y divide-surface-700">
                {members.data.members.map(member => (
                  <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{member.username} {member.isAdmin && <span className="text-xs text-surface-400">(admin)</span>}</p>
                      <p className="break-all text-sm text-surface-400">{member.email || 'No email'}</p>
                      <p className="text-xs text-surface-500">{member.emailVerified ? 'Verified' : 'Unverified'} · {member.isOnline ? 'Online' : `Last seen ${formatDate(member.lastSeen)}`}</p>
                    </div>
                    <Button variant="outline" aria-label={`View ${member.username} activity`} onClick={() => { setSelectedMember(member.id); setHistoryPage(1) }}>View activity</Button>
                  </li>
                ))}
              </ul>
            )}
            <Pagination label="members" data={members.data.pagination} onPage={page => { setQuery(previous => ({ ...previous, page })); setSelectedMember(null) }} />
          </>}
        </Card>

        {selectedMember && <Card as="section" aria-labelledby="member-activity">
          <h2 id="member-activity" className="text-xl font-semibold">Member activity{history.data ? `: ${history.data.member.username}` : ''}</h2>
          <ResourceStatus resource={history} label="activity" />
          {history.data && <>
            <p className="mt-2 text-sm text-surface-400">Joined {formatDate(history.data.member.createdAt)}</p>
            <dl className="my-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              {Object.entries(memberCountLabels).map(([key, label]) => (
                <div key={key}><dt className="text-sm text-surface-400">{label}</dt><dd className="font-semibold">{history.data.counts[key] ?? '-'}</dd></div>
              ))}
            </dl>
            {history.data.activities.length === 0 ? <p>No recorded practice or battle activity.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-surface-400"><tr>{['Activity', 'When', 'Language', 'Result', 'Score'].map(label => <th key={label} className="px-2 py-2 font-medium">{label}</th>)}</tr></thead>
                  <tbody>{history.data.activities.map(activity => (
                    <tr key={`${activity.type}:${activity.id}`} className="border-t border-surface-700">
                      <td className="px-2 py-3">{activityLabels[activity.type] || activity.type}</td>
                      <td className="px-2 py-3">{formatDate(activity.occurredAt)}</td>
                      <td className="px-2 py-3">{activity.language || '-'}</td>
                      <td className="px-2 py-3">{activity.result || '-'}</td>
                      <td className="px-2 py-3">{activity.score ?? '-'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <Pagination label="activity" data={history.data.pagination} onPage={setHistoryPage} />
          </>}
        </Card>}
      </div>
    </main>
  )
}

export default function CodeArenaAdminPage() {
  const { user, token, loading } = useAuth()
  const isAdmin = user?.is_admin === true || user?.is_admin === 1
  return (
    <>
      <Head><title>Community Admin - CodeArena</title><meta name="robots" content="noindex,nofollow" /></Head>
      {loading ? <main className="min-h-screen bg-surface-950 px-6 py-20 text-white"><p role="status">Checking admin access...</p></main>
        : !token || !isAdmin ? <AccessDenied /> : <CommunityAdmin key={`${user.id}:${token}`} token={token} />}
    </>
  )
}
