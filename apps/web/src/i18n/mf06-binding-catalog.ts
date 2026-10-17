import type { AssessmentBindingMismatchCode } from '../components/ppe/mf06AssessmentDetailBinding';
import { hasRegisteredFeatureKey, registerFeatureCatalog } from './feature-catalog-registry';

export const MF06_BINDING_EN_CATALOG = {
  'mf06.detail.bindingReason.ASSESSMENT_ID_MISMATCH': 'Assessment ID mismatch',
  'mf06.detail.bindingReason.SITE_ID_MISMATCH': 'Site ID mismatch',
  'mf06.detail.bindingReason.REQUEST_ID_MISMATCH': 'Request ID mismatch',
  'mf06.detail.bindingReason.EVENT_ID_MISMATCH': 'Event ID mismatch',
  'mf06.detail.bindingReason.CAMERA_ID_MISMATCH': 'Camera ID mismatch',
  'mf06.detail.bindingReason.ZONE_ID_MISMATCH': 'Zone ID mismatch',
  'mf06.detail.bindingReason.PURPOSE_MISMATCH': 'Purpose mismatch',
  'mf06.detail.bindingReason.CAPTURED_AT_PRECISION_MISMATCH': 'CapturedAt precision mismatch',
  'mf06.detail.bindingReason.OUTCOME_MISMATCH': 'Outcome mismatch',
  'mf06.detail.bindingReason.REASON_CODE_MISMATCH': 'Reason code mismatch',
  'mf06.detail.bindingReason.PROVENANCE_MISMATCH': 'Provenance mismatch',
  'mf06.detail.bindingReason.EVALUATOR_VERSION_MISMATCH': 'Evaluator version mismatch',
  'mf06.detail.bindingReason.ASSESSED_AT_PRECISION_MISMATCH': 'AssessedAt precision mismatch',
} as const;

export type Mf06BindingTranslationKey = keyof typeof MF06_BINDING_EN_CATALOG;

export const MF06_BINDING_VI_CATALOG: Record<Mf06BindingTranslationKey, string> = {
  'mf06.detail.bindingReason.ASSESSMENT_ID_MISMATCH': 'Mã đánh giá không khớp',
  'mf06.detail.bindingReason.SITE_ID_MISMATCH': 'Mã công trường không khớp',
  'mf06.detail.bindingReason.REQUEST_ID_MISMATCH': 'Mã yêu cầu không khớp',
  'mf06.detail.bindingReason.EVENT_ID_MISMATCH': 'Mã sự kiện không khớp',
  'mf06.detail.bindingReason.CAMERA_ID_MISMATCH': 'Mã camera không khớp',
  'mf06.detail.bindingReason.ZONE_ID_MISMATCH': 'Mã khu vực không khớp',
  'mf06.detail.bindingReason.PURPOSE_MISMATCH': 'Mục đích đánh giá không khớp',
  'mf06.detail.bindingReason.CAPTURED_AT_PRECISION_MISMATCH':
    'Độ chính xác thời điểm ghi hình không khớp',
  'mf06.detail.bindingReason.OUTCOME_MISMATCH': 'Kết quả đánh giá không khớp',
  'mf06.detail.bindingReason.REASON_CODE_MISMATCH': 'Mã lý do không khớp',
  'mf06.detail.bindingReason.PROVENANCE_MISMATCH': 'Nguồn xác lập không khớp',
  'mf06.detail.bindingReason.EVALUATOR_VERSION_MISMATCH': 'Phiên bản bộ đánh giá không khớp',
  'mf06.detail.bindingReason.ASSESSED_AT_PRECISION_MISMATCH':
    'Độ chính xác thời điểm đánh giá không khớp',
};

export const MF06_BINDING_REASON_KEYS: Readonly<
  Record<AssessmentBindingMismatchCode, Mf06BindingTranslationKey>
> = {
  ASSESSMENT_ID_MISMATCH: 'mf06.detail.bindingReason.ASSESSMENT_ID_MISMATCH',
  SITE_ID_MISMATCH: 'mf06.detail.bindingReason.SITE_ID_MISMATCH',
  REQUEST_ID_MISMATCH: 'mf06.detail.bindingReason.REQUEST_ID_MISMATCH',
  EVENT_ID_MISMATCH: 'mf06.detail.bindingReason.EVENT_ID_MISMATCH',
  CAMERA_ID_MISMATCH: 'mf06.detail.bindingReason.CAMERA_ID_MISMATCH',
  ZONE_ID_MISMATCH: 'mf06.detail.bindingReason.ZONE_ID_MISMATCH',
  PURPOSE_MISMATCH: 'mf06.detail.bindingReason.PURPOSE_MISMATCH',
  CAPTURED_AT_PRECISION_MISMATCH: 'mf06.detail.bindingReason.CAPTURED_AT_PRECISION_MISMATCH',
  OUTCOME_MISMATCH: 'mf06.detail.bindingReason.OUTCOME_MISMATCH',
  REASON_CODE_MISMATCH: 'mf06.detail.bindingReason.REASON_CODE_MISMATCH',
  PROVENANCE_MISMATCH: 'mf06.detail.bindingReason.PROVENANCE_MISMATCH',
  EVALUATOR_VERSION_MISMATCH: 'mf06.detail.bindingReason.EVALUATOR_VERSION_MISMATCH',
  ASSESSED_AT_PRECISION_MISMATCH: 'mf06.detail.bindingReason.ASSESSED_AT_PRECISION_MISMATCH',
};

const MF06_BINDING_SENTINEL_KEY: Mf06BindingTranslationKey =
  'mf06.detail.bindingReason.ASSESSMENT_ID_MISMATCH';

export function registerMf06BindingCatalog(): void {
  if (hasRegisteredFeatureKey(MF06_BINDING_SENTINEL_KEY)) {
    return;
  }
  registerFeatureCatalog({
    en: MF06_BINDING_EN_CATALOG,
    vi: MF06_BINDING_VI_CATALOG,
  });
}

registerMf06BindingCatalog();
