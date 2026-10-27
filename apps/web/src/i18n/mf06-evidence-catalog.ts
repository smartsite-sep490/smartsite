import { hasRegisteredFeatureKey, registerFeatureCatalog } from './feature-catalog-registry';

export const MF06_EVIDENCE_EN_CATALOG = {
  'mf06.evidence.title': 'Original observation frame',
  'mf06.evidence.caption':
    'Original observation, not a verified worker identity or proof AI consumed this image.',
  'mf06.evidence.alt': 'Original observation frame captured at {capturedAt}',
  'mf06.evidence.loading': 'Loading observation frame…',
  'mf06.evidence.sessionExpired': 'Session expired or unauthorized. Please sign in again.',
  'mf06.evidence.denied': 'You do not have permission to view this observation frame.',
  'mf06.evidence.notFound': 'No observation frame is available for this assessment.',
  'mf06.evidence.unavailable': 'Observation frame could not be loaded.',
  'mf06.evidence.retry': 'Retry',
} as const;

export type Mf06EvidenceTranslationKey = keyof typeof MF06_EVIDENCE_EN_CATALOG;

export const MF06_EVIDENCE_VI_CATALOG: Record<Mf06EvidenceTranslationKey, string> = {
  'mf06.evidence.title': 'Khung hình quan sát gốc',
  'mf06.evidence.caption':
    'Quan sát gốc, không phải bằng chứng đã định danh công nhân hay AI đã sử dụng ảnh này.',
  'mf06.evidence.alt': 'Khung hình quan sát gốc chụp lúc {capturedAt}',
  'mf06.evidence.loading': 'Đang tải khung hình quan sát…',
  'mf06.evidence.sessionExpired':
    'Phiên làm việc đã hết hạn hoặc chưa được xác thực. Vui lòng đăng nhập lại.',
  'mf06.evidence.denied': 'Bạn không có quyền xem khung hình quan sát này.',
  'mf06.evidence.notFound': 'Không có khung hình quan sát khả dụng cho bản ghi đánh giá này.',
  'mf06.evidence.unavailable': 'Không thể tải khung hình quan sát.',
  'mf06.evidence.retry': 'Thử lại',
};

const MF06_EVIDENCE_SENTINEL_KEY: Mf06EvidenceTranslationKey = 'mf06.evidence.title';

export function registerMf06EvidenceCatalog(): void {
  if (hasRegisteredFeatureKey(MF06_EVIDENCE_SENTINEL_KEY)) {
    return;
  }
  registerFeatureCatalog({
    en: MF06_EVIDENCE_EN_CATALOG,
    vi: MF06_EVIDENCE_VI_CATALOG,
  });
}

registerMf06EvidenceCatalog();
