# Rà soát MF03 — 2026-10-08

## Kết luận

Các luồng chính đã có backend, API/client và Web, và đạt kiểm thử tự động. Chưa nên gọi là nghiệm thu toàn bộ: còn các ngoại lệ chưa có thao tác xử lý chuyên biệt trên UI và chưa kiểm tra bố cục/thao tác bằng trình duyệt thật, camera và QR thật. Kết nối browser automation bị lỗi `trusted Node process exited unexpectedly`; UI được kiểm tra bằng React DOM/jsdom, không phải bằng ảnh chụp màn hình.

Phạm vi đối chiếu là [plan đã chốt](../planning/mf03-attendance-reconciliation-plan.md), gồm các quyết định tiếp theo về bỏ bắt buộc đổi mật khẩu. Mobile, email/SMS/push và tính lương nằm ngoài phạm vi.

## Đối chiếu yêu cầu

| Yêu cầu                                                    | Backend                                                                                          | Web / bằng chứng                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Face/QR qua cổng được xác nhận tự ghi công                 | Đạt qua điểm xác nhận chung; retry không cộng trùng                                              | Gate Desk bỏ nút ghi công riêng; chưa test camera/QR thật                                   |
| Kiểm tra ca hôm nay; một ca chính/ngày                     | Đạt; trigger giữ dữ liệu nhiều ca cũ và chặn xung đột mới                                        | Worker chọn lịch đã phân; tải đủ các trang lịch                                             |
| Vào sớm chỉ tính từ đầu ca; vào muộn tính thực tế          | Đạt; tính theo ngày phân ca và múi giờ                                                           | Hiển thị tổng thường/tăng ca/tạm tính/xác nhận                                              |
| OUT dừng, IN lại tiếp tục; cộng nhiều khoảng               | Đạt; ví dụ 08–11 và 13–17 ra 420 phút                                                            | Chi tiết từng khoảng có API và nút View                                                     |
| Ra tạm nhắc Worker; quay lại đủ ca không cần duyệt         | Đạt                                                                                              | Hộp thông báo và ngày công; routing có test                                                 |
| Rời sớm lần cuối cần đại diện xác nhận                     | Đạt; version, scope, lý do và audit                                                              | Test tương tác bắt buộc review note, dùng version mới nhất từ detail                        |
| Thiếu OUT sau cuối ca + 5 phút                             | Đạt; giữ giờ tạm tính, gửi Worker/đại diện, chống gửi trùng                                      | Không cộng vào bảng công xác nhận; cần nghiệm thu thời gian thực và restart thiết bị        |
| Tăng ca phải duyệt trước, chỉ cộng hiện diện thực tế       | Đạt; kiểm tra lại khoảng so với ca khi duyệt                                                     | Test Worker gửi và đại diện duyệt; validation lỗi hiển thị                                  |
| Nghỉ cả ca/một phần ca không cộng giờ nghỉ                 | Đạt; cả ca 0 phút; một phần ca được trừ theo khoảng                                              | Form Leave và danh sách yêu cầu/ghi chú duyệt                                               |
| Sửa công sau chốt cập nhật tổng, giữ raw events            | Đạt; test PostgreSQL duyệt đồng thời chỉ một quyết định, tổng giảm đúng và raw events giữ nguyên | Test DOM tổng và bảng công làm mới ngay; chọn ngày cũ tải đúng phiên và correction          |
| Worker không xem người khác; đại diện đúng Site/Contractor | Đạt; kiểm tra quyền hiện hành và quyền đã thu hồi                                                | Ẩn thao tác duyệt của Worker, endpoint vẫn kiểm tra độc lập                                 |
| Không có ca: lưu evidence, cảnh báo, chưa cộng giờ         | Đạt; bổ sung ca hợp lệ có thể tính lại                                                           | Có NO_SCHEDULE và giờ chưa xác nhận                                                         |
| Ca qua đêm thuộc ngày bắt đầu                              | Đạt; test 470 phút và ca mẫu tái sử dụng                                                         | Chi tiết có timezone; input theo timezone thiết bị                                          |
| Lọc/phân trang/xử lý tải, rỗng, lỗi và conflict            | Đạt cho ngày công và client                                                                      | Test tương tác reload conflict và lịch ở trang thứ hai; giới hạn yêu cầu riêng nêu dưới đây |

## Lỗi phát hiện và đã sửa

1. Worker nền chỉ lấy 500 ngày công đầu: chuyển sang quét theo trang với cursor ID, test 501 ngày đều được xử lý trong một lượt.
2. Form xin nghỉ/tăng ca chỉ tải 100 lịch đầu: dùng helper tải đủ trang và chỉ lấy lịch ACTIVE; kiểm thử chọn lịch thứ 101. Danh sách Worker dùng cho bộ lọc cũng tải đủ trang.
3. Gửi/duyệt correction chỉ làm mới danh sách session: bổ sung invalidation ngày công, detail, bảng công và notifications; session tự tải lại mỗi 30 giây.
4. Sau khi giờ ca được sửa, request có thể trở thành nằm trong ca thường: duyệt kiểm tra lại khoảng overtime/leave với ca hiện hành; test từ chối overtime bị chồng lên ca đã sửa.
5. UI correction chỉ thấy 100 phiên gần nhất: bổ sung query `dayId` trên `GET /attendance`, mở View tải đúng phiên/correction của ngày chọn. Backend vẫn áp dụng scope; test Worker khác không thấy ngày đó.
6. Refresh chỉ tải danh sách ngày: bổ sung tải lại detail, bảng công, lịch, Worker và session để thao tác lại sau lỗi/conflict.

