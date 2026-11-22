import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const RAW_CAMERA_MEDIA_CANVAS_EN = {
  'ppe.rawCanvas.ariaLabel': 'Raw unanalyzed camera live video stream',
  'ppe.rawCanvas.configuredRegions': 'Configured observation regions: {{count}}',
} as const;

export type RawCameraMediaCanvasCopyKey = keyof typeof RAW_CAMERA_MEDIA_CANVAS_EN;

const RAW_CAMERA_MEDIA_CANVAS_VI: Record<RawCameraMediaCanvasCopyKey, string> = {
  'ppe.rawCanvas.ariaLabel': 'Luồng video trực tiếp gốc từ camera chưa qua phân tích',
  'ppe.rawCanvas.configuredRegions': 'Vùng quan sát đã cấu hình: {{count}}',
};

let isCatalogRegistered = false;

export function registerRawCameraMediaCanvasCatalog(): void {
  if (isCatalogRegistered) {
    return;
  }
  registerFeatureCatalog({
    en: RAW_CAMERA_MEDIA_CANVAS_EN,
    vi: RAW_CAMERA_MEDIA_CANVAS_VI,
  });
  isCatalogRegistered = true;
}

registerRawCameraMediaCanvasCatalog();
