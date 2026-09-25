import { ImageResponse } from '@vercel/og';
import { config as appConfig } from '../../../../config/env';

export const config = {
  runtime: 'edge',
};

// Rank thresholds matching backend/elo.js
const getRankInfo = (rating) => {
  if (rating >= 2200) return { name: 'Grandmaster', color: '#ef4444', icon: '👑' };
  if (rating >= 2000) return { name: 'Master', color: '#a855f7', icon: '💎' };
  if (rating >= 1800) return { name: 'Diamond', color: '#22d3ee', icon: '💠' };
  if (rating >= 1600) return { name: 'Platinum', color: '#3b82f6', icon: '🔷' };
  if (rating >= 1400) return { name: 'Gold', color: '#eab308', icon: '🥇' };
  if (rating >= 1200) return { name: 'Silver', color: '#9ca3af', icon: '🥈' };
  return { name: 'Bronze', color: '#f97316', icon: '🥉' };
};

// Avatar emoji mapping
const avatarEmojis = {
  'default-1': '😀', 'default-2': '😎', 'default-3': '🤓', 'default-4': '🧑‍💻',
  'default-5': '👨‍💻', 'default-6': '👩‍💻', 'default-7': '🦊', 'default-8': '🐱',
  'default-9': '🐶', 'default-10': '🦁', 'default-11': '🐯', 'default-12': '🐻',
  'default-13': '🐼', 'default-14': '🐨', 'default-15': '🦄', 'default-16': '🐲',
  'default-17': '🤖', 'default-18': '👾', 'default-19': '🎮', 'default-20': '⚡',
  'default-21': '🔥', 'default-22': '💀', 'default-23': '👻', 'default-24': '🎯',
};

