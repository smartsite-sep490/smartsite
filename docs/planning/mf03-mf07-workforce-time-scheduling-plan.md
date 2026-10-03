# Kế hoạch MF03/MF07 Workforce Time & Scheduling

Trạng thái: kế hoạch triển khai đang dùng để làm việc  
Domain: Workforce Time & Scheduling  
Main flows: MF03 Attendance Reconciliation & Approval, MF07 Worker Shift Change & Swap Management

## 1. Mục tiêu

MF03 và MF07 mô tả cách SmartSite xử lý thời gian làm việc của công nhân sau khi đã có dữ liệu vào/ra cổng, đồng thời xử lý đổi ca, swap ca, báo nghỉ và thiếu người.

- MF03 biến các event check-in/check-out bất biến thành dữ liệu chấm công đã được đối soát và duyệt.
- MF07 quản lý đổi ca, swap ca, báo nghỉ và ca bị thiếu người.
- Domain này không làm payroll/tính lương, HR nội bộ của nhà thầu, nhận diện khuôn mặt, khóa/mở cổng vật lý hoặc nghiệm thu công trình.

## 2. Tên nhánh đề xuất

Nên chia thành các nhánh nhỏ:

```text
feat/mf03-attendance-reconciliation
feat/mf07-shift-change-swap
feat/mf03-mf07-demo-integration
```

Nếu cần làm nhanh trong một nhánh tổng:

```text
feat/mf03-mf07-workforce-time-scheduling
```

Nên làm theo nhánh tuần tự hoặc commit tuần tự. Không nên chia nhánh cố định kiểu một nhánh frontend, một nhánh backend, vì mỗi flow cần đi từ database đến API, UI, test và demo.

## 3. MF03 Attendance Reconciliation & Approval

### Câu hỏi nghiệp vụ

SmartSite chuyển dữ liệu check-in/check-out thô thành bảng công có thể review và approve như thế nào?

### Actor

- Worker: xem công của mình và gửi yêu cầu chỉnh sửa nếu thiếu/sai.
- Contractor Representative: xem công nhân thuộc nhà thầu của mình và gửi correction request kèm lý do.
- Site Manager: xem bất thường, approve/reject correction và approve timesheet.
- Admin: vai trò cấu hình/hỗ trợ, không phải người duyệt nghiệp vụ chính.

### Đầu vào

MF03 đọc các raw attendance event bất biến do MF02 tạo ra.

Shape tối thiểu để test:

```text
RawAttendanceEvent
- id
- workerId
- siteId
- direction: IN | OUT
- eventTime
- source: FACE | QR | MANUAL | SEED
- gateId
- idempotencyKey
- createdAt
```

MF03 không được update hoặc delete raw event.

### Luồng chính

```text
RawAttendanceEvent tồn tại
-> match với ca làm của worker
-> tính số phút làm việc nếu đủ dữ liệu
-> phát hiện bất thường
-> nếu không có bất thường thì confirm hours
-> nếu có bất thường thì tạo Adjustment/Correction Request
-> Site Manager review và approve/reject adjustment
-> confirm hours
-> generate timesheet
```

### Trạng thái

```text
AttendancePairStatus =
  MATCHED
  NEEDS_REVIEW
  CALCULATED
  CORRECTED
  APPROVED
  REJECTED
```

Các mã bất thường đề xuất:

```text
MISSING_IN
MISSING_OUT
OUT_WITHOUT_IN
DUPLICATE_IN
DUPLICATE_OUT
LATE_CHECKIN
EARLY_CHECKOUT
CROSS_MIDNIGHT
```

### Rule nghiệp vụ

- Có đủ IN và OUT hợp lệ thì có thể tính công.
- Thiếu OUT thì giữ trạng thái `NEEDS_REVIEW`; hệ thống không được tự tính đủ công.
- Có OUT nhưng không có IN thì vẫn ghi nhận và đưa vào review.
- Scan trùng vẫn phải giữ dấu vết audit; reconciliation chọn cặp event phù hợp nhưng vẫn lưu anomaly.
- Check-out sớm vẫn cho phép về mặt thực tế, nhưng bị đánh dấu bất thường để review công.
- Correction tạo dữ liệu đã review riêng; không sửa raw event.
- Site Manager phải approve trước khi attendance/timesheet trở thành dữ liệu cuối.

## 4. MF07 Worker Shift Change & Swap Management

### Câu hỏi nghiệp vụ

Khi công nhân cần đổi ca, swap ca với người khác hoặc nghỉ thì hệ thống xử lý như thế nào?

### Actor

- Worker: xin đổi ca, xin swap ca, xác nhận swap, báo nghỉ.
- Contractor Representative: quản công nhân thuộc nhà thầu của mình, đề xuất người thay thế.
- Site Manager: approve/reject thay đổi lịch và xem ca bị thiếu người.

