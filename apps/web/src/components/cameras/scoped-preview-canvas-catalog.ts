import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const SCOPED_PREVIEW_CANVAS_EN = {
  'ppe.trackLabel': 'Track #{id}',
  'ppe.previewCanvas.regionPrefix': 'Region',
  'ppe.previewCanvas.experimentalObjectSummary':
    'Experimental object: {className} ({confidence}%).',
  'ppe.previewCanvas.currentFrameObservationsAria': 'Current frame observations',
  'ppe.previewCanvas.observationBoundaries': 'Observation boundaries · access policy is not shown',
  'ppe.previewCanvas.zoneAnchorHelp':
    'Bottom-center marker: zone entry uses this point, not head or torso overlap. Keep the full body in view.',
  'ppe.previewCanvas.zoneAnchorHelpBoxCenter':
    'Box-center marker: zone entry uses the center point of the person box.',
  'ppe.previewCanvas.frameDetailsAria': 'Frame observation details',
  'ppe.previewCanvas.frameObservationsCount': 'Frame ({count} observation(s))',
  'ppe.previewCanvas.regionParen': '(Region: {regionId})',
  'ppe.previewCanvas.boxPx': 'Box px: {box}',
} as const;

export type ScopedPreviewCanvasCopyKey = keyof typeof SCOPED_PREVIEW_CANVAS_EN;

const SCOPED_PREVIEW_CANVAS_VI: Record<ScopedPreviewCanvasCopyKey, string> = {
  'ppe.trackLabel': 'Track #{id}',
  'ppe.previewCanvas.regionPrefix': 'Khu vực',
  'ppe.previewCanvas.experimentalObjectSummary': 'Vật thể thử nghiệm: {className} ({confidence}%).',
  'ppe.previewCanvas.currentFrameObservationsAria': 'Các quan sát trong khung hình hiện tại',
  'ppe.previewCanvas.observationBoundaries':
    'Ranh giới quan sát · không thể hiện chính sách ra vào',
  'ppe.previewCanvas.zoneAnchorHelp':
    'Điểm xanh giữa đáy khung: dùng để kiểm tra vào vùng, không dùng phần đầu hay thân giao nhau. Nên thấy toàn thân trong ảnh.',
  'ppe.previewCanvas.zoneAnchorHelpBoxCenter':
    'Điểm xanh tâm khung: dùng tâm khung người này để kiểm tra vào vùng.',
  'ppe.previewCanvas.frameDetailsAria': 'Chi tiết quan sát trong khung hình',
  'ppe.previewCanvas.frameObservationsCount': 'Khung hình ({count} quan sát)',
  'ppe.previewCanvas.regionParen': '(Khu vực: {regionId})',
  'ppe.previewCanvas.boxPx': 'Tọa độ khung (px): {box}',
};

let isCatalogRegistered = false;

export function registerScopedPreviewCanvasCatalog(): void {
  if (isCatalogRegistered) {
    return;
  }
  registerFeatureCatalog({
    en: SCOPED_PREVIEW_CANVAS_EN,
    vi: SCOPED_PREVIEW_CANVAS_VI,
  });
  isCatalogRegistered = true;
}

registerScopedPreviewCanvasCatalog();
