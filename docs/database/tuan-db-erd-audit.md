# Tuấn — audit và mapping dự thảo, 17/10/2026

**D1 SOURCE AUDIT READY FOR REVIEW; D0–D4 CHƯA HOÀN THÀNH.**
Source được đọc là `5984b3270f5325883d77e64415e799c50ceea424`, không phải Root
`0b7fbb5` chưa được chuyển giao. [Phiếu baseline](tuan-db-erd-baseline.md) ghi
đủ pins, ownership và điều kiện tiếp tục. Không có DDL hoặc sửa Backend trong slice này.

## Kết quả đối chiếu

- Manifest gói hợp lệ 8/8; ERD gốc 70 bảng, 735 cột, 234 FK được bảo toàn.
  [Provenance](README.md) phân biệt bytes gốc và bản chuẩn hóa trong repository.
- Registry source hiện tại đăng ký **59 migrations**, inventory authority V2 có
  **18 kinds**. Đây là kết quả tại pin này, không phải số lượng phải giữ về sau.
- CREATE TABLE trong các migration được đăng ký có đúng **19 tên ngoài ERD**
  trong starter CSV. Đây là kiểm kê declaration source, chưa phải catalog sau up/down.
- [Mapping](tuan-db-erd-mapping.csv) có **26 dòng tại source Tuấn** (19 bảng + 7 cột)
  và **12 dòng upstream Main riêng**. Tất cả đang PENDING, chưa dòng nào được duyệt.
  Cột `proposed_approved_name` là tên đề xuất theo template, không ghi nhận approval.
- 12 cột upstream thuộc VisitorRoster: 10 ở `visitor_visit`, 2 ở
  `visitor_gate_event`, quan sát bằng `git show` Main `0ef7b69`; chưa có trong
  working tree Tuấn. Không nhận chúng thành delta MF05/MF06 hoặc xóa để khớp ERD.
- Sáu cột attendance trong starter do Main bổ sung; `face_profile.safety_revision`
  thuộc Safety provenance. Tách ownership này khỏi tranh luận tên `mf06_*`.

[Comparison CSV](tuan-db-erd-comparison.csv) so ERD với metadata được build từ
source Tuấn, **không initialize/connect DataSource**: 73 Entity tables, 796 cột.
Metadata không đại diện đủ các bảng raw SQL hoặc schema đang chạy.

| Hạng mục baseline                        | Bằng chứng hiện tại                                                                             | Chưa được kết luận                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 735 cột                                  | 734 khớp type/nullability sau chuẩn hóa type synonyms                                           | Default/generated expression tương đương trên PostgreSQL      |
| 234 FK                                   | 233 khớp tên, cột, đích, delete/update actions                                                  | Deferrability, validated state và catalog thực                |
| `attendance_schedule_conflict`           | Cột/FK còn lại có CREATE TABLE tại migration `1791676800000-Mf03AttendanceReconciliation.ts:46` | Migration đã chạy thành công; rows còn nguyên                 |
| 152 named CHECK expressions              | Ghi biểu thức ERD và metadata có sẵn                                                            | Semantic equivalence; không suy từ so chuỗi SQL               |
| 102 named index declarations             | Ghi từ ERD cùng metadata tìm được                                                               | PK/UNIQUE-backed, predicate, method và index migration-only   |
| 11 trigger definitions trong comment ERD | Kiểm kê tên                                                                                     | Enabled state, function body, search_path và runtime behavior |

Bảng `attendance_schedule_conflict` được baseline mô tả là migration-only;
không thiếu Entity không tự là lỗi mất bảng. CSV ghi declaration có căn cứ.
Comparison chỉ phủ baseline 70 bảng; definitions/guards của 19 extension phải
được đối chiếu fresh/populated catalog ở D2, không lấy metadata này để đóng gap đó.

## Vì sao giữ riêng và phần nào cần xem lại

Mapping ghi purpose, lý do lưu riêng, quan hệ/caller, rủi ro và câu hỏi từng dòng.
Đề xuất đổi **17 tên bảng**, giữ tên hai bảng consent và các cột. Không đề xuất
thêm bảng hay thay đổi semantics để thực hiện việc naming.

