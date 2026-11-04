import type { QueryClient } from '@tanstack/react-query';
import { ApiError, type SmartSiteManagementClient, type ZoneResponse } from '@smartsite/api-client';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import type { EditingRegionScope } from './cameraRegionReferenceUtils';
import type { CameraConfigurationReference } from './useCameraConfigurationReference';

export interface ZonePpeCameraRegionPanelProps {
  embedded?: boolean;
  apiUrl: string;
  client?: SmartSiteManagementClient;
  token: string;
  sessionScope: string;
  credentialId: number;
  siteId: string;
  initialCameraId?: string;
  zones: ZoneResponse[];
  tourUserId?: string | null;
  onSelectCamera?: (cameraId: string) => void;
  onDraftStateChange?: (state: { dirty: boolean; saving: boolean }) => void;
  onClose?: () => void;
}

export interface DrawingScope {
  apiUrl: string;
  token: string;
  sessionScope: string;
  credentialId: number;
  internalNonce: number;
  siteId: string;
  cameraId: string;
  zoneId: string;
  reference: CameraConfigurationReference;
  editingRegion: EditingRegionScope | null;
}

const CAMERA_REGION_PANEL_EN = {
  'regionSetup.sectionAria': 'Link Zone to Camera Region',
  'regionSetup.title': 'Link Zone to Camera Region',
  'regionSetup.subtitle': 'Draw and bind camera observation polygon geometry to the selected zone.',
  'regionSetup.closeAria': 'Close',
  'regionSetup.field.selectZone': 'Select Zone',
  'regionSetup.field.selectCamera': 'Select Camera',
  'regionSetup.camera.countSummary': '{active} active ({loaded} loaded of {total} on site)',
  'regionSetup.camera.loading': 'Loading cameras…',
  'regionSetup.camera.retrying': 'Retrying cameras…',
  'regionSetup.camera.retryInitial': 'Retry loading cameras',
  'regionSetup.camera.retryingMore': 'Retrying more cameras…',
  'regionSetup.camera.retryNextPage': 'Retry loading more cameras',
  'regionSetup.camera.loadingMore': 'Loading more cameras…',
  'regionSetup.camera.loadMore': 'Load more cameras',
  'regionSetup.error.401': 'Session expired or unauthorized. Please sign in again.',
  'regionSetup.error.403': 'You do not have permission to perform this action.',
  'regionSetup.reference.error.404':
    'Camera configuration image source was not found for this scope.',
  'regionSetup.camera.error.403': 'You do not have permission to view these cameras.',
  'regionSetup.region.error.403': 'You do not have permission to view these regions.',
  'regionSetup.camera.error.404': 'Camera resource unavailable.',
  'regionSetup.region.error.404': 'Region resource unavailable.',
  'regionSetup.camera.error.default': 'Could not load cameras. Please try again.',
  'regionSetup.region.error.default': 'Could not load regions. Please try again.',
  'regionSetup.action.drawingActive': 'Drawing Active',
  'regionSetup.action.startDrawing': 'Start Drawing Region',
  'regionSetup.action.startDrawingHint':
    'Click Start Drawing on camera frame to define observation area',
  'regionSetup.feedback.saved':
    'Saved region "{id}" (v{version}). Select this region for the AI worker and apply/restart it before monitoring uses it.',
  'regionSetup.list.heading': 'Existing Regions for this Camera & Zone',
  'regionSetup.list.countSummary': '{linked} linked ({loaded} loaded of {total} on camera)',
  'regionSetup.list.loading': 'Loading regions…',
  'regionSetup.list.retrying': 'Retrying regions…',
  'regionSetup.list.retryInitial': 'Retry loading regions',
  'regionSetup.list.emptyHasMore':
    'No linked regions loaded yet for this zone. Loading more camera regions may contain matching areas.',
  'regionSetup.list.empty':
    'No observation regions linked to this zone on the selected camera yet.',
  'regionSetup.list.noCameraSelected':
    'Please select an active camera to view observation regions.',
  'regionSetup.list.versionStatus': 'Version {version} · {status}',
  'regionSetup.list.statusActive': 'Active',
  'regionSetup.list.statusInactive': 'Inactive',
  'regionSetup.list.editGeometry': 'Edit Geometry',
  'regionSetup.list.retryingMore': 'Retrying more regions…',
  'regionSetup.list.retryNextPage': 'Retry loading more regions',
  'regionSetup.list.loadingMore': 'Loading more regions…',
  'regionSetup.list.loadMore': 'Load more regions',
} as const;

