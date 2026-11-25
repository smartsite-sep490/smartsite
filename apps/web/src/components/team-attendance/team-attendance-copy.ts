import i18n from '../../i18n';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';

const en = {
  'teamWeb.selectAttendanceShift': 'Select attendance shift',
  'teamWeb.scanQr': 'Scan QR',
  'teamWeb.directQrHint':
    'Use the Worker’s current QR code or eight-character code. Access permission is checked before passage confirmation.',
  'teamWeb.qrTitle': 'Verify Worker QR',
  'teamWeb.gateReady': 'Ready to verify',
  'teamWeb.gateReadyHint': 'Scan a face or choose Scan QR to verify the next Worker.',
  'teamWeb.gateAwaitingShort': 'Awaiting passage confirmation',
  'teamWeb.gateRecordedShort': 'Passage recorded',
  'teamWeb.assignmentAction': 'Review schedule assignments',
  'teamWeb.hoursReviewAction': 'Review and confirm working hours',
  'teamWeb.correctionAction': 'Open attendance corrections',
  'teamWeb.missingSession': 'No attendance session — report missing attendance',
  'teamWeb.gateProgress': 'Gate passage status',
  'teamWeb.gateAllowed': '1. Allowed: identity and access permission verified.',
  'teamWeb.gateSecurityReview': '1. Security review is required before confirming passage.',
  'teamWeb.gateAwaiting':
    '2. Awaiting passage confirmation: security must confirm the person has passed. IN/OUT has not been recorded.',
  'teamWeb.gateRecordedStep': '3. IN/OUT recorded: completed only after successful confirmation.',
  'teamWeb.gateScheduled':
    'A work schedule is available. IN/OUT is saved only after security confirms below.',
  'teamWeb.gateRecorded':
    '{direction} recorded: actual passage saved for attendance processing. Working hours depend on the assigned schedule and reconciliation.',
  'teamWeb.zoneTitle': 'Review hours: missing team leader roll call',
  'teamWeb.zoneHint':
    'Check completed Gate IN/OUT sessions or approved attendance corrections before confirming calculated hours. Deductions remain applied.',
  'teamWeb.zoneEvidence': 'Gate IN: {ins} · Gate OUT: {outs} · completed sessions: {sessions}',
  'teamWeb.zoneHours': 'Regular hours: {regular} · overtime: {overtime}',
  'teamWeb.zoneRollCall': 'Current leader roll call:',
  'teamWeb.zoneConfirm': 'Confirm working hours',
  'teamWeb.zoneReason': 'Reason for confirming working hours',
  'teamWeb.zoneReasonPlaceholder': 'Enter reason for confirming working hours...',
  'teamWeb.zoneBadgeConfirmed': 'Hours confirmed',
  'teamWeb.zoneBadgePending': 'Hours review required',
  'teamWeb.zoneCardGate': 'Gate scan data',
  'teamWeb.zoneCardHours': 'Working hours',
  'teamWeb.zoneCardRollCall': 'On-site roll call',
  'teamWeb.zoneConfirmed':
    'Working hours confirmed by the Contractor Representative. Original roll call retained.',
  'teamWeb.zoneWaiting':
    'Confirmation requires an authorized Contractor Representative, ended shift/overtime, complete Gate evidence or approved corrections, and no unresolved requests.',
  'teamWeb.zoneConflict':
    'Evidence changed after the previous review. Check the current intervals and hours again.',
  'teamWeb.zoneChanged': 'Attendance changed. Refresh the record and review the evidence again.',
  'teamWeb.zoneNotifyTitle': 'Missing team leader roll call — hours review required',
  'teamWeb.zoneNotifyMessage':
    '{name} ({code}) has attendance evidence on {date}, but no leader roll call. The Contractor Representative checks Gate sessions or approved corrections and confirms working hours.',
  'teamWeb.zoneReviewedBy': 'Reviewed by {name} at {time}',

  'teamWeb.absenceTitle': 'Review absence: no Gate IN/OUT',
  'teamWeb.absenceHint':
    'Hours remain zero. Check the leader’s roll call and Gate evidence before confirming that this Worker was absent.',
  'teamWeb.absenceEvidence':
    'Gate passages: {gates} · attendance events: {events} · sessions: {sessions}',
  'teamWeb.absenceRejectedReport':
    '{count} empty missing-attendance report(s) were rejected. They do not count as worked attendance; report history is retained.',
  'teamWeb.absenceRecorded': 'Leader recorded Present at {time}',
  'teamWeb.absenceConfirm': 'Confirm absent — 0 hours',
  'teamWeb.absenceReason': 'Reason for confirming absence',
  'teamWeb.absenceReasonPlaceholder': 'Enter reason for confirming absence...',
  'teamWeb.absenceBadgeConfirmed': 'Absence confirmed',
  'teamWeb.absenceBadgePending': 'Absence review required',
  'teamWeb.absenceCardEvidence': 'Gate and attendance evidence',
  'teamWeb.absenceConfirmed': 'Absence confirmed — 0 hours. Original roll call retained.',
  'teamWeb.absenceWaiting':
    'Awaiting an authorized Contractor Representative. Confirmation requires the shift and approved overtime to have ended and no Gate or attendance evidence.',
  'teamWeb.absenceConflict':
    'Evidence changed after the absence review. Reconciliation is required.',
  'teamWeb.absenceChanged': 'Attendance changed. Refresh the record and check the evidence again.',
  'teamWeb.absenceNotifyTitle': 'No Gate evidence — absence review required',
  'teamWeb.missingRollCallAbsenceMessage':
    '{name} ({code}) has no leader roll call on {date} and no Gate IN/OUT. The Contractor Representative must check and confirm absent — 0 hours if the Worker did not attend.',
  'teamWeb.absenceNotifyMessage':
    '{name} ({code}) was marked present on {date}, but has no Gate IN/OUT. The Contractor Representative checks and confirms absence if the Worker did not attend. If the Worker attended, ask them to submit a missing-attendance correction.',
  'teamWeb.leader': 'Team leader',
  'teamWeb.manageLeader': 'Manage team leader',
  'teamWeb.noLeader': 'No team leader assigned',
  'teamWeb.hasLeader': 'Team leader assigned',
  'teamWeb.unavailableLeader': 'Team leader information unavailable',
  'teamWeb.leaderHint':
    'Choose a current team member with an active Worker account. The leader records Zone attendance for the team.',
  'teamWeb.currentLeader': 'Current leader: {name}',
  'teamWeb.selectLeader': 'Select team leader',
  'teamWeb.removeLeader': 'No leader / remove current leader',
  'teamWeb.noMembers': 'No current team members. Add a member before assigning a leader.',
  'teamWeb.leaderSaved': 'Team leader updated.',
  'teamWeb.saveLeader': 'Save team leader',
  'teamWeb.changed':
    'The team or attendance record has changed. Refresh and select your changes again.',
  'teamWeb.attendance': 'Zone attendance',
  'teamWeb.viewAttendance': 'View Zone attendance',
  'teamWeb.reportHint':
    'Read-only results recorded by the team leader. Select a work date, shift and schedule version.',
  'teamWeb.workDate': 'Work date',
  'teamWeb.shift': 'Shift',
  'teamWeb.version': 'Schedule version',
  'teamWeb.versionValue': 'Version {version}',
  'teamWeb.choose': 'Select…',
  'teamWeb.chooseFilters': 'Select a shift to view attendance.',
  'teamWeb.noSchedules': 'No schedules are available for attendance.',
  'teamWeb.reportTotals': '{present} present · {absent} absent · {pending} not yet recorded',
  'teamWeb.worker': 'Worker',
  'teamWeb.result': 'Zone attendance status',
  'teamWeb.gateResult': 'Gate comparison',
  'teamWeb.previous': 'Previous',
  'teamWeb.next': 'Next',
  'teamWeb.attendanceHint':
    'The team leader confirms presence at the assigned Zone. Gate entry and completed working hours are checked separately.',
  'teamWeb.assignment': 'Team / Zone',
  'teamWeb.noZone':
    'The assigned Zone is unavailable. Ask your Contractor Representative to check the team’s Zone assignment.',
  'teamWeb.beforeStart':
    'The shift has not started yet. You cannot record Zone attendance before the shift starts.',
  'teamWeb.recordsLocked': 'Attendance records are locked. You can only view the results.',
  'teamWeb.attendanceUnavailable':
    'Zone attendance is currently unavailable. Refresh to check again.',
  'teamWeb.readOnly':
    'Attendance is read only before the shift starts or when all records are locked.',
  'teamWeb.memberHint':
    'Your team leader records Zone attendance. You can view your own status here.',
  'teamWeb.roster': 'Team attendance roster',
  'teamWeb.search': 'Find a team member',
  'teamWeb.emptyRoster': 'No eligible team members for this shift.',
  'teamWeb.noMatches': 'No team members match your search.',
  'teamWeb.selectHint':
    'Choose Present or Absent for each member you want to submit. Unselected members stay unchanged.',
  'teamWeb.selected': '{count} member(s) selected',
  'teamWeb.reason': 'Reason for correction',
  'teamWeb.reasonHint': 'Enter at least 5 characters when changing a recorded attendance status.',
  'teamWeb.locked': 'Locked attendance record',
  'teamWeb.saveAttendance': 'Save attendance',
  'teamWeb.saved':
    'Zone attendance saved. Working hours will be reconciled using Gate records and shift rules.',
  'teamWeb.refresh': 'Refresh data',
  'teamWeb.maxEntries': 'Submit no more than 500 members at a time.',
  'teamWeb.status.NOT_YET': 'Not yet recorded',
  'teamWeb.status.PRESENT': 'Present',
  'teamWeb.status.ABSENT': 'Absent',
  'teamWeb.gate.MATCHED': 'Gate entry and Zone attendance matched',
  'teamWeb.gate.NO_GATE_ENTRY': 'Marked present; Gate entry needs checking',
  'teamWeb.gate.GATE_ONLY': 'Gate entry recorded; no matching Present confirmation',
  'teamWeb.gate.NOT_YET': 'No Gate entry or Zone attendance recorded',
  'teamWeb.anomaly.ZONE_ATTENDANCE_PENDING':
    'Waiting for the team leader to record Zone attendance',
  'teamWeb.anomaly.ZONE_ATTENDANCE_ABSENT': 'Marked absent at the assigned Zone',
  'teamWeb.anomaly.ZONE_GATE_MISSING': 'Zone presence recorded; Gate entry missing',
  'teamWeb.anomaly.ZONE_ATTENDANCE_MISMATCH': 'Team, membership or Zone attendance does not match',
  'teamWeb.anomaly.ZONE_ASSIGNMENT_UNRESOLVED': 'Assigned work Zone needs checking',
};

