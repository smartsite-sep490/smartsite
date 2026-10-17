# Đối chiếu tính năng sau khi tích hợp main

Nguồn đối chiếu: `origin/main` tại `75d1d60` (#64), tích hợp vào nhánh `feat/qr_visitor_enhance`; lần đối chiếu nghiệp vụ trước tại `3ce0358` (#55–#62). Danh mục này đối chiếu chức năng đã có trong code, không khẳng định toàn bộ FR/ADD trong tài liệu đề xuất đã được triển khai.

Quyết định cập nhật của người dùng: giữ **Đại diện nhà thầu duyệt đổi ca/hoán đổi** theo main. Quyết định này thay thế quyền duyệt MF07 của Site Manager trong bảng FR v0.1 trước đó. Giữ kiểm tra đúng Site, nhà thầu, thời hạn tham gia, không tự duyệt và Worker B phải đồng ý trước khi duyệt hoán đổi.

| Nhóm chức năng có trong main                                                                             | Người thao tác                                                          | Nơi truy cập sau tích hợp                             |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| Nhóm công nhân: tạo, đổi tên, lưu trữ; thêm, chuyển, gỡ thành viên và lịch sử                            | Đại diện nhà thầu đúng Site/nhà thầu                                    | Nhóm công nhân                                        |
| Quyền khu vực của nhóm và kiểm tra thời hạn                                                              | Đại diện nhà thầu trong quyền khu vực đã được cấp                       | Chi tiết nhóm công nhân                               |
| Tạo tài khoản Worker, mã tự sinh, mật khẩu mặc định `12345678`                                           | Đại diện nhà thầu                                                       | Hồ sơ & tài khoản công nhân                           |
| Sửa hồ sơ, ngưng/kích hoạt Worker, xem tài khoản liên kết, đăng ký mặt có đồng ý                         | Đại diện nhà thầu                                                       | Hồ sơ & tài khoản công nhân; Sinh trắc học            |
| Mẫu ca, nghỉ giữa ca, quy tắc ra ngoài, phiên bản và lưu trữ mẫu ca                                      | Site Manager tại Site được giao                                         | Thiết lập lịch                                        |
| Gán lịch theo nhóm/cá nhân, ngày/tuần/lặp hữu hạn, xem trước xung đột, sửa/hủy ngày tương lai, thông báo | Site Manager tại Site được giao                                         | Thiết lập lịch → Phân công công nhân                  |
| Lịch cá nhân, gửi đổi ca/hoán đổi, Worker B đồng ý/từ chối, xem kết quả                                  | Worker của tài khoản                                                    | Nhân sự → Lịch của tôi                                |
| Duyệt/từ chối đổi ca và hoán đổi, lịch sử                                                                | Đại diện nhà thầu; Site Manager chỉ đọc                                 | Nhân sự → Xét yêu cầu                                 |
| Sự kiện cổng, tổng hợp công, đối soát ngày/phiên, xử lý trùng, thiếu lượt, sửa công, tăng ca và nghỉ     | Worker tự gửi; Site Manager duyệt/đối soát; nhà thầu xem đội; Admin đọc | Vào ra → Công & giờ làm                               |
| Tổng quan công trường, nhà thầu, nhân lực, lịch và khu vực theo ngày                                     | Site Manager                                                            | Dashboard và chi tiết nhà thầu                        |
| Danh mục nhà thầu, công trường, tài khoản quản lý và lịch sử tham gia                                    | Admin; Site Manager quản lý việc tham gia Site                          | Thiết lập công trường                                 |
| Tổng quan cá nhân, lịch/công và thông tin nhóm của Worker                                                | Worker                                                                  | Tổng quan cá nhân                                     |
| Tổng quan an toàn, cảnh báo, bằng chứng, xác minh danh tính, sự cố và lịch sử                            | Safety xác minh; Admin/Manager đọc theo scope                           | Nhóm An toàn                                          |
| Tạo/giao phiếu kiểm tra, nhận báo cáo, trả/ghi nhận kết quả, phát hiện liên kết sự cố                    | Safety giao/kiểm tra; nhà thầu làm phiếu được giao                      | Safety: Phiếu kiểm tra; nhà thầu: Công việc được giao |
| Nhận việc khắc phục, nộp bằng chứng, trả kết quả và lịch sử                                              | Người được giao đúng scope; Safety xác minh                             | Công việc được giao hoặc Sự cố theo vai trò           |
| WebSession, xoay phiên, thông báo và Anh/Việt                                                            | Tài khoản có quyền                                                      | Đăng nhập, chuông thông báo, chọn ngôn ngữ            |

Các tùy chỉnh của nhánh được giữ: bàn cổng riêng cho Security, QR và danh sách đoàn khách, email duyệt/từ chối/hủy, Admin quan sát nghiệp vụ, ẩn Nhân sự/Thiết lập lịch với Admin, ẩn nhóm An toàn với Worker/Đại diện/Bảo vệ. Đại diện nhận phiếu và khắc phục trong mục **Công việc được giao**, không mở lại màn giám sát an toàn chung.

Admin không được cấp ngầm quyền ghi ca/lịch, duyệt yêu cầu, quét cổng, đăng ký mặt hoặc xác minh cảnh báo. Tài khoản nhiều role sử dụng role nghiệp vụ được gán tại Site đang chọn. Backend kiểm tra quyền độc lập với menu.

Lưu ý nâng cấp: các thông báo Manager cũ được giữ; migration checklist tương thích với dữ liệu đó và có migration bổ sung cho cơ sở dữ liệu đã chạy main. Không bật `synchronize`, không xóa lịch sử để vượt kiểm tra schema. Mã Worker mới theo bộ sinh tuần tự của main (`W000001`, ...); chính sách đổi mật khẩu của main là tự nguyện.

Những phần chưa có workflow hoàn chỉnh như IoT, tiến độ công việc MF10, thiết bị thực, mọi loại chứng chỉ, phân bảo vệ theo từng cổng, host khách có xác thực/chống tự duyệt không được coi là hoàn thành chỉ vì kiểm kê API đủ. Menu IoT và tiến độ mẫu tiếp tục ẩn.

Kiểm kê route cần đi kèm kiểm thử hành vi và khả năng truy cập từ UI; số route bằng nhau không chứng minh phân quyền hoặc quy trình đúng.

## Kết quả kiểm chứng lần tích hợp nghiệp vụ ngày 16/10/2026

- Giữ 211/211 route từ main; bản tích hợp có 215 route, không thiếu route nguồn.
- 576 kiểm thử web, 327 kiểm thử backend và 191 kiểm thử PostgreSQL đạt; 42 kiểm thử giao diện liên quan chạy lại sau bước dọn code cũng đạt.
- Frozen install, kiểm tra peer dependency, dependency mobile, lint, typecheck và build đạt.
- Đã mở trình duyệt thật với tài khoản thử Manager và Security: đăng nhập, điều hướng và tải dữ liệu thành công, không có lỗi JavaScript hoặc phản hồi 5xx.
- Đã áp dụng năm migration còn thiếu trên database local sau khi sao lưu; không còn migration chờ hoặc sai lệch schema theo metadata.
- Web/API chạy native tại cổng 5173/3000 trên nhánh `feat/qr_visitor_enhance`, HEAD `3ce0358` cùng các thay đổi chưa commit. Có bản sao mã nguồn trước tích hợp và bản sao database để đối chiếu/phục hồi.

## Đồng bộ UI từ main `75d1d60`

Quyết định của người dùng: lấy UI Mobile từ main; giữ UI Web của nhánh; riêng UI Web cho Safety Officer ưu tiên main. Đã fetch và fast-forward từ `3ce0358` lên `75d1d60`, không có xung đột Git. Commit mới chỉ thay đổi `apps/mobile`; không thay đổi API, schema hay dependency.

- Mobile giữ nguyên toàn bộ mã nguồn và tài nguyên của main (#64), gồm splash, đăng nhập và các màn Worker/Contractor. Đây là luồng UI demo của main: đăng nhập chọn role và dữ liệu màn hình còn là dữ liệu mẫu, chưa phải bằng chứng kết nối các workflow nghiệp vụ với Backend.
- Các màn Safety (Overview, Alert, Incident, Checklist, PPE, camera và khu vực hạn chế) đã có cấu trúc từ main. Giữ các bản sửa i18n, scope và điều kiện thao tác; khôi phục cách trình bày sidebar/header, tìm kiếm và khoảng cách dashboard của main cho workspace Safety. Tài khoản Safety không kiêm Admin/Manager/Contractor mở trực tiếp `/incidents` với tab Overview như main; `/dashboard` cũng chuyển đến đó. Không đưa lại nhãn tĩnh “All systems online” khi chưa có dữ liệu trạng thái tổng hợp.
- Giữ giao diện và menu Web riêng của các role còn lại, gồm nhóm công nhân, tạo tài khoản Worker và bàn cổng Security. Không cấp lại thao tác cấu hình khu vực cho Safety, không mở tab Safety cho Worker/Contractor/Security và không khôi phục quyền ghi nghiệp vụ cho Admin.
- Khôi phục route đổi mật khẩu tự chọn `/account/password` để nút từ UI Safety của main sử dụng được. Không buộc đổi mật khẩu khi mở các trang nghiệp vụ.
- Toàn bộ thay đổi chưa commit trước đồng bộ đã có bản sao kèm manifest SHA-256 và binary patch trong thư mục `.task-tools` bên ngoài repository; không có commit hoặc push mới.
