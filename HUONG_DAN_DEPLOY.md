# Hướng dẫn env và deploy SmartSite

Tài liệu này hướng dẫn deploy Web và Backend bằng Docker trên server Linux,
dùng Neon PostgreSQL, Cloudflare R2 và Resend. Các lệnh bên dưới chạy trong terminal
của server, tại root dự án. Đây là hướng dẫn; chưa có thao tác deploy lên server.

## 1. File env nằm ở đâu?

| Môi trường                             | File / cách cung cấp cấu hình                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| Backend chạy local trên Windows        | `D:\SEP490\smartsite\apps\backend\.env`                                          |
| Docker Compose local                   | `D:\SEP490\smartsite\.env`, dùng với Compose tại root dự án                      |
| Mobile chạy local                      | `D:\SEP490\smartsite\apps\mobile\.env.local`                                     |
| Backend trên server theo hướng dẫn này | `.env.production` tại root dự án trên server, truyền qua `docker run --env-file` |
| Nền tảng hosting quản lý container     | Khai báo các biến trong mục Environment Variables / Secrets của dịch vụ          |

Ví dụ bạn đặt dự án trên server tại `/opt/smartsite`, thì file env deploy là:

```text
/opt/smartsite/.env.production
```

Tên thư mục `/opt/smartsite` là ví dụ. Docker chỉ cần nhận đúng đường dẫn file khi
chạy `--env-file`; file không phải nằm trong container.

Backend local hiện chỉ tự đọc `apps/backend/.env`. Các giá trị từ root `.env` đã
được đồng bộ một lần trong lần cấu hình này. Nếu sửa root `.env` về sau, cần đồng
bộ lại Backend hoặc cung cấp biến trực tiếp cho tiến trình.

Ở chế độ `NODE_ENV=production`, Backend không tự đọc file `.env` của ứng dụng.
Dockerfile cũng không copy các file env riêng vào image vì `.dockerignore` đã loại
chúng. Vì vậy phải truyền biến qua `--env-file` hoặc Environment Variables / Secrets.

## 2. Đường dẫn OCR local khác server như thế nào?

Các giá trị dưới đây là đường dẫn tới chương trình đã cài, không phải URL công khai.
Không mang đường dẫn ổ `D:` hoặc thư mục Python `.venv` của Windows lên Linux.

| Biến                        | Windows local                                                                | Docker Backend trên server     |
| --------------------------- | ---------------------------------------------------------------------------- | ------------------------------ |
| `WORKER_DOCUMENT_PYTHON`    | `D:/SEP490/smartsite/apps/backend/ocr/.venv/Scripts/python.exe`              | `/opt/document-ocr/bin/python` |
| `WORKER_DOCUMENT_TESSERACT` | `D:/SEP490/.task-tools/ocr/tesseract/tesseract.exe`                          | `/usr/bin/tesseract`           |
| `WORKER_DOCUMENT_PDFTOPPM`  | `D:/SEP490/.task-tools/ocr/poppler/poppler-25.07.0/Library/bin/pdftoppm.exe` | `/usr/bin/pdftoppm`            |
| `STORAGE_LOCAL_ROOT`        | `D:/SEP490/.task-tools/private-files`                                        | `/var/lib/smartsite/uploads`   |

`infra/docker/backend.Dockerfile` đã cài Python, các thư viện OCR, Tesseract với
tiếng Việt/Anh và Poppler; đồng thời đã đặt ba biến `WORKER_DOCUMENT_*` theo cột
Docker. Không cần khai báo lại ba biến này khi dùng image được build từ Dockerfile
đó. Nếu khai báo chúng trên hosting, phải dùng đường dẫn Linux ở cột Docker.

Với `STORAGE_PROVIDER=R2`, file mới được lưu vào R2. Các bản ghi file cũ có provider
`LOCAL` vẫn cần thư mục local và dữ liệu cũ tương ứng. Giữ volume bền vững nếu còn
dùng những file đó; đổi env sang R2 không tự chuyển file cũ lên R2.

## 3. Tạo env production

Chuẩn bị Docker trên server, mã nguồn của bản phát hành và hai domain HTTPS,
ví dụ `app.example.com` cho Web và `api.example.com` cho Backend. Các domain trong
tài liệu đều là ví dụ, phải thay bằng domain của bạn.

Tạo `.env.production` tại root dự án trên server với các giá trị thật của bạn.
Mẫu dưới đây chỉ chứa placeholder, chưa thể chạy nguyên trạng:

