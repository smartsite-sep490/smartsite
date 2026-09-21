# Backend

NestJS 12, ESM và TypeScript trong pnpm workspace hiện tại. Backend sở hữu dữ liệu và quyết định nghiệp vụ; AI chỉ cung cấp bằng chứng kỹ thuật. Nền hiện có health API và ingestion MF05/MF06, chưa có đăng nhập người dùng, RBAC hay workflow nghiệp vụ hoàn chỉnh.

## Chạy local

Chạy từ repository root với Node.js 24.x, pnpm 12.4.2 và Docker Compose như [README gốc](../../README.md). Các lệnh sau dùng được trên PowerShell và Linux; lệnh copy giữ nguyên file cấu hình đã có:

```sh
pnpm install --frozen-lockfile
node -e "const fs=require('node:fs'); if (!fs.existsSync('apps/backend/.env')) fs.copyFileSync('apps/backend/.env.example','apps/backend/.env')"
docker compose -f infra/compose.yaml up -d postgres --wait --wait-timeout 60
pnpm --filter @smartsite/backend db:migrate:run
pnpm dev:api
```

API: `http://localhost:3000/api/v1`; Swagger chỉ trong development tại `http://localhost:3000/api/docs`. `pnpm dev` chạy cả Web và Backend. Dùng `pnpm --filter @smartsite/backend build` rồi `pnpm --filter @smartsite/backend start` để chạy bản đã build.

## Ranh giới module

```text
AppModule
  ├── ConfigModule       → cấu hình Zod đã kiểm tra
  ├── LoggerModule       → log Pino đã làm sạch
  ├── HealthModule       → DatabaseModule
  └── AiIntegrationModule
        ├── DatabaseModule
        ├── AuthModule
        ├── ZonesModule
        └── SafetyModule → ZonesModule
```

| Vị trí                              | Trách nhiệm                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `app.module.ts`, `configure-app.ts` | Ghép module; bootstrap HTTP dùng chung cho runtime và test.                                 |
| `config/`                           | Schema môi trường và kiểu suy ra; cấu hình CLI độc lập với HTTP.                            |
| `database/`                         | TypeORM Data Mapper, entities, migration, kết nối và readiness.                             |
| `common/http/`, `observability/`    | Request ID, lỗi công khai, giới hạn request và log an toàn.                                 |
| `modules/health`                    | Liveness và readiness qua DatabaseModule.                                                   |
| `modules/auth`                      | Guard xác thực token dịch vụ AI; chưa phải xác thực người dùng.                             |
| `modules/zones`                     | Resolve Site/Camera/Region/Zone và kiểm tra quyền Zone theo ngữ cảnh.                       |
| `modules/safety/alerts`             | Đánh giá ứng viên và nhóm cảnh báo; dùng dịch vụ được ZonesModule export.                   |
| `integrations/ai`                   | Điều phối ingest, raw payload, idempotency và transaction; dùng Database/Auth/Zones/Safety. |

Controller chỉ xử lý HTTP. Module gọi provider được export của module khác, không đọc persistence nội bộ. Chỉ thêm module khi có hành vi thật; không thêm repository tổng quát, base service hay folder chờ tính năng. Quy tắc chi tiết ở [AGENTS.md](AGENTS.md).

## Cấu hình môi trường

Zod kiểm tra cấu hình trước khi khởi động; `BackendEnvironment` được suy ra từ schema. Service dùng `ConfigService<BackendEnvironment, true>`, không tự đọc `process.env` hay đặt fallback chưa kiểm tra. Khi thêm biến, cập nhật schema, `.env.example`, tài liệu và regression test cùng nhau.

Runtime development đọc `apps/backend/.env`; biến đã có trong process có ưu tiên cao hơn. Runtime production và test bỏ qua file này. Phải đặt `NODE_ENV` **trước khi import ứng dụng**; không dùng giá trị trong `.env` để chuyển sang production/test. Test runner tự đặt `NODE_ENV=test` trước import và loại cấu hình runtime thừa hưởng.

Ví dụ chạy production sau build (các biến bắt buộc phải được cấp qua môi trường hoặc secret manager):

```powershell
# PowerShell
$env:NODE_ENV = 'production'
pnpm --filter @smartsite/backend start
```

