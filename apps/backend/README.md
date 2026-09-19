# Backend

NestJS 12 / ESM / TypeScript, modular theo hành vi. Nền hiện tại có health API và contract ingestion kỹ thuật cho MF05/MF06; chưa có đăng nhập người dùng hay các workflow nghiệp vụ hoàn chỉnh.

Từ root: `pnpm dev:api`; build `pnpm --filter @smartsite/backend build`; tests `pnpm --filter @smartsite/backend test`.

Copy `.env.example` thành `.env` trong thư mục này nếu cần chỉnh. `DATABASE_URL` mặc định trùng Postgres local trong Compose. Production bắt buộc DATABASE_URL và CORS_ORIGINS rõ ràng (rỗng tắt CORS); Swagger không công khai ở production. CORS không thay authentication.

GET `/api/v1/health/live` kiểm tra tiến trình; GET `/api/v1/health/ready` thực hiện SELECT 1 có timeout và trả 503 khi DB không kết nối được. POST `/api/v1/integrations/ai/events` nhận contract `TechnicalObservationEvent`, yêu cầu Bearer token dịch vụ, giữ raw event, kiểm tra idempotency và tạo/nhóm cảnh báo kỹ thuật khi đủ ngữ cảnh. Lỗi persistence trả thông báo 503 đã làm sạch, không log raw payload. Pool đóng khi ứng dụng shutdown.

## Database / migration

Dùng PostgreSQL tại Neon cho môi trường được cấu hình; không tự tạo Neon project. Tầng dữ liệu sử dụng TypeORM Data Mapper (`@nestjs/typeorm` + `typeorm`) cùng driver `pg`. Cấu hình `synchronize: false` bắt buộc ở mọi môi trường. Entities và migration nền MF05/MF06 hiện đã có cho Site, Camera, Zone, observation region, raw AI event, Safety Alert và detection mapping.

Không tự động sync schema hay chạy migration lúc server boot. Mọi thay đổi schema phải thông qua TypeORM migration files được review kỹ lưỡng. TypeORM CLI dùng chung cấu hình DataSource và validateEnvironment với NestJS runtime (`src/database/typeorm.data-source.ts`). CLI tự động nạp `apps/backend/.env` cross-platform, trong khi các biến môi trường thực tế của tiến trình (`process.env`) luôn có quyền ưu tiên ghi đè.

Mỗi script migration tự động build trước khi chạy TypeORM CLI. Runtime dùng `DATABASE_URL` (kết nối pooled); migration CLI ưu tiên kết nối direct/unpooled theo thứ tự: `DIRECT_URL > DATABASE_URL_UNPOOLED > DATABASE_URL`. Điều này đảm bảo an toàn cho migration (tránh lỗi advisory lock hay transaction state trên pooled connection) trong khi vẫn tận dụng được connection pooling khi chạy backend server.

```sh
# Xem trạng thái migration trên môi trường hiện tại (local hoặc Neon)
pnpm --filter @smartsite/backend db:migrate:show

# Chạy migrations
pnpm --filter @smartsite/backend db:migrate:run

# Hoàn tác migration gần nhất
pnpm --filter @smartsite/backend db:migrate:revert
```

Docker Compose chạy service `migrate` trước Backend. Với môi trường ngoài Compose (như Staging/Production trên Neon), chạy `db:migrate:run` trước khi triển khai phiên bản Backend mới. Tuyệt đối không commit tệp `.env`, `.env.local` hoặc chứa secret vào Git.

