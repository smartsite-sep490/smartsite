# Web

React/Vite/TypeScript + TanStack Query, Tailwind4. Màn hình nền hiển thị trạng thái kết nối thật; không dùng số liệu sự cố giả.

Từ root: `pnpm dev:web`, `pnpm --filter @smartsite/web build`.

`VITE_API_URL` mặc định http://localhost:3000, không thêm /api/v1. Đây là địa chỉ trình duyệt truy cập được; không dùng tên service Docker `backend`. Khi deploy, thay URL lúc build. Client fetch có timeout/cancellation và validate payload; cache qua TanStack Query.

Chưa có auth, routes nghiệp vụ hoặc component kit shadcn. Thêm theo màn hình/use case thực tế; không cài Redux nếu chưa có shared client state.
