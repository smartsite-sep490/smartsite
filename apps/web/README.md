# Web

React/Vite/TypeScript + TanStack Query, Tailwind4. Màn hình nền hiển thị trạng thái kết nối thật; không dùng số liệu sự cố giả.

Từ root: `pnpm dev:web`, `pnpm --filter @smartsite/web build`.

`VITE_API_URL` mặc định http://localhost:3000, không thêm /api/v1. Đây là địa chỉ trình duyệt truy cập được; không dùng tên service Docker `backend`. Khi deploy, thay URL lúc build. Client fetch có timeout/cancellation và validate payload; cache qua TanStack Query.

Ứng dụng có đăng nhập, khôi phục phiên và các trang nghiệp vụ được tải theo route. MF05/PPE và MF06/Zone dùng `SmartSiteManagementClient` qua Backend; Backend kiểm tra phiên, vai trò và phạm vi Site/Camera trước khi trả dữ liệu. Ảnh AI là bằng chứng quan sát; không dùng trạng thái camera hoặc track ID để tự cấp quyền cho Worker.

## Phiên đăng nhập và phục hồi

- Liên kết Get an account mở `/register` với hướng dẫn liên hệ SmartSite administrator. Backend hiện tạo tài khoản qua API users có guard Admin; Web không cung cấp tự đăng ký công khai, không thu mật khẩu hoặc giả lập tạo tài khoản thành công trên trang này.
- Login, refresh, logout và đọc hồ sơ có deadline 10 giây cho cả chờ header lẫn đọc JSON. Lỗi mạng, timeout, 503 hoặc response hỏng có thông báo an toàn ở màn hình đăng nhập; người dùng chủ động thử lại, không tự lặp request đăng nhập.
- Khi đọc/kiểm tra lại hồ sơ lỗi, chặn trang nghiệp vụ kể cả khi cache còn hồ sơ cũ; chỉ mở lại sau khi tải hồ sơ thành công. Thông báo có role alert, không hiển thị nguyên exception. Retry thủ công bị khóa với 401/403 hoặc khi đang tải; Sign out vẫn dùng luồng logout hiện có.
- Shell cũng bỏ tên/vai trò cache và các nút nghiệp vụ khi hồ sơ lỗi hoặc chưa có hồ sơ; hiển thị Access not verified, vẫn giữ Logout và liên kết trang chủ. Hồ sơ tải lại thành công khôi phục navigation theo vai trò hiện tại; Backend tiếp tục kiểm tra quyền từng request.
- Logout xóa token và cache local trước khi chờ API; phản hồi logout đến muộn không xóa phiên mới. Backend vẫn chịu trách nhiệm thu hồi phiên trên server.
- Refresh/login đến muộn sau logout hoặc sau phiên mới không ghi đè trạng thái hiện tại. Bootstrap query phân biệt API URL và chỉ lưu marker, không lưu access token/profile; login mutation không giữ LoginResponse có token.
- Ý định logout được giữ trong `sessionStorage` theo API URL, không chứa credential. Khi logout API thất bại, cùng tab không tự khôi phục cookie session sau reload; chỉ đăng nhập thành công rõ ràng mới bỏ marker. Nếu storage bị chặn, chỉ có bảo vệ trong bộ nhớ; không coi logout offline là bằng chứng server đã thu hồi cookie/phiên.
- Khi phiên hết hạn, xóa cache dữ liệu riêng và hiển thị alert dialog có tên/mô tả, focus ở nút đăng nhập lại, giữ Tab/Shift+Tab trong dialog và trả focus còn hợp lệ khi đóng.
- Các test HTTP local kiểm tra hook Web với shared client thật và fixture synthetic. Probe HTTPS local kiểm tra chứng thư, CORS, cookie production và Backend guards với provider test; chưa chứng minh browser-cookie enforcement, giao diện trình duyệt hoặc PostgreSQL end-to-end acceptance.

## Camera và trạng thái kết nối