```sh
# Linux/macOS
NODE_ENV=production pnpm --filter @smartsite/backend start
```

| Biến                                              | Mặc định local / ý nghĩa                                                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                        | `development`; nhận `development`, `test`, `production`.                                                                                                   |
| `PORT`                                            | `3000`.                                                                                                                                                    |
| `DATABASE_URL`                                    | PostgreSQL local của Compose; production bắt buộc cấp rõ ràng.                                                                                             |
| `DATABASE_TIMEOUT_MS`                             | `2000`; timeout kết nối/readiness.                                                                                                                         |
| `CORS_ORIGINS`                                    | `http://localhost:5173`; danh sách origin HTTP(S) chính xác, phân cách dấu phẩy. Production bắt buộc cấp; chuỗi rỗng tắt quyền đọc từ browser khác origin. |
| `SMARTSITE_AI_SERVICE_TOKEN`                      | Token giả local trong `.env.example`; production bắt buộc secret riêng, không rỗng, không whitespace và không dùng token mặc định.                         |
| `LOG_LEVEL`                                       | `info`; nhận `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`.                                                                                 |
| `LOG_FORMAT`                                      | `pretty` ở development, `json` ở test/production. Container Compose đặt rõ `json` vì image runtime chỉ chứa production dependencies.                       |
| `HTTP_RATE_LIMIT_TTL_MS`, `HTTP_RATE_LIMIT_LIMIT` | `60000`, `120`: cửa sổ và quota HTTP thông thường.                                                                                                         |
| `AI_RATE_LIMIT_TTL_MS`, `AI_RATE_LIMIT_LIMIT`     | `60000`, `600`: quota riêng cho AI ingestion.                                                                                                              |
| `ALERT_COOLDOWN_SECONDS`                          | `60`; cooldown nhóm cảnh báo hiện có.                                                                                                                      |
| `MAX_PAST_EVENT_AGE_SECONDS`                      | `300`; giới hạn tuổi event.                                                                                                                                |
| `MAX_FUTURE_CLOCK_SKEW_SECONDS`                   | `30`; sai lệch thời gian tương lai cho phép.                                                                                                               |

TTL/quota rate limit phải là chuỗi số nguyên dương an toàn; TTL tối đa `2147483647` ms để không tràn bộ đếm thời gian của Node. `DIRECT_URL` và `DATABASE_URL_UNPOOLED` chỉ chọn kết nối migration; `TEST_DATABASE_URL` chỉ dành cho integration test. Không dùng URL test làm fallback runtime. Không commit `.env`, `.env.test`, connection string thật hay service token.

## HTTP, lỗi và log

- Giữ prefix `/api/v1`; Swagger UI/schema chỉ mở trong development. JSON và urlencoded có giới hạn 1 MB.
- Global `ValidationPipe` whitelist DTO và từ chối field lạ; không bật chuyển kiểu ngầm. Field cần chuyển kiểu phải khai báo rõ. Body AI vẫn là `unknown`, giữ nguyên đến Ajv/canonical contract validation và hashing; không dùng DTO transformation để thay raw payload.
- Helmet bật security headers. CORS chỉ cho origin được cấu hình, cho phép gửi và đọc `X-Request-Id`, không bật credentials. Không bật `trust proxy`; cần cấu hình proxy được tin cậy trước khi triển khai sau ingress.
- Response header, error body và log dùng cùng `X-Request-Id`. Chấp nhận đúng một header khớp `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` (1–64 ký tự); header thiếu, không hợp lệ hoặc lặp lại được thay bằng UUID do server tạo.
- Lỗi công khai có envelope dưới đây. `message` có thể là chuỗi hoặc mảng chuỗi validation; `timestamp` là UTC RFC 3339, `path` không chứa query string. Chỉ chi tiết được cho phép như AI `issues` và readiness `status`, `service`, `database` được giữ lại; không trả lỗi SQL/driver, stack hay credentials.

```json
{
  "success": false,
  "statusCode": 400,
  "code": "BAD_REQUEST",
  "message": "Bad Request",
  "requestId": "27f0949c-b08d-49c8-a22b-8f788c665b71",
  "timestamp": "2026-09-21T00:00:00.000Z",
  "path": "/api/v1/example"
}
```

