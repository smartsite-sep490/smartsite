# Tuấn — baseline database/ERD ngày 17/10/2026

Phạm vi: D0–D4 của `2026-10-17-tuan-db-erd-assignment-v1`.
Theo chỉ đạo mới nhất của Tuấn: **giữ mọi thay đổi local; không commit/push/PR/deploy**.

## Source và trạng thái Git

| Nguồn                           | Pin đã xác minh                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| Nhánh / upstream                | `feat/tuan-mf05-mf06-backend` / `origin/feat/tuan-mf05-mf06-backend`                   |
| HEAD giữ nguyên                 | `7bb4501692830f185a367fc0e2fbf06685f725b2`                                             |
| Source trước lượt này           | Tree tương đương `5984b3270f5325883d77e64415e799c50ceea424` sau revert hai commit docs |
| Root đã nhận và ghép nội dung   | `f3aa81898476c8b3c27516b78ff99d6d484b4187`                                             |
| Pin assignment cũ               | `0b7fbb59979a0c23ac955d394eb9b038f7f1e99d`, đã xác minh là ancestor của Root mới       |
| Main đã fetch lại khi kiểm cuối | `0ef7b6901cde852e5660e8a58f1a194e16ac560a`, delta #66 đã ghép nội dung                 |
| Gói v4 lịch sử                  | `64b64926ea8f4089deb27635d8425b47b4332e62`                                             |

Không gọi HEAD trên là commit chứa implementation mới: source mới còn ở working tree.
Source Root được hòa giải với Team/V2 của Tuấn; không copy đè toàn bộ source.
Hai thay đổi role CHECK trong Checklist của Root không ghi đè migration Tuấn đã áp.
Bridge forward mới xử lý compatibility thay vì giả journal hoặc xóa notification.
Trạng thái Git cuối và hướng dẫn tự commit nằm trong [bàn giao](tuan-db-erd-handoff.md).

## Quyết định và ownership

- Tuấn đồng ý 17 tên bảng đề xuất, giữ nguyên cấu trúc; giữ 2 consent tables và 7 cột cũ.
  Quyết định trong chat ngày17/10; không gán nó thành approval của leader/Root.
- Root đã publish recovery/source tại `f3aa818`; không còn thiếu source `0b7fbb5`.
- Phần nhận: Backend Entity/raw SQL/registry, ba migration mới, tests và database docs.
- Giữ Team history, 18 source kinds, codec V1/V2, writer attribution và fail-closed trust.
- Web/Mobile/shared client/lockfile thay đổi từ nguồn Root/Main được giữ khi ghép;
  không phát triển UI hoặc đổi public contract trong phần implementation này.
- Ba slot mới đang có trong local graph; Root cần kiểm slot/provenance khi review tích hợp.
  Không tự tuyên bố Root đã duyệt hoặc đã chạy migration trên DB vận hành.

## Môi trường và bằng chứng

- Node24.19.0, pnpm12.4.2, PostgreSQL18.6; phiên bản dependency theo frozen lockfile.
- Dedicated Compose project `smartsite-tuan-erd-20261017`, service `postgres-test`;
  loopback5433, user/database `smartsite_test`, tmpfs, chỉ schema UUID owned.
- Runner và helper dùng schema owned; không preflight migration vào public/default schema.
  Root đã có `installExtensions:false`; không triển khai lại fix đã tồn tại.
- Fresh graph hiện tại: **65 migration, 89 bảng ứng dụng + journal, 902 cột gồm journal**.
  Không đóng cứng số lượng lịch sử58/59/61 trong registry hoặc assertion hiện tại.
- Catalog: 1.302 constraints, 213 indexes, 106 non-internal triggers; snapshot namespace/public
  trước–sau và cleanup riêng đã PASS. Đây là môi trường test synthetic.
- Không dùng cổng5434/cloud/DB vận hành, camera, AI/model thật hoặc tạo consent/trust giả.
- Logs và receipt đầy đủ được giữ local tại
  `.superpowers/sdd/2026-10-17-tuan-db-erd-assignment/`.
- Worker thực thi: Codex inline; một reviewer Codex độc lập chỉ đọc theo skill review.
  Context token telemetry: **unknown**, không coi ước lượng hoặc compaction là số đo.

Kết quả kiểm cuối và gate ngoài phạm vi được ghi riêng trong bàn giao; PASS lịch sử
trên `5984b32` không được cộng vào kết quả source mới.
