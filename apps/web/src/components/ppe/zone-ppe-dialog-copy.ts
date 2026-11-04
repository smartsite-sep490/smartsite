import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const en = {
  'dialog.closeAria': 'Close dialog',
  'regionSetup.title': 'Link Zone to Camera Region',
  'regionSetup.subtitle': 'Draw and bind camera observation polygon geometry to the selected zone.',
  'zoneSetup.dialog.title': 'Zone PPE configuration',
  'zoneSetup.dialog.description': 'Define requirements and camera regions for {siteName}.',
  'zoneSetup.dialog.zonesDescription': 'Define PPE requirements for areas at {siteName}.',
  'zoneSetup.dialog.discardTitle': 'Discard unsaved Zone changes?',
  'zoneSetup.dialog.discardDescription': 'Your unsaved Zone fields and name changes will be lost.',
  'zoneSetup.dialog.keepEditing': 'Keep editing',
  'zoneSetup.dialog.discardChanges': 'Discard changes',
};

const vi: Record<keyof typeof en, string> = {
  'dialog.closeAria': 'Đóng hộp thoại',
  'regionSetup.title': 'Liên kết Khu vực với Vùng quan sát Camera',
  'regionSetup.subtitle': 'Vẽ và gắn đa giác vùng quan sát của camera vào khu vực đã chọn.',
  'zoneSetup.dialog.title': 'Cấu hình PPE Khu vực',
  'zoneSetup.dialog.description':
    'Thiết lập yêu cầu bảo hộ và vùng quan sát camera cho {siteName}.',
  'zoneSetup.dialog.zonesDescription': 'Thiết lập yêu cầu bảo hộ cho các khu vực tại {siteName}.',
  'zoneSetup.dialog.discardTitle': 'Hủy các thay đổi Khu vực chưa lưu?',
  'zoneSetup.dialog.discardDescription':
    'Các thông tin trường Khu vực và thay đổi tên chưa lưu sẽ bị mất.',
  'zoneSetup.dialog.keepEditing': 'Tiếp tục chỉnh sửa',
  'zoneSetup.dialog.discardChanges': 'Hủy thay đổi',
};

export function registerZonePpeDialogCopy(): void {
  registerFeatureCatalog({ en, vi });
}

registerZonePpeDialogCopy();

export type ZonePpeDialogCopyKey = keyof typeof en;
