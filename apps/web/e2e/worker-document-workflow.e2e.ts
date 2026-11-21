import { test, expect, type Page } from '@playwright/test';
import type { WorkerComplianceResponse, WorkerDocumentResponse } from '@smartsite/api-client';
import en from '../src/i18n/locales/en.json' with { type: 'json' };

// Synthetic API fixtures exercise real rendered Web interactions without paid services.
for (const width of [1440, 390, 360]) {
  const mobile = width < 1000;
  test(
    'document review, quick AI scan and contractor supplement on ' +
      (mobile ? 'phone ' + width : 'desktop'),
    async ({ page }, testInfo) => {
      await page.setViewportSize(mobile ? { width, height: 844 } : { width: 1440, height: 1000 });
      let role = 'SAFETY_OFFICER',
        scans = 0,
        submissions = 0;
      let releaseFirst!: () => void;
      const firstScan = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const site = {
        id: 'qa-site',
        code: 'QA',
        name: 'Synthetic QA Site',
        createdAt: '2026-11-21T00:00:00Z',
      };
      const profiles: WorkerComplianceResponse[] = ['Correct', 'Mismatch', 'Unclear'].map(
        (label, index) => ({
          workerId: 'worker-' + index,
          contractorId: 'qa-contractor',
          displayName: 'Synthetic ' + label,
          externalId: 'W00' + index,
          nationalId: '000000000001',
          phoneNumber: '0900000001',
          gender: 'MALE',
          address: 'Synthetic address',
          version: 1,
          safetyCardRequired: false,
          identityImages: [],
          status: 'PENDING',
          submissionStatus: 'PENDING_REVIEW',
          needsSupplement: false,
          missingKinds: ['HEALTH_CERTIFICATE', 'PERSONAL_INSURANCE'],
          expiringKinds: [],
          aiSummary: { status: 'NOT_SCANNED', pending: 1, complete: 0, unresolved: 1 },
          documents: [
            {
              id: 'doc-' + index,
              workerId: 'worker-' + index,
              kind: 'HEALTH_CERTIFICATE',
              status: 'PENDING',
              originalName: 'synthetic-health.png',
              mediaType: 'image/png',
              size: 100,
              ocr: { status: 'UNREADABLE', issuedOn: null, expiresOn: null, warnings: [] },
              submittedIssuedOn: '2026-11-01',
              submittedExpiresOn: '2027-11-01',
              issuedOn: null,
              expiresOn: null,
              uploadedAt: '2026-11-21T00:00:00Z',
              reviewedAt: null,
              reviewNote: null,
              version: 1,
            },
          ],
        }),
      );
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6tCkAAAAASUVORK5CYII=',
        'base64',
      );
      const currentUser = () => ({
        id: 'qa-user',
        username: 'synthetic.user',
        displayName: 'Synthetic User',
        isActive: true,
        mustChangePassword: false,
        roleAssignments: [
          {
            role,
            siteId: site.id,
            ...(role === 'CONTRACTOR_REPRESENTATIVE' ? { contractorId: 'qa-contractor' } : {}),
          },
        ],
      });
      const visible = (profile: WorkerComplianceResponse) =>
        role === 'SAFETY_OFFICER'
          ? profile
          : {
              ...profile,
              aiSummary: undefined,
              documents: profile.documents.map((doc) => ({ ...doc, aiAnalysis: undefined })),
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
        if (path === '/auth/refresh' || path === '/auth/login')
          return route.fulfill({
            headers,
            json: {
              accessToken: 'synthetic-browser-token',
              tokenType: 'Bearer',
              user: currentUser(),
              accessTokenExpiresAt: '2099-01-01T00:00:00Z',
              refreshTokenExpiresAt: '2099-01-02T00:00:00Z',
            },
          });
        if (path === '/auth/me') return route.fulfill({ headers, json: currentUser() });
        if (path === '/sites') return route.fulfill({ headers, json: { items: [site], total: 1 } });
        if (path.endsWith('/worker-compliance'))
          return route.fulfill({
            headers,
            json: { items: profiles.map(visible), total: profiles.length },
          });
        const profile = profiles.find((item) => path.includes('/workers/' + item.workerId + '/'));
        if (profile && path.endsWith('/compliance'))
          return route.fulfill({ headers, json: visible(profile) });
        if (profile && path.endsWith('/ai-analysis')) {
          scans++;
          if (scans === 1) await firstScan;
          const doc = profile.documents.find((item) =>
            path.includes('/documents/' + item.id + '/'),
          )!;
          const index = profiles.indexOf(profile);
          doc.aiAnalysis = {
            status: 'COMPLETE',
            detectedKind:
              index === 2 ? null : index === 1 ? 'PERSONAL_INSURANCE' : 'HEALTH_CERTIFICATE',
            issuedOn: index === 2 ? null : '2026-11-01',
            expiresOn: null,
            nationalId: null,
            kindMismatch: index === 1,
            dateCheck: {
              status: index === 2 ? 'UNAVAILABLE' : 'MATCH',
              field: 'ISSUED_ON',
              submittedDate: '2026-11-01',
              detectedDate: index === 2 ? null : '2026-11-01',
            },
            identityCheck: 'NOT_DETECTED',
            validity: index === 2 ? 'UNKNOWN' : 'CURRENT',
          };
          profile.aiSummary = {
            status: index === 2 ? 'INSUFFICIENT' : index === 1 ? 'ATTENTION' : 'NO_DISCREPANCY',
            pending: 1,
            complete: 1,
            unresolved: 0,
          };
          return route.fulfill({ status: 204, headers });
        }
        if (profile && path.endsWith('/file'))
          return route.fulfill({ headers, contentType: 'image/png', body: png });
        if (profile && path.endsWith('/reviews')) {
          const input = route.request().postDataJSON();
          const doc = profile.documents.find((item) =>
            path.includes('/documents/' + item.id + '/'),
          )!;
          doc.status = input.approve ? 'APPROVED' : 'REJECTED';
          doc.reviewNote = input.reviewNote;
          doc.version++;
          profile.version = (profile.version ?? 0) + 1;
          profile.needsSupplement = !input.approve;
          profile.submissionStatus = profile.documents.some((item) => item.status === 'PENDING')
            ? 'PENDING_REVIEW'
            : 'REVIEWED';
          if (input.approve) {
            doc.issuedOn = input.issuedOn;
            doc.expiresOn =
              String(Number(input.issuedOn.slice(0, 4)) + 1) + input.issuedOn.slice(4);
          }
          return route.fulfill({ headers, json: doc });
        }
        if (profile && path.endsWith('/check'))
          return route.fulfill({
            headers,
            json: {
              quality: { status: 'RETAKE', reason: 'IMAGE_BLURRY' },
              ocr: {
                status: 'READ',
                issuedOn: '2026-11-01',
                expiresOn: null,
                nationalIds: [],
                warnings: [],
              },
              dateCheck: {
                status: 'NO_REFERENCE',
                detectedDate: '2026-11-01',
                submittedDate: null,
              },
            },
          });
        if (profile && path.endsWith('/document-submissions')) {
          submissions++;
          const body = route.request().postDataBuffer()!.toString();
          expect(body).toContain('HEALTH_CERTIFICATE');
          expect(body).toContain('replacement.png');
          const previous = profile.documents.find((doc) => doc.kind === 'HEALTH_CERTIFICATE')!;
          const doc: WorkerDocumentResponse = {
            ...previous,
            id: 'replacement',
            status: 'PENDING',
            originalName: 'replacement.png',
            aiAnalysis: undefined,
            reviewNote: null,
            version: 1,
          };
          profile.documents.unshift(doc);
          profile.version = (profile.version ?? 0) + 1;
          profile.needsSupplement = false;
          return route.fulfill({
            headers,
            json: { requestId: 'synthetic', version: profile.version, documentIds: [doc.id] },
          });
        }
        return route.fulfill({ headers, json: { items: [], total: 0, unreadCount: 0 } });
      });
      await page.goto('/worker-documents');
      await expect(page.getByText('Synthetic Correct', { exact: true })).toBeVisible();
      await page.getByLabel(en['documents.selectPage']).check();
      await page.getByLabel(en['documents.search'], { exact: true }).fill('temporary');
      await page.getByLabel(en['documents.search'], { exact: true }).clear();
      await expect(page.getByLabel(en['documents.selectPage'])).not.toBeChecked();
      await page.getByLabel(en['documents.selectPage']).check();
      await page.getByRole('button', { name: en['documents.quickScan'], exact: true }).click();
      await expect(
        page.getByText(en['documents.aiStatus.ANALYZING'], { exact: false }).first(),
      ).toBeVisible();
      await page.getByLabel(en['documents.search'], { exact: true }).fill('temporary');
      await page.getByLabel(en['documents.search'], { exact: true }).clear();
      await expect(page.getByLabel(en['documents.selectPage'])).not.toBeChecked();
      await expect(
        page.getByText(en['documents.aiStatus.ANALYZING'], { exact: false }),
      ).toHaveCount(0);
      releaseFirst();
      await expect.poll(() => profiles[0]!.documents[0]!.aiAnalysis?.status).toBe('COMPLETE');
      await page.getByRole('button', { name: en['documents.refresh'], exact: true }).click();
      await expect(
        page.getByText(en['documents.aiStatus.NO_DISCREPANCY'], { exact: true }),
      ).toBeVisible();
      expect(scans).toBe(1);
      await page.getByLabel(en['documents.selectPage']).check();
      await page.getByRole('button', { name: en['documents.quickScan'], exact: true }).click();
      await expect(
        page.getByText(en['documents.aiStatus.NO_DISCREPANCY'], { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(en['documents.aiStatus.ATTENTION'], { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(en['documents.aiStatus.INSUFFICIENT'], { exact: true }),
      ).toBeVisible();
      expect(scans).toBe(3);
      await expect(
        page.getByRole('button', { name: en['documents.quickScan'], exact: true }),
      ).toBeDisabled();
      await page.getByRole('button', { name: /Synthetic Correct/ }).click();
      await page.getByRole('button', { name: en['documents.view'], exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: en['common.close_dialog'], exact: true })
        .click();
      await page.getByLabel(en['documents.note']).fill('Synthetic replacement required');
      await page.getByRole('button', { name: en['documents.reject'], exact: true }).click();
      await expect(page.getByText('Synthetic replacement required', { exact: true })).toBeVisible();
      await assertLayout(page);
      await page.screenshot({
        path: testInfo.outputPath('safety-' + (mobile ? 'phone' : 'desktop') + '.png'),
        fullPage: true,
      });
      role = 'CONTRACTOR_REPRESENTATIVE';
      await page.reload();
      await page.getByRole('button', { name: /Synthetic Correct/ }).click();
      await expect(page.getByText('Synthetic replacement required', { exact: true })).toBeVisible();
      await page
        .getByLabel(en['documents.HEALTH_CERTIFICATE'], { exact: true })
        .setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: png });
      await expect(page.getByText(en['documents.IMAGE_BLURRY'], { exact: true })).toBeVisible();
      await page.getByRole('button', { name: en['documents.sendBundle'], exact: true }).click();
      await expect.poll(() => submissions).toBe(1);
      await expect(page.getByText('replacement.png', { exact: true }).first()).toBeVisible();
      expect(scans).toBe(3);
      await assertLayout(page);
      await page.screenshot({
        path: testInfo.outputPath('contractor-' + (mobile ? 'phone' : 'desktop') + '.png'),
        fullPage: true,
      });
      role = 'SAFETY_OFFICER';
      await page.reload();
      await page.getByRole('button', { name: /Synthetic Correct/ }).click();
      await page.getByRole('button', { name: en['documents.view'], exact: true }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByLabel(en['documents.note']).fill('Synthetic original verified');
      await page.getByLabel(en['documents.confirm']).check();
      await page.getByRole('button', { name: en['documents.approve'], exact: true }).click();
      await expect(
        page.getByRole('button', {
          name: new RegExp(en['documents.HEALTH_CERTIFICATE'] + '.*' + en['documents.APPROVED']),
        }),
      ).toBeVisible();
      expect(scans).toBe(3);
      await assertLayout(page);
      expect(errors).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath('approved-' + (mobile ? 'phone' : 'desktop') + '.png'),
        fullPage: true,
      });
    },
  );
}

async function assertLayout(page: Page) {
  const overflow = await page.evaluate(() => {
    if (document.documentElement.scrollWidth <= innerWidth + 2) return [];
    return [...document.querySelectorAll<HTMLElement>('main *')]
      .filter((el) => el.getBoundingClientRect().right > innerWidth + 2)
      .slice(0, 8)
      .map((el) => ({
        tag: el.tagName,
        className: el.className,
        width: el.getBoundingClientRect().width,
        text: el.textContent?.slice(0, 70),
      }));
  });
  expect(overflow).toEqual([]);
  expect(await page.locator('main').innerText()).not.toMatch(/documents\.[A-Za-z]+|\{\{/);
}
