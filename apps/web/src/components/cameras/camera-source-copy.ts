import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
const en = {
  'cameraSource.savedConfiguration': 'Saved monitoring configuration',
  'cameraSource.resume': 'Apply saved configuration',
  'cameraSource.resuming': 'Applying saved configuration…',
  'cameraSource.retryResume': 'Retry the same request',
  'cameraSource.resumeError':
    'The result was not confirmed. Retry the same request to check its saved result; an uncertain or superseded operation requires reconciliation.',
  'cameraSource.resumeHelp':
    'Start a new monitoring session using the saved PPE and regions. This keeps the saved video source and view; edits in the connection form are not applied.',
  'cameraSource.resumeStarted':
    'Check configuration status and live frames in the camera panel. A started session alone does not confirm monitoring is ready.',
  'cameraSource.title': 'Connect a video source',
  'cameraSource.apply': 'Save and activate source',
  'cameraSource.applying': 'Stopping previous source and activating…',
  'cameraSource.running':
    'Source is running in a new session. Take a fresh reference image and confirm regions/PPE before monitoring.',
  'cameraSource.applyError':
    'Activation was not confirmed. Inspect the current camera/worker status before retrying; the previous source may have stopped.',
  'cameraSource.intro':
    'Choose where this camera is connected. Saving a camera name does not connect its video.',
  'cameraSource.host': 'AI host',
  'cameraSource.offline': 'offline',
  'cameraSource.chooseHost': 'Choose the AI host assigned to this site',
  'cameraSource.hostHelp':
    'USB cameras and video files are read on the selected AI host, not on every computer that opens this website.',
  'cameraSource.WEBCAM': 'USB / host webcam',
  'cameraSource.WEBCAMHelp':
    'A webcam plugged into the computer running AI. No RTSP address is needed.',
  'cameraSource.RTSP': 'IP camera / RTSP',
  'cameraSource.RTSPHelp': 'A network camera reachable from the selected AI host.',
  'cameraSource.VIDEO': 'Recorded video',
  'cameraSource.VIDEOHelp': 'Choose an approved video on the AI host. It is analysed as replay.',
  'cameraSource.BROWSER': 'This browser camera',
  'cameraSource.BROWSERHelp': 'A camera attached to the computer where you opened this website.',
  'cameraSource.browserUnavailable':
    'Browser camera transport to AI is not available on this host. A browser preview alone would not connect AI. Use a webcam attached to the AI host or an IP camera.',
  'cameraSource.device': 'Device',
  'cameraSource.chooseDevice': 'Choose a host camera',
  'cameraSource.video': 'Video',
  'cameraSource.chooseVideo': 'Choose an approved video',
  'cameraSource.endpoint': 'RTSP URL',
  'cameraSource.username': 'Camera username',
  'cameraSource.password': 'Camera password',
  'cameraSource.credentialHelp':
    'Enter credentials separately. They are sent only for the connection test and are not included in camera names or alerts.',
  'cameraSource.test': 'Test connection',
  'cameraSource.testing': 'Testing connection…',
  'cameraSource.cancel': 'Cancel test',
  'cameraSource.refresh': 'Refresh hosts',
  'cameraSource.loading': 'Checking available AI hosts…',
  'cameraSource.noHosts':
    'No AI host is assigned to this site yet. Connect a site AI host before testing a camera. The saved camera information is unchanged.',
  'cameraSource.unavailable':
    'The selected AI host is offline or does not support source setup. Check its connection and refresh.',
  'cameraSource.unsupported': 'This source type is not configured on the selected AI host.',
  'cameraSource.error':
    'Could not test this source. Check the selected device, network address and camera credentials.',
  'cameraSource.busy':
    'This host is already testing a source. Wait for that test to finish and try again.',
  'cameraSource.forbidden':
    'Your session no longer permits camera setup at this site. Refresh your session before continuing.',
  'cameraSource.preview': 'Test image from {{camera}}',
  'cameraSource.tested': 'Connection test succeeded',
  'cameraSource.notApplied':
    'Connection tested; no source changes have been applied by this test. The running AI configuration is unchanged.',
  'cameraSource.replay': 'RECORDED VIDEO · REPLAY',
  'cameraSource.live': 'LIVE SOURCE',
  'cameraSource.expired': 'This test has expired. Test the source again before applying it.',
  'cameraSource.next':
    'After connecting the source, use a fresh configuration image to draw its observation regions and choose PPE requirements.',
};
const vi: Record<keyof typeof en, string> = {
  'cameraSource.savedConfiguration': 'Cấu hình giám sát đã lưu',
  'cameraSource.resume': 'Áp dụng cấu hình đã lưu',
  'cameraSource.resuming': 'Đang áp dụng cấu hình đã lưu…',
  'cameraSource.retryResume': 'Thử lại cùng yêu cầu',
  'cameraSource.resumeError':
    'Chưa xác nhận được kết quả. Thử lại cùng yêu cầu để kiểm tra kết quả đã lưu; thao tác chưa rõ trạng thái hoặc đã bị thay thế cần được đối chiếu.',
  'cameraSource.resumeHelp':
    'Bắt đầu phiên giám sát mới với PPE và vùng đã lưu. Giữ nguồn hình và góc nhìn hiện tại; không áp dụng các chỉnh sửa trong mẫu kết nối.',
  'cameraSource.resumeStarted':
    'Kiểm tra trạng thái cấu hình và ảnh trực tiếp tại bảng camera. Phiên đã bắt đầu chưa có nghĩa giám sát đã sẵn sàng.',
  'cameraSource.title': 'Kết nối nguồn hình',
  'cameraSource.apply': 'Lưu và kích hoạt nguồn',
  'cameraSource.applying': 'Đang dừng nguồn cũ và kích hoạt…',
  'cameraSource.running':
    'Nguồn đang chạy trong phiên mới. Lấy ảnh tham chiếu mới và xác nhận vùng/PPE trước khi giám sát.',
  'cameraSource.applyError':
    'Chưa xác nhận được kích hoạt. Kiểm tra trạng thái camera/worker trước khi thử lại; nguồn cũ có thể đã dừng.',
  'cameraSource.intro': 'Chọn nơi camera được kết nối. Lưu tên camera chưa đồng nghĩa đã có hình.',
  'cameraSource.host': 'Máy AI',
  'cameraSource.offline': 'ngoại tuyến',
  'cameraSource.chooseHost': 'Chọn máy AI được cấp cho công trường',
  'cameraSource.hostHelp':
    'Webcam USB và tệp video được đọc trên máy AI đã chọn, không phải trên mọi máy đang mở website.',
  'cameraSource.WEBCAM': 'Webcam / camera USB',
  'cameraSource.WEBCAMHelp': 'Camera cắm vào máy chạy AI. Không cần nhập địa chỉ RTSP.',
  'cameraSource.RTSP': 'Camera IP / RTSP',
  'cameraSource.RTSPHelp': 'Camera qua mạng mà máy AI đã chọn có thể kết nối được.',
  'cameraSource.VIDEO': 'Video đã ghi',
  'cameraSource.VIDEOHelp':
    'Chọn video được cấp trên máy AI. Hệ thống phân tích ở chế độ phát lại.',
  'cameraSource.BROWSER': 'Camera của trình duyệt này',
  'cameraSource.BROWSERHelp': 'Camera trên máy tính bạn đang dùng để mở website.',
  'cameraSource.browserUnavailable':
    'Máy AI này chưa hỗ trợ nhận hình từ camera trình duyệt. Chỉ mở xem trước trên web chưa kết nối được AI. Hãy dùng webcam gắn vào máy AI hoặc camera IP.',
  'cameraSource.device': 'Thiết bị',
  'cameraSource.chooseDevice': 'Chọn camera trên máy AI',
  'cameraSource.video': 'Video',
  'cameraSource.chooseVideo': 'Chọn video được cấp',
  'cameraSource.endpoint': 'Địa chỉ RTSP',
  'cameraSource.username': 'Tài khoản camera',
  'cameraSource.password': 'Mật khẩu camera',
  'cameraSource.credentialHelp':
    'Nhập tài khoản riêng với địa chỉ luồng. Thông tin này chỉ gửi để thử kết nối, không đưa vào tên camera hoặc cảnh báo.',
  'cameraSource.test': 'Kiểm tra kết nối',
  'cameraSource.testing': 'Đang kiểm tra kết nối…',
  'cameraSource.cancel': 'Hủy kiểm tra',
  'cameraSource.refresh': 'Kiểm tra lại máy AI',
  'cameraSource.loading': 'Đang kiểm tra các máy AI…',
  'cameraSource.noHosts':
    'Công trường chưa được cấp máy AI. Cần nối máy AI của công trường trước khi thử camera. Thông tin camera đã lưu vẫn được giữ nguyên.',
  'cameraSource.unavailable':
    'Máy AI đã chọn đang ngoại tuyến hoặc chưa hỗ trợ thiết lập nguồn. Kiểm tra kết nối của máy rồi tải lại.',
  'cameraSource.unsupported': 'Loại nguồn này chưa được cấu hình trên máy AI đã chọn.',
  'cameraSource.error':
    'Không thử được nguồn hình. Kiểm tra thiết bị đã chọn, địa chỉ mạng và thông tin đăng nhập camera.',
  'cameraSource.busy': 'Máy AI đang thử một nguồn khác. Chờ lượt kiểm tra đó kết thúc rồi thử lại.',
  'cameraSource.forbidden':
    'Phiên hiện tại không còn quyền thiết lập camera tại công trường này. Cập nhật lại phiên trước khi tiếp tục.',
  'cameraSource.preview': 'Ảnh kiểm tra từ {{camera}}',
  'cameraSource.tested': 'Kiểm tra kết nối thành công',
  'cameraSource.notApplied':
    'Đã lấy được ảnh kiểm tra. Lượt thử này chưa áp dụng thay đổi nguồn hay bật AI; cấu hình đang chạy được giữ nguyên.',
  'cameraSource.replay': 'VIDEO ĐÃ GHI · PHÁT LẠI',
  'cameraSource.live': 'NGUỒN TRỰC TIẾP',
  'cameraSource.expired': 'Kết quả kiểm tra đã hết hạn. Hãy kiểm tra lại nguồn trước khi áp dụng.',
  'cameraSource.next':
    'Sau khi nối nguồn, lấy ảnh cấu hình mới để vẽ vùng quan sát và chọn yêu cầu PPE.',
};
registerFeatureCatalog({ en, vi });
