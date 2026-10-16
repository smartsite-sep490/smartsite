import { localizedLabel } from '../../i18n/labels';
import { localizeMessage } from '../../i18n/messages';
import type { LocaleContextValue, PpeTranslationKey } from '../../i18n/ppe-locale';

type Translator = LocaleContextValue['t'];
const messageKeys: Record<string, PpeTranslationKey> = {
  'Cannot save polygon: camera snapshot is not live or does not match.':
    'restrictedZone.status.cannotSavePolygonNotLive',
  'Cannot save draft: camera snapshot is not live or does not match.':
    'restrictedZone.status.cannotSaveDraftNotLive',
  'Your session is no longer valid. Sign in again.': 'restrictedZone.error.sessionNoLongerValid',
};
const labelKeys: Record<string, PpeTranslationKey> = {
  'Backend evaluation required': 'restrictedZone.event.authBackendRequired',
  'Technical entry': 'restrictedZone.event.resultTechnicalEntry',
  'Scanning Snapshot': 'restrictedZone.event.resultScanningSnapshot',
};

// Keep technical row values and feedback in state unchanged. Translate only
// when rendering so changing language never recreates queries or observations.
export function presentZoneMessage(value: string, t: Translator): string {
  const key = Object.hasOwn(messageKeys, value) ? messageKeys[value] : undefined;
  return key ? t(key) : localizeMessage(value);
}

export function presentZoneLabel(value: string, t: Translator): string {
  const key = Object.hasOwn(labelKeys, value) ? labelKeys[value] : undefined;
  return key ? t(key) : localizedLabel(value);
}
