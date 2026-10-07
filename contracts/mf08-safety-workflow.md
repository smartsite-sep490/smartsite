# Safety workflow business API — contractor responsibility revision

Canonical types: `src/safety-workflow-api.ts`, exported through `@smartsite/contracts` and the shared client. Backend/Web business API only; AI observation bytes, schema version and provenance are unchanged. Deploy the migration and Backend before the new Web. An older Security client is intentionally denied corrective work; update clients together. This revision is not an AI contract version change.

Paths below use `/api/v1/sites/:siteId`; actor comes from authentication. Active account, exact business role, Site and contractor scope are checked on the Backend. Global Admin reads only unless separately granted the required business role.

| API                                                                             | Access and behavior                                                                                                                                                                             |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET incidents, incidents/:id, incidents/:id/actions                             | Safety/Manager in Site, global Admin; assigned Contractor Representative with current Site role, grant and active contractor participation sees own actions                                     |
| POST incidents                                                                  | Safety; manual case or confirmed Alerts. Optional contractorId/workerIds/responsibilityReason must form a valid confirmation; absent contractor leaves responsibility unresolved                |
| POST incidents/:id/responsibility                                               | Safety; ConfirmIncidentResponsibilityCommand. One contractor, optional confirmed Workers, mandatory reason and expectedVersion                                                                  |
| POST incidents/:id/alerts                                                       | Safety; confirmed Alerts, same Site, one Incident maximum. Confirmed exact-observation Workers must share contractor; camera candidates never establish identity                                |
| POST incidents/:id/actions                                                      | Safety assigns active scoped Contractor Representative; unresolved responsibility blocks assignment                                                                                             |
| POST incidents/:id/actions/:actionId/transfer                                   | Safety; unfinished action, action expectedVersion, new representative and mandatory reason. Pending result requires review first; returns ASSIGNED; original submissions/reviews stay immutable |
| POST incidents/:id/actions/:actionId/start                                      | Assigned scoped Contractor Representative                                                                                                                                                       |
| POST incidents/:id/actions/:actionId/submissions                                | Assigned scoped Contractor Representative; multipart commandId, expectedVersion, resultDescription, optional JPEG file                                                                          |
| POST incidents/:id/actions/:actionId/reviews                                    | Safety other than submitter; APPROVED/REJECTED and reason                                                                                                                                       |
| POST incidents/:id/close, incidents/:id/reopen                                  | Safety; all actions verified and no pending result for close; reason and a new scoped action for reopen                                                                                         |
| GET incidents/:id/alerts/:alertId and scoped detections/.../evidence/:index     | Related source evidence and review history through authenticated Backend; AI camera adapter unchanged                                                                                           |
| GET/POST safety-tasks and safety-tasks/:id                                      | Manager assigns Safety; assigned Safety reads/performs/submits; Manager verifies/returns/cancels; no self-verification; Admin read                                                              |
| GET safety-contractors; safety-contractors/:contractorId/workers                | Safety/global Admin; safe paginated Site/contractor lookup                                                                                                                                      |
| GET safety-assignees?role=CONTRACTOR_REPRESENTATIVE&contractorId=...            | Safety/global Admin; active granted representatives. Without contractorId supports Site-wide recipient filter                                                                                   |
| GET safety-assignees?role=SAFETY_OFFICER                                        | Manager/global Admin; active Safety Officers                                                                                                                                                    |
| GET incidents/:id/evidence/:evidenceId or safety-tasks/:id/evidence/:evidenceId | Related authorized caller; private no-store JPEG; no storage keys or public bucket URLs                                                                                                         |

Worker is a confirmed violation subject, never a corrective-action assignee. Safety can confirm contractor with unknown Worker; it cannot infer contractor from Zone. Existing manual observation identity decisions remain exact-observation evidence; this revision does not complete biometric MF06 or decide identity automatically. No payroll or penalty processing.

Commands use commandId plus expectedVersion (action version for start/submit/review/transfer; Incident version for responsibility/correct-responsibility/link/assign/close/reopen). Identical retries return the original outcome after checking current access. Changed input with reused ID, stale versions or invalid transitions return 409. Reload; do not silently reapply with a newer version.

