import { SmartNativeSelect } from '../ui/SmartNativeSelect';
import type { ReactNode } from 'react';
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

export type CameraWorkspaceTask = 'source' | 'regions' | 'ppe';

const en = {
  'cameraSetup.stagesDisclosureLabel': 'Four-stage setup reference',
  'cameraSetup.stage1Title': 'Stage 1 · Per-Zone & Region PPE Policy',
  'cameraSetup.stage1Body':
    'Zones define site areas; each camera default and region policy resolves effective PPE (Use camera default, Custom, or Disabled). Locked Zones allow rename only.',
  'cameraSetup.stage2Title': 'Stage 2 · Link Provisioned Source ID',
  'cameraSetup.stage2Body':
    'Links a human camera name and code to a technical Source ID already configured on the edge worker. Do not paste RTSP URLs or passwords; saving does not connect a stream or start a worker.',
  'cameraSetup.stage3Title': 'Stage 3 · Verify Reference Image',
  'cameraSetup.stage3Body':
    'Open Edit observation regions and click Get configuration image to confirm the edge source serves a 5-minute reference frame before drawing regions.',
  'cameraSetup.stage4Title': 'Stage 4 · Regions, PPE & Worker Receipt',
  'cameraSetup.stage4Body':
    'Save Zone boundaries and PPE rules. Saved/Enabled stores configuration version only — check worker status below to confirm applied revision.',
  'cameraSetup.catalogBreakdown': '{{active}} enabled · {{inactive}} disabled',
  'cameraSetup.scopeReadOnlyReason':
    'Read-only catalog scope: only the assigned Site Manager can register cameras, change status, or edit Zone and region policies.',
  'cameraSetup.scopeManagerReason':
    'Site Manager scope: edit Zones, cameras, and regions directly, and view monitoring feeds for your assigned Site. Safety case review and alert inbox actions remain Safety Officer responsibilities.',
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
    'Source ID is a fixed technical source key matched to an edge-provisioned camera stream (viewed in Manage; not an editable RTSP URL or credential). Registration does not verify source status or start the edge worker.',
  'cameraSetup.sourceIdReadOnlyDisclosure':
    'Source ID is a technical edge-provisioned source key managed by the assigned Site Manager (not an editable URL or credential); registration does not verify source status or connection.',
  'cameraSetup.metadataDisclosureLabel': 'Configuration & revision details',
  'cameraSetup.selectedHeading': 'Selected camera',
  'cameraSetup.selectedActiveNext':
    'Next: open Edit observation regions → Get configuration image to verify the source frame and draw boundaries, then set Camera PPE policy. Enabled in configuration does not mean connected or worker-applied — check worker status below (Source ID must match a running edge-provisioned source).',
  'cameraSetup.selectedInactiveNext':
    'Disabled in configuration — the edge worker will not apply this camera until enabled. Open Manage to enable it, then verify a configuration image in Regions.',
  'cameraSetup.editSelectedRegions': 'Edit observation regions ({{code}})',
  'cameraSetup.configureSelectedPpe': 'Configure PPE policy ({{code}})',
  'cameraSetup.editSelectedManage': 'Edit camera settings ({{code}})',
  'cameraSetup.enableSelectedManage': 'Open Manage to enable ({{code}})',
  'cameraSetup.openSelectedMonitorPpe': 'Open PPE monitoring ({{code}})',
  'cameraSetup.openSelectedMonitorZones': 'Open Zone monitoring ({{code}})',
  'cameraSetup.selectCameraBtn': 'Select {{code}}',
  'cameraSetup.selectedCameraBtn': 'Selected {{code}}',
  'cameraSetup.technicalSourceDetails': 'Technical source details',
  'cameraSetup.disabledStageHeading':
    'Reference image & region stage unavailable while camera is disabled',
  'cameraSetup.disabledStageBody':
    '{{name}} ({{code}}) is saved as Disabled (v{{version}}). No live or 5-minute reference frame is requested while disabled. Enable the camera in Manage first, then open Edit observation regions.',
  'cameraSetup.disabledStageReadOnlyBody':
    '{{name}} ({{code}}) is saved as Disabled (v{{version}}). Only the assigned Site Manager can enable this camera before reference frames or observation regions can be verified.',
  'cameraSetup.disabledStageAction': 'Enable camera in settings ({{code}})',
};

