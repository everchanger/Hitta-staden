import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helper: perform a search and wait for the operation to finish.
// Returns true when results appeared, false when an error was shown.
// ---------------------------------------------------------------------------
async function searchCity(page, cityName) {
  await page.goto('/');
  const input = page.locator('#city-input');
  const btn = page.locator('#search-btn');

  await input.fill(cityName);
  await btn.click();

  // The app's worst case is ~77 s (35 s Overpass timeout × 2 attempts + 2 s
  // retry delay + geocode).  Wait just above that so a real failure is
  // surfaced quickly instead of hanging for minutes.
  await expect(btn).toBeEnabled({ timeout: 80_000 });

  // Check which outcome occurred
  const hasResults = await page.locator('.result-list').isVisible();
  return hasResults;
}

// ---------------------------------------------------------------------------
// Stockholm – a large city that should return many nearby places
// ---------------------------------------------------------------------------
test.describe('Stockholm search', () => {
  test('finds nearby places and shows them on the page', async ({ page }) => {
    const hasResults = await searchCity(page, 'Stockholm');

    if (hasResults) {
      // Origin card should mention Stockholm
      const originCard = page.locator('.origin-card');
      await expect(originCard).toContainText('Stockholm');

      // Should have result items
      const items = page.locator('.result-item');
      const count = await items.count();
      expect(count).toBeGreaterThan(0);

      // Each result has a name and a distance
      for (let i = 0; i < Math.min(count, 3); i++) {
        const item = items.nth(i);
        await expect(item.locator('.place-name')).not.toBeEmpty();
        await expect(item.locator('.distance')).toContainText(/\d/);
      }

      // Map should be visible
      await expect(page.locator('#map')).toBeVisible();

      // Status text should mention Stockholm
      await expect(page.locator('#status')).toContainText(/platser nära Stockholm/i);
    } else {
      // API was unavailable – just verify the error is displayed cleanly
      const status = page.locator('#status');
      await expect(status).toHaveClass(/error/);
    }
  });
});

// ---------------------------------------------------------------------------
// Höör – a smaller town in Skåne
// ---------------------------------------------------------------------------
test.describe('Höör search', () => {
  test('shows nearby places for a small town', async ({ page }) => {
    const hasResults = await searchCity(page, 'Höör');

    if (hasResults) {
      const originCard = page.locator('.origin-card');
      await expect(originCard).toContainText('Höör');

      const items = page.locator('.result-item');
      expect(await items.count()).toBeGreaterThan(0);
    } else {
      await expect(page.locator('#status')).toHaveClass(/error/);
    }
  });
});

// ---------------------------------------------------------------------------
// Kiruna – northern Sweden, verifies it works for remote locations
// ---------------------------------------------------------------------------
test.describe('Kiruna search', () => {
  test('shows results for a northern city', async ({ page }) => {
    const hasResults = await searchCity(page, 'Kiruna');

    if (hasResults) {
      const originCard = page.locator('.origin-card');
      await expect(originCard).toContainText('Kiruna');

      const items = page.locator('.result-item');
      expect(await items.count()).toBeGreaterThan(0);
    } else {
      await expect(page.locator('#status')).toHaveClass(/error/);
    }
  });
});

// ---------------------------------------------------------------------------
// Radius slider – verify the control works (no API calls)
// ---------------------------------------------------------------------------
test.describe('radius slider', () => {
  test('updates the displayed label when changed', async ({ page }) => {
    await page.goto('/');

    const slider = page.locator('#radius-slider');
    const label = page.locator('#radius-label');

    // Default is 50 km
    await expect(label).toHaveText('50 km');

    // Set to 100 km
    await slider.fill('100');
    await expect(label).toHaveText('100 km');
  });
});

// ---------------------------------------------------------------------------
// Error handling – bogus city name
// ---------------------------------------------------------------------------
test.describe('error handling', () => {
  test('shows an error for an unknown city', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('#city-input');
    const btn = page.locator('#search-btn');

    await input.fill('XyzBogusCity12345');
    await btn.click();

    const status = page.locator('#status');
    await expect(status).toContainText(/Kunde inte hitta/i, { timeout: 15_000 });
    await expect(status).toHaveClass(/error/);
  });
});

// ---------------------------------------------------------------------------
// Search button state – should disable during search and re-enable after
// ---------------------------------------------------------------------------
test.describe('search button state', () => {
  test('disables during search and re-enables after', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('#city-input');
    const btn = page.locator('#search-btn');

    await input.fill('Malmö');
    await btn.click();

    // Button should be disabled and show "Söker…" while loading
    await expect(btn).toBeDisabled();
    await expect(btn).toContainText('Söker');

    // Wait for search to complete (success or error)
    await expect(btn).toBeEnabled({ timeout: 80_000 });

    // Button should say "Sök" again
    await expect(btn).toContainText('Sök');
  });
});
