import {
  registerFeatureCatalog,
  type FeatureCatalogPair,
} from '../../i18n/feature-catalog-registry';

const en = {
  'regionSetup.drawer.editingGroup': 'Point editing',
  'regionSetup.drawer.viewGroup': 'Canvas view',
  'regionSetup.drawer.undoPoint': 'Undo Point',
  'regionSetup.drawer.resetDrawing': 'Reset Drawing',
  'regionSetup.drawer.deletePoint': 'Delete Point',
  'regionSetup.drawer.zoomIn': 'Zoom In',
  'regionSetup.drawer.zoomOut': 'Zoom Out',
  'regionSetup.drawer.resetView': 'Reset View',
  'regionSetup.drawer.panMode': 'Pan View',
  'regionSetup.drawer.coordXLabel': 'Point X (0–1)',
  'regionSetup.drawer.coordYLabel': 'Point Y (0–1)',
  'regionSetup.drawer.addPoint': 'Add Point',
  'regionSetup.drawer.vertexAria': 'Vertex {index} ({x}, {y})',
  'regionSetup.drawer.editingNotice': 'Editing Region {id} (v{version})',
  'regionSetup.drawer.cancelDrawing': 'Cancel Drawing',
  'regionSetup.drawer.discardPrompt': 'Discard unsaved region geometry changes?',
  'regionSetup.drawer.keepEditing': 'Keep Editing',
  'regionSetup.drawer.confirmDiscard': 'Discard Changes',
  'regionSetup.drawer.pointsCount': 'Points: {count} / 32',
  'regionSetup.drawer.stalePixelsNotice': 'Snapshot pixels expired · draft points retained',
  'regionSetup.drawer.canvasAria': 'Camera Region Drawing Canvas',
  'regionSetup.drawer.shortcutsLabel': 'Shortcuts:',
  'regionSetup.drawer.shortcutUndo': 'Undo',
  'regionSetup.drawer.shortcutCancel': 'Cancel drawing',
  'regionSetup.drawer.saving': 'Saving...',
  'regionSetup.drawer.saveRegion': 'Save Region',
  'regionSetup.validation.minPoints': 'Polygon must contain at least 3 points.',
  'regionSetup.validation.maxPoints': 'Polygon must not exceed 32 points.',
  'regionSetup.validation.duplicateVertices': 'Polygon contains duplicate vertices.',
  'regionSetup.validation.zeroArea': 'Polygon area must not be zero or degenerate.',
  'regionSetup.validation.selfIntersect': 'Polygon edges must not self-intersect or overlap.',
  'regionSetup.validation.maxPointsClick': 'Maximum 32 points allowed per region polygon.',
  'regionSetup.validation.outOfBounds': 'Clicked coordinates are outside the camera frame.',
  'regionSetup.validation.duplicateVertexClick':
    'A vertex with identical coordinates already exists in this polygon.',
};

const vi: Record<keyof typeof en, string> = {
  'regionSetup.drawer.editingGroup': 'Chỉnh sửa điểm',
  'regionSetup.drawer.viewGroup': 'Khung nhìn',
  'regionSetup.drawer.undoPoint': 'Hoàn tác điểm',
  'regionSetup.drawer.resetDrawing': 'Đặt lại bản vẽ',
  'regionSetup.drawer.deletePoint': 'Xóa điểm',
  'regionSetup.drawer.zoomIn': 'Phóng to',
  'regionSetup.drawer.zoomOut': 'Thu nhỏ',
  'regionSetup.drawer.resetView': 'Đặt lại khung nhìn',
  'regionSetup.drawer.panMode': 'Kéo khung nhìn',
  'regionSetup.drawer.coordXLabel': 'Tọa độ X (0–1)',
  'regionSetup.drawer.coordYLabel': 'Tọa độ Y (0–1)',
  'regionSetup.drawer.addPoint': 'Thêm điểm',
  'regionSetup.drawer.vertexAria': 'Đỉnh {index} ({x}, {y})',
  'regionSetup.drawer.editingNotice': 'Đang sửa vùng quan sát {id} (v{version})',
  'regionSetup.drawer.cancelDrawing': 'Hủy vẽ',
  'regionSetup.drawer.discardPrompt': 'Hủy các thay đổi hình học vùng quan sát chưa lưu?',
  'regionSetup.drawer.keepEditing': 'Tiếp tục chỉnh sửa',
  'regionSetup.drawer.confirmDiscard': 'Hủy thay đổi',
  'regionSetup.drawer.pointsCount': 'Số điểm: {count} / 32',
  'regionSetup.drawer.stalePixelsNotice':
    'Ảnh chụp đã quá hạn hiển thị · các điểm nháp vẫn được giữ nguyên',
  'regionSetup.drawer.canvasAria': 'Khung vẽ vùng quan sát camera',
  'regionSetup.drawer.shortcutsLabel': 'Phím tắt:',
  'regionSetup.drawer.shortcutUndo': 'Hoàn tác',
  'regionSetup.drawer.shortcutCancel': 'Hủy vẽ',
  'regionSetup.drawer.saving': 'Đang lưu...',
  'regionSetup.drawer.saveRegion': 'Lưu vùng quan sát',
  'regionSetup.validation.minPoints': 'Đa giác phải có ít nhất 3 điểm.',
  'regionSetup.validation.maxPoints': 'Đa giác không được vượt quá 32 điểm.',
  'regionSetup.validation.duplicateVertices': 'Đa giác có các đỉnh trùng tọa độ.',
  'regionSetup.validation.zeroArea': 'Diện tích đa giác không được bằng 0 hoặc suy biến.',
  'regionSetup.validation.selfIntersect': 'Các cạnh đa giác không được tự cắt nhau hoặc chồng lấp.',
  'regionSetup.validation.maxPointsClick': 'Tối đa 32 điểm cho mỗi đa giác vùng quan sát.',
  'regionSetup.validation.outOfBounds': 'Tọa độ vừa chọn nằm ngoài khung hình camera.',
  'regionSetup.validation.duplicateVertexClick':
    'Đã tồn tại một đỉnh có cùng tọa độ trong đa giác này.',
};

export type RegionPolygonEditorCatalogKey = keyof typeof en;

export const regionPolygonEditorCatalog: FeatureCatalogPair<RegionPolygonEditorCatalogKey> = {
  en,
  vi,
};

registerFeatureCatalog(regionPolygonEditorCatalog);
