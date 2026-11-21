import type { SafetyIdentificationOutcome } from '@smartsite/contracts/safety-identification';

export const IDENTIFICATION_MAX_REASON_LENGTH = 2000 as const;

export interface IdentificationOutcomeCopy {
  label: string;
  description: string;
}

export interface IdentificationCopy {
  create: {
    title: string;
    subtitle: string;
    assigneeLabel: string;
    assigneeLoading: string;
    assigneeUnavailable: string;
    evidenceNotice: string;
    evidenceOptionalNotice: string;
    evidenceApprovedNotice: string;
    reasonLabel: string;
    reasonPlaceholder: string;
    reasonHint: string;
    submitLabel: string;
    submittingLabel: string;
    cancelLabel: string;
    refreshLabel: string;
  };
  response: {
    title: string;
    subtitle: string;
    outcomeLabel: string;
    outcomes: Record<SafetyIdentificationOutcome, IdentificationOutcomeCopy>;
    contractorLabel: string;
    contractorPlaceholder: string;
    contractorNotApplicable: string;
    contractorEmpty: string;
    workerLabel: string;
    workerPlaceholder: string;
    workerNotApplicable: string;
    workerEmpty: string;
    candidatesLoading: string;
    reasonLabel: string;
    reasonPlaceholder: string;
    reasonHint: string;
    submitLabel: string;
    submittingLabel: string;
    refreshLabel: string;
  };
  errors: {
    assigneeRequired: string;
    reasonRequired: string;
    reasonTooLong: string;
    workerRequired: string;
    contractorInvalid: string;
  };
}

