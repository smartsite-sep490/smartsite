# Backend

NestJS 12, ESM và TypeScript trong pnpm workspace hiện tại. Backend sở hữu dữ liệu và quyết định nghiệp vụ; AI chỉ cung cấp bằng chứng kỹ thuật. Backend có health, tài khoản Admin/Worker, API quản lý cấu hình và ingestion MF05/MF06. Quyền theo từng Site/Zone và workflow nghiệp vụ hoàn chỉnh vẫn là bước sau.

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

Workforce được chia thành các module nghiệp vụ `directory`, `teams`, `scheduling`, `attendance`, `identity`, `access` và `notifications`; `workforce.module.ts` chỉ ghép các module và giữ các export đang được Safety sử dụng. Controller/service/DTO được đặt cạnh nhau theo luồng. Xem [bản đồ Workforce](src/modules/workforce/README.md) để tìm điểm bắt đầu của MF03/MF07, Face/QR và quan hệ giữa các module.

```text
AppModule
  ├── ConfigModule       → cấu hình Zod đã kiểm tra
  ├── LoggerModule       → log Pino đã làm sạch
  ├── HealthModule       → DatabaseModule
  ├── AuthModule         → phiên người dùng và token dịch vụ AI
  ├── UsersModule        → tài khoản Admin/Worker
  ├── SitesModule        → DatabaseModule, AuthModule
  ├── CamerasModule      → DatabaseModule, SitesModule, ZonesModule, AuthModule
  └── AiIntegrationModule
        ├── DatabaseModule
        ├── AuthModule
        ├── ZonesModule
        └── SafetyModule → ZonesModule
```

| Vị trí                              | Trách nhiệm                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `app.module.ts`, `configure-app.ts` | Ghép module; bootstrap HTTP dùng chung cho runtime và test.                               |
| `config/`                           | Schema môi trường và kiểu suy ra; cấu hình CLI độc lập với HTTP.                          |
| `database/`                         | TypeORM Data Mapper, entities, migration, kết nối và readiness.                           |
| `common/http/`, `observability/`    | Request ID, lỗi công khai, giới hạn request và log an toàn.                               |
| `modules/health`                    | Liveness và readiness qua DatabaseModule.                                                 |
| `modules/auth`                      | Đăng nhập người dùng, phiên, guard Admin và token dịch vụ AI.                             |
| `modules/users`                     | Cấp, xem, khóa/mở tài khoản và đặt lại mật khẩu.                                          |
| `modules/sites`                     | Tạo/đọc/đổi tên Site qua API Admin.                                                       |
| `modules/cameras`                   | Quản lý Camera/Region, phiên bản cấu hình và tạo snapshot theo contract AI.               |
| `modules/zones`                     | Quản lý Zone, khóa chính sách sau khi gắn Region, resolve context và kiểm tra quyền Zone. |
| `modules/safety/alerts`             | Đánh giá ứng viên và nhóm cảnh báo; dùng dịch vụ được ZonesModule export.                 |
| `integrations/ai`                   | Ingest observation và cấp snapshot theo danh sách camera cho AI.                          |

Controller chỉ xử lý HTTP. Module gọi provider được export của module khác, không đọc persistence nội bộ. Chỉ thêm module khi có hành vi thật; không thêm repository tổng quát, base service hay folder chờ tính năng. Quy tắc chi tiết ở [AGENTS.md](AGENTS.md).

## Review danh tính trong một quan sát

`SafetyModule` đăng ký API review thủ công tại
`GET /api/v1/sites/:siteId/safety-alerts/:alertId/detections/:eventId/identity-subjects`,
picker `/workers`, và history/command `/:personObservationIndex/decisions`.
Mọi route yêu cầu tài khoản active đã đổi mật khẩu tạm và vai trò Safety Officer đúng Site;
Admin đơn thuần không có quyền review danh tính.

Reader dùng `WorkforceConfigurationService` được export hiện có, đọc Worker theo UUID + Site.
RESOLVE khóa Worker trong chính transaction lưu quyết định; picker phân trang chỉ trả
`id`, `siteId`, `externalId`, `displayName`, `isActive`. Không tạo danh bạ thứ hai hoặc gọi face model.
Review chỉ thuộc một PERSON trong một event; correction/CLEAR giữ audit và không cấp quyền
Zone, sửa quyết định vào vùng gốc, hay truyền danh tính sang Track/event/camera khác.

Trước khi triển khai source này, chạy migration theo quy trình triển khai đã duyệt và xác nhận
hai bảng observation identity tồn tại; ứng dụng không tự migrate lúc startup.
Không revert migration chứa audit nếu chưa có backup và kế hoạch khôi phục được duyệt.
Triển khai với dữ liệu thật còn cần chốt retention/access policy; kiểm chứng local sử dụng
dữ liệu synthetic và database riêng, không tự apply migration lên Neon.

## Lưu trữ lịch sử quyền Zone

Migration `1791417600000-ZoneAuthorityHistory` bổ sung grant Contractor → Zone,
command/fact audit và epoch theo Site. Assignment và Worker grant có anchor
Contractor bất biến; bản ghi cũ giữ `NULL`, không backfill từ Worker hiện tại.
Migration không tạo grant, baseline history hay epoch `READY`.

Writer tạo Zone và sửa policy đã ghi projection, command attribution và fact trong cùng
transaction SERIALIZABLE. Validator kiểm tra payload đóng cho 7 loại fact, scope và trạng
thái thật của source; revision được tính dưới row lock bằng bigint. Retry toàn transaction
chỉ áp dụng cho SQLSTATE40001/40P01, tối đa3 lần; hết lượt trả SERVICE_UNAVAILABLE.
Command cùng ID/actor/request canonical trả lại facts đã lưu; dùng lại ID với request
khác bị từ chối. Zone HTTP chưa nhận idempotency key từ client: mỗi lần gọi tạo command ID
mới. USER lấy từ authentication context; lời gọi nội bộ ghi SERVICE, không giả danh USER.
Mỗi command giới hạn64KiB request và64 facts; vượt giới hạn bị từ chối, không cắt dữ liệu.

