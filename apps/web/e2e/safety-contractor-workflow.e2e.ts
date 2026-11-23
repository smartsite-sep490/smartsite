import { test, expect, type Page } from '@playwright/test';
import { createSafetyFixture, siteId } from './safety-workflow-fixture';

async function install(
  page: Page,
  fixture: ReturnType<typeof createSafetyFixture>,
  language = 'en',
) {
  await page.addInitScript(
    (locale) => localStorage.setItem('smartsite-language', locale),
    language,
  );
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': 'http://127.0.0.1:5181',
          'access-control-allow-credentials': 'true',
          'access-control-allow-headers': 'authorization,content-type',
        },
      });
    let body: Record<string, unknown> = {};
    try {
      body = request.postDataJSON() ?? {};
    } catch {
      const raw = request.postData() ?? '';
      for (const key of ['expectedVersion', 'commandId', 'resultDescription']) {
        const match = new RegExp('name="' + key + '"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--').exec(raw);
        if (match) body[key] = match[1];
      }
    }
    const result = fixture.handle(request.method(), request.url(), body);
    await route.fulfill({
      status: result.status,
      json: result.data,
      headers: {
        'access-control-allow-origin': 'http://127.0.0.1:5181',
        'access-control-allow-credentials': 'true',
      },
    });
  });
}

for (const width of [1920, 1366, 1024])
  test('natural detail page keeps the incident list independent at ' + width, async ({ page }) => {
    const fixture = createSafetyFixture();
    const incident = fixture.incidents[0]!;
    incident.description = Array.from(
      { length: 24 },
      (_, i) => `Repair detail ${i + 1}: inspect the barrier and record the result.`,
    ).join('\n\n');
    await install(page, fixture);
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 768 });
    await page.goto(`/incidents?tab=incidents&siteId=${siteId}&incidentId=${incident.id}`);
    await expect(page.getByRole('heading', { name: incident.title, exact: true })).toBeVisible();
    const content = page.locator('.workflow-detail-content'),
      list = page.locator('.workflow-list-items');
    await expect(content).toHaveCSS('overflow-y', 'visible');
    const listBox = (await list.boundingBox())!;
    await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2);
    await page.mouse.wheel(0, 450);
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const position = await list.evaluate((el) => el.scrollTop);
    const detailBox = (await content.boundingBox())!;
    await page.mouse.move(detailBox.x + detailBox.width / 2, Math.min(detailBox.y + 100, 500));
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    expect(await list.evaluate((el) => el.scrollTop)).toBe(position);
    expect(await content.evaluate((el) => el.scrollTop)).toBe(0);
    expect(
      (await page.locator('.workflow-detail-navigation').boundingBox())!.y,
    ).toBeGreaterThanOrEqual(63);
    expect((await page.getByRole('complementary').boundingBox())!.y).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

