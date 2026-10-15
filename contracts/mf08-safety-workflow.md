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

## Safety overview and pre-work checklists — revision 2026-10-13

Additive Web–Backend contracts: `src/safety-overview-api.ts` and `src/safety-checklist-api.ts`. AI contract bytes/version are unchanged. Apply migration `1792195200000-SafetyChecklists` before deploying the paired Backend and Web; old clients retain the previous Incident/SafetyTask behavior.

- GET `safety-overview`, `safety-overview/teams/:id`: date and IANA timezone required; optional contractor/team filters, offset/limit. Safety/Manager in Site and global Admin may read. Schedule membership is resolved at shift start, alert membership at event time. Camera links describe current configuration; these are context, not attendance or contractor responsibility.
- GET `safety-alerts/:id/work-context`: verified source subjects and related group/Zone/camera context. Unknown identity stays unknown.
- GET/POST `safety-checklists`, GET `safety-checklists/:id`; POST `:id/start`, `:id/cancel`, `:id/submissions`, `:id/reviews`; GET `:id/evidence/:evidenceId`. Safety assigns/records/returns/cancels; assigned Representative starts/reports within current contractor grant. Manager/Admin read only.
- Assignment freezes team, Zone, work window, recipient and criterion snapshot. Suggestions are editable before assignment. Cancellation preserves history; pending or accepted reports cannot be cancelled.
- Submission uses multipart `command` (JSON with commandId/expectedVersion/results) and `files`; per-result fileIndexes address that array. JPEG/PNG/PDF ≤5 MiB/file, ≤3/item, ≤20 MiB/report. File content/MIME/signature/scope checked. Legacy Incident/SafetyTask remain JPEG ≤1 MiB. Evidence stays private, authenticated/no-store; PDF downloads with nosniff.
- Each attempt is immutable; one pending report. FAIL/NOT_APPLICABLE require notes; PASS requires files when criterion requests evidence. Safety cannot review their own report. ACCEPTED means the report was recorded: FAIL stays visible, no scheduling/attendance/access blocker.
- An ACCEPTED FAIL can supply `sourceChecklistResultId` to create one Incident. Source files stay in the checklist. Safety confirms responsibility explicitly; later confirmation/correction must match the source contractor. Existing verified Alert identity is checked before handover/reopen/close. Legacy cases without a stored identity snapshot can check current subjects/contractor, but cannot reconstruct earlier erased identity decisions.
- Shared notification inbox handles CHECKLIST_ASSIGNED/SUBMITTED/RETURNED/RECORDED with current scope and deduplication; deep link opens Site + checklist. Reading/deleting a notification does not complete work.

### Test tay trên Web

1. Tại root repo, chạy `docker compose --env-file .env -f infra/compose.yaml up -d --build backend web --wait`. Compose cũ dùng DATABASE_URL/DIRECT_URL và R2 từ root .env; không thêm Docker riêng. Không đưa .env vào Git.
2. Dùng Site/nhà thầu/nhóm/lịch đã tạo qua Workforce. Manager cấp Zone cho nhà thầu; đại diện cấp Zone đó cho nhóm trong khoảng giờ checklist. Thiếu quyền phủ toàn bộ giờ làm thì giao checklist bị conflict.
3. Safety đăng nhập → **Overview**: chọn Work date, Contractor, Team. Kiểm tra lịch dự kiến, Worker chưa có nhóm, nhóm chưa có lịch và Zone chưa có camera. **View alerts** mở Alerts cùng Site/ngày/Zone/camera; thông tin hỗ trợ xác minh không tự gán trách nhiệm.
4. **Assign checklist**: chọn nhóm/Zone/đại diện, mô tả, giờ bắt đầu/kết thúc. Chọn **Working at height** hoặc **Electrical work**, sửa tiêu chí và yêu cầu minh chứng trước khi giao.
5. Đại diện mở chuông hoặc **Checklists** → **Start checklist** → **Submit checklist**. Chọn Pass/Fail/Not applicable từng mục; Fail/Not applicable có giải thích, Pass có minh chứng nếu được yêu cầu. Thử PNG/PDF/JPEG, preview/remove và refresh.
6. Safety → **Request update** với ghi chú; đại diện nộp lại. Safety → **Record checklist**. History giữ cả lần cũ; mục Fail vẫn đỏ dù báo cáo Accepted.
7. Từ mục Fail đã ghi nhận → **Create incident**. Kiểm tra nội dung và xác nhận nhà thầu; sau đó **Hand over to contractor** → **Start handling** → **Report handling outcome** → **Record handling outcome** → **Close incident**. Checklist evidence mở từ liên kết nguồn, không upload bản sao.
8. Test bằng đại diện Site/nhà thầu khác: không đọc file/hồ sơ. Admin/Manager xem checklist nhưng không thao tác thay Safety. Conflict → **Reload** rồi tự kiểm tra/gửi lại; không tự sửa version.

