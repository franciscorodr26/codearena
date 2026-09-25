const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Allow LAN access in dev (phone testing via Wi-Fi). Production deploys ignore this.
  allowedDevOrigins: ['10.0.0.20', '127.0.0.1', 'localhost'],

  // Hide the Next.js dev mode build indicator (the floating "N" circle).
  // On mobile it overlaps the bottom-left nav tab and looks like a broken UI element.
  devIndicators: false,

  // Suppress hydration warnings in development
  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 2,
  },

  // Server-side redirects (better for SEO than client-side)
  async redirects() {
    return [
      {
        source: '/practice',
        has: [{ type: 'query', key: 'mode', value: 'prompting' }],
        destination: '/prompt-practice?mode=prompting',
        permanent: false,
      },
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.codearena.co' }],
        destination: 'https://codearena.co/:path*',
        permanent: true,
      },
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'playcodearena.com' }],
        destination: 'https://codearena.co/:path*',
        permanent: true,
      },
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.playcodearena.com' }],
        destination: 'https://codearena.co/:path*',
        permanent: true,
      },
      {
        source: '/leaderboard',
        destination: '/players',
        permanent: true, // 301 redirect
      },
    ];
  },

  // Rewrites for .well-known paths (AI discovery)
  async rewrites() {
    return [
      {
        source: '/.well-known/ai-plugin.json',
        destination: '/api/.well-known/ai-plugin.json',
      },
      {
        source: '/.well-known/security.txt',
        destination: '/api/.well-known/security.txt',
      },
      {
        source: '/openapi.json',
        destination: '/api/openapi.json',
      },
    ];
  },

  // Headers for proper content types
  async headers() {
    return [
      {
        source: '/llms.txt',
        headers: [
          { key: 'Content-Type', value: 'text/plain; charset=utf-8' },
          { key: 'Cache-Control', value: 'public, max-age=86400' },
        ],
      },
      {
        source: '/llms-full.txt',
        headers: [
          { key: 'Content-Type', value: 'text/plain; charset=utf-8' },
          { key: 'Cache-Control', value: 'public, max-age=86400' },
        ],
      },
      {
        source: '/humans.txt',
        headers: [
          { key: 'Content-Type', value: 'text/plain; charset=utf-8' },
        ],
      },
    ];
  },
};

// Sentry configuration options
const sentryWebpackPluginOptions = {
  // Suppresses source map uploading logs during build
  silent: true,

  // Upload source maps to Sentry
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Auth token for uploading source maps
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Hide source maps from clients
  hideSourceMaps: true,

  // Disable source map upload in development
  disableServerWebpackPlugin: process.env.NODE_ENV !== 'production',
  disableClientWebpackPlugin: process.env.NODE_ENV !== 'production',
};

// Only wrap with Sentry in production or if explicitly enabled
module.exports = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryWebpackPluginOptions)
  : nextConfig;