Result JPEG policy is one optional JPEG, at most 1 MiB, MIME/signature/hash checked. Shared Local/R2 storage stores bytes privately; feature DB records provider/key/hash/type/size. Authorization preflight precedes upload; final transaction rechecks current permission/version/state. Failed or duplicate transaction removes only its new object; cleanup failures log `storage_cleanup_failed` with provider/objectId. Object reads occur after authorization transaction releases locks.

Incident: OPEN → ASSIGNED → IN_PROGRESS → VERIFIED → CLOSED; reopen with new action stays REOPENED until work starts. Action: ASSIGNED → IN_PROGRESS → SUBMITTED → VERIFIED → CLOSED. VERIFIED means Safety has recorded the contractor handling outcome, not approved a disciplinary measure. REJECTED remains supported by the legacy API/history. SafetyTask: ASSIGNED → IN_PROGRESS → COMPLETED → VERIFIED, returned task IN_PROGRESS, cancel before VERIFIED. Every submission/review/transfer/closure/return remains auditable. No policy-exception closure.

Legacy local Security actions are retained. Security no longer submits or reads them through this workflow. Safety reviews any pending submission, confirms contractor, and explicitly transfers unfinished actions. VERIFIED/CLOSED history is unchanged. A legacy CLOSED Incident may fill previously missing responsibility before reopening, without rewriting closed actions. Migration `1791504000000` is additive, synchronize=false; downgrade refuses to discard populated responsibility or R2 data.

Swagger groups: Incidents, Corrective Actions, Safety Tasks, Safety Lookups, Safety Evidence. Storage is infrastructure, with no generic public upload endpoint.

## Handover revision — 06/10/2026

Luồng Web: Safety xác minh vi phạm/trách nhiệm → **Hand over to contractor** → đại diện **Start handling**, **Report handling outcome** → Safety **Record handling outcome** (ghi chú bắt buộc, API review APPROVED) → **Close incident**. Nhà thầu tự chọn cách xử lý; hệ thống không duyệt hình thức kỷ luật hay xử lý lương/phạt. SafetyTask giữ Manager → Safety → Manager.

`POST incidents/:id/correct-responsibility` dùng commandId + expectedVersion Incident, contractorId, workerIds, reason, assignedTo, description và dueAt tùy chọn. Transaction thay trách nhiệm, đánh dấu toàn bộ bàn giao hiện hành supersededAt/By/Reason, tạo bàn giao mới, audit và notification. Hồ sơ mở trở về ASSIGNED, hồ sơ đóng trở về REOPENED. Không ghi đè identity/evidence Alert đã xác minh mâu thuẫn; trả 409 và rollback. Bàn giao cũ giữ nguyên kết quả/ảnh nhưng không nhận mutation, không thuộc pending hiện hành hay điều kiện đóng; nhà thầu cũ mất quyền. Safety/Manager/Admin đọc lịch sử theo quyền hiện có; đại diện chỉ thấy bàn giao của mình còn hiện hành.

Tên lấy từ Users/Workforce sau kiểm tra quyền, bao gồm account inactive; không dựa vào trang lookup đầu. Reference thiếu trả null và UI hiện unavailable. UUID/version ở Technical details. Audit mới lưu actorName và tên người nhận/nhà thầu an toàn để mô tả bàn giao.

Thông báo dùng chung user_notification và chuông MF07: request_type SAFETY, request_id commandId, event SAFETY_HANDOVER, target Site/Incident/action. Dedup theo command/người nhận; list/count/read/delete kiểm tra quyền hiện tại. Xóa thông báo là ẩn inbox, không xóa hồ sơ/audit. Không đổi quyền scheduling MF07.

Triển khai: giữ cả IncidentContractorResponsibility1791504000000 và Mf07NotificationDeletion1791504000000, sau đó SafetyHandoverNotifications1791590400000, Backend rồi Web. Không đổi migration đã chạy; rollback mới bị chặn nếu có dữ liệu superseded/SAFETY để tránh mất lịch sử.

## Test tay với Docker hiện có

Chạy `docker compose --env-file .env -f infra/compose.yaml up -d --build`; migrate dùng DIRECT_URL (hoặc DATABASE_URL_UNPOOLED), Backend dùng DATABASE_URL. R2 và DB được cấu hình ở .env root; không đưa secrets vào Git. Mở http://localhost:5173.

