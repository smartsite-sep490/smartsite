import { beforeEach } from 'vitest';
import i18n from './index';

// Each test starts deterministically in English; Vietnamese suites override this hook.
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
