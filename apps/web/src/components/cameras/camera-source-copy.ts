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
  'cameraSource.title': 'Connect camera',
  'cameraSource.statusConnected': 'Source activated',
  'cameraSource.statusNotConnected': 'Not connected',
  'cameraSource.statusChecking': 'Checking…',
  'cameraSource.apply': 'Save and activate source',
  'cameraSource.applying': 'Stopping previous source and activating…',
  'cameraSource.sharedPersistenceNote':
    'This camera always refers to the same saved physical source from any computer. Replacing it requires confirmation and reviewing monitoring areas on a fresh image—register a new camera for a separate source.',
  'cameraSource.confirmApplyPrompt':
    'Replace the shared video source for {{camera}}? This stops the previous source and requires taking a fresh reference image to review monitoring areas.',
  'cameraSource.confirmApplyBtn': 'Confirm source replacement',
  'cameraSource.cancelApplyConfirm': 'Cancel',
  'cameraSource.running':
    'Source is running in a new session (activation alone does not prove ongoing live monitoring). Take a fresh reference image and confirm regions/PPE before monitoring.',
  'cameraSource.applyError':
    'Activation was not confirmed. Check the current camera connection status before retrying; the previous source may have stopped.',
  'cameraSource.intro':
    'Choose a video input and test the connection for this camera. Saving a camera name does not connect its video.',
  'cameraSource.host': 'Camera processing computer',
  'cameraSource.offline': 'unavailable',
  'cameraSource.chooseHost': 'Choose a camera processing computer',
  'cameraSource.connectionDetailsToggle': 'Connection details',
  'cameraSource.connectionDetailsNeeded': 'Selection needed',
  'cameraSource.multipleHostsPrompt':
    'More than one camera processing computer is available for this site. Choose one in Connection details before testing this camera.',
  'cameraSource.chooseConnectionAction': 'Choose connection',
  'cameraSource.hostHelpToggle': 'Where are devices read?',
  'cameraSource.hostHelp':
    'The camera processing computer runs SmartSite to process connected cameras and must stay online. USB cameras and recorded videos are read on that computer, not on every device opening this website.',
  'cameraSource.WEBCAM': 'USB camera connected at site',
  'cameraSource.WEBCAMHelp':
    'USB camera plugged into the connected processing computer, not this browser.',
  'cameraSource.RTSP': 'IP camera / RTSP',
  'cameraSource.RTSPHelp': 'Network stream using an RTSP address.',
  'cameraSource.VIDEO': 'Recorded video',
  'cameraSource.VIDEOHelp': 'Saved video file for preview and testing.',
  'cameraSource.BROWSER': 'This browser camera',
  'cameraSource.BROWSERHelp': 'Not supported yet.',
  'cameraSource.browserUnavailable':
    'Using the webcam on this viewing computer through the browser is not supported yet. Listed USB cameras (such as webcam0) currently belong to the connected processing machine at the site, not the computer you are viewing this page on. Use a USB camera connected at the site or an IP/RTSP camera instead.',
  'cameraSource.device': 'Device',
  'cameraSource.chooseDevice': 'Choose a connected camera',
  'cameraSource.video': 'Video',
  'cameraSource.chooseVideo': 'Choose an approved video',
  'cameraSource.endpoint': 'RTSP URL',
  'cameraSource.endpointExample': 'rtsp://192.168.1.50:554/stream1',
  'cameraSource.username': 'Camera username',
  'cameraSource.password': 'Camera password',
  'cameraSource.credentialHelp':
    'Enter credentials separately. They are sent only for the connection test and are not included in camera names or alerts.',
  'cameraSource.test': 'Test connection',
  'cameraSource.testing': 'Testing connection…',
  'cameraSource.cancel': 'Cancel test',
  'cameraSource.refresh': 'Check connection again',
  'cameraSource.refreshing': 'Checking connection…',
  'cameraSource.loading': 'Checking camera connection…',
  'cameraSource.prerequisiteLabel': 'Prerequisite',
  'cameraSource.noHostsHeading': 'No camera connection is set up for this site',
  'cameraSource.noHosts':
    'Registering a camera only saves its details and does not connect video. Ask your operator to assign a camera processing computer to this site, then check again.',
  'cameraSource.hostFetchErrorHeading': 'Could not check camera connection',
  'cameraSource.hostFetchError':
    'Could not check the camera connection right now. Retry or verify your network connection.',
  'cameraSource.retryHosts': 'Retry',
  'cameraSource.allHostsOfflineHeading': 'Cannot connect this camera yet',
  'cameraSource.allHostsOffline':
    'Cannot connect this camera through {{hosts}} right now. This camera may not be assigned for processing yet, or the connection could not be reached. Check again, or ask your operator to verify this camera assignment.',
  'cameraSource.testOnlyNote': '{{host}} is test-only (cannot activate live monitoring here).',
  'cameraSource.emptyWebcams':
    'No USB webcams found on {{host}}. Plug in a USB camera or use RTSP.',
  'cameraSource.emptyVideos': 'No approved videos found on {{host}}.',
  'cameraSource.inactiveBadge': 'Disabled · Test only',
  'cameraSource.inactiveBadgeBlocked': 'Disabled',
  'cameraSource.inactivePrepNotice':
    'Camera is disabled — you can test a connection now, then enable it in settings to activate live monitoring.',
  'cameraSource.inactiveBlockedNotice':
    'Camera is disabled — enabling it alone will not connect video until this camera has an available connection.',
  'cameraSource.inactiveEnableToActivate':
    'Connection preview succeeded, but this camera is Disabled in configuration. Enable the camera in settings first before activating a live video source.',
  'cameraSource.unavailable':
    'Cannot connect this camera through the selected camera processing computer right now. This camera may not be assigned yet or could not be reached. Check again or verify the camera connection assignment.',
  'cameraSource.unsupported': 'This source type is not enabled on the selected connection.',
  'cameraSource.error':
    'Could not test this source. Check the selected device, network address and camera credentials.',
  'cameraSource.busy':
    'This connection is already testing another source. Wait for that test to finish and try again.',
  'cameraSource.forbidden':
    'Your session no longer permits camera setup at this site. Refresh your session before continuing.',
  'cameraSource.preview': 'Test image from {{camera}}',
  'cameraSource.tested': 'Connection test succeeded',
  'cameraSource.notApplied':
    'Connection tested; no source changes have been applied by this test. The running monitoring configuration is unchanged.',
  'cameraSource.replay': 'RECORDED VIDEO · REPLAY',
  'cameraSource.live': 'LIVE SOURCE',
  'cameraSource.expired': 'This test has expired. Test the source again before applying it.',
  'cameraSource.next':
    'After connecting the source, use a fresh configuration image to draw its observation regions and choose PPE requirements.',
  'cameraSource.stagesLabel': 'Connection and activation stages',
  'cameraSource.stage1Label': '1 · Registered camera',
  'cameraSource.stage1Done': '{{name}} (metadata v{{version}})',
  'cameraSource.stage1MetaOnly': 'Naming does not connect video or monitoring.',
  'cameraSource.stage2Label': '2 · Tested connection',
  'cameraSource.stage2Idle': 'Not tested yet',
  'cameraSource.stage2Pending': 'Testing video stream…',
  'cameraSource.stage2Error': 'Test failed — running setup unchanged',
  'cameraSource.stage2Expired': 'Test receipt expired — retest required',
  'cameraSource.stage2Live': 'LIVE preview verified (unsaved)',
  'cameraSource.stage2Replay': 'REPLAY clip verified (preview only)',
  'cameraSource.stage3Label': '3 · Saved configuration',
  'cameraSource.stage3Value': 'Backend v{{version}}',
  'cameraSource.stage3Note': 'PPE & regions stored on server only.',
  'cameraSource.stage4Label': '4 · Applied configuration',
  'cameraSource.stage4Running': 'New live source activated',
  'cameraSource.stage4Resumed': 'Saved config v{{version}} requested',
  'cameraSource.stage4ReplayLocked': 'Replay preview cannot turn live monitoring on',
  'cameraSource.stage4CheckBelow': 'Check configuration status below',
  'cameraSource.replayNoLiveApply':
    'Recorded video is verified as REPLAY for offline review only and cannot be activated as a live AI source.',
  'cameraSource.liveExpiresIn': 'Receipt active (~{{seconds}}s left)',
};
const vi: Record<keyof typeof en, string> = {
  'cameraSource.endpointExample': 'rtsp://192.168.1.50:554/stream1',
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
  'cameraSource.title': 'Kết nối camera',
  'cameraSource.statusConnected': 'Đã kích hoạt nguồn',
  'cameraSource.statusNotConnected': 'Chưa kết nối',
  'cameraSource.statusChecking': 'Đang kiểm tra',
  'cameraSource.apply': 'Lưu và kích hoạt nguồn',
  'cameraSource.applying': 'Đang dừng nguồn cũ và kích hoạt…',
  'cameraSource.sharedPersistenceNote':
    'Camera này luôn giữ cùng một nguồn hình đã lưu dù mở trên máy nào. Đổi nguồn dùng chung cần xác nhận rõ và kiểm tra lại vùng giám sát trên ảnh mới — hãy đăng ký camera mới nếu cần nguồn riêng.',
  'cameraSource.confirmApplyPrompt':
    'Xác nhận đổi nguồn hình dùng chung cho {{camera}}? Thao tác này sẽ dừng nguồn cũ và yêu cầu lấy ảnh tham chiếu mới để rà soát lại vùng giám sát.',
  'cameraSource.confirmApplyBtn': 'Xác nhận đổi nguồn',
  'cameraSource.cancelApplyConfirm': 'Hủy',
  'cameraSource.running':
    'Nguồn đang chạy trong phiên mới (chưa tự chứng minh giám sát trực tiếp đang hoạt động ổn định). Hãy lấy ảnh tham chiếu mới và xác nhận vùng/PPE trước khi giám sát.',
  'cameraSource.applyError':
    'Chưa xác nhận được kích hoạt. Kiểm tra trạng thái kết nối camera trước khi thử lại; nguồn cũ có thể đã dừng.',
  'cameraSource.intro':
    'Chọn nguồn hình và kiểm tra kết nối cho camera này. Lưu tên camera chưa đồng nghĩa camera đã có hình.',
  'cameraSource.host': 'Máy xử lý camera',
  'cameraSource.offline': 'chưa khả dụng',
  'cameraSource.chooseHost': 'Chọn máy xử lý camera',
  'cameraSource.connectionDetailsToggle': 'Chi tiết kết nối',
  'cameraSource.connectionDetailsNeeded': 'Cần chọn',
  'cameraSource.multipleHostsPrompt':
    'Công trường có nhiều máy xử lý camera khả dụng. Hãy chọn một máy trong Chi tiết kết nối trước khi kiểm tra camera này.',
  'cameraSource.chooseConnectionAction': 'Chọn kết nối',
  'cameraSource.hostHelpToggle': 'Thiết bị được đọc ở đâu?',
  'cameraSource.hostHelp':
    'Máy xử lý camera là máy chạy SmartSite để xử lý camera được kết nối và cần duy trì trực tuyến. Webcam USB và tệp video được đọc trên máy này, không phải trên mọi thiết bị mở website.',
  'cameraSource.WEBCAM': 'Camera USB đã kết nối',
  'cameraSource.WEBCAMHelp':
    'Camera USB đang cắm vào máy xử lý tại điểm lắp đặt, không phải webcam trên trình duyệt này.',
  'cameraSource.RTSP': 'Camera IP / RTSP',
  'cameraSource.RTSPHelp': 'Luồng camera mạng qua địa chỉ RTSP.',
  'cameraSource.VIDEO': 'Video đã ghi',
  'cameraSource.VIDEOHelp': 'Tệp video đã lưu để xem thử và kiểm tra.',
  'cameraSource.BROWSER': 'Camera trình duyệt trên máy này',
  'cameraSource.BROWSERHelp': 'Hiện chưa hỗ trợ.',
  'cameraSource.browserUnavailable':
    'Hiện chưa hỗ trợ dùng webcam trực tiếp từ trình duyệt trên máy bạn đang mở web. Danh sách camera USB (như webcam0) hiện thuộc về máy xử lý đang kết nối tại công trường, không phải máy bạn đang xem trang này. Hãy dùng Camera USB đã kết nối hoặc Camera IP / RTSP.',
  'cameraSource.device': 'Thiết bị',
  'cameraSource.chooseDevice': 'Chọn camera đang gắn',
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
  'cameraSource.refresh': 'Kiểm tra lại kết nối',
  'cameraSource.refreshing': 'Đang kiểm tra kết nối…',
  'cameraSource.loading': 'Đang kiểm tra kết nối camera…',
  'cameraSource.prerequisiteLabel': 'Điều kiện cần',
  'cameraSource.noHostsHeading': 'Công trường này chưa có kết nối xử lý camera',
  'cameraSource.noHosts':
    'Đăng ký camera chỉ lưu thông tin, chưa có luồng hình. Hãy liên hệ người vận hành để gán máy xử lý camera cho công trường rồi kiểm tra lại.',
  'cameraSource.hostFetchErrorHeading': 'Không kiểm tra được kết nối camera',
  'cameraSource.hostFetchError':
    'Hiện không kiểm tra được kết nối camera. Hãy thử lại hoặc kiểm tra mạng.',
  'cameraSource.retryHosts': 'Thử lại',
  'cameraSource.allHostsOfflineHeading': 'Chưa kết nối được camera này',
  'cameraSource.allHostsOffline':
    'Hiện chưa kết nối được camera này qua {{hosts}}. Camera có thể chưa được gán kết nối trên máy xử lý camera hoặc chưa liên lạc được. Hãy kiểm tra lại, hoặc nhờ bộ phận vận hành kiểm tra phần gán kết nối cho camera này.',
  'cameraSource.testOnlyNote':
    '{{host}} chỉ hỗ trợ kiểm tra (chưa kích hoạt giám sát trực tiếp tại đây).',
  'cameraSource.emptyWebcams':
    'Chưa thấy webcam USB trên {{host}}. Hãy cắm camera USB hoặc dùng RTSP.',
  'cameraSource.emptyVideos': 'Chưa có video đã ghi trên {{host}}.',
  'cameraSource.inactiveBadge': 'Đang tắt · Chỉ kiểm tra',
  'cameraSource.inactiveBadgeBlocked': 'Đang tắt',
  'cameraSource.inactivePrepNotice':
    'Camera đang tắt — bạn vẫn kiểm tra kết nối được, sau đó bật trong cài đặt để kích hoạt giám sát trực tiếp.',
  'cameraSource.inactiveBlockedNotice':
    'Camera đang tắt — chỉ bật camera chưa có hình cho tới khi camera này có kết nối khả dụng.',
  'cameraSource.inactiveEnableToActivate':
    'Kiểm tra kết nối đã lấy được ảnh xem trước, nhưng camera đang Tắt trong cấu hình. Hãy bật camera trong cài đặt trước khi kích hoạt nguồn trực tiếp.',
  'cameraSource.unavailable':
    'Chưa kết nối được camera này qua máy xử lý camera đã chọn. Camera có thể chưa được gán kết nối hoặc chưa liên lạc được. Hãy kiểm tra lại hoặc rà soát phần gán kết nối camera.',
  'cameraSource.unsupported': 'Loại nguồn này chưa được bật trên kết nối đã chọn.',
  'cameraSource.error':
    'Không thử được nguồn hình. Kiểm tra thiết bị đã chọn, địa chỉ mạng và thông tin đăng nhập camera.',
  'cameraSource.busy':
    'Kết nối này đang thử một nguồn khác. Chờ lượt kiểm tra đó kết thúc rồi thử lại.',
  'cameraSource.forbidden':
    'Phiên hiện tại không còn quyền thiết lập camera tại công trường này. Cập nhật lại phiên trước khi tiếp tục.',
  'cameraSource.preview': 'Ảnh kiểm tra từ {{camera}}',
  'cameraSource.tested': 'Kiểm tra kết nối thành công',
  'cameraSource.notApplied':
    'Đã lấy được ảnh kiểm tra. Lượt thử này chưa áp dụng thay đổi nguồn hay bật giám sát; cấu hình đang chạy được giữ nguyên.',
  'cameraSource.replay': 'VIDEO ĐÃ GHI · PHÁT LẠI',
  'cameraSource.live': 'NGUỒN TRỰC TIẾP',
  'cameraSource.expired': 'Kết quả kiểm tra đã hết hạn. Hãy kiểm tra lại nguồn trước khi áp dụng.',
  'cameraSource.next':
    'Sau khi nối nguồn, lấy ảnh cấu hình mới để vẽ vùng quan sát và chọn yêu cầu PPE.',
  'cameraSource.stagesLabel': 'Các bước kết nối và kích hoạt nguồn',
  'cameraSource.stage1Label': '1 · Camera đã đăng ký',
  'cameraSource.stage1Done': '{{name}} (siêu dữ liệu v{{version}})',
  'cameraSource.stage1MetaOnly': 'Đăng ký tên chưa mở luồng hình hay giám sát.',
  'cameraSource.stage2Label': '2 · Kiểm tra kết nối',
  'cameraSource.stage2Idle': 'Chưa kiểm tra nguồn',
  'cameraSource.stage2Pending': 'Đang kiểm tra kết nối luồng…',
  'cameraSource.stage2Error': 'Kiểm tra thất bại — nguồn cũ giữ nguyên',
  'cameraSource.stage2Expired': 'Biên nhận đã hết hạn — cần thử lại',
  'cameraSource.stage2Live': 'Ảnh LIVE hợp lệ (chưa lưu)',
  'cameraSource.stage2Replay': 'Ảnh PHÁT LẠI hợp lệ (chỉ xem thử)',
  'cameraSource.stage3Label': '3 · Cấu hình đã lưu',
  'cameraSource.stage3Value': 'Backend v{{version}}',
  'cameraSource.stage3Note': 'Quy tắc PPE & vùng mới chỉ lưu ở máy chủ.',
  'cameraSource.stage4Label': '4 · Trạng thái áp dụng',
  'cameraSource.stage4Running': 'Đã kích hoạt nguồn trực tiếp mới',
  'cameraSource.stage4Resumed': 'Đã gửi cấu hình v{{version}}',
  'cameraSource.stage4ReplayLocked': 'Video phát lại không bật giám sát trực tiếp',
  'cameraSource.stage4CheckBelow': 'Xem xác nhận trạng thái bên dưới',
  'cameraSource.replayNoLiveApply':
    'Video đã ghi chỉ được xác minh ở chế độ PHÁT LẠI để xem lại và không thể kích hoạt làm nguồn trực tiếp.',
  'cameraSource.liveExpiresIn': 'Biên nhận còn hiệu lực (~{{seconds}} giây)',
};
registerFeatureCatalog({ en, vi });
