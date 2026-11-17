import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { CameraResponse } from '@smartsite/contracts/management';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { CAMERA_BUTTON_STYLES } from './camera-dialog-styles';
import {
  CameraApplicationStatusSummary,
  type CameraApplicationStatusContext,
} from './CameraApplicationStatusSummary';
import type { CameraSetupOpenHandler } from './CameraSetupWorkflow';

const en = {
  'cameraSetup.stagesDisclosureLabel': 'Four-stage setup reference',
  'cameraSetup.stage1Title': 'Stage 1 · Per-Zone & Region PPE Policy',
  'cameraSetup.stage1Body':
    'Zones define site areas; each camera default and region policy resolves effective PPE (Use camera default, Custom, or Disabled). Locked Zones allow rename only.',
  'cameraSetup.stage2Title': 'Stage 2 · Camera & Source ID',
  'cameraSetup.stage2Body':
    'Saves the camera code, display name, and source identifier. Registration does not verify a live connection.',
  'cameraSetup.stage3Title': 'Stage 3 · Reference Image',
  'cameraSetup.stage3Body':
    'Loads a 5-minute reference snapshot for the saved configuration version before drawing regions.',
  'cameraSetup.stage4Title': 'Stage 4 · Observation Regions',
  'cameraSetup.stage4Body':
    'Links each Zone boundary to the camera view. Saving stores the configuration version only.',
  'cameraSetup.catalogBreakdown': '{{active}} enabled · {{inactive}} disabled',
  'cameraSetup.scopeReadOnlyReason':
    'Read-only catalog scope: only the assigned Site Manager can register cameras, change status, or edit Zone and region policies.',
  'cameraSetup.scopeManagerReason':
    'Site Manager scope: edit Zones, cameras, and regions directly. Live monitoring views require Safety Officer or Admin access.',
  'cameraSetup.revisionLabel': 'Saved config version',
  'cameraSetup.savedConfigVersionStatus':
    'Saved config version v{{version}}; worker application status unavailable.',
  'cameraSetup.savedMetadataOnlyActiveHint':
    'Saved status is Enabled in configuration only (not worker-applied or ready). Open Regions to review reference-frame status or Manage for source details.',
  'cameraSetup.savedMetadataOnlyInactiveHint':
    'Saved status is Disabled in configuration only. Open Manage to review source details or enable the camera before checking region reference status.',
  'cameraSetup.savedMetadataOnlyReadOnlyActiveHint':
    'Saved status is Enabled in configuration only (not worker-applied or ready). Check the camera status summary when available for worker receipts and reference-frame validity.',
  'cameraSetup.savedMetadataOnlyReadOnlyInactiveHint':
    'Saved status is Disabled in configuration only. Check the camera status summary when available for worker receipts; camera activation is a Site Manager action.',
  'cameraSetup.revisionDistinctionDisclosure':
    'Catalog status (Enabled/Disabled) and vN reflect saved configuration only, not worker application or live video. Check the selected camera status summary for worker receipts and Regions for reference-frame status.',
  'cameraSetup.revisionDistinctionReadOnlyDisclosure':
    'Catalog status (Enabled/Disabled) and vN reflect saved configuration only, not worker application or live video. Check the selected camera status summary for worker receipts and reference-frame validity.',
  'cameraSetup.sourceIdDisclosure':
    'Source identifier is viewed in Manage; registration does not verify source status or connection.',
  'cameraSetup.sourceIdReadOnlyDisclosure':
    'Source identifier and camera settings are managed by the assigned Site Manager; registration does not verify source status or connection.',
  'cameraSetup.metadataDisclosureLabel': 'Configuration & revision details',
  'cameraSetup.selectedHeading': 'Selected camera',
  'cameraSetup.selectedActiveNext':
    'Edit observation regions for this camera, or open Manage to rename or disable it in configuration.',
  'cameraSetup.selectedInactiveNext':
    'Region linking requires an enabled camera. Open Manage to enable it without re-registering.',
  'cameraSetup.editSelectedRegions': 'Edit observation regions ({{code}})',
  'cameraSetup.configureSelectedPpe': 'Configure PPE policy ({{code}})',
  'cameraSetup.editSelectedManage': 'Edit camera settings ({{code}})',
  'cameraSetup.enableSelectedManage': 'Open Manage to enable ({{code}})',
  'cameraSetup.openSelectedMonitorPpe': 'Open PPE monitoring ({{code}})',
  'cameraSetup.openSelectedMonitorZones': 'Open Zone monitoring ({{code}})',
  'cameraSetup.selectCameraBtn': 'Select {{code}}',
  'cameraSetup.selectedCameraBtn': 'Selected {{code}}',
};

