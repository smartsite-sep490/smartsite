import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const en = {
  'cameraSetup.gateBadge': 'Gate',
  'cameraSetup.gateCameraBadge': 'Gate camera',
  'cameraSetup.gateRowHint': 'Gate access camera — configured in Site Setup.',
  'cameraSetup.gateOpenConfigAction': 'Open gate configuration',
  'cameraSetup.gateStageHeading': 'Gate camera — configured in Site Setup',
  'cameraSetup.gateStageBody':
    '{{name}} ({{code}}) is a Gate access camera (MF04), not a Zone PPE or Restricted Zone AI camera. PPE monitoring, Zone monitoring, observation regions, PPE policies, and Zone AI video-source apply are not used for Gate cameras.',
  'cameraSetup.gateStageMetadataSummary': 'Gate camera details',
  'cameraSetup.gateStageGateIdLabel': 'Gate ID',
  'cameraSetup.gateStageUnassignedGate': 'Not linked to a specific gate ID yet',
};

const vi: Record<keyof typeof en, string> = {
  'cameraSetup.gateBadge': 'Cổng',
  'cameraSetup.gateCameraBadge': 'Camera cổng',
  'cameraSetup.gateRowHint': 'Camera kiểm soát cổng — cấu hình tại Thiết lập công trường.',
  'cameraSetup.gateOpenConfigAction': 'Mở cấu hình cổng',
  'cameraSetup.gateStageHeading': 'Camera cổng — cấu hình tại Thiết lập công trường',
  'cameraSetup.gateStageBody':
    '{{name}} ({{code}}) là camera kiểm soát cổng (MF04), không phải camera AI khu vực (PPE / vùng hạn chế). Màn hình giám sát PPE, giám sát khu vực, vùng quan sát, chính sách PPE và áp dụng nguồn video AI khu vực không áp dụng cho camera cổng.',
  'cameraSetup.gateStageMetadataSummary': 'Chi tiết camera cổng',
  'cameraSetup.gateStageGateIdLabel': 'Mã cổng (Gate ID)',
  'cameraSetup.gateStageUnassignedGate': 'Chưa gắn mã cổng cụ thể',
};

let registered = false;

export function registerCameraGateBoundaryCopy(): void {
  if (registered) return;
  registered = true;
  registerFeatureCatalog({ en, vi });
}

export function buildGateConfigurationHref(siteId: string, gateId?: string | null): string {
  const params = new URLSearchParams({ siteId });
  if (gateId && gateId.trim().length > 0) {
    params.set('gateId', gateId);
  }
  return `/site-setup?${params.toString()}`;
}