Mười thao tác Workforce hiện có cũng ghi projection và history cùng transaction:
tạo Contractor/participation/Worker, gửi phân công, Safety review, Manager quyết định;
và tạo Worker/chuẩn bị tài khoản/liên kết tài khoản/tạo Contractor theo Site. Actor USER
active được đọc lại trong transaction; role quản trị/review của các thao tác tương ứng
không dựa riêng vào snapshot đăng nhập. Participation/Worker/Zone eligibility được kiểm
tra trên cùng manager. Phân công mới lưu Contractor anchor; positive review từ chối
nếu Worker đã chuyển Contractor. Bản ghi legacy NULL vẫn giữ hành vi phân công cũ,
không biến thành lịch sử ownership đầy đủ hoặc quyền Zone.

HTTP Workforce truyền USER từ context; SERVICE chỉ dành cho lời gọi nội bộ. Chuẩn bị/
liên kết tài khoản giữ scope endpoint hiện có; account link không chứng minh Worker
đang có mặt trước camera. Mỗi lời gọi mới tạo command mới; record idempotency không
đồng nghĩa HTTP retry chỉ ghi một audit. Fact membership không chứa account/Face profile.

Worker Zone grant create/revoke cũng ghi grant, command và history cùng transaction.
Grant mới lưu Contractor anchor từ Worker lúc cấp; revoke legacy giữ NULL. Thu hồi
khóa grant row và giữ timestamp đã lưu đầu tiên; API dùng giờ DB mặc định, caller retry
không ghi đè timestamp. USER được kiểm lại global Admin trong transaction. Mỗi lần gọi
mới vẫn là một command mới; noop revoke ghi confirmation fact của giá trị đã lưu.

Contractor Zone grant có internal create/revoke command với actor bắt buộc; USER phải
còn global Admin. Create kiểm active participation của Contractor đúng Site tại giờ
DB trong transaction qua query của Workforce; revoke vẫn được sau khi participation
hoặc Contractor đã disable. Ceiling, command và history commit/rollback cùng nhau;
row lock giữ revocation đầu tiên. Chưa có public API/provider runtime cho command này;
không sinh Worker grant hoặc bật authority từ participation. Kiểm command-time không
chứng minh participation bao phủ toàn khoảng đề xuất hoặc lịch sử đã COMPLETE.

Worker ALLOW create kiểm toàn khoảng cấu hình trong cùng transaction: active Worker/
Contractor hiện tại, participation active, assignment APPROVED có Contractor anchor
đúng và Contractor ALLOW phải bao phủ toàn khoảng; Contractor DENY chồng thời gian
chặn cấp. Adjacent intervals hợp lệ, gap1ms hoặc finite coverage cho end vô hạn bị
từ chối409 CONFLICT, không để lại command/grant/history. DENY issuance và revoke legacy
giữ behavior trước. Query Workforce dùng caller manager; current sources được read-lock
và serialization conflict retry cả transaction. Existing legacy grant không bị rewrite.

GRANT_CREATION prerequisites chỉ là dữ liệu cho command hiện tại, không phải COMPLETE
snapshot, xác minh Face hay quyền live. Backdated validFrom không chứng minh lịch sử
ownership/quyền được biết khi camera chụp; các quyết định gốc không được sửa. Đã có
reader historical nội bộ; runtime quyền hai tầng còn cần tích hợp. Create trước một DENY
mới có thể là thứ tự serial hợp lệ; runtime phải recheck cả hai tầng, không dựa vào việc
Worker ALLOW đã từng được cấp. Không dùng async child cascade như cơ chế đúng duy nhất.
Lịch sử chưa đủ để bật epoch READY hoặc xác minh Worker live; chỉ có bảng/digest không
chứng minh completeness. Anchor legacy NULL giữ nguyên, không suy từ membership hiện tại.
Worker assignment không tự cấp quyền Zone. Không áp dụng migration tự động lúc startup
hoặc lên Neon chưa duyệt. Migration phải chạy trước source sử dụng các bảng audit.

`ZoneAuthoritySnapshotService` đọc lịch sử qua cùng caller SERIALIZABLE manager;
query được export từ Workforce giữ membership xuyên Site, global Contractor và cả
participation/assignment inactive. Selector kiểm payload đóng, revision liên tục theo
source, thời gian không đi ngược và đối soát latest fact với current source inventory.
Current rows chỉ kiểm drift, không thay thế state tại `capturedAt`. Snapshot giữ cả
negative facts và provenance; giới hạn2048 facts/sources và2MiB JSON, overflow trả
UNAVAILABLE thay vì truncate. Assignment inventory hiện đọc toàn bộ Site theo Worker;
quota2048 vì vậy tính cả phân công ở Site khác, chưa có compaction cho Worker lâu năm.
SQL lỗi được truyền về transaction retry; chỉ40001/40P01 được retry tự động.

Reader chưa được đăng ký runtime. Mặc định không có coverage attestation nên trả
UNAVAILABLE; chỉ nhận một epoch READY có đúng writer-manifest đã được owner duyệt.
Attestation là điều kiện bên ngoài, không phải thuật toán tự chứng minh baseline đầy đủ.
READY/manifest trong integration test là synthetic, không phải cutover dữ liệu thật.
Artifact có SHA-256/JCS để đối chiếu payload đã dùng; hash không chứng minh identity,
authenticity hay coverage. B3 còn phải lưu assessment/snapshot cùng transaction,
validate artifact khi replay, giữ quyết định gốc và append retrospective review riêng.
Replay legacy chưa có stored snapshot trả UNAVAILABLE, không đọc current rows để dựng lại.
Chưa bật live identity, public endpoint mới hay thay đổi quyền trên demo/Neon.

Audit đã có dữ liệu chặn UPDATE/DELETE và TRUNCATE kể cả qua CASCADE; bảng audit rỗng
cho phép cleanup. Downgrade từ chối nếu có grant Contractor, command/fact/epoch hoặc
anchor mới để giữ dữ liệu; dùng forward migration khi cần sửa schema đã có audit.
Các suite authentication/JWT/migration/configuration, assignment review và account-face
templates dùng schema test riêng trên database
local đã kiểm tra; cleanup chỉ xóa schema do suite đó tạo, không truncate audit của suite khác.

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

