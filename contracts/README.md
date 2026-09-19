# Contract Backend–AI

Thư mục này giữ contract chuẩn giữa `smartsite-ai` và SmartSite Backend.

Contract v1 hiện có:

- JSON Schema `schemas/v1/technical-observation-event.json`;
- validator Ajv và kiểm tra hình học bounding box;
- canonical JSON/hash theo RFC 8785 cho idempotency;
- golden vectors dùng chung giữa TypeScript và Python;
- endpoint consumer `POST /api/v1/integrations/ai/events` ở Backend.

Các giới hạn trong schema là một phần của wire contract: UUID dạng canonical có dấu gạch nối, RFC 3339 với `T` và timezone rõ ràng, số nguyên không vượt `Number.MAX_SAFE_INTEGER`, tối đa 256 observations/evidence mỗi event, chuỗi không chứa NUL và `candidateWorkerId` tối đa 128 ký tự để khớp persistence.

## Quy trình thay đổi

1. Sửa schema chuẩn và test ở repo `smartsite` trước.
2. Commit schema, sau đó vendor đúng bytes sang repo `smartsite-ai` và cập nhật commit/checksum provenance.
3. Chạy test tương thích hai phía, PostgreSQL integration và HTTP/auth boundary.
4. PR phải nêu tương thích ngược, thứ tự deploy và cặp commit Backend/AI đã kiểm chứng.
5. Không trỏ provenance vào một branch đang thay đổi; luôn dùng commit SHA bất biến.

AI chỉ phát technical observations. Backend xác minh camera/region/Zone, quyết định quyền nghiệp vụ, giữ raw event, xử lý idempotency và quản lý Safety Alert/Incident.
