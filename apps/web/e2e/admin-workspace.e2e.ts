import { test, expect } from '@playwright/test';

for (const mobile of [false, true]) {
  test(`Admin management flow ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    );
    const errors: string[] = [];
    const consoleProblems: string[] = [];
    const operationalReads: string[] = [];
    let authenticated = false;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      // The initial signed-out session probe intentionally receives 401.
      if (
        ['error', 'warning'].includes(message.type()) &&
        !message.text().includes('status of 401')
      )
        consoleProblems.push(message.text());
    });
    const admin = {
      id: 'admin',
      username: 'synthetic.admin',
      displayName: 'Synthetic Admin',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'ADMIN', siteId: null }],
    };
    const site = {
      id: 'site-alpha',
      code: 'ALPHA',
      name: 'Synthetic Alpha',
      createdAt: '2026-11-21T00:00:00Z',
    };
    await page.addInitScript(() => localStorage.setItem('smartsite-language', 'en'));
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      const headers = {
        'access-control-allow-origin': 'http://127.0.0.1:5181',
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'content-type,authorization',
      };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (/camera|safety|gate|contractor|attendance/.test(path)) operationalReads.push(path);
      if (path === '/auth/login') authenticated = true;
      if (path === '/auth/login' || (path === '/auth/refresh' && authenticated))
        return route.fulfill({
          headers,
          json: {
            accessToken: 'synthetic-browser-token',
            tokenType: 'Bearer',
            user: admin,
            accessTokenExpiresAt: '2099-01-01T00:00:00Z',
            refreshTokenExpiresAt: '2099-01-02T00:00:00Z',
          },
        });
      if (path === '/auth/me') return route.fulfill({ headers, json: admin });
      if (path === '/auth/refresh')
        return route.fulfill({ status: 401, headers, json: { message: 'Signed out' } });
      if (path === '/users') return route.fulfill({ headers, json: { items: [admin], total: 1 } });
      if (path === '/sites') return route.fulfill({ headers, json: { items: [site], total: 1 } });
      return route.fulfill({ headers, json: { items: [], total: 0, unreadCount: 0 } });
    });
    await page.goto('/login');
    await page.locator('#login-username').fill('synthetic.admin');
    await page.locator('#login-password').fill('SyntheticPassword1!');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Administration overview' })).toBeVisible();
    await expect(page.getByText('No manager assigned')).toBeVisible();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await expect(page.getByText('328', { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: `D:/SEP490/.admin-dashboard-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Open site', exact: true }).click();
    await expect(page).toHaveURL(/\/site-setup\?siteId=site-alpha$/);
    await expect(
      page.getByRole('heading', { name: 'Synthetic Alpha', level: 2, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Site gates' })).toHaveCount(0);
    await page.goto('/ppe');
    await expect(page).toHaveURL(/\/dashboard$/);
    await page
      .getByRole('navigation', { name: 'Administrative shortcuts' })
      .getByRole('button', { name: 'Account management' })
      .click();
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create account' });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 4; i++)
      await dialog.getByRole('button', { name: 'Add role', exact: true }).click();
    await expect(
      dialog.getByRole('option', { name: 'Contractor Representative', exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeInViewport();
    const bounds = await dialog.boundingBox();
    expect(bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height - 30);
    await page.screenshot({
      path: `D:/SEP490/.admin-account-dialog-${mobile ? 'mobile' : 'desktop'}.png`,
    });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(operationalReads).toEqual([]);
    expect(errors).toEqual([]);
    expect(consoleProblems).toEqual([]);
  });
}
