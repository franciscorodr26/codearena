import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import { ThumbsUp, ThumbsDown, MessageSquare, Send, Trash2, ArrowLeft, Play, Loader2, AlertCircle, Gamepad2, Pencil, Share2, Check, ChevronUp, ChevronDown, MoreVertical, EyeOff, Star } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import Logo from '../../components/Logo';
import SearchBar from '../../components/SearchBar';
import NotificationBell from '../../components/NotificationBell';
import Button from '../../components/ui/Button';
import AvatarDisplay from '../../components/ui/AvatarDisplay';
import { config } from '../../config/env';

function CommentVoteControls({ score = 0, userVote = 0, size = 'sm', onVote }) {
  const iconClass = size === 'xs' ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const scoreClass = score > 0 ? 'text-green-400' : score < 0 ? 'text-red-400' : 'text-surface-500';

  return (
    <div className="inline-flex items-center rounded-full bg-surface-900/70 border border-surface-800 overflow-hidden">
      <button
        type="button"
        onClick={() => onVote(1)}
        className={`px-2 py-1 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-green-400/70 ${
          userVote === 1
            ? 'bg-green-500/15 text-green-400'
            : 'text-surface-500 hover:text-green-400 hover:bg-surface-800'
        }`}
        aria-label="Upvote comment"
      >
        <ChevronUp className={iconClass} />
      </button>
      <span className={`min-w-[2rem] px-1 text-center text-xs font-semibold tabular-nums ${scoreClass}`}>
        {score}
      </span>
      <button
        type="button"
        onClick={() => onVote(-1)}
        className={`px-2 py-1 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400/70 ${
          userVote === -1
            ? 'bg-red-500/15 text-red-400'
            : 'text-surface-500 hover:text-red-400 hover:bg-surface-800'
        }`}
        aria-label="Downvote comment"
      >
        <ChevronDown className={iconClass} />
      </button>
    </div>
  );
}