Script demo local `apps/backend/src/scripts/mf08-demo.ts` được giữ riêng trên máy, không đưa vào Git. Nó chỉ chạy DB local đã kiểm tra, không seed vào Neon, không reset account/hồ sơ đã test. Khi dùng Neon, chuẩn bị nhóm/Zone/lịch qua giao diện hiện có; smoke test dùng dữ liệu tổng hợp riêng và dọn đúng ID của lượt đó.

Xóa script không xóa dữ liệu DB/R2. Dọn demo sau này cần đối chiếu assignment/submissions/results/evidence/Incident/audit/notification và object do lượt demo tạo; history có trigger bảo toàn, không xóa hàng loạt hay tắt trigger để dọn dữ liệu người dùng. Video AI vẫn cần checkpoint/spec thật; checklist và màn hình này không chứng minh model nhận diện đã hoàn thành.

### Kết quả kiểm chứng — 13/10/2026

- Frozen install, peers check, pnpm check và mobile dependency check: đạt; không đổi dependency/lockfile. Web 432/432, Backend unit 293/293, shared client 52/52, contracts 80/80 và root scripts 24/24. Sau chỉnh key danh sách Worker, Web build và 3/3 test workspace chạy lại đạt.
- PostgreSQL test riêng: toàn integration suite 136/136; nhóm checklist/MF08 liên quan 16/16. Migration chạy trên DB test, không dùng Neon cho automated integration.
- Compose Backend/Web build/readiness đạt; image Web cuối đã rebuild và healthy. Browser desktop 1250, tablet 768, mobile 390: không tràn ngang; dialog Escape/trả focus, điều hướng PPE → Alerts và phân quyền tab đạt trong phạm vi đã kiểm tra.
- Smoke thủ công bằng service thật trên Neon/R2: giao/start/nộp/trả lại/nộp lại/ghi nhận checklist, tạo Incident từ Fail, xác nhận/bàn giao/báo kết quả/ghi nhận/đóng đạt. Dữ liệu tổng hợp nằm trong transaction rollback: 0 record còn lại; 4 object R2 đã xóa và HEAD trả 404. Đây không phải kiểm chứng toàn luồng upload qua HTTP/browser trên Neon.
- DBML đồng bộ schema thực tế: 70 bảng, 735 cột, 234 FK; bản 65 bảng được giữ backup. Nhánh feat/safety-overview-checklists từ main 767c6f8; code chưa stage/commit/push.

Seed demo local được cập nhật và typecheck; không chạy seed vào Neon hoặc sửa account đang test. Neon cần nhóm/lịch/quyền Zone và Site assignment của đại diện theo Workforce hiện tại. Giới hạn kiểm chứng: chưa thêm ca HTTP multipart checklist vượt 5 MiB (validator và tổng dung lượng có unit test); chưa test video/model/mặt AI. Hồ sơ cũ không có snapshot không thể phục dựng danh tính đã bị xóa trước đó.

