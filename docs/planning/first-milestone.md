# Mốc đầu — từ repo đến luồng chạy được

Làm theo thứ tự phụ thuộc dưới đây; tài liệu và code đi cùng mỗi đầu việc.

| Bước                    | Đầu ra code                                               | Đầu ra tài liệu                                  | Hoàn thành khi                                                    |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| 1. Chốt stack           | Chưa cần scaffold framework                               | Quyết định stack và cập nhật Report 2            | Mobile/Backend/AI không còn lựa chọn mâu thuẫn                    |
| 2. Làm nền app          | Web, API, Mobile chạy tối thiểu; cấu hình mẫu; CI build   | README lệnh chạy và sơ đồ triển khai dự kiến     | Thành viên khác chạy được từ checkout mới                         |
| 3. Chốt contract v0.1   | Schema, dữ liệu giả, kiểm tra producer/consumer           | API/event, retry, quyền gọi, trạng thái lỗi      | Backend và AI dùng cùng một hợp đồng                              |
| 4. MF05 với dữ liệu giả | API nhận sự kiện, danh sách và chi tiết cảnh báo trên Web | UC MF05 và tiêu chí kiểm thử                     | Demo gửi event → xem alert/bằng chứng giả; gửi lặp không nhân đôi |
| 5. MF05 camera          | AI PPE trên dữ liệu được phép dùng; tích hợp event        | Báo cáo đo chất lượng/độ trễ và giới hạn         | Đo trên bộ thử đã định nghĩa; không chỉ một clip đẹp              |
| 6. MF06 định danh/quyền | Proof of concept người → identity → quyền Zone            | UC MF06, phương thức định danh và ca unknown     | Phân biệt allowed/denied/unknown có căn cứ                        |
| 7. Tích hợp/deploy đầu  | Container/Compose thật và smoke test                      | Hướng dẫn local, deploy, rollback, cặp phiên bản | Người khác dựng được từ tài liệu                                  |

Có thể làm khảo sát khả thi AI song song với bước 1–4. Chưa khóa deadline hoặc phân công thành viên trong tài liệu này.

Mỗi bước chia issue nhỏ có người thực hiện và người review luân phiên. Không cần làm xong toàn bộ Report 3 mới bắt đầu code; phần nghiệp vụ còn mở phải được đánh dấu rõ.
