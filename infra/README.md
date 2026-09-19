# Local integration

Từ root monorepo:

```sh
docker compose -f infra/compose.yaml up -d --build --wait
docker compose -f infra/compose.yaml --profile ai up -d --build --wait
```

Profile ai cần repo `smartsite-ai` nằm cạnh `smartsite`; không dùng Git submodule. Không profile ai vẫn chạy Web/Backend/Postgres. Port local: Web5173, Backend3000, PostgreSQL5432, AI8000; tất cả publish127.0.0.1. Nếu xung đột cổng, dừng đúng service đang dùng hoặc sửa mapping và URL tương ứng.

Postgres18 volume lưu tại /var/lib/postgresql. Service `migrate` chạy TypeORM migrations và phải hoàn tất trước khi Backend khởi động. `docker compose -f infra/compose.yaml down` giữ dữ liệu; không thêm -v khi không chủ động muốn xóa dữ liệu local.

Web/API/AI có image riêng và chạy non-root. Web API URL là build argument, truy cập từ browser. Backend health live không thay DB readiness; gọi /api/v1/health/ready để kiểm tra database thật. AI health xác nhận API service, không xác nhận model sẵn sàng. Profile AI truyền URL ingestion nội bộ và cùng local service token với Backend; production phải lấy cả hai giá trị từ cấu hình/secret manager.

Đây là Compose development với credentials mẫu, không phải production deployment. Deploy Web/API riêng, Neon TLS và secrets ở server; AI có thể chạy GPU tại công trường. Chưa triển khai cloud, GPU container hoặc mobile distribution.