### Các case chính

Đổi ca:

```text
Worker tạo ShiftChangeRequest
-> request trỏ đúng worker_schedule của ngày cần đổi
-> request chờ Contractor Representative review
-> Contractor Representative approve hoặc reject
-> backend kiểm tra lại schedule version
-> lịch được cập nhật hoặc request chuyển sang conflicted
```

Swap ca:

```text
Worker A xin swap với Worker B
-> request trỏ đúng worker_schedule của cả hai worker
-> Worker B xác nhận
-> Contractor Representative approve hoặc reject
-> backend kiểm tra lại lịch của cả hai
-> cập nhật cả hai lịch cùng lúc hoặc không cập nhật ai
```

Báo nghỉ:

```text
Worker hoặc Contractor Representative báo nghỉ
-> request trỏ đúng worker_schedule/ngày bị ảnh hưởng
-> Contractor Representative đề xuất người thay nếu có
-> Site Manager xem ảnh hưởng
-> ca được thay người hoặc bị đánh dấu UNDERSTAFFED
```

### Trạng thái

```text
ShiftRequestStatus =
  DRAFT
  PENDING_COWORKER
  PENDING_MANAGER
  APPROVED
  APPLIED
  REJECTED
  CANCELLED
  EXPIRED
  CONFLICTED
```

### Rule nghiệp vụ

- Worker account phải được map rõ tới đúng `Worker` record trong Site. Không nhận `workerId` từ client như một bằng chứng quyền.
- Contractor Representative phải có mapping tới Contractor; chỉ thao tác công nhân thuộc Contractor đó trong đúng Site.
- Một Contractor có thể tham gia nhiều Site. Mapping Site nằm ở `contractor_site_participation`; assignment Representative cho MF07 là theo từng Site và Contractor, không tự mở quyền ở Site khác.
- Contractor Representative chỉ review request của Contractor được gán trong Site mà tài khoản được phân quyền.
- Người tạo request không được tự approve request của mình.
- Swap ca bắt buộc coworker xác nhận trước khi Contractor Representative duyệt.
- Khi apply thay đổi lịch phải dùng `expectedScheduleVersion`.
- Nếu lịch đã thay đổi trong lúc request đang chờ duyệt, request chuyển sang `CONFLICTED`.
- Swap phải atomic: đổi lịch cả hai worker hoặc không đổi ai.
- Báo nghỉ ở đây không phải payroll hoặc quản lý phép năm. Nó chỉ ghi nhận vận hành và ảnh hưởng nhân sự trong ca.

## 5. Phase và kế hoạch commit

### Phase 1: Domain schema

Nhánh:

```text
feat/mf03-attendance-reconciliation
```

Commit:

```text
feat(workforce): add attendance and schedule domain schema
```

Làm:

- Bảng Shift, worker schedule theo ngày và schedule version.
- Bảng attendance pair, anomaly, correction request và timesheet.
- Bảng shift change, shift swap và absence request.
- Migration và test entity cơ bản.

### Phase 2: MF03 reconciliation

Commit:

```text
feat(attendance): reconcile raw events into attendance pairs
```

Làm:

- Reconcile raw event theo site, worker, ngày và ca làm.
- Tính worked minutes khi đủ dữ liệu.
- Phát hiện thiếu event, trùng event, đi trễ, về sớm và OUT không có IN.
- Giữ raw event bất biến.

### Phase 3: MF03 correction và approval

Commit:

```text
feat(attendance): add correction and approval workflow
```

Làm:

- Tạo correction request, approve và reject.
- Approve timesheet.
- Lưu actor, reason và thời điểm quyết định khi review.

### Phase 4: MF03 API và client

Commit:

```text
feat(api): expose attendance reconciliation endpoints
```

Endpoint gợi ý:

```text
GET   /api/v1/sites/:siteId/attendance/pairs
POST  /api/v1/sites/:siteId/attendance/reconcile
POST  /api/v1/sites/:siteId/attendance/corrections
PATCH /api/v1/sites/:siteId/attendance/corrections/:id/approve
PATCH /api/v1/sites/:siteId/attendance/corrections/:id/reject
PATCH /api/v1/sites/:siteId/attendance/pairs/:id/approve
```

Web/Mobile gọi thông qua shared API client.

### Phase 5: MF07 scheduling workflow

Nhánh:

```text
feat/mf07-shift-change-swap
```

Commit:

```text
feat(scheduling): add shift change and swap workflow
```

Làm:

- Bổ sung scope Worker/Contractor/Contractor Representative trước khi mở endpoint nghiệp vụ.
- Shift change request.
- Shift swap request có coworker confirmation.
- Manager approve/reject.
- Apply bằng schedule version.
- Swap cập nhật atomic.

### Phase 6: MF07 absence handling

Commit:

```text
feat(scheduling): add absence request handling
```

