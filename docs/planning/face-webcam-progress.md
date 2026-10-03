# Face webcam flow — tiến độ hiện tại

Cập nhật: 2026-09-29

## Đã hoàn thành và push

Hai repo đang làm trên nhánh `feat/iaa-face-webcam`:

| Repo | Commit mới nhất | Nội dung |
| --- | --- | --- |
| `smartsite-ai` | `a84d161` | Adapter InsightFace chạy local; đăng ký 3 mẫu thành embedding; lưu embedding đã mã hoá bằng Fernet trong kho riêng; endpoint xác thực frame; lệnh cài model có chấp nhận license rõ ràng và kiểm tra SHA-256. |
| `smartsite` | `4555ff7` | Backend gọi AI verification; đối chiếu tham chiếu profile với FaceProfile; kiểm tra trạng thái worker/nhà thầu/participation/assignment; trả quyết định gate; Compose có volume riêng cho AI model và template. |

Các thay đổi source ở trên đã được push lên remote. Phần UI webcam hiện đã được tách thành commit riêng trên nhánh `feat/iaa-face-webcam`, không gộp vào commit backend.

## Model và dữ liệu demo local

- Model `buffalo_l` đã được tải bằng installer tường minh và đặt trong Docker volume `smartsite-local_ai-face-data`, tại `/var/lib/smartsite-ai/model-root/models/buffalo_l`.
- Installer kiểm tra archive SHA-256 trước khi giải nén. Weights, ảnh mẫu, embedding và khóa mã hoá không được commit lên Git.
- Khóa demo được lưu ở file local bị ignore `.env.face-demo`; không đưa nội dung khóa vào tài liệu hoặc Git.
- AI chỉ nhận đăng ký/xác thực khi `SMARTSITE_AI_IDENTITY_DEMO_MODE=true`, model root, template-store path và khóa mã hoá đều cấu hình. Nếu thiếu, service trả `AI_UNAVAILABLE`.
- AI container đã khởi động với model local. Một request JPEG không hợp lệ trả `QUALITY_FAILED`, xác nhận detector/recognizer đã load qua ONNX Runtime CPU.
- Public `buffalo_l` weights chỉ dành cho nghiên cứu phi thương mại. Ngưỡng `0.45` chỉ là ngưỡng demo, chưa được hiệu chuẩn; model không có liveness/anti-spoofing. Không dùng cấu hình này cho vận hành thương mại hoặc quyết định an toàn thật.

## Điều kiện để demo webcam đầu-cuối

Docker Desktop engine sau khi build trả lỗi 500/EOF và local ports ngừng phản hồi. Vì thế **chưa chạy lại được** container Backend build mới và chưa chứng minh luồng: webcam đăng ký → template mã hoá → quét lại → match → backend assignment decision.

Khi Docker Engine hoạt động lại, từ `D:\SEP490\smartsite`:

```powershell
docker compose -f infra/compose.yaml --env-file .env.face-demo --profile ai build backend ai
docker compose -f infra/compose.yaml --env-file .env.face-demo --profile ai up -d
```

Sau đó đăng nhập UI bằng tài khoản demo, mở Worker enrollment, đăng ký 3 frame thật. Cần worker có FaceProfile và assignment đã qua review/approval; gate desk cần tài khoản có role `SECURITY_OFFICER`, `SITE_MANAGER` hoặc Admin cùng site. Gate API hiện nhận multipart `frame` tại:

```text
POST /api/v1/sites/:siteId/gates/:gateId/face-verifications
```

Quét một frame ở gate desk sau khi đăng ký. Chỉ `MATCHED` cộng với profile/assignment hợp lệ mới cho `ALLOWED`; AI không tự cấp quyền. Endpoint hiện không lưu Gate Event/attendance và `gateId` là định danh đầu vào dạng chuỗi, chưa có bảng cấu hình Gate.

## Việc còn lại

1. Khôi phục Docker Engine, build/recreate backend + AI và chạy kiểm thử HTTP/service.
2. Cài/build lại web để xác nhận UI webcam gọi đúng endpoint mới; phần UI đã có commit riêng.
3. Chạy luồng đăng ký 3 frame và xác thực cùng người/khác người qua webcam; kiểm tra profile được lưu dưới dạng ciphertext sau restart volume.
4. Hoàn thiện thao tác UI gate, ghi Gate Event/IN-OUT và kiểm tra QR fallback từ nghiệp vụ backend.
5. Trước production: thay weights bằng model có quyền thương mại, benchmark FAR/FRR và latency theo điều kiện công trường, hiệu chuẩn threshold, bổ sung liveness và chính sách retention/deletion/rotation khóa.

## Các vị trí source chính

- AI recognizer và template store: `smartsite-ai/src/smartsite_ai/inference/insightface_recognizer.py`
- Lệnh cài model local: `smartsite-ai/src/smartsite_ai/tools/install_demo_face_model.py`
- AI identity HTTP endpoints: `smartsite-ai/src/smartsite_ai/identity_api.py`
- Backend gate controller/service/adapter: `smartsite/apps/backend/src/modules/workforce/face-gate.controller.ts`, `face-gate.service.ts`, `face-enrollment.adapter.ts`
- Compose volume và cấu hình demo: `smartsite/infra/compose.yaml`; secrets tại `.env.face-demo` (local, ignored).