### Dữ liệu test tay đã giữ trên Neon — 13/10/2026

Đăng nhập Web http://localhost:5173, chọn Site MF08-A (Synthetic MF08-A). Account demo hiện có: mf08.safety.a, mf08.representative.a, mf08.manager.a; mật khẩu lấy từ người chuẩn bị demo, không ghi vào tài liệu Git. Batch dưới đây dùng nhãn DEMO 20261013; không reset account hoặc thay dữ liệu cũ.

Overview chọn Work date 2026-10-13 hoặc 2026-10-14. Height team: 3 Worker có ca 08:00–17:00, Zone và camera cấu hình giả. Electrical team: 3 Worker chưa có lịch, Zone chưa liên kết camera. DEMO Worker 7 chưa thuộc nhóm. Hai nhóm thuộc Synthetic contractor A. Checklist có khoảng làm việc 14/10/2026 08:00–17:00, quyền Zone demo phủ đến 14/11/2026 00:00 giờ Việt Nam.

| Mẫu | Trạng thái / thao tác nên thử | ID để đối chiếu batch |
| --- | --- | --- |
| DEMO 01 | Assigned → đại diện Start checklist / Submit checklist | d3835271-9eb3-4e55-9a3d-3752c197c7ee |
| DEMO 02 | In progress → nộp kết quả và minh chứng của bạn | 605073c1-f99b-4025-a9a3-614612e86b9b |
| DEMO 03 | Submitted → Safety Request update hoặc Record checklist | 45ac81f0-949b-4612-b200-3de14ad0eae8 |
| DEMO 04 | Returned, In progress → xem history rồi đại diện nộp lại | fa678676-b86f-422c-ac88-55d7ebfb4352 |
| DEMO 05 | Accepted, mọi mục Pass → mở PNG/PDF tổng hợp | d0ea1a50-b2e4-4b9e-96dd-2a4d2a7141e3 |
| DEMO 06 | Accepted, một mục Fail → xem Incident nguồn đã tạo | a3ed2b24-df2b-4470-a397-e609065241d5 |
| DEMO 07 | Incident Assigned → đại diện Start handling / Report handling outcome; Safety ghi nhận/đóng | 9bc7ec77-ef7a-4956-9971-05605371d4e3 |
| DEMO 08 | Incident Open, Worker/nhà thầu unknown → Safety xác minh trách nhiệm rồi bàn giao | a7b328e2-04b5-451f-aa72-c4108b2e4122 |

Minh chứng là 4 PNG tổng hợp và 1 PDF ghi rõ không phải chứng chỉ thật, được giữ private trên R2 cùng hồ sơ. Đại diện demo đã được bổ sung Site assignment còn thiếu cho nhà thầu hiện có; không đổi role/login/password. Team IDs: Height e8781e81-0b57-4552-af69-32e3e6f0ec9c; Electrical 46f3639d-e71c-43c0-9ebc-efaf4fba7c0d. Site ID a6951c57-5a05-46f0-a1ab-feaf9548ca17. Khi dọn sau này chỉ đối chiếu batch này và reference của nó; giữ hồ sơ cũ, không xóa toàn Site/bucket.

Kiểm chứng lượt seed: command nghiệp vụ tạo 6 checklist + 2 Incident với audit/notification. HTTP đăng nhập/Overview/list/detail đạt; Safety và đại diện mở PNG/PDF 200 và no-store; đại diện mf08.representative.b đọc hồ sơ/ảnh/Incident Site A bị 403. Returned giữ lịch sử; Accepted vẫn giữ Fail; nguồn checklist và handover đọc đúng scope. Logout các phiên kiểm chứng; seed chạy trực tiếp từ stdin, không để lại script/log/file ảnh tạm trên máy. Không chạy lại gates toàn repo vì lượt này chỉ thêm dữ liệu demo và đoạn hướng dẫn, không đổi code/schema.

## Phase 1 — Overview và scope đại diện, 14/10/2026