```dotenv
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
LOG_FORMAT=json

DATABASE_URL=postgresql://USER:PASSWORD@POOLED_HOST/DATABASE?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://USER:PASSWORD@DIRECT_HOST/DATABASE?sslmode=require
DATABASE_TIMEOUT_MS=15000

CORS_ORIGINS=https://app.example.com
AUTH_JWT_SECRET=REPLACE_WITH_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
SMARTSITE_AI_SERVICE_TOKEN=REPLACE_WITH_ANOTHER_RANDOM_SECRET_AT_LEAST_32_CHARACTERS

STORAGE_PROVIDER=R2
R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
R2_BUCKET=your-private-bucket
R2_ACCESS_KEY_ID=REPLACE_WITH_R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=REPLACE_WITH_R2_SECRET_ACCESS_KEY
STORAGE_LOCAL_ROOT=/var/lib/smartsite/uploads

RESEND_API_KEY=re_REPLACE_WITH_PRIVATE_KEY
RESEND_FROM_EMAIL=qr@your-verified-domain.com
```

Lấy hai URL PostgreSQL từ cấu hình Neon của database cần deploy. Runtime sử dụng
`DATABASE_URL`; migration ưu tiên `DIRECT_URL`, rồi `DATABASE_URL_UNPOOLED`, rồi
`DATABASE_URL`. Nếu có khai báo `DIRECT_URL`, nó phải trỏ đúng database dự định.

Tạo hai secret ngẫu nhiên riêng biệt, mỗi lần chạy lệnh lấy một giá trị:

```sh
openssl rand -hex 32
```

Giữ `AUTH_JWT_SECRET` ổn định giữa các lần deploy: mã booking visitor đã lưu có
phụ thuộc vào secret này để giải mã. Đổi secret tùy tiện có thể làm mất khả năng
hiển thị/gửi lại mã booking cũ.

`CORS_ORIGINS` là origin chính xác, gồm giao thức và domain, không thêm đường dẫn
hoặc dấu `/` cuối. Nhiều origin được ngăn bằng dấu phẩy. Không dùng `*`.

Resend cần cả API key và địa chỉ gửi thuộc domain đã xác minh. Nếu chưa dùng email,
bỏ cả hai biến Resend; không chỉ khai báo một biến.

Giới hạn quyền đọc file:

```sh
chmod 600 .env.production
```

Không commit file này. Không đưa DB password, R2 secret, Resend key hoặc service
token vào biến có tiền tố `VITE_` / `EXPO_PUBLIC_` vì các biến đó được đưa vào client.

## 4. Build image

Chạy tại root dự án trên server:

```sh
docker build -f infra/docker/backend.Dockerfile -t smartsite-backend:release .
docker build -f infra/docker/web.Dockerfile --build-arg VITE_API_URL=https://api.example.com -t smartsite-web:release .
```

Backend image đã bao gồm OCR. Web nhận `VITE_API_URL` trong lúc build; thay URL API
sau này cần build lại Web. Không dùng `http://localhost:3000` khi người dùng truy
cập Web từ máy khác: `localhost` lúc đó là máy của người dùng.

## 5. Kiểm tra và chạy migration

Trước khi nâng cấp, sao lưu database và xác nhận hai URL PostgreSQL đều trỏ tới
database mục tiêu. Các lệnh dưới dùng env production, không dùng test database.

Xem migration đã chạy / đang thiếu:

```sh
docker run --rm --env-file .env.production smartsite-backend:release node node_modules/typeorm/cli.js migration:show -d dist/database/typeorm.data-source.js
```

Áp dụng migration của bản phát hành trước khi chạy Backend mới:

```sh
docker run --rm --env-file .env.production smartsite-backend:release node node_modules/typeorm/cli.js migration:run -d dist/database/typeorm.data-source.js
```

Backend không tự chạy migration khi khởi động và không bật `synchronize`.
Nếu migration lỗi, xử lý nguyên nhân trước khi đưa bản mới vào phục vụ.

## 6. Khởi động Backend và Web

Các lệnh này dành cho lần deploy đầu tiên; tên container phải chưa được sử dụng.
Khi cập nhật, thay container theo quy trình của nơi hosting, giữ nguyên secrets
và volume dữ liệu.

```sh
docker volume create smartsite-files
docker run -d --name smartsite-backend --restart unless-stopped --env-file .env.production -p 127.0.0.1:3000:3000 -v smartsite-files:/var/lib/smartsite smartsite-backend:release
docker run -d --name smartsite-web --restart unless-stopped -p 127.0.0.1:5173:8080 smartsite-web:release
```

Lệnh Backend truyền biến vào container. File `.env.production` vẫn nằm trên server;
không cần copy vào image. Volume giữ file local qua các lần thay container.

Cấu hình reverse proxy HTTPS của server hoặc hosting:

| Domain công khai          | Đích trên cùng server   |
| ------------------------- | ----------------------- |
| `https://app.example.com` | `http://127.0.0.1:5173` |
| `https://api.example.com` | `http://127.0.0.1:3000` |

