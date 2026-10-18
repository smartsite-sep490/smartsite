# Bàn giao Tuấn — Backend/database/ERD, 17/10/2026

Trạng thái: **implementation Backend local và các software checks áp dụng đã đạt**.
Root review producer/consumer, UAT và production gates vẫn OPEN ở mục dưới.
Không commit/push/PR/deploy; không tự gửi leader.

## Những gì đã làm

| Task | Kết quả implementation                                                                             |
| ---- | -------------------------------------------------------------------------------------------------- |
| D0   | Nhận Rootf3aa818 có ancestor0b7fbb5, ghép Main0ef7b69 và bảo toàn Team/V2 Tuấn                     |
| D1   | Mapping38 dòng; catalog comparison1.234 dòng; consumers và ERD diagnostic tách baseline70 bảng     |
| D2   | Ba migration forward, đổi17 tên bảng/16 function bodies; Entity/SQL/preflight đồng bộ              |
| D3   | Bridge notification; chặn old-name journal bypass; codec polygon tương thích API và archive cũ |
| D4   | Bằng chứng test, review độc lập, checklist tích hợp và nội dung gửi leader trong folder này        |

[Baseline](tuan-db-erd-baseline.md) ghi đầy đủ SHA; HEAD vẫn `7bb4501`, code mới chưa commit.
Mapping do **Tuấn duyệt trong chat**, không gán approval cho Root/leader.

Git local được chuẩn bị dưới dạng merge Root `f3aa818` chờ commit, conflict đã giải quyết.
HEAD/remote vẫn `7bb4501`; Main `0ef7b69` đã ghép nội dung, không phải merge parent riêng.
Các thay đổi được stage để bạn xem bằng `git diff --cached`; chưa tạo commit mới.
Tree trước/sau thao tác Git được so khớp; bản lưu index/tree nằm trong receipts private.
Inventory tách incoming/local được chụp trước lần stage cuối, không phải index hiện tại.

## Migration và dữ liệu

Chạy đúng registry hiện tại, transaction `all`; không chọn lẻ migration giữa hai bridge.
Trước rollout: backup DB/private media đồng bộ và dừng/drain toàn bộ writer của binary
cũ. Physical rename không hỗ trợ chạy lẫn binary cũ–mới; chỉ mở lưu lượng cho binary
mới sau migrate/readiness. Không suy API giữ nguyên thành zero-downtime storage rollout.
Các migration mới được chạy trong thứ tự timestamp cùng pending migrations kế thừa:

1. `1792010000000-PrepareNotificationCompatibility` trước CHECK pending của Main.
2. Các migration Main/Checklist/Team còn pending theo graph thực tế.
3. `1792368000001-CompleteNotificationCompatibility` sau PreserveManagerNotificationHistory.
4. `1792454400000-ZoneEntryPhysicalStorage` sau khi dữ liệu notification đã restore nguyên trạng.

Không sửa60 file migration lịch sử đã có ở HEAD và không fake journal.
Fresh graph65; populated legacy24 có thể giữ thêm1 journal identity lịch sử.
17 bảng chỉ rename, không gộp/xóa: [mapping đầy đủ](tuan-db-erd-mapping.csv).
Hai consent tables, hashes, IDs và machine archive V1/V2 giữ nguyên.
Down mới từ chối rõ; recovery dùng backup DB/media đồng bộ, theo [runbook](../operations/mf06-recovery-drill.md).

## API để leader ghép UI

Không thêm endpoint hay đổi DTO/error enum để phục vụ naming. Prefix `/api/v1` giữ nguyên.
Các journey chính đã có trong source và được kiểm tiếp:

| Journey                                     | Route/contract hiện tại                                               |
| ------------------------------------------- | --------------------------------------------------------------------- |
| Camera configuration image                  | `GET /sites/:siteId/cameras/:cameraId/configuration-image`            |
| Request/job list-detail                     | `GET /sites/:siteId/mf06-assessment-requests`, `/:requestId`          |
| Assessment history list-detail              | `GET /sites/:siteId/mf06-assessments`, `/:assessmentId`               |
| Camera/Region/Zone configuration            | Controller/contract hiện tại; scoped actor và expected revision409    |
| Private evidence/consent/authority commands | Giữ routes hiện tại, scope/revoke/idempotency và fail-closed behavior |

Request/response/error examples: [MF06 examples](../examples/mf06/README.md).
Canonical producer types/tests: `contracts/src/mf06-assessment-api.ts`,
`mf06-request-status-api.ts`, `camera-configuration-image.ts` và paired contract tests.
Synthetic history tiếp tục bị ẩn khỏi public records; không dùng fixture làm Worker identity.

## Kiểm thử hiện tại

