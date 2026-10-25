import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import i18n, { translate } from './index';
import { localizeMessage, localizedError, userErrorMessage } from './messages';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe.each(['en', 'vi'] as const)('safe UI errors in %s', (language) => {
  it('replaces unknown technical text without changing authored content', async () => {
    await i18n.changeLanguage(language);
    for (const text of [
      'Backend returned invalid JSON.',
      'Backend returned HTTP 502.',
      'Internal server error',
      'private-host.example:5432',
    ]) {
      expect(localizedError(text)).toBe(translate('errors.unexpected'));
      expect(userErrorMessage(new Error(text))).toBe(translate('errors.unexpected'));
      expect(localizeMessage(text)).toBe(text);
    }
    expect(localizedError('An approved worker assignment with an expiry is required')).toBe(
      localizeMessage('An approved worker assignment with an expiry is required'),
    );
  });

  it.each([
    ['network', undefined, 'errors.network'],
    ['timeout', undefined, 'errors.timeout'],
    ['cancelled', undefined, 'errors.cancelled'],
    ['http', 400, 'errors.validation'],
    ['http', 401, 'errors.sessionExpired'],
    ['http', 403, 'errors.forbidden'],
    ['http', 404, 'errors.notFound'],
    ['http', 409, 'errors.conflict'],
    ['http', 429, 'errors.rateLimit'],
    ['http', 500, 'errors.unavailable'],
    ['invalid-response', 200, 'errors.unavailable'],
    ['invalid-response', 502, 'errors.unavailable'],
  ] as const)('maps %s / %s without reflecting internal text', async (code, status, key) => {
    await i18n.changeLanguage(language);
    const message = userErrorMessage(new ApiError(code, 'PRIVATE_SENTINEL', status));
    expect(message).toBe(translate(key));
    expect(message).not.toBe(key);
    expect(message).not.toContain('PRIVATE_SENTINEL');
  });

  it('keeps approved validation and uses rate-limit delay', async () => {
    await i18n.changeLanguage(language);
    expect(
      userErrorMessage(
        new ApiError('http', 'An approved worker assignment with an expiry is required', 400),
      ),
    ).toBe(localizeMessage('An approved worker assignment with an expiry is required'));
    expect(userErrorMessage(new ApiError('http', 'PRIVATE_SENTINEL', 429, undefined, 17))).toBe(
      translate('errors.rateLimitDelay', { seconds: 17 }),
    );
  });

  it.each([
    [400, 'errors.validation'],
    [401, 'errors.sessionExpired'],
    [403, 'errors.forbidden'],
    [404, 'errors.notFound'],
    [409, 'errors.conflict'],
    [429, 'errors.rateLimitDelay'],
  ] as const)(
    'keeps HTTP %s guidance when its response body is unreadable',
    async (status, key) => {
      await i18n.changeLanguage(language);
      expect(
        userErrorMessage(
          new ApiError(
            'invalid-response',
            'PRIVATE_HTML',
            status,
            undefined,
            status === 429 ? 17 : undefined,
          ),
        ),
      ).toBe(translate(key, { seconds: 17 }));
    },
  );
});