Trỏ DNS của hai domain tới server và cấu hình chứng chỉ TLS tại reverse proxy.
Chuyển tiếp nguyên đường dẫn `/api/v1/...` tới Backend. Nếu reverse proxy chạy
trong container riêng, dùng mạng Docker và tên container thay cho `127.0.0.1`.

`infra/compose.yaml` hiện là cấu hình local: dùng `NODE_ENV=development`, CORS và
Web API URL localhost. Không dùng nguyên file đó làm cấu hình production. Hướng
dẫn này chạy trực tiếp các image để khai báo env production rõ ràng.

## 7. Kiểm tra sau deploy

Trên server:

```sh
curl --fail http://127.0.0.1:3000/api/v1/health/live
curl --fail http://127.0.0.1:3000/api/v1/health/ready
curl --fail http://127.0.0.1:5173/healthz
```

Backend readiness phải trả `status: ok` và `database: up`. Tiếp tục kiểm tra qua
domain HTTPS để xác nhận DNS và reverse proxy:

```sh
curl --fail https://api.example.com/api/v1/health/ready
curl --fail https://app.example.com/healthz
```

Sau đó đăng nhập bằng tài khoản hợp lệ, thử upload/đọc lại một hồ sơ được phép dùng
để xác nhận R2 và OCR. Để xác nhận Resend, thử một yêu cầu visitor hợp lệ với email
người kiểm thử và kiểm tra trạng thái gửi sau khi Site Manager phê duyệt. Health
database không xác nhận thay cho các kiểm tra R2, OCR hoặc email này.

Nếu cần tạo Admin đầu tiên cho database mới:

```sh
docker run --rm -it --env-file .env.production smartsite-backend:release node dist/scripts/bootstrap-admin.js
```

Lệnh hỏi thông tin Admin trong terminal và không ghi đè Admin đã có.

## 8. Mobile và AI

Mobile chỉ cần URL API công khai cho kết nối tới Backend:

```dotenv
EXPO_PUBLIC_API_URL=https://api.example.com
```

Khai báo biến này trong môi trường build Mobile hoặc env của app rồi build lại
ứng dụng. Không dùng IP LAN `192.168.x.x` cho người dùng ngoài mạng nội bộ.

OCR nằm trong Backend, không yêu cầu deploy `smartsite-ai`. Các tính năng camera,
nhận diện khuôn mặt và monitoring cần triển khai repo `smartsite-ai` riêng, cấu
hình kết nối và model theo hướng dẫn của repo đó. Deploy Web/Backend không tự làm
các tính năng AI này hoạt động.

Nếu bật face enrollment, khai báo `SMARTSITE_AI_IDENTITY_URL` bằng địa chỉ Backend
có thể truy cập và đồng bộ service token tương ứng với AI. Giữ service token phía
server. Các biến `VITE_AI_*` trong Dockerfile Web hiện phục vụ luồng monitoring
demo; không truyền production service token vào Web bundle.

## 9. Lỗi thường gặp

| Hiện tượng                           | Kiểm tra                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| OCR chạy local nhưng lỗi trên server | Đã dùng Backend Dockerfile chưa; có biến hosting nào ghi đè đường dẫn OCR bằng `D:/...` không |
| Web vẫn gọi localhost                | Build lại Web với `VITE_API_URL` đúng domain API                                              |
| Lỗi CORS                             | `CORS_ORIGINS` phải khớp origin Web đang mở                                                   |
| Backend không nhận env               | Có truyền `--env-file` / Secrets không; production không tự đọc `.env`                        |
| Database down                        | URL, mật khẩu, TLS, khả năng kết nối từ server và timeout                                     |
| Migration dùng sai kết nối           | Kiểm tra ưu tiên `DIRECT_URL` / `DATABASE_URL_UNPOOLED`                                       |
| Upload R2 lỗi                        | Đủ bốn biến R2, bucket và quyền token đúng                                                    |
| Không đọc được file LOCAL cũ         | Dữ liệu cũ đã được chuyển vào đúng volume và Backend có quyền đọc chưa                        |
| Email không gửi                      | Đủ hai biến Resend, sender đã xác minh và request visitor đã được phê duyệt                   |

Mã nguồn đối chiếu: [Backend Dockerfile](infra/docker/backend.Dockerfile),
[Web Dockerfile](infra/docker/web.Dockerfile),
[cấu hình runtime](apps/backend/src/config/runtime-environment.ts),
[schema env](apps/backend/src/config/environment.ts),
[hướng dẫn worker documents](contracts/worker-documents.md) và
[hướng dẫn Resend](docs/operations/visitor-qr-email.md).
