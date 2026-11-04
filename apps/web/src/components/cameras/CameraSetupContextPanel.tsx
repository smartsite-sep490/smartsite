import { useTranslation } from 'react-i18next';
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
  'cameraSetup.stage1Title': 'Stage 1 · Per-Zone PPE Policy',
  'cameraSetup.stage1Body':
    'PPE rules apply per Zone, not camera-wide. Locked Zones allow rename only.',
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
  'cameraSetup.sourceIdDisclosure':
    'Source identifier is viewed in Manage; registration does not verify source status or connection.',
  'cameraSetup.metadataDisclosureLabel': 'Configuration & revision details',
  'cameraSetup.selectedHeading': 'Selected camera',
  'cameraSetup.selectedActiveNext':
    'Edit observation regions for this camera, or open Manage to rename or disable it in configuration.',
  'cameraSetup.selectedInactiveNext':
    'Region linking requires an enabled camera. Open Manage to enable it without re-registering.',
  'cameraSetup.editSelectedRegions': 'Edit observation regions ({{code}})',
  'cameraSetup.editSelectedManage': 'Edit camera settings ({{code}})',
  'cameraSetup.enableSelectedManage': 'Open Manage to enable ({{code}})',
  'cameraSetup.selectCameraBtn': 'Select {{code}}',
  'cameraSetup.selectedCameraBtn': 'Selected {{code}}',
};

