# Contract Backend–AI

Thư mục này giữ contract chuẩn giữa `smartsite-ai` và SmartSite Backend.

Observation envelope `1.1.0` bổ sung `GLOVES`, `BOOTS`, `GOGGLES` tại
`schemas/v1.1/technical-observation-event.json`. Validator chọn schema theo
`schemaVersion` chính xác; payload `1.0.0` vẫn chỉ cho phép mũ/vest, schema v1
không đổi bytes. Các bounds, geometry và trạng thái PRESENT/MISSING giữ nguyên.
Producer cũ tiếp tục dùng v1; producer mở rộng chỉ được bật khi consumer hỗ trợ
v1.1 và model/item đã qua capability/evaluation gate. Enum và Zone policy không
chứng minh model có khả năng detect item; không suy MISSING từ absence hoặc UNKNOWN.

Contract v1 hiện có:

- JSON Schema `schemas/v1/technical-observation-event.json`;
- JSON Schema `schemas/v1/camera-region-configuration.json` và golden vectors dùng chung;
- validator Ajv và kiểm tra hình học bounding box;
- canonical JSON/hash theo RFC 8785 cho idempotency;
- golden vectors dùng chung giữa TypeScript và Python;
- endpoint consumer `POST /api/v1/integrations/ai/events` ở Backend.

Các giới hạn trong schema là một phần của wire contract: UUID dạng canonical có dấu gạch nối, RFC 3339 với `T` và timezone rõ ràng, số nguyên không vượt `Number.MAX_SAFE_INTEGER`, tối đa 256 observations/evidence mỗi event, chuỗi không chứa NUL và `candidateWorkerId` tối đa 128 ký tự để khớp persistence.

## Cấu hình camera-region

`camera-region-configuration.json` do Backend sở hữu và chỉ xuất snapshot các region đang active. Payload UTF-8 JSON tối đa 256 KiB, mỗi camera tối đa 64 region và mỗi polygon tối đa 64 đỉnh. Tọa độ `[x, y]` được chuẩn hóa trong `[0, 1]` theo gốc trên-trái: `x` tăng sang phải và `y` tăng xuống dưới.

`cameraExternalId` chỉ chứa Unicode hợp lệ, không chứa NUL hoặc surrogate đơn lẻ; ký tự ngoài BMP vẫn được chấp nhận. UUID của các region phải duy nhất khi so sánh không phân biệt hoa/thường, nhưng payload giữ nguyên cách viết để tính hash. Kiểm tra diện tích và giao cắt polygon dùng giá trị IEEE-754 chính xác, không đặt ngưỡng diện tích tối thiểu.

Khi nhận cùng một `configurationVersion`, hai phía canonical hóa toàn bộ payload theo RFC 8785/JCS rồi so sánh SHA-256 chữ thường. Cùng version nhưng hash khác nhau là xung đột cấu hình, không phải bản cập nhật mới.

## Quy trình thay đổi

1. Sửa schema, vectors và test chuẩn ở repo `smartsite`, review và merge thay đổi canonical trước.
2. Từ commit SHA bất biến trên `main`, vendor đúng bytes sang repo `smartsite-ai` rồi cập nhật commit/checksum provenance.
3. Chạy test tương thích hai phía, PostgreSQL integration và HTTP/auth boundary.
4. PR phải nêu tương thích ngược, thứ tự deploy và cặp commit Backend/AI đã kiểm chứng.
5. Không trỏ provenance vào một branch đang thay đổi; luôn dùng commit SHA bất biến.

AI chỉ phát technical observations. Backend xác minh camera/region/Zone, quyết định quyền nghiệp vụ, giữ raw event, xử lý idempotency và quản lý Safety Alert/Incident.

`src/management-api.ts` cũng định nghĩa các kiểu response TypeScript dùng chung cho Backend API, Web và Mobile. Safety Alert list/detail chỉ công bố các trường quản lý ổn định; detail có `detectionsTotal` và tối đa 100 detection summaries mới nhất, không công bố raw event payload. Đây là bổ sung tương thích ngược cho API quản lý; JSON Schema v1 giữa Backend và AI không thay đổi.
