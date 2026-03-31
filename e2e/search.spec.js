import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helper: perform a search and wait for it to complete.
// Returns 'results' when the result list appeared, 'empty' when the app
// reported no places found, or 'error' when an error was shown.
// ---------------------------------------------------------------------------
async function searchCity(page, cityName) {
  await page.goto('/');
  const input = page.locator('#city-input');
  const btn = page.locator('#search-btn');

  await input.fill(cityName);
  await btn.click();

  // Wait for the search to finish — button re-enables on completion
  await expect(btn).toBeEnabled();

  if (await page.locator('.result-list').isVisible()) return 'results';
  if (await page.locator('#status.error').isVisible()) return 'error';
  return 'empty';
}

// ---------------------------------------------------------------------------
// Stockholm – a large city that should return many nearby places
// ---------------------------------------------------------------------------
test.describe('Stockholm search', () => {
  test('finds nearby places and shows them on the page', async ({ page }) => {
    const outcome = await searchCity(page, 'Stockholm');
    const statusText = await page.locator('#status').textContent();
    expect(outcome, `search failed: ${statusText}`).toBe('results');

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
  });
});

// ---------------------------------------------------------------------------
// Höör – a smaller town in Skåne
// ---------------------------------------------------------------------------
test.describe('Höör search', () => {
  test('shows nearby places for a small town', async ({ page }) => {
    const outcome = await searchCity(page, 'Höör');
    const statusText = await page.locator('#status').textContent();
    expect(outcome, `search failed: ${statusText}`).toBe('results');

    const originCard = page.locator('.origin-card');
    await expect(originCard).toContainText('Höör');

    const items = page.locator('.result-item');
    expect(await items.count()).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Kiruna – northern Sweden, verifies it works for remote locations
// ---------------------------------------------------------------------------
test.describe('Kiruna search', () => {
  test('completes search for a remote northern city', async ({ page }) => {
    const outcome = await searchCity(page, 'Kiruna');

    // Kiruna is remote — may have results or may show "no places found"
    const statusText = await page.locator('#status').textContent();
    expect(outcome, `search failed: ${statusText}`).not.toBe('error');

    if (outcome === 'results') {
      const originCard = page.locator('.origin-card');
      await expect(originCard).toContainText('Kiruna');
    } else {
      // "Inga platser hittades" is a valid outcome for isolated cities
      await expect(page.locator('#status')).toContainText(/Inga platser/i);
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
    await expect(status).toContainText(/Kunde inte hitta/i);
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

    // Wait for search to complete
    await expect(btn).toBeEnabled();

    // Button should say "Sök" again
    await expect(btn).toContainText('Sök');
  });
});