const CAMERA_REGION_PANEL_VI: Record<keyof typeof CAMERA_REGION_PANEL_EN, string> = {
  'regionSetup.sectionAria': 'Liên kết Khu vực với Vùng quan sát Camera',
  'regionSetup.title': 'Liên kết Khu vực với Vùng quan sát Camera',
  'regionSetup.subtitle': 'Vẽ và gắn đa giác vùng quan sát của camera vào khu vực đã chọn.',
  'regionSetup.closeAria': 'Đóng',
  'regionSetup.field.selectZone': 'Chọn Khu vực',
  'regionSetup.field.selectCamera': 'Chọn Camera',
  'regionSetup.camera.countSummary':
    '{active} đang hoạt động (đã tải {loaded}/{total} tại công trường)',
  'regionSetup.camera.loading': 'Đang tải camera…',
  'regionSetup.camera.retrying': 'Đang thử tải lại camera…',
  'regionSetup.camera.retryInitial': 'Thử tải lại camera',
  'regionSetup.camera.retryingMore': 'Đang thử tải thêm camera…',
  'regionSetup.camera.retryNextPage': 'Thử tải thêm camera',
  'regionSetup.camera.loadingMore': 'Đang tải thêm camera…',
  'regionSetup.camera.loadMore': 'Tải thêm camera',
  'regionSetup.error.401':
    'Phiên làm việc đã hết hạn hoặc chưa được xác thực. Vui lòng đăng nhập lại.',
  'regionSetup.error.403': 'Bạn không có quyền thực hiện thao tác này.',
  'regionSetup.reference.error.404': 'Không tìm thấy nguồn ảnh cấu hình camera cho phạm vi này.',
  'regionSetup.camera.error.403': 'Bạn không có quyền xem các camera này.',
  'regionSetup.region.error.403': 'Bạn không có quyền xem các vùng quan sát này.',
  'regionSetup.camera.error.404': 'Không tìm thấy tài nguyên camera.',
  'regionSetup.region.error.404': 'Không tìm thấy tài nguyên vùng quan sát.',
  'regionSetup.camera.error.default': 'Không thể tải danh sách camera. Vui lòng thử lại.',
  'regionSetup.region.error.default': 'Không thể tải danh sách vùng quan sát. Vui lòng thử lại.',
  'regionSetup.action.drawingActive': 'Đang vẽ vùng quan sát',
  'regionSetup.action.startDrawing': 'Bắt đầu vẽ vùng quan sát',
  'regionSetup.action.startDrawingHint':
    'Nhấn Bắt đầu vẽ vùng quan sát trên khung hình camera để xác định phạm vi quan sát',
  'regionSetup.feedback.saved':
    'Đã lưu vùng quan sát "{id}" (v{version}). Hãy chọn vùng này cho tiến trình AI và áp dụng/khởi động lại trước khi sử dụng trong giám sát.',
  'regionSetup.list.heading': 'Các vùng quan sát hiện có của Camera & Khu vực này',
  'regionSetup.list.countSummary': '{linked} đã liên kết (đã tải {loaded}/{total} trên camera)',
  'regionSetup.list.loading': 'Đang tải vùng quan sát…',
  'regionSetup.list.retrying': 'Đang thử tải lại vùng quan sát…',
  'regionSetup.list.retryInitial': 'Thử tải lại vùng quan sát',
  'regionSetup.list.emptyHasMore':
    'Chưa tải được vùng quan sát nào liên kết với khu vực này. Tải thêm vùng quan sát của camera có thể có vùng phù hợp.',
  'regionSetup.list.empty':
    'Chưa có vùng quan sát nào được liên kết với khu vực này trên camera đã chọn.',
  'regionSetup.list.noCameraSelected':
    'Vui lòng chọn một camera đang hoạt động để xem các vùng quan sát.',
  'regionSetup.list.versionStatus': 'Phiên bản {version} · {status}',
  'regionSetup.list.statusActive': 'Đang hoạt động',
  'regionSetup.list.statusInactive': 'Ngừng hoạt động',
  'regionSetup.list.editGeometry': 'Sửa hình học',
  'regionSetup.list.retryingMore': 'Đang thử tải thêm vùng quan sát…',
  'regionSetup.list.retryNextPage': 'Thử tải thêm vùng quan sát',
  'regionSetup.list.loadingMore': 'Đang tải thêm vùng quan sát…',
  'regionSetup.list.loadMore': 'Tải thêm vùng quan sát',
};

