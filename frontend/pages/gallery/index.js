import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import { Search, ThumbsUp, Play, Gamepad2, Filter, ArrowUpDown, Loader2, Wand2, Star, Trophy } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import Logo from '../../components/Logo';
import SearchBarComponent from '../../components/SearchBar';
import NotificationBell from '../../components/NotificationBell';
import { Card } from '../../components/ui/Card';
import AvatarDisplay from '../../components/ui/AvatarDisplay';
import { config } from '../../config/env';

const SORT_OPTIONS = [
  { value: 'new', label: 'Newest' },
  { value: 'top', label: 'Top Voted' },
  { value: 'hot', label: 'Most Played' },
  { value: 'rated', label: 'Top Rated' },
];

const TYPE_FILTERS = [
  { value: 'all', label: 'All Games' },
  { value: 'browser', label: 'Browser Games' },
  { value: 'text', label: 'Text Adventures' },
];

function StarDisplay({ avg, count }) {
  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map(s => (
          <Star key={s} className={`h-3 w-3 ${s <= Math.round(avg) ? 'fill-yellow-400 text-yellow-400' : 'fill-transparent text-surface-700'}`} />
        ))}
      </div>
      <span className="text-xs text-surface-500">{avg > 0 ? avg.toFixed(1) : ''} <span className="text-surface-700">({count})</span></span>
    </div>
  );
}

function GalleryPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('new');
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);

  const loadGames = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ sort, type, page, limit: 20 });
      if (search) params.set('search', search);
      const res = await fetch(`${config.backend_url}/api/games/gallery?${params}`);
      const data = await res.json();
      setGames(data.games || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load gallery:', err);
    } finally {
      setLoading(false);
    }
  }, [sort, type, search, page]);

  useEffect(() => { loadGames(); }, [loadGames]);

  useEffect(() => {
    fetch(`${config.backend_url}/api/games/leaderboard?limit=10`)
      .then(r => r.json())
      .then(d => setLeaderboard(d.games || []))
      .catch(() => {})
      .finally(() => setLeaderboardLoading(false));
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    loadGames();
  };

  return (
    <>
      <Head>
        <title>Game Gallery - CodeArena</title>
        <meta name="description" content="Play and vote on games created by the CodeArena community." />
      </Head>
      <div className="min-h-screen bg-surface-950 text-white">
        <header className="px-4 sm:px-6 py-3 border-b border-surface-800/50 bg-surface-950/80 backdrop-blur-md flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Logo size="sm" />
            </Link>
            <div className="h-5 w-px bg-surface-800" />
            <div className="flex items-center gap-1.5 text-white font-semibold text-sm">
              <Gamepad2 className="h-4 w-4 text-primary-400" />
              Game Gallery
            </div>
          </div>
          <div className="flex items-center gap-3">
            <SearchBarComponent />
            <NotificationBell />
            <div className="h-5 w-px bg-surface-800" />
            <Link href="/create" className="text-xs text-surface-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-surface-800">
              <Wand2 className="h-3.5 w-3.5 inline mr-1.5" />Create
            </Link>
          </div>
        </header>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          {/* Hero */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-2">Game Gallery</h1>
            <p className="text-surface-400">Play, vote, and comment on games created by the community</p>
          </motion.div>

          {/* Leaderboard */}
          {(leaderboard.length > 0 || leaderboardLoading) && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mb-10">
              <div className="flex items-center gap-2 mb-4">
                <Trophy className="h-4 w-4 text-yellow-400" />
                <h2 className="text-sm font-semibold text-white">Top Rated</h2>
              </div>
              {leaderboardLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 text-primary-400 animate-spin" />
                </div>
              ) : (
                <div className="flex flex-wrap justify-center gap-2">
                  {leaderboard.slice(0, 3).map((game, i) => (
                    <Link key={game.id} href={`/gallery/${game.id}`} className="block">
                      <div className="group w-56 border border-surface-700/70 rounded-lg bg-surface-800/50 hover:bg-surface-800/80 shadow-sm shadow-black/30 transition-all duration-200 p-3 flex items-center gap-2.5">
                        {/* Mini thumbnail */}
                        <div className="relative w-12 h-9 flex-shrink-0 rounded overflow-hidden bg-surface-800">
                          {game.html_content ? (
                            <iframe
                              srcDoc={game.html_content}
                              sandbox="allow-scripts"
                              tabIndex={-1}
                              title={game.title}
                              className="absolute top-0 left-0 border-0 pointer-events-none select-none"
                              style={{ width: 320, height: 240, transform: 'scale(0.1875)', transformOrigin: 'top left' }}
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <Gamepad2 className="h-3 w-3 text-surface-600" />
                            </div>
                          )}
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] text-surface-600 mb-0.5">#{i + 1}</p>
                          <h3 className="text-xs font-medium text-surface-300 group-hover:text-white transition-colors truncate">{game.title}</h3>
                          <div className="flex items-center gap-2 text-[10px] text-surface-600 mt-1">
                            {game.rating_count > 0 && <span>{game.avg_rating.toFixed(1)} ★</span>}
                            <span className="flex items-center gap-0.5"><ThumbsUp className="h-2.5 w-2.5" />{game.vote_score}</span>
                            <span className="flex items-center gap-0.5"><Play className="h-2.5 w-2.5" />{game.play_count}</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <form onSubmit={handleSearch} className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search games..."
                className="w-full pl-10 pr-4 py-2.5 bg-surface-800/60 border border-surface-700 rounded-lg text-sm text-surface-200 placeholder-surface-500 focus:outline-none focus:border-primary-500"
              />
            </form>
            <div className="flex gap-2">
              <select value={type} onChange={e => { setType(e.target.value); setPage(1); }}
                className="bg-surface-800/60 border border-surface-700 rounded-lg px-3 py-2.5 text-sm text-surface-300 focus:outline-none focus:border-primary-500"
              >
                {TYPE_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <select value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}
                className="bg-surface-800/60 border border-surface-700 rounded-lg px-3 py-2.5 text-sm text-surface-300 focus:outline-none focus:border-primary-500"
              >
                {SORT_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          {/* Games Grid */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 text-primary-400 animate-spin" />
            </div>
          ) : games.length === 0 ? (
            <div className="text-center py-20">
              <Gamepad2 className="h-16 w-16 text-surface-700 mx-auto mb-4" />
              <p className="text-surface-400 text-lg mb-2">No games yet</p>
              <p className="text-surface-600 text-sm mb-6">Be the first to create and publish a game!</p>
              <Link href="/create" className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-400 transition-colors">
                Create a Game
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {games.map((game, i) => (
                  <motion.div key={game.id} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="h-full">
                    <Link href={`/gallery/${game.id}`} className="block h-full">
                      <div className="group relative border border-surface-800 rounded-xl bg-surface-900/60 hover:border-surface-600/80 transition-all duration-200 overflow-hidden h-full flex flex-col hover:shadow-lg hover:shadow-black/30 hover:-translate-y-0.5">
                        {/* Thumbnail */}
                        <div className="relative h-44 overflow-hidden border-b border-surface-800 bg-surface-900">
                          {/* Live iframe preview (browser games with html_content) */}
                          {game.html_content ? (
                            <iframe
                              srcDoc={game.html_content}
                              sandbox="allow-scripts"
                              tabIndex={-1}
                              title={`Preview of ${game.title}`}
                              className="absolute top-0 left-0 border-0 pointer-events-none select-none"
                              style={{ width: 800, height: 500, transform: 'scale(0.44)', transformOrigin: 'top left' }}
                            />
                          ) : (
                            /* Fallback placeholder when no html_content */
                            <div className={`absolute inset-0 flex items-center justify-center ${
                              game.game_type === 'browser'
                                ? 'bg-gradient-to-br from-primary-900/40 via-surface-900 to-surface-800/60'
                                : 'bg-gradient-to-br from-purple-900/40 via-surface-900 to-surface-800/60'
                            }`}>
                              <span className={`absolute text-[96px] font-black leading-none select-none pointer-events-none opacity-[0.06] ${
                                game.game_type === 'browser' ? 'text-primary-300' : 'text-purple-300'
                              }`}>
                                {game.title?.[0]?.toUpperCase() || '?'}
                              </span>
                              <Gamepad2 className={`relative z-10 h-10 w-10 ${
                                game.game_type === 'browser' ? 'text-primary-500/30' : 'text-purple-500/30'
                              }`} />
                            </div>
                          )}

                          {/* Hover overlay: dark scrim + Play button, no competing elements */}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all duration-200 flex items-center justify-center">
                            <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${
                              game.game_type === 'browser' ? 'bg-primary-500' : 'bg-purple-500'
                            }`}>
                              <Play className="h-3.5 w-3.5 fill-current" />
                              Play
                            </div>
                          </div>

                          {/* Type badge */}
                          <div className="absolute top-3 left-3 z-10">
                            <span className="text-[10px] font-medium uppercase tracking-widest px-2 py-0.5 rounded bg-black/60 text-surface-400 border border-surface-700/30">
                              {game.game_type}
                            </span>
                          </div>

                          {/* Star rating badge */}
                          {game.rating_count > 0 && (
                            <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-surface-950/80 px-2 py-1 rounded-md border border-surface-700/60">
                              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                              <span className="text-xs font-semibold text-white">{game.avg_rating.toFixed(1)}</span>
                            </div>
                          )}
                        </div>

                        {/* Card body */}
                        <div className="p-4 flex flex-col flex-1">
                          <h3 className={`text-sm font-semibold text-white mb-1 transition-colors truncate leading-snug ${
                            game.game_type === 'browser' ? 'group-hover:text-primary-300' : 'group-hover:text-purple-300'
                          }`}>{game.title}</h3>
                          {game.description
                            ? <p className="text-xs text-surface-500 line-clamp-2 leading-relaxed mb-3">{game.description}</p>
                            : <div className="mb-3" />
                          }

                          {/* Footer */}
                          <div className="mt-auto flex items-center justify-between pt-3 border-t border-surface-800">
                            <div className="flex items-center gap-2 min-w-0">
                              <AvatarDisplay avatar={game.creator_avatar} username={game.creator_username} size="xs" />
                              <span className="text-xs text-surface-400 truncate">{game.creator_username}</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-surface-500 flex-shrink-0">
                              <span className="flex items-center gap-1 hover:text-green-400 transition-colors">
                                <ThumbsUp className="h-3 w-3" />
                                <span>{game.vote_score}</span>
                              </span>
                              <span className="flex items-center gap-1">
                                <Play className="h-3 w-3" />
                                <span>{game.play_count}</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>

              {/* Pagination */}
              {total > 20 && (
                <div className="flex justify-center gap-2 mt-8">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="px-4 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-300 disabled:opacity-50 hover:bg-surface-700 transition-colors"
                  >Previous</button>
                  <span className="px-4 py-2 text-sm text-surface-400">Page {page} of {Math.ceil(total / 20)}</span>
                  <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 20)}
                    className="px-4 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-300 disabled:opacity-50 hover:bg-surface-700 transition-colors"
                  >Next</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default GalleryPage;
