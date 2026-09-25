// pages/problems/index.js - the problem library. Every row is a warm-up away.
import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Search, Play, Check, Swords } from 'lucide-react';
import Header from '../../components/Header';
import { config } from '../../config/env';
import { useAuth } from '../../contexts/AuthContext';
import { getLanguageDisplayName } from '../../utils/languages';

const DIFFICULTIES = ['All', 'Easy', 'Medium', 'Hard'];
const difficultyOrder = { Easy: 0, Medium: 1, Hard: 2 };
const difficultyTone = {
  Easy: 'text-[var(--ca-product-mint)]',
  Medium: 'text-[#efcc99]',
  Hard: 'text-[#ffad99]'
};
const STATIC_FETCH_TIMEOUT_MS = 4000;

function solvedEntries(data) {
  const list = data?.solvedProblems || data?.stats?.solvedProblems || [];
  return Array.isArray(list) ? list : [];
}

function ProblemsPage({ problems, totalCount }) {
  const { token } = useAuth();
  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState('All');
  const [tag, setTag] = useState('All');
  const [solved, setSolved] = useState(new Map());

  useEffect(() => {
    if (!token) { setSolved(new Map()); return undefined; }
    let cancelled = false;
    fetch(`${config.backend_url}/api/practice/stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data) return;
        const next = new Map();
        solvedEntries(data).forEach(row => {
          const id = row.problem_id || row.problemId;
          if (id) next.set(id, row.language || row.solved_language || '');
        });
        setSolved(next);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  const tags = useMemo(
    () => Array.from(new Set(problems.flatMap(problem => problem.tags || []))).sort(),
    [problems]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return problems
      .filter(problem => difficulty === 'All' || problem.difficulty === difficulty)
      .filter(problem => tag === 'All' || (problem.tags || []).includes(tag))
      .filter(problem => !needle || problem.title.toLowerCase().includes(needle) || (problem.tags || []).some(t => t.toLowerCase().includes(needle)))
      .sort((a, b) => (difficultyOrder[a.difficulty] ?? 9) - (difficultyOrder[b.difficulty] ?? 9) || a.title.localeCompare(b.title));
  }, [problems, query, difficulty, tag]);

  const description = `Browse ${totalCount} original coding problems built for quick warm-ups and head-to-head battles.`;

  return (
    <div className="codearena-practice-surface min-h-screen bg-surface-950 text-white">
      <Head>
        <title>Problem Library - CodeArena</title>
        <meta name="description" content={description} />
        <link rel="canonical" href="https://codearena.co/problems" />
      </Head>
      <Header />

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ca-product-mint)]">Problem library</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{totalCount} problems, all original</h1>
            <p className="mt-2 max-w-xl text-sm text-surface-400">
              Every problem here shows up in battles too. Warm up on one now, or battle a friend on it later.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded-lg border border-surface-800 bg-surface-900/70 px-3 py-2 text-surface-300">
              Solved <span className="font-bold text-[var(--ca-product-mint)]">{solved.size}</span>
            </span>
            <Link href="/practice" className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 font-semibold text-surface-950 hover:bg-primary-400">
              <Play className="h-4 w-4" /> Quick warm-up
            </Link>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <label className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-500" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by title or tag"
              className="w-full rounded-lg border border-surface-700 bg-surface-900 py-2 pl-9 pr-3 text-sm text-white placeholder:text-surface-500 focus:border-primary-500 focus:outline-none"
            />
          </label>
          <div className="flex gap-1.5">
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
          {tags.length > 0 && (
            <select
              value={tag}
              onChange={e => setTag(e.target.value)}
              aria-label="Filter by tag"
              className="rounded-lg border border-surface-700 bg-surface-900 px-3 py-1.5 text-sm text-white focus:border-primary-500 focus:outline-none"
            >
              <option value="All">All tags</option>
              {tags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>

        <ul className="mt-6 divide-y divide-surface-800 overflow-hidden rounded-xl border border-surface-800 bg-surface-900/50">
          {filtered.map(problem => {
            const solvedLanguage = solved.get(problem.id);
            return (
              <li key={problem.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-surface-800/40">
                <span className={`w-16 text-xs font-semibold ${difficultyTone[problem.difficulty] || 'text-surface-300'}`}>{problem.difficulty}</span>
                <Link href={`/problems/${encodeURIComponent(problem.id)}`} className="min-w-0 flex-1 font-medium text-white hover:text-primary-200">
                  {problem.title}
                </Link>
                <span className="hidden text-xs text-surface-500 sm:inline">{(problem.tags || []).slice(0, 3).join(' · ')}</span>
                {solvedLanguage !== undefined && (
                  <span className="inline-flex items-center gap-1 text-xs text-[var(--ca-product-mint)]" title={solvedLanguage ? `Solved in ${getLanguageDisplayName(solvedLanguage)}` : 'Solved'}>
                    <Check className="h-3.5 w-3.5" /> Solved
                  </span>
                )}
                <Link
                  href={`/practice?problem=${encodeURIComponent(problem.id)}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-surface-700 px-2.5 py-1 text-xs font-semibold text-surface-200 hover:border-primary-400 hover:text-white"
                >
                  <Play className="h-3.5 w-3.5" /> Warm up
                </Link>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-surface-400">
              {problems.length === 0 ? 'The problem list could not be loaded right now.' : 'No problems match these filters.'}
            </li>
          )}
        </ul>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-800 bg-surface-900/70 px-4 py-4 text-sm">
          <p className="text-surface-300">Want to add a problem? The library is open source and every problem comes with tests in two languages.</p>
          <Link href="/matchmaking" className="inline-flex items-center gap-2 font-semibold text-primary-300 hover:text-primary-200">
            <Swords className="h-4 w-4" /> Or just battle
          </Link>
        </div>
      </main>
    </div>
  );
}

export async function getStaticProps() {
  let problems = [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STATIC_FETCH_TIMEOUT_MS);
    const res = await fetch(`${config.backend_url}/api/problems?shuffle=false`, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    if (res.ok && data.success && Array.isArray(data.problems)) {
      problems = data.problems.map(problem => ({
        id: problem.id,
        title: problem.title,
        difficulty: problem.difficulty,
        category: problem.category || '',
        tags: Array.isArray(problem.tags) ? problem.tags : []
      }));
    }
  } catch (error) {
    console.warn('Problems API unavailable during static generation.', error.message);
  }

  return {
    props: { problems, totalCount: problems.length },
    revalidate: problems.length > 0 ? 300 : 60
  };
}

export default ProblemsPage;
