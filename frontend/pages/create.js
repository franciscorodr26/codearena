import React, { useState, useCallback, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import { Wand2, Play, Save, Upload, Github, RotateCcw, Gamepad2, Loader2, Check, AlertCircle, AlertTriangle, ChevronDown, FolderOpen, ArrowUp, Coins, Zap, HelpCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { withAuth } from '../components/withAuth';
import Button from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import Logo from '../components/Logo';
import SearchBar from '../components/SearchBar';
import NotificationBell from '../components/NotificationBell';
import { config } from '../config/env';
import { useTutorial, creatorArenaTour } from '../components/tutorial';
import { trackTourStarted, trackTourCompleted, trackTourSkipped } from '../utils/analytics';


function CreatePage() {
  const router = useRouter();
  const { user, token } = useAuth();
  const { startTour, isTourCompleted, isTourDismissed, resetTour, isVisible: isTourVisible, hasLoadedPersistedState } = useTutorial();
  const hasStartedCreatorTourRef = React.useRef(false);


  const [prompt, setPrompt] = useState('');
  const [html, setHtml] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [gameId, setGameId] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [githubUrl, setGithubUrl] = useState(null);
  const [revisionText, setRevisionText] = useState('');
  const [showSaveReminder, setShowSaveReminder] = useState(false);
  const [myGames, setMyGames] = useState([]);
  const [showMyGames, setShowMyGames] = useState(false);
  const [promptHistory, setPromptHistory] = useState([]);
  const [isLoadingPromptHistory, setIsLoadingPromptHistory] = useState(false);
  const myGamesRef = React.useRef(null);

  // CreatorArena generations are funded exclusively with pay-as-you-go credits.
  const [credits, setCredits] = useState(null);
  const [creditCost, setCreditCost] = useState(5);
  const [revisionCost, setRevisionCost] = useState(2);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const checkoutPendingRef = React.useRef(false);
  const [latestVerification, setLatestVerification] = useState(null);
  const [latestVersion, setLatestVersion] = useState(null);
  const [publishability, setPublishability] = useState({ isVerified: false, needsVerification: false });

  // Sample prompt generator
  const [hasUsedSample, setHasUsedSample] = useState(false);

  const SAMPLE_PROMPTS = [
    // 1. Space Invaders - pizza theme
    `Please make a Space Invaders-style shooter. You're a pizza delivery drone at the bottom. Shoot pepperoni upward at 3 rows of angry customers moving side-to-side. Customers drop complaint emails that fall straight down - dodge them. Left/Right arrows to move, Space to shoot. Neon pink enemies on dark blue background. Score +10 per customer hit. 3 lives, lose one if hit by complaint. Win when all customers destroyed, game over at 0 lives.`,
    // 2. Match-3 potions
    `Please make a match-3 puzzle game. 6x6 grid of colored potion bottles (red, blue, green, yellow, purple). Click one potion then click adjacent potion to swap. 3+ in a row disappear and potions above fall down. New random potions fill from top. Purple and gold colors with dark background. Score +10 per potion cleared, +25 bonus for 4+ matches. 60-second timer. Show score and time remaining.`,
    // 3. Reaction time clicker
    `Please make a reaction time test game. Dark gray background. Colored circles (red, blue, green, yellow) appear at random positions one at a time. Click the circle before it disappears. Starts with 2 seconds per circle, decreases by 0.1 seconds each round (minimum 0.5s). Circle scales down smoothly when clicked. Track hits, misses, and current streak. After 30 circles, show final accuracy percentage and best streak.`,
    // 4. Endless runner cube
    `Please make a side-scrolling endless runner. White square character on left side of screen. Platforms scroll from right to left with gaps between them. Space to jump, double-tap Space for double jump. Purple and orange gradient background. Speed increases every 10 seconds. Score = distance in meters (increases over time). Show current score top-left. Game over when falling into gap, show final distance and restart button.`,
    // 5. Zombie arena
    `Please make a top-down zombie survival game. Small rectangular arena with gray walls. Green player square in center. WASD to move. Mouse to aim, click to shoot yellow bullets. Red zombie squares spawn from random edges every 2 seconds and move toward player. Zombies die in one hit. Player has 100 HP, zombies deal 10 damage on contact. Show HP bar top-left, kill count top-right. Game over at 0 HP, show kills and restart button.`,
    // 6. Breakout cat theme
    `Please make a Breakout game with cat theme. White ball bounces around. Pink paddle at bottom shaped like a cat paw - Left/Right arrows to move. 5 rows of yarn ball bricks at top in pastel colors (pink, blue, yellow, mint, lavender). Ball destroys bricks on contact. Ball bounces off walls and paddle. 3 lives shown as cat face icons. Lose life if ball falls below paddle. Win when all bricks gone. Cozy cream background.`,
    // 7. Typing falling words
    `Please make a typing speed game. Common 4-8 letter words fall from top of screen one at a time. Type the word correctly to destroy it before it hits the bottom. Start speed slow, increase every 5 words. Green text on black background like old terminal. Show current word in large font. Display WPM (words per minute) and accuracy percentage. 5 misses allowed - game over after 5 words hit bottom. Show final stats.`,
    // 8. Snake conga line
    `Please make a snake game with party theme. Orange player square that grows a tail. Arrow keys to move in 4 directions. Collect white "guest" dots to grow longer. Avoid hitting walls or your own tail. Disco purple background. Every 15 seconds, screen flashes and controls reverse for 3 seconds (left=right, up=down). Score = number of guests collected. Game over on collision, show final guest count.`,
    // 9. Tower defense simple
    `Please make a simple tower defense game. Enemies (red circles) walk on a horizontal path from left to right. Click anywhere above or below the path to place towers. 3 tower types: blue (slows enemies), orange (damages enemies), yellow (hits all nearby enemies). Towers cost 25 coins each. Start with 100 coins. Earn 10 coins per kill. 10 waves of 5 enemies each. 10 lives - lose one when enemy reaches right side. Show wave, coins, lives.`,
    // 10. Rhythm arrows
    `Please make a rhythm game. Four arrow targets at top of screen (left, up, down, right). Arrow icons scroll up from bottom. Press matching arrow key when icon reaches target line. Timing: Perfect (+100), Good (+50), Miss (break combo). Arrows appear in random pattern, 60 arrows total. Neon pink arrows on dark purple background. Show score, combo counter (multiplies points), and arrows remaining. Final score at end.`,
    // 11. Fishing game
    `Please make a fishing game. Blue pond takes up most of screen. Click and hold anywhere to charge power meter (0-100%), release to cast line to that distance. Line splashes and sinks. Fish (small, medium, large shapes) swim horizontally. When fish touches your line, press Space rapidly to reel in. Small=10pts, Medium=25pts, Large=50pts. 90-second timer. Calm blue and green colors. Show catch count and total points.`,
    // 12. Memory cards
    `Please make a memory card matching game. 4x4 grid of 16 cards face-down (8 pairs of emoji: star, heart, moon, sun, tree, fish, bird, flower). Click card to flip and reveal emoji. Click second card - if match, both stay visible. If no match, both flip back after 1 second. Track number of moves. Timer counts up. Pastel gradient background. Win when all pairs found. Show moves taken and time, fewer moves = more stars (under 16 = 3 stars, under 24 = 2 stars, else 1 star).`,
    // 13. Tower stacker
    `Please make a tower stacking game. Blocks fall from top, one at a time. Left/Right arrows to move, Down to drop fast. Blocks stack on previous block. If new block overhangs too far (more than 50%), the overhanging part falls off. Block width shrinks to match landing area. Game over when block becomes too small (under 20px). White blocks on sky blue gradient background. Score = tower height in blocks. Show height counter.`,
    // 14. Bug whacker
    `Please make a whack-a-mole game with coding theme. 3x3 grid of dark code editor windows. Bug icons (beetle emoji or red circles) pop up in random windows for 1.5 seconds. Click to squash - normal bugs +10 points, golden bugs +30 points. Skull icon is a bomb - clicking it ends game immediately. 45-second round. Dark theme with syntax highlighting colors (green, orange, purple accents). Show score and time remaining. High score saved.`,
    // 15. Bouncy slime
    `Please make a one-button platformer. Green slime character bounces automatically left and right. Click anywhere to make slime jump toward click position. Yellow coins float in the air - collect for points. Red spikes on some platforms - touching them kills you. 5 static platforms arranged as a level. Collect all coins to win. Brown platforms, gold coins, green slime. Score = coins collected. 3 lives total.`,
    // 16. Color mixing
    `Please make a color mixing puzzle game. Three paint buckets at bottom: Red, Yellow, Blue (click to select). Mixing area in center. Target color shown at top. Drag selected color to mixing area. Red+Yellow=Orange, Yellow+Blue=Green, Red+Blue=Purple. Match the target color to score. 10 targets total. Clear mixing area with X button to retry. Artist studio beige background with paint splatter accents. Score based on targets matched. Timer bonus for fast matches.`,
    // 17. Shield defense
    `Please make a bullet hell defense game. Your ship is a white circle fixed in center. Enemies (red triangles) orbit around the edges firing red bullet dots toward center. Move mouse around your ship to position a shield arc (blocks bullets from that direction). Shield blocks 90 degrees. Bullets hitting you deal damage (100 HP). Enemies fire faster each wave. Show wave number, HP bar, time survived. Game over at 0 HP.`,
    // 18. Simple blackjack
    `Please make a blackjack card game against dealer. Start with 100 chips, bet 10 per hand. Two cards dealt to you (visible) and dealer (one hidden). Hit button for another card, Stand to stop. Bust over 21 = lose bet. Dealer reveals and draws to 17. Closer to 21 wins. Blackjack (21 with 2 cards) pays 1.5x. Green felt background. Cards shown as white rectangles with number/suit. Show your total, chips remaining. Game over when broke.`,
    // 19. Fog maze
    `Please make a maze escape game with fog of war. 11x11 grid maze with white walls on black background. Player is green square. Only cells within 2 tiles of player are visible, rest is dark fog. WASD to move one tile at a time. Yellow key somewhere in maze - collect it. Red door is exit - need key to open. Timer counts up from 0. Maze is fixed layout (not random). Find key, then find door to win. Show time and key status.`,
    // 20. Mini golf
    `Please make a top-down mini golf game. Green grass background with one hole. White ball, black hole with flag. Click ball and drag backward to aim (shows dotted line), release to hit. Longer drag = more power. Ball rolls with friction until stopping. Sand traps (tan) slow the ball. Water (blue) resets ball to last position. 5 holes total (advance on completion). Par shown per hole. Track total strokes. Win by completing all holes.`,
  ];

  const handleGenerateSample = () => {
    const randomPrompt = SAMPLE_PROMPTS[Math.floor(Math.random() * SAMPLE_PROMPTS.length)];
    setPrompt(randomPrompt);
    setHasUsedSample(true);
  };

  // Load the current pay-as-you-go balance.
  useEffect(() => {
    if (!token) return;
    fetch(`${config.backend_url}/api/ai/credits`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setCredits(data.credits);
          setCreditCost(data.cost || 5);
        }
      })
      .catch(() => {});
  }, [token]);

  // Handle return from credit purchase
  useEffect(() => {
    const sessionId = router.query.session_id;
    const creditsPurchased = router.query.credits_purchased;

    if (creditsPurchased && sessionId && token) {
      // Verify the purchase and update credits
      fetch(`${config.backend_url}/api/payment/verify-credit-purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sessionId })
      })
        .then(r => r.json())
        .then(data => {
          if (data.verified) {
            setCredits(data.credits);
            setSuccess(`Added ${data.creditsAdded || ''} credits!`);
            setTimeout(() => setSuccess(''), 3000);
          }
        })
        .catch(() => {});

      // Clean URL
      router.replace('/create', undefined, { shallow: true });
    }
  }, [router.query.session_id, router.query.credits_purchased, token, router]);

  // Load user's past games
  useEffect(() => {
    if (!token) return;
    fetch(`${config.backend_url}/api/games/mine`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setMyGames(data.games || []))
      .catch(() => {});
  }, [token]);

  const loadPromptHistory = useCallback(async (id = gameId) => {
    if (!id || !token) {
      setPromptHistory([]);
      return;
    }
    setIsLoadingPromptHistory(true);
    try {
      const res = await fetch(`${config.backend_url}/api/games/${id}/versions`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) return;
      const history = (data.versions || [])
        .filter(v => v.prompt_used && v.prompt_used.trim())
        .map(v => ({
          id: v.id,
          prompt: v.prompt_used,
          createdAt: v.created_at
        }));
      setPromptHistory(history);
    } catch (_) {
      // Prompt history is best-effort; don't block creator flow.
    } finally {
      setIsLoadingPromptHistory(false);
    }
  }, [token, gameId]);

  const syncGameStatus = useCallback(async (id) => {
    if (!id || !token) return null;
    const res = await fetch(`${config.backend_url}/api/games/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok || !data.game) throw new Error(data.error || 'Failed to load game');
    setLatestVerification(data.latestVerification || null);
    setLatestVersion(data.latestVersion || null);
    setPublishability(data.publishability || { isVerified: false, needsVerification: true });
    return data;
  }, [token]);

  useEffect(() => {
    if (!gameId || !token) {
      setPromptHistory([]);
      return;
    }
    loadPromptHistory(gameId);
  }, [gameId, token, loadPromptHistory]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!showMyGames) return;
    function handleClick(e) { if (myGamesRef.current && !myGamesRef.current.contains(e.target)) setShowMyGames(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMyGames]);

  const loadGameForEditing = useCallback(async (id) => {
    setShowMyGames(false);
    try {
      const data = await syncGameStatus(id);
      if (data.game) {
        setGameId(data.game.id);
        setTitle(data.game.title || '');
        setDescription(data.game.description || '');
        setHtml(data.game.html_content || '');
        setPrompt('');
        setError('');
        setSuccess('');
        setPromptHistory([]);
        setRevisionCost(2);
      }
    } catch (err) {
      setError(err.message || 'Failed to load game');
    }
  }, [syncGameStatus]);

  // Load existing game when editing (?edit=ID)
  useEffect(() => {
    const editId = router.query.edit;
    if (!editId || !token) return;
    setError('');
    async function loadGame() {
      try {
        const data = await syncGameStatus(editId);
        if (data.game) {
          setGameId(data.game.id);
          setTitle(data.game.title || '');
          setDescription(data.game.description || '');
          setHtml(data.game.html_content || '');
          setPromptHistory([]);
          setRevisionCost(2);
        }
      } catch (err) {
        setError(err.message || 'Failed to load game for editing');
      }
    }
    loadGame();
  }, [router.query.edit, token, syncGameStatus]);

  const startCheckout = useCallback(async (packId) => {
    if (checkoutPendingRef.current) return;
    checkoutPendingRef.current = true;
    setIsStartingCheckout(true);
    setCheckoutError('');
    try {
      const res = await fetch(`${config.backend_url}/api/payment/purchase-credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ packId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start checkout. Please try again.');
      let checkoutUrl;
      try {
        checkoutUrl = new URL(data.url);
      } catch {
        throw new Error('Unable to open secure checkout. Please try again.');
      }
      if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.stripe.com') {
        throw new Error('Unable to open secure checkout. Please try again.');
      }
      window.location.assign(checkoutUrl.href);
    } catch (err) {
      setCheckoutError(err instanceof TypeError ? 'Failed to start checkout. Please try again.' : err.message);
    } finally {
      checkoutPendingRef.current = false;
      setIsStartingCheckout(false);
    }
  }, [token]);

  // CreatorArena tutorial: first visit only
  useEffect(() => {
    if (hasStartedCreatorTourRef.current) return;
    if (!hasLoadedPersistedState) return;
    if (!user) return;
    if (isTourCompleted('creatorArena') || isTourDismissed('creatorArena')) return;
    try {
      const completed = JSON.parse(localStorage.getItem('codearena_tours_completed') || '{}');
      const dismissed = JSON.parse(localStorage.getItem('codearena_tour_dismissed') || '{}');
      if (completed['creatorArena'] || dismissed['creatorArena']) return;
    } catch (e) {}

    hasStartedCreatorTourRef.current = true;
    const timer = setTimeout(() => {
      startTour({
        ...creatorArenaTour,
        onComplete: (data) => {
          trackTourCompleted({
            tourId: data.tourId,
            totalTimeSeconds: data.totalTimeSeconds,
            stepsCompleted: data.stepsCompleted,
          }, user);
        },
        onSkip: (data) => {
          trackTourSkipped({
            tourId: data.tourId,
            skippedAtStep: data.skippedAtStep,
            totalSteps: data.totalSteps,
            timeSpentSeconds: data.timeSpentSeconds,
          }, user);
        },
      });
      trackTourStarted({ tourId: 'creatorArena', triggerType: 'auto' }, user);
    }, 900);
    return () => clearTimeout(timer);
  }, [user, hasLoadedPersistedState, startTour, isTourCompleted, isTourDismissed]);

  const generate = useCallback(async (mode = 'full', customPrompt = null) => {
    if (isGenerating) return;
    setIsGenerating(true);
    setError('');
    try {
      const res = await fetch(`${config.backend_url}/api/ai/generate-game`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          prompt: customPrompt || prompt,
          gameType: 'browser',
          mode,
          existingHtml: mode !== 'full' ? html : null,
          gameId: gameId || null
        })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'INSUFFICIENT_CREDITS') {
          setShowUpgradeModal(true);
          setCredits(data.credits);
        }
        setError(data.error || 'Generation failed');
        return;
      }
      setHtml(data.html);
      setLatestVerification(null);
      setPublishability({ isVerified: false, needsVerification: true });
      const promptUsed = (customPrompt || prompt || '').trim();
      if (promptUsed) {
        setPromptHistory(prev => [
          { id: `session-${Date.now()}`, prompt: promptUsed, createdAt: new Date().toISOString() },
          ...prev
        ].slice(0, 15));
      }
      // Update credits balance and revision cost after generation
      if (data.credits !== null && data.credits !== undefined) {
        setCredits(data.credits);
      }
      if (data.revisionCost !== undefined) {
        setRevisionCost(data.revisionCost);
      }
      if (!title) setTitle(prompt.slice(0, 60) || 'Untitled Game');
      if (customPrompt) setRevisionText('');
      setShowSaveReminder(true);
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, html, token, isGenerating, title, gameId]);

  const save = useCallback(async () => {
    if (!html || !title || isSaving) return;
    setIsSaving(true);
    setError('');
    try {
      const latestPromptUsed = promptHistory[0]?.prompt || prompt.trim() || null;
      if (gameId) {
        const res = await fetch(`${config.backend_url}/api/games/${gameId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ title, description, htmlContent: html, promptUsed: latestPromptUsed })
        });
        if (!res.ok) { const d = await res.json(); setError(d.error); return; }
        setSuccess('Saved!');
        setLatestVerification(null);
        setPublishability({ isVerified: false, needsVerification: true });
        await syncGameStatus(gameId);
      } else {
        const res = await fetch(`${config.backend_url}/api/games`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ title, description, gameType: 'browser', htmlContent: html, promptUsed: latestPromptUsed })
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error); return; }
        setGameId(data.gameId);
        setSuccess('Saved!');
        setShowSaveReminder(false);
        setLatestVerification(null);
        setPublishability({ isVerified: false, needsVerification: true });
        await syncGameStatus(data.gameId);
      }
      setShowSaveReminder(false);
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError('Failed to save');
    } finally {
      setIsSaving(false);
    }
  }, [html, title, description, gameId, token, isSaving, syncGameStatus, promptHistory, prompt]);

  const verifyGame = useCallback(async () => {
    if (!gameId || isVerifying) return;
    setIsVerifying(true);
    setError('');
    try {
      const res = await fetch(`${config.backend_url}/api/games/${gameId}/verify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Verification failed');
        return;
      }
      setLatestVerification(data.verification || null);
      setLatestVersion(data.latestVersion || null);
      setPublishability({
        isVerified: Boolean(data.verification?.overallStatus === 'passed'),
        needsVerification: Boolean(data.verification?.overallStatus !== 'passed')
      });
      setSuccess(data.success ? 'Verification passed!' : 'Verification failed');
      setTimeout(() => setSuccess(''), 2500);
    } catch (err) {
      setError('Failed to verify game');
    } finally {
      setIsVerifying(false);
    }
  }, [gameId, isVerifying, token]);

  const publish = useCallback(async () => {
    if (!gameId || isPublishing) return;
    setIsPublishing(true);
    setError('');
    try {
      const res = await fetch(`${config.backend_url}/api/games/${gameId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const d = await res.json();
        if (d.code === 'VERIFICATION_REQUIRED') {
          setLatestVerification(d.latestVerification || null);
          setPublishability({ isVerified: false, needsVerification: true });
        }
        setError(d.error);
        return;
      }
      setSuccess('Published to gallery!');
      setTimeout(() => router.push(`/gallery/${gameId}`), 1500);
    } catch (err) {
      setError('Failed to publish');
    } finally {
      setIsPublishing(false);
    }
  }, [gameId, token, isPublishing, router]);

  const pushToGitHub = useCallback(async () => {
    if (!gameId || isPushing) return;
    setIsPushing(true);
    setError('');
    try {
      const res = await fetch(`${config.backend_url}/api/games/${gameId}/github-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.needsAuth) {
        setError('GitHub not connected. Log in with GitHub to enable this feature.');
        return;
      }
      if (!res.ok) { setError(data.error); return; }
      setGithubUrl(data.url);
      setSuccess('Pushed to GitHub!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to push to GitHub');
    } finally {
      setIsPushing(false);
    }
  }, [gameId, token, isPushing]);

  return (
    <>
      <Head>
        <title>Create a Game - CodeArena</title>
        <meta name="description" content="Create playable browser games with AI. Describe your game idea and watch it come to life." />
      </Head>
      <div className="min-h-screen bg-surface-950 text-white">
        {/* Minimal header */}
        <header data-tour-step="creator-header" className="px-4 py-3 border-b border-surface-800/50 bg-surface-950/80 backdrop-blur-md flex items-center justify-between relative z-[200]">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Logo size="sm" />
            </Link>
            <div className="h-5 w-px bg-surface-700" />
            <span className="text-lg font-mono font-bold tracking-tight text-white flex items-center gap-2">
              CreatorArena
              <span className="text-accent-500 flex items-center gap-0.5">&lt;<Wand2 className="h-5 w-5 inline" />&gt;</span>
            </span>
            <div className="h-5 w-px bg-surface-700" />
            {/* Credits Badge */}
            <div data-tour-step="creator-credits" className="inline-flex">
            {credits !== null && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface-800/60 border border-surface-700 rounded-lg">
                <Coins className="h-3.5 w-3.5 text-primary-400" />
                <span className="text-xs font-semibold text-surface-200">{credits}</span>
                <span className="text-[10px] text-surface-500">credits</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => { setCheckoutError(''); setShowUpgradeModal(true); }}
              className="ml-2 text-xs text-primary-400 hover:text-primary-300"
            >
              Add credits
            </button>
            </div>
            <div data-tour-step="creator-alpha-badge" className="relative group flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg cursor-default">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Alpha Testing</span>
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 p-3 bg-surface-800 border border-surface-600 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                <p className="text-xs text-surface-300 leading-relaxed">CreatorArena is in early alpha. You may experience:</p>
                <ul className="mt-1.5 text-[11px] text-surface-400 space-y-1">
                  <li className="flex items-start gap-1.5"><span className="text-amber-400 mt-0.5">•</span>Games that don&apos;t render correctly</li>
                  <li className="flex items-start gap-1.5"><span className="text-amber-400 mt-0.5">•</span>Occasional generation failures</li>
                  <li className="flex items-start gap-1.5"><span className="text-amber-400 mt-0.5">•</span>Revision results may vary</li>
                </ul>
                <p className="mt-2 text-xs text-white font-semibold">To report feedback, go to the dashboard and click your profile picture. The dropdown has a <span className="text-amber-400 font-medium">Feedback</span> option.</p>
                <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-surface-800 border-l border-t border-surface-600 rotate-45" />
              </div>
            </div>
          </div>
          <div className="flex-1 px-4 max-w-md">
            <SearchBar inputClassName="w-full" />
          </div>
          <div className="flex items-center gap-3">
            {!isTourVisible && (
              <button
                onClick={() => {
                  resetTour('creatorArena');
                  try {
                    const completed = JSON.parse(localStorage.getItem('codearena_tours_completed') || '{}');
                    const dismissed = JSON.parse(localStorage.getItem('codearena_tour_dismissed') || '{}');
                    delete completed['creatorArena'];
                    delete dismissed['creatorArena'];
                    localStorage.setItem('codearena_tours_completed', JSON.stringify(completed));
                    localStorage.setItem('codearena_tour_dismissed', JSON.stringify(dismissed));
                  } catch (e) {}
                  setTimeout(() => {
                    startTour({ ...creatorArenaTour }, { force: true });
                  }, 100);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-surface-400 hover:text-cyan-400 hover:bg-surface-800/50 transition-colors"
                title="Replay tutorial"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">Tutorial</span>
              </button>
            )}
            <NotificationBell />
            <div className="flex items-center gap-2">
              <div className="relative" data-tour-step="creator-save">
                <Button variant="ghost" size="sm" onClick={save} loading={isSaving} disabled={!html || !title} className={`border ${showSaveReminder ? 'border-amber-500 bg-amber-500/10 animate-pulse' : 'border-surface-700'}`}>
                  <Save className="h-3.5 w-3.5 mr-1.5" /> Save
                </Button>
                {showSaveReminder && (
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-5 w-[28rem] z-50">
                    <ArrowUp className="h-10 w-10 text-amber-400 mx-auto mb-2.5 animate-bounce" />
                    <div className="bg-amber-500/10 border-2 border-amber-500/30 rounded-2xl px-8 py-6 text-xl text-amber-300 text-center leading-relaxed">
                      <span className="font-bold text-2xl">Save your game now!</span><br />
                      Navigating away will lose your progress.
                    </div>
                  </div>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={publish} loading={isPublishing} disabled={!gameId || publishability.needsVerification || showSaveReminder} className="border border-surface-700" data-tour-step="creator-publish">
                <Upload className="h-3.5 w-3.5 mr-1.5" /> Publish
              </Button>
              <Button variant="ghost" size="sm" onClick={verifyGame} loading={isVerifying} disabled={!gameId || isSaving || showSaveReminder} className="border border-surface-700" data-tour-step="creator-verify">
                <Check className="h-3.5 w-3.5 mr-1.5" /> Verify
              </Button>
              <Button variant="primary" size="sm" onClick={pushToGitHub} loading={isPushing} disabled={!gameId || showSaveReminder} data-tour-step="creator-push">
                <Github className="h-3.5 w-3.5 mr-1.5" /> Push
              </Button>
            </div>
            <Link href="/gallery" className="text-sm text-surface-300 hover:text-white transition-colors px-3 py-2 rounded-lg hover:bg-surface-800 border border-surface-700">
              <Gamepad2 className="h-4 w-4 inline mr-1.5" />Media Gallery
            </Link>
          </div>
        </header>
        <div className="flex h-[calc(100vh-52px)]">
          {/* Left Panel: Prompt Editor */}
          <div className="w-[400px] flex-shrink-0 border-r border-surface-800 flex flex-col">
            {/* Game Title + Folder */}
            <div className="px-4 pt-3 pb-0" data-tour-step="creator-game-title">
              <div className="flex items-center gap-2 pb-2 border-b border-surface-800">
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Game title..."
                  className="flex-1 bg-transparent text-sm font-bold text-white placeholder-surface-500 focus:outline-none"
                />
                <div className="relative flex-shrink-0" ref={myGamesRef}>
                  <button
                    onClick={() => setShowMyGames(!showMyGames)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-surface-400 hover:text-white bg-surface-800/60 hover:bg-surface-800 border border-surface-700 rounded-lg transition-colors"
                    title="My Games"
                    data-tour-step="creator-my-games"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    <ChevronDown className={`h-3 w-3 transition-transform ${showMyGames ? 'rotate-180' : ''}`} />
                  </button>
                  {showMyGames && (
                    <div className="absolute right-0 top-full mt-1 w-64 bg-surface-900 border border-surface-700 rounded-xl shadow-2xl overflow-hidden z-50">
                      <div className="px-3 py-2 border-b border-surface-800 text-[10px] font-semibold text-surface-500 uppercase tracking-wider">My Games</div>
                      <div className="max-h-60 overflow-y-auto">
                        {myGames.length === 0 ? (
                          <div className="py-4 text-center text-xs text-surface-500">No games yet</div>
                        ) : (
                          myGames.map(g => (
                            <button
                              key={g.id}
                              onClick={() => loadGameForEditing(g.id)}
                              className={`w-full text-left px-3 py-2.5 hover:bg-surface-800/50 transition-colors border-b border-surface-800/30 ${
                                gameId === g.id ? 'bg-primary-500/10' : ''
                              }`}
                            >
                              <div className="text-xs text-surface-200 font-medium truncate">{g.title}</div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className={`text-[10px] ${g.status === 'published' ? 'text-green-400' : 'text-surface-500'}`}>{g.status}</span>
                                <span className="text-[10px] text-surface-600">{new Date(g.updated_at).toLocaleDateString()}</span>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                      <button
                        onClick={() => {
                          setGameId(null);
                          setTitle('');
                          setDescription('');
                          setHtml('');
                          setPrompt('');
                          setPromptHistory([]);
                          setLatestVerification(null);
                          setLatestVersion(null);
                          setPublishability({ isVerified: false, needsVerification: false });
                          setShowMyGames(false);
                        }}
                        className="w-full px-3 py-2 text-xs text-primary-400 hover:bg-surface-800/50 transition-colors border-t border-surface-800 text-center"
                      >
                        + New Game
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Short description (shown in gallery)..."
                className="w-full bg-transparent text-xs text-surface-300 placeholder-surface-500 focus:outline-none py-2 border-b border-surface-800"
              />
            </div>

            {/* Prompt Input */}
            <div className="p-4 flex flex-col" data-tour-step="creator-prompt">
              <div className="flex flex-col">
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder={"Describe your game: mechanics, graphics, and story.\n\nExample: A retro-style space shooter where you pilot a spaceship through asteroid fields. The ship shoots lasers and collects power-ups. Neon color scheme on a dark starfield background."}
                  className="w-full h-[400px] bg-surface-800/30 text-surface-200 text-sm font-mono rounded-lg border border-surface-700 focus:border-primary-500 focus:outline-none p-4 resize-none placeholder-surface-500"
                />
                <button
                  onClick={handleGenerateSample}
                  disabled={isGenerating}
                  className={`mt-3 px-4 py-2 text-sm rounded-lg transition-colors ${
                    isGenerating
                      ? 'bg-surface-700 text-surface-500 cursor-not-allowed'
                      : 'bg-surface-300 text-surface-900 hover:bg-surface-200'
                  }`}
                >
                  {hasUsedSample ? 'Generate another please!' : 'Generate me a sample prompt!'}
                </button>
                {(() => {
                  const wc = prompt.trim().split(/\s+/).filter(w => w.length > 0).length;
                  const remaining = 10 - wc;
                  return (
                    <div className="mt-2">
                      {remaining > 0 ? (
                        <span className="text-xs text-red-400">{remaining} more word{remaining !== 1 ? 's' : ''} required to submit prompt</span>
                      ) : (
                        <span className="text-xs text-surface-500">{wc} words</span>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Generate Button + Controls */}
            <div className="p-5 border-t border-surface-800 space-y-4" data-tour-step="creator-generate">
              {(() => {
                const wc = prompt.trim().split(/\s+/).filter(w => w.length > 0).length;
                const hasContent = prompt.trim().length > 0;
                const isValid = wc >= 10;
                return (
                  <Button
                    variant="primary"
                    fullWidth
                    size="lg"
                    loading={isGenerating}
                    onClick={() => generate('full')}
                    disabled={!hasContent || !isValid || (credits !== null && credits < creditCost)}
                  >
                    {isGenerating ? 'Generating...' : html ? 'Regenerate (replaces entire game!)' : 'Generate Game'}
                    {!isGenerating && <Wand2 className="h-4 w-4 ml-2" />}
                    {credits !== null && !isGenerating && (
                      <span className="ml-2 text-xs opacity-75">({creditCost} credits)</span>
                    )}
                  </Button>
                );
              })()}

              {html && (
                <div className="space-y-3">
                  <textarea
                    value={revisionText}
                    onChange={e => setRevisionText(e.target.value)}
                    placeholder="Tell the AI what to change... (e.g. 'make the player faster', 'add a score counter', 'fix the collision bug')"
                    className="w-full bg-surface-800/30 text-surface-200 text-sm rounded-lg border border-surface-700 focus:border-primary-500 focus:outline-none px-3 py-3 resize-none placeholder-surface-600"
                    rows={3}
                    onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && revisionText.trim()) { e.preventDefault(); generate('revise', revisionText.trim()); } }}
                  />
                  <Button variant="primary" size="lg" fullWidth onClick={() => generate('revise', revisionText.trim())} loading={isGenerating} disabled={isGenerating || !revisionText.trim() || (credits !== null && credits < revisionCost)}>
                    Make Changes / Additions / Debug
                    {!isGenerating && (
                      <span className="ml-2 text-xs opacity-75">({revisionCost} credits)</span>
                    )}
                  </Button>
                </div>
              )}

              <div className="pt-2 border-t border-surface-800/80">
                {gameId && (
                  <div className="mb-3 rounded-lg border border-surface-700 bg-surface-800/30 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-surface-500">Verification</p>
                        <p className={`mt-1 text-sm ${
                          publishability.isVerified ? 'text-green-400' : 'text-amber-300'
                        }`}>
                          {publishability.isVerified ? 'Latest saved version is publishable' : 'Latest saved version still needs verification'}
                        </p>
                      </div>
                      {latestVersion && (
                        <span className="text-[11px] text-surface-500">v{latestVersion.versionNumber}</span>
                      )}
                    </div>
                    {latestVerification?.findings?.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {latestVerification.findings.slice(0, 3).map((finding, index) => (
                          <p key={`${finding.id || 'finding'}-${index}`} className={`text-[11px] ${
                            finding.severity === 'error' ? 'text-red-400' : 'text-amber-300'
                          }`}>
                            {finding.message}
                          </p>
                        ))}
                      </div>
                    )}
                    {showSaveReminder && (
                      <p className="mt-2 text-[11px] text-amber-300">
                        Save first. Verification only applies to saved versions.
                      </p>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-surface-500">
                    Prompt History
                  </h4>
                  {isLoadingPromptHistory && (
                    <span className="text-[10px] text-surface-600">Loading...</span>
                  )}
                </div>
                {promptHistory.length === 0 ? (
                  <p className="text-xs text-surface-600">
                    Your previous prompts will appear here after you generate.
                  </p>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                    {promptHistory.map(item => (
                      <details key={item.id} className="rounded-lg border border-surface-700 bg-surface-800/40 p-2">
                        <summary className="cursor-pointer text-xs text-surface-300 line-clamp-2">
                          {item.prompt.length > 110 ? `${item.prompt.slice(0, 110)}...` : item.prompt}
                        </summary>
                        <div className="mt-2">
                          <pre className="whitespace-pre-wrap text-[11px] text-surface-400 leading-relaxed">
                            {item.prompt}
                          </pre>
                          {item.createdAt && (
                            <p className="mt-1 text-[10px] text-surface-600">
                              {new Date(item.createdAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Panel: Preview */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Messages */}
            {error && (
              <div role="alert" className="mx-4 mt-3 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 flex items-center gap-2 text-sm text-red-400">
                <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
              </div>
            )}
            {success && (
              <div className="mx-4 mt-3 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2 flex items-center gap-2 text-sm text-green-400">
                <Check className="h-4 w-4 flex-shrink-0" /> {success}
                {githubUrl && <a href={githubUrl} target="_blank" rel="noopener noreferrer" className="underline ml-1">View on GitHub</a>}
              </div>
            )}

            {/* Game Preview */}
            <div className="flex-1 min-h-0 p-4" data-tour-step="creator-preview">
              {html ? (
                <div className="w-full h-full bg-surface-900 rounded-lg border border-surface-700 overflow-hidden">
                  <iframe
                    srcDoc={html}
                    sandbox="allow-scripts"
                    className="w-full h-full border-0"
                    title="Game Preview"
                  />
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-surface-900/50 rounded-lg border border-surface-800 border-dashed">
                  <div className="text-center">
                    <Gamepad2 className="h-16 w-16 text-surface-700 mx-auto mb-4" />
                    <p className="text-surface-500 text-lg font-medium mb-2">Your game will appear here</p>
                    <p className="text-surface-600 text-sm">Write a prompt and click Generate to create a playable game</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Credits Modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="creator-credits-title"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-surface-900 border border-surface-700 rounded-2xl max-w-lg w-full p-6"
          >
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-gradient-to-br from-amber-500/20 to-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Zap className="h-8 w-8 text-amber-400" />
              </div>
              <h2 id="creator-credits-title" className="text-xl font-bold text-white mb-2">CreatorArena credits</h2>
              <p className="text-surface-400 text-sm">
                Add a credit pack to continue creating with AI.
              </p>
            </div>

            <div className="bg-surface-800/50 rounded-xl p-4 mb-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-surface-300 text-sm">Your credits</span>
                <span className="text-white font-semibold">{credits || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-surface-300 text-sm">Cost per generation</span>
                <span className="text-white font-semibold">{creditCost}</span>
              </div>
            </div>

            <div className="space-y-4">
              {checkoutError && <p role="alert" className="text-sm text-red-400">{checkoutError}</p>}
              {isStartingCheckout && <p role="status" className="text-sm text-surface-300">Opening secure checkout...</p>}
              {/* Credit Packs */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => startCheckout('small')}
                  disabled={isStartingCheckout}
                  className="bg-surface-800/60 border border-surface-700 rounded-xl p-4 hover:border-primary-500/50 hover:bg-surface-800 transition-colors text-left"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Coins className="h-4 w-4 text-primary-400" />
                    <span className="text-white font-semibold">100 Credits</span>
                  </div>
                  <div className="text-primary-400 font-bold text-lg">$5</div>
                  <div className="text-xs text-surface-500">~20 generations</div>
                </button>

                <button
                  onClick={() => startCheckout('large')}
                  disabled={isStartingCheckout}
                  className="bg-surface-800/60 border border-surface-700 rounded-xl p-4 hover:border-primary-500/50 hover:bg-surface-800 transition-colors text-left relative"
                >
                  <div className="absolute -top-2 -right-2 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">BEST VALUE</div>
                  <div className="flex items-center gap-2 mb-2">
                    <Coins className="h-4 w-4 text-primary-400" />
                    <span className="text-white font-semibold">500 Credits</span>
                  </div>
                  <div className="text-primary-400 font-bold text-lg">$20</div>
                  <div className="text-xs text-surface-500">~100 generations</div>
                </button>
              </div>

              <button
                onClick={() => setShowUpgradeModal(false)}
                className="w-full py-2.5 text-sm text-surface-400 hover:text-white transition-colors"
              >
                Maybe later
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
}

export default withAuth(CreatePage);