| Biến                                              | Mặc định local / ý nghĩa                                                                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                        | `development`; nhận `development`, `test`, `production`.                                                                                                          |
| `PORT`                                            | `3000`.                                                                                                                                                           |
| `DATABASE_URL`                                    | PostgreSQL local của Compose; production bắt buộc cấp rõ ràng.                                                                                                    |
| `DATABASE_TIMEOUT_MS`                             | `2000`; timeout kết nối/readiness.                                                                                                                                |
| `CORS_ORIGINS`                                    | `http://localhost:5173`; danh sách origin HTTP(S) chính xác, phân cách dấu phẩy. Production bắt buộc cấp; chuỗi rỗng tắt quyền đọc từ browser khác origin.        |
| `AUTH_JWT_SECRET`                                 | Secret ký JWT HS256; production bắt buộc giá trị riêng dài ít nhất 32 ký tự, không whitespace và không dùng secret local.                                         |
| `SMARTSITE_AI_SERVICE_TOKEN`                      | Token giả local trong `.env.example`; production bắt buộc secret riêng dài ít nhất 32 ký tự, không whitespace và không dùng token mặc định.                       |
| `AI_CONFIGURATION_CAMERA_IDS`                     | Danh sách UUID camera mà AI được tải cấu hình; mặc định rỗng và từ chối mọi camera.                                                                               |
| `EVIDENCE_LOCAL_ROOT`                             | Thư mục tuyệt đối tùy chọn cho JPEG evidence local khi development/demo; phải là thư mục thật, không phải symlink/junction. Production dùng object storage riêng. |
| `LOG_LEVEL`                                       | `info`; nhận `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`.                                                                                        |
| `LOG_FORMAT`                                      | `pretty` chỉ hợp lệ ở development; test/production dùng `json`. Image runtime không chứa `pino-pretty`.                                                           |
| `HTTP_RATE_LIMIT_TTL_MS`, `HTTP_RATE_LIMIT_LIMIT` | `60000`, `120`: cửa sổ và quota HTTP thông thường.                                                                                                                |
| `AI_RATE_LIMIT_TTL_MS`, `AI_RATE_LIMIT_LIMIT`     | `60000`, `600`: quota riêng cho AI ingestion.                                                                                                                     |
| `ALERT_COOLDOWN_SECONDS`                          | `60`; cooldown nhóm cảnh báo hiện có.                                                                                                                             |
| `MF06_ENQUEUE_ENABLED`                            | `false`; explicit `true` enables atomic assessment request/job enqueue after a fresh event INSERT. It never starts an identity/model worker.                      |
| `MF06_ENQUEUE_MAX_OUTSTANDING`                    | Required when enqueue is enabled, integer `1..10000`; schema-wide cap includes every PENDING/CLAIMED job, even expired work.                                      |
| `MAX_PAST_EVENT_AGE_SECONDS`                      | `300`; giới hạn tuổi event.                                                                                                                                       |
| `MAX_FUTURE_CLOCK_SKEW_SECONDS`                   | `30`; sai lệch thời gian tương lai cho phép.                                                                                                                      |

TTL/quota rate limit phải là chuỗi số nguyên dương an toàn; TTL tối đa `2147483647` ms để không tràn bộ đếm thời gian của Node. `DIRECT_URL` và `DATABASE_URL_UNPOOLED` chỉ chọn kết nối migration; `TEST_DATABASE_URL` chỉ dành cho integration test. Không dùng URL test làm fallback runtime. Không commit `.env`, `.env.test`, connection string thật hay service token.

Tạo service token production từ ít nhất 32 byte ngẫu nhiên, ví dụ `openssl rand -base64 32`, rồi cấp qua secret manager; không ghi kết quả vào Git.

## HTTP, lỗi và log

- Giữ prefix `/api/v1`; Swagger UI/schema chỉ mở trong development. JSON và urlencoded có giới hạn 1 MB.
- Global `ValidationPipe` whitelist DTO và từ chối field lạ; không bật chuyển kiểu ngầm. Field cần chuyển kiểu phải khai báo rõ. Body AI vẫn là `unknown`, giữ nguyên đến Ajv/canonical contract validation và hashing; không dùng DTO transformation để thay raw payload.
- Helmet bật security headers. CORS chỉ cho origin được cấu hình, cho phép credentials và gửi/đọc `X-Request-Id`; không dùng wildcard origin. Không bật `trust proxy`; cần cấu hình proxy được tin cậy trước khi triển khai sau ingress.
- Response header, error body và log dùng cùng `X-Request-Id`. Chấp nhận đúng một header khớp `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` (1–64 ký tự); header thiếu, không hợp lệ hoặc lặp lại được thay bằng UUID do server tạo.
- Lỗi công khai có envelope dưới đây. `message` luôn là chuỗi; lỗi validation đặt chi tiết ổn định trong `issues` với JSON Pointer `path`. Chỉ `PublicHttpException` có kiểu mới được đưa message/code/chi tiết ra client; các `HttpException` khác dùng thông báo an toàn theo status. `timestamp` là UTC RFC 3339, `path` không chứa query string. Chỉ AI `issues` và readiness `status`, `service`, `database` được giữ lại; không trả lỗi SQL/driver, stack hay credentials.

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

Pino ghi log có request ID và ngữ cảnh vận hành đã làm sạch đệ quy; không ghi request body, raw evidence, query string, Authorization/cookie, token hoặc database URL dù nằm trong object/array lồng nhau. Thông báo lỗi và cause cũng được làm sạch. `pino-pretty` chỉ phục vụ development ngoài container.

Rate limit dùng bộ nhớ **của từng instance**, không chia sẻ giữa replica. Health live/ready được miễn; AI dùng quota riêng, không bị áp đồng thời quota HTTP mặc định. Khi vượt quota trả `429` và `Retry-After`. Các mức 120/600 mỗi phút là cấu hình khởi điểm, không phải throughput đã benchmark; cần điều chỉnh theo số camera, retry/backpressure, ingress và số replica thực tế.