function StarRating({ avgRating, ratingCount, userRating, onRate, disabled }) {
  const [hovered, setHovered] = useState(null);
  const display = hovered ?? userRating ?? 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map(star => (
          <button
            key={star}
            type="button"
            disabled={disabled}
            onMouseEnter={() => !disabled && setHovered(star)}
            onMouseLeave={() => !disabled && setHovered(null)}
            onClick={() => !disabled && onRate(star === userRating ? null : star)}
            className={`p-0.5 transition-colors focus:outline-none ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
            aria-label={`Rate ${star} star${star !== 1 ? 's' : ''}`}
          >
            <Star className={`h-5 w-5 transition-colors ${
              star <= display
                ? 'fill-yellow-400 text-yellow-400'
                : 'fill-transparent text-surface-600'
            }`} />
          </button>
        ))}
      </div>
      <span className="text-sm text-surface-400">
        {ratingCount > 0 ? (
          <>{avgRating.toFixed(1)} <span className="text-surface-600">({ratingCount})</span></>
        ) : (
          <span className="text-surface-600">No ratings yet</span>
        )}
      </span>
    </div>
  );
}

function GameDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { user, token } = useAuth();

  const [game, setGame] = useState(null);
  const [userVote, setUserVote] = useState(null);
  const [userRating, setUserRating] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showKebab, setShowKebab] = useState(false);
  const kebabRef = React.useRef(null);

  // Close kebab on outside click
  useEffect(() => {
    function handleClick(e) { if (kebabRef.current && !kebabRef.current.contains(e.target)) setShowKebab(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Load game
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setLoading(true);
    setGame(null);
    setError('');
    async function load() {
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`${config.backend_url}/api/games/${id}`, { headers, signal: controller.signal });
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok) { setError(data.error || 'Failed to load game'); return; }
        setGame(data.game);
        setUserVote(data.userVote);
        setUserRating(data.userRating);
      } catch (err) {
        if (!controller.signal.aborted) setError('Failed to load game');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [id, token]);

  const loadComments = useCallback(async (signal) => {
    if (!id) return;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(`${config.backend_url}/api/games/${id}/comments`, { headers, signal });
    const data = await res.json();
    if (signal?.aborted) return;
    if (!res.ok) throw new Error('Failed to load comments');
    setComments(data.comments || []);
  }, [id, token]);

  // Load comments
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setComments([]);
    loadComments(controller.signal).catch(() => {});
    return () => controller.abort();
  }, [id, loadComments]);

  const vote = useCallback(async (value) => {
    if (!token) { router.push('/login'); return; }
    const newVote = userVote === value ? null : value;
    // Optimistic update
    const prevVote = userVote;
    const prevScore = game.vote_score;
    setUserVote(newVote);
    setGame(g => ({ ...g, vote_score: g.vote_score - (prevVote || 0) + (newVote || 0) }));

    try {
      let res;
      if (newVote === null) {
        res = await fetch(`${config.backend_url}/api/games/${id}/vote`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      } else {
        res = await fetch(`${config.backend_url}/api/games/${id}/vote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ vote: newVote })
        });
      }
      if (!res.ok) throw new Error('Vote failed');
    } catch (err) {
      // Revert on failure
      setUserVote(prevVote);
      setGame(g => ({ ...g, vote_score: prevScore }));
    }
  }, [token, userVote, game, id, router]);

  const rateGame = useCallback(async (stars) => {
    if (!token) { router.push('/login'); return; }
    const prevRating = userRating;
    const prevAvg = game.avg_rating;
    const prevCount = game.rating_count;
    setUserRating(stars);

    try {
      let res;
      if (stars === null) {
        res = await fetch(`${config.backend_url}/api/games/${id}/rate`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });
      } else {
        res = await fetch(`${config.backend_url}/api/games/${id}/rate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ rating: stars })
        });
      }
      if (!res.ok) throw new Error('Rate failed');
      const data = await res.json();
      setGame(g => ({ ...g, avg_rating: data.avgRating, rating_count: data.ratingCount }));
    } catch (err) {
      setUserRating(prevRating);
      setGame(g => ({ ...g, avg_rating: prevAvg, rating_count: prevCount }));
    }
  }, [token, userRating, game, id, router]);

  const submitComment = useCallback(async (content, parentId) => {
    console.log('[Comment] Attempting to submit:', { content, parentId, token: !!token, id });
    if (!token) { router.push('/login'); return; }
    if (!content.trim()) { console.log('[Comment] Empty content'); return; }
    if (!id) { console.error('[Comment] No game ID'); return; }
    setSubmittingComment(true);
    try {
      const res = await fetch(`${config.backend_url}/api/games/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: content.trim(), parentId })
      });
      const data = await res.json();
      if (res.ok) {
        await loadComments();
        setNewComment('');
        setReplyTo(null);
        setReplyText('');
      } else {
        alert(data.error || 'Failed to post comment');
      }
    } catch (err) {
      console.error('Failed to post comment:', err);
      alert('Failed to post comment. Please try again.');
    } finally {
      setSubmittingComment(false);
    }
  }, [token, id, router, loadComments]);

  const deleteComment = useCallback(async (commentId) => {
    if (!token) return;
    try {
      await fetch(`${config.backend_url}/api/games/${id}/comments/${commentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      await loadComments();
    } catch (err) {
      console.error('Failed to delete comment');
    }
  }, [token, id, loadComments]);

  const updateCommentVoteState = useCallback((commentId, updater) => {
    setComments(current => current.map(comment => {
      if (comment.id === commentId) return updater(comment);
      return {
        ...comment,
        replies: comment.replies?.map(reply => reply.id === commentId ? updater(reply) : reply)
      };
    }));
  }, []);

  const voteComment = useCallback(async (commentId, value) => {
    if (!token) { router.push('/login'); return; }

    const previousComment = comments.reduce((found, comment) => {
      if (found) return found;
      if (comment.id === commentId) return comment;
      return comment.replies?.find(reply => reply.id === commentId) || null;
    }, null);

    updateCommentVoteState(commentId, comment => {
      const previousVote = comment.user_vote || 0;
      const nextVote = previousVote === value ? 0 : value;
      return {
        ...comment,
        user_vote: nextVote,
        vote_score: (comment.vote_score || 0) - previousVote + nextVote
      };
    });

    try {
      const res = await fetch(`${config.backend_url}/api/games/${id}/comments/${commentId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ vote: value })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Comment vote failed');
      updateCommentVoteState(commentId, comment => ({
        ...comment,
        user_vote: data.userVote,
        vote_score: data.voteScore
      }));
    } catch (err) {
      if (previousComment) {
        updateCommentVoteState(commentId, () => previousComment);
      }
    }
  }, [token, router, id, comments, updateCommentVoteState]);

  const totalCommentCount = comments.reduce((count, comment) => count + 1 + (comment.replies?.length || 0), 0);

  const copyShareLink = useCallback(() => {
    const url = `${window.location.origin}/gallery/${id}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }).catch(() => {
      // Fallback for older browsers
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  }, [id]);

  const unpublishGame = useCallback(async () => {
    if (!confirm('Unpublish this game? It will be removed from the gallery but you can still edit and republish it.')) return;
    try {
      const res = await fetch(`${config.backend_url}/api/games/${id}/unpublish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed to unpublish'); return; }
      router.push('/gallery');
    } catch (err) {
      alert('Failed to unpublish game');
    }
  }, [id, token, router]);

  const deleteGame = useCallback(async () => {
    if (!confirm('Delete this game permanently? This cannot be undone.')) return;
    try {
      const res = await fetch(`${config.backend_url}/api/games/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed to delete'); return; }
      router.push('/gallery');
    } catch (err) {
      alert('Failed to delete game');
    }
  }, [id, token, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-950 text-white">
        <header className="px-4 sm:px-6 py-3 border-b border-surface-800/50 bg-surface-950/80 backdrop-blur-md flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity"><Logo size="sm" /></Link>
            <div className="h-5 w-px bg-surface-800" />
            <Link href="/gallery" className="flex items-center gap-1.5 text-white font-semibold text-sm hover:opacity-80 transition-opacity">
              <Gamepad2 className="h-4 w-4 text-primary-400" /> Game Gallery
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <SearchBar />
            <NotificationBell />
          </div>
        </header>
        <div className="flex items-center justify-center py-40"><Loader2 className="h-8 w-8 text-primary-400 animate-spin" /></div>
      </div>
    );
  }

  if (error || !game) {
    return (
      <div className="min-h-screen bg-surface-950 text-white">
        <header className="px-4 sm:px-6 py-3 border-b border-surface-800/50 bg-surface-950/80 backdrop-blur-md flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity"><Logo size="sm" /></Link>
            <div className="h-5 w-px bg-surface-800" />
            <Link href="/gallery" className="flex items-center gap-1.5 text-white font-semibold text-sm hover:opacity-80 transition-opacity">
              <Gamepad2 className="h-4 w-4 text-primary-400" /> Game Gallery
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <SearchBar />
            <NotificationBell />
          </div>
        </header>
        <div className="max-w-2xl mx-auto px-4 py-20 text-center">
          <AlertCircle className="h-12 w-12 text-surface-600 mx-auto mb-4" />
          <p className="text-surface-400">{error || 'Game not found'}</p>
          <Link href="/gallery" className="text-primary-400 hover:text-primary-300 text-sm mt-4 inline-block">Back to Gallery</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{game.title} - CodeArena Gallery</title>
      </Head>
      <div className="min-h-screen bg-surface-950 text-white">
        <header className="px-4 sm:px-6 py-3 border-b border-surface-800/50 bg-surface-950/80 backdrop-blur-md flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity"><Logo size="sm" /></Link>
            <div className="h-5 w-px bg-surface-800" />
            <Link href="/gallery" className="flex items-center gap-1.5 text-white font-semibold text-sm hover:opacity-80 transition-opacity">
              <Gamepad2 className="h-4 w-4 text-primary-400" /> Game Gallery
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <SearchBar />
            <NotificationBell />
          </div>
        </header>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
          {/* Back Link */}
          <Link href="/gallery" className="inline-flex items-center gap-1.5 text-sm text-surface-400 hover:text-surface-200 mb-4 transition-colors">
            <ArrowLeft className="h-4 w-4" /> Back to Gallery
          </Link>

          {/* Game Header */}
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-white mb-1">{game.title}</h1>
              <div className="flex items-center gap-3">
                <Link href={`/profile/${game.creator_username}`} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                  <AvatarDisplay avatar={game.creator_avatar} username={game.creator_username} size="sm" />
                  <span className="text-sm text-surface-300">{game.creator_username}</span>
                </Link>
                <span className="text-xs text-surface-600">{new Date(game.created_at).toLocaleDateString()}</span>
                <span className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded ${
                  game.game_type === 'browser' ? 'bg-primary-500/10 text-primary-400' : 'bg-purple-500/10 text-purple-400'
                }`}>{game.game_type}</span>
              </div>
              {game.description && <p className="text-sm text-surface-400 mt-2">{game.description}</p>}
              {user && user.id === game.creator_id && (
                <Link href={`/create?edit=${game.id}`} className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 text-xs text-surface-300 bg-surface-800 hover:bg-surface-700 border border-surface-700 rounded-lg transition-colors">
                  <Pencil className="h-3 w-3" /> Edit Game
                </Link>
              )}
            </div>

            {/* Kebab + Votes (right side) */}
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              {/* Kebab Menu */}
              <div className="relative" ref={kebabRef}>
                <button
                  onClick={() => setShowKebab(!showKebab)}
                  className="p-2 rounded-lg text-surface-400 hover:text-white hover:bg-surface-800 transition-colors"
                >
                  <MoreVertical className="h-5 w-5" />
                </button>
                {showKebab && (
                  <div className="absolute right-0 top-full mt-1 w-44 bg-surface-900 border border-surface-700 rounded-xl shadow-2xl overflow-hidden z-50">
                    <button
                      onClick={() => { copyShareLink(); setShowKebab(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-surface-300 hover:text-white hover:bg-surface-800 transition-colors"
                    >
                      {copiedLink ? <Check className="h-4 w-4 text-green-400" /> : <Share2 className="h-4 w-4" />}
                      {copiedLink ? 'Copied!' : 'Share'}
                    </button>
                    {user && user.id === game.creator_id && (
                      <>
                        <button
                          onClick={() => { setShowKebab(false); unpublishGame(); }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-surface-300 hover:text-white hover:bg-surface-800 transition-colors border-t border-surface-800"
                        >
                          <EyeOff className="h-4 w-4" />
                          Unpublish
                        </button>
                        <button
                          onClick={() => { setShowKebab(false); deleteGame(); }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors border-t border-surface-800"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Vote Buttons */}
              <div className="flex items-center gap-1">
                <button onClick={() => vote(1)}
                  className={`p-2 rounded-lg transition-all ${userVote === 1 ? 'bg-green-500/20 text-green-400' : 'text-surface-500 hover:text-green-400 hover:bg-surface-800'}`}>
                  <ThumbsUp className="h-5 w-5" />
                </button>
                <span className={`text-lg font-bold min-w-[2rem] text-center ${
                  game.vote_score > 0 ? 'text-green-400' : game.vote_score < 0 ? 'text-red-400' : 'text-surface-500'
                }`}>{game.vote_score}</span>
                <button onClick={() => vote(-1)}
                  className={`p-2 rounded-lg transition-all ${userVote === -1 ? 'bg-red-500/20 text-red-400' : 'text-surface-500 hover:text-red-400 hover:bg-surface-800'}`}>
                  <ThumbsDown className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Game Iframe */}
          <div className="w-full aspect-[16/10] bg-surface-900 rounded-lg border border-surface-700 overflow-hidden mb-8">
            <iframe
              srcDoc={game.html_content}
              sandbox="allow-scripts"
              className="w-full h-full border-0"
              title={game.title}
            />
          </div>

          {/* Stats + Rating */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-8">
            <div className="flex items-center gap-4 text-sm text-surface-500">
              <span className="flex items-center gap-1.5"><Play className="h-4 w-4" /> {game.play_count} plays</span>
              <span className="flex items-center gap-1.5"><ThumbsUp className="h-4 w-4" /> {game.vote_score} votes</span>
              <span className="flex items-center gap-1.5"><MessageSquare className="h-4 w-4" /> {totalCommentCount} comments</span>
            </div>
            <div className="sm:ml-auto">
              <StarRating
                avgRating={game.avg_rating || 0}
                ratingCount={game.rating_count || 0}
                userRating={userRating}
                onRate={rateGame}
                disabled={!token || user?.id === game.creator_id}
              />
              {!token && <p className="text-xs text-surface-600 mt-1">Sign in to rate</p>}
              {token && user?.id === game.creator_id && <p className="text-xs text-surface-600 mt-1">You can't rate your own game</p>}
            </div>
          </div>

          {/* Comments Section */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-4">Comments</h2>

            {/* New Comment */}
            <div className="flex gap-3 mb-6">
              {user && <AvatarDisplay avatar={user.avatar} username={user.username} size="sm" />}
              <div className="flex-1">
                <textarea
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  placeholder={token ? "Share your thoughts..." : "Sign in to comment"}
                  disabled={!token}
                  className="w-full bg-surface-800/60 border border-surface-700 rounded-lg px-3 py-2.5 text-sm text-surface-200 placeholder-surface-500 focus:outline-none focus:border-primary-500 resize-none"
                  rows={2}
                />
                <div className="flex justify-end mt-2 items-center gap-2">
                  {process.env.NODE_ENV === 'development' && (
                    <span className="text-xs text-surface-500">
                      token: {token ? 'yes' : 'no'} | text: {newComment.trim() ? 'yes' : 'no'}
                    </span>
                  )}
                  <Button variant="primary" size="sm" onClick={() => { console.log('[Comment] Button clicked, newComment:', newComment); submitComment(newComment, null); }} loading={submittingComment} disabled={!newComment.trim() || !token}>
                    <Send className="h-3.5 w-3.5 mr-1.5" /> Post
                  </Button>
                </div>
              </div>
            </div>

            {/* Comments List */}
            <div className="space-y-4">
              {comments.map(comment => (
                <div key={comment.id} className="space-y-3">
                  {/* Top-level comment */}
                  <div className="flex gap-3">
                    <AvatarDisplay avatar={comment.avatar} username={comment.username} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Link href={`/profile/${comment.username}`} className="text-sm font-medium text-surface-200 hover:text-white">{comment.username}</Link>
                        <span className="text-xs text-surface-600">{new Date(comment.created_at).toLocaleDateString()}</span>
                        {user && user.id === comment.user_id && (
                          <button onClick={() => deleteComment(comment.id)} className="text-xs text-surface-600 hover:text-red-400 transition-colors ml-auto">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <p className="text-sm text-surface-300 whitespace-pre-wrap">{comment.content}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <CommentVoteControls
                          score={comment.vote_score}
                          userVote={comment.user_vote}
                          onVote={(value) => voteComment(comment.id, value)}
                        />
                        <button onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
                          className="text-xs font-medium text-surface-500 hover:text-primary-400 transition-colors">
                          Reply
                        </button>
                      </div>

                      {/* Reply input */}
                      <AnimatePresence>
                        {replyTo === comment.id && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-2 flex gap-2">
                            <input
                              value={replyText}
                              onChange={e => setReplyText(e.target.value)}
                              placeholder="Write a reply..."
                              className="flex-1 bg-surface-800/60 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-200 placeholder-surface-500 focus:outline-none focus:border-primary-500"
                              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment(replyText, comment.id); } }}
                            />
                            <Button variant="primary" size="sm" onClick={() => submitComment(replyText, comment.id)} disabled={!replyText.trim()}>
                              <Send className="h-3 w-3" />
                            </Button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* Replies */}
                  {comment.replies?.map(reply => (
                    <div key={reply.id} className="flex gap-3 ml-10">
                      <AvatarDisplay avatar={reply.avatar} username={reply.username} size="xs" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <Link href={`/profile/${reply.username}`} className="text-xs font-medium text-surface-300 hover:text-white">{reply.username}</Link>
                          <span className="text-[10px] text-surface-600">{new Date(reply.created_at).toLocaleDateString()}</span>
                          {user && user.id === reply.user_id && (
                            <button onClick={() => deleteComment(reply.id)} className="text-[10px] text-surface-600 hover:text-red-400 transition-colors ml-auto">
                              <Trash2 className="h-2.5 w-2.5" />
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-surface-400 whitespace-pre-wrap">{reply.content}</p>
                        <div className="mt-1.5">
                          <CommentVoteControls
                            score={reply.vote_score}
                            userVote={reply.user_vote}
                            size="xs"
                            onVote={(value) => voteComment(reply.id, value)}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              {comments.length === 0 && (
                <p className="text-center text-surface-600 text-sm py-8">No comments yet. Be the first!</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default GameDetailPage;
