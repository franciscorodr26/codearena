// pages/problems/[slug].js - one problem, statically rendered for search and sharing
import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { ArrowLeft, Play, Swords, Code2 } from 'lucide-react';
import Header from '../../components/Header';
import { ProblemDescription } from '../../components/ProblemDescription';
import { config } from '../../config/env';
import { useAuth } from '../../contexts/AuthContext';
import { getLanguageDisplayName } from '../../utils/languages';

const difficultyTone = {
  Easy: 'text-success',
  Medium: 'text-warning',
  Hard: 'text-error-light'
};

function ProblemPage({ problem }) {
  const { token } = useAuth();
  const [accepted, setAccepted] = useState(null);

  useEffect(() => {
    if (!token || !problem?.id) { setAccepted(null); return undefined; }
    let cancelled = false;
    fetch(`${config.backend_url}/api/practice/solution/${encodeURIComponent(problem.id)}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (!cancelled && data?.success) setAccepted(data.solution || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token, problem?.id]);

  if (!problem) return null;

  const summary = (problem.description || '').split('\n').find(line => line.trim()) || '';

  return (
    <div className="min-h-screen bg-surface-950 text-white">
      <Head>
        <title>{`${problem.title} - CodeArena`}</title>
        <meta name="description" content={`${problem.title} (${problem.difficulty}). ${summary.slice(0, 150)}`} />
        <link rel="canonical" href={`https://codearena.co/problems/${problem.id}`} />
      </Head>
      <Header />

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-8">
        <Link href="/problems" className="inline-flex items-center gap-1 text-sm text-surface-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Problem library
        </Link>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight">{problem.title}</h1>
          <span className={`text-sm font-semibold ${difficultyTone[problem.difficulty] || 'text-surface-300'}`}>{problem.difficulty}</span>
        </div>
        {(problem.tags || []).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {problem.tags.map(tag => (
              <span key={tag} className="rounded-full border border-surface-700 px-2.5 py-0.5 text-xs text-surface-300">{tag}</span>
            ))}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <Link href={`/practice?problem=${encodeURIComponent(problem.id)}`} className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-surface-950 hover:bg-primary-400">
            <Play className="h-4 w-4" /> Warm up with this problem
          </Link>
          <Link href="/matchmaking" className="inline-flex items-center gap-2 rounded-lg border border-surface-700 px-4 py-2 text-sm font-semibold text-surface-200 hover:border-surface-500 hover:text-white">
            <Swords className="h-4 w-4" /> Battle on it
          </Link>
        </div>

        <section className="mt-8">
          <ProblemDescription description={problem.description} />
        </section>

        {Array.isArray(problem.examples) && problem.examples.length > 0 && (
          <section className="mt-6">
            <h2 className="text-lg font-semibold">Examples</h2>
            <div className="mt-3 space-y-3">
              {problem.examples.map((example, index) => (
                <div key={index} className="rounded-lg border border-surface-800 bg-surface-900/60 p-4 font-mono text-sm">
                  <div><span className="text-surface-500">Input: </span><span className="text-surface-200">{example.input}</span></div>
                  <div className="mt-1"><span className="text-surface-500">Output: </span><span className="text-success">{example.output}</span></div>
                  {example.explanation && <p className="mt-2 font-sans text-xs text-surface-400">{example.explanation}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {Array.isArray(problem.constraints) && problem.constraints.length > 0 && (
          <section className="mt-6">
            <h2 className="text-lg font-semibold">Constraints</h2>
            <ul className="mt-2 space-y-1 text-sm text-surface-300">
              {problem.constraints.map((constraint, index) => (
                <li key={index} className="flex gap-2"><span className="text-primary-400">•</span><span>{constraint}</span></li>
              ))}
            </ul>
          </section>
        )}

        {accepted?.code && (
          <section className="mt-8 rounded-xl border border-success/30 bg-success/5 p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Code2 className="h-4 w-4 text-success" /> Your accepted solution ({getLanguageDisplayName(accepted.language)})
            </h2>
            <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-surface-950 p-3 text-xs text-surface-200">{accepted.code}</pre>
          </section>
        )}
      </main>
    </div>
  );
}

export async function getStaticPaths() {
  // Rendered on first request and cached, so new problems need no rebuild.
  return { paths: [], fallback: 'blocking' };
}

export async function getStaticProps({ params }) {
  try {
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(`${config.backend_url}/api/problems/${encodeURIComponent(params.slug)}`);
      if (res.ok || res.status === 404) break;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
    if (!res || res.status === 404) return { notFound: true };
    if (!res.ok) return { notFound: true, revalidate: 30 };

    const data = await res.json();
    const problem = data?.problem || (data?.id ? data : null);
    if (!problem) return { notFound: true, revalidate: 30 };

    // Tests and starter code belong in the practice page, not the public summary.
    const { testCases, starterCode, ...publicProblem } = problem;
    return { props: { problem: publicProblem }, revalidate: 3600 };
  } catch (error) {
    console.error('Error fetching problem:', error);
    return { notFound: true, revalidate: 30 };
  }
}

export default ProblemPage;