`GET /api/v1/health/live` chỉ kiểm tra tiến trình. `GET /api/v1/health/ready` đọc lịch sử migration trong schema thực của TypeORM với timeout hiện có. Mỗi migration mà release yêu cầu phải có đúng tên/timestamp; thiếu bảng lịch sử, thiếu migration hoặc DB không truy cập được trả `503 DATABASE_UNAVAILABLE` theo envelope hiện có. Probe không tạo bảng/chạy migrations và không fallback sang schema khác. `database: down` có nghĩa DB chưa dùng được cho release, kể cả khi kết nối vẫn hoạt động. Đây không phải kiểm toán schema drift, checksum SQL hay chứng nhận rollback compatibility; phải migrate/verify trước deploy. `POST /api/v1/integrations/ai/events` yêu cầu Bearer token dịch vụ, bảo toàn raw event, kiểm tra idempotency và tạo/nhóm cảnh báo kỹ thuật khi đủ ngữ cảnh. Pool đóng khi shutdown. Health không chứng minh model, quyền người dùng hay camera đã sẵn sàng; xem [health contract](../../contracts/health-v1.md).

Runtime `main.ts` dùng `BoundedExpressAdapter`. Khi Nest bắt đầu shutdown (`SIGINT`, `SIGTERM` hoặc `app.close()`), HTTP middleware trả `503 SERVICE_UNAVAILABLE` cho request mới trước body parsing/controller I/O, giữ request ID, Helmet và CORS. Request đã nhận được tiếp tục; sau tối đa 30 giây kể từ `beforeClose`, adapter ngắt HTTP connections còn lại và ghi warning deadline. Đây là nhánh disconnect cưỡng bức, không phải bằng chứng command đã hủy, transaction rollback hay shutdown graceful. Với Nest hiện tại, TypeORM đóng pool sau HTTP dispose; không tự force-close pool hoặc `process.exit`.

Giới hạn này dành cho HTTP/1 connections, không bao gồm upgraded sockets/HTTP2 hay bảo đảm các lifecycle hooks/DB jobs hoàn tất trong 30 giây. Fixture kiểm request body gửi dở, command đã nhận và safe503; PostgreSQL transactions thật, container/Linux SIGTERM, ports/timers/pool và crash recovery vẫn cần kiểm riêng. Launcher dùng Express adapter mặc định không tự nhận thay đổi này nếu chưa đổi bootstrap. Không bật `forceCloseConnections` vì nó có thể ngắt ngay request đã được nhận.

Safety Alert detail chỉ trả metadata evidence đã tuyển chọn. Admin global hoặc Safety Officer đúng Site có thể tải JPEG qua `GET /api/v1/sites/:siteId/safety-alerts/:alertId/detections/:eventId/evidence/:evidenceIndex`. Route kiểm tra Site, alert-event mapping, URI, root/file containment, loại và kích thước file; response dùng `private, no-store` và không trả raw URI hay filesystem path. Adapter local bị tắt khi không cấu hình `EVIDENCE_LOCAL_ROOT`; xem [runbook MF05/MF06](../../docs/operations/mf05-mf06-local-demo.md).

## Database và migration

TypeORM Data Mapper (`@nestjs/typeorm`, `typeorm`, `pg`) quản lý Site, Camera, Zone, observation region, raw AI event, Safety Alert và detection mapping. `synchronize: false` và `migrationsRun: false` ở mọi môi trường; không chạy migration trong lúc server boot. Thay đổi schema cần migration được review và integration test với PostgreSQL thật.

Contractor là thực thể toàn cục, có thể tham gia nhiều Site qua `contractor_site_participation` theo khoảng thời gian hiệu lực. API MF07 dưới `/sites/:siteId/contractors` tạo Contractor mới hoặc liên kết Contractor cùng `code` và `name` vào Site trong một transaction; mã đã tồn tại với tên khác hoặc Contractor inactive bị từ chối. Representative cần role đúng Site và `contractor_representative_assignment` của Site đó để thao tác lịch; thao tác gán này đồng thời tạo `contractor_representative_grant` cho các luồng workforce/face-gate trên main. Participation hết hiệu lực không cấp quyền MF07 mới. Worker Schedule chỉ do Representative được gán phân công; Site Manager tạo/giao ca cho Contractor, Admin không phân ca Worker.

Khi nâng cấp database đã chạy migration MF07 cũ trước `IdentityAccessScope`, migration chuyển `contractor.site_id` sang participation và backfill grant mà không đổi ID Contractor/Worker. Các `code` Contractor trùng giữa nhiều Site sẽ chặn migration vì `code` giờ duy nhất toàn cục; cần đối chiếu và xử lý dữ liệu sau khi sao lưu, không tự đổi mã. Chạy migration trên bản sao trước khi áp dụng cho database thật; không rollback migration này khi MF07 cũ vẫn sở hữu dữ liệu.

Admin quản lý Site/Camera/Region; Site Manager được gán cho Site quản lý Contractor, tài khoản đại diện và cấu hình Zone. Tài khoản mới dùng được mật khẩu ngay. Mỗi Site chỉ có tối đa một assignment SITE_MANAGER, kể cả tài khoản disabled; migration SingleSiteManager1791936000000 chặn dữ liệu cũ trùng quản lý để nhóm xác định người phụ trách. POST /sites/:siteId/contractors/:contractorId/representative-accounts tạo tài khoản và liên kết nhà thầu atomically, chỉ chấp nhận username/displayName/temporaryPassword. GET /sites/:siteId/representative-accounts chỉ trả đại diện của Site. Admin vẫn có thể đọc Zone, nhưng không tạo hoặc sửa Zone. Camera có `configurationVersion`; mỗi thao tác sửa Region hoặc trạng thái Camera phải gửi revision hiện tại và được thực hiện trong transaction. Sau khi Zone đã gắn Region, `type`, `restrictionPolicy` và `requiredPpe` bị khóa vĩnh viễn; tên vẫn sửa được. Snapshot chỉ gồm các Region active và được kiểm tra bằng contract Backend–AI trước khi trả. `siteId` trong service chỉ giới hạn dữ liệu, không tự chứng minh quyền người dùng.

### Tài khoản và API cấu hình

Chạy migration trước, sau đó tạo Admin đầu tiên bằng terminal tương tác:

```sh
pnpm --filter @smartsite/backend db:migrate:run
pnpm --filter @smartsite/backend auth:bootstrap-admin
```

