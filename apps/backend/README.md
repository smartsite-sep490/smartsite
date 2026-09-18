# Backend

NestJS 12 / ESM / TypeScript, modular theo hành vi. Chỉ có config, database và health ở nền này; chưa có auth hay API nghiệp vụ.

Từ root: `pnpm dev:api`; build `pnpm --filter @smartsite/backend build`; tests `pnpm --filter @smartsite/backend test`.

Copy `.env.example` thành `.env` trong thư mục này nếu cần chỉnh. `DATABASE_URL` mặc định trùng Postgres local trong Compose. Production bắt buộc DATABASE_URL và CORS_ORIGINS rõ ràng (rỗng tắt CORS); Swagger không công khai ở production. CORS không thay authentication.

GET `/api/v1/health/live` kiểm tra tiến trình; GET `/api/v1/health/ready` thực hiện SELECT 1 có timeout và trả503 khi DB không kết nối được. Lỗi trả về không chứa thông tin kết nối. Pool đóng khi ứng dụng shutdown. HTTP tests kiểm tra CORS, trạng thái DB, config và Swagger.

## Database / migration

Dùng PostgreSQL tại Neon cho môi trường được cấu hình; không tự tạo Neon project. Tầng dữ liệu sử dụng TypeORM Data Mapper (`@nestjs/typeorm` + `typeorm`) cùng driver `pg`. Cấu hình `synchronize: false` bắt buộc ở mọi môi trường (development và production) để đảm bảo schema luôn được kiểm soát qua reviewed migrations. Entities và migrations sẽ được thêm cùng PR nghiệp vụ đầu tiên; không tạo bảng giả để trình diễn ORM.

Không tự động sync schema hay chạy migration lúc server boot. Mọi thay đổi schema phải thông qua TypeORM migration files được review kỹ lưỡng. TypeORM CLI dùng chung cấu hình DataSource và validateEnvironment với NestJS runtime (`src/database/typeorm.data-source.ts`). CLI tự động nạp `apps/backend/.env` cross-platform, trong khi các biến môi trường thực tế của tiến trình (`process.env`) luôn có quyền ưu tiên ghi đè.

Mỗi script migration tự động kích hoạt `pnpm build` trước khi chạy TypeORM CLI để đảm bảo DataSource luôn là bản biên dịch mới nhất, tránh lỗi thiếu file trên fresh checkout.

```sh
pnpm --filter @smartsite/backend db:migrate:show
pnpm --filter @smartsite/backend db:migrate:run
pnpm --filter @smartsite/backend db:migrate:revert
```

Chưa có migration/domain schema và chưa thực hiện migration remote.
