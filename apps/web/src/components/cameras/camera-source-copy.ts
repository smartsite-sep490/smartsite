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
  'cameraSource.stepFlowHint': 'Choose source · Test · Connect',
  'cameraSource.groupLive': 'Live video sources',
  'cameraSource.groupSecondary': 'This device & demo testing',
  'cameraSource.badgeUnavailable': 'Not supported',
  'cameraSource.badgeBrowserReady': 'Browser uplink',
  'cameraSource.badgeReplay': 'Demo · Replay',
  'cameraSource.statusConnected': 'Activation acknowledged',
  'cameraSource.statusBrowserUploading': 'Uploading browser feed',
  'cameraSource.statusTested': 'Test preview ready',
  'cameraSource.statusNotConnected': 'Source not checked',
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
    'Source is running in a new session (activation alone does not prove ongoing live monitoring or accurate detections). Take a fresh reference image and confirm regions/PPE before monitoring.',
  'cameraSource.nextConfigureRegions': 'Configure monitoring areas',
  'cameraSource.applyError':
    'Activation was not confirmed. Check the current camera connection status before retrying; the previous source may have stopped.',
  'cameraSource.intro':
    'Choose a video input and test the connection for this camera. Saving a camera name does not connect its video.',
  'cameraSource.host': 'Camera processing computer',
  'cameraSource.offline': 'unavailable',
  'cameraSource.chooseHost': 'Choose a camera processing computer',
  'cameraSource.connectionDetailsToggle': 'Connection details',
  'cameraSource.connectionDetailsNeeded': 'Selection needed',
  'cameraSource.technicalHostId': 'Host ID: {{id}}',
  'cameraSource.technicalRevision': 'Source rev {{revision}}',
  'cameraSource.multipleHostsPrompt':
    'More than one camera processing computer is available for this site. Choose one in Connection details before testing this camera.',
  'cameraSource.chooseConnectionAction': 'Choose connection',
  'cameraSource.hostHelpToggle': 'Where are devices read?',
  'cameraSource.hostHelp':
    'The camera processing computer runs SmartSite to process connected cameras and must stay online. USB cameras and recorded videos are read on that computer, not on every device opening this website.',
  'cameraSource.WEBCAM': 'USB camera connected at site',
  'cameraSource.WEBCAMHelp': 'Plugged into site processing PC, not this browser.',
  'cameraSource.RTSP': 'IP camera / RTSP',
  'cameraSource.RTSPHelp': 'Network stream via RTSP address and credentials.',
  'cameraSource.VIDEO': 'Recorded video',
  'cameraSource.VIDEOHelp': 'Secondary demo playback only, never live.',
  'cameraSource.BROWSER': 'This browser camera',
  'cameraSource.BROWSERHelp': 'Local browser webcam — not supported yet.',
  'cameraSource.BROWSERReadyHelp': 'Stream directly from this browser webcam to server.',
  'cameraSource.browserUplinkScope':
    'Uses the webcam attached to this browser tab and uploads frames directly to SmartSite Backend — no site processing PC selection required.',
  'cameraSource.browserLocalCameraLabel': 'Local browser webcam',
  'cameraSource.browserDefaultCameraOption': 'Default webcam on this browser',
  'cameraSource.browserStartAction': 'Start streaming from this browser',
  'cameraSource.browserStarting': 'Starting browser camera…',
  'cameraSource.browserStopAction': 'Stop streaming',
  'cameraSource.browserInactiveNotice':
    'Camera is disabled — enable it in camera settings before streaming from this browser.',
  'cameraSource.browserLeaseHeldHeading': 'Another session is currently streaming this camera',
  'cameraSource.browserLeaseHeldBody':
    'Stop the active browser stream on the other session or wait for its lease to expire before starting here.',
  'cameraSource.browserPreviewCaption': 'Local browser feed for {{camera}}',
  'cameraSource.browserTelemetry': 'Uploaded #{{sent}} · Skipped {{dropped}}',
  'cameraSource.browserHonestNote':
    'Keep this tab open to maintain the stream. Uploading frames to server alone does not prove AI detections or applied monitoring rules.',
  'cameraSource.browserStoppedNotice':
    'Browser camera stopped and local camera tracks were released.',
  'cameraSource.browserErrUnsupported':
    'This browser does not support webcam capture here. Open SmartSite over HTTPS or localhost.',
  'cameraSource.browserErrPermissionDenied':
    'Camera permission was denied in this browser. Allow webcam access and try again.',
  'cameraSource.browserErrNotFound':
    'Selected browser webcam was not found. Connect a camera or choose another webcam.',
  'cameraSource.browserErrDeviceBusy':
    'Could not open this browser webcam. Close other apps using the camera and retry.',
  'cameraSource.browserErrTrackEnded':
    'Browser webcam disconnected. Reconnect the camera and start streaming again.',
  'cameraSource.browserErrLeaseExpired':
    'The browser stream lease expired. Start streaming again to resume.',
  'cameraSource.browserErrFrameTooLarge':
    'Captured frame exceeded the server size limit. Lower lighting noise or retry.',
  'cameraSource.browserErrRateLimited':
    'Upload rate was throttled temporarily; the next frame will retry automatically.',
  'cameraSource.browserErrUploadFailed':
    'Could not upload frames from this browser. Check your network connection and retry.',
  'cameraSource.stage2BrowserUploading': 'Browser feed uploading (frame #{{count}})',
  'cameraSource.webcamScope':
    'Devices listed below are plugged directly into the site processing computer — not this browser webcam.',
  'cameraSource.videoScope':
    'Secondary testing option · Recorded playback of approved demo clips only. Cannot activate live monitoring or upload new files here.',
  'cameraSource.browserUnavailableHeading': 'Camera on this device / browser is not supported yet',
  'cameraSource.browserUnavailable':
    'Browser camera upload is not supported yet, so this page will not ask for camera permission or substitute a site USB device (such as webcam0) from the connected processing machine — not the computer you are viewing this page on. Use a USB camera connected at the site or an IP/RTSP camera instead.',
  'cameraSource.device': 'Device',
  'cameraSource.chooseDevice': 'Choose a connected camera',
  'cameraSource.video': 'Video',
  'cameraSource.chooseVideo': 'Choose an approved video',
  'cameraSource.endpoint': 'RTSP URL',
  'cameraSource.endpointExample': 'rtsp://192.168.1.50:554/stream1',
  'cameraSource.username': 'Camera username',
  'cameraSource.password': 'Camera password',
  'cameraSource.rtspValidationError':
    'Enter a valid rtsp:// or rtsps:// URL without embedded username or password. Put credentials in the separate fields below.',
  'cameraSource.credentialHelp':
    'The processing service must be able to reach this camera network — a private LAN camera is not automatically reachable from cloud. Credentials are sent only for testing and are never included in camera names or alerts.',
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
    'Cannot connect a video source for this camera right now. Try checking again or inspect the technical details below.',
  'cameraSource.unboundHeading': 'Camera is not connected to a video source yet',
  'cameraSource.unboundBody':
    'This camera record is saved, but no video source is assigned to it yet. Ask your operator to assign a source, then check again.',
  'cameraSource.agentUnavailableHeading': 'Camera processing service is currently unreachable',
  'cameraSource.agentUnavailableBody':
    'Check the network connection or try checking again in a moment.',
  'cameraSource.technicalDetailsToggle': 'Technical details',
  'cameraSource.reasonShort.CAMERA_UNBOUND': 'not assigned',
  'cameraSource.reasonShort.AGENT_UNAVAILABLE': 'unreachable',
  'cameraSource.reasonDetail.CAMERA_UNBOUND': 'CAMERA_UNBOUND · No video source assigned',
  'cameraSource.reasonDetail.AGENT_UNAVAILABLE':
    'AGENT_UNAVAILABLE · Camera processing service unreachable',
  'cameraSource.reasonDetail.UNKNOWN': 'Unavailable (reason unspecified)',
  'cameraSource.unboundSelected':
    'This camera is not connected to a video source yet on the selected connection. Ask your operator to assign it, then check again.',
  'cameraSource.agentUnavailableSelected':
    'Camera processing service is currently unreachable on the selected connection. Try checking again in a moment.',
  'cameraSource.testOnlyNote':
    'This connection is test-only (cannot activate live monitoring here).',
  'cameraSource.emptyWebcams':
    'No USB webcams found on the connected processing computer. Plug in a USB camera there or switch to IP camera / RTSP.',
  'cameraSource.emptyVideos': 'No approved videos found on the connected processing computer.',
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
  'cameraSource.stepFlowHint': 'Chọn nguồn · Kiểm tra · Kết nối',
  'cameraSource.groupLive': 'Nguồn hình trực tiếp',
  'cameraSource.groupSecondary': 'Thiết bị này & chạy thử',
  'cameraSource.badgeUnavailable': 'Chưa hỗ trợ',
  'cameraSource.badgeBrowserReady': 'Từ trình duyệt',
  'cameraSource.badgeReplay': 'Chạy thử · Phát lại',
  'cameraSource.statusConnected': 'Đã ghi nhận kích hoạt',
  'cameraSource.statusBrowserUploading': 'Đang gửi hình từ trình duyệt',
  'cameraSource.statusTested': 'Đã có ảnh kiểm tra',
  'cameraSource.statusNotConnected': 'Chưa kiểm tra nguồn',
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
    'Nguồn đang chạy trong phiên mới (xác nhận kích hoạt chưa tự chứng minh video trực tiếp ổn định hay AI nhận diện chính xác). Hãy lấy ảnh tham chiếu mới và kiểm tra vùng/PPE trước khi giám sát.',
  'cameraSource.nextConfigureRegions': 'Cấu hình vùng giám sát',
  'cameraSource.applyError':
    'Chưa xác nhận được kích hoạt. Kiểm tra trạng thái kết nối camera trước khi thử lại; nguồn cũ có thể đã dừng.',
  'cameraSource.intro':
    'Chọn nguồn hình và kiểm tra kết nối cho camera này. Lưu tên camera chưa đồng nghĩa camera đã có hình.',
  'cameraSource.host': 'Máy xử lý camera',
  'cameraSource.offline': 'chưa khả dụng',
  'cameraSource.chooseHost': 'Chọn máy xử lý camera',
  'cameraSource.connectionDetailsToggle': 'Chi tiết kết nối',
  'cameraSource.connectionDetailsNeeded': 'Cần chọn',
  'cameraSource.technicalHostId': 'Mã kết nối: {{id}}',
  'cameraSource.technicalRevision': 'Phiên bản nguồn {{revision}}',
  'cameraSource.multipleHostsPrompt':
    'Công trường có nhiều máy xử lý camera khả dụng. Hãy chọn một máy trong Chi tiết kết nối trước khi kiểm tra camera này.',
  'cameraSource.chooseConnectionAction': 'Chọn kết nối',
  'cameraSource.hostHelpToggle': 'Thiết bị được đọc ở đâu?',
  'cameraSource.hostHelp':
    'Máy xử lý camera là máy chạy SmartSite để xử lý camera được kết nối và cần duy trì trực tuyến. Webcam USB và tệp video được đọc trên máy này, không phải trên mọi thiết bị mở website.',
  'cameraSource.WEBCAM': 'Camera USB đã kết nối',
  'cameraSource.WEBCAMHelp': 'Cắm vào máy xử lý tại điểm lắp đặt, không phải trình duyệt này.',
  'cameraSource.RTSP': 'Camera IP / RTSP',
  'cameraSource.RTSPHelp': 'Luồng mạng qua đường dẫn RTSP và tài khoản riêng.',
  'cameraSource.VIDEO': 'Video đã ghi',
  'cameraSource.VIDEOHelp': 'Chạy thử phát lại video mẫu, không phát trực tiếp.',
  'cameraSource.BROWSER': 'Camera trên máy này',
  'cameraSource.BROWSERHelp': 'Webcam từ trình duyệt hiện chưa hỗ trợ.',
  'cameraSource.BROWSERReadyHelp': 'Gửi trực tiếp từ webcam trình duyệt lên máy chủ.',
  'cameraSource.browserUplinkScope':
    'Dùng webcam trên chính máy bạn đang mở trình duyệt để gửi khung hình trực tiếp lên máy chủ SmartSite — không cần chọn máy xử lý tại chỗ.',
  'cameraSource.browserLocalCameraLabel': 'Webcam trên trình duyệt này',
  'cameraSource.browserDefaultCameraOption': 'Webcam mặc định của trình duyệt',
  'cameraSource.browserStartAction': 'Bắt đầu phát từ trình duyệt',
  'cameraSource.browserStarting': 'Đang mở webcam trình duyệt…',
  'cameraSource.browserStopAction': 'Dừng phát',
  'cameraSource.browserInactiveNotice':
    'Camera đang tắt — hãy bật camera trong cài đặt trước khi phát từ trình duyệt này.',
  'cameraSource.browserLeaseHeldHeading': 'Camera này đang được phát từ phiên khác',
  'cameraSource.browserLeaseHeldBody':
    'Hãy dừng luồng đang phát ở phiên kia hoặc chờ phiên đó hết hạn trước khi bắt đầu tại đây.',
  'cameraSource.browserPreviewCaption': 'Hình từ trình duyệt cho {{camera}}',
  'cameraSource.browserTelemetry': 'Đã gửi #{{sent}} · Bỏ qua {{dropped}}',
  'cameraSource.browserHonestNote':
    'Giữ tab này mở để duy trì nguồn hình. Đang gửi khung hình lên máy chủ chưa tự chứng minh AI đang nhận diện hay cấu hình đã áp dụng.',
  'cameraSource.browserStoppedNotice': 'Đã dừng phát từ trình duyệt và giải phóng webcam trên máy.',
  'cameraSource.browserErrUnsupported':
    'Trình duyệt hiện chưa hỗ trợ mở webcam tại đây. Hãy mở SmartSite bằng HTTPS hoặc localhost.',
  'cameraSource.browserErrPermissionDenied':
    'Trình duyệt chưa được cấp quyền camera. Hãy cho phép truy cập webcam rồi thử lại.',
  'cameraSource.browserErrNotFound':
    'Không tìm thấy webcam đã chọn trên máy này. Hãy kết nối camera hoặc chọn webcam khác.',
  'cameraSource.browserErrDeviceBusy':
    'Không mở được webcam trình duyệt. Hãy đóng ứng dụng khác đang dùng camera rồi thử lại.',
  'cameraSource.browserErrTrackEnded':
    'Webcam trình duyệt đã ngắt kết nối. Hãy kiểm tra lại camera rồi bắt đầu lại.',
  'cameraSource.browserErrLeaseExpired':
    'Phiên gửi hình từ trình duyệt đã hết hạn. Hãy bắt đầu phát lại.',
  'cameraSource.browserErrFrameTooLarge':
    'Khung hình vượt giới hạn dung lượng cho phép của máy chủ. Hãy thử lại.',
  'cameraSource.browserErrRateLimited':
    'Tốc độ gửi khung hình tạm bị giới hạn; hệ thống sẽ tự thử ở nhịp tiếp theo.',
  'cameraSource.browserErrUploadFailed':
    'Không gửi được khung hình từ trình duyệt. Kiểm tra kết nối mạng rồi thử lại.',
  'cameraSource.stage2BrowserUploading': 'Đang gửi hình từ trình duyệt (khung #{{count}})',
  'cameraSource.webcamScope':
    'Các thiết bị bên dưới được cắm trực tiếp vào máy xử lý tại công trường — không phải webcam trên trình duyệt bạn đang mở.',
  'cameraSource.videoScope':
    'Tùy chọn kiểm tra phụ · Chỉ phát lại video mẫu có sẵn trên máy xử lý — không bật giám sát trực tiếp và chưa hỗ trợ tải tệp lên tại đây.',
  'cameraSource.browserUnavailableHeading': 'Chưa hỗ trợ camera trên thiết bị / trình duyệt này',
  'cameraSource.browserUnavailable':
    'Hiện chưa hỗ trợ gửi webcam từ trình duyệt trên máy bạn đang mở web, nên trang sẽ không xin quyền camera hay tự thay bằng camera USB (như webcam0) của máy xử lý tại công trường — không phải máy bạn đang xem trang này. Hãy chọn Camera USB đã kết nối hoặc Camera IP / RTSP.',
  'cameraSource.device': 'Thiết bị',
  'cameraSource.chooseDevice': 'Chọn camera đang gắn',
  'cameraSource.video': 'Video',
  'cameraSource.chooseVideo': 'Chọn video mẫu',
  'cameraSource.endpoint': 'Địa chỉ RTSP',
  'cameraSource.username': 'Tài khoản camera',
  'cameraSource.password': 'Mật khẩu camera',
  'cameraSource.rtspValidationError':
    'Nhập địa chỉ rtsp:// hoặc rtsps:// hợp lệ và không gắn tài khoản/mật khẩu trong URL. Hãy nhập riêng vào hai ô bên dưới.',
  'cameraSource.credentialHelp':
    'Dịch vụ xử lý phải truy cập được mạng của camera — camera trong mạng LAN nội bộ không tự kết nối được từ cloud. Tài khoản chỉ gửi khi kiểm tra, không đưa vào tên camera hay cảnh báo.',
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
    'Hiện chưa kết nối được nguồn hình cho camera này. Hãy thử kiểm tra lại hoặc mở chi tiết kỹ thuật bên dưới.',
  'cameraSource.unboundHeading': 'Camera chưa được kết nối với nguồn hình',
  'cameraSource.unboundBody':
    'Camera mới chỉ lưu thông tin trên hệ thống và chưa được gán nguồn hình. Hãy liên hệ người vận hành để gán nguồn rồi kiểm tra lại.',
  'cameraSource.agentUnavailableHeading': 'Hiện chưa truy cập được dịch vụ xử lý camera',
  'cameraSource.agentUnavailableBody':
    'Hãy kiểm tra kết nối mạng hoặc thử kiểm tra lại sau ít phút.',
  'cameraSource.technicalDetailsToggle': 'Chi tiết kỹ thuật',
  'cameraSource.reasonShort.CAMERA_UNBOUND': 'chưa gán nguồn',
  'cameraSource.reasonShort.AGENT_UNAVAILABLE': 'chưa truy cập được',
  'cameraSource.reasonDetail.CAMERA_UNBOUND': 'CAMERA_UNBOUND · Chưa gán nguồn hình cho camera',
  'cameraSource.reasonDetail.AGENT_UNAVAILABLE':
    'AGENT_UNAVAILABLE · Chưa truy cập được dịch vụ xử lý camera',
  'cameraSource.reasonDetail.UNKNOWN': 'Chưa khả dụng (chưa rõ lý do)',
  'cameraSource.unboundSelected':
    'Camera chưa được kết nối với nguồn hình trên kết nối đã chọn. Hãy liên hệ người vận hành để gán nguồn rồi kiểm tra lại.',
  'cameraSource.agentUnavailableSelected':
    'Hiện chưa truy cập được dịch vụ xử lý camera trên kết nối đã chọn. Hãy thử kiểm tra lại sau ít phút.',
  'cameraSource.testOnlyNote':
    'Kết nối hiện tại chỉ hỗ trợ kiểm tra (chưa kích hoạt giám sát trực tiếp tại đây).',
  'cameraSource.emptyWebcams':
    'Chưa thấy camera USB trên máy xử lý đang kết nối. Hãy cắm camera USB vào máy đó hoặc chuyển sang Camera IP / RTSP.',
  'cameraSource.emptyVideos': 'Chưa có video mẫu khả dụng trên máy xử lý đang kết nối.',
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