Mặc định lệnh bootstrap hỏi username, tên và mật khẩu tạm qua terminal; mật khẩu không hiển thị và không truyền trong command line. Nếu muốn chạy nhanh bằng `.env` local, đặt đủ ba biến sau trong `apps/backend/.env` rồi chạy lại lệnh bootstrap:

```dotenv
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_DISPLAY_NAME=Initial Admin
BOOTSTRAP_ADMIN_PASSWORD=Admin123!
```

Khi đủ cả ba biến, lệnh không hỏi tương tác; thiếu biến nào thì chỉ hỏi biến đó. Xóa `BOOTSTRAP_ADMIN_PASSWORD` khỏi `.env` ngay sau khi tạo Admin thành công và không commit `.env`. Chỉ chạy được khi chưa có Admin global đang hoạt động, kể cả sau migration giữ lại legacy Worker inactive. Admin đăng nhập qua `POST /api/v1/auth/login`, đổi mật khẩu tạm qua `POST /api/v1/auth/change-password`, rồi đăng nhập lại để gọi API quản trị. Access token là JWT HS256 15 phút, chỉ mang `sub`, `sid`, `typ`, `iat`, `exp`, `iss`, `aud`; quyền luôn được đọc lại từ PostgreSQL. Refresh session hết hạn tuyệt đối sau 30 ngày và rotate tại `POST /api/v1/auth/refresh`. Logout, đổi/reset mật khẩu, khóa tài khoản hoặc đổi role thu hồi session ngay. Không có endpoint tự đăng ký.
Mật khẩu mới phải dài 8–128 ký tự, có ít nhất một chữ hoa, một số và một ký tự đặc biệt; chữ thường không bắt buộc. Riêng tài khoản Worker mới do MF01 tạo, mật khẩu ban đầu mặc định là `12345678` khi không truyền `temporaryPassword`; Worker đăng nhập được ngay; đổi mật khẩu là tùy chọn và mật khẩu mới phải đạt chính sách trên. Không reset mật khẩu tài khoản hiện có. Password cũ của account hiện tại vẫn đăng nhập được cho tới khi được đổi hoặc reset.

Web gửi `clientType=WEB`: access token trả trong JSON, refresh token chỉ ở cookie host-only `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth` và `Secure` ở production; login/refresh/logout yêu cầu Origin trong allowlist. Mobile gửi `clientType=MOBILE` và nhận cả hai token trong JSON để ứng dụng lưu refresh token bằng secure storage. Không được trộn cookie và refresh token JSON.

`GET /api/v1/auth/me` trả account cùng `roleAssignments`. Admin cấp tài khoản qua `POST /api/v1/users`, thay nguyên tử toàn bộ role bằng `PUT /api/v1/users/:id/role-assignments`, xem danh sách/chi tiết, khóa/mở và đặt lại mật khẩu tạm. `ADMIN` có `siteId=null`; các role còn lại, gồm `CONTRACTOR_REPRESENTATIVE` và `WORKER`, bắt buộc có Site tồn tại. Một user có thể có role khác nhau ở nhiều Site; backend không có “active role”.

MF01 bổ sung `POST /api/v1/contractors/:contractorId/worker-accounts`: Representative đúng Site và Contractor grant, với participation còn hiệu lực, tạo đồng thời tài khoản `WORKER`, hồ sơ và liên kết. Mật khẩu tạm được hash trước transaction ghi; người dùng đăng nhập được ngay và có thể đổi mật khẩu theo chính sách hiện hành. Transaction kiểm tra lại quyền và ghi audit người tạo, không lưu mật khẩu trong audit/response. Trùng username hoặc mã Worker trả `CONFLICT` và rollback cả tài khoản/role/hồ sơ. `GET /api/v1/sites/:siteId/contractor-worker-account-options` chỉ liệt kê nhà thầu đang hoạt động mà Representative được gán tại Site đó. `PUT /api/v1/sites/:siteId/contractors/:contractorId/workers/:workerId` cho phép đại diện cùng nhà thầu sửa mã/tên và tạm dừng/khôi phục Worker, kiểm tra snapshot để tránh ghi đè thay đổi, giữ lịch sử và ghi audit người sửa. Thao tác này không thay đổi tài khoản đăng nhập hay tự cấp quyền vào cổng. Xem [MF01 Worker onboarding](../../contracts/mf01-worker-onboarding.md).

UI mới không yêu cầu nhập mã Worker: khi bỏ `externalId`, Backend cấp mã dạng `W000001` bằng PostgreSQL sequence, không trùng giữa các lần tạo đồng thời. Migration WorkerCodeSequence giữ nguyên mã cũ và bắt đầu sau các mã số đã có. `externalId` vẫn được chấp nhận cho client cũ nhưng không chấp nhận null/rỗng; UI quản lý chỉ hiển thị mã. Sequence có thể có khoảng trống khi transaction rollback, không tái sử dụng mã đã cấp.

AI đọc `GET /api/v1/integrations/ai/cameras/:cameraId/configuration` bằng service token hiện có. Biến `AI_CONFIGURATION_CAMERA_IDS` chứa danh sách UUID camera phân cách dấu phẩy; để rỗng thì từ chối mọi camera. Camera không được cấp hoặc không tồn tại trả 404, inactive trả 409, active không có Region trả `regions: []`. Endpoint này không đưa Zone policy, Worker hoặc RTSP credentials cho AI. Allowlist chỉ áp dụng cho việc tải cấu hình; ingestion event hiện giữ semantics cũ.

Login giới hạn 5 lần/phút/IP, refresh 10 lần/phút/IP và đổi mật khẩu 5 lần/phút/user; quota hiện lưu trong bộ nhớ mỗi instance. Các module nghiệp vụ kiểm tra đúng cặp `requiredRole + targetSiteId` khi mở quyền; tuyệt đối không ghép role của Site này với scope Site khác. Tạo tài khoản Worker không tự cấp quyền Site/Zone/cổng; các luồng nhận diện và phân quyền kiểm tra điều kiện hiện hành riêng.

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

