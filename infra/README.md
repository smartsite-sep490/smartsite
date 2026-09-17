# Chạy tích hợp và triển khai

Trạng thái: hướng thiết kế, chưa có service/Dockerfile nên chưa có Compose chạy được.

## Local

Hai checkout đặt cạnh nhau:

```text
workspace/
  smartsite/
  smartsite-ai/
```

Compose chung sẽ ở thư mục này. Cấu hình mặc định dùng image AI đã build theo phiên bản; developer AI có thể dùng override build từ checkout bên cạnh. Developer Web/Backend có thể dùng dữ liệu giả theo contract mà không cần GPU hay camera.

Khi thêm Compose phải có: cấu hình mẫu không chứa secrets, healthcheck, volume dữ liệu, mạng service, hướng dẫn migration và lệnh smoke test. Không đưa database demo lên cổng công khai mặc định.

## Production

| Phần | Cách phát hành dự kiến |
|---|---|
| Web | Artifact hoặc image riêng; nơi host chốt theo stack |
| Backend | Image riêng, kết nối database/object storage, migration có kiểm soát |
| AI | Image riêng trên máy đáp ứng video/GPU; kết nối API bằng xác thực service |
| Mobile | Build/phát hành app riêng; không xem như container web |

Mỗi phần chỉ deploy khi phần đó cần thay đổi và contract còn tương thích. Ghi phiên bản image/digest, contract và migration tương ứng; không dùng `latest` làm mốc rollback.

Nền tảng cụ thể chưa chốt. Có thể chạy API và AI khác máy; cách chia repo không buộc dùng chung một máy hay chung một lần deploy.
