# Quyết định OpenAI trong SmartSite

Trạng thái: người dùng chốt ngày 18/09/2026 và xác nhận đã có ngân sách OpenAI. Chưa triển khai, chưa gọi API hoặc kiểm chứng chất lượng trên ảnh thực tế. Ngân sách cụ thể và model chưa xác định.

## Phạm vi đã chốt và thứ tự triển khai

OpenAI là lớp phân tích bằng chứng và hỗ trợ xử lý sự cố trong sản phẩm. Ưu tiên đầu tiên: phân tích bổ sung ảnh cảnh báo PPE của MF05, mô tả bằng chứng nhìn thấy và điểm chưa đủ rõ để Safety Officer xác minh. MF06 có thể diễn giải sự kiện từ ảnh và kết quả kiểm tra quyền do backend cung cấp; không suy đoán danh tính/quyền từ ảnh. Hỗ trợ soạn nháp hồ sơ MF08 từ bằng chứng được cung cấp nằm trong định hướng này. Chatbot tra cứu toàn hệ thống và báo cáo tổng hợp chưa đưa vào phạm vi triển khai đầu tiên.

## Luồng và ranh giới

Camera → detector/tracking → lưu sự kiện và bằng chứng → phân tích OpenAI bất đồng bộ → lưu nhận xét bổ sung → Safety Officer xác minh.

- Chỉ gửi ảnh được chọn cho sự kiện; không mặc định gửi toàn bộ video liên tục.
- Cảnh báo gốc được lưu và xử lý độc lập. OpenAI chậm/lỗi không chặn cảnh báo; phân tích bổ sung có trạng thái chờ, thành công hoặc thất bại.
- Nhận xét AI không tự xóa cảnh báo, xác nhận vi phạm, thay quyền truy cập hoặc đóng sự cố. Quyết định cuối theo quy trình nghiệp vụ và người có quyền.
- Phân biệt quan sát từ ảnh với dữ liệu backend và suy luận. Ảnh che khuất/không rõ phải cho phép kết quả chưa đủ bằng chứng.
- Khóa API chỉ ở server. Kiểm tra quyền Site/Contractor/Zone trước khi lấy bằng chứng và hiển thị kết quả. Lưu nguồn sự kiện, model, phiên bản prompt và trạng thái xử lý để truy vết.
- Retry có giới hạn và tránh xử lý trùng; theo dõi chi phí, độ trễ, lỗi và mức sử dụng. Có ngân sách không đồng nghĩa không giới hạn chi phí.

## Phần vẫn cần kiểm chứng

Model OpenAI cụ thể, prompt/schema, số ảnh mỗi sự kiện và ngưỡng chất lượng sẽ chọn bằng tập ảnh thực tế. So sánh detector đơn lẻ với detector + phân tích OpenAI về độ hữu ích cho người xác minh, nhận xét sai, bỏ sót, độ trễ và chi phí. Chưa tuyên bố giảm báo giả hoặc đạt SLA.

YOLO11s đã được chốt ngày 19/09/2026 làm detector baseline; RF-DETR Nano/Small và YOLO26s chỉ là đối chứng benchmark tùy chọn. Pipeline danh tính vẫn cần thử nghiệm. Quyết định OpenAI không thay detector hoặc tự chốt danh tính. Phần cứng dự kiến: RTX 4060, khoảng 1–3 camera, chưa đo tải thực.

Quyết định này thay các ghi chú cũ “vai trò OpenAI chưa chốt”. Report 2/3 trên Drive chưa được cập nhật trong bước này.

## Nguồn đã đối chiếu

- https://developers.openai.com/api/docs/guides/images-vision
- https://developers.openai.com/api/docs/guides/function-calling
