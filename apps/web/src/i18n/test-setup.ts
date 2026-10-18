import { beforeEach } from 'vitest';
import i18n from './index';
import { ensureCommonCatalogs } from './runtime';

// Standalone feature tests enter through the same resource gate as lazy pages.
await ensureCommonCatalogs();

// Each test starts deterministically in English; Vietnamese suites override this hook.
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
