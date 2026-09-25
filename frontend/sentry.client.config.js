// This file configures the initialization of Sentry on the client.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only enable in production
  enabled: process.env.NODE_ENV === 'production',

  // Performance Monitoring
  tracesSampleRate: 0.1, // Capture 10% of transactions for performance monitoring

  // Session Replay (captures user sessions on errors)
  replaysSessionSampleRate: 0.1, // 10% of sessions
  replaysOnErrorSampleRate: 1.0, // 100% of sessions with errors

  // Filter out common non-critical errors
  ignoreErrors: [
    // Browser extensions
    /ResizeObserver loop/,
    /ResizeObserver loop completed with undelivered notifications/,
    // Network errors users can't control
    /Network request failed/,
    /Failed to fetch/,
    /Load failed/,
    // Cancelled requests
    /AbortError/,
    /The operation was aborted/,
  ],

  // Add user context when available
  beforeSend(event) {
    // Don't send events in development
    if (process.env.NODE_ENV !== 'production') {
      return null;
    }
    return event;
  },
});
