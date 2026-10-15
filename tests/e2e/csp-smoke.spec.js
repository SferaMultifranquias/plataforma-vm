const { test, expect } = require('@playwright/test');

test.describe('CSP browser smoke', () => {
  test.skip(process.env.E2E_REQUIRE_CSP !== 'true', 'Set E2E_REQUIRE_CSP=true against Pages preview to validate CSP headers.');

  test('loads shell with CSP/SRI enabled and no browser security violations', async ({ page }) => {
    const violations = [];
    page.on('console', (message) => {
      const text = message.text();
      if (/content security policy|violat|integrity|blocked/i.test(text)) {
        violations.push(text);
      }
    });
    page.on('pageerror', (error) => violations.push(error.message));

    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response, 'page response').toBeTruthy();
    if (!response) throw new Error('Missing page response');
    const csp = response.headers()['content-security-policy'];
    expect(csp, 'CSP response header').toContain("default-src 'self'");

    await expect(page.locator('#bootstrap-screen')).toBeAttached();
    await page.waitForLoadState('networkidle');

    await expect.poll(async () => page.evaluate(() => ({
      hasTailwind: typeof window['tailwind'] !== 'undefined',
      hasLucide: typeof window['lucide'] !== 'undefined',
      hasSha256: typeof window['sha256'] !== 'undefined',
      hasXlsx: typeof window['XLSX'] !== 'undefined',
      hasSupabase: typeof window['supabase'] !== 'undefined',
    }))).toEqual({
      hasTailwind: true,
      hasLucide: true,
      hasSha256: true,
      hasXlsx: true,
      hasSupabase: true,
    });

    expect(violations).toEqual([]);
  });
});