export default async function handler(req) {
  try {
    const { searchParams, pathname } = new URL(req.url);
    const username = pathname.split('/').pop();

    if (!username) {
      return new Response('Username required', { status: 400 });
    }

    // Fetch user data from backend
    const res = await fetch(`${appConfig.backend_url}/api/users/${encodeURIComponent(username)}`);

    if (!res.ok) {
      // Return a fallback image for unknown users
      return new ImageResponse(
        (
          <div
            style={{
              height: '100%',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#0f172a',
              backgroundImage: 'radial-gradient(circle at 25% 25%, #1e1b4b 0%, transparent 50%), radial-gradient(circle at 75% 75%, #312e81 0%, transparent 50%)',
            }}
          >
            <div style={{ fontSize: 48, color: '#94a3b8', display: 'flex' }}>User not found</div>
          </div>
        ),
        { width: 1200, height: 630 }
      );
    }

    const data = await res.json();
    const { user, stats } = data;
    const rank = getRankInfo(stats?.rating || 1000);
    const avatar = avatarEmojis[user?.avatar] || '🧑‍💻';
    const winRate = stats?.wins + stats?.losses > 0
      ? Math.round((stats.wins / (stats.wins + stats.losses)) * 100)
      : 0;

    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#0f172a',
            backgroundImage: 'radial-gradient(circle at 20% 20%, #1e1b4b 0%, transparent 40%), radial-gradient(circle at 80% 80%, #312e81 0%, transparent 40%)',
            padding: 60,
          }}
        >
          {/* Top section with avatar and name */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 40 }}>
            {/* Avatar */}
            <div
              style={{
                width: 160,
                height: 160,
                borderRadius: 80,
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 80,
                marginRight: 40,
                boxShadow: '0 0 40px rgba(99, 102, 241, 0.4)',
              }}
            >
              {avatar}
            </div>

            {/* Name and rank */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 72, fontWeight: 'bold', color: '#ffffff', marginBottom: 8, display: 'flex' }}>
                {user?.username || 'Unknown'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 36, display: 'flex' }}>{rank.icon}</span>
                <span style={{ fontSize: 36, color: rank.color, fontWeight: 600, display: 'flex' }}>{rank.name}</span>
                {user?.is_pro && (
                  <div
                    style={{
                      background: 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
                      padding: '8px 16px',
                      borderRadius: 20,
                      fontSize: 24,
                      fontWeight: 600,
                      color: '#000',
                      marginLeft: 16,
                      display: 'flex',
                    }}
                  >
                    PRO
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div style={{ display: 'flex', gap: 30, marginBottom: 40 }}>
            {/* Rating */}
            <div
              style={{
                flex: 1,
                background: 'rgba(99, 102, 241, 0.15)',
                borderRadius: 20,
                padding: '30px 40px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                border: '1px solid rgba(99, 102, 241, 0.3)',
              }}
            >
              <div style={{ fontSize: 56, fontWeight: 'bold', color: '#818cf8', display: 'flex' }}>
                {stats?.rating || 1000}
              </div>
              <div style={{ fontSize: 24, color: '#94a3b8', display: 'flex' }}>Rating</div>
            </div>

            {/* Wins */}
            <div
              style={{
                flex: 1,
                background: 'rgba(34, 197, 94, 0.15)',
                borderRadius: 20,
                padding: '30px 40px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                border: '1px solid rgba(34, 197, 94, 0.3)',
              }}
            >
              <div style={{ fontSize: 56, fontWeight: 'bold', color: '#4ade80', display: 'flex' }}>
                {stats?.wins || 0}
              </div>
              <div style={{ fontSize: 24, color: '#94a3b8', display: 'flex' }}>Wins</div>
            </div>

            {/* Losses */}
            <div
              style={{
                flex: 1,
                background: 'rgba(239, 68, 68, 0.15)',
                borderRadius: 20,
                padding: '30px 40px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                border: '1px solid rgba(239, 68, 68, 0.3)',
              }}
            >
              <div style={{ fontSize: 56, fontWeight: 'bold', color: '#f87171', display: 'flex' }}>
                {stats?.losses || 0}
              </div>
              <div style={{ fontSize: 24, color: '#94a3b8', display: 'flex' }}>Losses</div>
            </div>

            {/* Win Rate */}
            <div
              style={{
                flex: 1,
                background: 'rgba(168, 85, 247, 0.15)',
                borderRadius: 20,
                padding: '30px 40px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                border: '1px solid rgba(168, 85, 247, 0.3)',
              }}
            >
              <div style={{ fontSize: 56, fontWeight: 'bold', color: '#c084fc', display: 'flex' }}>
                {winRate}%
              </div>
              <div style={{ fontSize: 24, color: '#94a3b8', display: 'flex' }}>Win Rate</div>
            </div>
          </div>

          {/* Bio if exists */}
          {user?.bio && (
            <div
              style={{
                fontSize: 28,
                color: '#cbd5e1',
                marginBottom: 30,
                lineHeight: 1.4,
                display: 'flex',
                maxWidth: '100%',
              }}
            >
              "{user.bio.length > 120 ? user.bio.slice(0, 120) + '...' : user.bio}"
            </div>
          )}

          {/* Social Links */}
          {(user?.github_url || user?.linkedin_url || user?.twitter_url) && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 30 }}>
              {user?.github_url && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'rgba(51, 51, 51, 0.8)',
                    padding: '10px 20px',
                    borderRadius: 30,
                  }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                  </svg>
                  <span style={{ color: 'white', fontSize: 20, display: 'flex' }}>GitHub</span>
                </div>
              )}
              {user?.linkedin_url && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'rgba(10, 102, 194, 0.9)',
                    padding: '10px 20px',
                    borderRadius: 30,
                  }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                  <span style={{ color: 'white', fontSize: 20, display: 'flex' }}>LinkedIn</span>
                </div>
              )}
              {user?.twitter_url && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'rgba(0, 0, 0, 0.8)',
                    padding: '10px 20px',
                    borderRadius: 30,
                  }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                  <span style={{ color: 'white', fontSize: 20, display: 'flex' }}>X</span>
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div
            style={{
              marginTop: 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: 40, display: 'flex' }}>⚔️</span>
              <span
                style={{
                  fontSize: 40,
                  fontWeight: 'bold',
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #06b6d4 100%)',
                  backgroundClip: 'text',
                  color: 'transparent',
                  display: 'flex',
                }}
              >
                CodeArena
              </span>
            </div>
            <div style={{ fontSize: 28, color: '#64748b', display: 'flex' }}>
              codearena.co/profile/{user?.username}
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
  } catch (error) {
    console.error('OG Image generation error:', error);
    return new Response('Failed to generate image', { status: 500 });
  }
}