Migration `ZoneEntryTrackIdRange1790812800001` mở rộng `zone_entry_decision.track_id` từ
PostgreSQL `integer` sang `bigint`, với CHECK `0..9007199254740991` đúng contract observation
v1. Chạy migration này trước khi deploy Backend dùng transformer mới. API vẫn trả `trackId`
kiểu số JSON; thay đổi lưu trữ không xác nhận Worker hay thay chính sách quyền Zone.
Downgrade về `integer` sẽ bị PostgreSQL từ chối nếu còn Track ID lớn hơn `2147483647`;
lệnh thất bại nguyên tử, không xóa hoặc cắt giá trị để ép rollback. Khi đã có các ID đó,
ưu tiên forward fix hoặc quy trình restore đã được duyệt, không coi `revert` luôn khả dụng.

Migration `ObservationIdentityReview1790899200000` chỉ cho revert khi cả head và audit
đều rỗng. Nếu đã có quyết định review, `down` từ chối trước mọi thay đổi schema trong
cùng một statement; dùng forward fix hoặc backup/restore được duyệt. Không truncate
audit để ép rollback. Trigger chặn `UPDATE`/`DELETE` quyết định; tài khoản database
runtime phải không có quyền `TRUNCATE` hoặc DDL. Trigger không bảo vệ trước database
owner/superuser. Chỉ fixture giả trong database test riêng được dọn bằng `TRUNCATE`.

API review danh tính theo từng PERSON observation hiện chưa được đăng ký trong
`SafetyModule`: phải thống nhất reader/export từ registry Worker trước khi bật.
Các test HTTP dùng module và reader riêng cho fixture; đây không phải bằng chứng
endpoint đã hoạt động trên môi trường ứng dụng. Review thủ công chỉ có phạm vi
`EXACT_OBSERVATION`, không xác minh track trực tiếp, cấp quyền Zone, tính lại quyết
định vào vùng đã lưu hoặc mở lại alert. Nếu ảnh hết hạn hay Camera đã bị xóa,
lịch sử/replay/CLEAR vẫn dùng snapshot hợp lệ đã lưu; RESOLVE mới bị chặn khi
không còn bằng chứng phù hợp. Management response validators dùng browser-safe
entry `@smartsite/contracts/management` trong Web/API client.

### Neon local

Không tự tạo Neon project. Đăng nhập Neon CLI, liên kết đúng project rồi kéo riêng biến PostgreSQL vào file mà Backend development thực sự nạp:

```sh
npx neon@latest link --project-id little-cloud-62052905 --branch production --no-env-pull --no-config -y
npx neon@latest env pull --project-id little-cloud-62052905 --branch production --service postgres --file apps/backend/.env
```

`apps/backend/.env` được Git ignore. Không dùng `.env.local` ở repository root vì Backend không tự đọc file đó. Sau khi pull, `DATABASE_URL` là pooled runtime và `DATABASE_URL_UNPOOLED` là direct migration. CI/staging/production cấp biến bằng secret manager. Không dùng database Neon cho integration test.

## Kiểm thử và quality gates

Unit/HTTP tests xóa `.test-build` trước khi compile rồi chạy qua `scripts/run-tests.mjs`: đặt `NODE_ENV=test` trước import, loại các biến cấu hình runtime được thừa hưởng và không đọc `.env` local. HTTP tests dùng database stub; không kết nối database phát triển.

Integration chỉ nhận `TEST_DATABASE_URL` từ process hoặc file `apps/backend/.env.test` được tạo rõ ràng. Không fallback sang `DATABASE_URL`, direct URL hay `.env`. Validator chỉ chấp nhận host `localhost`, `127.0.0.1` hoặc `[::1]`, user và database đều là `smartsite_test`, không query/fragment. DataSource kiểm thử độc lập với runtime/CLI. Runner migrate database test **một lần**, rồi chạy tuần tự các test file (`--test-concurrency=1`); các thao tác đồng thời bên trong test race vẫn giữ nguyên.

Gate `test:integration:workforce` coi Node deprecation là lỗi (`--throw-deprecation`), để phát hiện
việc gửi query mới khi một query khác còn chạy trên cùng pg client. Các thao tác
Workforce dùng transaction manager chờ từng query theo thứ tự; các test race vẫn
chạy các transaction riêng đồng thời. Test HTTP scheduling đóng app/datasource
trong hook cleanup kể cả khi setup hoặc assertion thất bại.

Gate này chạy sáu file integration Workforce/business HTTP hiện có và từ chối nếu
thiếu file đã compile. Nó bổ sung cho `test:integration`, không thay thế suite đầy
đủ. TypeORM1.1.1 schema introspection cũng có truy vấn đồng thời trên pg8.23;
full suite vẫn kiểm schema/migration theo driver đã pin và giữ nguyên cảnh báo.
Chưa xác nhận tương thích driver mới; không sửa node_modules hoặc nâng dependency
để bỏ qua giới hạn này. CI chạy cả hai gate.

```sh
node -e "const fs=require('node:fs'); if (!fs.existsSync('apps/backend/.env.test')) fs.copyFileSync('apps/backend/.env.test.example','apps/backend/.env.test')"
docker compose -f infra/compose.yaml --profile test up -d postgres-test --wait --wait-timeout 60
pnpm --filter @smartsite/backend test
pnpm --filter @smartsite/backend test:integration
```

Profile `test` dùng PostgreSQL 18, `127.0.0.1:5433`, user/database `smartsite_test`, password giả `smartsite_test_only`. Dữ liệu nằm trên tmpfs riêng và mất khi container dừng; không mount volume `postgres-data` của development. Integration tests có quyền thay đổi/xóa fixture trong database test này.

CI truyền `TEST_DATABASE_URL=postgresql://smartsite_test:smartsite_test_only@127.0.0.1:5433/smartsite_test`, không truyền runtime URL vào integration. Một bước riêng kiểm tra CLI migration trên PostgreSQL development; Compose build/readiness smoke vẫn kiểm tra đường chạy ứng dụng đầy đủ.

`safety-business-http.integration.test.ts` chạy AppModule, AuthService/guards và
WorkforceConfigurationService thật trên schema test riêng: tạo cấu hình qua HTTP,
ingest event synthetic, đọc JPEG private, review identity đúng observation và review
alert, rồi khởi động lại ứng dụng để đọc audit/evidence. Không mock quyền hoặc reader
Workforce. File nằm trong suite integration hiện có nên CI chạy cùng các test SQL;
scenario này không chứng minh camera/model accuracy hoặc crash recovery PostgreSQL.