export type CameraRegionPanelCatalogKey = keyof typeof CAMERA_REGION_PANEL_EN;

export function registerCameraRegionPanelCatalog(): void {
  registerFeatureCatalog({
    en: CAMERA_REGION_PANEL_EN,
    vi: CAMERA_REGION_PANEL_VI,
  });
}

registerCameraRegionPanelCatalog();

export function isAuthOrScopeError(err: unknown): boolean {
  if (err instanceof ApiError && typeof err.status === 'number') {
    return [401, 403, 404].includes(err.status);
  }
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: unknown }).status;
    return typeof status === 'number' && [401, 403, 404].includes(status);
  }
  return false;
}

export function getSafePublicErrorMessage(
  err: unknown,
  entity: 'camera' | 'region',
  t: (key: CameraRegionPanelCatalogKey, params?: Record<string, string | number>) => string,
): string {
  let status: number | null = null;
  if (err instanceof ApiError && typeof err.status === 'number') {
    status = err.status;
  } else if (err && typeof err === 'object' && 'status' in err) {
    const s = (err as { status: unknown }).status;
    if (typeof s === 'number') status = s;
  }

  if (status === 401) {
    return t('regionSetup.error.401');
  }
  if (status === 403) {
    return entity === 'camera'
      ? t('regionSetup.camera.error.403')
      : t('regionSetup.region.error.403');
  }
  if (status === 404) {
    return entity === 'camera'
      ? t('regionSetup.camera.error.404')
      : t('regionSetup.region.error.404');
  }
  return entity === 'camera'
    ? t('regionSetup.camera.error.default')
    : t('regionSetup.region.error.default');
}

const tokenNonces = new WeakMap<QueryClient, { token: string; nonce: number }>();
let nextTokenNonce = 1;
export function getOpaqueTokenNonce(client: QueryClient, token: string): number {
  if (!token) {
    tokenNonces.delete(client);
    return 0;
  }
  const previous = tokenNonces.get(client);
  if (previous?.token === token) return previous.nonce;
  const nonce = nextTokenNonce++;
  tokenNonces.set(client, { token, nonce });
  return nonce;
}

export function validatePage<T extends { items: unknown[]; total: number }>(
  page: T | null | undefined,
  pageParam: number,
  label: 'camera' | 'region',
): T {
  if (
    !page ||
    !Array.isArray(page.items) ||
    !Number.isSafeInteger(page.total) ||
    page.total < 0 ||
    page.items.length > 20
  ) {
    throw new Error(`Malformed ${label} page`);
  }
  if (page.items.length === 0 && pageParam < page.total) {
    throw new Error(`Non-progressing ${label} page`);
  }
  return page;
}

export function getNextPageOffset(
  lastPage: { items: unknown[]; total: number },
  _allPages: unknown,
  lastPageParam: number,
): number | undefined {
  const nextOffset = lastPageParam + lastPage.items.length;
  return lastPage.items.length > 0 && nextOffset < lastPage.total ? nextOffset : undefined;
}

export function dedupePages<T extends { id: string }>(
  pages: ReadonlyArray<{ items: T[] }> | undefined,
  matchesScope: (item: T) => boolean,
): T[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const list: T[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (item && matchesScope(item) && item.id && !seen.has(item.id)) {
        seen.add(item.id);
        list.push(item);
      }
    }
  }
  return list;
}

export function classifyPaginationError(
  error: unknown,
  isFetchNextPageError: boolean,
  loadedCount: number,
): { isBaseError: boolean; isTransientNextError: boolean } {
  const isHard = isAuthOrScopeError(error);
  const isBaseError = Boolean(error && (isHard || !isFetchNextPageError || loadedCount === 0));
  const isTransientNextError = Boolean(error && !isHard && isFetchNextPageError && loadedCount > 0);
  return { isBaseError, isTransientNextError };
}

export function buildCamerasPagesQueryKey(
  apiUrl: string,
  sessionScope: string,
  internalNonce: number,
  siteId: string,
) {
  return [
    'ppe-monitoring',
    apiUrl,
    sessionScope,
    internalNonce,
    siteId,
    'cameras-for-region',
    'pages',
  ] as const;
}

export function buildRegionsPagesQueryKey(
  apiUrl: string,
  sessionScope: string,
  internalNonce: number,
  siteId: string,
  cameraId: string,
) {
  return [
    'ppe-monitoring',
    apiUrl,
    sessionScope,
    internalNonce,
    siteId,
    'cameras',
    cameraId,
    'regions',
    'pages',
  ] as const;
}
