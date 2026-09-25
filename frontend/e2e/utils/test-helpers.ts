import { Page, expect } from '@playwright/test';

/**
 * Wait for network idle (useful after navigation or form submissions)
 */
export async function waitForNetworkIdle(page: Page, timeout = 5000) {
  await page.waitForLoadState('networkidle', { timeout });
}

/**
 * Wait for element to be visible and stable
 */
export async function waitForElement(page: Page, selector: string, timeout = 5000) {
  await page.waitForSelector(selector, { state: 'visible', timeout });
  // Wait a bit for animations to complete
  await page.waitForTimeout(300);
}

/**
 * Click and wait for navigation
 */
export async function clickAndWaitForNavigation(page: Page, selector: string) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click(selector)
  ]);
}

/**
 * Fill form field and verify
 */
export async function fillAndVerify(page: Page, selector: string, value: string) {
  await page.fill(selector, value);
  const inputValue = await page.inputValue(selector);
  expect(inputValue).toBe(value);
}

/**
 * Select option from dropdown and verify
 */
export async function selectAndVerify(page: Page, selector: string, value: string) {
  await page.selectOption(selector, value);
  const selectedValue = await page.inputValue(selector);
  expect(selectedValue).toBe(value);
}

/**
 * Wait for toast/notification message
 */
export async function waitForToast(page: Page, expectedText?: string, timeout = 5000) {
  const toastSelectors = [
    '.toast',
    '[role="alert"]',
    '.notification',
    '.success-message',
    '.error-message'
  ];

  for (const selector of toastSelectors) {
    try {
      const toast = await page.waitForSelector(selector, { timeout: 2000 });
      if (expectedText) {
        const text = await toast.textContent();
        if (text?.includes(expectedText)) {
          return toast;
        }
      } else {
        return toast;
      }
    } catch {
      // Try next selector
    }
  }

  if (expectedText) {
    throw new Error(`Toast with text "${expectedText}" not found`);
  }
  throw new Error('No toast message found');
}

/**
 * Wait for loading to complete
 */
export async function waitForLoadingToComplete(page: Page, timeout = 10000) {
  // Wait for common loading indicators to disappear
  const loadingSelectors = [
    '.loading',
    '.spinner',
    '[data-testid="loading"]',
    '.animate-spin'
  ];

  for (const selector of loadingSelectors) {
    try {
      await page.waitForSelector(selector, { state: 'hidden', timeout: 2000 });
    } catch {
      // Selector not found or already hidden
    }
  }

  // Also wait for network to be idle
  await page.waitForLoadState('networkidle', { timeout });
}

/**
 * Take a screenshot with a descriptive name
 */
export async function takeScreenshot(page: Page, name: string) {
  await page.screenshot({
    path: `e2e/screenshots/${name}-${Date.now()}.png`,
    fullPage: true
  });
}

/**
 * Scroll element into view
 */
export async function scrollIntoView(page: Page, selector: string) {
  await page.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, selector);
  await page.waitForTimeout(500);
}

/**
 * Get text content of element
 */
export async function getTextContent(page: Page, selector: string): Promise<string> {
  const element = await page.waitForSelector(selector);
  const text = await element.textContent();
  return text?.trim() || '';
}

/**
 * Check if element exists (without throwing)
 */
export async function elementExists(page: Page, selector: string): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout: 2000, state: 'attached' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for text to appear on page
 */
export async function waitForText(page: Page, text: string, timeout = 5000) {
  await page.waitForSelector(`text=${text}`, { timeout });
}

/**
 * Mock API response
 */
export async function mockApiResponse(
  page: Page,
  url: string | RegExp,
  response: any,
  status = 200
) {
  await page.route(url, (route) => {
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(response)
    });
  });
}

/**
 * Wait for WebSocket connection
 */
export async function waitForWebSocket(page: Page, timeout = 5000) {
  await page.waitForFunction(
    () => {
      // Check if Socket.io is connected
      return (window as any).io && (window as any).io.connected;
    },
    { timeout }
  );
}