Làm:

- Absence request.
- Người thay thế tùy chọn.
- Đánh dấu ca `UNDERSTAFFED` khi không có người thay.

### Phase 7: MF07 API và client

Commit:

```text
feat(api): expose scheduling request endpoints
```

Endpoint gợi ý:

```text
GET   /api/v1/sites/:siteId/schedules
POST  /api/v1/sites/:siteId/shift-change-requests
POST  /api/v1/sites/:siteId/shift-swap-requests
PATCH /api/v1/sites/:siteId/shift-swap-requests/:id/confirm
PATCH /api/v1/sites/:siteId/shift-requests/:id/approve
PATCH /api/v1/sites/:siteId/shift-requests/:id/reject
POST  /api/v1/sites/:siteId/absence-requests
```

### Phase 8: Web demo views

Nhánh:

```text
feat/mf03-mf07-demo-integration
```

Commit:

```text
feat(web): add attendance and scheduling demo views
```

Làm:

- Màn Attendance Reconciliation có filter, badge anomaly và detail drawer.
- Action gửi correction request và approve/reject.
- Màn Shift Scheduling có lịch theo ngày, queue change/swap request và chỉ báo absence.

### Phase 9: Demo seed và runbook

Commits:

```text
test(demo): add workforce time scheduling seed scenarios
docs(workforce): document mf03 mf07 demo flow
```

Seed scenario:

- Worker A: IN/OUT bình thường.
- Worker B: thiếu OUT.
- Worker C: check-out sớm.
- Worker D: trùng IN.
- Shift change đang chờ manager duyệt.
- Shift swap đang chờ coworker xác nhận.
- Absence làm một ca bị thiếu người.

## 6. Cách test khi MF02 chưa xong

MF03 phụ thuộc vào `RawAttendanceEvent`, nhưng không cần đợi toàn bộ luồng gate/check-in/check-out của MF02 hoàn chỉnh. Chỉ cần một boundary giả ổn định để test.

### Cách A: Seed RawAttendanceEvent giả

Tạo seed data hoặc fixture integration test để insert raw attendance event trực tiếp vào database.

Phù hợp cho:

- backend unit test,
- integration test,
- demo data,
- scenario review dễ lặp lại.

Rule:

- Đánh dấu source là `SEED` hoặc `MANUAL_TEST`.
- Giữ shape giống output tương lai của MF02.
- Không để MF03 phụ thuộc controller của MF02.

### Cách B: Test-only raw event factory

Tạo helper chỉ dùng trong test, không phải production endpoint, để sinh raw attendance event.

Phù hợp cho:

- service test,
- test edge case reconciliation,
- chạy test local nhanh.

Helper nên tạo được các event như:

```text
IN 08:00 + OUT 17:00       -> bình thường
IN 08:05 only              -> thiếu check-out
OUT 17:00 only             -> check-out không có check-in
IN 08:00 + IN 08:02 + OUT 17:00 -> trùng check-in
IN 08:00 + OUT 11:00       -> check-out sớm
```

### Cách C: Command import demo tạm thời

Thêm command chỉ dùng local/demo để load synthetic raw attendance event.

Phù hợp cho:

- setup demo,
- quay video báo cáo,
- manual QA khi MF02 chưa xong.

Command phải được đặt tên rõ là demo data và không được trình bày như MF02 đã hoàn thành.

Tên command ví dụ:

```text
pnpm --filter @smartsite/backend demo:seed-workforce-time
```

### Không nên làm

- Không chờ MF02 xong mới viết test cho MF03.
- Không để production code của MF03 gọi fake HTTP endpoint của MF02.
- Không để Web UI tự bịa attendance đã approve mà bỏ qua backend reconciliation.
- Không sửa raw event để giả lập correction.

## 7. Tiêu chí đạt yêu cầu

MF03 đạt yêu cầu khi:

- raw event vẫn bất biến;
- IN/OUT bình thường tạo attendance đã tính được;
- thiếu OUT, scan trùng và check-out sớm được đánh dấu;
- correction phải được review trước khi ảnh hưởng attendance đã approve;
- Site Manager approve được attendance/timesheet cuối.

MF07 đạt yêu cầu khi:

- shift change có thể tạo, duyệt và apply;
- shift swap bắt buộc coworker xác nhận;
- phát hiện được schedule version conflict;
- swap cập nhật lịch của cả hai worker theo kiểu atomic;
- absence có thể đánh dấu ca bị thiếu người khi không có replacement.

## 8. Ngoài scope

- Payroll và tính lương.
- HR nội bộ của nhà thầu.
- Quản lý phép năm nâng cao.
- Nhận diện khuôn mặt và gate verification.
- Quyết định khóa/mở cổng vật lý.
- Nghiệm thu công trình hoặc nghiệm thu pháp lý.
- Full implementation của MF02.