for (const width of [1920, 1366, 1024, 390])
  test('Safety workspace navigation and responsive panels at ' + width, async ({ page }, info) => {
    const fixture = createSafetyFixture(),
      errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: width < 1024 ? 844 : width === 1920 ? 1080 : 768 });
    await install(page, fixture, 'vi');
    const incident = fixture.incidents[0]!,
      action = incident.actions[0]!;
    await page.goto(
      `/incidents?tab=incidents&siteId=${siteId}&incidentId=${incident.id}&actionId=${action.id}`,
    );
    await expect(page.getByRole('button', { name: 'Duyệt kết quả', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Xử lý', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText('Chi tiết kỹ thuật', { exact: true })).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(
      /[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}/i,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    if (width >= 1024) {
      const list = page.locator('.workflow-list-items'),
        detail = page.locator('.workflow-detail-content');
      const pane = await list.boundingBox(),
        other = await detail.boundingBox();
      expect(pane).toBeTruthy();
      expect(other).toBeTruthy();
      expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      const initial = await detail.evaluate((el) => el.scrollTop);
      const initialPageScroll = await page.evaluate(() => scrollY);
      await page.mouse.move(pane!.x + pane!.width / 2, pane!.y + pane!.height / 2);
      await page.mouse.wheel(0, 500);
      await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      expect(await detail.evaluate((el) => el.scrollTop)).toBe(initial);
      await list.evaluate((el) => el.scrollTo(0, 0));
      expect(await page.evaluate(() => scrollY)).toBe(initialPageScroll);
      const footer = await page
        .getByRole('button', { name: 'Duyệt kết quả', exact: true })
        .boundingBox();
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(768 + (width === 1920 ? 312 : 0));
    } else {
      await page.screenshot({ path: info.outputPath('safety-mobile-detail.png'), fullPage: true });
      await page.getByRole('button', { name: 'Quay lại sự cố', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Danh sách sự cố' })).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath(`safety-${width}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });

test('native Safety handover menu is clickable and the contractor can submit, rework and complete', async ({
  page,
}, info) => {
  const fixture = createSafetyFixture();
  await install(page, fixture);
  const incident = fixture.incidents[2]!;
  incident.actions = [];
  incident.status = 'OPEN';
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/incidents?tab=incidents&siteId=${siteId}&incidentId=${incident.id}`);
  await page.getByRole('button', { name: 'Hand over to contractor', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('[data-value="Choose a contractor representative"]').click();
  const option = page
    .getByRole('listbox')
    .getByRole('option', { name: 'Đại diện nhà thầu kiểm thử', exact: true });
  await expect(option).toBeVisible();
  expect(
    await option.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return (
        !!el.closest('dialog') &&
        el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
      );
    }),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath('handover-dropdown.png'), fullPage: true });
  await option.click();
  await dialog
    .getByLabel('Handling request', { exact: true })
    .fill('Synthetic handover for regression verification');
  await dialog.getByRole('button', { name: 'Hand over to contractor', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const action = incident.actions[0]!;
  expect(action).toBeTruthy();
  fixture.setRole('CONTRACTOR_REPRESENTATIVE');
  await page.goto(
    `/assigned-work?siteId=${siteId}&incidentId=${incident.id}&actionId=${action.id}`,
  );
  await expect(page.getByRole('button', { name: 'Assigned work', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start handling', exact: true }).click();
  await page.getByRole('button', { name: 'Report handling outcome', exact: true }).click();
  await page.getByLabel('Result description', { exact: true }).fill('Synthetic repair result');
  await page.getByLabel('Photo (optional JPEG, max 1 MiB)', { exact: true }).setInputFiles({
    name: 'synthetic.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]),
  });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Report handling outcome', exact: true })
    .click();
  await expect(page.getByText('Awaiting Safety recording', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('contractor-assigned-work.png'), fullPage: true });
  fixture.setRole('SAFETY_OFFICER');
  await page.goto(
    `/incidents?tab=incidents&siteId=${siteId}&incidentId=${incident.id}&actionId=${action.id}`,
  );
  await page.getByRole('button', { name: 'Request rework', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Review decision', exact: true })).toHaveValue(
    'REJECTED',
  );
  await page
    .getByLabel('Recording note', { exact: true })
    .fill('Please check the synthetic guardrail again');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Record handling outcome', exact: true })
    .click();
  await expect.poll(() => action.status).toBe('IN_PROGRESS');
  fixture.setRole('CONTRACTOR_REPRESENTATIVE');
  await page.goto(
    `/assigned-work?siteId=${siteId}&incidentId=${incident.id}&actionId=${action.id}`,
  );
  await page.getByRole('button', { name: 'Report handling outcome', exact: true }).click();
  await page.getByLabel('Result description', { exact: true }).fill('Synthetic repair rechecked');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Report handling outcome', exact: true })
    .click();
  await expect.poll(() => action.status).toBe('SUBMITTED');
  fixture.setRole('SAFETY_OFFICER');
  await page.goto(
    `/incidents?tab=incidents&siteId=${siteId}&incidentId=${incident.id}&actionId=${action.id}`,
  );
  await page.getByRole('button', { name: 'Approve result', exact: true }).click();
  await page.getByLabel('Recording note', { exact: true }).fill('Synthetic repair accepted');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Record handling outcome', exact: true })
    .click();
  await expect.poll(() => action.status).toBe('CLOSED');
  expect(
    fixture.requests
      .filter((item) => item.path.endsWith('/reviews'))
      .map((item) => item.body.decision),
  ).toEqual(['REJECTED', 'APPROVED']);
});

test('canonical Safety navigation survives reload, Back, legacy links and collapsed sidebar', async ({
  page,
}) => {
  const fixture = createSafetyFixture();
  await install(page, fixture);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Safety overview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Safety Operations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Alerts', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Incidents', exact: true }).click();
  await expect(page).toHaveURL(/tab=incidents/);
  await page.reload();
  await expect(page.getByRole('link', { name: 'Incidents', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Alerts', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Incidents', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await page.getByRole('link', { name: 'Checklists', exact: true }).click();
  await expect(page).toHaveURL(/tab=checklists/);
  await page.goto(`/incidents?tab=documents&siteId=${siteId}&workerId=synthetic-worker`);
  await expect(page).toHaveURL(/worker-documents\?.*workerId=synthetic-worker/);
  await page.goto(`/incidents?tab=overview&siteId=${siteId}`);
  await expect(page).toHaveURL(/dashboard\?siteId=/);
  await expect(page.getByRole('heading', { name: 'Safety overview', exact: true })).toBeVisible();
});

test('alerts show context without photos and use natural detail scrolling', async ({
  page,
}, info) => {
  const fixture = createSafetyFixture();
  await install(page, fixture, 'vi');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/incidents?alertId=${fixture.alerts[0]!.id}&siteId=${siteId}`);
  await expect(page.getByRole('tab', { name: 'Xem xét', exact: true })).toBeVisible();
  await expect(page.getByText(/Khu vực: Sảnh tầng 1.*Camera: Camera sảnh/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ngữ cảnh công việc' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /hướng dẫn/i })).toHaveCount(0);
  const detail = page.locator('.workflow-detail-content');
  await expect(detail).toHaveCSS('overflow-y', 'visible');
  const list = page.locator('.workflow-list-items');
  expect(await list.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
  const box = (await detail.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 100);
  await page.mouse.wheel(0, 500);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  expect(await detail.evaluate((e) => e.scrollTop)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1366);
  await page.screenshot({
    path: info.outputPath('alerts-context-without-photos.png'),
    fullPage: true,
  });
  await page.getByRole('tab', { name: 'Bằng chứng', exact: true }).click();
  await expect(page.getByText(/Khu vực: Sảnh tầng 1.*Camera: Camera sảnh/)).toBeVisible();
  await page.getByRole('tab', { name: 'Lịch sử', exact: true }).click();
  await page.screenshot({ path: info.outputPath('alerts-desktop.png'), fullPage: true });
});

test('source-free alerts keep partial and missing context visible', async ({ page }) => {
  const fixture = createSafetyFixture();
  await install(page, fixture);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/incidents?alertId=${fixture.alerts[1]!.id}&siteId=${siteId}`);
  await expect(page.getByText(/Zone: Sảnh tầng 1.*Camera: No information yet/)).toBeVisible();
  await expect(page.getByText(/No source observation is linked/)).toBeVisible();
  await page.getByRole('tab', { name: 'Evidence', exact: true }).click();
  await expect(page.getByText(/Zone: Sảnh tầng 1.*Camera: No information yet/)).toBeVisible();
  await page.goto(`/incidents?alertId=${fixture.alerts[2]!.id}&siteId=${siteId}`);
  await expect(
    page.getByText('Zone: No information yet · Camera: No information yet'),
  ).toBeVisible();
});

test('manual incident selection updates the URL and Back restores the linked handover', async ({
  page,
}) => {
  const fixture = createSafetyFixture();
  await install(page, fixture);
  const first = fixture.incidents[0]!,
    other = fixture.incidents[1]!;
  await page.goto(
    `/incidents?tab=incidents&siteId=${siteId}&incidentId=${first.id}&actionId=${first.actions[0]!.id}`,
  );
  await page.getByRole('button', { name: new RegExp(other.title + ' Assigned') }).click();
  await expect(page).toHaveURL(new RegExp('incidentId=' + other.id + '$'));
  await expect(page.getByRole('heading', { name: other.title, exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Handling', exact: true }).click();
  await expect(
    page.getByText('This handover is no longer available.', { exact: true }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('heading', { name: first.title, exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Handling', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

for (const width of [1366, 390])
  test('long incident form keeps its submit visible at ' + width, async ({ page }, info) => {
    const fixture = createSafetyFixture();
    await install(page, fixture);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    await page.goto(`/incidents?tab=incidents&siteId=${siteId}`);
    await page.getByRole('button', { name: 'New incident', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const submit = dialog.getByRole('button', { name: 'Create incident', exact: true });
    await expect(submit).toBeVisible();
    const box = await submit.boundingBox();
    expect(box!.y + box!.height).toBeLessThan(width === 390 ? 844 : 768);
    expect(
      await dialog.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
      }),
    ).toBe(true);
    const fields = dialog.locator('fieldset > div > div').first();
    expect(await fields.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await dialog
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill('Keep this synthetic draft');
    await dialog
      .getByRole('textbox', { name: 'Occurred at (local time)', exact: true })
      .fill('2026-11-22T08:00');
    await fields.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(submit).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`long-form-${width}.png`), fullPage: true });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(
      fixture.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/incidents')),
    ).toHaveLength(0);
  });
