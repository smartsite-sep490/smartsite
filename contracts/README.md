# Contract Backend–AI

Đây là nơi giữ bản chuẩn giao tiếp hai repo. **Chưa có contract thực thi hoặc endpoint đã chốt.**

## Quy trình

1. Chốt bản đầu qua PR ở `smartsite`: schema/API, ví dụ dữ liệu giả và ca kiểm thử.
2. AI ghi phiên bản hoặc commit contract sử dụng trong tài liệu tích hợp của repo AI.
3. PR thay đổi contract phải nêu tương thích ngược, PR triển khai hai bên và thứ tự deploy.
4. Kiểm tra schema ở producer và consumer; không dùng nhánh `main` đang thay đổi làm phiên bản release.
5. Khi có release, ghi cặp Backend/AI đã kiểm chứng trong `infra`.

## Nội dung cần thiết kế

- Envelope sự kiện: ID ổn định để retry, phiên bản schema, Site/Camera/Zone, thời điểm quan sát và model version.
- Quan sát PPE/Zone, độ tin cậy và chất lượng dữ liệu.
- Track ID có phạm vi camera/session; identity riêng và có trạng thái chưa xác định.
- Tham chiếu bằng chứng có kiểm soát truy cập; không nhét ảnh/video/base64 vào event mặc định.
- Backend trả kết quả nhận hoặc lỗi rõ; retry có giới hạn; một event gửi nhiều lần không tạo nhiều alert.
- Quyền gọi service theo phạm vi được cấp; không tin Site/Camera trong payload nếu chưa kiểm chứng.
- Truy vấn quyền Zone: thời điểm đánh giá, hiệu lực/phiên bản chính sách và unavailable/unknown.
- Ranh giới sự kiện quan sát, cảnh báo và quyết định xác minh MF08.

Chưa chốt HTTP hay message broker. Bản đầu nên dùng cơ chế đơn giản có thể đo/kiểm thử; không thêm Kafka/RabbitMQ chỉ để hoàn thiện sơ đồ.
