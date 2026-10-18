# Database design and local implementation

[ERD-Logical.dbml](ERD-Logical.dbml) là baseline70 bảng/735 cột do owner cung cấp;
không được sinh lại từ code hoặc đổi theo catalog quan sát.

- File gốc `D:/SEP490/ERD-Logical.dbml` và bản trong gói Downloads không bị sửa.
- SHA256 gốc: `0971e449f309bd6fad35b0dbf7a66876ef0e2677f2a9fbcbff15a332b734f370`.
- SHA256 bản repository: `4ccc85f7eb348492eaa8b5d402d03e83ad109c4b8f55929fb0e269f66eeb125f`.
- Repo chỉ chuẩn hóa CRLF→LF và trailing spaces trên2 dòng comment rỗng;
  không gọi hai file byte-identical.

Tài liệu bàn giao:

- [Baseline/source/ownership](tuan-db-erd-baseline.md).
- [Audit và khác biệt ERD](tuan-db-erd-audit.md).
- [Mapping38 dòng](tuan-db-erd-mapping.csv), [consumers](tuan-db-erd-consumers.csv),
  [catalog comparison1.234 dòng](tuan-db-erd-comparison.csv).
- [Extension inventory](schema-extensions.md).
- [Kết quả kiểm thử và hướng dẫn gửi leader](tuan-db-erd-handoff.md).
- [File và số dòng](tuan-db-erd-files.csv): tách source tích hợp khỏi phần sửa local;
  số dòng gồm test/fixture/docs, không phải toàn bộ là code runtime mới.

[Observed DBML](tuan-db-erd-observed.dbml) là **generated diagnostic**, từ catalog
PostgreSQL18 schema test owned, graph65: Rootf3aa818 + Main0ef7b69 + TeamV2 và3
migration forward mới. Export gồm89 bảng ứng dụng, cột/PK/FK; CHECK/index/function
chi tiết nằm trong comparison CSV/catalog receipt. Không coi export là bản thiết kế
leader đã duyệt hoặc thay baseline gốc. File generated được miễn giới hạn handwritten LOC.

Implementation chỉ ở local theo yêu cầu Tuấn. Không có migration production,
trust/consent/Face identity thật hoặc thao tác deploy/PR từ lượt này.