const vi: Record<keyof typeof en, string> = {
  'teamWeb.selectAttendanceShift': 'Chọn ca chấm công',
  'teamWeb.scanQr': 'Quét QR',
  'teamWeb.directQrHint':
    'Dùng mã QR hiện tại hoặc mã 8 ký tự của công nhân. Hệ thống kiểm tra quyền trước khi bảo vệ xác nhận qua cổng.',
  'teamWeb.qrTitle': 'Xác minh QR công nhân',
  'teamWeb.gateReady': 'Sẵn sàng xác minh',
  'teamWeb.gateReadyHint': 'Quét khuôn mặt hoặc chọn Quét QR để xác minh công nhân tiếp theo.',
  'teamWeb.gateAwaitingShort': 'Chờ xác nhận qua cổng',
  'teamWeb.gateRecordedShort': 'Đã ghi nhận lượt qua cổng',
  'teamWeb.assignmentAction': 'Kiểm tra phân công',
  'teamWeb.hoursReviewAction': 'Kiểm tra và chốt giờ công',
  'teamWeb.correctionAction': 'Mở đơn báo thiếu / sửa công',
  'teamWeb.missingSession': 'Chưa có lượt chấm công — báo thiếu',
  'teamWeb.gateProgress': 'Trạng thái qua cổng',
  'teamWeb.gateAllowed': '1. Được phép: đã kiểm tra danh tính và quyền.',
  'teamWeb.gateSecurityReview': '1. Cần bảo vệ kiểm tra trước khi xác nhận qua cổng.',
  'teamWeb.gateAwaiting':
    '2. Chờ xác nhận qua cổng: bảo vệ cần xác nhận người đã đi qua. Chưa ghi nhận IN/OUT.',
  'teamWeb.gateRecordedStep': '3. Đã ghi nhận IN/OUT: chỉ hoàn tất sau khi xác nhận thành công.',
  'teamWeb.gateScheduled':
    'Có lịch làm việc. Lượt IN/OUT chỉ được lưu sau khi bảo vệ xác nhận bên dưới.',
  'teamWeb.gateRecorded':
    'Đã ghi nhận {direction}: đã lưu lượt qua cổng thực tế và đưa vào xử lý chấm công. Giờ công phụ thuộc lịch và kết quả đối soát.',
  'teamWeb.zoneTitle': 'Đối soát giờ công: thiếu điểm danh nhóm trưởng',
  'teamWeb.zoneHint':
    'Kiểm tra các phiên IN/OUT đã khép hoặc giờ sửa công đã được duyệt trước khi chốt giờ công. Giữ nguyên các khoản trừ đã tính.',
  'teamWeb.zoneEvidence': 'Lượt IN: {ins} · lượt OUT: {outs} · phiên đã khép: {sessions}',
  'teamWeb.zoneHours': 'Giờ trong ca: {regular} · tăng ca: {overtime}',
  'teamWeb.zoneRollCall': 'Điểm danh nhóm trưởng hiện tại:',
  'teamWeb.zoneConfirm': 'Chốt giờ công',
  'teamWeb.zoneReason': 'Lý do chốt giờ công',
  'teamWeb.zoneReasonPlaceholder': 'Nhập lý do chốt giờ công đối soát...',
  'teamWeb.zoneBadgeConfirmed': 'Đã chốt giờ công',
  'teamWeb.zoneBadgePending': 'Cần đối soát giờ công',
  'teamWeb.zoneCardGate': 'Dữ liệu quét cổng',
  'teamWeb.zoneCardHours': 'Thời gian làm việc',
  'teamWeb.zoneCardRollCall': 'Điểm danh hiện trường',
  'teamWeb.zoneConfirmed': 'Đã chốt giờ công bởi Đại diện nhà thầu. Giữ nguyên điểm danh ban đầu.',
  'teamWeb.zoneWaiting':
    'Chỉ Đại diện nhà thầu có quyền chốt sau khi ca/tăng ca kết thúc, đủ bằng chứng cổng hoặc đơn sửa công đã duyệt và không còn yêu cầu chờ xử lý.',
  'teamWeb.zoneConflict':
    'Bằng chứng đã thay đổi sau lần chốt trước. Kiểm tra lại các khoảng thời gian và giờ công hiện tại.',
  'teamWeb.zoneChanged': 'Dữ liệu chấm công đã thay đổi. Hãy làm mới và kiểm tra lại bằng chứng.',
  'teamWeb.zoneNotifyTitle': 'Thiếu điểm danh nhóm trưởng — cần chốt giờ công',
  'teamWeb.zoneNotifyMessage':
    '{name} ({code}) có bằng chứng giờ làm ngày {date} nhưng chưa được nhóm trưởng điểm danh. Đại diện nhà thầu kiểm tra lượt cổng hoặc giờ sửa công đã duyệt và chốt giờ công.',
  'teamWeb.zoneReviewedBy': 'Người chốt: {name} · {time}',

  'teamWeb.absenceTitle': 'Đối soát vắng mặt: Không có IN/OUT',
  'teamWeb.absenceHint':
    'Giữ 0 giờ công. Kiểm tra điểm danh của nhóm trưởng và bằng chứng cổng trước khi xác nhận công nhân vắng.',
  'teamWeb.absenceEvidence':
    'Lượt qua cổng: {gates} · sự kiện chấm công: {events} · phiên làm việc: {sessions}',
  'teamWeb.absenceRejectedReport':
    '{count} đơn báo thiếu chấm công có phiên rỗng đã bị từ chối. Các đơn này không tính là bằng chứng giờ làm; lịch sử đơn vẫn được giữ nguyên.',
  'teamWeb.absenceRecorded': 'Nhóm trưởng ghi Có mặt lúc {time}',
  'teamWeb.absenceConfirm': 'Xác nhận vắng — 0 giờ',
  'teamWeb.absenceReason': 'Lý do xác nhận vắng',
  'teamWeb.absenceReasonPlaceholder': 'Nhập lý do chốt vắng mặt đối soát...',
  'teamWeb.absenceBadgeConfirmed': 'Đã chốt vắng mặt',
  'teamWeb.absenceBadgePending': 'Cần đối soát vắng mặt',
  'teamWeb.absenceCardEvidence': 'Bằng chứng đối soát cổng & chấm công',
  'teamWeb.absenceConfirmed': 'Đã xác nhận vắng — 0 giờ. Giữ nguyên điểm danh ban đầu.',
  'teamWeb.absenceWaiting':
    'Chờ Đại diện nhà thầu có quyền kiểm tra. Chỉ xác nhận khi ca và tăng ca được duyệt đã kết thúc, không có bằng chứng cổng hoặc chấm công.',
  'teamWeb.absenceConflict': 'Có bằng chứng thay đổi sau khi xác nhận vắng. Cần đối soát lại.',
  'teamWeb.absenceChanged':
    'Dữ liệu chấm công đã thay đổi. Hãy làm mới và kiểm tra lại bằng chứng.',
  'teamWeb.absenceNotifyTitle': 'Thiếu bằng chứng cổng — cần xác nhận vắng',
  'teamWeb.missingRollCallAbsenceMessage':
    '{name} ({code}) chưa được đội trưởng điểm danh ngày {date} và không có lượt vào/ra cổng. Đại diện nhà thầu kiểm tra và xác nhận vắng — 0 giờ nếu công nhân không đi làm.',
  'teamWeb.absenceNotifyMessage':
    '{name} ({code}) được điểm danh Có mặt ngày {date} nhưng không có lượt vào/ra cổng. Đại diện nhà thầu kiểm tra và xác nhận vắng nếu không đi làm. Nếu có đi làm, công nhân gửi đơn báo thiếu chấm công.',
  'teamWeb.leader': 'Nhóm trưởng',
  'teamWeb.manageLeader': 'Quản lý nhóm trưởng',
  'teamWeb.noLeader': 'Chưa có nhóm trưởng',
  'teamWeb.hasLeader': 'Đã có nhóm trưởng',
  'teamWeb.unavailableLeader': 'Chưa tải được thông tin nhóm trưởng',
  'teamWeb.leaderHint':
    'Chọn thành viên hiện tại có tài khoản Công nhân đang hoạt động. Nhóm trưởng điểm danh khu vực cho nhóm.',
  'teamWeb.currentLeader': 'Nhóm trưởng hiện tại: {name}',
  'teamWeb.selectLeader': 'Chọn nhóm trưởng',
  'teamWeb.removeLeader': 'Không có / gỡ nhóm trưởng hiện tại',
  'teamWeb.noMembers': 'Nhóm chưa có thành viên. Hãy thêm thành viên trước khi gán nhóm trưởng.',
  'teamWeb.leaderSaved': 'Đã cập nhật nhóm trưởng.',
  'teamWeb.saveLeader': 'Lưu nhóm trưởng',
  'teamWeb.changed':
    'Thông tin nhóm hoặc điểm danh đã thay đổi. Hãy làm mới và chọn lại các thay đổi.',
  'teamWeb.attendance': 'Điểm danh khu vực',
  'teamWeb.viewAttendance': 'Xem điểm danh khu vực',
  'teamWeb.reportHint':
    'Kết quả chỉ xem do nhóm trưởng ghi nhận. Chọn ngày làm, ca và phiên bản lịch.',
  'teamWeb.workDate': 'Ngày làm việc',
  'teamWeb.shift': 'Ca làm',
  'teamWeb.version': 'Phiên bản lịch',
  'teamWeb.versionValue': 'Phiên bản {version}',
  'teamWeb.choose': 'Chọn…',
  'teamWeb.chooseFilters': 'Chọn ca để xem kết quả điểm danh.',
  'teamWeb.noSchedules': 'Chưa có lịch làm việc để xem điểm danh.',
  'teamWeb.reportTotals': '{present} có mặt · {absent} vắng · {pending} chưa điểm danh',
  'teamWeb.worker': 'Công nhân',
  'teamWeb.result': 'Trạng thái điểm danh khu vực',
  'teamWeb.gateResult': 'Đối chiếu vào cổng',
  'teamWeb.previous': 'Trước',
  'teamWeb.next': 'Tiếp',
  'teamWeb.attendanceHint':
    'Nhóm trưởng xác nhận có mặt tại khu vực được giao. Lượt vào cổng và giờ công được đối soát riêng.',
  'teamWeb.assignment': 'Nhóm / Khu vực',
  'teamWeb.noZone':
    'Chưa xác định được khu vực làm việc. Hãy liên hệ Đại diện nhà thầu để kiểm tra khu vực được giao cho nhóm.',
  'teamWeb.beforeStart':
    'Chưa đến giờ bắt đầu ca làm. Bạn chưa thể điểm danh khu vực. Vui lòng quay lại khi ca làm bắt đầu.',
  'teamWeb.recordsLocked': 'Các bản ghi điểm danh đã khóa. Bạn chỉ có thể xem kết quả.',
  'teamWeb.attendanceUnavailable':
    'Hiện chưa thể điểm danh khu vực. Vui lòng làm mới để kiểm tra lại.',
  'teamWeb.readOnly': 'Chỉ được xem trước giờ bắt đầu ca hoặc khi tất cả bản ghi đã khóa.',
  'teamWeb.memberHint':
    'Nhóm trưởng thực hiện điểm danh khu vực. Bạn có thể xem trạng thái của mình tại đây.',
  'teamWeb.roster': 'Danh sách điểm danh nhóm',
  'teamWeb.search': 'Tìm thành viên',
  'teamWeb.emptyRoster': 'Không có thành viên đủ điều kiện trong ca này.',
  'teamWeb.noMatches': 'Không tìm thấy thành viên phù hợp.',
  'teamWeb.selectHint':
    'Chọn Có mặt hoặc Vắng cho từng người cần gửi. Người chưa chọn được giữ nguyên trạng thái.',
  'teamWeb.selected': 'Đã chọn {count} thành viên',
  'teamWeb.reason': 'Lý do sửa điểm danh',
  'teamWeb.reasonHint': 'Nhập ít nhất 5 ký tự khi sửa trạng thái đã được ghi nhận.',
  'teamWeb.locked': 'Bản ghi điểm danh đã khóa',
  'teamWeb.saveAttendance': 'Lưu điểm danh',
  'teamWeb.saved':
    'Đã lưu điểm danh khu vực. Giờ công sẽ được đối soát theo lượt qua cổng và quy tắc ca làm.',
  'teamWeb.refresh': 'Làm mới dữ liệu',
  'teamWeb.maxEntries': 'Mỗi lần gửi tối đa 500 thành viên.',
  'teamWeb.status.NOT_YET': 'Chưa điểm danh',
  'teamWeb.status.PRESENT': 'Có mặt',
  'teamWeb.status.ABSENT': 'Vắng',
  'teamWeb.gate.MATCHED': 'Đã khớp lượt vào cổng và điểm danh khu vực',
  'teamWeb.gate.NO_GATE_ENTRY': 'Đã ghi có mặt; cần kiểm tra lượt vào cổng',
  'teamWeb.gate.GATE_ONLY': 'Đã vào cổng; chưa có xác nhận Có mặt tương ứng',
  'teamWeb.gate.NOT_YET': 'Chưa có lượt vào cổng hoặc điểm danh khu vực',
  'teamWeb.anomaly.ZONE_ATTENDANCE_PENDING': 'Chờ nhóm trưởng điểm danh khu vực',
  'teamWeb.anomaly.ZONE_ATTENDANCE_ABSENT': 'Được điểm danh vắng tại khu vực',
  'teamWeb.anomaly.ZONE_GATE_MISSING': 'Đã điểm danh có mặt; thiếu lượt vào cổng',
  'teamWeb.anomaly.ZONE_ATTENDANCE_MISMATCH': 'Điểm danh không khớp nhóm, thành viên hoặc khu vực',
  'teamWeb.anomaly.ZONE_ASSIGNMENT_UNRESOLVED': 'Cần kiểm tra khu vực làm việc được giao',
};

registerFeatureCatalog({ en, vi });

export function teamText(key: keyof typeof en, values?: Record<string, unknown>): string {
  return i18n.t(key, { ns: SAFETY_NAMESPACE, ...values });
}
