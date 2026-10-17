# ERD và bằng chứng database

`ERD-Logical.dbml` là bản sao thiết kế human cung cấp trong gói
`2026-10-17-tuan-db-erd-assignment-v1`. Không sinh lại baseline này từ code.

- File gốc: `D:/SEP490/ERD-Logical.dbml`, khớp bản trong gói bàn giao.
- SHA256 gốc: `0971e449f309bd6fad35b0dbf7a66876ef0e2677f2a9fbcbff15a332b734f370`.
- SHA256 bản repository: `4ccc85f7eb348492eaa8b5d402d03e83ad109c4b8f55929fb0e269f66eeb125f`.
- Khác biệt chỉ là LF và trailing whitespace, theo đúng bản Root đã chuẩn hóa;
  parser đếm 70 bảng,735 cột,234 FK và152 named CHECK expressions.
- File gốc/Downloads không được sửa. DBML là thiết kế, không phải migration hoặc
  một lệnh restore. Comment trigger/function không được DBML thực thi.

## Hồ sơ Tuấn ngày 17/10/2026

- [Baseline và ownership](tuan-db-erd-baseline.md).
- [Audit và các quyết định cần chốt](tuan-db-erd-audit.md).
- [Mapping dự thảo](tuan-db-erd-mapping.csv): đề xuất, không phải tên đã duyệt.
- [Literal consumers](tuan-db-erd-consumers.csv): vị trí source/test/DDL của các
  tên vật lý và cột; cần đọc kèm symbol/dynamic-reference caveat trong audit.

Mỗi báo cáo có source SHA/profile riêng. Metadata/source comparison không chứng
minh catalog đang vận hành, dữ liệu thật, trusted identity hoặc quyền production.
Giữ kết quả quan sát riêng; không thay ERD gốc bằng snapshot của implementation.