- Live raw video và AI snapshot là hai nguồn riêng; video raw không mang kết luận PPE. Video ghi sẵn là playback, không đồng bộ với snapshot AI.
- Khi mất quyền (401/403), giữ trạng thái chặn trong cùng phiên/camera, kể cả khi đổi tab trình duyệt hoặc tắt/bật xem video. Đăng nhập/phạm vi mới được kiểm tra lại qua Backend.
- Live video tôn trọng `Retry-After` khi gặp 429. Nút retry không bỏ qua thời gian chờ hoặc mở lại một kết nối đang chạy. Tab bị ẩn dừng video; hiển thị lại vẫn giữ thời gian chờ còn lại.
- AI snapshot ở chế độ một camera và wall dùng cùng scheduler. Nút Retry bị khóa khi request đang chạy, gặp 401/403 hoặc trong trạng thái 429; thông báo cooldown cho biết hệ thống tự thử lại. Khi chuyển sang lỗi 503 và request đã kết thúc, người dùng có thể retry; retry trong wall không đổi camera đang focus.
- Khung hình/video cũ được bỏ ngay khi đổi camera, phiên hoặc API adapter. Object URL của video ghi sẵn được thu hồi khi đổi nguồn hoặc unmount.

Để làm giao diện/cấu hình khi tạm dừng AI, đặt `VITE_AI_WORK_PAUSED=true` trong `.env.local` trước khi chạy/build Web. MF05 và trình cấu hình vùng camera ngừng preview, video và thao tác triển khai nguồn AI; vẫn quản lý cấu hình đã lưu. Cờ Web này không dừng tiến trình AI độc lập và không tự tạm dừng các máy khác.

Kiểm thử nhẹ khi cần hạn chế CPU: `pnpm --filter @smartsite/web test src/components/cameras/useScopedCameraMedia.retry.test.ts --maxWorkers=1`. Kiểm thử dùng API giả lập, không tải model, chạy inference hoặc mở camera thật. Kiểm thử DOM không thay thế nghiệm thu giao diện trong trình duyệt/thiết bị.

Vitest không nạp `.env*` của người vận hành (`envDir: false`), nên cờ tạm dừng/URL
local không thay đổi test fixture. Các ca paused/demo tự đặt biến bằng `vi.stubEnv`;
cấu hình chạy/build Web vẫn giữ hành vi Vite hiện có.

## Duyệt cảnh báo

Lý do đang nhập gắn với đúng Site, phiên và alert, kể cả khi danh sách refresh thay
thứ tự hoặc loại alert khỏi trang. Đổi lựa chọn/phạm vi chủ động xóa bản nháp.
Gửi lại cùng quyết định sau mất phản hồi giữ command ID; thay lý do, revision hoặc
phạm vi tạo lệnh mới. Phản hồi chờ gửi/thành công có vùng trạng thái và được giữ
khi editor đóng sau Confirm/Dismiss. Đây là review của người có quyền, không
chuyển quan sát AI thành quyền truy cập tự động.

## Ảnh bằng chứng Safety Alerts

Ảnh chỉ tải khi người dùng chọn xem. Lỗi tải lại hoặc metadata `available=false` ngăn ảnh cũ trong cache được dùng tiếp cho xác minh danh tính. Ảnh không hiển thị được có thông báo và nút tải lại; object URL lỗi được thu hồi. Không tự retry khi gặp lỗi; retry thủ công bị khóa với 401/403. Lỗi mạng/timeout/response được chuyển thành thông báo an toàn, không đưa nguyên exception lên giao diện.

Xác minh danh tính vẫn cho phép luồng CLEAR không có ảnh nếu Backend xác nhận quyền và revision; không dùng một ảnh cũ/unavailable để thực hiện RESOLVE. Các quyết định/quyền vẫn do Backend kiểm tra, không suy ra từ tracker ID hoặc ảnh AI.

## Thông báo lỗi UI

Thông báo lỗi UI dùng nội dung EN/VI đã duyệt theo loại lỗi và HTTP status. Lỗi không nhận diện được dùng thông báo chung; không hiển thị nguyên văn exception, JSON lỗi hoặc request ID. Các lỗi nghiệp vụ đã biết vẫn có hướng dẫn sửa hoặc tải lại. Chi tiết kỹ thuật tiếp tục nằm trong phản hồi API/log của Backend; trang đăng nhập và đổi mật khẩu không có khối Error details.
