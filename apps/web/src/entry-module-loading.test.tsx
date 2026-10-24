// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';

const entry = vi.hoisted(() => ({ menuLoads: 0, render: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: entry.render }) }));
vi.mock('./i18n/LanguageSwitcher', () => {
  entry.menuLoads += 1;
  return { LanguageSwitcher: () => <button type="button">Language fixture</button> };
});

it('initializes the application without evaluating the deferred language menu', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  await import('./main');
  expect(entry.render).toHaveBeenCalledTimes(1);
  expect(entry.menuLoads).toBe(0);
});