Backend container có thể đọc evidence của host worker bằng overlay private hiện có;
xem [local evidence operations](../../docs/operations/local-evidence-container.md)
trước khi cấp quyền cho thư mục. CI kiểm cấu hình merge; storage/cloud/multi-camera
và runtime permissions có các giới hạn được ghi trong hướng dẫn.

Migration candidate `1791590400001-Mf06AssessmentRequests` bổ sung storage MF06: request
bất biến gắn với đúng PERSON/ZONE_ENTRY của event gốc, và job head riêng có
revision, lease, deadline hữu hạn. Logical key dedupe cả trường hợp PERSON index
NULL; event đã được tham chiếu không thể bị sửa payload/hash hoặc purge. Camera
bị xóa vẫn giữ historical Camera/Site/Region IDs trong request. Migration không
backfill event cũ; rollback từ chối khi có request/job. Integration dùng PostgreSQL
riêng để kiểm binding, race, lease CAS, upgrade/down và metadata drift.

Candidate tự thêm/xóa `uq_mf06_request_zone_scope` để composite Zone/Site FK
không phụ thuộc unique constraint của history migration trên branch cũ. Unique
cũ được giữ nguyên; branch này tạm có hai scope keys tương đương. Slot mới vẫn
cần shared owner review trước release. Storage up/down trên schema main không
chứng minh toàn bộ history reader hay ứng dụng đã tương thích với main mới.

Đây là storage candidate: chưa có enqueue, worker, persisted assessment hoặc API
đọc assessment. `BOUND` chỉ là chọn được PERSON, không xác minh Worker hay cấp
quyền Zone. Factory ingestion sau này phải derive Site/Zone từ context đáng tin
cùng transaction; database guard không suy Site lịch sử từ Camera hiện tại.
Không bật synchronize, migration startup, Face hoặc live authority.

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

### Scoped camera preview

Web đọc ảnh qua `GET /api/v1/sites/:siteId/cameras/:cameraId/preview` và danh sách
camera qua `GET /api/v1/sites/:siteId/preview-cameras`. Mỗi request dùng Bearer
session người dùng: Admin toàn cục hoặc Safety Officer của đúng Site. Gateway
kiểm tra session, role, Camera thuộc Site và ACTIVE trước và sau khi đọc nguồn.
Quyền xem ảnh không cấp quyền cấu hình polygon hoặc quyền Worker vào Zone.

Preview, raw stream và recorded video kiểm lại token/session/role sau lượt đọc
Camera cuối cùng trước khi trả pixels. Giữ kiểm quyền trước lượt đọc đó để không
bỏ mất trường hợp Camera deactivated trong lúc authenticate. Một lần đọc hợp lệ
vì thế có ba lượt authenticate; raw stream có hai lượt cho mỗi frame sau bước
khởi tạo. Đây là điểm kiểm quyền trước phát dữ liệu, không phải snapshot transaction
nguyên tử chung cho user và Camera hoặc hủy hồi tố bytes đã được gửi. Chi phí DB và
giới hạn nhiều viewer cần benchmark riêng; không cache quyền để né revocation.

Backend cấu hình riêng `SMARTSITE_AI_PREVIEW_SOURCES`, một JSON map từ camera
external ID trong DB sang exact AI HTTP(S) origin. Ví dụ giả:
`{"camera-01":"http://127.0.0.1:8000"}`. Camera chưa có map trả unavailable;
không nhận URL hoặc token từ browser, không follow redirect. AI dùng cùng
server token `SMARTSITE_AI_SERVICE_TOKEN` qua Bearer header; browser chỉ biết
Backend URL và session của người dùng. Không đưa service token vào `VITE_*`.

Upstream bị giới hạn hai giây/hai triệu byte; sai camera, JSON không hợp lệ,
frame stale hoặc decode lỗi không được thay bằng fixture hay camera khác.
Response hợp lệ dùng `Cache-Control: no-store`. Web hiển thị snapshot 1 giây,
LIVE/REPLAY/UNAVAILABLE; 401/403 dừng polling, 429 backoff theo giới hạn hiện có.
Giữ rate limit; throughput nhiều camera/viewer và DB revocation cần nghiệm thu
riêng. Preview không gửi technical event hay thay thế durable AI worker.

| Dependency                             | Lý do                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `zod`                                  | Kiểm tra biến môi trường và suy ra kiểu, tránh schema/type viết lặp.          |
| `class-validator`, `class-transformer` | Kiểm tra DTO tại HTTP boundary; conversion phải khai báo rõ.                  |
| `helmet`                               | Security headers dùng middleware chuẩn.                                       |
| `@nestjs/throttler`                    | Rate limit HTTP/AI có quota riêng.                                            |
| `nestjs-pino`, `pino`, `pino-http`     | Log có cấu trúc và request correlation; sanitizer giới hạn dữ liệu công khai. |
| `pino-pretty` (dev)                    | Đọc log local; không cần trong image runtime.                                 |
| Ajv hiện có trong contracts            | Giữ validation canonical AI contract; không thay bằng DTO/Zod.                |

Đây là nền để nhóm tiếp tục phát triển, chưa phải chứng nhận production. Phân quyền theo Site/Contractor/Zone, nhận diện Worker từ camera, cấu hình proxy, quota chia sẻ nhiều replica, retention/backup và vận hành triển khai còn cần yêu cầu và kiểm chứng riêng. AI không được quyết định danh tính, quyền Zone, vi phạm hay đóng incident. Mọi thay đổi cần một thành viên khác review trước khi merge.

### MF06 assessment admission (default OFF)

Keep MF06_ENQUEUE_ENABLED=false until request/job migration, coordinator and worker rollout are qualified. This setting is independent of detector/Face availability; it does not invoke them. When enabled, ingestion locks Camera/Region/Zone context from its first resolution, inserts the original raw event, then creates exact observation-index requests/jobs in the same transaction. Duplicate event acceptance never backfills historical events. Existing public event response and authorization semantics remain unchanged; request IDs are not added to the response.

