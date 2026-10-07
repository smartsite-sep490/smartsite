# Site Access và ERD ngày 02/10/2026

Phạm vi thay đổi này là sáu mục Site Access và các bảng liên quan đến visitor, quyền vào Site/Zone, khuôn mặt, lượt qua cổng và attendance. Đây là bước triển khai nghiệp vụ theo ERD, không phải chuyển toàn bộ hệ thống sang đúng 43 bảng vật lý.

## Các luồng đã triển khai

- Visitor đăng ký một người đại diện, tổng số người gồm cả đại diện, Site, cổng, thời hạn và các Zone yêu cầu. Backend chọn Site Manager đang hoạt động tại Site đó; chỉ Site Manager có quyền tại Site mới duyệt. Pending chưa có QR.
- Mỗi QR opaque gắn Site và IN hoặc OUT, có hạn ngắn, lưu hash, xoay mã thì thu hồi mã trước. Đại diện check-in/check-out cả đoàn; không nhập số người cho từng lượt hoặc tách đoàn. Cho phép nhiều lượt ra/vào trong thời hạn; giờ ra vẫn được ghi sau khi visit hết hạn hoặc bị hủy.
- Contractor Representative đề nghị Worker assignment có ngày hết hạn. Site Manager duyệt trực tiếp, kiểm tra participation và version; có thể thu hồi assignment kèm lý do. Safety review cũ vẫn tương thích nhưng không còn là bước bắt buộc.
- Site Manager cấp Contractor Zone permission trong thời hạn participation. Representative cấp Worker Zone permission nằm trong cả assignment và Contractor permission, cùng Site/Contractor. Thu hồi quyền nền sẽ làm quyền phụ thuộc không còn cho phép vào Zone. Legacy ALLOW không còn là nguồn cấp quyền; DENY cũ vẫn ưu tiên để giữ chức năng ngăn truy cập của main.
- FACE/QR/MANUAL tạo `access_attempt` với identity, authorization và schedule riêng. UNKNOWN được lưu nhưng không tạo passage. Worker phải có assignment APPROVED còn hiệu lực và quyền đúng cổng để IN. Security xác minh ngoại lệ không có ca với lý do, không vượt quyền Site đã hết hạn. OUT dùng EXIT_RECORD_ONLY.
- Sau xác minh, operator xác nhận lượt qua cổng. Backend đánh giá lại quyền, khóa dữ liệu liên quan, consume QR và tạo đúng một `gate_event` trong transaction. Retry cùng key trả event cũ. Quét Worker QR hoặc nhận diện khuôn mặt chưa tự tạo passage.
- Chấm công là thao tác riêng sau passage đã xác nhận. Ra/vào tạm thời không tự đóng/mở attendance session. Worker đề nghị correction; Representative cùng nhà thầu duyệt, không tự duyệt và không ghi đè version mới hơn. Chỉ giờ hiệu lực thay đổi; sự kiện gốc giữ nguyên. Báo cáo số phút được tính từ giờ hiệu lực, chưa có duyệt/chốt công hoặc payroll.
- Worker tự xác nhận consent trước bất kỳ chất lượng ảnh, sample hoặc enrollment nào. Người hỗ trợ chỉ mở session và bàn giao màn hình cho Worker. Capability chỉ dùng cho session đó, hết hạn sau 30 phút; không lưu trên browser storage. Backend không thể chứng minh người thực tế bấm màn hình là ai: đây là phương thức supervised có trách nhiệm vận hành.
- Worker không bắt buộc có account để enroll Face hoặc được Security xác minh MANUAL. QR cá nhân trên ứng dụng cần account của chính Worker. Mỗi enrollment tạo profile mới; partial unique chỉ cho một ACTIVE/Worker. Thu hồi consent xóa ciphertext; DELETED giữ metadata lịch sử, template null. Có hủy session và bắt đầu lại.

## Tên bảng tương thích

| ERD logical                                         | Bảng vật lý đang dùng                                     |
| --------------------------------------------------- | --------------------------------------------------------- |
| account                                             | app_user                                                  |
| site_contractor                                     | contractor_site_participation                             |
| worker_assignment                                   | worker_site_zone_assignment (giữ zone_ids/gate_id legacy) |
| visit                                               | visitor_visit; visitor riêng và visit_zone được bổ sung   |
| access_credential                                   | qr_credential; consumed_at tương ứng used_at              |
| access_attempt / gate_event                         | access_attempt / gate_event                               |
| contractor_zone_permission / worker_zone_permission | cùng tên ERD                                              |
| attendance_event / session / correction             | cùng tên ERD                                              |
| audit_log                                           | audit_log                                                 |

