import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const en = {
  'cameraSetup.gateBadge': 'Gate',
  'cameraSetup.gateCameraBadge': 'Gate camera',
  'cameraSetup.gateRowHint': 'Gate access camera — managed in Site Setup.',
  'cameraSetup.gateOpenConfigAction': 'Open Site Setup',
  'cameraSetup.gateStageHeading': 'Gate camera — managed in Site Setup',
  'cameraSetup.gateStageBody':
    '{{name}} ({{code}}) is a gate access camera, not a PPE or Restricted Zone AI camera. Open Site Setup to manage gates for this site.',
  'cameraSetup.gateStageMetadataSummary': 'Gate camera details',
  'cameraSetup.gateStageGateIdLabel': 'Gate ID',
  'cameraSetup.gateStageUnassignedGate': 'Not linked to a specific gate yet',
};

const vi: Record<keyof typeof en, string> = {
  'cameraSetup.gateBadge': 'Cổng',
  'cameraSetup.gateCameraBadge': 'Camera cổng',
  'cameraSetup.gateRowHint': 'Camera kiểm soát cổng — quản lý tại Thiết lập công trường.',
  'cameraSetup.gateOpenConfigAction': 'Mở Thiết lập công trường',
  'cameraSetup.gateStageHeading': 'Camera cổng — quản lý tại Thiết lập công trường',
  'cameraSetup.gateStageBody':
    '{{name}} ({{code}}) là camera kiểm soát cổng ra vào, không dùng để giám sát PPE hay khu vực hạn chế bằng AI. Mở Thiết lập công trường để quản lý các cổng của công trường này.',
  'cameraSetup.gateStageMetadataSummary': 'Chi tiết camera cổng',
  'cameraSetup.gateStageGateIdLabel': 'Mã cổng',
  'cameraSetup.gateStageUnassignedGate': 'Chưa gắn cổng cụ thể',
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