| Nhóm                                   | Đề xuất                           | Lý do và quyết định thiết kế còn mở                                                                                          |
| -------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 4 bảng request/job/assessment/artifact | `zone_entry_*`                    | Binding, lease thay đổi, kết quả bất biến và private archive có lifecycle khác nhau; không đồng nhất với event/alert         |
| 9 bảng authority history               | `authorization_history_*`         | Epoch, revision, gap, receipt và baseline phục vụ historical replay; cần review khả năng giản lược source/control/head       |
| 4 bảng command result                  | Tên nghiệp vụ `*_command_receipt` | Idempotent replay khác mutable business rows; phương án gộp tagged receipt phải là quyết định riêng, có migration/data proof |
| 2 bảng Safety consent                  | Giữ tên                           | Purpose-specific grant/revoke không suy ra từ Face enrollment, Gate hoặc profile tồn tại                                     |

Không có benchmark chứng minh mọi bảng hỗ trợ là cần cho hiệu năng. Đề xuất giữ
hiện trạng bảo toàn compatibility trong lúc owner đánh giá giản lược; không khẳng định
cả 19 bảng đều tối ưu. Gộp/xóa không đi kèm rename nếu chưa duyệt semantics/data strategy.

Source Tuấn `5984b32` vẫn dùng bốn class `Mf06...Entity`; Root public `48f1916`
đã đổi class sang `ZoneEntry...Entity` nhưng physical SQL vẫn `mf06_*`. D2 phải nhận
delta này trước; không tạo bộ Entity song song hoặc hiểu đổi class là đã đổi database.

## Consumers và rủi ro khi triển khai

[Consumer CSV](tuan-db-erd-consumers.csv) có 1.503 vị trí literal/symbol trong
Backend source/tests, gồm migration và fixture lịch sử. Đây là tìm kiếm lexical:
tên cột có thể trùng ở bảng khác; symbol references chỉ bổ sung bốn assessment
Entities. Không phải call graph đầy đủ và không cấp quyền sửa mọi dòng được liệt kê.

- D2 phải đi hết Entity/exports, raw queries, registry, generated SQL functions/triggers,
  ingestion/enqueue/lease/finalize, archive codec/store và scoped HTTP readers.
- `main-authority-function-profiles.ts` và profiles V2 giữ exact function-body hashes.
  Rename SQL cần version profiles được review, không nới preflight hoặc sửa imported
  historical migration code. Source registry, V1/V2 JSON keys, format và stored hashes
  không đổi theo prefix một cách hàng loạt.
- Legacy có `zone_authority_command`, `zone_authority_fact_revision`,
  `zone_authority_history_epoch`, `contractor_zone_access_grant`. Chúng không nằm trong
  release registry nhưng còn archive/fixture/export. Prefix đề xuất tránh các tên đã
  biết; collision và populated upgrade trên legacy catalog vẫn OPEN.
- Frozen fixtures/applied migrations giữ nguyên byte. Recovery test Root đang giữ
  có thể chứa tên vật lý; cần nhận commit/ownership trước cập nhật, không bỏ qua test.
- Giữ IDs/rows/FK/journal/command receipts, immutable replay, event IDs, hashes,
  public API/DTO/error enums và quyền hiện hành. Naming không tạo trust/consent.

## D3: gap đã phân loại, chưa nhận sửa source chung

| Nhóm                           | Bằng chứng và việc còn mở                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Configuration/private evidence | Có implementation/regression trong lịch sử v4; actor/scope phải đối chiếu lại Main/Root mới, không áp matrix cũ          |
| MF06 pipeline/read             | Có enqueue/lease/finalize/read code; worker caller-driven, chưa là scheduler runtime tự động; flags default off được giữ |
| Authority/Face consent         | Giữ Team/V2, gaps/pre-cutover fail closed; captured metadata/STAGING không chứng minh READY hoặc consent thật            |
| Runtime/database               | Cần owned-schema harness và PostgreSQL riêng; Root giữ recovery WIP; chưa có proof runtime trên common baseline          |