1. Safety: tạo **New incident** hoặc từ Alert CONFIRMED, **Confirm responsibility**, chọn đúng nhà thầu và Worker đã xác minh (có thể để Worker unknown).
2. **Hand over to contractor** chọn đại diện và mô tả yêu cầu. Đại diện mở chuông để vào đúng hồ sơ, **Start handling**, **Report handling outcome** với mô tả và JPEG tùy chọn ≤1 MiB.
3. Safety xem ảnh, **Record handling outcome**, nhập ghi chú; khi mọi bàn giao hiện hành đã ghi nhận thì **Close incident**. Mở lại phải có lý do và bàn giao mới.
4. Giao nhầm: **Correct responsibility**, chọn nhà thầu/người nhận mới, lý do, yêu cầu xử lý. Lịch sử cũ còn cho Safety; nhà thầu cũ không xem hồ sơ/ảnh/thông báo nữa. Chưa có kết quả mới thì chưa đóng được.
5. Manager: tab **Safety Tasks**, **New safety task**; Safety **Start task**, **Submit task result**; Manager **Review task** để verify hoặc trả lại. Luồng này độc lập Incident.
6. Conflict 409: tải lại bằng Refresh, kiểm tra bản mới trước khi gửi. Storage unavailable: kiểm tra cấu hình/bucket/token hoặc object bị thiếu; không có fallback âm thầm. Đọc chuông không đồng nghĩa đã xử lý.

Giữ script seed demo local và các hồ sơ đang test. Xóa script không xóa DB/ảnh. Dọn dữ liệu sau này cần danh sách ID/object do mình tạo; không xóa hàng loạt Site/bucket/volume. Video AI vẫn cần checkpoint/spec thật; nhận diện mặt MF06 chưa được tuyên bố hoàn thành bởi revision này.

## Kết quả kiểm chứng — 06/10/2026

- Frozen install, peers check, pnpm check (lint/typecheck/test/build), mobile dependency check: đạt. Web 294/294; Backend unit 253/253; contract 77/77; shared client 40/40.
- PostgreSQL local riêng smartsite_test: lượt toàn suite có một lỗi metadata CHECK đã sửa; chạy lại đủ nhóm schema/MF07/MF08 liên quan đạt 34/34. Hai migration timestamp 1791504000000 cùng tồn tại; migration mới round-trip trong transaction và schema không drift. Các integration còn lại đã đạt ở lượt đầu, không lặp lại ma trận đã được bảo vệ.
- Compose build/readiness: Backend/Web healthy, migrate exit 0. Neon/R2 smoke riêng bằng dữ liệu tổng hợp: unknown Worker, tên đúng, chuông mở đúng Site/Incident/action, JPEG preview/upload và hash/size khớp metadata, Safety ghi nhận rồi đóng. Desktop 1440, tablet 768, mobile 390 không tràn ngang sau transition; dialog Escape đạt, không có runtime error. Browser plugin không có; dùng Playwright runtime đã cài, ảnh kiểm chứng nằm ngoài Git.
- Dọn đúng 3 Incident tổng hợp của lượt này (2 hồ sơ tạo khi script smoke gặp lỗi và 1 hồ sơ chạy đủ luồng), 1 handover, 1 submission, 1 R2 object, 1 notification và 8 audit; giữ hồ sơ người dùng đang test, 7 account demo, seed, .env và volume. Trigger immutable được bật lại cùng transaction cleanup.
- Rà soát độc lập không còn finding correctness/security nghiêm trọng trong scope này. Main remote vẫn 724084b; chỉ tích hợp nội dung vào working copy, không stage/commit/push/merge. Build còn cảnh báo chunk lớn; không đổi cấu trúc bundle ngoài phạm vi.

Phạm vi xác nhận: MF08 Web/Backend/shared notification và ảnh kết quả. Không coi smoke này là hoàn thành nhận diện mặt MF06, AI video/model benchmark, payroll, toàn bộ bảng logical OOAD hoặc migration dữ liệu ảnh cũ. DBML đã đồng bộ phần handover/notification; draw.io/ảnh ERD cũ vẫn là snapshot.