Đại diện được kiểm tra bằng contractor_representative_assignment theo user + Site + contractor, kèm account/role/participation hiện hành. Grant toàn cục cũ không tự cấp quyền tại Site khác. Quy tắc áp dụng cho assignee lookup, Incident/checklist/evidence và notification MF08; không đổi quyền duyệt chấm công hoặc phân lịch.

Overview có GET safety-overview/contractors theo date/timezone dành cho Safety, Manager cùng Site và global Admin. Query safety-overview bổ sung unassignedOffset/unassignedLimit độc lập offset/limit của đội. Các response đội/Zone/camera có attentionAlertCount; đội có checklistSummary; overview có updatedAt. Chỉ đọc các tổng hợp này không cấp quyền đọc chi tiết Alert cho Manager.

Related alerts đếm Alert duy nhất có observation trong ngày chọn, trạng thái Pending review/Needs more evidence/Confirmed, chưa thuộc Incident Closed; ngữ cảnh đội lấy từ Zone grant tại thời điểm observation. Hai đội cùng Zone có thể cùng được đánh dấu; Safety vẫn phải xác minh danh tính/trách nhiệm. API Alert nhận contextTeamId + khoảng capturedFrom/capturedUntil và attentionOnly; cùng điều kiện được dùng cho bộ đếm và danh sách. Dữ liệu cấu hình camera hiện tại không chứng minh hiện diện thực tế.

Checklist summary phân biệt chưa giao (đội có lịch nhưng không có checklist chưa hủy giao ngày đó), chưa nộp, cần bổ sung, chờ ghi nhận, recorded còn Fail hoặc không báo Fail. Past planned start đánh dấu Assigned/In progress/Submitted đã qua startsAt. Không kết luận một checklist phủ mọi công việc của đội, không tự cho phép/chặn làm việc. List checklist hỗ trợ teamId/fromDate/toDate/timezone. Overview có Refresh và poll 30 giây khi tab hoạt động/trang hiển thị.

Test tay: Safety/Manager chọn Site/ngày/nhà thầu; xem riêng từng trang Worker chưa có nhóm; Safety bấm View related alerts hoặc View checklists for this date, kiểm tra số lượng và Back to overview. Nhà thầu khác Site không được xuất hiện trong lookup hoặc đọc hồ sơ/ảnh/thông báo. Bộ demo tiếng Việt được chuẩn bị riêng, giữ hồ sơ tiếng Anh đã test.

Chưa làm lịch tuần, hồ sơ/chứng chỉ nhà thầu, chặn cổng/chấm công, sửa lịch sử MF03/MF07 hoặc tích hợp MF01 mới. DBML giữ 70 bảng; các badge/filter là dữ liệu suy ra, không thêm bảng.

### Bộ demo tiếng Việt giữ lại — 14/10/2026

Site **DEMO-ATLD-VI — Công trường mẫu – An toàn trước công việc**, ngày 14/10/2026. Safety/Manager dùng account mf08.safety.a / mf08.manager.a; hai đại diện: demo.son.vi và demo.dien.vi. Mật khẩu chỉ trao trong chat, không lưu trong tài liệu Git. Có 2 nhà thầu, 3 đội, 8 Worker, lịch 14–16/10, 2 Zone, 1 camera cấu hình mẫu. Hai đội Sơn/Điện dùng chung Zone và cùng thấy 2 cảnh báo liên quan; đội dụng cụ có lịch nhưng chưa giao checklist.

6 checklist MẪU 01–06 lần lượt mới giao, đang làm, chờ review, trả lại, recorded không Fail, recorded còn Fail. Incident MẪU 07 đang giao nhà thầu Điện; MẪU 08 chưa xác định trách nhiệm. 5 object PNG/PDF R2 có nội dung tiếng Việt ghi rõ dữ liệu giả. Các Alert không có frame camera thật.