| Check                                    | Kết quả                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| Frozen install theo integrated lockfile  | PASS; online retry sau sandbox/offline thiếu cache                             |
| `pnpm peers check`                       | PASS                                                                           |
| `pnpm check`                             | PASS: lint/typecheck/tests/build; Windows CIM cần approved run                  |
| Mobile dependency check                  | PASS; network retry sau sandbox EACCES                                         |
| Backend unit                             | 867 cases:866 PASS/0 FAIL/1 conditional metadata-only SKIP; codec19/19 PASS     |
| Backend PostgreSQL integration           | PASS1105/1105, 0 FAIL/0 SKIP; owned-schema graph65, 1.321,37 giây                 |
| Fresh/Main35/release54/legacy24 upgrades | PASS4/4 focused, không cộng vào full-suite tally                               |
| Notification compatibility               | PASS4/4 focused; full-row preservation và rollback                             |
| Naming/populated archives/receipts       | PASS focused; whole17table/OID + V1/V2 replay và cross-Site refusal            |
| Journal tên cũ                           | RED3/3 trước sửa; GREEN3/3 sau sửa                                             |
| Container build                          | PASS, working-tree source; image rebuilt sau fix review                        |
| Recovery/Linux lifecycle                 | PASS3/3 focused: current/Main37/Linux; actual private replay sau restore        |
| Applied migration/owner ERD preservation | PASS; secret-signature scan không thấy match trong tracked delta               |
| Independent source review                | Hai Important đã sửa và được re-review; không còn Important/Critical được nhận |

Logs/receipts local: `.superpowers/sdd/2026-10-17-tuan-db-erd-assignment/`.
Container/network test đã dọn sau khi xác minh chỉ còn schema `public` rỗng;
images và receipts được giữ local. Chạy lại cần dựng PG test và lấy container ID owned mới.
Các lượt FAIL trước fix được giữ lại; bảng cuối không cộng các focused rerun chồng lặp.
Log còn warning Web chunk size, Expo màu và deprecation của `pg` khi query đồng thời;
không suppress hoặc nâng dependency trong task database. Chưa xác minh tương thích `pg@9`.

[File inventory và số dòng](tuan-db-erd-files.csv) có các cột so HEAD, Rootf3aa818,
index source đã ghép và phần sửa local. `incoming_source_or_merge_resolution` là source
được nhận/hòa giải; không gọi toàn bộ diff đó là code mới viết cho task này.
Inventory không tự đếm chính nó, log private hay snapshot ignored.

Profile recovery cuối dùng Main35 pin `2e98619ac94be775ef43f4cb3076f00a59b88df1`,
PostgreSQL18.6 local và Linux image
`sha256:715561b68a54c9c6ceb291605b923f787aae19ad90cc569d1fdbf88a2883c0f7`.
Linux receipt kiểm90 tables/2 synthetic media, hash/decode, missing/corrupt controls,
scope/logout và replay sau restore; ba process SIGTERM exit0 (khoảng0,56 giây mỗi process).
Main37 là negative compatibility profile: giữ record/guards/media cũ, nhưng API hiện tại
từ chối storage chưa đủ migration bằng503; không gọi đó là trusted history đã publish.
Không bật AI worker. Test full cần `TEST_DATABASE_URL` loopback5433 và các biến
`SMARTSITE_TEST_{SOURCE_REPO,MAIN_SNAPSHOT,PG_CONTAINER,LINUX_RECOVERY_IMAGE}`;
runner tự tạo/drop schema UUID. Không dùng URL DB vận hành để chạy lệnh này.

## Những gì Root/leader cần review

- Migration slots/provenance và mapping17 tên; đây là local implementation chưa được Root review tích hợp.
- Ba CHECK mở rộng Main, ba index DESC khác bản ERD và19 cột mở rộng trên bảng gốc:
  [audit](tuan-db-erd-audit.md) ghi nguồn và lý do bảo toàn, không sửa ERD gốc.
- Paired shared-client/Web consumer, browser/UAT, dữ liệu thực tế và kế hoạch rollout.
- Hosting/TLS/retention/secret recovery/budget, AI/Face/camera thật và load/soak production
  vẫn là gate riêng; test synthetic local không đóng những gate đó.

## Tự commit/push và PR sau khi bạn xem xong

1. Xem `git status`, `git diff --cached`, source/migration/tests/docs và file inventory.
2. Kiểm trạng thái merge local trong báo cáo cuối; không abort/reset nếu chưa lưu thay đổi.
3. Chỉ khi bạn chủ động quyết định: stage các file đã review, commit trên
   `feat/tuan-mf05-mf06-backend`, rồi push đúng `origin/feat/tuan-mf05-mf06-backend`.
4. Nhờ leader chọn base tích hợp (thường nhánh Root `feat/mf05-mf06-main-sync` trong luồng này),
   tạo PR và gửi mapping/test receipts; leader review producer/consumer trước merge.

Agent không thực hiện các bước commit/push/PR/integration sau bàn giao.

## Nội dung gửi leader

> Em đã hoàn thiện phần Backend/database/ERD local theo gói17/10, nhận source Rootf3aa818
> và Main0ef7b69, giữ Team/V2. Có17 physical rename, migration tương thích thông báo cũ,
> mapping/ERD comparison và regression bảo toàn dữ liệu/replay. API giữ nguyên để ghép UI.
> Anh xem folder `docs/database/`, nhất là handoff, audit và mapping; review migration slots,
> các delta Main và paired consumer trước khi tích hợp. `pnpm check` PASS; PostgreSQL
> integration1105/1105 PASS, không FAIL/SKIP; recovery DB/media và Linux SIGTERM đã qua.
> Code đang local để em xem trước khi tự commit/push; chưa có thay đổi mới trên remote.
