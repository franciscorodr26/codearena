// This file configures the initialization of Sentry on the server.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only enable in production
  enabled: process.env.NODE_ENV === 'production',

  // Performance Monitoring
  tracesSampleRate: 0.1, // Capture 10% of transactions

  // Filter out non-critical errors
  ignoreErrors: [
    /ECONNRESET/,
    /ETIMEDOUT/,
    /socket hang up/,
  ],
});
