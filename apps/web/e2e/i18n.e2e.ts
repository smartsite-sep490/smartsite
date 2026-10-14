import { test, expect, type Page } from '@playwright/test';

const site = {
  id: 'synthetic-site',
  code: 'SITE-QA',
  name: 'Công trường kiểm thử / QA site',
  createdAt: '2026-10-01T00:00:00Z',
};
const contractor = {
  id: 'synthetic-contractor',
  code: 'CTR-QA',
  name: 'Nhà thầu kiểm thử / QA contractor',
  createdAt: site.createdAt,
};
const empty = { items: [], total: 0 };
const roles = [
  'ADMIN',
  'SITE_MANAGER',
  'CONTRACTOR_REPRESENTATIVE',
  'SAFETY_OFFICER',
  'SECURITY_OFFICER',
] as const;

async function mockApi(page: Page, signedIn: boolean) {
  const user = {
    id: 'synthetic-account',
    username: 'qa.i18n',
    displayName: 'QA i18n',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: roles.map((role) => ({ role, siteId: role === 'ADMIN' ? null : site.id })),
  };
  await page.route('http://localhost:3000/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname.replace(/^\/api\/v1/, '');
    let body: unknown = empty;
    let status = 200;
    if (pathname.endsWith('/auth/refresh')) {
      status = signedIn ? 200 : 401;
      body = signedIn ? { accessToken: 'synthetic-token', user } : { message: 'Unauthorized' };
    } else if (pathname.endsWith('/auth/me')) body = user;
    else if (pathname.endsWith('/health')) body = { status: 'ok' };
    else if (pathname === '/sites') body = { items: [site], total: 1 };
    else if (pathname.endsWith('/manager-overview'))
      body = {
        site,
        contractorCount: 1,
        zoneCount: 0,
        teamCount: 0,
        workerCount: 0,
        contractors: { items: [{ ...contractor, teamCount: 0, workerCount: 0 }], total: 1 },
      };
    else if (pathname.endsWith('/contractor-worker-account-options'))
      body = { contractors: [contractor] };
    else if (pathname.endsWith('/access-setup'))
      body = {
        siteId: site.id,
        canManageContractors: true,
        canManageZones: true,
        canReviewAssignments: true,
        participations: [],
        zones: [],
        workers: [],
        assignments: [],
        contractorPermissions: [],
        workerPermissions: [],
        gatePasses: [],
        visitorPasses: [],
      };
    else if (pathname.endsWith('/me/notifications')) body = { ...empty, unreadCount: 0 };
    else if (pathname.includes('/attendance')) {
      status = 403;
      body = { message: 'Attendance is outside your scope', code: 'FORBIDDEN' };
    } else if (pathname.endsWith('/contractors')) body = { items: [contractor], total: 1 };
    else if (pathname.endsWith('/' + site.id)) body = site;
    else if (/context|setup|overview/.test(pathname)) {
      status = 403;
      body = { message: 'Outside scope', code: 'FORBIDDEN' };
    }
    await route.fulfill({
      status,
      json: body,
      headers: {
        'access-control-allow-origin': 'http://127.0.0.1:5181',
        'access-control-allow-credentials': 'true',
      },
    });
  });
  // Tests use no real camera or external image/video/socket service.
  await page.route(/https?:\/\/(?!127\.0\.0\.1:5181|localhost:3000)/, (route) => route.abort());
}

async function checkLayout(page: Page) {
  const problems = await page.evaluate(() => {
    const failures: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 2) {
      const overflowing = [...document.querySelectorAll<HTMLElement>('main *')]
        .filter(
          (el) =>
            el.getBoundingClientRect().right > window.innerWidth + 2 &&
            !el.closest('.overflow-x-auto'),
        )
        .slice(0, 4)
        .map((el) => `${el.tagName} ${el.className} ${el.textContent?.trim().slice(0, 50)}`);
      failures.push('horizontal page overflow: ' + overflowing.join('; '));
    }
    for (const el of document.querySelectorAll<HTMLElement>(
      'button, input, select, [role="tab"], h1, h2, h3',
    )) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (
        !rect.width ||
        !rect.height ||
        style.visibility === 'hidden' ||
        el.closest('[aria-hidden="true"], .sr-only')
      )
        continue;
      // Tables/popovers intentionally scroll; ellipses have separate full labels/tooltips.
      if (el.closest('.overflow-x-auto, [role="listbox"]') || style.textOverflow === 'ellipsis')
        continue;
      if (el.scrollWidth > el.clientWidth + 3 && ['hidden', 'clip'].includes(style.overflowX))
        failures.push(`clipped text: ${el.textContent?.trim().slice(0, 80)}`);
    }
    const text = document.body.innerText;
    if (/\b(?:common|notifications|counts)\.[a-z_]+|{{\w+}}/.test(text))
      failures.push('unresolved translation');
    if (text.includes('SmartCông trường')) failures.push('translated brand');
    return failures;
  });
  expect(problems).toEqual([]);
}

for (const language of ['en', 'vi']) {
  for (const width of [320, 390, 768, 1024, 1440]) {
    test(`${language} ${width}px: all existing routes fit and show localized controls`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 960 });
      await page.addInitScript((lang) => {
        localStorage.setItem('smartsite-language', lang);
      }, language);
      await mockApi(page, true);
      for (const path of [
        '/dashboard',
        '/worker-onboarding',
        '/site-setup',
        '/schedule-setup',
        '/workforce',
        '/access',
        '/live-monitoring',
        '/ppe',
        '/zones',
        '/incidents',
        '/iot',
        '/progress',
      ]) {
        await page.goto(path);
        await expect(page.locator('[data-language-switcher]').first()).toBeVisible();
        await page.waitForTimeout(300);
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        expect((await page.locator('body').innerText()).length).toBeGreaterThan(30);
        await checkLayout(page);
        if (path === '/worker-onboarding' || path === '/site-setup')
          await testInfo.attach(path.slice(1), {
            body: await page.screenshot({ fullPage: true }),
            contentType: 'image/png',
          });
      }
    });
    test(`${language} ${width}px: public and auth layouts`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 960 });
      await page.addInitScript((lang) => {
        localStorage.setItem('smartsite-language', lang);
        sessionStorage.setItem('smartsite:signed-out', '1');
      }, language);
      await mockApi(page, false);
      for (const path of ['/', '/login', '/register', '/visits/register']) {
        await page.goto(path);
        await expect(page.locator('[data-language-switcher]').first()).toBeVisible();
        await page.waitForTimeout(1200);
        await checkLayout(page);
        await testInfo.attach(path === '/' ? 'landing' : path.slice(1), {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        });
      }
    });
  }
}