const vi: Record<keyof typeof en, string> = {
  'cameraSetup.stagesDisclosureLabel': 'Tham chiếu 4 bước thiết lập',
  'cameraSetup.stage1Title': 'Bước 1 · Chính sách PPE theo khu vực',
  'cameraSetup.stage1Body':
    'Quy định PPE áp dụng theo từng khu vực, không mặc định toàn camera. Khu vực đã khóa chỉ đổi tên.',
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
  'cameraSetup.sourceIdDisclosure':
    'Mã định danh nguồn được xem trong Quản lý; đăng ký không xác nhận trạng thái nguồn hay kết nối.',
  'cameraSetup.metadataDisclosureLabel': 'Chi tiết cấu hình & phiên bản',
  'cameraSetup.selectedHeading': 'Camera đang chọn',
  'cameraSetup.selectedActiveNext':
    'Sửa vùng quan sát cho camera này, hoặc mở Quản lý để đổi tên hay tắt trong cấu hình.',
  'cameraSetup.selectedInactiveNext':
    'Cần bật camera trước khi gắn vùng quan sát. Mở Quản lý để bật mà không cần đăng ký lại.',
  'cameraSetup.editSelectedRegions': 'Sửa vùng quan sát ({{code}})',
  'cameraSetup.editSelectedManage': 'Sửa cài đặt camera ({{code}})',
  'cameraSetup.enableSelectedManage': 'Mở Quản lý để bật ({{code}})',
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
      className="min-w-0 border-t border-slate-200/80 pt-2.5 text-xs text-slate-600"
    >
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {t('cameraSetup.stagesDisclosureLabel')}
      </p>
      <ol aria-label={t('cameraSetup.stagesDisclosureLabel')} className="grid gap-2 sm:grid-cols-2">
        {STAGE_KEYS.map(([titleKey, bodyKey]) => (
          <li
            key={titleKey}
            className="min-w-0 rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-xs leading-5"
          >
            <p className="break-words [overflow-wrap:anywhere] font-semibold text-slate-800">
              {t(titleKey)}
            </p>
            <p className="mt-0.5 break-words [overflow-wrap:anywhere] text-slate-600">
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
    <dl className="min-w-0 flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <div className="min-w-0 inline-flex items-center">
        <dt className="sr-only">{t('cameraSetup.statusLabel')}</dt>
        <dd className="min-w-0">
          <span
            className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium break-words [overflow-wrap:anywhere] ${
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
      <div className="min-w-0 max-w-full inline-flex items-center gap-1 rounded-md border border-slate-200/80 bg-slate-50 px-2 py-0.5">
        <dt className="text-slate-500">{t('cameraSetup.codeLabel')}</dt>
        <dd className="min-w-0 max-w-full break-all font-mono text-xs font-semibold tabular-nums text-slate-800">
          {row.code}
        </dd>
      </div>
      <div className="min-w-0 inline-flex items-center gap-1 rounded-md border border-slate-200/80 bg-slate-50 px-2 py-0.5 text-slate-500">
        <dt>{t('cameraSetup.revisionLabel')}</dt>
        <dd className="font-mono text-xs font-semibold tabular-nums text-slate-700">
          v{row.configurationVersion}
        </dd>
      </div>
    </dl>
  );
}

export interface CameraSetupContextBarProps {
  siteCode?: string;
  siteName?: string;
  rows: CameraResponse[];
  selectedCamera: CameraResponse | null;
  canManageCameras: boolean;
  canOpenMonitoring: boolean;
  open: CameraSetupOpenHandler;
  statusContext?: CameraApplicationStatusContext;
}

export function CameraSetupContextBar({
  siteCode,
  siteName,
  rows,
  selectedCamera,
  canManageCameras,
  canOpenMonitoring,
  open,
  statusContext,
}: CameraSetupContextBarProps) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const activeCount = rows.filter((row) => row.status === 'ACTIVE').length;
  const inactiveCount = rows.length - activeCount;
  const siteBadge = siteCode && siteName ? `${siteCode} · ${siteName}` : (siteName ?? siteCode);
  const isSelectedActive = selectedCamera?.status === 'ACTIVE';

  return (
    <div className="mt-4 min-w-0 space-y-2.5 rounded-xl border border-slate-200/90 bg-slate-50/60 p-3 text-xs text-slate-700">
      <div className="min-w-0 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex flex-wrap items-center gap-2">
          {siteBadge && (
            <span className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] rounded-md border border-slate-200 bg-white px-2.5 py-0.5 font-semibold text-slate-800">
              {siteBadge}
            </span>
          )}
          {rows.length > 0 && (
            <span className="inline-flex max-w-full items-center break-words rounded-md border border-slate-200 bg-white px-2.5 py-0.5 font-medium tabular-nums text-slate-600">
              {t('cameraSetup.catalogBreakdown', { active: activeCount, inactive: inactiveCount })}
            </span>
          )}
        </div>
        <details className="group min-w-0 text-[11px] text-slate-500">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md border border-transparent px-2 py-0.5 font-medium text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
            <span>{t('cameraSetup.metadataDisclosureLabel')}</span>
            <span
              aria-hidden="true"
              className="text-[10px] text-slate-400 transition-transform duration-150 group-open:rotate-180"
            >
              ▾
            </span>
          </summary>
          <div className="mt-1.5 min-w-0 space-y-1 rounded-lg border border-slate-200/80 bg-white px-3 py-2 leading-4 text-slate-600">
            {selectedCamera && !statusContext && (
              <p className="break-words [overflow-wrap:anywhere]">
                {t('cameraSetup.savedConfigVersionStatus', {
                  version: selectedCamera.configurationVersion,
                })}
              </p>
            )}
            <p className="break-words [overflow-wrap:anywhere]">
              {t('cameraSetup.sourceIdDisclosure')}
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
        <p className="min-w-0 break-words [overflow-wrap:anywhere] rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-slate-600">
          {t('cameraSetup.scopeReadOnlyReason')}
        </p>
      )}

      {selectedCamera && (
        <div
          role="region"
          aria-label={t('cameraSetup.selectedHeading')}
          data-tour-anchor="camera-setup-save"
          className={`min-w-0 flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs border-l-4 ${
            isSelectedActive ? 'border-l-slate-900' : 'border-l-slate-400'
          }`}
        >
          <div className="min-w-0 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t('cameraSetup.selectedHeading')}
              </p>
              <p className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-sm font-semibold text-slate-900">
                {`${selectedCamera.code} · ${selectedCamera.name}`}
              </p>
              {canManageCameras && (
                <p className="min-w-0 break-words [overflow-wrap:anywhere] text-xs leading-5 text-slate-600">
                  {t(
                    isSelectedActive
                      ? 'cameraSetup.selectedActiveNext'
                      : 'cameraSetup.selectedInactiveNext',
                  )}
                </p>
              )}
            </div>

            {canManageCameras && (
              <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:shrink-0">
                {isSelectedActive ? (
                  <>
                    <button
                      type="button"
                      className={`${CAMERA_BUTTON_STYLES.primary} min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-normal text-left`}
                      onClick={(event) => open('regions', selectedCamera.id, event.currentTarget)}
                    >
                      {t('cameraSetup.editSelectedRegions', { code: selectedCamera.code })}
                    </button>
                    <button
                      type="button"
                      className={`${CAMERA_BUTTON_STYLES.compactSecondary} min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-normal text-left`}
                      onClick={(event) => open('manage', selectedCamera.id, event.currentTarget)}
                    >
                      {t('cameraSetup.editSelectedManage', { code: selectedCamera.code })}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={`${CAMERA_BUTTON_STYLES.secondary} min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-normal text-left`}
                    onClick={(event) => open('manage', selectedCamera.id, event.currentTarget)}
                  >
                    {t('cameraSetup.enableSelectedManage', { code: selectedCamera.code })}
                  </button>
                )}
              </div>
            )}
          </div>

          {statusContext && (
            <CameraApplicationStatusSummary camera={selectedCamera} context={statusContext} />
          )}
        </div>
      )}
    </div>
  );
}