`face_profile` vẫn dùng ciphertext được mã hóa trong PostgreSQL và hash reference của AI, thay vì `template_ref` tới kho private độc lập. API không trả ciphertext/hash. Đây là lựa chọn tương thích với AI đang chạy; không tuyên bố đã chuyển sang external template storage. `captured_by` tương ứng `created_by_user_id`.

Attendance liên kết schedule hiện có qua `worker_schedule`. Shift hiện có là khoảng timestamp cụ thể; bản này chưa chuyển sang template time + `shift_assignment` snapshot như ERD. Worker vật lý vẫn scoped theo Site, và role assignments chưa có toàn bộ lifecycle/validity của `role_grant`. Evidence reference tổng quát, certificate, Site kind/address/status/timezone, chuẩn hóa PersonObservation/identity/PPE và các phần ngoài Site Access cần đợt migration riêng. Safety/Notifications từ main được giữ lại, AI schema và vendored contracts không đổi.

## Migration và triển khai

1. Sao lưu DB và kiểm tra mỗi Site có visitor cũ đã được gán Site Manager thật. Migration không tạo account hoặc tự đoán người phê duyệt; nếu thiếu manager thì dừng và rollback transaction.
2. Build Backend rồi chạy `pnpm --filter @smartsite/backend db:migrate:run` với cấu hình của môi trường được chọn. Không dùng synchronize, reset DB hoặc xóa volume. Các migration `1791504000000` đến `1791504000006` chạy theo thứ tự.
3. Backend và Web/client cần triển khai cùng đợt: consent là bước bắt buộc mới; xác nhận Worker passage và attendance là các hành động riêng; cấp legacy ALLOW bị từ chối.
4. Phát QR mới sau migration. Mọi credential cũ chưa consume được thu hồi vì chưa có đủ binding chiều. QR lịch sử đã consume vẫn giữ retry result.
5. Với visit cũ đã ghi số lượng vào/ra một phần, giữ nguyên sự kiện và đánh dấu NEEDS_REVIEW. Security dùng **Manual group checkout** sau khi đại diện xác nhận toàn đoàn đã ra, ghi lý do và audit. Không giả tạo lượt vào hoặc sửa lịch sử cũ.

Legacy Face ACTIVE giữ `consent_method=LEGACY_UNVERIFIED`; giá trị này không chứng minh consent cũ do Worker tự xác nhận. Các enrollment đang mở trước migration bị hủy; người vận hành phải bắt đầu session mới. Các migration từ chối downgrade khi lịch sử mới không thể biểu diễn an toàn bằng schema cũ. Trong tình huống đó dùng backup hoặc forward fix.

## Kiểm chứng

Kiểm tra ngày 05/10/2026 trên nhánh `codex/qr-access`: `pnpm install --frozen-lockfile`, `pnpm peers check`, `pnpm check` và `pnpm --filter @smartsite/mobile check:dependencies` đều qua. Bộ kiểm tra toàn repo có 658 test qua và build Web/Backend/Mobile thành công. `pnpm --filter @smartsite/backend test:integration` có 98/98 test qua trên PostgreSQL riêng, gồm migration nâng/hạ cấp và kiểm tra không có TypeORM metadata drift. Các file thay đổi qua Prettier và `git diff --check`.

Integration dùng PostgreSQL test riêng, fixture tổng hợp, không camera thật hoặc API trả phí. Test bao gồm Site/Contractor scope, bounds, replay đồng thời, thu hồi giữa scan và confirm, QR sai chiều, cả đoàn/re-entry/expiry, consent trước sample, Worker không account, history profile, temporary passage, correction/version và downgrade. Schema catalog và TypeORM drift được kiểm tra trên DB thật. Mức nhận diện AI và webcam thực tế cần được đo trên thiết bị triển khai; mock adapter chỉ xác nhận luồng Backend.

Việc chạy migration trên DB test không đồng nghĩa DB ứng dụng đã được nâng cấp.
