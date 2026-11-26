import { test, expect, type Page } from '@playwright/test';
import type {
  WorkerComplianceResponse,
  WorkerDocumentResponse,
  WorkerOnboardingDraft,
} from '@smartsite/api-client';
import en from '../src/i18n/locales/en.json' with { type: 'json' };

const site = {
  id: 'qa-site',
  code: 'QA',
  name: 'Synthetic QA Site',
  createdAt: '2026-11-21T00:00:00Z',
};
const contractor = { id: 'qa-contractor', name: 'Synthetic Contractor' };
const otherContractor = { id: 'other-contractor', name: 'Other Contractor' };
const original = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6tCkAAAAASUVORK5CYII=',
  'base64',
);
const names = ['Synthetic Alpha', 'Synthetic Bravo'];
const reviewIssuedOn = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
const choiceLabel = (key: 'workerIntake.provisionCount' | 'workerIntake.sendCount') =>
  en[key].replace('{{count}}', '2');

for (const width of [1440, 390]) {
  test('batch intake, optional AI and Safety review at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    let role: 'CONTRACTOR_REPRESENTATIVE' | 'SAFETY_OFFICER' = 'CONTRACTOR_REPRESENTATIVE';
    let scans = 0;
    let provision: Array<{ id: string; version: number }> = [];
    let sent: Array<{ id: string; version: number }> = [];
    let reviewBody: unknown;
    let draftSaved = false;
    const unexpected: string[] = [];
    page.on('pageerror', (error) => unexpected.push(error.message));
    const drafts: WorkerOnboardingDraft[] = names.map((displayName, index) => ({
      id: 'draft-' + index,
      version: 1,
      displayName,
      username: 'synthetic' + index,
      email: 'worker' + index + '@example.test',
      safetyCardRequired: false,
      documents: {},
      workerId: null,
      workerCode: null,
      workerVersion: null,
      canProvision: true,
      canSubmit: false,
      missingKinds: [],
      submissionStatus: 'NOT_SUBMITTED',
    }));
    const profiles: WorkerComplianceResponse[] = names.map((displayName, index) => ({
      workerId: 'worker-' + index,
      externalId: 'W00000' + index,
      displayName,
      contractorId: contractor.id,
      version: 2,
      safetyCardRequired: false,
      identityVersion: 0,
      identityImages: [],
      nationalId: null,
      gender: null,
      phoneNumber: null,
      address: null,
      status: 'PENDING',
      needsSupplement: false,
      expiringKinds: [],
      missingKinds: [],
      submissionStatus: 'NOT_SUBMITTED',
      documents: [
        {
          id: 'document-' + index,
          workerId: 'worker-' + index,
          kind: 'HEALTH_CERTIFICATE',
          originalName: 'health-' + index + '.png',
          status: 'DRAFT',
          version: 1,
          mediaType: 'image/png',
          size: original.length,
          issuedOn: null,
          expiresOn: null,
          submittedIssuedOn: reviewIssuedOn,
          uploadedAt: '2026-11-20T00:00:00Z',
          reviewedAt: null,
          reviewNote: null,
        },
      ],
    }));

    const currentUser = () => ({
      id: 'qa-' + role,
      username: 'synthetic.user',
      displayName: 'Synthetic User',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role, siteId: site.id }],
    });
    await page.addInitScript(() => localStorage.setItem('smartsite-language', 'en'));
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace('/api/v1', '');
      const headers = {
        'access-control-allow-origin': 'http://127.0.0.1:5181',
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'content-type,authorization',
        'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
      };
      const json = (data: unknown, status = 200) => route.fulfill({ headers, json: data, status });
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (path === '/auth/refresh' || path === '/auth/login')
        return json({
          accessToken: 'synthetic-browser-token',
          tokenType: 'Bearer',
          user: currentUser(),
          accessTokenExpiresAt: '2099-01-01T00:00:00Z',
          refreshTokenExpiresAt: '2099-01-02T00:00:00Z',
        });
      if (path === '/auth/me') return json(currentUser());
      if (path === '/sites') return json({ items: [site], total: 1 });
      if (path.endsWith('/contractor-worker-account-options'))
        return json({ contractors: [contractor] });
      if (path.endsWith('/safety-contractors'))
        return json({ items: [contractor, otherContractor], total: 2 });
      if (path.endsWith('/worker-onboarding-drafts')) return json({ items: drafts });
      if (path.endsWith('/worker-onboarding-drafts/provision')) {
        provision = request.postDataJSON().items;
        const items = provision.map(({ id }) => {
          const index = drafts.findIndex((row) => row.id === id);
          const profile = profiles[index]!;
          Object.assign(drafts[index]!, {
            workerId: profile.workerId,
            workerVersion: profile.version,
            workerCode: profile.externalId,
            canProvision: false,
            canSubmit: true,
          });
          return { id, status: 'SUCCEEDED', workerId: profile.workerId };
        });
        return json({ items });
      }
      if (path.includes('/worker-onboarding-drafts/') && request.method() === 'PUT') {
        draftSaved = request.postData()?.includes('"displayName":"Unfinished Worker"') === true;
        const row = {
          ...drafts[0]!,
          id: path.split('/').at(-1)!,
          displayName: 'Unfinished Worker',
          username: '',
          email: '',
          canProvision: false,
          missingKinds: ['PERSONAL_INSURANCE'],
        } satisfies WorkerOnboardingDraft;
        drafts.push(row);
        return json(row);
      }
      if (path.endsWith('/worker-document-submissions/batch')) {
        sent = request.postDataJSON().items;
        const items = sent.map(({ id }) => {
          const profile = profiles.find((row) => row.workerId === id)!;
          profile.submissionStatus = 'PENDING_REVIEW';
          profile.documents[0]!.status = 'PENDING';
          const row = drafts.find((draft) => draft.workerId === id)!;
          row.submissionStatus = 'PENDING_REVIEW';
          row.canSubmit = false;
          return { id, status: 'SUCCEEDED', workerId: id };
        });
        return json({ items });
      }
      if (path.endsWith('/worker-compliance')) {
        const contractorId = url.searchParams.get('contractorId');
        const filtered = profiles.filter(
          (profile) =>
            profile.submissionStatus === url.searchParams.get('submissionStatus') &&
            (!contractorId || profile.contractorId === contractorId),
        );
        return json({ items: filtered, total: filtered.length });
      }
      const profile = profiles.find((item) => path.includes('/workers/' + item.workerId + '/'));
      if (profile && path.endsWith('/compliance')) return json(profile);
      if (profile && path.endsWith('/ai-analysis')) {
        scans++;
        return json({ code: 'SERVICE_UNAVAILABLE', message: 'Synthetic analysis outage' }, 503);
      }
      if (profile && path.endsWith('/file'))
        return route.fulfill({
          headers,
          body: original,
          contentType: 'image/png',
        });
      if (profile && path.endsWith('/reviews')) {
        reviewBody = request.postDataJSON();
        const doc: WorkerDocumentResponse = {
          ...profile.documents[0]!,
          status: 'APPROVED',
          version: 2,
        };
        profile.documents = [doc];
        profile.submissionStatus = 'REVIEWED';
        return json(doc);
      }
      return json({ items: [], total: 0, unreadCount: 0 });
    });

    await page.goto('/worker-onboarding');
    await expect(page.getByRole('heading', { name: en['workerIntake.title'] })).toBeVisible();
    await expect(
      page.locator('main').getByRole('link', { name: en['workerIntake.recordTitle'] }),
    ).toHaveAttribute('href', '/worker-documents?siteId=' + site.id);
    const form = page.getByRole('region', { name: en['workerIntake.add'] });
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(page.locator('[data-select-for=worker-intake-site-select]')).toBeVisible();
    await expect(form).toBeVisible();
    expect((await form.boundingBox())!.y).toBeLessThan((await table.boundingBox())!.y);
    const expiry = form
      .getByRole('button', { name: en['documents.expiresOn'], exact: true })
      .last();
    await expiry.evaluate((field) => field.scrollIntoView({ block: 'end' }));
    await expiry.click();
    const calendar = page.getByRole('dialog');
    await expect(calendar.getByRole('grid')).toBeVisible();
    const calendarBounds = (await calendar.boundingBox())!;
    expect(calendarBounds.x).toBeGreaterThanOrEqual(0);
    expect(calendarBounds.x + calendarBounds.width).toBeLessThanOrEqual(width);
    expect(calendarBounds.y).toBeGreaterThanOrEqual(0);
    expect(calendarBounds.y + calendarBounds.height).toBeLessThanOrEqual(960);
    const day = calendar.getByRole('grid').getByRole('button').filter({ hasText: /^15$/ }).first();
    await day.click();
    await expect(calendar).toBeHidden();
    await form
      .getByRole('button', {
        name: en['calendar.clearField'].replace('{{field}}', en['documents.expiresOn']),
        exact: true,
      })
      .focus();
    await page.keyboard.press('Enter');
    await expect(expiry).toContainText(en['common.pick_a_date']);
    await expiry.click();
    await page.keyboard.press('Escape');
    await expect(calendar).toBeHidden();
    await expect(expiry).toBeFocused();
    const nameField = form.getByLabel(en['common.full_name'], { exact: true });
    await nameField.fill('Unfinished Worker');
    await page.getByRole('button', { name: en['workerIntake.saveNext'] }).click();
    await expect.poll(() => draftSaved).toBe(true);
    await expect(nameField).toHaveValue('');
    await expect(nameField).toBeFocused();

    const selectPage = page.getByRole('checkbox', { name: en['documents.selectPage'] });
    await selectPage.check();
    await page.getByRole('button', { name: choiceLabel('workerIntake.provisionCount') }).click();
    await expect.poll(() => provision.length).toBe(2);
    await expect(page.getByText(en['workerIntake.readyToSend'], { exact: true })).toHaveCount(2);
    await selectPage.check();
    const scan = page.getByRole('button', { name: en['documents.aiAnalysis'], exact: true });
    const send = page.getByRole('button', { name: choiceLabel('workerIntake.sendCount') });
    if (width === 1440) {
      const scanBounds = (await scan.boundingBox())!;
      const sendBounds = (await send.boundingBox())!;
      expect(scanBounds.y).toBeCloseTo(sendBounds.y, 0);
      expect(scanBounds.x).toBeGreaterThan(sendBounds.x);
    }
    await scan.click();
    await expect.poll(() => scans).toBe(2);
    await expect(
      page.getByText(en['workerIntake.aiUnavailableCount'].replace('{{count}}', '2')),
    ).toBeVisible();
    await page.getByText(en['workerIntake.aiViewResults'], { exact: true }).click();
    const report = page.getByRole('region', { name: en['workerIntake.aiViewResults'] });
    await expect(report.getByRole('heading', { name: 'Synthetic Alpha' })).toBeVisible();
    await expect(report.getByText(en['documents.aiUnavailable'], { exact: true })).toHaveCount(2);
    await assertLayout(page);
    await page.getByText(en['workerIntake.aiViewResults'], { exact: true }).click();
    await send.click();
    await expect
      .poll(() => sent.map(({ id, version }) => [id, version]))
      .toEqual([
        ['worker-0', 2],
        ['worker-1', 2],
      ]);
    await assertLayout(page);

    role = 'SAFETY_OFFICER';
    profiles[1]!.contractorId = otherContractor.id;
    await page.goto('/worker-documents?siteId=' + site.id);
    await expect(page.locator('[data-select-for=worker-documents-site-select]')).toBeVisible();
    await expect(page.getByRole('button', { name: /Synthetic Bravo/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: contractor.name, exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: otherContractor.name, exact: true }),
    ).toBeVisible();
    await page.locator('[data-select-for=worker-document-contractor-filter]').click();
    await page.getByRole('option', { name: contractor.name, exact: true }).click();
    await expect(page.getByRole('button', { name: /Synthetic Bravo/ })).toHaveCount(0);
    await page.getByRole('button', { name: /Synthetic Alpha/ }).click();
    await expect(page.getByRole('button', { name: en['documents.aiRun'] })).toHaveCount(0);
    const approve = page.getByRole('button', { name: en['documents.approve'], exact: true });
    await expect(approve).toBeDisabled();
    await page.getByRole('button', { name: en['documents.view'], exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await approve.click();
    await expect
      .poll(() => reviewBody)
      .toMatchObject({
        approve: true,
        issuedOn: reviewIssuedOn,
        expectedVersion: 1,
      });
    await assertLayout(page);
    expect(unexpected).toEqual([]);
  });
}

async function assertLayout(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(2);
  expect(await page.locator('main').innerText()).not.toMatch(
    /(?:documents|workerIntake)\.[A-Za-z]+|\{\{/,
  );
}
