# Backend

NestJS 12 / ESM / TypeScript, modular theo hành vi. Chỉ có config, database và health ở nền này; chưa có auth hay API nghiệp vụ.

Từ root: `pnpm dev:api`; build `pnpm --filter @smartsite/backend build`; tests `pnpm --filter @smartsite/backend test`.

Copy `.env.example` thành `.env` trong thư mục này nếu cần chỉnh. `DATABASE_URL` mặc định trùng Postgres local trong Compose. Production bắt buộc DATABASE_URL và CORS_ORIGINS rõ ràng (rỗng tắt CORS); Swagger không công khai ở production. CORS không thay authentication.

GET `/api/v1/health/live` kiểm tra tiến trình; GET `/api/v1/health/ready` thực hiện SELECT 1 có timeout và trả503 khi DB không kết nối được. Lỗi trả về không chứa thông tin kết nối. Pool đóng khi ứng dụng shutdown. HTTP tests kiểm tra CORS, trạng thái DB, config và Swagger.

## Database / migration

Dùng PostgreSQL tại Neon cho môi trường được cấu hình; không tự tạo Neon project. `pg` hiện thực health check. Prisma CLI7.10.0 được khóa stable để validate/migration; chưa sinh Prisma Client vì chưa có domain model. Thêm model thật và generated client/adapter cùng PR nghiệp vụ đầu tiên, không tạo bảng giả để trình diễn ORM.

```sh
pnpm --filter @smartsite/backend db:validate
pnpm --filter @smartsite/backend db:migrate:dev --name <change-name>
pnpm --filter @smartsite/backend db:migrate:deploy
```

Hai lệnh migration chỉ dùng khi schema và migration đã được review. Không tự chạy migration lúc server boot. DIRECT_URL có thể đặt URL Neon direct cho CLI; DATABASE_URL runtime có thể dùng pooled endpoint. Chưa có migration/domain schema và chưa thực hiện migration remote.
