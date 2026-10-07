# Cấu hình lưu file dùng chung Local / Cloudflare R2

Storage là hạ tầng dùng chung SmartSite. Feature tự kiểm tra quyền, loại file, giới hạn và thời gian giữ; adapter không phụ thuộc Safety. Hiện đã nối ảnh kết quả CorrectiveAction và SafetyTask. Evidence camera AI và ảnh Face tạm thời tiếp tục dùng cơ chế hiện có.

## Cấu hình

Bạn tự tạo/chọn bucket **private**, tắt public access và tạo S3 API token có quyền đọc/ghi chỉ bucket đó. Không gửi secret vào chat hoặc Git.

Chạy Backend trực tiếp: đặt các biến sau trong `apps/backend/.env`. Chạy Docker Compose: đặt chúng trong `.env` ở gốc repo (Compose tự đọc); **không sửa Docker khác**. `.env.example` chỉ chứa giá trị giả. Không đưa R2 credentials vào Vite/Web.

```dotenv
STORAGE_PROVIDER=R2
R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
R2_BUCKET=your-private-bucket
R2_ACCESS_KEY_ID=your-s3-access-key-id
R2_SECRET_ACCESS_KEY=your-s3-secret-access-key
```

Endpoint phải là HTTPS S3 endpoint của Cloudflare; không dùng r2.dev/public/custom-domain URL. Thiếu cấu hình, bucket/token sai hoặc mất file sẽ trả unavailable; không tự fallback Local để che lỗi.

Local dùng `STORAGE_PROVIDER=LOCAL` và `STORAGE_LOCAL_ROOT` là đường dẫn tuyệt đối ngoài Git. Compose giữ `/var/lib/smartsite/uploads` trong volume cũ. Alias `SAFETY_UPLOAD_LOCAL_ROOT` được giữ để đọc cấu hình cũ khi chưa chuyển tên; biến chung mới được ưu tiên. Không đổi root/bucket khi còn reference cần đọc. Mỗi ảnh có provider riêng: đổi mặc định sang R2 không làm ảnh Local cũ thành R2 và không tự di chuyển dữ liệu.

```bash
docker compose -f infra/compose.yaml up -d --build
```

Backend dùng AWS SDK S3 v3, region auto, khóa do server tạo; upload/download qua Backend có authentication và no-store. Browser không cần R2 CORS vì không gọi bucket trực tiếp. DB không giữ bytes hoặc secrets. SDK theo [tài liệu chính thức Cloudflare](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).

## Test sau khi bạn cấu hình R2

1. Đăng nhập representative có action đang In progress; Report handling outcome với JPEG ≤ 1 MiB.
2. Refresh, đăng nhập Safety và mở ảnh. Kiểm tra bucket xuất hiện object mới; response API chỉ có evidence id/mediaType/size, không có key/secret/public URL.
3. Đăng nhập representative Site/contractor khác: không đọc được ảnh hoặc Incident.
4. Gửi PNG/JPEG quá lớn: bị từ chối, không có Submission/object mới.
5. Xem ảnh Local cũ trong cùng volume vẫn được. Đổi lại Local chỉ thay provider của upload mới.
6. Với một object test mới, có thể tự xóa trong bucket rồi mở lại ảnh: UI phải báo unavailable. Không làm với ảnh cần giữ.
7. Lỗi cấu hình/storage không được tạo kết quả hoàn thành giả. Transaction rollback/retry phải dọn object mới; nếu dọn thất bại, kiểm tra log storage_cleanup_failed và đối chiếu objectId với reference DB trước khi tự dọn.

R2 thật chưa được test trong đợt triển khai trước khi bạn cấp cấu hình. Automated tests dùng SDK mock, không gọi bucket thật/paid service. Đổi bucket hoặc di chuyển ảnh cũ cần kế hoạch riêng; không tự gán provider/key mới khi bytes chưa được sao chép và kiểm tra hash.

## Kiểm chứng mới — 06/10/2026

Neon/R2 đã smoke bằng một JPEG tổng hợp qua Report handling outcome trên Web: lưu R2, metadata Neon đúng provider/size/hash, ảnh đọc qua Backend có authentication; các test HTTP no-store/quyền/rollback trên PostgreSQL riêng đạt. Object tổng hợp và hồ sơ test của lượt mới đã dọn theo ID; ảnh/hồ sơ người dùng không bị xóa. Đây là kiểm chứng ảnh kết quả Incident, không thay đổi adapter camera/Face hoặc di chuyển ảnh Local cũ.
