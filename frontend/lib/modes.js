import {
  Target, Users, Trophy, Swords, Wand2, Gamepad2, Sparkles, Bot,
} from 'lucide-react';

/**
 * Canonical registry of CodeArena game modes / products.
 *
 * Single source of truth for the /modes page (pages/modes.js), the PlayMenu
 * dropdown (components/PlayMenu.js), and global search (lib/navCommands.js).
 * Shared identity (title, route, icon, color) lives at the top level; each
 * surface's presentation is nested so a mode is defined exactly once and can
 * never drift between surfaces again.
 *
 *   modesPage: card content for the /modes page (omit => not shown there)
 *   playMenu:  dropdown content for the PlayMenu (omit => not shown there)
 *   search:    keyword metadata for search / Cmd+K (omit => not searchable)
 *
 * Order matters: the /modes page renders hero (practice) + the remaining
 * modesPage entries as its 4 corners, and the PlayMenu renders its featured
 * entry + the rest, so this order reproduces both layouts.
 */
export const MODES = [
  {
    id: 'practice', title: 'Solo Practice', route: '/practice', icon: Target, color: 'green',
    search: { keywords: ['practice', 'train', 'code', 'solve', 'solo'] },
    playMenu: { tagline: 'Build skill, no pressure' },
    modesPage: {
      subtitle: 'Sharpen your skills',
      description: 'Quick coding and prompting warm-ups. Keep a streak going between battles, or shake off the rust before one.',
      features: ['Quick warm-ups', 'Original problems', 'JavaScript, Python, TypeScript', 'No pressure', 'Prompting practice mode'],
      cta: 'Start Practicing',
      badge: 'Start Here',
    },
  },
  {
    id: 'matchmaking', title: 'Quick Match', route: '/matchmaking', icon: Users, color: 'cyan',
    search: { keywords: ['battle', 'fight', 'play', 'match', 'pvp', 'quick'] },
    playMenu: { tagline: 'Find an opponent instantly', featured: true, badge: 'Popular' },
    modesPage: {
      subtitle: 'Find opponent instantly',
      description: 'Get matched with developers worldwide for a live coding or prompt-engineering battle.',
      features: ['Auto-matching', 'Skill-based pairing', 'Coding or prompt battles', 'Fast setup'],
    },
  },
  {
    id: 'tournaments', title: 'Tournaments', route: '/tournaments', icon: Trophy, color: 'yellow',
    search: { keywords: ['tournament', 'bracket', 'compete', 'competition'] },
    playMenu: { tagline: 'Bracket competitions' },
    modesPage: {
      subtitle: 'Bracket competitions',
      description: 'Join scheduled bracket-style competitions. Rise through the rounds and claim victory.',
      features: ['Bracket format', 'Win prizes', 'Create your own', 'Scheduled events'],
    },
  },
  {
    id: 'private', title: 'Private Battle', route: '/battle', icon: Swords, color: 'rose',
    search: { keywords: ['private', 'friend', 'challenge', 'invite', 'battle'] },
    playMenu: { tagline: 'Challenge a friend' },
    modesPage: {
      subtitle: 'Challenge a friend',
      description: 'Invite friends or find online players to battle. Challenge them directly and compete head-to-head.',
      features: ['Direct invites', 'Find online players', 'Friend vs friend', 'Custom setup'],
    },
  },
  {
    id: 'create', title: 'Game Creator', route: '/create', icon: Wand2, color: 'cyan',
    search: { keywords: ['create', 'build', 'make', 'game', 'generator'], requiresAuth: true },
    playMenu: { tagline: 'Build games with AI', badge: 'New' },
    modesPage: {
      subtitle: 'Create with AI',
      description: 'Turn an idea into a playable game, then share it with the CodeArena community.',
      features: ['AI-assisted creation', 'Playable projects', 'Share with friends', 'Publish to Gallery'],
    },
  },
  {
    id: 'gallery', title: 'Media Gallery', route: '/gallery', icon: Gamepad2, color: 'green',
    search: { keywords: ['gallery', 'games', 'community', 'browse'] },
    playMenu: { tagline: 'Play community games' },
  },
  // Prompt Battle is a battle *type*, not a standalone format: it is selectable
  // inside Quick Match, so it is no longer a separate
  // /modes card (avoids type-as-format redundancy). Still searchable; route lives on.
  { id: 'prompt-battle', title: 'Prompt Battle', route: '/prompt-battle', icon: Sparkles, color: 'purple',
    search: { keywords: ['prompt', 'engineering', 'llm', 'prompting', 'battle'] } },
  { id: 'bot-battle', title: 'Practice vs Bot', route: '/bot-battle', icon: Bot, color: 'amber',
    search: { keywords: ['bot', 'ai opponent', 'bot battle'] },
    modesPage: { section: 'more', subtitle: 'Warm up vs AI', description: 'Practice against an AI opponent at your own pace. No pressure, instant rematches.', features: ['Adjustable difficulty', 'No pressure', 'Instant rematch'] } },
  { id: 'challenge', title: 'Weekly Challenge', route: '/challenge', icon: Trophy, color: 'amber',
    search: { keywords: ['challenge', 'weekly', 'competition'] } },
];

// Surface adapters: each returns exactly the shape that surface already renders,
// so the consuming components keep their existing markup untouched.

function toPageCard(m) {
  return { id: m.id, title: m.title, route: m.route, icon: m.icon, color: m.color, ...m.modesPage };
}

/** Primary cards for the /modes X-layout (hero = practice + up to 4 corners). */
export function modesForPage() {
  return MODES.filter((m) => m.modesPage && m.modesPage.section !== 'more').map(toPageCard);
}

/** Secondary cards for the "More ways to play" grid below the X-layout. */
export function modesForPageMore() {
  return MODES.filter((m) => m.modesPage && m.modesPage.section === 'more').map(toPageCard);
}

/** Tiles for the PlayMenu dropdown (one is `featured`). */
export function modesForPlayMenu() {
  return MODES.filter((m) => m.playMenu).map((m) => ({
    id: m.id, title: m.title, route: m.route, icon: m.icon, color: m.color,
    description: m.playMenu.tagline,
    badge: m.playMenu.badge,
    featured: m.playMenu.featured || false,
  }));
}

/** NAV_COMMANDS entries for the search bar / Cmd+K palette. */
export function modesForSearch() {
  return MODES.filter((m) => m.search).map((m) => ({
    label: m.title,
    path: m.route,
    icon: m.icon,
    keywords: m.search.keywords,
    ...(m.search.requiresAuth ? { requiresAuth: true } : {}),
  }));
}