Pino ghi log có request ID và ngữ cảnh vận hành đã làm sạch; không ghi request body, raw evidence, query string, Authorization/cookie, token hoặc database URL. Thông báo lỗi và cause cũng phải được làm sạch. `pino-pretty` chỉ phục vụ development ngoài container.

Rate limit dùng bộ nhớ **của từng instance**, không chia sẻ giữa replica. Health live/ready được miễn; AI dùng quota riêng, không bị áp đồng thời quota HTTP mặc định. Khi vượt quota trả `429` và `Retry-After`. Các mức 120/600 mỗi phút là cấu hình khởi điểm, không phải throughput đã benchmark; cần điều chỉnh theo số camera, retry/backpressure, ingress và số replica thực tế.

`GET /api/v1/health/live` chỉ kiểm tra tiến trình. `GET /api/v1/health/ready` chạy `SELECT 1` có timeout, trả `503` khi database không sẵn sàng. `POST /api/v1/integrations/ai/events` yêu cầu Bearer token dịch vụ, bảo toàn raw event, kiểm tra idempotency và tạo/nhóm cảnh báo kỹ thuật khi đủ ngữ cảnh. Pool đóng khi shutdown. Health không chứng minh model, quyền người dùng hay camera đã sẵn sàng; xem [health contract](../../contracts/health-v1.md).

## Database và migration

TypeORM Data Mapper (`@nestjs/typeorm`, `typeorm`, `pg`) quản lý Site, Camera, Zone, observation region, raw AI event, Safety Alert và detection mapping. `synchronize: false` và `migrationsRun: false` ở mọi môi trường; không chạy migration trong lúc server boot. Thay đổi schema cần migration được review và integration test với PostgreSQL thật.

CLI dùng `src/database/typeorm.data-source.ts` với cấu hình **chỉ cho database**, không yêu cầu CORS, service token hay logging. Development đọc `apps/backend/.env`; test/production không đọc file này. Chọn nhóm URL trong process trước nhóm trong file; trong nhóm đã chọn, thứ tự là `DIRECT_URL > DATABASE_URL_UNPOOLED > DATABASE_URL`. Một `DATABASE_URL` được truyền vào process vì vậy thắng `DIRECT_URL` cũ trong file. URL Neon pooled bị từ chối cho migration; runtime vẫn dùng pooled `DATABASE_URL`.

Các script sau build rồi mới chạy CLI:

```sh
pnpm --filter @smartsite/backend db:migrate:show
pnpm --filter @smartsite/backend db:migrate:run
pnpm --filter @smartsite/backend db:migrate:revert
pnpm --filter @smartsite/backend db:migrate:generate src/database/migrations/DescribeChange
```

`generate` cần database đã ở migration hiện tại; đọc và review SQL sinh ra trước khi commit. Nếu đã build, gọi CLI trực tiếp để tránh build lại:

```sh
pnpm --filter @smartsite/backend typeorm migration:show -d dist/database/typeorm.data-source.js
pnpm --filter @smartsite/backend typeorm migration:run -d dist/database/typeorm.data-source.js
```

Docker Compose chạy service `migrate` trước Backend. Staging/production phải chạy migration có kiểm soát trước khi deploy phiên bản cần schema mới. Kiểm tra đường rollback và tương thích dữ liệu; `revert` chỉ hoàn tác migration gần nhất, không thay backup.

### Neon local

Không tự tạo Neon project. Đăng nhập Neon CLI, liên kết đúng project rồi kéo riêng biến PostgreSQL vào file mà Backend development thực sự nạp:

```sh
npx neon@latest link --project-id little-cloud-62052905 --branch production --no-env-pull --no-config -y
npx neon@latest env pull --project-id little-cloud-62052905 --branch production --service postgres --file apps/backend/.env
```

`apps/backend/.env` được Git ignore. Không dùng `.env.local` ở repository root vì Backend không tự đọc file đó. Sau khi pull, `DATABASE_URL` là pooled runtime và `DATABASE_URL_UNPOOLED` là direct migration. CI/staging/production cấp biến bằng secret manager. Không dùng database Neon cho integration test.

## Kiểm thử và quality gates

