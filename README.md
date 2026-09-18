# SmartSite

Nền ứng dụng Web / Backend / Mobile. AI ở repo riêng `smartsite-ai`, clone cạnh repo này.

## Chạy nhanh bằng Docker

```sh
docker compose -f infra/compose.yaml up -d --build --wait
```

- Web: http://localhost:5173
- Backend live: http://localhost:3000/api/v1/health/live
- Backend database readiness: http://localhost:3000/api/v1/health/ready
- Swagger local: http://localhost:3000/api/docs

Thêm dịch vụ AI (cần checkout `../smartsite-ai` có Dockerfile):

```sh
docker compose -f infra/compose.yaml --profile ai up -d --build --wait
```

AI: http://localhost:8000/docs. Camera/model/OpenAI chưa được triển khai ở tầng foundation; vai trò OpenAI đã được chốt chính thức (hỗ trợ phân tích bằng chứng cho Safety Officer, không thay thế detector gốc và không quyết định quyền Zone). Capability API phản ánh rõ trạng thái từng tính năng. Compose chỉ cho local, ports giới hạn loopback; password PostgreSQL mẫu không dùng cho production.

## Phát triển với hot reload

Cần Node **24.19.0** và pnpm **12.4.2**. Kiểm tra `node --version` trước; nếu máy có nhiều Node, chỉnh PATH tới bản 24. Cài pnpm bằng `npm install --global pnpm@12.4.2`. Không dùng npm để install dependencies của workspace.

```sh
pnpm install --frozen-lockfile
docker compose -f infra/compose.yaml up -d postgres
pnpm dev
```

Nếu container Web/Backend đang chạy, dừng riêng hai service trước để nhường cổng: `docker compose -f infra/compose.yaml stop web backend`.

Copy `.env.example` trong từng app thành `.env` hoặc `.env.local` theo README app nếu muốn đổi cấu hình. Backend mặc định dùng Postgres local; kết nối Neon đặt DATABASE_URL trên server, dùng URL TLS do Neon cấp. Không cần Neon/OpenAI credentials để chạy nền này.

Mobile: đọc [apps/mobile/README.md](apps/mobile/README.md), cài development build trên emulator/thiết bị rồi `pnpm dev:mobile`. Export JavaScript không phải APK/IPA; chưa kiểm thử thiết bị vật lý.

## Cấu trúc

```text
apps/web/            React + Vite + TanStack Query
apps/backend/        NestJS: config, database, health
apps/mobile/         Expo Router + React Native + TanStack Query
packages/api-client/ Client dùng chung Web/Mobile
contracts/           Health v1; contract sự kiện AI sẽ bổ sung theo nghiệp vụ
docs/                Kiến trúc, yêu cầu và kế hoạch
infra/               Dockerfiles và Compose local
```

## Kiểm tra trước PR

```sh
pnpm check
pnpm peers check
pnpm --filter @smartsite/mobile check:dependencies
pnpm --filter @smartsite/backend db:validate
```

CI chạy lint, TypeScript, tests, Web/API build, Mobile JS export, cấu hình Prisma và Docker smoke. Giữ nhánh sau merge. Đọc [CONTRIBUTING.md](CONTRIBUTING.md).

Đã dựng nền kết nối; chưa có đăng nhập/phân quyền, nghiệp vụ MF05/MF06, lưu ảnh, inference hoặc OpenAI calls. Không sử dụng shell hiện tại như hệ thống production. Bước tiếp: chốt contract sự kiện và auth, triển khai MF05 xuyên suốt rồi kết nối camera.