Danh sách ID của batch để dọn sau này (không xóa Site cũ):
```json
{
  "site": {
    "id": "78515b67-1190-4776-9d95-836d25060b8c",
    "code": "DEMO-ATLD-VI",
    "name": "Công trường mẫu – An toàn trước công việc"
  },
  "representatives": [
    "demo.son.vi",
    "demo.dien.vi"
  ],
  "teamIds": [
    "36ea7736-fd83-418b-835e-2c6b37c861ff",
    "5b88da84-eb8a-48f5-b266-287c4c640855",
    "18ef51e9-e63c-4122-b9f0-5970000397d8"
  ],
  "checklists": [
    {
      "id": "0c2d1999-d367-4c3b-89dc-e505eb5cee3a",
      "name": "MẪU 01 – Sơn trên cao: mới giao, chờ nhà thầu bắt đầu"
    },
    {
      "id": "2cbbf956-67ef-4a16-af93-c77fc7c42a7a",
      "name": "MẪU 02 – Điện tầng 3: đang chuẩn bị dụng cụ"
    },
    {
      "id": "69ab1429-8cb5-4be5-a89c-14612e1c1818",
      "name": "MẪU 03 – Sơn trên cao: đã nộp, chờ Safety xem"
    },
    {
      "id": "481cd79e-c12d-43fb-ab16-6fafab432e8a",
      "name": "MẪU 04 – Điện tầng 3: cần bổ sung minh chứng"
    },
    {
      "id": "db4381c0-6adc-4299-81cd-db4723278a80",
      "name": "MẪU 05 – Sơn trên cao: đã ghi nhận, không báo thiếu sót"
    },
    {
      "id": "024a4a07-49aa-4aa2-87ca-e1345a2d0679",
      "name": "MẪU 06 – Điện tầng 3: đã ghi nhận, còn thiếu găng cách điện"
    }
  ],
  "incidents": [
    "55587816-788a-44e4-949f-a448cc377656",
    "111b2c02-3d65-43d6-97f4-43731e23f2d5"
  ],
  "alerts": [
    "31216596-9a74-4a5e-af47-c49ff0f1fa16",
    "1243d20a-d419-4b0e-87c2-63db5e230ed1"
  ],
  "retainedR2Objects": 5
}
```

### Kiểm chứng Phase 1 — 14/10/2026

- PostgreSQL test riêng: 20/20 test integration/HTTP liên quan đạt; gồm scope theo Site, thu hồi quyền, phân trang độc lập, summary/drill-down, retry và luồng MF08 hiện có. Hai regression cuối đã quan sát lỗi trước khi sửa: checklist Cancelled làm lệch tổng và deep link giữ bộ lọc Overview cũ.
- Web: 30/30 test của SafetyWorkspace, SafetyWorkflow và SafetyAlertsView đạt. Shared client: 2/2 test checklist/context đạt. Lint các file sửa, typecheck Web/client, build Backend/Web và git diff --check đạt.
- Compose đã build lại Backend/Web; migration exit 0, dịch vụ healthy. Browser desktop: Overview tiếng Việt, drill-down đúng 3 checklist đội Sơn, preview PNG và liên kết PDF hoạt động, không ghi nhận console error trong lượt kiểm tra. Không chạy lại ma trận responsive toàn bộ.
- Smoke API thật trên Neon/R2: Manager đọc lookup 200, Overview có 3 đội/1 Worker chưa xếp đội, hai đội chung Zone cùng thấy 2 Alert; checklist context trả 3 hồ sơ. Hai đại diện mỗi người thấy đúng 3 checklist; đọc chéo nhà thầu và ảnh bị 403. PNG/PDF trả đúng MIME/kích thước và no-store. Các session kiểm tra đã đăng xuất.
- Trong danh sách theo đội/ngày từ Overview, All statuses bỏ hồ sơ Cancelled để khớp summary; chọn Cancelled vẫn xem lịch sử đã hủy. Deep link từ notification/Incident bỏ context cũ.
- Giữ 6 checklist, 2 Incident, 2 Alert và 5 object R2 mẫu tiếng Việt; giữ dữ liệu cũ. Dọn file ảnh/PDF/log tạm của lượt này; ảnh bàn giao ở ngoài repo. Không stage/commit/push.
- Không chạy lại frozen install/peers/pnpm check/mobile toàn repo ở phase này; các kết quả 13/10 phía trên là lịch sử, không thay cho gate PR mới. Không đổi dependency, schema hay nghiệp vụ MF03/MF07 phân ca/chấm công.

