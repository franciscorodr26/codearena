import { Page } from '@playwright/test';

export interface TestUser {
  slot: 1 | 2;
  label: string;
}

// Two local dev identities issued by POST /auth/dev-session (backend started
// with CODEARENA_DEV_AUTO_LOGIN=1 outside production). No seeded passwords.
export const TEST_USERS = {
  basic: { slot: 1 as const, label: 'dev user 1' },
  second: { slot: 2 as const, label: 'dev user 2' }
};

const BACKEND = process.env.E2E_BACKEND_URL || 'http://localhost:3001';

/**
 * Login helper for E2E tests: fetch a dev-session token and store it the way
 * the app's AuthContext expects, then open the dashboard.
 */
export async function login(page: Page, user: TestUser = TEST_USERS.basic) {
  const res = await fetch(`${BACKEND}/auth/dev-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot: user.slot })
  });
  if (!res.ok) throw new Error(`dev-session for ${user.label} failed: ${res.status}`);
  const dev = await res.json();
  await page.addInitScript(({ token, profile }) => {
    window.localStorage.setItem('auth_token', token);
    window.localStorage.setItem('auth_user', JSON.stringify(profile));
    window.localStorage.setItem('codearena_cookie_consent', JSON.stringify({ analytics: false, decided: true }));
  }, { token: dev.token, profile: dev.user });
  await page.goto('/dashboard');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
}

/**
 * Logout helper
 */
export async function logout(page: Page) {
  // Try to find and click logout button
  // This might be in a dropdown menu
  const logoutSelectors = [
    'button:has-text("Logout")',
    'button:has-text("Sign Out")',
    '[data-testid="logout-button"]'
  ];

  for (const selector of logoutSelectors) {
    try {
      await page.click(selector, { timeout: 2000 });
      break;
    } catch (e) {
      // Try next selector
    }
  }

  // Wait for redirect to login or home page
  await page.waitForURL(/\/(login|$)/, { timeout: 5000 });
}

/**
 * Check if user is logged in
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.waitForSelector('[data-testid="user-menu"], .user-profile', {
      timeout: 2000,
      state: 'attached'
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get authentication token from localStorage
 */
export async function getAuthToken(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    return localStorage.getItem('token') || localStorage.getItem('codearena-token');
  });
}

/**
 * Set authentication token in localStorage (for faster test setup)
 */
export async function setAuthToken(page: Page, token: string) {
  await page.evaluate((token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('codearena-token', token);
  }, token);
}

/**
 * Clear all authentication data
 */
export async function clearAuth(page: Page) {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}
