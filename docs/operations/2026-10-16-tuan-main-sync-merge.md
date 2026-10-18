# Ghép Main-sync vào Backend của Tuấn — 16/10/2026

Trạng thái: tích hợp local, có các gate còn mở bên dưới; chưa push/deploy hoặc merge vào main.

## Chiều và phạm vi

- Nhánh đích hiện tại: `feat/tuan-mf05-mf06-backend`, parent `907b4ca641b70e73c06ae0759e1d3cc694a921ab`.
- Nhánh nguồn: `feat/mf05-mf06-main-sync`, parent `675d29ee5b30f1bc0c00902ece5e10a48c44311d`.
- Giữ Backend/Team authority của Tuấn; nhận UI/client/session/i18n/MF03 và dependency từ nhánh nguồn. Không tự redesign UI hoặc sửa public DTO ngoài merge.
- [Báo cáo Backend v4](mf05-mf06-tuan-backend-report.md) là bằng chứng lịch sử trước merge; các kết quả dưới đây kiểm tổ hợp mới.

## Resolve conflict

| Nhóm/file                                        | Quyết định                                                                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `database/typeorm.options.ts`                    | Union59 migrations: giữ Team history, thêm AttendanceAbsence, ShiftExitGracePeriod, AttendanceExitNotifications. Không đổi tên migration đã áp. |
| account-face và camera-configuration-image tests | Giữ canonical owned schema, current attributed callers và asserts; cập nhật registry59.                                                         |
| canonical-main-migrations test                   | Giữ fixture release54 thật sự; thêm cả Team và MF03 vào phần nâng cấp. Kiểm tên/columns/data, không chỉ đếm.                                    |
| erd-migrations test                              | Giữ prefix trước ERD để không kéo migration phụ thuộc vào baseline cũ; giữ preservation/downgrade assertions.                                   |
| mf03-attendance test                             | Giữ các ca absence/exit/concurrency từ nguồn và schema test riêng; đăng ký cleanup trước initialize, tránh xóa tay audit.                       |
| mf07-scheduling-queries test                     | Một fixture canonical trong từng test; giữ scope và response Shift mới.                                                                         |
| neon-legacy-seven-upgrade test                   | Giữ đúng7 migrations đầu; nâng thêm52 để đạt59; rollback control giữ nguyên.                                                                    |
| LOC exceptions                                   | Giữ nội dung của cả hai nhánh.                                                                                                                  |

Runtime-close/recovery assertions cũng đổi sang registry59; MAIN37 lịch sử thiếu22 migrations. Không thay số đếm lịch sử7/24/35/54 để làm xanh test.

## Kiểm chứng

- Frozen install: PASS, dùng đúng lockfile nhánh nguồn; peers check PASS.
- Focused real-PG:22PASS/0FAIL/0SKIP, gồm bốn profile upgrade, Team V1/pre-journal, Camera, Face/account, attendance reports và MF03/MF07.
- Schema/metadata:9PASS/0FAIL/0SKIP, gồm strict0DDL drift.
- Root `pnpm check`: PASS (lint, typecheck, test và build); Backend unit832cases,830PASS/0FAIL/2SKIP. Hai ca conditional được kiểm riêng với pinned Main/connection metadata:2PASS/0FAIL/0SKIP.
- Web:158files/1516PASS; contracts144PASS; API client701PASS (runner hiện có gồm cả source/dist); root scripts25PASS. Không cộng các suite chồng lặp thành số coverage riêng biệt.
- Infra validation/shutdown/load-profile:33PASS/0FAIL/0SKIP; private evidence Compose validator PASS.
- Mobile dependency check online: PASS, dependencies up to date.
- Compose Backend riêng:59 migrations, non-root, live200/ready200; project smoke đã dọn. Không bật AI.
- Qualified Linux image: `sha256:a176f5021c49a66f17ca018ad549bb65b9bfe4339fa14006429e8be81ba46938`.
- Full PostgreSQL integration:1070cases,1069PASS/1FAIL/0SKIP,1213.76s. Lỗi duy nhất là deadline liveness/readiness ở lần start native thứ hai sau restore (`start(restoredMedia)`); không phải assertion mất dữ liệu. Chạy lại chính ca đó:1PASS/0FAIL/0SKIP,24.42s, giữ nguyên timeout/assertions. Chưa xác định được nguyên nhân deadline không ổn định trên Windows; không gọi lượt full này là PASS.
- MAIN37 và Linux recovery PASS trong lượt full. Strict Workforce:22PASS/0FAIL/0SKIP,53.25s. Kiểm lại toàn bộ ba recovery:3PASS/0FAIL/0SKIP,107.74s; native canonical27.90s, MAIN37 27.50s, Linux50.78s. Các lượt này không thay thế kết quả lượt full ban đầu.
- Review độc lập các resolution và kết quả cuối: không có finding mới chặn local merge; giữ OPEN gate nâng cấp populated56 và nguyên nhân timeout native chưa xác định.

Receipts/log nằm trong `docs/local/tuan-mf05-mf06-execution/merge-*` (gitignored), chỉ dữ liệu synthetic. Đã kiểm không còn isolated schema và dọn đúng PG project `smartsite-tuan-mf05-merge-test` loopback5433 cùng bốn runtime Linux đã dừng, theo ID/nhãn/image đã xác minh. Giữ các receipt/dump/media synthetic; không đụng tài nguyên demo hoặc DB vận hành.

## Gate nâng cấp DB còn mở

**P1 trước deployment:** upgrade DB đã chạy Tuấn56 và có notification CHECKLIST bị `AttendanceAbsence1792022400000` từ chối với23514 ở `chk_notification_event`. Đã tái hiện bằng PostgreSQL thật, nguồn Checklist byte-pinned từ parent907b4ca. Transaction rollback giữ nguyên toàn bộ notification rows và56 history records.

Fresh59 và các fixture release54/Main35/legacy24 PASS không chứng minh trường hợp populated56 này được hỗ trợ. Không xóa notification, fake journal hay sửa migration đã áp để né constraint. Cần đường nâng cấp tương thích được owner review trước khi chạy trên DB đó; bản merge local không thực hiện nâng cấp DB vận hành.

Nhánh nguồn còn chứa body Checklist đã thay đổi từ Main3ce; DB56 đã apply body cũ không tự chạy lại. Giữ provenance của cả hai parent và kiểm riêng lịch sử đã áp khi thiết kế rollout. CI/team review, production TLS/retention/secrets, trusted consent/identity và target load/soak vẫn là gate riêng.
