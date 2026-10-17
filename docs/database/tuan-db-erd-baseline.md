# Tuấn — baseline và ownership database/ERD, 17/10/2026

Trạng thái: **D0 RECORDED; COMMON BASELINE / ROOT HANDOVER OPEN**.
Gói yêu cầu: `2026-10-17-tuan-db-erd-assignment-v1`; manifest8/8 hashes khớp.
Human đã giao thực thi kế hoạch và cho commit/push duy nhất nhánh Tuấn.

## Source pins

| Nguồn                                                    | Commit đã xác minh                         | Ý nghĩa                                                    |
| -------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| Working branch và upstream `feat/tuan-mf05-mf06-backend` | `5984b3270f5325883d77e64415e799c50ceea424` | Baseline audit, clean khi bắt đầu                          |
| Bundle v4                                                | `64b64926ea8f4089deb27635d8425b47b4332e62` | Nền trước các sửa Backend của Tuấn                         |
| Main sau fetch                                           | `0ef7b6901cde852e5660e8a58f1a194e16ac560a` | Đã fetch, chưa tích hợp vào working tree                   |
| Root public branch sau fetch                             | `48f19167d1f0afdb6649bc0add1d21ab399b1d41` | Không thay thế commit pin của gói mới                      |
| Root pin trong assignment                                | `0b7fbb59979a0c23ac955d394eb9b038f7f1e99d` | Không có trong clone sau fetch; source không nằm trong gói |

Range công việc v4 của Tuấn là `64b6492..907b4ca` (14 commit); merge5984b32
có hai parent907b4ca/675d29e. Không reset hoặc chọn toàn bộ source của Root đè lên.
Root0b7 phải được chuyển bằng commit/bundle và đối chiếu trước shared-code edits.
Audit hiện tại không tuyên bố đã kiểm graph61 của Root hoặc Main mới là runtime.
Fetch trực tiếp SHA `0b7fbb5` cũng bị origin từ chối `upload-pack: not our ref`;
không chỉ là local ref chưa cập nhật.

## Write ownership của lượt này

| Phạm vi                                    | Hành động được nhận                                                   |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `docs/database/`                           | Tuấn: baseline, audit, draft mapping, source evidence, ERD provenance |
| Entity/SQL/registry/migration              | Chỉ đọc; D2 chờ mapping, slot và baseline được chốt                   |
| Team/V2 archive/writers/tests              | Bảo toàn; không copy source15/58 thay phần Tuấn18/59                  |
| `operational-recovery.integration.test.ts` | Root giữ; không sửa song song                                         |
| Contracts/shared CI/Workforce hooks        | Cần ownership/delta phối hợp trước sửa                                |
| Web/shared client/MF08/AI                  | Ngoài write scope này                                                 |

Leader/DB owner duyệt tên và giữ/gộp/bỏ; không có approval trong assignment.
Không tự gửi tin cho Root/leader. Báo cáo được chuẩn bị để Tuấn chuyển tiếp.

## Môi trường và giới hạn

- Giữ checkout/nhánh user chọn. Không tạo branch hoặc worktree mới.
- Registry đang đọc có59 migrations; source inventory V2 có18 kinds, giữ V1.
- Dedicated target được phép: loopback5433, user/database `smartsite_test`,
  schema owned. Chưa mở connection hoặc chạy DDL lên database trong lượt này.
- Docker Linux engine pipe không tồn tại; không thấy native PostgreSQL server
  trong PATH/known install locations. Fresh catalog/integration đang OPEN.
- Runner hiện tại preflight bằng legacy DataSource không chỉ định schema; chưa
  dùng nó cho DB trong gói cấm public/default-schema. Cần qualified owned harness.
- AI/model/capture tắt; không chạm demo5434/cloud hoặc khởi động runtime dùng chung.

## Delta phải nhận trước D2

1. Commit/bundle Root0b7 hoặc pin thay thế được owner xác nhận, kèm shared-file WIP/ownership.
2. Delta Main0ef: actor/guard, visitor/notifications/migration và contract hiện tại;
   fresh/populated migration graph phải được đối chiếu lại, không chốt số59.
3. Quyết định leader trên [mapping dự thảo](tuan-db-erd-mapping.csv), migration slot và đường upgrade được hỗ trợ.
4. Harness và PostgreSQL riêng đủ điều kiện; giữ nguyên receipt lịch sử khi reuse.

D0 không đóng thay các dependency trên. Chỉ phần audit source/docs độc lập được
thực hiện trong lúc chờ, đúng D0/D1 của assignment.
