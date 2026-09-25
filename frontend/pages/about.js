import Head from 'next/head';
import Link from 'next/link';
import { Code2, Gamepad2, MessageSquare, Swords, Users, Wand2 } from 'lucide-react';

import Header from '../components/Header';
import Footer from '../components/Footer';

const pillars = [
  { title: 'Practice coding', description: 'Solve real problems, run tests, explore edge cases, and build a visible history of progress.', Icon: Code2 },
  { title: 'Practice prompting', description: 'Learn to write clearer prompts through objective feedback and repeatable exercises.', Icon: MessageSquare },
  { title: 'Compete live', description: 'Battle developers in coding or prompting, join human tournaments, and climb the rankings.', Icon: Swords },
  { title: 'Socialize', description: 'Find friends, see who is online, message each other, and launch direct challenges and rematches.', Icon: Users },
  { title: 'Create', description: 'Build coding games in CreatorArena and share them with the community.', Icon: Wand2 },
  { title: 'Discover', description: 'Explore the Gallery and play experiences made by other developers.', Icon: Gamepad2 },
];

export default function About() {
  return (
    <div className="min-h-screen bg-surface-950 text-white">
      <Head>
        <title>About CodeArena | Practice, Compete, Create</title>
        <meta name="description" content="CodeArena is a developer community for coding and prompt practice, live battles, tournaments, friends, and community-created games." />
        <link rel="canonical" href="https://codearena.co/about" />
      </Head>
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <section className="max-w-3xl">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.24em] text-primary-400">About CodeArena</p>
          <h1 className="mt-5 font-display text-4xl font-extrabold tracking-tight sm:text-6xl">The developer community that makes practice social.</h1>
          <p className="mt-6 text-lg leading-8 text-surface-300">CodeArena brings solo practice, live competition, friends, and community creation into one focused place. Start with a coding problem or prompt, then test your skill against people you know, or meet your next rival.</p>
        </section>

        <section className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pillars.map(({ title, description, Icon }) => (
            <article key={title} className="rounded-2xl border border-white/5 bg-surface-900 p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-500/10 text-primary-400"><Icon className="h-5 w-5" /></span>
              <h2 className="mt-5 font-display text-xl font-bold">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-surface-300">{description}</p>
            </article>
          ))}
        </section>

        <section className="mt-14 rounded-2xl border border-primary-500/20 bg-primary-500/5 p-8 sm:flex sm:items-center sm:justify-between sm:gap-8">
          <div><h2 className="font-display text-2xl font-bold">Ready to enter the arena?</h2><p className="mt-2 text-surface-300">Practice solo or challenge another developer.</p></div>
          <Link href="/register" className="mt-6 inline-flex rounded-xl bg-primary-500 px-6 py-3 font-semibold text-surface-950 transition hover:bg-primary-400 sm:mt-0">Join CodeArena</Link>
        </section>
      </main>
      <Footer />
    </div>
  );
}