Admission uses a nonblocking transaction advisory lock keyed by database and schema. Competing intake or capacity exhaustion returns existing AI_INGESTION_UNAVAILABLE/503 and rolls back the whole event for sender retry. This deliberately serializes admitted assessment writers through COMMIT: a per-Site lock or early release would not protect a schema-wide cap. PENDING and CLAIMED jobs still count after deadlines; this path never purges audit or partly accepts an event. This caps outstanding jobs from this intake path, not lifetime history, arbitrary SQL writers, request latency or production camera capacity. All enabled intake replicas must use one qualified capacity setting. No worker scheduler, current website adoption, identity acceptance or history READY follows from registration of this software hook.

### Private MF06 job lease kernel

`Mf06JobLeaseService` is not a Nest provider or a scheduler. Callers must explicitly supply bounded leaseSeconds1..300, maxAttempts1..10 and retryDelaySeconds1..300;60/3/1 is a test fixture, not a production default. Claim/reclaim uses READ COMMITTED, FOR UPDATE SKIP LOCKED and database clocks. Each claim allocates a new token and increments attempt/head; lease expiry is clamped to the original deadline. Retry/fail/cancel compare exact token/head and fresh database time at the write. Retry backoff begins at that write and cannot reset the original deadline.

Expiration terminalizes at most100 expired/exhausted nonterminal heads per call, retaining request/assessment history and leaving eligible in-flight leases alone. Claim revision2147483646 is the last usable revision so finalize can advance to2147483647. An unusable but still incrementable head is terminalized HEAD_REVISION_EXHAUSTED; a preexisting max-integer nonterminal head cannot advance and needs an explicit operator repair. Abort observed within claim rolls back the transaction; it is not retroactive cancellation after an already committed claim. Public assessment APIs, resolver I/O, worker drain/retry orchestration, runtime registration and production capacity remain separate qualifications.

### Private MF06 assessment orchestration

`Mf06AssessmentWorker` is caller-driven and unregistered. It requires explicit enabled/resolverTimeoutMs/drainTimeoutMs/maxDatabaseAttempts options; enabled=false performs no intake. There is no scheduler, model adapter, camera process or implicit production setting. The trusted work port prepares outside the final transaction and revalidates/uses the existing store inside the same SERIALIZABLE manager. Database serialization/deadlock retries are capped at three and never repeat preparation. The internal DATABASE_UNAVAILABLE job code distinguishes exhausted DB retries from resolver failures.

Preparation races cancellation and a bounded timeout. A late result never triggers worker finalization; this does not sandbox a callback that independently captures other capabilities. Drain permanently rejects new work and aborts current preparation. Observed abort before transaction commit rolls back; already committed results cannot be undone. A blocked final database transaction can exceed the drain budget: MF06_DRAIN_TIMEOUT reports failure, retains the active operation and does not claim driver/socket cancellation. Actual trusted-media/identity/authority protocol, runtime registration, provider timeouts and production shutdown/capacity remain separate rollout gates.

### Recorded MF06 assessment reads (default OFF)

`MF06_ASSESSMENT_READ_ENABLED` accepts explicit `true` or `false` and defaults to false, independently of enqueue and private workers. The scoped list/detail routes are `GET /api/v1/sites/:siteId/mf06-assessments` and `/:assessmentId`. They retain existing global Admin/same-Site Safety Officer authorization and reauthenticate after the asynchronous read. Responses use `private, no-store`, a closed 13-field historical projection and the shared browser-safe parser exported at `@smartsite/contracts/mf06-assessments`. They never expose Worker identity, profile/template, raw media/artifacts, lease tokens or a persisted alert ID. `SYNTHETIC_TEST` records are excluded from counts/list and return 404 on detail.

Reads require qualified request/artifact/assessment tables. Disabled or unavailable storage returns a safe 503 rather than a false empty history. List offset defaults to 0 and limit to 20 (maximum 100); total and records share one REPEATABLE READ snapshot per HTTP request. Separate pages are separate snapshots. Every selected record passes the private store integrity decoder; invalid recorded data makes the request unavailable. Original Site/Camera/Zone references remain historical even after a live camera move. The bounded per-record queries are not a production latency/capacity guarantee. Manual candidate0004 integration tests do not register that migration, enable the flag or adopt these endpoints on an older frozen website runtime.

### MF06 request processing status (read-only)

Both Requests and completed Assessment reads use the configured TypeORM schema in a read-only REPEATABLE READ transaction. A different current schema or a missing required selected-schema relation returns a sanitized 503. Required relations are held with qualified ACCESS SHARE locks until the transaction ends; the local search path places the selected schema before `pg_temp` so temporary tables cannot replace it. A genuine missing Site or record still returns 404. The local five-second statement timeout applies per SQL statement, not to the whole HTTP request or production capacity.

`GET /api/v1/sites/:siteId/mf06-assessment-requests` and `GET /api/v1/sites/:siteId/mf06-assessment-requests/:requestId` use the same `MF06_ASSESSMENT_READ_ENABLED` gate (default OFF), active Admin/Site-scoped Safety Officer authorization and late bearer reauthorization. Unknown query fields are rejected; lists use offset 0/limit 20 by default, limit at most 100, and captured-time/UUID descending order. Responses are `private, no-store` and contain exactly 13 public fields: request/Site/event/Camera/Zone IDs, original capture time, request time, purpose, job status, attempt count, deadline time, deadline-passed indicator and nullable assessment ID. No lease token, raw error, payload/hash, media or Worker identity is exposed.

`NOT_QUEUED` means no persisted job head; attempt/deadline/assessment are null and deadline-passed is false. Other states preserve persisted `PENDING`, `CLAIMED`, `SUCCEEDED`, `FAILED` or `CANCELLED`. A recorded claim does not prove a worker is currently running. A passed deadline annotates the stored state rather than inventing failure or clearing the request. `SUCCEEDED` requires an integrity-validated non-synthetic assessment; inconsistent completion is unavailable (503). Synthetic-test assessments are excluded. Snapshot reads use only the selected database namespace, a read-only REPEATABLE READ transaction and a five-second statement timeout. Separate pages are separate snapshots and OFFSET is not a production scalability guarantee.

The Safety Web view separates Requests from completed Assessments, with manual refresh and explicit pagination. Reading status never enqueues, retries, claims, evaluates or starts an AI worker. The AI-paused banner follows the Web runtime flag; technical request/event IDs are not Worker identities, authorization decisions or persisted alert IDs.
