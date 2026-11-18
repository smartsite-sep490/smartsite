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
  'regionSetup.drawer.frameCoverage': 'Region: {percent}% of camera frame',
  'regionSetup.drawer.largePolygonFrameHint':
    'This polygon covers {percent}% of the camera view. Draw a compact boundary around the specific work zone—Camera default PPE already covers the full camera.',
  'regionSetup.drawer.revalidationBanner':
    'Camera view changed — coordinates are never auto-warped. Inspect or adjust this saved boundary on the current reference image, tick confirmation, and save.',
  'regionSetup.drawer.editGeometryPpeNote':
    'Saving here updates polygon geometry only. Edit this region’s Inherited, Custom, or Disabled PPE rule in Camera PPE policy on Camera Setup.',
  'regionSetup.drawer.stalePixelsNotice': 'Snapshot pixels expired · draft points retained',
  'regionSetup.drawer.canvasAria': 'Camera Region Drawing Canvas',
  'regionSetup.drawer.imageContextSummary':
    '{zoneCode} · {zoneName} → {cameraCode} ({sourceKind} v{version} · {width}×{height})',
  'regionSetup.drawer.regionPpePolicyLegend': 'Region PPE policy',
  'regionSetup.drawer.shortcutsLabel': 'Shortcuts:',
  'regionSetup.drawer.shortcutUndo': 'Undo',
  'regionSetup.drawer.shortcutEscapeKey': 'Esc',
  'regionSetup.drawer.shortcutCancel': 'Cancel drawing',
  'regionSetup.drawer.saving': 'Saving...',
  'regionSetup.drawer.saveRegion': 'Save Region',
  'regionSetup.drawer.readinessExpired':
    'Reference image expired — request and accept a fresh reference image to save.',
  'regionSetup.drawer.readinessRevisionStale':
    'Reference image is on v{refVersion} while camera is on v{camVersion} — load and accept a fresh reference image before saving.',
  'regionSetup.drawer.readinessMinPoints':
    'Add at least {remaining} more point(s) on the canvas to form a polygon (minimum 3).',
  'regionSetup.drawer.readinessConfirmView':
    'Confirm the reference-image checkbox above to enable Save Region.',
  'regionSetup.drawer.readinessPolicy':
    'Select a valid Region PPE policy above to enable Save Region.',
  'regionSetup.drawer.readinessAlreadySaved':
    'Saved in camera configuration. Load and accept a fresh reference image before saving further polygon edits.',
  'regionSetup.drawer.readinessReady':
    'Ready to save to camera configuration (worker application is confirmed separately).',
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
  'regionSetup.drawer.frameCoverage': 'Vùng vẽ: {percent}% khung hình camera',
  'regionSetup.drawer.largePolygonFrameHint':
    'Đa giác này đang phủ tới {percent}% góc nhìn camera. Nên vẽ gọn quanh khu vực làm việc mục tiêu—mặc định camera đã áp dụng cho toàn khung hình.',
  'regionSetup.drawer.revalidationBanner':
    'Góc nhìn camera đã thay đổi — tọa độ đa giác không tự động biến đổi. Hãy kiểm tra hoặc chỉnh lại ranh giới đã lưu trên ảnh tham chiếu hiện tại, tích xác nhận rồi lưu.',
  'regionSetup.drawer.editGeometryPpeNote':
    'Thao tác lưu tại đây chỉ cập nhật hình học đa giác. Chỉnh quy tắc PPE (Kế thừa, Tùy chỉnh hoặc Tắt) của vùng này tại mục Chính sách PPE trên màn Thiết lập Camera.',
  'regionSetup.drawer.stalePixelsNotice':
    'Ảnh chụp đã quá hạn hiển thị · các điểm nháp vẫn được giữ nguyên',
  'regionSetup.drawer.canvasAria': 'Khung vẽ vùng quan sát camera',
  'regionSetup.drawer.imageContextSummary':
    '{zoneCode} · {zoneName} → {cameraCode} ({sourceKind} v{version} · {width}×{height})',
  'regionSetup.drawer.regionPpePolicyLegend': 'Chính sách PPE của vùng',
  'regionSetup.drawer.shortcutsLabel': 'Phím tắt:',
  'regionSetup.drawer.shortcutUndo': 'Hoàn tác',
  'regionSetup.drawer.shortcutEscapeKey': 'Esc',
  'regionSetup.drawer.shortcutCancel': 'Hủy vẽ',
  'regionSetup.drawer.saving': 'Đang lưu...',
  'regionSetup.drawer.saveRegion': 'Lưu vùng quan sát',
  'regionSetup.drawer.readinessExpired':
    'Ảnh tham chiếu đã hết hạn — hãy tải và chấp nhận ảnh tham chiếu mới trước khi lưu.',
  'regionSetup.drawer.readinessRevisionStale':
    'Ảnh tham chiếu đang ở v{refVersion} trong khi camera đã ở v{camVersion} — hãy tải và chấp nhận ảnh tham chiếu mới trước khi lưu.',
  'regionSetup.drawer.readinessMinPoints':
    'Thêm ít nhất {remaining} điểm nữa trên khung vẽ để tạo đa giác (tối thiểu 3 điểm).',
  'regionSetup.drawer.readinessConfirmView':
    'Đánh dấu xác nhận khớp ảnh tham chiếu ở trên để bật nút Lưu vùng quan sát.',
  'regionSetup.drawer.readinessPolicy':
    'Chọn chính sách PPE hợp lệ cho vùng ở trên để bật nút Lưu vùng quan sát.',
  'regionSetup.drawer.readinessAlreadySaved':
    'Đã lưu vào cấu hình camera. Hãy tải và chấp nhận ảnh tham chiếu mới trước khi lưu thêm chỉnh sửa đa giác.',
  'regionSetup.drawer.readinessReady':
    'Sẵn sàng lưu vào cấu hình camera (trạng thái worker áp dụng được xác nhận riêng).',
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
