import {
  Home, Crown, Users, MessageSquare, BarChart3, User, Settings, BookOpen,
} from 'lucide-react';
import { modesForSearch } from './modes';

/**
 * Single source of truth for global navigation / search commands.
 *
 * Both the dashboard SearchBar and the global Cmd+K CommandPalette import this,
 * so a nav target is registered exactly once and can never silently fall out of
 * one search surface.
 *
 * Game modes / products come from the canonical mode registry (lib/modes.js)
 * via modesForSearch(), so adding a mode there makes it searchable automatically.
 * Only non-mode destinations (account, social, pages) are listed inline here.
 *
 * Each entry: { label, path, icon, keywords, requiresAuth?, dynamic? }.
 * `dynamic` entries (e.g. the profile) are expanded to `${path}/${username}`
 * for a signed-in user via resolveCommandPath().
 *
 */
export const NAV_COMMANDS = [
  { label: 'Home', path: '/', icon: Home, keywords: ['home', 'landing', 'main'] },
  ...modesForSearch(),
  { label: 'Leaderboard', path: '/players', icon: Crown, keywords: ['leaderboard', 'ranking', 'top', 'players'] },
  { label: 'Friends', path: '/friends', icon: Users, keywords: ['friends', 'social', 'people', 'add'], requiresAuth: true },
  { label: 'Messages', path: '/messages', icon: MessageSquare, keywords: ['messages', 'chat', 'dm', 'inbox'], requiresAuth: true },
  { label: 'My Analytics', path: '/analytics', icon: BarChart3, keywords: ['analytics', 'stats', 'progress', 'performance', 'history'], requiresAuth: true },
  { label: 'My Profile', path: '/profile', icon: User, keywords: ['profile', 'account', 'me'], requiresAuth: true, dynamic: true },
  { label: 'Settings', path: '/settings/profile', icon: Settings, keywords: ['settings', 'preferences', 'config', 'account'], requiresAuth: true },
  { label: 'Game Modes', path: '/modes', icon: BookOpen, keywords: ['modes', 'game', 'options', 'guide'] },
];

/**
 * Resolve a command's destination, expanding dynamic entries (e.g. profile) to
 * include the signed-in user's username. Falls back to the base path otherwise.
 */
export function resolveCommandPath(cmd, user) {
  return cmd.dynamic && user?.username ? `${cmd.path}/${user.username}` : cmd.path;
}
