# Web

React/Vite/TypeScript + TanStack Query, Tailwind4. Màn hình nền hiển thị trạng thái kết nối thật; không dùng số liệu sự cố giả.

Từ root: `pnpm dev:web`, `pnpm --filter @smartsite/web build`.

`VITE_API_URL` mặc định http://localhost:3000, không thêm /api/v1. Đây là địa chỉ trình duyệt truy cập được; không dùng tên service Docker `backend`. Khi deploy, thay URL lúc build. Client fetch có timeout/cancellation và validate payload; cache qua TanStack Query.

Thông báo lỗi UI dùng nội dung EN/VI đã duyệt theo loại lỗi và HTTP status. Lỗi không nhận diện được dùng thông báo chung; không hiển thị nguyên văn exception, JSON lỗi hoặc request ID. Các lỗi nghiệp vụ đã biết vẫn có hướng dẫn sửa hoặc tải lại. Chi tiết kỹ thuật tiếp tục nằm trong phản hồi API/log của Backend; trang đăng nhập và đổi mật khẩu không có khối Error details.

Chưa có auth, routes nghiệp vụ hoặc component kit shadcn. Thêm theo màn hình/use case thực tế; không cài Redux nếu chưa có shared client state.
