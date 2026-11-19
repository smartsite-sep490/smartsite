import type { IdentificationWorkspaceCopy } from './IdentificationWorkspaceCopyTypes';

export const IDENTIFICATION_WORKSPACE_COPY_VI: IdentificationWorkspaceCopy = {
  header: {
    eyebrow: 'Xác minh danh tính an toàn · C02',
    title: 'Hàng đợi yêu cầu xác minh danh tính',
    officerSubtitle:
      'Gửi yêu cầu xác minh từ đợt sự việc cho Quản lý công trường hiện tại và xét duyệt đề xuất phản hồi theo từng công trường.',
    managerSubtitle:
      'Xem các yêu cầu xác minh được giao tại công trường và phản hồi đề xuất nhân sự hoặc nhà thầu trong phạm vi được phân quyền.',
    officerBadge: 'Cán bộ an toàn',
    managerBadge: 'Quản lý công trường',
    refreshQueue: 'Làm mới danh sách',
    newFromEpisode: 'Tạo yêu cầu từ đợt sự việc',
    closeCreate: 'Đóng biểu mẫu tạo',
  },
  access: {
    deniedTitle: 'Không có quyền truy cập hàng đợi xác minh',
    deniedDescription:
      'Tài khoản hiện tại không có vai trò Cán bộ an toàn hoặc Quản lý công trường đang hoạt động tại công trường nào.',
  },
  unavailable: {
    badgeLabel: 'Chưa kích hoạt',
    queueTitle: 'Luồng xác minh danh tính chưa được kích hoạt',
    queueDescription:
      'Tính năng yêu cầu xác minh danh tính hiện đang tắt hoặc chưa khả dụng tại công trường này. Các cảnh báo, hồ sơ người và sự cố an toàn vẫn hoạt động bình thường.',
    detailTitle: 'Luồng xác minh chưa khả dụng',
    detailDescription:
      'Danh sách và chi tiết yêu cầu xác minh sẽ hiển thị tại đây ngay khi cấu hình máy chủ được kích hoạt.',
  },
  filters: {
    siteLabel: 'Công trường',
    siteFallbackPrefix: 'Công trường',
    statusLabel: 'Trạng thái',
    allStatuses: 'Tất cả trạng thái',
    statuses: {
      OPEN: 'Đang mở',
      RESPONDED: 'Đã phản hồi',
      CLOSED: 'Đã đóng',
      CANCELLED: 'Đã hủy',
    },
  },
  createPanel: {
    episodeSectionLabel: 'Đợt sự việc nguồn',
    prefilledEpisodeLabel: 'Đợt sự việc đã chọn',
    episodeSelectLabel: 'Chọn đợt sự việc tại công trường',
    episodeSelectPlaceholder: 'Chọn một đợt sự việc để yêu cầu xác minh...',
    episodeLoading: 'Đang tải danh sách đợt sự việc...',
    episodeEmpty: 'Chưa có đợt sự việc nào tại công trường đã chọn.',
    episodeRequiredError: 'Vui lòng chọn đợt sự việc cần xác minh.',
    conflictLockedNotice:
      ' Trạng thái trên máy chủ đã thay đổi. Bản nháp vẫn được giữ nguyên — hãy bấm Tải lại trước khi gửi lại.',
  },
  queue: {
    title: 'Danh sách yêu cầu',
    listAriaLabel: 'Danh sách yêu cầu xác minh danh tính',
    loading: 'Đang tải hàng đợi xác minh...',
    emptyTitle: 'Không có yêu cầu phù hợp',
    emptyOfficerDescription:
      'Chưa có yêu cầu xác minh nào khớp bộ lọc hiện tại tại công trường này.',
    emptyManagerDescription:
      'Hiện không có yêu cầu xác minh nào được giao cho bạn theo bộ lọc đã chọn.',
    retryLabel: 'Thử tải lại',
    showingRange: (from, to, total) => `Hiển thị ${from}–${to} / ${total}`,
    zeroTotal: '0 yêu cầu',
    previousPage: 'Trang trước',
    nextPage: 'Trang sau',
    episodePrefix: 'Đợt sự việc',
    versionPrefix: (version) => `Phiên bản v${version}`,
    duePrefix: 'Hạn xử lý',
    createdPrefix: 'Tạo lúc',
    proposalPrefix: 'Đề xuất hiện tại',
  },
  waitingByStatus: {
    OPEN: {
      waitingLabel: 'Đang chờ xử lý',
      waitingActor: 'Quản lý công trường được giao',
      nextActionLabel: 'Hành động cho phép tiếp theo',
      nextAction:
        'Quản lý công trường gửi phản hồi xác minh; Cán bộ an toàn có thể chuyển giao (nếu đổi Quản lý) hoặc hủy yêu cầu.',
    },
    RESPONDED: {
      waitingLabel: 'Đang chờ xử lý',
      waitingActor: 'Cán bộ an toàn',
      nextActionLabel: 'Hành động cho phép tiếp theo',
      nextAction:
        'Cán bộ an toàn chấp nhận đề xuất để đóng yêu cầu, trả lại cho Quản lý công trường, hoặc chuyển giao / hủy.',
    },
    CLOSED: {
      waitingLabel: 'Đang chờ xử lý',
      waitingActor: 'Không còn tác nhân chờ (đã đóng)',
      nextActionLabel: 'Hành động cho phép tiếp theo',
      nextAction:
        'Không còn thao tác trên yêu cầu này; nếu cần xác lập trách nhiệm sự cố hoặc hành động khắc phục, Cán bộ an toàn thực hiện riêng tại luồng Sự cố.',
    },
    CANCELLED: {
      waitingLabel: 'Đang chờ xử lý',
      waitingActor: 'Không còn tác nhân chờ (đã hủy)',
      nextActionLabel: 'Hành động cho phép tiếp theo',
      nextAction:
        'Yêu cầu đã kết thúc mà không ghi nhận kết luận; Cán bộ an toàn có thể tạo yêu cầu mới từ đợt sự việc nếu vẫn cần xác minh.',
    },
  },
  outcomes: {
    UNRESOLVED: 'Chưa xác định được',
    PARTIAL: 'Xác định một phần (nhà thầu)',
    IDENTIFIED: 'Đã xác định công nhân',
    DISPUTED: 'Phản đối / không thuộc phạm vi',
  },
  detail: {
    emptyTitle: 'Chọn một yêu cầu để xem chi tiết',
    emptyDescription:
      'Chọn một mục trong danh sách bên trái để xem thông tin đợt sự việc, trạng thái bằng chứng, đề xuất hiện tại và các thao tác được phép.',
    title: 'Chi tiết yêu cầu xác minh',
    refreshLabel: 'Làm mới chi tiết',
    loading: 'Đang tải chi tiết yêu cầu mới nhất...',
    technicalDetailsLabel: 'Chi tiết kỹ thuật',
    requestIdLabel: 'Mã yêu cầu',
    evidenceOneLine:
      'Ảnh riêng của đối tượng hiện không khả dụng — chỉ xử lý trên thông tin yêu cầu.',
    metadataTitle: 'Thông tin yêu cầu & đối tượng',
    episodeLabel: 'Mã đợt sự việc',
    subjectLabel: 'Đối tượng trong đợt sự việc',
    subjectSummaryTracked: 'Chuỗi theo dõi người liên tục',
    subjectSummaryEventLocal: (personIndex) => `Người quan sát #${personIndex} (khung hình đơn)`,
    subjectTracked: (segmentId) => `Chuỗi theo dõi (TRACKED) · Phân đoạn ${segmentId}`,
    subjectScopeHash: 'Mã băm phạm vi (SHA-256)',
    subjectEventLocal: (eventId, personIndex) =>
      `Quan sát cục bộ (EVENT_LOCAL) · Sự kiện ${eventId} · Vị trí người #${personIndex}`,
    requestedByLabel: 'Người yêu cầu (Cán bộ an toàn)',
    assignedToLabel: 'Người được giao (Quản lý công trường)',
    createdAtLabel: 'Thời điểm tạo',
    updatedAtLabel: 'Cập nhật gần nhất',
    dueAtLabel: 'Thời hạn phản hồi',
    noDueDate: 'Không đặt hạn',
    requestReasonLabel: 'Lý do yêu cầu xác minh',
    evidenceTitle: 'Trạng thái bằng chứng đối tượng',
    evidenceSummaryShared: (count) => `${count} ảnh cắt đối tượng đã duyệt`,
    evidenceSummaryNoneAttached: 'Không đính kèm ảnh cắt',
    approvedEvidenceCardTitle: 'Ảnh bằng chứng đối tượng đã duyệt',
    approvedEvidenceCardHint:
      'Ảnh cắt đối tượng đã bảo vệ cho phiên bản yêu cầu này. Chỉ tải khi bấm mở và tự hết hạn.',
    evidenceUnavailableBadge: 'Không khả dụng',
    evidenceReasonCodeLabel: 'Mã lý do kỹ thuật',
    evidenceUnavailableBody:
      'Ảnh riêng của đối tượng hiện không khả dụng — chỉ xử lý trên thông tin yêu cầu.',
    separationTitle: 'Ranh giới dữ liệu nghiệp vụ',
    separationBody:
      'Đề xuất của Quản lý công trường, kết luận yêu cầu xác minh đã duyệt, trách nhiệm sự cố và việc đóng hành động khắc phục là các dữ kiện độc lập — không tự động chuyển giao nhà thầu hoặc ghi danh tính sinh trắc học toàn cục.',
    lifecycleStripAriaLabel: 'Các bước vòng đời xác minh và xử lý sự cố',
    lifecycleStage1Title: '1. Đề xuất từ Quản lý công trường',
    lifecycleStage1Awaiting: 'Đang chờ phản hồi',
    lifecycleStage1Submitted: 'Đã gửi đề xuất (chưa chốt)',
    lifecycleStage1Cancelled: 'Dừng trước khi kết luận',
    lifecycleStage2Title: '2. Kết luận C02 của Cán bộ an toàn',
    lifecycleStage2Pending: 'Chưa chấp nhận',
    lifecycleStage2Accepted: 'Đã ghi nhận cho yêu cầu C02',
    lifecycleStage2UnknownNote:
      'Giữ nguyên chưa xác định — không tự suy đoán công nhân hay nhà thầu',
    lifecycleStage3Title: '3. Sự cố & Khắc phục MF08 (tách biệt)',
    lifecycleStage3Body: 'Không tự động gán nhà thầu từ UNKNOWN hoặc khi đóng C02',
    proposalTitle: 'Đề xuất phản hồi hiện tại',
    proposalAcceptedTitle: 'Kết luận yêu cầu đã chấp nhận',
    proposalPendingBadge: 'Chờ Cán bộ an toàn xét duyệt',
    proposalAcceptedBadge: 'Kết luận đã chốt',
    proposalEmpty: 'Quản lý công trường chưa gửi đề xuất cho phiên bản mở hiện tại.',
    proposalOutcomeLabel: 'Kết quả đề xuất',
    proposalWorkerLabel: 'Công nhân đề xuất',
    proposalContractorLabel: 'Nhà thầu đề xuất',
    proposalNotSpecified: 'Không chọn',
    proposalRecordedInTechnical: 'Đã ghi nhận (xem chi tiết kỹ thuật)',
    proposalRespondedByLabel: 'Người phản hồi',
    proposalRespondedAtLabel: 'Thời điểm phản hồi',
    proposalReasonLabel: 'Ghi chú / căn cứ phản hồi',
    conflictBannerTitle: 'Phiên bản hoặc trạng thái yêu cầu đã thay đổi (409)',
    conflictBannerBody:
      'Bản nháp của bạn vẫn được giữ nguyên. Vui lòng bấm Tải phiên bản mới nhất để đồng bộ trạng thái hiện tại trước khi thử gửi lại.',
    conflictRefreshButton: 'Tải phiên bản mới nhất',
    managerSelfRequestNotice:
      'Bạn là người đã tạo yêu cầu xác minh này nên không thể tự gửi phản hồi với vai trò Quản lý công trường.',
    managerReadOnlyStatusNotice:
      'Yêu cầu hiện không ở trạng thái Đang mở nên biểu mẫu phản hồi của Quản lý công trường đã khóa.',
    reviewTitle: 'Xét duyệt đề xuất của Quản lý công trường',
    reviewSubtitle:
      'Chấp nhận để ghi nhận kết luận cho yêu cầu này và đóng lại, hoặc trả lại để Quản lý công trường bổ sung / chỉnh sửa.',
    reviewReasonLabel: 'Lý do xét duyệt',
    reviewReasonPlaceholder:
      'Nêu rõ căn cứ chấp nhận đề xuất hoặc nội dung cần Quản lý công trường kiểm tra lại...',
    reviewReasonHint: 'Bắt buộc từ 1 đến 2000 ký tự.',
    acceptButton: 'Chấp nhận & đóng yêu cầu',
    acceptingButton: 'Đang chấp nhận...',
    returnButton: 'Trả lại Quản lý công trường',
    returningButton: 'Đang trả lại...',
    adminActionsTitle: 'Điều phối yêu cầu (Cán bộ an toàn)',
    adminActionsSubtitle:
      'Chuyển giao khi công trường đã đổi Quản lý công trường đủ điều kiện, hoặc hủy yêu cầu nếu không còn cần xác minh.',
    reassignToggle: 'Chuyển giao Quản lý',
    cancelToggle: 'Hủy yêu cầu',
    reassignTargetLabel: 'Quản lý công trường đủ điều kiện hiện tại',
    reassignLoading: 'Đang kiểm tra Quản lý công trường...',
    reassignUnavailable: 'Chưa có Quản lý công trường đủ điều kiện',
    reassignSameAssigneeNotice:
      'Quản lý công trường đủ điều kiện hiện tại trùng với người đang được giao nên chưa cần chuyển giao.',
    reassignReasonLabel: 'Lý do chuyển giao',
    reassignReasonPlaceholder: 'Ghi rõ lý do chuyển giao sang Quản lý công trường mới...',
    reassignSubmit: 'Xác nhận chuyển giao',
    reassignSubmitting: 'Đang chuyển giao...',
    cancelReasonLabel: 'Lý do hủy yêu cầu',
    cancelReasonPlaceholder: 'Ghi rõ lý do dừng yêu cầu xác minh này...',
    cancelWarning: 'Sau khi hủy, yêu cầu chuyển sang trạng thái Đã hủy và không thể mở lại.',
    cancelSubmit: 'Xác nhận hủy yêu cầu',
    cancelSubmitting: 'Đang hủy...',
    closedFollowUpTitle: 'Yêu cầu đã đóng — Không tự động chuyển giao nhà thầu',
    closedFollowUpBody:
      'Kết luận của yêu cầu xác minh này đã được lưu riêng. Nếu phát hiện an toàn đã xác nhận cần quy trách nhiệm sự cố hoặc giao hành động khắc phục cho nhà thầu, Cán bộ an toàn thực hiện quyết định riêng trong không gian Sự cố (MF08).',
    openIncidentsLink: 'Mở không gian Sự cố (MF08)',
    returnToInboxLink: 'Quay lại hồ sơ Inbox',
    originCaseContextNotice: 'Mở từ hồ sơ người trong Hộp thư an toàn.',
    cancelledFollowUpTitle: 'Yêu cầu đã hủy',
    cancelledFollowUpBody:
      'Yêu cầu này đã kết thúc mà không ghi nhận đề xuất được duyệt. Bạn có thể tạo yêu cầu xác minh mới cho cùng đợt sự việc nếu vẫn cần làm rõ.',
    createFollowUpButton: 'Tạo yêu cầu mới cho đợt sự việc này',
    historyTitle: 'Lịch sử thao tác (Chỉ Cán bộ an toàn)',
    historySubtitle: 'Nhật ký bất biến theo từng phiên bản của yêu cầu xác minh.',
    historyLoading: 'Đang tải lịch sử thao tác...',
    historyEmpty: 'Chưa có bản ghi lịch sử nào.',
    historyKinds: {
      CREATE: 'Tạo yêu cầu',
      RESPOND: 'Gửi phản hồi',
      ACCEPT: 'Chấp nhận & đóng',
      RETURN: 'Trả lại bổ sung',
      REASSIGN: 'Chuyển giao',
      CANCEL: 'Hủy yêu cầu',
    },
    historyActorLabel: 'Thực hiện bởi',
    historyAssignedToLabel: 'Giao cho',
    historyProposalLabel: 'Đề xuất kèm theo',
  },
  validation: {
    reasonRequired: 'Vui lòng nhập lý do trước khi thực hiện thao tác.',
    reasonTooLong: 'Lý do không được vượt quá 2000 ký tự.',
    reassignUnavailable: 'Hiện không có Quản lý công trường khác đủ điều kiện để chuyển giao.',
  },
  knownErrors: {
    'An active identification request already exists':
      'Đợt sự việc này đã có một yêu cầu xác minh đang mở hoặc chờ duyệt.',
    'Identification request version changed':
      'Phiên bản yêu cầu đã thay đổi trên máy chủ. Vui lòng tải phiên bản mới nhất trước khi thử lại.',
    'Identification request state changed':
      'Trạng thái yêu cầu đã thay đổi trên máy chủ. Vui lòng tải phiên bản mới nhất trước khi thử lại.',
    'Identification proposal is unavailable':
      'Đề xuất phản hồi không còn khả dụng hoặc đối tượng đề xuất không còn hợp lệ tại công trường.',
    'Identification command already used':
      'Mã lệnh xác minh đã được sử dụng cho một nội dung khác.',
    'Select the current Site Manager':
      'Người nhận không còn là Quản lý công trường đủ điều kiện hiện tại. Hãy tải lại thông tin người nhận.',
    'Select a different Site Manager':
      'Vui lòng chuyển giao cho một Quản lý công trường khác với người đang được giao và người tạo yêu cầu.',
    'Invalid identification proposal':
      'Đề xuất xác minh không hợp lệ với kết quả đã chọn hoặc phạm vi công nhân / nhà thầu tại công trường.',
    'Worker does not belong to the selected contractor':
      'Công nhân được chọn không thuộc nhà thầu đã chọn tại công trường này.',
    'Select an active site worker': 'Công nhân được chọn không còn hoạt động tại công trường này.',
    'Select a participating site contractor':
      'Nhà thầu được chọn hiện không tham gia hoạt động tại công trường này.',
    'Request evidence is unavailable':
      'Không được đính kèm tham chiếu hình ảnh khi bằng chứng đối tượng chưa khả dụng.',
    'A reason is required': 'Vui lòng nhập lý do hợp lệ.',
  },
};