7. Bổ sung thao tác bỏ qua IN trùng có quyền đại diện, lý do, version, audit và trạng thái IGNORED; giữ sự kiện gốc, không cộng giờ. Test đồng thời chỉ tạo một audit, chặn Worker và quyền bị thu hồi.
8. Form sửa công thiếu IN điền sẵn OUT với đầy đủ giây; Worker nhập giờ IN thực tế và đại diện duyệt. Sửa lỗi OUT hôm nay ghép vào phiên chưa checkout ngày cũ và lỗi phiên ngày cũ chặn correction hôm nay. Test chuỗi ignore → correction → OUT thật chốt tổng đúng.

## Phần còn thiếu / chưa được nghiệm thu

- **SCHEDULE_CHANGED giữ snapshot cũ và chặn chốt**. Web đã có đối chiếu ca gốc với lịch hiện tại (ngày, múi giờ, giờ ca và trạng thái active), hướng dẫn khôi phục lịch và liên kết đến phân ca. Chưa có quyết định nghiệp vụ cho phép đại diện thay snapshot/tính theo ca mới; không tự thay công đã chốt.
- Hàng đợi tăng ca/nghỉ đã có endpoint phân trang riêng và Web có bộ lọc loại/trạng thái, Previous/Next, tổng số bản ghi, loading/error/retry. Endpoint ngày công cũ vẫn trả danh sách rút gọn để tương thích; Web dùng endpoint mới để xem các yêu cầu ngoài mốc 100.
- UI DOM test dùng API mock; PostgreSQL test dùng fixture tổng hợp. Chưa chạy toàn bộ đường Worker → Gate Desk → đại diện trên trình duyệt thật, chưa xác minh responsive/keyboard bằng trình duyệt và chưa đo độ chính xác Face/QR phần cứng.
- Worker quét toàn bộ ngày theo batch; test chống bỏ sót không phải benchmark tải lớn. Độ trễ nhắc phụ thuộc thời gian hoàn tất lượt quét và DB.
- Chưa có review của thành viên khác theo Definition of Done.

## Kiểm tra trước lần bổ sung phân trang / đối chiếu ca

- Frozen install, peer check, Mobile dependency check, định dạng và `git diff --check` đạt.
- `pnpm check` đạt trên worktree riêng: lint, typecheck, test và build workspace. Backend: 263 unit test; Web: 324 test; client: 42 test.
- Bộ PostgreSQL: 112/112 test đạt, đã được mở rộng với nghỉ cả ca, correction sau xác nhận, approval đồng thời, immutable raw evidence, thay đổi ca và đọc lịch sử ngoài 100 phiên.
- Runtime local được cập nhật sau khi kiểm tra; chỉ dùng API đọc để smoke test tài khoản demo, không tạo lượt IN/OUT giả trong database ứng dụng.
- `contractor.demo` đăng nhập thành công; API ngày công, bảng công, phiên theo ngày được chọn và lịch ACTIVE đều đạt. Quyền trả về: `canReview=true`, `canRequest=false`. Backend readiness và Web trả 200.
- Sau phản hồi đăng nhập lỗi, đã đặt lại hai tài khoản Worker theo yêu cầu thành `Worker123!`; cả hai đăng nhập và đọc API attendance thành công, `canRequest=true`, `canReview=false`.

Hướng dẫn sử dụng và triển khai ở [MF03 vận hành](../operations/mf03-attendance.md).

## Kiểm tra bổ sung phân trang / đối chiếu ca — 2026-10-08

- Thực hiện tại checkout `D:\SmartSite\smartsite`, nhánh `feat/mf03-attendance-20261008`; giữ các thay đổi đang có. Không thêm dependency hoặc migration cho lần bổ sung này.
- `pnpm install --frozen-lockfile --offline`, `pnpm peers check` và Mobile dependency check đạt.
- `pnpm check` đạt: lint, typecheck, test và build toàn workspace. Backend: 265 test; Web: 330 test; API client: 42 test. Lint riêng các file MF03, Prettier và `git diff --check` đạt sau chỉnh sửa cuối.
- PostgreSQL integration: **114/114 đạt**. Kiểm tra mới tạo 105 yêu cầu mỗi loại với cùng thời điểm tạo để xác minh thứ tự ổn định qua trang 100, tổng trong phạm vi, lọc Worker và quyền đã thu hồi. Kiểm tra ca thay đổi xác minh giờ gốc/raw events không đổi, chặn xác nhận và tự hết ngoại lệ sau khi khôi phục ca.
- Sửa fixture integration phụ thuộc giờ máy: cố định đồng hồ và `AccessAttempt.createdAt` để ca phục hồi không vô tình lệch ngày khi chạy gần nửa đêm. Không thay quy tắc tính công để làm test qua.
- Browser automation vẫn không khởi tạo được (`node_repl kernel exited unexpectedly`, Windows sandbox `apply deny-read ACLs`); chưa nghiệm thu trình duyệt/camera/QR thật. Các test Web sử dụng jsdom/mock API.
- Lần bổ sung này đã build artifact nhưng chưa cập nhật image Backend/Web đang phục vụ local, chưa commit/merge và chưa có review độc lập. Cần cập nhật Backend trước Web để có endpoint hàng đợi mới. Quyền tính lại theo ca mới vẫn chưa được chốt; hiện giữ snapshot và khôi phục lịch như quy tắc hiện hành.