export const IDENTIFICATION_COPY: Record<'vi' | 'en', IdentificationCopy> = {
  vi: {
    create: {
      title: 'Yêu cầu xác minh',
      subtitle: 'Nhờ Quản lý công trường hỗ trợ xác minh hồ sơ.',
      assigneeLabel: 'Người nhận',
      assigneeLoading: 'Đang tải Quản lý công trường…',
      assigneeUnavailable: 'Chưa có Quản lý công trường phù hợp.',
      evidenceNotice: 'Thông tin hồ sơ — chưa có ảnh riêng cho yêu cầu này.',
      evidenceOptionalNotice:
        'Chưa đính kèm ảnh — nếu gửi ngay sẽ chỉ chia sẻ thông tin hồ sơ (chọn, xem trước và tích xác nhận ảnh cắt ở trên nếu cần gửi kèm ảnh).',
      evidenceApprovedNotice: 'Đã xác nhận đính kèm 1 ảnh cắt đã che vùng cho Quản lý công trường.',
      reasonLabel: 'Lý do yêu cầu',
      reasonPlaceholder: 'Nêu thông tin cần hỗ trợ xác minh…',
      reasonHint: 'Tối đa 2.000 ký tự.',
      submitLabel: 'Gửi yêu cầu',
      submittingLabel: 'Đang gửi…',
      cancelLabel: 'Đóng',
      refreshLabel: 'Làm mới',
    },
    response: {
      title: 'Phản hồi xác minh',
      subtitle: 'Gửi đề xuất để Cán bộ an toàn xem xét.',
      outcomeLabel: 'Kết quả',
      outcomes: {
        UNRESOLVED: {
          label: 'Chưa xác định',
          description: 'Chưa rõ công nhân và nhà thầu.',
        },
        PARTIAL: {
          label: 'Biết nhà thầu',
          description: 'Chọn nhà thầu, để trống công nhân.',
        },
        IDENTIFIED: {
          label: 'Xác định công nhân',
          description: 'Chọn công nhân trong danh sách.',
        },
        DISPUTED: {
          label: 'Thông tin mâu thuẫn',
          description: 'Nêu rõ điểm mâu thuẫn ở mục lý do.',
        },
      },
      contractorLabel: 'Nhà thầu',
      contractorPlaceholder: 'Không chọn',
      contractorNotApplicable: 'Không áp dụng',
      contractorEmpty: 'Chưa có nhà thầu',
      workerLabel: 'Công nhân',
      workerPlaceholder: 'Chọn công nhân',
      workerNotApplicable: 'Không áp dụng',
      workerEmpty: 'Chưa có công nhân',
      candidatesLoading: 'Đang tải danh sách…',
      reasonLabel: 'Lý do',
      reasonPlaceholder: 'Nêu căn cứ xác minh hoặc điểm mâu thuẫn…',
      reasonHint: 'Tối đa 2.000 ký tự.',
      submitLabel: 'Gửi phản hồi',
      submittingLabel: 'Đang gửi…',
      refreshLabel: 'Làm mới',
    },
    errors: {
      assigneeRequired: 'Chưa có Quản lý công trường để nhận yêu cầu.',
      reasonRequired: 'Vui lòng nhập lý do.',
      reasonTooLong: 'Tối đa 2.000 ký tự.',
      workerRequired: 'Vui lòng chọn công nhân.',
      contractorInvalid: 'Nhà thầu đã chọn không còn hợp lệ.',
    },
  },
  en: {
    create: {
      title: 'Identification request',
      subtitle: 'Ask the Site Manager to help check this case.',
      assigneeLabel: 'Assignee',
      assigneeLoading: 'Checking Site Manager…',
      assigneeUnavailable: 'No eligible Site Manager available.',
      evidenceNotice: 'Case details only — subject image unavailable.',
      evidenceOptionalNotice:
        'No image confirmed yet — submitting now shares case details only (choose, preview, and confirm a masked crop above to attach it).',
      evidenceApprovedNotice:
        'Approved masked subject crop attached — the Site Manager will receive this shared image.',
      reasonLabel: 'Request reason',
      reasonPlaceholder: 'Note what needs verification…',
      reasonHint: 'Up to 2,000 characters.',
      submitLabel: 'Send request',
      submittingLabel: 'Sending…',
      cancelLabel: 'Close',
      refreshLabel: 'Refresh',
    },
    response: {
      title: 'Identification response',
      subtitle: 'Send proposal for Safety Officer review.',
      outcomeLabel: 'Outcome',
      outcomes: {
        UNRESOLVED: {
          label: 'Unresolved',
          description: 'Worker and contractor unknown.',
        },
        PARTIAL: {
          label: 'Contractor only',
          description: 'Select contractor, leave worker blank.',
        },
        IDENTIFIED: {
          label: 'Identified worker',
          description: 'Select worker from list.',
        },
        DISPUTED: {
          label: 'Conflicting info',
          description: 'Explain the conflict in the reason field.',
        },
      },
      contractorLabel: 'Contractor',
      contractorPlaceholder: 'None',
      contractorNotApplicable: 'Not applicable',
      contractorEmpty: 'No contractors',
      workerLabel: 'Worker',
      workerPlaceholder: 'Select worker',
      workerNotApplicable: 'Not applicable',
      workerEmpty: 'No workers',
      candidatesLoading: 'Loading list…',
      reasonLabel: 'Reason',
      reasonPlaceholder: 'State verification basis or conflicting details…',
      reasonHint: 'Up to 2,000 characters.',
      submitLabel: 'Send response',
      submittingLabel: 'Sending…',
      refreshLabel: 'Refresh',
    },
    errors: {
      assigneeRequired: 'An eligible Site Manager is required.',
      reasonRequired: 'Enter a reason.',
      reasonTooLong: 'Maximum 2,000 characters.',
      workerRequired: 'Select a worker.',
      contractorInvalid: 'Selected contractor is no longer valid.',
    },
  },
};

export function getIdentificationCopy(language?: string | null): IdentificationCopy {
  return language?.toLowerCase().startsWith('vi') ? IDENTIFICATION_COPY.vi : IDENTIFICATION_COPY.en;
}