const vi: Record<keyof typeof en, string> = {
  'cameraSetup.stagesDisclosureLabel': 'Tham chiếu 4 bước thiết lập',
  'cameraSetup.stage1Title': 'Bước 1 · Chính sách PPE theo khu vực & vùng',
  'cameraSetup.stage1Body':
    'Khu vực xác định các vùng công trường; mặc định camera và chính sách từng vùng quyết định PPE hiệu lực (Dùng mặc định camera, Tùy chỉnh hoặc Tắt). Khu vực đã khóa chỉ đổi tên.',
  'cameraSetup.stage2Title': 'Bước 2 · Camera & Mã nguồn',
  'cameraSetup.stage2Body':
    'Lưu mã camera, tên hiển thị và mã định danh nguồn. Việc đăng ký không xác nhận kết nối trực tiếp.',
  'cameraSetup.stage3Title': 'Bước 3 · Ảnh tham chiếu',
  'cameraSetup.stage3Body':
    'Tải ảnh tham chiếu (5 phút) theo phiên bản cấu hình đã lưu trước khi vẽ vùng quan sát.',
  'cameraSetup.stage4Title': 'Bước 4 · Vùng quan sát',
  'cameraSetup.stage4Body':
    'Gắn ranh giới từng khu vực vào góc nhìn camera. Thao tác lưu chỉ ghi nhận phiên bản cấu hình.',
  'cameraSetup.catalogBreakdown': '{{active}} đang bật · {{inactive}} đang tắt',
  'cameraSetup.scopeReadOnlyReason':
    'Phạm vi xem danh mục: chỉ Quản lý công trường được phân công mới được đăng ký camera, đổi trạng thái hoặc sửa khu vực và vùng quan sát.',
  'cameraSetup.scopeManagerReason':
    'Phạm vi Quản lý công trường: sửa trực tiếp khu vực, camera và vùng quan sát. Màn hình giám sát trực tiếp yêu cầu quyền Cán bộ an toàn hoặc Quản trị viên.',
  'cameraSetup.revisionLabel': 'Phiên bản cấu hình đã lưu',
  'cameraSetup.savedConfigVersionStatus':
    'Phiên bản cấu hình đã lưu v{{version}}; chưa có trạng thái áp dụng của worker.',
  'cameraSetup.savedMetadataOnlyActiveHint':
    'Trạng thái đã lưu chỉ cho biết Đang bật trong cấu hình (chưa xác nhận worker đã áp dụng hay sẵn sàng). Mở Vùng quan sát để xem trạng thái ảnh tham chiếu hoặc Quản lý để xem chi tiết nguồn.',
  'cameraSetup.savedMetadataOnlyInactiveHint':
    'Trạng thái đã lưu chỉ cho biết Đang tắt trong cấu hình. Mở Quản lý để xem chi tiết nguồn hoặc bật camera trước khi kiểm tra trạng thái ảnh tham chiếu vùng quan sát.',
  'cameraSetup.savedMetadataOnlyReadOnlyActiveHint':
    'Trạng thái đã lưu chỉ cho biết Đang bật trong cấu hình (chưa xác nhận worker đã áp dụng hay sẵn sàng). Xem tóm tắt trạng thái camera khi khả dụng để kiểm tra biên nhận worker và độ hợp lệ của khung tham chiếu.',
  'cameraSetup.savedMetadataOnlyReadOnlyInactiveHint':
    'Trạng thái đã lưu chỉ cho biết Đang tắt trong cấu hình. Xem tóm tắt trạng thái camera khi khả dụng để kiểm tra biên nhận worker; việc bật camera thuộc quyền Quản lý công trường.',
  'cameraSetup.revisionDistinctionDisclosure':
    'Trạng thái danh mục (Đang bật/Đang tắt) và vN chỉ phản ánh cấu hình đã lưu, không đồng nghĩa worker đã áp dụng hay có video trực tiếp. Xem tóm tắt trạng thái ở camera đang chọn để kiểm tra biên nhận worker và mở Vùng quan sát để xem trạng thái ảnh tham chiếu.',
  'cameraSetup.revisionDistinctionReadOnlyDisclosure':
    'Trạng thái danh mục (Đang bật/Đang tắt) và vN chỉ phản ánh cấu hình đã lưu, không đồng nghĩa worker đã áp dụng hay có video trực tiếp. Xem tóm tắt trạng thái ở camera đang chọn để kiểm tra biên nhận worker và độ hợp lệ của khung tham chiếu.',
  'cameraSetup.sourceIdDisclosure':
    'Mã định danh nguồn được xem trong Quản lý; đăng ký không xác nhận trạng thái nguồn hay kết nối.',
  'cameraSetup.sourceIdReadOnlyDisclosure':
    'Mã định danh nguồn và cài đặt camera do Quản lý công trường được phân công quản lý; đăng ký không xác nhận trạng thái nguồn hay kết nối.',
  'cameraSetup.metadataDisclosureLabel': 'Chi tiết cấu hình & phiên bản',
  'cameraSetup.selectedHeading': 'Camera đang chọn',
  'cameraSetup.selectedActiveNext':
    'Sửa vùng quan sát cho camera này, hoặc mở Quản lý để đổi tên hay tắt trong cấu hình.',
  'cameraSetup.selectedInactiveNext':
    'Cần bật camera trước khi gắn vùng quan sát. Mở Quản lý để bật mà không cần đăng ký lại.',
  'cameraSetup.editSelectedRegions': 'Sửa vùng quan sát ({{code}})',
  'cameraSetup.configureSelectedPpe': 'Cấu hình chính sách PPE ({{code}})',
  'cameraSetup.editSelectedManage': 'Sửa cài đặt camera ({{code}})',
  'cameraSetup.enableSelectedManage': 'Mở Quản lý để bật ({{code}})',
  'cameraSetup.openSelectedMonitorPpe': 'Mở giám sát PPE ({{code}})',
  'cameraSetup.openSelectedMonitorZones': 'Mở giám sát khu vực ({{code}})',
  'cameraSetup.selectCameraBtn': 'Chọn {{code}}',
  'cameraSetup.selectedCameraBtn': 'Đang chọn {{code}}',
};

