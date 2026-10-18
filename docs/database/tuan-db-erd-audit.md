# Tuấn — audit ERD và mapping sau tích hợp Root/Main

ERD gốc70 bảng được giữ nguyên. [Mapping](tuan-db-erd-mapping.csv) có38 dòng:
19 bảng mở rộng, 7 cột inventory cũ và12 cột VisitorRoster kế thừa Main.
17 bảng được đổi physical name theo quyết định của Tuấn; không gộp/xóa dữ liệu.
[Baseline](tuan-db-erd-baseline.md) phân biệt source pins, approval và ownership.

## Đối chiếu PostgreSQL thật

Catalog fresh65 chạy trong schema test owned, gồm89 bảng ứng dụng + journal.
[Comparison CSV](tuan-db-erd-comparison.csv) có1.234 dòng, ghi cả định nghĩa ERD và
PostgreSQL, thay bản so metadata cũ. Không lấy class/Entity coverage làm catalog proof.

| Hạng mục ERD gốc                  | Kết quả                                                               |
| --------------------------------- | --------------------------------------------------------------------- |
| 70 bảng                           | Đủ, tên gốc không đổi                                                 |
| 735 cột                           | Type/nullability/default đều khớp sau chuẩn hóa type synonyms         |
| 234 FK                            | Khớp tên/cột/đích/delete-update; catalog ghi validation/deferrability |
| 152 CHECK                         | 149 biểu thức khớp exact; 3 extension kế thừa Main bên dưới           |
| 102 named indexes                 | 99 định nghĩa khớp; 3 khác hướng sort đã có từ Main                   |
| 11 trigger trong ERD SQL comments | Đều enabled; function/config/definition có trong catalog receipt      |

Ba CHECK khác baseline: `attendance_day_status_check` thêm `ABSENT`;
`chk_notification_event` thêm `ABSENT`, `EXIT_DURATION_EXCEEDED`, `MAX_EXITS_EXCEEDED`;
`chk_notification_role` giữ recipient `SITE_MANAGER` lịch sử. Chúng đến từ Main;
không thu hẹp CHECK rồi làm mất hoặc chặn dữ liệu đã hợp lệ.

Ba index khác hướng sort: `idx_incident_site_order` và `idx_task_site_order`
sort `created_at DESC,id DESC`; `idx_alert_site_last_detected` sort
`last_detected_at DESC`. Baseline DBML không ghi DESC. Giữ index hiện hành, ghi rõ
cho Root/DB owner review; không tự rewrite baseline hay đổi behavior MF08 ngoài task.

19 cột trên các bảng gốc gồm7 cột inventory cũ +12 VisitorRoster. Những cột Main
không thuộc phần rename MF05/MF06. Không xóa attendance/Visitor metadata để ép ERD cũ.
[Observed DBML](tuan-db-erd-observed.dbml) là export chẩn đoán có provenance, không
thay ERD70 bảng và không tự là thiết kế mới được leader duyệt.

## Vì sao giữ các phần mở rộng

- Bốn bảng assessment: request binding bất biến, job lease thay đổi, kết quả bất biến,
  archive quyền bất biến có lifecycle khác nhau; event/alert không thay được chúng.
- Chín bảng authority history: nguồn/cột, command actor, revision/head, gap,
  epoch/control, baseline và commit receipt phục vụ tái dựng và fail closed.
  Không chuyển chúng thành lịch sử quyền đáng tin chỉ vì migration đã chạy.
- Bốn command receipt giữ projection đúng lần ghi gốc khi retry/mất response.
- Hai bảng Safety consent/revocation tách purpose và revoke; không suy consent từ profile.
- Đánh giá gộp helpers/receipts là redesign riêng; Tuấn chỉ duyệt naming và bảo toàn cấu trúc.

CSV ghi riêng purpose, lý do lưu, quan hệ, consumers, đề xuất, data risk và quyết định.
[Consumer inventory](tuan-db-erd-consumers.csv) bao gồm Entity, runtime SQL, SQL functions,
registry, guards nhận diện tên cũ, historical migrations, archive/replay và tests.
Tên `zone_authority_*` legacy được giữ riêng; migration không replace prefix hàng loạt.

## Implementation

1. `PrepareNotificationCompatibility1792010000000`: trước pending CHECK cũ,
   giữ nguyên bản JSONB của notification, tạm đổi4 trường trong cùng transaction.
   Không xóa row; deferred guard cấm commit trước khi restore hoàn chỉnh.
2. `CompleteNotificationCompatibility1792368000001`: sau Main notification repairs,
   restore4 trường và so toàn bộ row/count/XID, xóa bridge objects trước commit.
3. `ZoneEntryPhysicalStorage1792454400000`: rename17 bảng, giữ OID/PK/FK/index/trigger,
   thay đúng16 function bodies có reference physical name theo profile hash đã qualified.
   Từ chối collision, overload hoặc body/attributes ngoài profile; lỗi rollback nguyên trạng.

Giữ nguyên byte migration đã áp và frozen fixtures. Registry hiện tại65 là kết quả
của graph, không phải cách sửa lỗi bằng hạ số lượng. Cả ba migration mới từ chối down
không an toàn; forward recovery dùng bản backup DB/media đã kiểm, không drop dữ liệu.

Runtime Entity/raw SQL/preflight đọc tên mới; V1/V2 machine archive keys, API enums,
hashes và IDs giữ nguyên. Guard vẫn nhận cả tên cũ lẫn mới để từ chối ghi legacy khi
journal đã hoặc mới cài một phần. Không fallback sang schema/tên cũ để đọc dữ liệu.

Codec archive trước đây chỉ nhận polygon dạng mảng, còn API lưu `{coordinates: [...]}`.
Regression đã tái hiện lỗi; codec nay kiểm strict cả hai dạng V1/V2, giữ nguyên payload/hash
và hai trust flags `false`. Recovery kiểm thêm replay qua store thật sau restore;
fixture dùng hash command đầy đủ và native JSON PostgreSQL thay vì hash giả/chuyển timestamp.

## Kiểm chứng và giới hạn

- Fresh/current, populated release54/Main35/legacy24 và old56 Checklist/Main57 Manager
  được kiểm riêng. Journal legacy có thể chứa thêm migration lịch sử; không giả registry.
- Populated rename có completed V1/V2 archives/assessments/jobs và DENY receipt/witness;
  so toàn bộ17 bảng và OID, replay bằng service hiện tại, cross-Site refusal.
- Có collision/tampered function/failed migration rollback, deferred-commit refusal
  và regression cho3 guard journal tên cũ. Không skip lỗi để báo PASS.
- Review độc lập tìm2 finding: guard tên cũ và fixture key tables rỗng; cả hai đã sửa.
- Kết quả full checks/recovery cuối: [bàn giao](tuan-db-erd-handoff.md).

Ngoại lệ LOC cho các file hiện hữu được liệt kê trong [file inventory](tuan-db-erd-files.csv),
cột `size_review`: owner Tuấn; chỉ sửa fixture/SQL naming và thêm regression bảo toàn,
không refactor các suite lịch sử trong task database. Reviewer độc lập đã review phần
implementation/regression trọng yếu; lần mở rộng behavior tiếp theo phải tách suite theo
trách nhiệm. Codec hiện hữu chỉ thêm schema ring dùng chung, không tạo lớp mới.

Root vẫn cần review source/migration slots và consumer integration. UAT Web, dữ liệu,
Face/AI thực tế, hosting/TLS/retention và production acceptance không được suy từ test local.
