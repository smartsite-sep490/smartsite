import i18n, { translate } from './index';
/** Translate presentation metadata only. API values and authored names/reasons stay unchanged. */
export function localizedLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const code = value.trim().toUpperCase().replaceAll(' ', '_');
  return i18n.exists('labels.' + code) ? translate('labels.' + code) : value;
}
