# Báo cáo Backend MF05/MF06 — Tuấn

Ngày kiểm chứng: 2026-10-16. Trạng thái: **BACKEND V4 ĐÃ TRIỂN KHAI/KIỂM CHỨNG; GATE ĐÓNG TOÀN BỘ TASK CÒN OPEN**. Báo cáo phần mềm không thay thế nghiệm thu của leader/owner.

## Nhánh và phạm vi

- Repo `smartsite-sep490/smartsite`, nhánh `feat/tuan-mf05-mf06-backend`, upstream `origin/feat/tuan-mf05-mf06-backend` được giữ nguyên.
- Nhánh được fast-forward từ `d55e7e7` tới bundle v4 `64b64926ea8f4089deb27635d8425b47b4332e62`; không sửa `main`, reset hay force-push.
- Fetch cuối phát hiện `origin/main` đã có `3ce035888d18b61f8b70bd7c1eada4ae8d799d74` (MF03#62). Bằng chứng dưới đây thuộc baseline v4 + các commit Backend trên nhánh này; chưa chứng minh tổ hợp với main mới. Không tự merge ngoài phạm vi đã duyệt.
- Upstream được quan sát đã tới `dc72566` trong lúc làm; phiên thực thi này không gọi push. Các commit sau đó vẫn local khi ghi báo cáo.
- Commit range triển khai/kiểm thử sau bundle: `64b6492..776ce06`; báo cáo và fixtures bàn giao nằm trong commit tài liệu tiếp theo. Các sửa được chia thành commit theo hành vi, không squash toàn bộ thành một thay đổi.
- Các sửa sau baseline nằm trong Backend, test, tài liệu và hai sửa công cụ kiểm chứng. Không sửa UI/shared client/Python, không nâng dependency, không push/merge/deploy hay nhắn leader.
- Public DTO/error enums và canonical cross-service contract giữ nguyên. `contracts/package.json` chỉ bổ sung copy schema vào output test sạch.

## Mapping T0–T5 / S1–S6

| Phần       | Kết quả triển khai                                                                                                                                                                                                         | Bằng chứng và giới hạn                                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T0         | Baseline bundle/hash, frozen install, upstream, môi trường PG18 test riêng tại loopback5433. Sửa hai assertion 54→55; registry hiện tại là56 sau migration mới.                                                            | Fresh, release54, approved main35 và Legacy24 upgrade; không đổi fixture lịch sử54, migration cũ hoặc journal.                                                                                           |
| T1 / S1–S2 | Registered options route dùng query service có revalidation trong transaction. Logout/role/deactivate/grant race không trả metadata cũ. Giữ quyền Site/Camera/Region của Admin và Zone/Contractor của scoped Site Manager. | Actual AppModule + canonical PostgreSQL; allowed/denied/cross-Site/missing/revoked/password cases. Configuration image/hash/dimensions/freshness/budgets và evidence được kiểm bằng synthetic transport. |
| T2 / S3    | Bổ sung journal cho Team, Membership, Team Permission và assignment `zone_ids`; năm Team command được capture cùng transaction. Chặn13 mutation entry point tương thích cũ khi canonical/partial journal hiện diện.        | Real command/fact/witness, rollback, revocation, populated upgrade, pre-journal/headless continuity, V1/V2 immutable replay. Không tạo consent thật, backfill quyền hoặc bật READY.                      |
| T2 / S3    | Giữ assignment/participation/interval/DENY semantics; public permission timestamp route dùng lõi PostgreSQL chính xác. Date grants clip và lưu microseconds trong PostgreSQL, retry không thêm audit/policy.               | Có HTTP scope/mixed-role, logout-before-claim, one-microsecond, audit failure rollback và concurrent revoke. Thiếu trust vẫn UNAVAILABLE.                                                                |
| T3 / S4    | Reuse pipeline hiện có: binding, atomic ingestion/enqueue, duplicate/conflict, finite admission, lease/CAS/reclaim, immutable append/finalize, retry/cancel/drain và scoped request/history API.                           | PostgreSQL thật, synthetic/private harness; không gọi model/camera/paid API. SYNTHETIC_TEST không được công bố thành trusted record.                                                                     |
| T4 / S5    | Migration mới additive; ORM metadata khớp schema canonical với **0 DDL drift**. Recovery DB + private media dùng native client hoặc đúng container PG test đã kiểm ownership.                                              | Hash/decode, missing/corrupt controls, private authorization, immutable replay, schema preservation. Logical restore không chứng minh khôi phục secrets/ACL production.                                  |
| T5 / S6    | Actual main, DB readiness/recovery, response loss/restart, native app.close drain và Linux SIGTERM; Docker build, Compose Backend readiness smoke.                                                                         | Windows forced kill được ghi là crash/quiescence; không dùng làm bằng chứng Linux graceful shutdown.                                                                                                     |

## Các lỗi thực tế đã sửa

1. Options HTTP route cũ không dùng query service revalidate bearer sau I/O/transaction claim.
2. Timestamp permission route chưa dùng lõi so sánh/lưu thời gian chính xác đã có trong repo; Admin không được bypass scoped Site Manager khi nối lại route.
3. Date clipping bằng JavaScript Date làm rộng participation bắt đầu `.000001` thành `.000000`. Clipping, containment và lưu nay thực hiện trong PostgreSQL; response Date hiện hành được giữ nguyên.
4. Tạo Contractor không truyền optional `code` qua route thật trả500. Main command nay giữ generated-code behavior.
5. Hai request chuẩn bị Worker cùng account có thể trả409/201. Retry toàn transaction đã rollback một lần cho đúng hai natural-key23505; collision thật vẫn409.
6. Legacy writer entry point còn ghi canonical business state mà không có attributed command. Triggers đầy đủ vốn ghi unattributed gap; guard nay từ chối cả partial journal, không bịa actor.
7. Review phát hiện kiểm tra linked Worker dùng connection ngoài transaction. Đã dùng cùng manager; regression với pool một connection tái hiện timeout trước sửa.
8. Load preflight kiểm tên biến preview cũ. Đã kiểm đúng `SMARTSITE_AI_PREVIEW_SOURCES`, không nới throttling.
9. Team grant cũng mất microseconds qua Date, khiến PostgreSQL từ chối interval hợp lệ với23514. Nay clip/lưu/so sánh retry chính xác trong PostgreSQL; giữ constraint DB, replacement và revoke. Có regression parent1µ và retry đổi1µ.

## Migration và rollback

Migration mới: `Mf06TeamAuthorityHistory1792281600000`, nằm sau `SafetyChecklists1792195200000`; canonical registry từ55 lên56.

- V1 source inventory/function bodies dùng trong migration đã áp được giữ nguyên. V2 có18 nguồn và archive format riêng; V1 archive/hash/mask cũ vẫn đọc lại được.
- Source registry và assignment mask được mở rộng có chủ đích; business rows, facts và artifacts cũ được kiểm preservation.
- Upgrade continuity chỉ dùng baseline đã witnessed/committed của đúng registry và current transaction; không xóa gap hoặc sửa revision quá khứ.
- Baseline cũ không tự chứng minh V2 coverage. Commissioning/manifest/cutover đủ trust vẫn cần owner duyệt; trước cutover hoặc gặp gap trả UNAVAILABLE.
- `down` migration mới từ chối thao tác mất dữ liệu. Khôi phục bằng backup đã kiểm hoặc forward-fix; không fake migration history, sửa migration cũ hay bật synchronize.

Thứ tự ghép: review code/migration → backup theo môi trường sở hữu → chạy đủ migrations tới56 → kiểm readiness → dùng UI với contract/feature flags được duyệt. Đây là hướng dẫn thứ tự, chưa thực hiện deploy.

## API/fixtures cho leader ghép UI

Không thêm endpoint hay DTO để demo. Prefix giữ `/api/v1`.

| Route                                                                                       | Ghi chú                                                                                                              |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /sites/:siteId/cameras/:cameraId/configuration-image`                                  | Admin, source allowlist, no-store; source unavailable503 và revision conflict409 được giữ.                           |
| `GET /sites/:siteId/access-setup`                                                           | Metadata/capabilities theo role + scope hiện tại; kiểm lại bearer trước khi trả.                                     |
| `POST /sites/:siteId/access-setup/contractor-zone-permissions` và `/dates`                  | Chỉ scoped Site Manager; requestId retry giữ bản ghi đã commit.                                                      |
| `POST /sites/:siteId/access-setup/worker-zone-permissions`                                  | Admin hoặc scoped Representative có đúng Contractor grant; phải có approved finite assignment và Contractor ceiling. |
| `POST .../contractor-zone-permissions/:id/revoke`, `.../worker-zone-permissions/:id/revoke` | Role/scope tương ứng; response `{ id }`; repeat không tạo side effect lặp.                                           |
| `GET /sites/:siteId/mf06-assessment-requests`, `.../:requestId`                             | Admin hoặc scoped Safety Officer, pagination/status/provenance theo canonical contract.                              |
| `GET /sites/:siteId/mf06-assessments`, `.../:assessmentId`                                  | Cùng scope; không suy current permission từ assessment lịch sử.                                                      |

Hai [JSON ví dụ độc lập](../examples/mf06/README.md) từ gói v4 đã kiểm lại bằng parser hiện tại, bao gồm từ chối trường thừa. Chúng không phải DB seed hay evidence. Consumer contract suite có144 ca; UI vẫn cần integration/browser review của leader.

Supplied/reset password dùng ngay; tự đổi mật khẩu là tùy chọn. Tài khoản thực sự có `must_change_password=true` vẫn bị giới hạn theo guard hiện hành. Đừng đổi guard để khớp fixture cũ.

Replay dùng khóa `requestId`/`commandId` hoặc natural key của từng command. Endpoint tạo Contractor với mã tự sinh không có khóa idempotency trong contract hiện hành: nếu mất response, UI cần đọc lại trước khi tạo tiếp; không tự retry mù. Bổ sung một khóa cho endpoint này cần review contract phối hợp riêng.

## Kết quả kiểm chứng

Số ca dưới đây giữ theo từng lượt thực tế; không cộng các lượt nhỏ thành số ca của một suite.

- `pnpm install --frozen-lockfile`: PASS; pnpm12.4.2, lockfile không đổi.
- `pnpm peers check`: PASS.
- `pnpm build` cuối:exit0,5 task thành công (Backend, contracts, Web, Mobile và task phụ thuộc),8963ms; peers check cuối PASS.
- Metadata + account/immutable storage:31PASS/0FAIL/0SKIP, gồm strict0DDL assertion.
- Permission/date/legacy boundary/concurrent revoke cuối:71PASS/0FAIL/0SKIP.
- Exported software snapshot + independent PG dump:3PASS/0FAIL/0SKIP.
- Domain unit pack sau cập nhật test double:45PASS/0FAIL/0SKIP.
- Hạ tầng private evidence/shutdown/load preflight: kiểm cấu hình PASS;20 test PASS/0FAIL/0SKIP.
- Root demo/runtime script tests:25PASS/0FAIL/0SKIP; ca WMI Windows đọc đúng process kiểm thử được chạy với quyền đọc cần thiết.
- Backend unit cuối trong `pnpm check`:809 ca,807PASS/0FAIL/2SKIP. Hai ca yêu cầu explicit metadata/source được chạy riêng:2PASS/0FAIL/0SKIP; không cộng thành tổng suite mới.
- `pnpm check` cuối: exit1 tại Web; lint/typecheck PASS, Backend0FAIL, contracts144PASS. Web1437PASS/7FAIL ở4 file, cùng nhóm lỗi đã thấy trên baseline v4. Vì lệnh dừng tại test Web, không đánh dấu root check PASS.
- Integration tổng tại `fd9deb6`:1064/1064PASS,0FAIL/0SKIP/0CANCELLED,930565ms,exit0. Dùng graph đã compile từ source cuối và chính standard runner `node apps/backend/scripts/run-tests.mjs --integration`; không xóa output trong lúc unit suite đang đọc. Lệnh wrapper `pnpm --filter @smartsite/backend test:integration` đã chạy ở lượt trước và các lỗi được sửa trước lượt này.
- Runtime tại `776ce06` bổ sung fault injection TCP riêng cho actual main:8/8PASS,0SKIP, gồm DB disconnect→503/live200→restore200 trên cùng process. Bootstrap dùng direct owned-schema URL để không chặn event loop của proxy. Đây là lượt kiểm file bị đổi sau1064case, không cộng thành một lần chạy1065case.
- Gate CI Workforce dùng standard runner `--integration --strict-workforce`:22/22PASS,0FAIL/0SKIP,39165ms; deprecation vẫn được coi là lỗi.
- Review độc lập cuối: không còn actionable finding trên thay đổi thuộc nhánh. Review này không thay thế review của thành viên team hoặc kiểm tổ hợp main mới.

Compose smoke dùng project riêng `smartsite-tuan-mf05-smoke-20261016`, Postgres tmpfs tại15432 và Backend19192. Migrate exit0,56 migrations; live200/ready200, Backend non-root. Chỉ Backend/migrate/Postgres được khởi động; đã `down` đúng project sau kiểm tra. Sau toàn bộ suite, xác nhận0 isolated schemas còn lại và `down` đúng project TestPG5433 tự tạo; image/receipt local được giữ để tái lập.

Recovery dùng image runtime và qualified image local, không pull hay deploy. Immutable qualified image `sha256:53d5ff1c4985ae6500c0e91a0d3be6ca1923cf6289f6c08f5e68fcc2ce90851f` chứa production source cuối; các commit sau chỉ sửa test/tài liệu. Ba profile đã PASS trong lượt1064case: canonical56/90tables, pinned main37/63tables negative-readiness và Linux canonical56/90tables, mỗi profile2media synthetic.

## Load đã đo và phần chưa nghiệm thu

Smoke load trên Linux Backend container512MiB:20 actor synthetic có login thật,15s warmup +300009ms đo,400/400 HTTP200; không throttle, timeout, network error hay unexpected5xx. Dataset do seeder kiểm:10 Site/100 Camera/200 Zone/1000 Region/10000 event. Không tắt/nới rate limit.

Các route đo là cameras/sites/camera-detail/zones, p95 tương ứng102/89/111/122ms; backend PID1 RSS lấy mẫu khoảng141–145MB. Linux SIGTERM sau load exit0/non-OOM trong705ms. Receipt thuộc image đã đo, trước các sửa route quyền cuối; không gán số liệu này thành benchmark mọi endpoint của image cuối.

Đây là closed-loop software smoke5phút, không phải NFR30phút/2giờ, mô hình browser workload, capacity production hay độ chính xác/FPS detector. Host/GPU và cấu hình target chưa được qualification. Không suy production acceptance từ kết quả này.

## Gate OPEN cần ghi rõ khi báo leader

- Web trên baseline v4:7 test lỗi ở4 file (`worker-routing`, i18n catalog/locale và `AppLayout.locale`), tái hiện ở lượt tổng cuối; không thuộc các file Backend đã sửa.
- Mobile dependency gate: Expo57.0.28/Constants57.0.21/Linking57.0.12/Router57.0.26 lệch patch kỳ vọng tương ứng57.0.30/57.0.22/57.0.13/57.0.28. Không nâng dependency trong task BE.
- Trusted identity/consent thực, đầy đủ writer manifest/commissioning/cutover; source/permission không đủ trust tiếp tục UNAVAILABLE.
- Hosting/TLS/same-origin/private-media routing, secret/key/ACL recovery, retention/hold/deletion policy và owner-approved RPO/RTO.
- NFR load/soak trên target được duyệt; model/GPU/camera thật và cross-repo AI provenance chưa thuộc bằng chứng local.
- CI, review của thành viên team, leader ghép UI/browser và human acceptance. Review agent không thay thế team approval.
- Ghép main mới `3ce0358`: reconcile registry, các migration MF03 và test/contract/dependency liên quan trong một lượt tích hợp được duyệt; không dùng kết quả canonical56 ở nhánh này để khẳng định main mới đã tương thích.

## Lưu ý khi tích hợp main mới

Review tĩnh riêng delta `d55e7e7..3ce0358` chỉ ra các gate cần xử lý trước khi ghép. Chưa chạy suite trên tổ hợp đó:

- Migration MF03 mới `AttendanceAbsence1792022400000` thay `chk_notification_event` bằng danh sách chưa có CHECKLIST events. DB đã có thông báo CHECKLIST có nguy cơ fail ngay bước này, trước migration sau mở lại danh sách. Cần regression upgrade với dữ liệu CHECKLIST thật sự tồn tại và rollout được owner review.
- Main sửa cả `up/down` của `SafetyChecklists1792195200000`, vốn đã có trên baseline v4. DB đã apply sẽ giữ body cũ; cần phân biệt fresh install và populated history, không sửa journal để đồng nhất giả.
- `ShiftExitGracePeriod1792281600000` và `Mf06TeamAuthorityHistory1792281600000` có tên riêng, cùng timestamp. Kiểm registry/thứ tự và preservation; không đổi tên migration đã áp chỉ vì timestamp trùng.
- Main thêm ba migrations và đổi metadata/runtime attendance, contracts/client/UI. Phải kiểm toàn bộ union, schema drift, attendance/scheduling/Team, readiness và recovery sau khi ghép; chỉ cập nhật số đếm migration là chưa đủ.

## LOC exceptions

Owner: Tuấn; baseline `64b6492`, physical lines sau format. Các file lớn có sẵn được giữ trong phạm vi sửa hiện tại, không bỏ assertion hoặc tạo lớp forwarding để giảm đếm dòng. Review độc lập dùng native Codex reviewer; context usage: unknown. Human team review vẫn OPEN.

| Path trong `apps/backend/`                                           | Baseline→cuối | Phạm vi ngoại lệ                                                          |
| -------------------------------------------------------------------- | ------------: | ------------------------------------------------------------------------- |
| `src/modules/workforce/access/site-access-setup.service.ts`          |       509→523 | Exact date clipping/persistence và retry trong transaction hiện có.       |
| `src/modules/workforce/directory/contractor-operations.service.ts`   |       592→603 | Legacy journal guards và cùng transaction manager.                        |
| `src/modules/workforce/directory/workforce-configuration.service.ts` |       757→771 | Legacy mutation guards; không rewrite directory.                          |
| `src/modules/workforce/teams/contractor-teams.service.ts`            |       810→873 | Capture năm writers, precise grant và retry; giữ transaction/locks chung. |
| `src/modules/zones/main-zone-permission-command.service.ts`          |       547→549 | Scoped public Site Manager permission command.                            |
| `test/contractor-operations.service.test.ts`                         |     1782→1787 | Mô hình absent legacy journal, giữ business SQL assertions.               |
| `test/integration/account-face-templates.integration.test.ts`        |       786→799 | Canonical owned fixture và legal Main callers.                            |
| `test/integration/main-authority-baseline.integration.test.ts`       |       843→846 | Assert V2 inventory18 nguồn; giữ preservation checks.                     |
| `test/integration/main-public-zone-permission.integration.test.ts`   |      985→1013 | Thêm denial cho mixed-role/cross-Site.                                    |
| `test/integration/mf01-onboarding.integration.test.ts`               |     1457→1501 | Dùng đúng public Main commands/actors, giữ đầy đủ journey.                |
| `test/integration/mf07-notifications.integration.test.ts`            |       931→934 | Isolated canonical ownership/cleanup.                                     |
| `test/integration/operational-recovery.integration.test.ts`          |      995→1014 | Ba profile restore thực, schema ownership và exact private reads.         |

Trước khi tăng tiếp các service trên, tách responsibility command/query tương ứng trong task được review; các suite lớn cần tách setup/journey dùng chung trước khi thêm scenario mới. Ngoại lệ chỉ áp dụng các delta được ghi, không cho phép tăng chung. Runtime test401 dòng vượt soft target400 nhưng dưới threshold700; giữ coherent actual-main lifecycle và ca outage mới.

Log/receipt chi tiết được giữ trong `docs/local/tuan-mf05-mf06-execution/` (gitignored), không chứa dữ liệu site/người thật. Plan thực thi ở `docs/superpowers/plans/2026-10-16-tuan-mf05-mf06-execution.md`. Khi chia sẻ cho team, gửi báo cáo tracked này và các receipt đã rà soát; không gửi private env/session fixture.