**Upgrade gate:** populated graph 56 đã có notification `CHECKLIST_ASSIGNED`
có thể bị `1792022400000-AttendanceAbsence.ts` từ chối khi thay CHECK event thiếu
CHECKLIST. Source vẫn có điều kiện gây lỗi; không chạy lại PostgreSQL trong slice này.
Receipt lịch sử ở `docs/local/tuan-mf05-mf06-execution/` chỉ là bằng chứng cũ đúng
profile/source của nó, không phải fresh pass cho Root/Main mới. Trước khi nhận đường
upgrade này, owner phải review strategy bảo toàn notification/journal, kèm regression
rollback và upgrade thành công. Không sửa byte migration đã apply hoặc xóa rows.

## Quyết định cần leader/DB owner ghi nhận

1. Chọn từng tên trong 17 đề xuất hoặc trả tên thay thế; giữ 2 consent và 7 cột?
2. Giữ cấu trúc trong slice rename hay mở task riêng để giản lược 3 history helpers
   và gộp 4 receipts? Chưa có quyết định thì không gộp/xóa.
3. Chốt source Root chung, delta Main, migration slot và ownership recovery/hooks.
4. Chốt graph upgrade hỗ trợ, đặc biệt populated 56 có CHECKLIST; ai review strategy?
5. Cấp môi trường PostgreSQL riêng và harness chỉ ghi schema owned để kiểm catalog,
   preservation, collision, rollback và API/concurrency trước khi đóng D1–D4.

Approval phải có người duyệt, ngày/ref và mapping version/hash. Inventory này
không thay approval; nguồn Downloads được giữ nguyên để so sánh.

## Kiểm tra lượt này và bàn giao

| Check trên source `5984b32`                          | Kết quả thực tế                                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile --offline`           | PASS; lockfile không đổi, không tải dependency mới                                                          |
| `pnpm peers check`                                   | PASS                                                                                                        |
| `pnpm check`                                         | PASS sau chuyển hai scratch review snapshots vào nơi ESLint đã ignore; không đổi lint rules                 |
| Phạm vi `pnpm check`                                 | Lint + 25 root script tests chạy mới; Turbo replay cache typecheck 7/7, test 6/6, build 5/5                 |
| Backend trong cache                                  | 832 cases: 830 PASS, 2 conditional SKIP; không tính như fresh DB integration                                |
| `pnpm --filter @smartsite/mobile check:dependencies` | PASS, dependencies up to date                                                                               |
| PostgreSQL fresh/populated/catalog/recovery          | NOT RUN / OPEN: Docker Linux engine chưa chạy; không thấy native server; runner preflight chưa schema-owned |
| Compose smoke                                        | NOT RUN: slice chỉ docs, không sửa runtime/container; engine unavailable                                    |

Lượt check đầu FAIL do hai nested review snapshots trong `docs/local` làm ESLint
chọn nhiều tsconfigRootDir; đã chuyển đúng scratch owned directories, giữ dữ liệu,
rồi chạy lại toàn bộ check thành công. Không cộng hai lượt hoặc che FAIL ban đầu.
Logs local: `.superpowers/sdd/2026-10-17-tuan-db-erd-assignment/`
(`install.log`, `peers.log`, `check.log`, `check-qualified.log`, `mobile.log`).

CSV/provenance validation PASS: 38 mapping rows PENDING; 1.503 references khớp
file/line; 1.234 comparison rows; ERD hash và Markdown format khớp.
Review AI độc lập không còn Critical/Important; đã sửa mô tả epoch reader chỉ đọc
metadata, không chứng nhận READY/coverage. Human/Root review và approval vẫn OPEN.

Trạng thái: D0 đã ghi nhận/đợi common baseline; D1 draft source mapping sẵn review,
catalog OPEN; D2 NOT STARTED/chưa approval; D3 audit/historical proof, chưa đóng;
D4 bàn giao tài liệu, chưa acceptance toàn task. Không có API/fixtures/migration
mới, không có thay đổi thứ tự migration hoặc hướng dẫn apply DDL ở slice này.

Tuấn gửi leader link branch và ba file baseline/mapping/audit để ghi quyết định.
Sau approval, nhận Root delta, thống nhất slot rồi triển khai D2 theo từng slice
RED → migration/code → fresh/populated/preservation GREEN → review. Hướng dẫn bước
sau cho Tuấn: khi leader cho phép, mở GitHub New pull request, chọn nhánh Tuấn và
integration target đã chốt; ghi source pins, approval, migration order, API compatibility
và proof; nhờ Root review/ghép Web. Agent không thao tác PR hoặc tích hợp nhánh khác.