registerFeatureCatalog({ en, vi });

const STAGE_KEYS = [
  ['cameraSetup.stage1Title', 'cameraSetup.stage1Body'],
  ['cameraSetup.stage2Title', 'cameraSetup.stage2Body'],
  ['cameraSetup.stage3Title', 'cameraSetup.stage3Body'],
  ['cameraSetup.stage4Title', 'cameraSetup.stage4Body'],
] as const;

export function CameraSetupStageCards() {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  return (
    <div
      data-testid="camera-setup-stages-disclosure"
      className="min-w-0 border-t border-slate-200/80 pt-3 text-xs text-slate-600"
    >
      <p className="mb-2 text-xs font-semibold text-slate-700">
        {t('cameraSetup.stagesDisclosureLabel')}
      </p>
      <ol
        aria-label={t('cameraSetup.stagesDisclosureLabel')}
        className="grid gap-2.5 sm:grid-cols-2"
      >
        {STAGE_KEYS.map(([titleKey, bodyKey]) => (
          <li
            key={titleKey}
            className="min-w-0 rounded-lg border border-slate-200/80 bg-white px-3.5 py-2.5 text-xs leading-5"
          >
            <p className="break-words [overflow-wrap:anywhere] font-semibold text-slate-900">
              {t(titleKey)}
            </p>
            <p className="mt-1 break-words [overflow-wrap:anywhere] text-slate-600">{t(bodyKey)}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function CameraSetupRowMetadata(props: { row: CameraResponse; isEnabled: boolean }) {
  const { row, isEnabled } = props;
  const { t } = useTranslation(SAFETY_NAMESPACE);
  return (
    <dl className="min-w-0 flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <div className="min-w-0 inline-flex items-center">
        <dt className="sr-only">{t('cameraSetup.statusLabel')}</dt>
        <dd className="min-w-0">
          <span
            className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium break-words [overflow-wrap:anywhere] ${
              isEnabled
                ? 'border-emerald-200 bg-emerald-50/70 text-slate-800'
                : 'border-slate-200 bg-slate-100 text-slate-600'
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                isEnabled ? 'bg-emerald-600' : 'bg-slate-400'
              }`}
            />
            {t(isEnabled ? 'cameraSetup.enabled' : 'cameraSetup.disabled')}
          </span>
        </dd>
      </div>
      <div className="min-w-0 max-w-full inline-flex items-center gap-1.5 rounded-md border border-slate-200/80 bg-slate-50 px-2.5 py-1">
        <dt className="text-slate-500">{t('cameraSetup.codeLabel')}</dt>
        <dd className="min-w-0 max-w-full break-all font-mono text-xs font-semibold tabular-nums text-slate-800">
          {row.code}
        </dd>
      </div>
      <div
        data-testid="camera-row-source-id"
        className="min-w-0 max-w-full inline-flex items-center gap-1.5 rounded-md border border-slate-200/80 bg-slate-50 px-2.5 py-1 text-slate-500"
      >
        <dt>{t('cameraSetup.field.externalId')}</dt>
        <dd className="min-w-0 max-w-full break-all font-mono text-xs font-semibold text-slate-700">
          {row.externalId}
        </dd>
      </div>
      <div className="min-w-0 inline-flex items-center gap-1.5 rounded-md border border-slate-200/80 bg-slate-50 px-2.5 py-1 text-slate-500">
        <dt>{t('cameraSetup.revisionLabel')}</dt>
        <dd className="font-mono text-xs font-semibold tabular-nums text-slate-700">
          v{row.configurationVersion}
        </dd>
      </div>
    </dl>
  );
}

export interface CameraSetupContextBarProps {
  siteId?: string;
  siteCode?: string;
  siteName?: string;
  rows: CameraResponse[];
  selectedCamera: CameraResponse | null;
  canManageCameras: boolean;
  canOpenMonitoring: boolean;
  open: CameraSetupOpenHandler;
  onSelectCamera?: (cameraId: string) => void;
  onOpenPpePolicy?: () => void;
  statusContext?: CameraApplicationStatusContext;
}

export function CameraSetupContextBar({
  siteId,
  siteCode,
  siteName,
  rows,
  selectedCamera,
  canManageCameras,
  canOpenMonitoring,
  open,
  onSelectCamera,
  onOpenPpePolicy,
  statusContext,
}: CameraSetupContextBarProps) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const activeCount = rows.filter((row) => row.status === 'ACTIVE').length;
  const inactiveCount = rows.length - activeCount;
  const siteBadge = siteCode && siteName ? `${siteCode} · ${siteName}` : (siteName ?? siteCode);
  const isSelectedActive = selectedCamera?.status === 'ACTIVE';
  const selectedMonitorQuery =
    siteId && selectedCamera && isSelectedActive
      ? new URLSearchParams({ siteId, cameraId: selectedCamera.id }).toString()
      : '';

  return (
    <div className="mt-4 min-w-0 space-y-3 rounded-xl border border-slate-200/90 bg-slate-50/70 p-3.5 text-xs text-slate-700">
      <div className="min-w-0 flex flex-wrap items-center justify-between gap-2.5">
        <div className="min-w-0 flex flex-wrap items-center gap-2">
          {siteBadge && (
            <span className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800">
              {siteBadge}
            </span>
          )}
          {rows.length > 0 && (
            <span className="inline-flex max-w-full items-center break-words rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium tabular-nums text-slate-700">
              {t('cameraSetup.catalogBreakdown', { active: activeCount, inactive: inactiveCount })}
            </span>
          )}
        </div>
        <details className="group min-w-0 text-xs text-slate-600">
          <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
            <span>{t('cameraSetup.metadataDisclosureLabel')}</span>
            <span
              aria-hidden="true"
              className="text-xs text-slate-500 transition-transform duration-150 group-open:rotate-180"
            >
              ▾
            </span>
          </summary>
          <div className="mt-2 min-w-0 space-y-1.5 rounded-lg border border-slate-200/90 bg-white px-3.5 py-2.5 text-xs leading-5 text-slate-600">
            <p className="break-words [overflow-wrap:anywhere]">
              {t(
                canManageCameras
                  ? 'cameraSetup.revisionDistinctionDisclosure'
                  : 'cameraSetup.revisionDistinctionReadOnlyDisclosure',
              )}
            </p>
            <p className="break-words [overflow-wrap:anywhere]">
              {t(
                canManageCameras
                  ? 'cameraSetup.sourceIdDisclosure'
                  : 'cameraSetup.sourceIdReadOnlyDisclosure',
              )}
            </p>
            {canManageCameras && !canOpenMonitoring && (
              <p className="break-words [overflow-wrap:anywhere]">
                {t('cameraSetup.scopeManagerReason')}
              </p>
            )}
          </div>
        </details>
      </div>

      {!canManageCameras && (
        <p className="min-w-0 break-words [overflow-wrap:anywhere] rounded-lg border border-slate-200/90 bg-white px-3.5 py-2.5 text-xs leading-5 text-slate-700">
          {t('cameraSetup.scopeReadOnlyReason')}
        </p>
      )}

      {selectedCamera && (
        <div
          role="region"
          aria-label={t('cameraSetup.selectedHeading')}
          data-tour-anchor="camera-setup-save"
          className={`min-w-0 flex flex-col justify-between gap-3.5 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs border-l-4 ${
            isSelectedActive ? 'border-l-slate-900' : 'border-l-slate-400'
          }`}
        >
          <div className="min-w-0 flex flex-col justify-between gap-3.5 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-medium text-slate-500">
                  {t('cameraSetup.selectedHeading')}
                </p>
                <span
                  data-testid="selected-camera-source-id"
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200/90 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-700 break-all"
                >
                  <span>{t('cameraSetup.field.externalId')}:</span>
                  <span className="font-semibold text-slate-900">{selectedCamera.externalId}</span>
                </span>
              </div>
              <p className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-base font-semibold tracking-tight text-slate-900 tabular-nums">
                {`${selectedCamera.code} · ${selectedCamera.name}`}
              </p>
              {rows.length > 1 && onSelectCamera && (
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <label
                    htmlFor="camera-setup-quick-select"
                    className="text-xs font-medium text-slate-600"
                  >
                    {t('cameraSetup.chooseCamera')}
                  </label>
                  <select
                    id="camera-setup-quick-select"
                    data-testid="camera-setup-quick-select"
                    aria-label={t('cameraSetup.chooseCamera')}
                    value={selectedCamera.id}
                    onChange={(event) => onSelectCamera(event.target.value)}
                    className="min-w-0 max-w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-900 shadow-2xs hover:border-slate-400 focus-visible:border-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                  >
                    {rows.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.code} · {row.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {canManageCameras && (
                <p className="min-w-0 max-w-2xl break-words [overflow-wrap:anywhere] text-sm leading-5 text-slate-700">
                  {t(
                    isSelectedActive
                      ? 'cameraSetup.selectedActiveNext'
                      : 'cameraSetup.selectedInactiveNext',
                  )}
                </p>
              )}
            </div>

            {(canManageCameras || Boolean(canOpenMonitoring && selectedMonitorQuery)) && (
              <div
                data-tour-anchor="camera-setup-regions"
                className="flex min-w-0 max-w-full flex-wrap items-center gap-2 lg:max-w-[55%] lg:justify-end"
              >
                {canManageCameras &&
                  (isSelectedActive ? (
                    <>
                      <button
                        type="button"
                        className={`${CAMERA_BUTTON_STYLES.primary} min-h-9 min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-normal text-left`}
                        onClick={(event) => open('regions', selectedCamera.id, event.currentTarget)}
                      >
                        {t('cameraSetup.editSelectedRegions', { code: selectedCamera.code })}
                      </button>
                      {onOpenPpePolicy && (
                        <button
                          type="button"
                          data-testid="selected-camera-open-ppe"
                          className={`${CAMERA_BUTTON_STYLES.compactSecondary} min-h-9 min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-normal text-left`}
                          onClick={onOpenPpePolicy}
                        >
                          {t('cameraSetup.configureSelectedPpe', { code: selectedCamera.code })}
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${CAMERA_BUTTON_STYLES.compactSecondary} min-h-9 min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-normal text-left`}
                        onClick={(event) => open('manage', selectedCamera.id, event.currentTarget)}
                      >
                        {t('cameraSetup.editSelectedManage', { code: selectedCamera.code })}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={`${CAMERA_BUTTON_STYLES.secondary} min-h-9 min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-normal text-left`}
                      onClick={(event) => open('manage', selectedCamera.id, event.currentTarget)}
                    >
                      {t('cameraSetup.enableSelectedManage', { code: selectedCamera.code })}
                    </button>
                  ))}
                {canOpenMonitoring && Boolean(selectedMonitorQuery) && (
                  <>
                    <Link
                      data-testid="selected-camera-monitor-ppe"
                      className={`${CAMERA_BUTTON_STYLES.compactSecondary} min-h-9 min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-normal text-left`}
                      to={`/ppe?${selectedMonitorQuery}`}
                    >
                      {t('cameraSetup.openSelectedMonitorPpe', { code: selectedCamera.code })}
                    </Link>
                    <Link
                      data-testid="selected-camera-monitor-zones"
                      className={`${CAMERA_BUTTON_STYLES.compactSecondary} min-h-9 min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-normal text-left`}
                      to={`/zones?${selectedMonitorQuery}`}
                    >
                      {t('cameraSetup.openSelectedMonitorZones', { code: selectedCamera.code })}
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>

          {statusContext ? (
            <CameraApplicationStatusSummary camera={selectedCamera} context={statusContext} />
          ) : (
            <div
              data-testid="camera-saved-config-summary"
              data-application-state="SAVED_METADATA_ONLY"
              className="mt-2 min-w-0 space-y-1 rounded-lg border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-xs text-slate-600"
            >
              <p className="min-w-0 break-words [overflow-wrap:anywhere] font-medium text-slate-800">
                {t('cameraSetup.savedConfigVersionStatus', {
                  version: selectedCamera.configurationVersion,
                })}
              </p>
              <p className="min-w-0 break-words [overflow-wrap:anywhere] text-slate-600">
                {t(
                  canManageCameras
                    ? isSelectedActive
                      ? 'cameraSetup.savedMetadataOnlyActiveHint'
                      : 'cameraSetup.savedMetadataOnlyInactiveHint'
                    : isSelectedActive
                      ? 'cameraSetup.savedMetadataOnlyReadOnlyActiveHint'
                      : 'cameraSetup.savedMetadataOnlyReadOnlyInactiveHint',
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
