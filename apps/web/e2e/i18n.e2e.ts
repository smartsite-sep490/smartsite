import { test, expect, type Page } from '@playwright/test';
import en from '../src/i18n/locales/en.json' with { type: 'json' };
import vi from '../src/i18n/locales/vi.json' with { type: 'json' };

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

async function mockApi(page: Page, signedIn: boolean, accountRoles: readonly string[] = roles) {
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  const user = {
    id: 'synthetic-account',
    username: 'qa.i18n',
    displayName: 'QA i18n',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: accountRoles.map((role) => ({
      role,
      siteId: role === 'ADMIN' ? null : site.id,
      ...(role === 'CONTRACTOR_REPRESENTATIVE' ? { contractorId: contractor.id } : {}),
    })),
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
    else if (pathname === '/contractor-dashboard/scopes')
      body = {
        items: [
          {
            siteId: site.id,
            siteCode: site.code,
            siteName: site.name,
            contractorId: contractor.id,
            contractorName: contractor.name,
          },
        ],
      };
    else if (pathname.endsWith('/dashboard'))
      body = { workerCount: 0, teamCount: 0, unassignedWorkerCount: 0 };
    else if (pathname.endsWith('/my-team'))
      body = {
        workerId: 'qa-worker',
        workerCode: 'W000001',
        displayName: 'QA Worker',
        teamId: null,
      };
    else if (pathname.endsWith('/access-logs'))
      body = {
        items: [
          {
            id: 'qa-log',
            createdAt: site.createdAt,
            workerName: 'QA Worker',
            contractorName: contractor.name,
            direction: 'IN',
            method: 'FACE',
            gateId: 'gate-north-01',
            decision: { authorization: 'ALLOWED', reasonCode: 'VALID_ASSIGNMENT' },
          },
        ],
        total: 1,
      };
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
    else if (pathname.endsWith('/safety-overview'))
      body = {
        site,
        date: new URL(route.request().url()).searchParams.get('date'),
        timezone: 'Asia/Saigon',
        updatedAt: site.createdAt,
        teams: empty,
        unassignedWorkers: empty,
      };
    else if (pathname.endsWith('/safety-overview/team-options')) body = empty;
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

async function checkLanguage(page: Page, language: 'en' | 'vi') {
  const expected = language === 'vi' ? vi : en;
  const other = language === 'vi' ? en : vi;
  const wrongLanguage = Object.entries(other)
    .filter(
      ([key, text]) =>
        text !== expected[key as keyof typeof expected] &&
        !['Smart', 'Site', 'SmartSite', 'English', 'Tiếng Việt', 'QR', 'Camera', 'Web'].includes(
          text,
        ) &&
        !text.includes('{{') &&
        text.length >= 4 &&
        /[a-zÀ-ỹ]/i.test(text),
    )
    .map(([, text]) => text);
  const leaks = await page.evaluate((wrong) => {
    const dictionary = new Set(wrong);
    const leaks = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const el = node.parentElement;
      if (
        !el ||
        el.closest('script, style, [aria-hidden="true"], [data-authored-content]') ||
        !el.getClientRects().length
      )
        continue;
      const text = node.textContent?.trim() ?? '';
      if (dictionary.has(text)) leaks.add(text);
    }
    for (const el of document.querySelectorAll<HTMLElement>(
      'input, button, select, textarea, img',
    )) {
      if (!el.getClientRects().length) continue;
      for (const attr of ['aria-label', 'placeholder', 'title', 'alt']) {
        const text = el.getAttribute(attr)?.trim() ?? '';
        if (dictionary.has(text)) leaks.add(`${attr}: ${text}`);
      }
    }
    return [...leaks];
  }, wrongLanguage);
  expect(leaks, `untranslated visible copy in ${language}`).toEqual([]);
}

for (const language of ['en', 'vi']) {
  for (const width of [320, 390, 768, 1024, 1440]) {
    test(`${language} ${width}px: all existing routes fit and show localized controls`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 960 });
      await page.addInitScript((lang) => {
        localStorage.setItem('smartsite-language', lang);
      }, language);
      await mockApi(page, true);
      for (const path of [
        '/dashboard',
        '/worker-onboarding',
        '/contractor-teams',
        '/assigned-work',
        '/accounts',
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
        await checkLanguage(page, language as 'en' | 'vi');
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
        await checkLanguage(page, language as 'en' | 'vi');
        await testInfo.attach(path === '/' ? 'landing' : path.slice(1), {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        });
      }
    });
  }
}

const roleRoutes: Record<string, string[]> = {
  ADMIN: ['/accounts', '/site-setup', '/access'],
  SITE_MANAGER: ['/dashboard', '/site-setup', '/schedule-setup', '/workforce', '/access'],
  CONTRACTOR_REPRESENTATIVE: [
    '/contractor-teams',
    '/worker-onboarding',
    '/assigned-work',
    '/schedule-setup',
    '/workforce',
    '/access',
  ],
  SAFETY_OFFICER: [
    '/dashboard',
    '/live-monitoring',
    '/incidents',
    '/ppe',
    '/zones',
    '/account/password',
  ],
  SECURITY_OFFICER: ['/access'],
  WORKER: ['/worker-summary', '/workforce', '/access'],
};
for (const [role, paths] of Object.entries(roleRoutes)) {
  for (const width of role === 'SAFETY_OFFICER' ? [320, 390, 1440] : [390, 1440]) {
    test(`${role} ${width}px switches both ways on every allowed workspace`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 960 });
      await page.addInitScript(() => localStorage.setItem('smartsite-language', 'en'));
      await mockApi(page, true, [role]);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      for (const path of paths) {
        await page.goto(path);
        await expect(page.locator('[data-language-switcher]').first()).toBeVisible();
        await page.waitForTimeout(400);
        if (role === 'SAFETY_OFFICER' && ['/dashboard', '/incidents'].includes(path)) {
          await expect(page).toHaveURL(/\/incidents$/);
          await expect(
            page.getByText(en['safety_workspace.no_teams_found_for_this_selection'], {
              exact: true,
            }),
          ).toBeVisible();
          await expect(page.getByRole('alert')).toHaveCount(0);
        }
        if (role === 'CONTRACTOR_REPRESENTATIVE' && path === '/contractor-teams') {
          await page.getByRole('button', { name: en['common.create_team'], exact: true }).click();
          await page.locator('#create-team-name').fill('QA authored team / tổ kiểm thử');
        }
        for (const language of ['vi', 'en'] as const) {
          if (path === '/contractor-teams') {
            // The modal covers the navbar; change the same i18n instance without closing its draft.
            await page.evaluate(async (lang) => {
              const modulePath = '/src/i18n/index.ts';
              const { default: i18n } = await import(modulePath);
              await i18n.changeLanguage(lang);
            }, language);
          } else {
            await page.locator('[data-language-switcher]').first().click();
            await page
              .getByRole('button', {
                name: language === 'vi' ? 'Tiếng Việt' : 'English',
                exact: true,
              })
              .click();
          }
          await expect(page.locator('html')).toHaveAttribute('lang', language);
          await checkLanguage(page, language);
          await checkLayout(page);
          if (path === '/contractor-teams')
            await expect(page.locator('#create-team-name')).toHaveValue(
              'QA authored team / tổ kiểm thử',
            );
        }
        await testInfo.attach(`${role}-${path.slice(1)}`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        });
      }
      expect(errors).toEqual([]);
    });
  }
}
