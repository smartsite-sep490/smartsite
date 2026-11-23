import { test, expect } from '@playwright/test';

for (const mobile of [false, true]) {
  test(`Security opens QR directly on ${mobile ? 'mobile' : 'desktop'} without a face decision`, async ({
    page,
  }, info) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    );
    await page.addInitScript(() => localStorage.setItem('smartsite-language', 'vi'));
    const gateId = 'a1000000-0000-4000-8000-000000000001';
    const user = {
      id: 'security',
      username: 'qa.security',
      displayName: 'QA Security',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ siteId: 'site', role: 'SECURITY_OFFICER' }],
    };
    const site = {
      id: 'site',
      code: 'QA',
      name: 'Synthetic Site',
      createdAt: '2026-01-01T00:00:00Z',
    };
    const writes: unknown[] = [];
    let faceRequests = 0;
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname.replace('/api/v1', '');
      const headers = {
        'access-control-allow-origin': request.headers().origin ?? 'http://127.0.0.1:5173',
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'content-type,authorization',
      };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      let body: unknown = { items: [], total: 0, unreadCount: 0 };
      if (path === '/auth/refresh')
        body = {
          accessToken: 'synthetic-ui-token',
          user,
          tokenType: 'Bearer',
          accessTokenExpiresAt: '2099-01-01T00:00:00Z',
          refreshTokenExpiresAt: '2099-01-02T00:00:00Z',
        };
      else if (path === '/auth/me') body = user;
      else if (path === '/sites') body = { items: [site], total: 1 };
      else if (path === '/sites/site') body = site;
      else if (path.endsWith('/gates'))
        body = {
          items: [
            { id: gateId, siteId: 'site', code: 'MAIN', name: 'Main Gate', status: 'ACTIVE' },
          ],
          total: 1,
        };
      else if (path.endsWith('/qr-fallback')) {
        writes.push(request.postDataJSON());
        body = {
          id: 'session',
          siteId: 'site',
          gateId,
          direction: 'IN',
          expiresAt: '2099-01-01T00:00:00Z',
        };
      } else if(path.endsWith('/qr-verifications')) {
        body={authorization:'ALLOWED',reasonCode:'VALID_ASSIGNMENT',attempt:{id:'attempt',status:'READY',scheduleStatus:'SCHEDULED',expiresAt:'2099-01-01T00:00:00Z'},worker:{id:'worker',userId:'worker-user',username:'qa.worker',externalId:'QA001',displayName:'Synthetic Worker',contractorName:'Synthetic Contractor',assignmentStatus:'APPROVED',scheduleStatus:'SCHEDULED'}};
      } else if (path.includes('face')) faceRequests++;
      return route.fulfill({ headers, json: body });
    });
    await page.goto('/access');
    const button = page.getByRole('button', { name: 'Quét QR', exact: true });
    await expect(button).toBeEnabled();
    await expect(page.getByText(/Hướng dẫn vận hành cho nhân viên bảo vệ/)).toHaveCount(0);
    await expect(page.getByText('Sẵn sàng xác minh', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('security-gate-ready.png'), fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await button.click();
    await expect(page.getByRole('dialog', { name: 'Xác minh QR công nhân' })).toBeVisible();
    expect(writes).toEqual([{ direction: 'IN', reason: 'OPERATOR_QR_SELECTED' }]);
    expect(faceRequests).toBe(0);
    await page.screenshot({ path: info.outputPath('security-direct-qr.png'), fullPage: true });
    await page.locator('#qr-code-input').fill('ABCD2345');
    await page.getByRole('button',{name:/Xác nhận.*QR/}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Xác nhận lượt ra vào thực tế'})).toBeVisible();
    await page.screenshot({path:info.outputPath('security-qr-verified.png'),fullPage:true});
  });
}