const vi: Record<keyof typeof en, string> = {
  'cameraSetup.stagesDisclosureLabel': 'Tham chiếu 4 bước thiết lập',
  'cameraSetup.stage1Title': 'Bước 1 · Chính sách PPE theo khu vực & vùng',
  'cameraSetup.stage1Body':
    'Khu vực xác định các vùng công trường; mặc định camera và chính sách từng vùng quyết định PPE hiệu lực (Dùng mặc định camera, Tùy chỉnh hoặc Tắt). Khu vực đã khóa chỉ đổi tên.',
  'cameraSetup.stage2Title': 'Bước 2 · Gắn Mã nguồn đã cấp trên edge',
  'cameraSetup.stage2Body':
    'Gắn tên hiển thị và mã camera với Mã nguồn (Source ID) kỹ thuật đã cấu hình sẵn trên edge worker. Không dán URL RTSP hay mật khẩu; thao tác lưu không tự kết nối luồng hay khởi chạy worker.',
  'cameraSetup.stage3Title': 'Bước 3 · Kiểm tra ảnh tham chiếu',
  'cameraSetup.stage3Body':
    'Mở Sửa vùng quan sát và nhấn Lấy ảnh cấu hình để xác nhận nguồn edge trả về khung hình tham chiếu (5 phút) trước khi vẽ vùng.',
  'cameraSetup.stage4Title': 'Bước 4 · Vùng quan sát, PPE & Biên nhận worker',
  'cameraSetup.stage4Body':
    'Lưu ranh giới khu vực và quy tắc PPE. Trạng thái Đã lưu/Đang bật chỉ ghi nhận phiên bản cấu hình — kiểm tra tóm tắt worker bên dưới để xác nhận đã áp dụng.',
  'cameraSetup.catalogBreakdown': '{{active}} đang bật · {{inactive}} đang tắt',
  'cameraSetup.scopeReadOnlyReason':
    'Phạm vi xem danh mục: chỉ Quản lý công trường được phân công mới được đăng ký camera, đổi trạng thái hoặc sửa khu vực và vùng quan sát.',
  'cameraSetup.scopeManagerReason':
    'Phạm vi Quản lý công trường: sửa trực tiếp khu vực, camera và vùng quan sát, đồng thời xem luồng giám sát của công trường được phân công. Xử lý hồ sơ an toàn và hộp thư cảnh báo thuộc quyền Cán bộ an toàn.',
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
    'Mã nguồn (Source ID) là khóa kỹ thuật cố định khớp với nguồn camera đã cấp sẵn trên edge worker (xem trong Quản lý; không phải URL RTSP hay thông tin đăng nhập có thể sửa). Đăng ký không xác nhận kết nối nguồn hay khởi chạy edge worker.',
  'cameraSetup.sourceIdReadOnlyDisclosure':
    'Mã nguồn (Source ID) là khóa kỹ thuật trên edge worker do Quản lý công trường được phân công quản lý (không phải URL hay thông tin xác thực); đăng ký không xác nhận trạng thái nguồn hay kết nối.',
  'cameraSetup.metadataDisclosureLabel': 'Chi tiết cấu hình & phiên bản',
  'cameraSetup.selectedHeading': 'Camera đang chọn',
  'cameraSetup.selectedActiveNext':
    'Tiếp theo: mở Sửa vùng quan sát → Lấy ảnh cấu hình để kiểm tra khung hình nguồn và vẽ ranh giới, sau đó đặt Chính sách PPE. Đang bật trong cấu hình không đồng nghĩa đã kết nối hay worker đã áp dụng — hãy xem trạng thái worker bên dưới (Mã nguồn phải khớp nguồn đang chạy trên edge worker).',
  'cameraSetup.selectedInactiveNext':
    'Đang tắt trong cấu hình — edge worker sẽ không áp dụng camera này cho đến khi bật lại. Mở Quản lý để bật, rồi kiểm tra ảnh cấu hình tại Vùng quan sát.',
  'cameraSetup.editSelectedRegions': 'Sửa vùng quan sát ({{code}})',
  'cameraSetup.configureSelectedPpe': 'Cấu hình chính sách PPE ({{code}})',
  'cameraSetup.editSelectedManage': 'Sửa cài đặt camera ({{code}})',
  'cameraSetup.enableSelectedManage': 'Mở Quản lý để bật ({{code}})',
  'cameraSetup.openSelectedMonitorPpe': 'Mở giám sát PPE ({{code}})',
  'cameraSetup.openSelectedMonitorZones': 'Mở giám sát khu vực ({{code}})',
  'cameraSetup.selectCameraBtn': 'Chọn {{code}}',
  'cameraSetup.selectedCameraBtn': 'Đang chọn {{code}}',
  'cameraSetup.technicalSourceDetails': 'Chi tiết nguồn kỹ thuật',
  'cameraSetup.disabledStageHeading':
    'Khung tham chiếu & vùng quan sát tạm ngưng khi camera đang tắt',
  'cameraSetup.disabledStageBody':
    '{{name}} ({{code}}) đang lưu ở trạng thái Tắt (v{{version}}). Hệ thống không lấy khung hình trực tiếp hay ảnh tham chiếu 5 phút khi đang tắt. Hãy bật camera trong Quản lý trước rồi mở Sửa vùng quan sát.',
  'cameraSetup.disabledStageReadOnlyBody':
    '{{name}} ({{code}}) đang lưu ở trạng thái Tắt (v{{version}}). Chỉ Quản lý công trường được phân công mới có thể bật camera trước khi kiểm tra ảnh tham chiếu hoặc vùng quan sát.',
  'cameraSetup.disabledStageAction': 'Bật camera trong cài đặt ({{code}})',
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
    <div data-testid="camera-setup-stages-disclosure" className="min-w-0 text-sm text-slate-700">
      <p className="mb-2.5 text-sm font-semibold text-slate-900">
        {t('cameraSetup.stagesDisclosureLabel')}
      </p>
      <ol
        aria-label={t('cameraSetup.stagesDisclosureLabel')}
        className="grid gap-2.5 sm:grid-cols-2"
      >
        {STAGE_KEYS.map(([titleKey, bodyKey]) => (
          <li
            key={titleKey}
            className="min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5"
          >
            <p className="break-words [overflow-wrap:anywhere] text-sm font-semibold text-slate-900">
              {t(titleKey)}
            </p>
            <p className="mt-1 break-words [overflow-wrap:anywhere] text-xs leading-5 text-slate-600">
              {t(bodyKey)}
            </p>
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
    <div className="min-w-0 space-y-1 text-sm text-slate-600">
      <dl className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <div className="inline-flex items-center gap-1.5">
          <dt className="sr-only">{t('cameraSetup.statusLabel')}</dt>
          <dd
            className={`inline-flex items-center gap-1.5 text-sm font-medium ${
              isEnabled ? 'text-emerald-800' : 'text-slate-600'
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${
                isEnabled ? 'bg-emerald-600' : 'bg-slate-400'
              }`}
            />
            {t(isEnabled ? 'cameraSetup.enabled' : 'cameraSetup.disabled')}
          </dd>
        </div>
        <span aria-hidden="true" className="text-slate-300">
          ·
        </span>
        <div className="min-w-0 inline-flex items-baseline gap-1">
          <dt className="sr-only">{t('cameraSetup.codeLabel')}</dt>
          <dd className="min-w-0 max-w-full break-all font-mono text-xs font-semibold tabular-nums text-slate-800">
            {row.code}
          </dd>
        </div>
        <span aria-hidden="true" className="text-slate-300">
          ·
        </span>
        <div className="inline-flex items-baseline gap-1 text-xs text-slate-500">
          <dt>{t('cameraSetup.revisionLabel')}</dt>
          <dd className="font-mono text-xs font-semibold tabular-nums text-slate-800">
            v{row.configurationVersion}
          </dd>
        </div>
      </dl>
      <details className="min-w-0 text-xs text-slate-500">
        <summary className="inline-flex min-h-7 cursor-pointer select-none items-center gap-1 rounded-md py-0.5 text-xs font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]">
          <span>{t('cameraSetup.technicalSourceDetails')}</span>
        </summary>
        <dl className="mt-1 min-w-0">
          <div
            data-testid="camera-row-source-id"
            className="min-w-0 max-w-full inline-flex items-center gap-1.5 text-xs text-slate-600"
          >
            <dt>{t('cameraSetup.field.externalId')}:</dt>
            <dd className="min-w-0 max-w-full break-all font-mono font-semibold text-slate-800">
              {row.externalId}
            </dd>
          </div>
        </dl>
      </details>
    </div>
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
  compact?: boolean;
  hasSourceTask?: boolean;
  activeTask?: CameraWorkspaceTask | null;
  onSelectTask?: (task: CameraWorkspaceTask, trigger?: HTMLButtonElement) => void;
  applySlot?: ReactNode;
  diagnosticsSlot?: ReactNode;
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
  compact = false,
  hasSourceTask = false,
  activeTask = null,
  onSelectTask,
  applySlot,
  diagnosticsSlot,
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

  if (compact) {
    const showTaskSwitcher = Boolean(
      selectedCamera &&
      isSelectedActive &&
      (hasSourceTask || canManageCameras || Boolean(onOpenPpePolicy)),
    );
    const taskTabBase =
      'inline-flex min-h-8 items-center justify-center rounded-lg px-2 py-1 text-xs sm:px-3 sm:text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A] cursor-pointer';
    const taskTabActive = `${taskTabBase} bg-[#0F172A] text-white shadow-2xs`;
    const taskTabIdle = `${taskTabBase} text-slate-700 hover:bg-white hover:text-slate-950`;

    return (
      <div
        data-testid="camera-setup-sticky-header"
        className="min-w-0 space-y-2 bg-white/95 text-sm text-slate-700 lg:pb-1"
      >
        {!canManageCameras && (
          <p className="min-w-0 break-words [overflow-wrap:anywhere] rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs leading-relaxed text-slate-700">
            {t('cameraSetup.scopeReadOnlyReason')}
          </p>
        )}

        {selectedCamera && (
          <div
            role="region"
            aria-label={t('cameraSetup.selectedHeading')}
            data-tour-anchor="camera-setup-save"
            className={`min-w-0 space-y-1.5 sm:space-y-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2 sm:px-3.5 sm:py-2.5 border-l-[3px] shadow-2xs ${
              isSelectedActive ? 'border-l-[#0F172A]' : 'border-l-slate-400'
            }`}
          >
            {rows.length > 1 && onSelectCamera && (
              <div className="flex min-w-0 flex-col gap-1 border-b border-slate-100 pb-2 sm:flex-row sm:items-center sm:gap-2 lg:hidden">
                <label
                  htmlFor="camera-setup-quick-select"
                  className="shrink-0 text-xs font-semibold text-slate-700"
                >
                  {t('cameraSetup.chooseCamera')}
                </label>
                <div className="min-w-0 w-full max-w-full flex-1 overflow-hidden">
                  <SmartNativeSelect
                    id="camera-setup-quick-select"
                    data-testid="camera-setup-quick-select"
                    aria-label={t('cameraSetup.chooseCamera')}
                    value={selectedCamera.id}
                    onChange={(event) => onSelectCamera(event.target.value)}
                    className="min-h-8 w-full min-w-0 max-w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-900 hover:border-slate-400 focus-visible:border-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]"
                  >
                    {rows.map((row) => (
                      <option key={row.id} value={row.id}>
                        {`${row.name} (${row.code} · ${t(row.status === 'ACTIVE' ? 'cameraSetup.enabled' : 'cameraSetup.disabled')})`}
                      </option>
                    ))}
                  </SmartNativeSelect>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <p
                  title={`${selectedCamera.name} · ${selectedCamera.code}`}
                  className={`${
                    rows.length > 1 && onSelectCamera ? 'hidden lg:block ' : ''
                  }min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-base font-bold tracking-tight text-slate-950 tabular-nums`}
                >
                  {`${selectedCamera.name} · ${selectedCamera.code}`}
                </p>
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums ${
                    isSelectedActive ? 'text-emerald-800' : 'text-slate-600'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${
                      isSelectedActive ? 'bg-emerald-600' : 'bg-slate-400'
                    }`}
                  />
                  {t(isSelectedActive ? 'cameraSetup.enabled' : 'cameraSetup.disabled')} · v
                  {selectedCamera.configurationVersion}
                </span>
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {canManageCameras && (
                  <span
                    data-tour-anchor={!isSelectedActive ? 'camera-setup-regions' : undefined}
                    className="inline-flex"
                  >
                    <button
                      type="button"
                      className={
                        isSelectedActive
                          ? 'inline-flex min-h-8 max-w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A] cursor-pointer whitespace-normal text-center'
                          : `${CAMERA_BUTTON_STYLES.primary} max-w-full whitespace-normal text-center`
                      }
                      onClick={(event) => open('manage', selectedCamera.id, event.currentTarget)}
                    >
                      {t(
                        isSelectedActive
                          ? 'cameraSetup.editSelectedManage'
                          : 'cameraSetup.enableSelectedManage',
                        { code: selectedCamera.code },
                      )}
                    </button>
                  </span>
                )}
                {canManageCameras && canOpenMonitoring && Boolean(selectedMonitorQuery) && (
                  <div
                    data-testid="selected-camera-mobile-monitor-nav"
                    className="flex flex-wrap items-center gap-1.5 sm:hidden"
                  >
                    <Link
                      className={CAMERA_BUTTON_STYLES.compactSecondary}
                      to={`/ppe?${selectedMonitorQuery}`}
                    >
                      {t('cameraSetup.monitorPpe')}
                    </Link>
                    <Link
                      className={CAMERA_BUTTON_STYLES.compactSecondary}
                      to={`/zones?${selectedMonitorQuery}`}
                    >
                      {t('cameraSetup.monitorZones')}
                    </Link>
                  </div>
                )}
                {!canManageCameras && canOpenMonitoring && Boolean(selectedMonitorQuery) && (
                  <>
                    <Link
                      data-testid="selected-camera-monitor-ppe"
                      className={CAMERA_BUTTON_STYLES.compactSecondary}
                      to={`/ppe?${selectedMonitorQuery}`}
                    >
                      {t('cameraSetup.openSelectedMonitorPpe', { code: selectedCamera.code })}
                    </Link>
                    <Link
                      data-testid="selected-camera-monitor-zones"
                      className={CAMERA_BUTTON_STYLES.compactSecondary}
                      to={`/zones?${selectedMonitorQuery}`}
                    >
                      {t('cameraSetup.openSelectedMonitorZones', { code: selectedCamera.code })}
                    </Link>
                  </>
                )}
              </div>
            </div>

            {statusContext ? (
              <CameraApplicationStatusSummary
                camera={selectedCamera}
                context={statusContext}
                compact
              />
            ) : (
              <div
                data-testid="camera-saved-config-summary"
                data-application-state="SAVED_METADATA_ONLY"
                className="min-w-0 space-y-0.5 border-t border-slate-100 pt-1.5 text-xs text-slate-700"
              >
                <p className="min-w-0 break-words [overflow-wrap:anywhere] font-semibold text-slate-900">
                  {t('cameraSetup.savedConfigVersionStatus', {
                    version: selectedCamera.configurationVersion,
                  })}
                </p>
                <p className="min-w-0 break-words [overflow-wrap:anywhere] leading-relaxed text-slate-600">
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

            {applySlot}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
              {showTaskSwitcher && (
                <div
                  role="group"
                  aria-label={t('cameraSetup.workspaceTabsLabel')}
                  data-testid="camera-setup-task-tabs"
                  data-tour-anchor="camera-setup-regions"
                  className="inline-flex min-w-0 flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-0.5"
                >
                  {(() => {
                    let stepNum = 0;
                    const nextStep = () => ++stepNum;
                    const sourceStep = hasSourceTask ? nextStep() : 0;
                    const regionsStep = canManageCameras ? nextStep() : 0;
                    const ppeStep = onOpenPpePolicy ? nextStep() : 0;
                    const badgeClass = (isActive: boolean) =>
                      `mr-1.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
                        isActive ? 'bg-white/20 text-white' : 'bg-slate-200/90 text-slate-700'
                      }`;
                    return (
                      <>
                        {hasSourceTask && (
                          <button
                            type="button"
                            data-testid="camera-workspace-tab-source"
                            aria-pressed={activeTask === 'source'}
                            className={activeTask === 'source' ? taskTabActive : taskTabIdle}
                            onClick={(event) => onSelectTask?.('source', event.currentTarget)}
                          >
                            <span
                              aria-hidden="true"
                              data-testid="camera-workspace-step-source"
                              className={badgeClass(activeTask === 'source')}
                            >
                              {sourceStep}
                            </span>
                            <span>{t('cameraSetup.tabSource')}</span>
                          </button>
                        )}
                        {canManageCameras && (
                          <button
                            type="button"
                            data-testid="camera-workspace-tab-regions"
                            aria-label={t('cameraSetup.editSelectedRegions', {
                              code: selectedCamera.code,
                            })}
                            aria-pressed={activeTask === 'regions'}
                            className={activeTask === 'regions' ? taskTabActive : taskTabIdle}
                            onClick={(event) => {
                              if (onSelectTask) {
                                onSelectTask('regions', event.currentTarget);
                              } else {
                                open('regions', selectedCamera.id, event.currentTarget);
                              }
                            }}
                          >
                            <span
                              aria-hidden="true"
                              data-testid="camera-workspace-step-regions"
                              className={badgeClass(activeTask === 'regions')}
                            >
                              {regionsStep}
                            </span>
                            <span>{t('cameraSetup.tabRegions')}</span>
                          </button>
                        )}
                        {onOpenPpePolicy && (
                          <button
                            type="button"
                            data-testid="selected-camera-open-ppe"
                            aria-label={t('cameraSetup.configureSelectedPpe', {
                              code: selectedCamera.code,
                            })}
                            aria-pressed={activeTask === 'ppe'}
                            className={activeTask === 'ppe' ? taskTabActive : taskTabIdle}
                            onClick={(event) => {
                              if (onSelectTask) {
                                onSelectTask('ppe', event.currentTarget);
                              } else {
                                onOpenPpePolicy();
                              }
                            }}
                          >
                            <span
                              aria-hidden="true"
                              data-testid="camera-workspace-step-ppe"
                              className={badgeClass(activeTask === 'ppe')}
                            >
                              {ppeStep}
                            </span>
                            <span>{t('cameraSetup.tabPpe')}</span>
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                <details
                  data-testid="camera-setup-diagnostics-disclosure"
                  className="group min-w-0"
                >
                  <summary className="inline-flex min-h-7 cursor-pointer list-none items-center gap-1 rounded-md py-0.5 font-medium text-slate-600 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]">
                    <span>{t('cameraSetup.diagnosticsDisclosure')}</span>
                    <span
                      aria-hidden="true"
                      className="text-xs text-slate-400 transition-transform duration-150 group-open:rotate-180"
                    >
                      ▾
                    </span>
                  </summary>
                  <div className="mt-2 min-w-0 space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-xs leading-relaxed text-slate-600">
                    {diagnosticsSlot}
                    <div className="space-y-1 border-t border-slate-200/80 pt-2">
                      {siteBadge && rows.length > 0 && (
                        <p className="font-medium text-slate-700">
                          {siteBadge} ·{' '}
                          {t('cameraSetup.catalogBreakdown', {
                            active: activeCount,
                            inactive: inactiveCount,
                          })}
                        </p>
                      )}
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
                      {canManageCameras && (
                        <p className="break-words [overflow-wrap:anywhere]">
                          {t(
                            isSelectedActive
                              ? 'cameraSetup.selectedActiveNext'
                              : 'cameraSetup.selectedInactiveNext',
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                </details>

                <details className="min-w-0">
                  <summary className="inline-flex min-h-7 cursor-pointer select-none items-center gap-1 rounded-md px-1 py-0.5 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]">
                    <span>{t('cameraSetup.technicalSourceDetails')}</span>
                  </summary>
                  <div className="mt-1">
                    <span
                      data-testid="selected-camera-source-id"
                      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs font-medium text-slate-700 break-all"
                    >
                      <span>{t('cameraSetup.field.externalId')}:</span>
                      <span className="font-semibold text-slate-900">
                        {selectedCamera.externalId}
                      </span>
                    </span>
                  </div>
                </details>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-3 text-sm text-slate-700">
      <div className="min-w-0 flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-200 pb-2.5">
        <div className="min-w-0 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
          {siteBadge && (
            <span className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] font-semibold text-slate-900">
              {siteBadge}
            </span>
          )}
          {siteBadge && rows.length > 0 && (
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
          )}
          {rows.length > 0 && (
            <span className="inline-flex max-w-full items-center break-words font-medium tabular-nums text-slate-600">
              {t('cameraSetup.catalogBreakdown', { active: activeCount, inactive: inactiveCount })}
            </span>
          )}
        </div>
        <details className="group min-w-0 text-xs text-slate-600">
          <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]">
            <span>{t('cameraSetup.metadataDisclosureLabel')}</span>
            <span
              aria-hidden="true"
              className="text-xs text-slate-500 transition-transform duration-150 group-open:rotate-180"
            >
              ▾
            </span>
          </summary>
          <div className="mt-2 min-w-0 space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm leading-relaxed text-slate-600">
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
        <p className="min-w-0 break-words [overflow-wrap:anywhere] rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm leading-relaxed text-slate-700">
          {t('cameraSetup.scopeReadOnlyReason')}
        </p>
      )}

      {selectedCamera && (
        <div
          role="region"
          aria-label={t('cameraSetup.selectedHeading')}
          data-tour-anchor="camera-setup-save"
          className={`min-w-0 flex flex-col justify-between gap-3.5 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 border-l-[3px] ${
            isSelectedActive ? 'border-l-[#0F172A]' : 'border-l-slate-400'
          }`}
        >
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <p className="text-xs font-medium text-slate-500">
                  {t('cameraSetup.selectedHeading')}
                </p>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums ${
                    isSelectedActive ? 'text-emerald-800' : 'text-slate-600'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${
                      isSelectedActive ? 'bg-emerald-600' : 'bg-slate-400'
                    }`}
                  />
                  {t(isSelectedActive ? 'cameraSetup.enabled' : 'cameraSetup.disabled')} · v
                  {selectedCamera.configurationVersion}
                </span>
              </div>
              {rows.length > 1 && onSelectCamera && (
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                  <label
                    htmlFor="camera-setup-quick-select"
                    className="text-sm font-medium text-slate-700"
                  >
                    {t('cameraSetup.chooseCamera')}
                  </label>
                  <SmartNativeSelect
                    id="camera-setup-quick-select"
                    data-testid="camera-setup-quick-select"
                    aria-label={t('cameraSetup.chooseCamera')}
                    value={selectedCamera.id}
                    onChange={(event) => onSelectCamera(event.target.value)}
                    className="min-h-10 min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:border-slate-400 focus-visible:border-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]"
                  >
                    {rows.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name} ({row.code})
                      </option>
                    ))}
                  </SmartNativeSelect>
                </div>
              )}
            </div>

            <div className="min-w-0 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p
                title={`${selectedCamera.name} · ${selectedCamera.code}`}
                className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-lg font-bold tracking-tight text-slate-950 tabular-nums"
              >
                {`${selectedCamera.name} · ${selectedCamera.code}`}
              </p>
              <details className="min-w-0 text-xs text-slate-600">
                <summary className="inline-flex min-h-7 cursor-pointer select-none items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]">
                  <span>{t('cameraSetup.technicalSourceDetails')}</span>
                </summary>
                <div className="mt-1">
                  <span
                    data-testid="selected-camera-source-id"
                    className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs font-medium text-slate-700 break-all"
                  >
                    <span>{t('cameraSetup.field.externalId')}:</span>
                    <span className="font-semibold text-slate-900">
                      {selectedCamera.externalId}
                    </span>
                  </span>
                </div>
              </details>
            </div>

            {statusContext ? (
              <CameraApplicationStatusSummary camera={selectedCamera} context={statusContext} />
            ) : (
              <div
                data-testid="camera-saved-config-summary"
                data-application-state="SAVED_METADATA_ONLY"
                className="mt-2 min-w-0 space-y-1 border-t border-slate-200 pt-3 text-sm text-slate-700"
              >
                <p className="min-w-0 break-words [overflow-wrap:anywhere] font-semibold text-slate-900">
                  {t('cameraSetup.savedConfigVersionStatus', {
                    version: selectedCamera.configurationVersion,
                  })}
                </p>
                <p className="min-w-0 break-words [overflow-wrap:anywhere] text-sm leading-relaxed text-slate-600">
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

            {(canManageCameras || Boolean(canOpenMonitoring && selectedMonitorQuery)) && (
              <div
                data-tour-anchor="camera-setup-regions"
                className="flex min-w-0 max-w-full flex-wrap items-center gap-2 border-t border-slate-100 pt-3"
              >
                {canManageCameras &&
                  (isSelectedActive ? (
                    <>
                      <button
                        type="button"
                        className={`${CAMERA_BUTTON_STYLES.primary} min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-normal text-left`}
                        onClick={(event) => open('regions', selectedCamera.id, event.currentTarget)}
                      >
                        {t('cameraSetup.editSelectedRegions', { code: selectedCamera.code })}
                      </button>
                      {onOpenPpePolicy && (
                        <button
                          type="button"
                          data-testid="selected-camera-open-ppe"
                          className={`${CAMERA_BUTTON_STYLES.secondary} min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-normal text-left`}
                          onClick={onOpenPpePolicy}
                        >
                          {t('cameraSetup.configureSelectedPpe', { code: selectedCamera.code })}
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${CAMERA_BUTTON_STYLES.secondary} min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-normal text-left`}
                        onClick={(event) => open('manage', selectedCamera.id, event.currentTarget)}
                      >
                        {t('cameraSetup.editSelectedManage', { code: selectedCamera.code })}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={`${CAMERA_BUTTON_STYLES.primary} min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-normal text-left`}
                      onClick={(event) => open('manage', selectedCamera.id, event.currentTarget)}
                    >
                      {t('cameraSetup.enableSelectedManage', { code: selectedCamera.code })}
                    </button>
                  ))}
                {canOpenMonitoring && Boolean(selectedMonitorQuery) && (
                  <>
                    <Link
                      data-testid="selected-camera-monitor-ppe"
                      className={`${CAMERA_BUTTON_STYLES.secondary} min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-normal text-left`}
                      to={`/ppe?${selectedMonitorQuery}`}
                    >
                      {t('cameraSetup.openSelectedMonitorPpe', { code: selectedCamera.code })}
                    </Link>
                    <Link
                      data-testid="selected-camera-monitor-zones"
                      className={`${CAMERA_BUTTON_STYLES.secondary} min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-normal text-left`}
                      to={`/zones?${selectedMonitorQuery}`}
                    >
                      {t('cameraSetup.openSelectedMonitorZones', { code: selectedCamera.code })}
                    </Link>
                  </>
                )}
              </div>
            )}

            {canManageCameras && (
              <p className="min-w-0 max-w-3xl break-words [overflow-wrap:anywhere] text-sm leading-relaxed text-slate-600">
                {t(
                  isSelectedActive
                    ? 'cameraSetup.selectedActiveNext'
                    : 'cameraSetup.selectedInactiveNext',
                )}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
