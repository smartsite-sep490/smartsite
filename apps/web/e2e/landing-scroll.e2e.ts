import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`landing scroll controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/auth/refresh', (route) => route.fulfill({ status: 401, body: '{}' }));
    await page.goto('/');
    const header = page.locator('header');
    await expect(header).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const frame = page.locator('.ai-camera-frame');
    await expect(frame).toBeAttached();
    await frame.evaluate((element) =>
      window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 600),
    );
    await expect.poll(async () => (await header.boundingBox())?.y).toBe(0);
    await expect(header).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const laserY = () =>
      page
        .locator('.ai-laser')
        .evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m42);
    await page.waitForTimeout(1500);
    const before = await laserY();
    await page.evaluate(() => window.scrollBy(0, 350));
    await expect.poll(laserY).toBeGreaterThan(before + 10);
    const back = page.locator('footer button');
    await back.scrollIntoViewIfNeeded();
    await expect(back.locator('svg')).toBeVisible();
    await back.click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });
}
