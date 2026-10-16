import i18n, { translate } from './index';
import { SITE_GATES } from '@smartsite/contracts/gate-permissions';
/** Translate presentation metadata only. API values and authored names/reasons stay unchanged. */
export function localizedLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const code = value.trim().toUpperCase().replaceAll(' ', '_');
  return i18n.exists('labels.' + code) ? translate('labels.' + code) : value;
}

/** Labels emitted by live AI and the bundled replay, separate from authored names. */
export function localizedDetectionLabel(value: string): string {
  const replay = /^(MF04|MF05) (.+)$/.exec(value);
  return replay ? `${replay[1]} ${localizedLabel(replay[2])}` : localizedLabel(value);
}

export function localizedGateName(gateId: string): string {
  return SITE_GATES.some((gate) => gate.id === gateId) ? translate(`gates.${gateId}`) : gateId;
}