**Lưu ý dữ liệu cũ:** mf08.representative.b còn grant toàn cục nhưng chưa có contractor_representative_assignment theo Site. Account được giữ nguyên; muốn dùng nó xử lý hồ sơ phải phân công đúng Site/nhà thầu qua luồng quản trị. Không tự nhân rộng grant cũ thành quyền mới.

**Test nhanh:** đăng nhập Safety, chọn Site DEMO-ATLD-VI và Work date 14/10/2026. So sánh Sơn/Điện trên Overview, mở View related alerts và View checklists for this date. Dùng demo.son.vi bắt đầu/nộp MẪU 01; Safety ghi nhận hoặc yêu cầu bổ sung MẪU 03; dùng demo.dien.vi bổ sung MẪU 04 và xử lý Incident MẪU 07. Safety ghi nhận bằng Record checklist / Record handling outcome. MẪU 05 có PNG/PDF; MẪU 06 giữ Fail dù đã ghi nhận. Checklist không phải giấy phép làm việc và không tự chặn lịch/chấm công.

### Gate trước khi push — 14/10/2026

Sau yêu cầu chia commit/push: frozen install, peers check, pnpm check (lint/typecheck/test/build) và mobile dependency check đều đạt. Web 434/434; Backend unit 293/293; contract 80/80; client 53/53; root script 24/24. PostgreSQL integration riêng đạt 139/139. Một test Attendance cũ hoàn tất assertion nhưng timeout 5 giây; chỉ đổi ngày 100 schedule trang đầu thành dữ liệu quá khứ để giảm dropdown dư thừa, giữ phân trang 101 bản ghi/assertion/timeout và code nghiệp vụ. Nhóm Attendance 15/15 và toàn gate sau sửa đều đạt.

Đã push 5 commit lên feat/safety-overview-checklists: 6d8c522 (contract/client), b47b2e6 (Backend/migration), fce5735 (Web), 5d6b136 (hướng dẫn vận hành), 6c19269 (fixture test). Bản ghi này giữ local, không nằm trong 5 commit. Không merge main/tạo PR; origin/main hiện 4c7300a, chưa tích hợp MF01 mới. Dữ liệu demo và R2 giữ nguyên.

### Phase 2 — compatible read additions

Safety overview adds GET /sites/:siteId/safety-overview/week (Monday–Sunday, date/timezone/contractorId/teamId/offset/limit), /team-options and /zones/:zoneId/teams. Workforce exports the read query; Site roles and existing Incident/Alert permissions remain unchanged. Team workWindows preserve separate scheduled intervals and membership at shift start. Camera latestEvidence carries only alertId/eventId/index/timestamp for Safety/Admin; bytes use existing authenticated Alert evidence endpoints. Manager receives metadata only.

Checklist firstSubmittedAt is the earliest original submission; linkedIncident is a curated authorized reference or null. Overview summaries separate missing first reports, late first reports, pending Safety review and finding follow-up. Recorded remains receipt, not authorization. No schema/migration, dependency or AI contract changes in Phase 2.

Phase 2 verification 14/10/2026: pnpm check passed (436 Web /293 Backend unit /80 contract /54 client /24 scripts), Expo compatibility passed, PostgreSQL full 140 and final affected 20 passed. Compose ready; desktop/tablet/mobile and synthetic Neon/R2 read smoke passed. No real camera frame/live validation. No commit/push/schema change.
