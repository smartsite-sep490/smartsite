import { test, expect } from '@playwright/test';
import en from '../src/i18n/locales/en.json' with { type: 'json' };
import vi from '../src/i18n/locales/vi.json' with { type: 'json' };

const failures = [
  { kind: 'network', status: 0, key: 'auth.error.network' },
  { kind: 'credentials', status: 401, key: 'auth.error.credentials' },
  { kind: 'forbidden', status: 403, key: 'auth.error.forbidden' },
  { kind: 'rateLimit', status: 429, key: 'auth.error.rateLimitDelay' },
  { kind: 'server', status: 500, key: 'auth.error.server' },
  { kind: 'invalidJson', status: 200, key: 'auth.error.server' },
] as const;

for (const language of ['en', 'vi'] as const) {
  for (const failure of failures) {
    test(`${language} sign-in shows safe ${failure.kind} feedback`, async ({ page }) => {
      const catalog = language === 'vi' ? vi : en;
      const runtimeErrors: string[] = [];
      page.on('pageerror', (error) => runtimeErrors.push(error.message));
      await page.addInitScript(
        (locale) => localStorage.setItem('smartsite-language', locale),
        language,
      );
      // Every API request is intercepted; these credentials never reach a real service.
      await page.route('**/api/v1/**', async (route) => {
        const request = route.request();
        const headers = {
          'access-control-allow-origin': 'http://127.0.0.1:5181',
          'access-control-allow-credentials': 'true',
          'access-control-allow-headers': 'content-type',
          'access-control-expose-headers': 'Retry-After',
        };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (!request.url().endsWith('/auth/login'))
          return route.fulfill({ status: 401, headers, json: { message: 'Unauthorized' } });
        if (failure.kind === 'network') return route.abort('failed');
        if (failure.kind === 'invalidJson')
          return route.fulfill({
            status: 200,
            headers,
            contentType: 'text/html',
            body: '<html>PRIVATE_DIAGNOSTIC</html>',
          });
        return route.fulfill({
          status: failure.status,
          headers: { ...headers, 'Retry-After': '17' },
          json: {
            success: false,
            statusCode: failure.status,
            code: 'UNAUTHORIZED',
            message: 'PRIVATE_DIAGNOSTIC',
            requestId: 'private-request-123',
            timestamp: '2026-10-25T00:00:00Z',
            path: '/api/v1/auth/login',
          },
        });
      });
      await page.goto('/login');
      await expect(page).toHaveURL(/\/login$/);
      await expect(page).toHaveTitle(catalog['app.documentTitle']);
      await page.locator('#login-username').fill('synthetic-user');
      await page.locator('#login-password').fill('SyntheticPassword1!');
      await page.locator('button[type="submit"]').click();
      await expect(page.getByRole('alert')).toHaveText(
        catalog[failure.key].replace('{{seconds}}', '17'),
      );
      await expect(page.locator('details')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText(
        /PRIVATE_DIAGNOSTIC|private-request-123|HTTP \d{3}|Error details/,
      );
      await expect(page.locator('#login-username')).toHaveValue('synthetic-user');
      await expect(page.locator('#login-password')).toHaveValue('SyntheticPassword1!');
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
      expect(runtimeErrors).toEqual([]);
      if (failure.kind === 'credentials') {
        await page.screenshot({ path: test.info().outputPath(`login-${language}.png`) });
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.getByRole('alert')).toBeVisible();
        await page.screenshot({ path: test.info().outputPath(`login-${language}-mobile.png`) });
      }
    });
  }
}