Unit/HTTP tests chạy qua `scripts/run-tests.mjs`: đặt `NODE_ENV=test` trước import, loại các biến cấu hình runtime được thừa hưởng và không đọc `.env` local. HTTP tests dùng database stub; không kết nối database phát triển.

Integration chỉ nhận `TEST_DATABASE_URL` từ process hoặc file `apps/backend/.env.test` được tạo rõ ràng. Không fallback sang `DATABASE_URL`, direct URL hay `.env`. Validator chỉ chấp nhận host `localhost`, `127.0.0.1` hoặc `[::1]`, user và database đều là `smartsite_test`, không query/fragment. DataSource kiểm thử độc lập với runtime/CLI. Runner migrate database test **một lần**, rồi chạy tuần tự các test file (`--test-concurrency=1`); các thao tác đồng thời bên trong test race vẫn giữ nguyên.

```sh
node -e "const fs=require('node:fs'); if (!fs.existsSync('apps/backend/.env.test')) fs.copyFileSync('apps/backend/.env.test.example','apps/backend/.env.test')"
docker compose -f infra/compose.yaml --profile test up -d postgres-test --wait --wait-timeout 60
pnpm --filter @smartsite/backend test
pnpm --filter @smartsite/backend test:integration
```

Profile `test` dùng PostgreSQL 18, `127.0.0.1:5433`, user/database `smartsite_test`, password giả `smartsite_test_only`. Dữ liệu nằm trên tmpfs riêng và mất khi container dừng; không mount volume `postgres-data` của development. Integration tests có quyền thay đổi/xóa fixture trong database test này.

CI truyền `TEST_DATABASE_URL=postgresql://smartsite_test:smartsite_test_only@127.0.0.1:5433/smartsite_test`, không truyền runtime URL vào integration. Một bước riêng kiểm tra CLI migration trên PostgreSQL development; Compose build/readiness smoke vẫn kiểm tra đường chạy ứng dụng đầy đủ.

Chạy các quality gates trước PR và ghi kết quả thực tế:

```sh
pnpm install --frozen-lockfile
pnpm peers check
pnpm check
pnpm --filter @smartsite/mobile check:dependencies
pnpm --filter @smartsite/backend test:integration
docker compose -f infra/compose.yaml up -d --build --wait --wait-timeout 120
node -e "Promise.all(['http://localhost:3000/api/v1/health/ready','http://localhost:5173/healthz'].map(async u=>{const r=await fetch(u,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error(u+': '+r.status)})).catch(e=>{console.error(e.message);process.exit(1)})"
docker compose -f infra/compose.yaml --profile test down
```

Nếu không có Docker/database thì báo rõ phần integration/smoke chưa chạy; build thành công không thay cho các bước này. CI cấu hình ở [application-checks.yml](../../.github/workflows/application-checks.yml). Các lệnh trong tài liệu là hướng dẫn kiểm tra, không phải báo cáo đã pass.

## Dependency và giới hạn hiện tại

| Dependency                             | Lý do                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `zod`                                  | Kiểm tra biến môi trường và suy ra kiểu, tránh schema/type viết lặp.          |
| `class-validator`, `class-transformer` | Kiểm tra DTO tại HTTP boundary; conversion phải khai báo rõ.                  |
| `helmet`                               | Security headers dùng middleware chuẩn.                                       |
| `@nestjs/throttler`                    | Rate limit HTTP/AI có quota riêng.                                            |
| `nestjs-pino`, `pino`, `pino-http`     | Log có cấu trúc và request correlation; sanitizer giới hạn dữ liệu công khai. |
| `pino-pretty` (dev)                    | Đọc log local; không cần trong image runtime.                                 |
| Ajv hiện có trong contracts            | Giữ validation canonical AI contract; không thay bằng DTO/Zod.                |

Đây là nền để nhóm tiếp tục phát triển, chưa phải chứng nhận production. Xác thực người dùng, RBAC, phạm vi Site/Contractor/Zone cho API người dùng, cấu hình proxy, quota chia sẻ nhiều replica, retention/backup và vận hành triển khai còn cần yêu cầu và kiểm chứng riêng. AI không được quyết định danh tính, quyền Zone, vi phạm hay đóng incident. Mọi thay đổi cần một thành viên khác review trước khi merge.
