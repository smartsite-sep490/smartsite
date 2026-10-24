# Local integration

Từ root monorepo:

```sh
docker compose -f infra/compose.yaml up -d --build --wait
docker compose -f infra/compose.yaml --profile ai up -d --build --wait
```

Profile ai cần repo `smartsite-ai` nằm cạnh `smartsite`; không dùng Git submodule. Không profile ai vẫn chạy Web/Backend/Postgres. Port local: Web5173, Backend3000, PostgreSQL5432, AI8000; tất cả publish127.0.0.1. Nếu xung đột cổng, dừng đúng service đang dùng hoặc sửa mapping và URL tương ứng.

Postgres18 volume lưu tại /var/lib/postgresql. Service `migrate` chạy TypeORM migrations và phải hoàn tất trước khi Backend khởi động. `docker compose -f infra/compose.yaml down` giữ dữ liệu; không thêm -v khi không chủ động muốn xóa dữ liệu local.

Web/API/AI có image riêng và chạy non-root. Web API URL là build argument, truy cập từ browser. Backend container health gọi `/api/v1/health/ready` để các dependency `service_healthy` chờ PostgreSQL và migration history sẵn sàng; `/api/v1/health/live` chỉ kiểm process còn đáp ứng. Lệnh health dùng `PORT` nội bộ (mặc định 3000), timeout request 2 giây; image timeout 3 giây vẫn là lớp bảo vệ ngoài. Health không tự migrate, khởi động AI hay thay thế kiểm tra container/SIGTERM thực tế. AI health xác nhận API service, không xác nhận model sẵn sàng. Profile AI truyền URL ingestion nội bộ và cùng local service token với Backend; production phải lấy cả hai giá trị từ cấu hình/secret manager.

`SMARTSITE_WEB_API_URL` đặt API URL khi build Web; mặc định `http://localhost:3000`. Controller demo truyền `backendUrl` vào biến này. Khi mở Web bằng `127.0.0.1`, dùng API cùng hostname để phiên refresh cookie hoạt động đúng; cần rebuild Web sau khi đổi URL, không chỉ restart container.

Đây là Compose development với credentials mẫu, không phải production deployment. Deploy Web/API riêng, Neon TLS và secrets ở server; AI có thể chạy GPU tại công trường. Chưa triển khai cloud, GPU container hoặc mobile distribution.

Quy trình release có gate riêng tại [production runbook](production-runbook.md): manifest,
target/schema, graceful shutdown, coherent DB/media backup, restore, incident và retention.
Runbook không cấp quyền deploy hoặc bật AI; Nginx hiện tại chỉ phục vụ static Web qua HTTP,
chưa có TLS/same-origin API ingress. Giữ các gate chưa có bằng chứng thực tế ở trạng thái mở.

Compose local dành 45 giây cho Backend trước forced stop, vượt giới hạn xả HTTP 30 giây
để có thêm thời gian cho shutdown hooks/pool. `node --test infra/backend-shutdown-compose.test.mjs`
kiểm cấu hình Compose thực tế, không chạy container/AI; không chứng minh mọi workload đều dừng
trong 45 giây hoặc thay thế SIGTERM test trên artifact triển khai.

Để Backend container đọc evidence của camera worker chạy trên host, dùng overlay hiện có
`compose.evidence.yaml` với thư mục private đã tồn tại; xem
[quyền đọc, storage layout và backup](../docs/operations/local-evidence-container.md).
`node infra/check-evidence-compose.mjs` kiểm merge cấu hình trong CI, không cần daemon;
vẫn cần kiểm container/readiness và quyền file trên Docker host thực tế.
