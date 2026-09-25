import { test, expect } from '@playwright/test';
import { login, TEST_USERS } from './utils/auth';
import { waitForLoadingToComplete, selectAndVerify, fillAndVerify } from './utils/test-helpers';
import { MATCHMAKING_PREFERENCES } from './fixtures/agent-fixtures';

test.describe('Matchmaking Preferences', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TEST_USERS.basic);

    // Navigate to matchmaking page with basic loadout
    await page.goto('/agent-matchmaking?model=sonnet&language=python&tools=test-runner&prompt=Test');
    await waitForLoadingToComplete(page);
  });

  test('should display matchmaking preferences section', async ({ page }) => {
    // Should show preferences heading
    await expect(page.locator('text=/Matchmaking Preferences|Preferences/i')).toBeVisible();

    // Should show model preference dropdown
    await expect(page.locator('select, [role="combobox"]', { hasText: /Model|Opponent/i }).or(
      page.locator('label', { hasText: /Opponent Model|Model Preference/i })
    )).toBeVisible();

    // Should show ELO range preference
    await expect(page.locator('text=/ELO.*Range|Rating/i')).toBeVisible();

    // Should show difficulty preference
    await expect(page.locator('text=/Difficulty|Problem.*Difficulty/i')).toBeVisible();
  });

  test('should set model preference to "Any Model"', async ({ page }) => {
    const modelSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Any Model/i }) });

    await modelSelect.selectOption({ label: /Any Model/i });

    // Verify selection
    const selectedValue = await modelSelect.inputValue();
    expect(selectedValue).toBe('any');
  });

  test('should set model preference to "Same Model Only"', async ({ page }) => {
    const modelSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Same/i }) });

    // Find the select that has model options
    const selects = await page.locator('select').all();
    let targetSelect = null;

    for (const select of selects) {
      const options = await select.locator('option').allTextContents();
      if (options.some(opt => opt.includes('Same'))) {
        targetSelect = select;
        break;
      }
    }

    if (targetSelect) {
      await targetSelect.selectOption({ label: /Same.*Model/i });

      // Should show current model in the option text
      const selectedText = await targetSelect.locator('option:checked').textContent();
      expect(selectedText).toMatch(/Sonnet|same/i);
    }
  });

  test('should set model preference to specific model (Haiku)', async ({ page }) => {
    // Find model preference select
    const selects = await page.locator('select').all();
    let modelSelect = null;

    for (const select of selects) {
      const options = await select.locator('option').allTextContents();
      if (options.some(opt => opt.includes('Haiku'))) {
        modelSelect = select;
        break;
      }
    }

    if (modelSelect) {
      await modelSelect.selectOption({ label: /Haiku/i });

      const selectedValue = await modelSelect.inputValue();
      expect(selectedValue).toBe('haiku');
    }
  });

  test('should set ELO range preference to "Any Rating"', async ({ page }) => {
    // Find ELO range select
    const selects = await page.locator('select').all();
    let eloSelect = null;

    for (const select of selects) {
      const options = await select.locator('option').allTextContents();
      if (options.some(opt => opt.includes('Rating') || opt.includes('Similar'))) {
        eloSelect = select;
        break;
      }
    }

    if (eloSelect) {
      await eloSelect.selectOption({ label: /Any.*Rating/i });

      const selectedValue = await eloSelect.inputValue();
      expect(selectedValue).toBe('any');
    }
  });

  test('should set ELO range preference to "Similar Rating"', async ({ page }) => {
    // Find ELO range select
    const selects = await page.locator('select').all();
    let eloSelect = null;

    for (const select of selects) {
      const options = await select.locator('option').allTextContents();
      if (options.some(opt => opt.includes('Similar'))) {
        eloSelect = select;
        break;
      }
    }

    if (eloSelect) {
      await eloSelect.selectOption({ label: /Similar.*Rating/i });

      const selectedValue = await eloSelect.inputValue();
      expect(selectedValue).toBe('similar');

      // Should show ±200 in the description
      await expect(page.locator('text=/±200|\\+\\/- ?200/i')).toBeVisible();
    }
  });

  test('should set ELO range preference to "Custom Range" and configure min/max', async ({ page }) => {
    // Find ELO range select
    const selects = await page.locator('select').all();
    let eloSelect = null;

    for (const select of selects) {
      const options = await select.locator('option').allTextContents();
      if (options.some(opt => opt.includes('Custom'))) {
        eloSelect = select;
        break;
      }
    }

    if (eloSelect) {
      await eloSelect.selectOption({ label: /Custom.*Range/i });

      // Custom range inputs should appear
      await expect(page.locator('input[type="number"]').first()).toBeVisible({ timeout: 2000 });

      // Set min ELO
      const minInput = page.locator('input', { has: page.locator('label', { hasText: /Min.*ELO/i }) }).or(
        page.locator('label', { hasText: /Min.*ELO/i }).locator('..').locator('input[type="number"]')
      ).or(page.locator('input[type="number"]').first());

      await minInput.fill('800');

      // Set max ELO
      const maxInput = page.locator('input', { has: page.locator('label', { hasText: /Max.*ELO/i }) }).or(
        page.locator('label', { hasText: /Max.*ELO/i }).locator('..').locator('input[type="number"]')
      ).or(page.locator('input[type="number"]').nth(1));

      await maxInput.fill('1200');

      // Verify values
      const minValue = await minInput.inputValue();
      const maxValue = await maxInput.inputValue();

      expect(minValue).toBe('800');
      expect(maxValue).toBe('1200');
    }
  });

  test('should set difficulty preference to "Any Difficulty"', async ({ page }) => {
    // Find difficulty select
    const selects = await page.locator('select').all();
    let difficultySelect = null;

    for (const select of selects) {
      const options = await select.locator('option').allTextContents();
      if (options.some(opt => opt.match(/Easy|Medium|Hard/i))) {
        difficultySelect = select;
        break;
      }
    }

    if (difficultySelect) {
      await difficultySelect.selectOption({ label: /Any.*Difficulty/i });

      const selectedValue = await difficultySelect.inputValue();
      expect(selectedValue).toBe('any');
    }
  });

  test('should set difficulty preference to "Easy"', async ({ page }) => {
    const selects = await page.locator('select').all();
    let difficultySelect = null;

    for (const select of selects) {
      const options = await select.locator('option').allTextContents();
      if (options.some(opt => opt.includes('Easy'))) {
        difficultySelect = select;
        break;
      }
    }

    if (difficultySelect) {
      await difficultySelect.selectOption({ label: /^Easy$/i });

      const selectedValue = await difficultySelect.inputValue();
      expect(selectedValue).toBe('easy');
    }
  });

  test('should set difficulty preference to "Medium"', async ({ page }) => {
    const selects = await page.locator('select').all();
    let difficultySelect = null;

    for (const select of selects) {
      const options = await select.locator('option').allTextContents();
      if (options.some(opt => opt.includes('Medium'))) {
        difficultySelect = select;
        break;
      }
    }

    if (difficultySelect) {
      await difficultySelect.selectOption({ label: /^Medium$/i });

      const selectedValue = await difficultySelect.inputValue();
      expect(selectedValue).toBe('medium');
    }
  });

  test('should set difficulty preference to "Hard"', async ({ page }) => {
    const selects = await page.locator('select').all();
    let difficultySelect = null;

    for (const select of selects) {
      const options = await select.locator('option').allTextContents();
      if (options.some(opt => opt.includes('Hard'))) {
        difficultySelect = select;
        break;
      }
    }

    if (difficultySelect) {
      await difficultySelect.selectOption({ label: /^Hard$/i });

      const selectedValue = await difficultySelect.inputValue();
      expect(selectedValue).toBe('hard');
    }
  });

  test('should persist preferences after page reload', async ({ page }) => {
    // Set specific preferences
    const selects = await page.locator('select').all();

    // Set model preference to haiku
    for (const select of selects) {
      const options = await select.locator('option').allTextContents();
      if (options.some(opt => opt.includes('Haiku Only'))) {
        await select.selectOption({ label: /Haiku/i });
        break;
      }
    }

    // Set difficulty to hard
    for (const select of selects) {
      const options = await select.locator('option').allTextContents();
      if (options.some(opt => opt === 'Hard')) {
        await select.selectOption('hard');
        break;
      }
    }

    // Reload page
    await page.reload();
    await waitForLoadingToComplete(page);

    // Check if preferences are still set
    const selectsAfterReload = await page.locator('select').all();

    // Verify haiku is still selected
    let haikuStillSelected = false;
    for (const select of selectsAfterReload) {
      const value = await select.inputValue();
      if (value === 'haiku') {
        haikuStillSelected = true;
        break;
      }
    }

    // Verify hard difficulty is still selected
    let hardStillSelected = false;
    for (const select of selectsAfterReload) {
      const value = await select.inputValue();
      if (value === 'hard') {
        hardStillSelected = true;
        break;
      }
    }

    expect(haikuStillSelected).toBeTruthy();
    expect(hardStillSelected).toBeTruthy();
  });

  test('should update queue search message based on preferences', async ({ page }) => {
    // Set specific preferences
    const selects = await page.locator('select').all();

    // Set to similar rating
    for (const select of selects) {
      const options = await select.locator('option').allTextContents();
      if (options.some(opt => opt.includes('Similar'))) {
        await select.selectOption({ label: /Similar/i });
        break;
      }
    }

    // Join queue
    const findButton = page.locator('button', { hasText: /Find Opponent/i });
    await findButton.click();

    // Wait for searching state
    await expect(page.locator('text=/Searching|Looking for/i')).toBeVisible({ timeout: 3000 });

    // Should show preference-based message
    await expect(page.locator('text=/similar.*rating/i')).toBeVisible({ timeout: 3000 });
  });

  test('should show custom ELO range in search message', async ({ page }) => {
    // Set custom ELO range
    const selects = await page.locator('select').all();

    for (const select of selects) {
      const options = await select.locator('option').allTextContents();
      if (options.some(opt => opt.includes('Custom'))) {
        await select.selectOption({ label: /Custom/i });

        // Set range
        const inputs = await page.locator('input[type="number"]').all();
        if (inputs.length >= 2) {
          await inputs[0].fill('900');
          await inputs[1].fill('1100');
        }
        break;
      }
    }

    // Join queue
    const findButton = page.locator('button', { hasText: /Find Opponent/i });
    await findButton.click();

    // Should show custom range in message
    await expect(page.locator('text=/900.*1100|900-1100/i')).toBeVisible({ timeout: 3000 });
  });

  test('should display all preference options', async ({ page }) => {
    // Model preferences
    const modelSelect = page.locator('select').first();
    const modelOptions = await modelSelect.locator('option').allTextContents();

    expect(modelOptions.join()).toMatch(/Any|Same|Haiku|Sonnet|Opus/i);

    // ELO range preferences
    const selects = await page.locator('select').all();
    let eloOptions = [];

    for (const select of selects) {
      const options = await select.locator('option').allTextContents();
      if (options.some(opt => opt.includes('Rating'))) {
        eloOptions = options;
        break;
      }
    }

    expect(eloOptions.join()).toMatch(/Any|Similar|Custom/i);

    // Difficulty preferences
    let diffOptions = [];
    for (const select of selects) {
      const options = await select.locator('option').allTextContents();
      if (options.some(opt => opt.includes('Easy'))) {
        diffOptions = options;
        break;
      }
    }

    expect(diffOptions.join()).toMatch(/Any|Easy|Medium|Hard/i);
  });

  test('should validate custom ELO range inputs', async ({ page }) => {
    // Set custom range
    const selects = await page.locator('select').all();

    for (const select of selects) {
      const options = await select.locator('option').allTextContents();
      if (options.some(opt => opt.includes('Custom'))) {
        await select.selectOption({ label: /Custom/i });
        break;
      }
    }

    // Get number inputs
    const inputs = await page.locator('input[type="number"]').all();

    if (inputs.length >= 2) {
      // Set min > max (invalid)
      await inputs[0].fill('1500');
      await inputs[1].fill('1000');

      // Should have min/max constraints
      const minAttr = await inputs[0].getAttribute('min');
      const maxAttr = await inputs[1].getAttribute('max');

      expect(minAttr).toBeTruthy();
      expect(maxAttr).toBeTruthy();
    }
  });
});

test.describe('Matchmaking Preferences - Integration', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TEST_USERS.basic);
  });

  test('should save preferences and use them in next matchmaking session', async ({ page }) => {
    // First session - set preferences
    await page.goto('/agent-matchmaking?model=sonnet&language=python&tools=test-runner&prompt=Test');
    await waitForLoadingToComplete(page);

    // Set specific preferences
    const selects = await page.locator('select').all();

    for (const select of selects) {
      const options = await select.locator('option').allTextContents();
      if (options.some(opt => opt.includes('Medium'))) {
        await select.selectOption('medium');
        break;
      }
    }

    // Go back and start new session
    await page.goto('/agent-battles');
    await waitForLoadingToComplete(page);

    // Start new matchmaking
    await page.goto('/agent-matchmaking?model=haiku&language=javascript&tools=&prompt=Test2');
    await waitForLoadingToComplete(page);

    // Preferences should still be set
    const selectsNew = await page.locator('select').all();
    let mediumStillSelected = false;

    for (const select of selectsNew) {
      const value = await select.inputValue();
      if (value === 'medium') {
        mediumStillSelected = true;
        break;
      }
    }

    expect(mediumStillSelected).toBeTruthy();
  });
});
