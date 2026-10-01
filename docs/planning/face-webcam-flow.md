# Identity & Access — MF01, MF02, MF04

## 1. Phạm vi và quyết định kỹ thuật

| Main flow | Phạm vi Identity & Access |
| --- | --- |
| **MF01** | Contractor Representative tiếp nhận Worker, thu consent, đăng ký khuôn mặt, khai báo năng lực/chứng chỉ và gửi đề nghị phân công Site/Zone. |
| **MF02** | Điểm danh cổng ưu tiên **nhận diện khuôn mặt qua webcam**; chỉ dùng QR động khi face scan không xác minh được hoặc dịch vụ không sẵn sàng. Backend quyết định vào/ra từ dữ liệu nghiệp vụ. |
| **MF04** | Đăng ký, duyệt và quản lý lượt khách; chỉ QR, không nhận diện khuôn mặt Visitor. |

### AI khuôn mặt: miễn phí API nhưng không miễn điều kiện

- Dùng dịch vụ nhận diện tự host trong `smartsite-ai` với **InsightFace/ArcFace + ONNX Runtime**. Webcam Web chỉ chụp frame rồi gửi Backend; Backend gọi AI service nội bộ. Không gọi OpenAI, AWS Rekognition hay API nhận diện trả phí.
- Đây không có phí theo lượt quét; vẫn có chi phí máy chạy, camera, điện và công vận hành. CPU đủ cho prototype một cổng, cần benchmark trước khi nói về nhiều camera/cổng.
- Code InsightFace là MIT, nhưng các pretrained model công khai của họ chỉ được cấp cho nghiên cứu phi thương mại. Chỉ dùng cho prototype/đồ án khi nhóm xác nhận đúng phạm vi; nếu triển khai thương mại phải có model/license thương mại hoặc model thay thế đã được review license.
- `face-api.js` hoặc `@vladmandic/human` cũng có thể chạy model ngay trong browser, không tốn API. Chỉ dùng làm prototype client-side sau khi kiểm tra license của **từng model weight**; không coi library license là license của model.
- MVP chưa tự tuyên bố chống giả mạo ảnh/video. Không đạt liveness, ảnh mờ/nhiều mặt, confidence thấp, người chưa đăng ký hoặc AI lỗi đều phải chuyển QR/manual review; Security Officer là lớp xác minh cuối.

## 2. Luồng chính

```text
MF01 — Contractor Representative
  -> tạo Worker của Contractor mình
  -> Worker xem consent và chụp 3 ảnh webcam
  -> AI kiểm tra một khuôn mặt/chất lượng, tạo FaceProfile + embedding được mã hóa
  -> bổ sung chứng chỉ/năng lực
  -> gửi đề nghị Site/Zone Assignment
  -> Safety Officer review chứng chỉ; Site Manager duyệt assignment

MF02 — Security Officer tại cổng
  -> Worker nhìn webcam; AI detect + match FaceProfile
  -> Backend kiểm tra Worker + Contractor + Assignment + Site + thời điểm
  -> hiển thị ALLOWED / DENIED / MANUAL_REVIEW và lý do
  -> nếu face scan failed, low confidence, unknown hoặc AI unavailable:
       Worker dùng QR động, Security Officer đối chiếu trực tiếp và xác nhận/reject
  -> Backend lưu Gate Event/Attendance Event/Audit Log

MF04 — Host / Site Manager / Security Officer
  -> Host đăng ký lượt khách; Site Manager duyệt
  -> hệ thống cấp QR theo Visit và thời hạn
  -> Security Officer quét QR, đối chiếu người thực tế, ghi check-in/out
```

Face match chỉ đưa ra ứng viên danh tính và tín hiệu kỹ thuật. AI không được cấp quyền vào, tính giờ công, kết luận vi phạm hay tự điều khiển barie. QR là fallback của MF02, không được bỏ qua kiểm tra assignment hiện hành.

## 3. Actor và data scope

| Role | MF01 | MF02 | MF04 |
| --- | --- | --- | --- |
| `ADMINISTRATOR` | Quản lý Organization, Site, role và Site Manager | Không mặc định vận hành cổng | Không tự duyệt Visit của mình |
| `SITE_MANAGER` | Duyệt assignment Site/Zone | Xem vận hành Site theo scope | Duyệt Visit tại Site được giao |
| `CONTRACTOR_REPRESENTATIVE` | Chỉ quản lý Worker, consent, face enrollment, chứng chỉ và đề nghị assignment của Organization mình | Không quyết định quyền qua cổng | Là host theo Site scope |
| `SECURITY_OFFICER` | Chỉ xem dữ liệu tối thiểu cần cho cổng | Vận hành face scan/QR fallback, manual review, check-in/out tại Site được giao | Quét QR và check-in/out Visitor |
| `SAFETY_OFFICER` | Review chứng chỉ theo MF01 | Không vận hành cổng mặc định | Không duyệt Visit mặc định |
| `WORKER` | Xem hồ sơ/phân công của chính mình, consent/re-enroll | Điểm danh face-first; xuất QR động khi fallback | Không quản lý Visitor |

Không có role `Operator`. Mọi quyền phải kiểm tra role **và** Organization/Site/Zone scope ở Backend; không suy ra quyền từ ID do client gửi.

## 4. Dữ liệu, riêng tư và trạng thái

| Thực thể | Dữ liệu/chức năng tối thiểu |
| --- | --- |
| `Organization` / `ContractorParticipation` | Nhà thầu, Site và thời hạn tham gia |
| `Worker` | workerCode, fullName, contractorId, status, nghề/năng lực |
| `FaceProfile` | workerId, `ACTIVE|REVOKED|NEEDS_REENROLL`, model/version, encrypted template reference, consent time/version, created/revoked by |
| `FaceEnrollmentSession` | workerId, actor, 3 sample metadata, status, started/completed time |
| `WorkerSiteZoneAssignment` | workerId, siteId, zoneIds, validFrom/to, approval status, requester/reviewer |
| `FaceVerification` | gate/session, technical outcome (`MATCHED|UNKNOWN|LOW_CONFIDENCE|QUALITY_FAILED|AI_UNAVAILABLE`), candidateWorkerId?, safe score band, capturedAt |
| `GateEvent` / `AttendanceEvent` | site, gate, worker?, direction, method (`FACE|QR|MANUAL`), authorization result, reasonCode, idempotency key, actor/time |
| `Visitor` / `Visit` | host, Site/Zone, schedule, approval, QR credential, check-in/out |
| `AuditLog` | actor, action, resource, safe context, timestamp |

- Face samples, frames, embeddings và raw scores là dữ liệu sinh trắc học. Không lưu base64/raw image/embedding trong browser storage, app log hoặc public DB field; AI service lưu template được mã hóa/private storage theo chính sách retention.
- Backend chỉ lưu profile status, model version, consent và dữ liệu cần audit; không trả embedding/raw score cho Web/Mobile.
- Nếu có nhiều hơn một mặt, không thấy mặt, ảnh kém, confidence dưới threshold hoặc profile revoked thì không match. Không tự gán Worker gần nhất.
- `OUT` vẫn có thể ghi khi face/QR xác minh được, dù thiếu `IN`; đánh dấu `needsReconciliation` cho MF03 và không tự cộng giờ công.
- Re-enroll/revoke đổi trạng thái FaceProfile có audit; dữ liệu mẫu cũ xử lý theo retention và consent đã công bố.

## 5. API dự kiến

Contracts và shared API client được review trước khi Web/Mobile gọi API thật. Upload ảnh đều là `multipart/form-data` với MIME allowlist, kích thước, rate limit, ownership check và timeout.

### MF01 — Worker và enrollment

```http
POST  /api/v1/contractors/:contractorId/workers
PATCH /api/v1/workers/:workerId
POST  /api/v1/workers/:workerId/face-enrollments
POST  /api/v1/face-enrollments/:sessionId/samples
POST  /api/v1/face-enrollments/:sessionId/complete
GET   /api/v1/workers/:workerId/face-profile
POST  /api/v1/workers/:workerId/face-profile/revoke
POST  /api/v1/workers/:workerId/site-zone-assignment-requests
POST  /api/v1/site-zone-assignment-requests/:requestId/safety-review
POST  /api/v1/site-zone-assignment-requests/:requestId/site-manager-decision
```

### MF02 — Face-first, QR fallback

```http
POST /api/v1/sites/:siteId/gates/:gateId/face-verifications
POST /api/v1/sites/:siteId/gates/:gateId/qr-verifications
POST /api/v1/sites/:siteId/gates/:gateId/gate-events
GET  /api/v1/sites/:siteId/gate-events
```

`face-verifications` nhận một frame webcam, gọi AI adapter và trả technical status + kết quả authorization đã do Backend tính. Chỉ khi kết quả thuộc `UNKNOWN`, `LOW_CONFIDENCE`, `QUALITY_FAILED` hoặc `AI_UNAVAILABLE` mới mở QR fallback. `qr-verifications` xác định Worker qua QR động nhưng vẫn kiểm tra assignment. `gate-events` ghi `IN|OUT` với idempotency key; client không được tự gửi `ALLOWED`.

### MF04 — Visitor QR only

```http
POST /api/v1/sites/:siteId/visits
POST /api/v1/visits/:visitId/site-manager-decision
POST /api/v1/sites/:siteId/gates/:gateId/visitor-lookup
POST /api/v1/sites/:siteId/gates/:gateId/visitor-gate-events
```

MF04 không gọi Face Service, không tạo FaceProfile và không lưu ảnh khuôn mặt Visitor.

## 6. Backlog triển khai

| Task | Kết quả mong đợi |
| --- | --- |
| IAA-01 — Chốt UC, state và threshold policy | Chốt actor × scope, consent/retention, enrollment/verification states, QR fallback, error/reason codes và nguyên tắc không dùng AI cho Visitor. |
| IAA-02 — Roles, Organization và scope | Migration từ roles hiện tại sang sáu role, Contractor/Site grants và guards; test allowed/denied/cross-organization/cross-site. |
| IAA-03 — MF01 onboarding/assignment | Roster, chứng chỉ/năng lực, review Safety Officer, Site Manager approve có thời hạn và lịch sử. |
| IAA-04 — MF01 face enrollment | Webcam 3 mẫu, AI adapter interface, InsightFace local adapter, encrypted template/profile status, revoke/re-enroll và audit. Không log ảnh/embedding. |
| IAA-05 — MF02 face gate | Webcam one-frame, technical result, Backend authorization, Gate/Attendance event idempotent, QR fallback và manual review. |
| IAA-06 — MF04 Visitor QR | Host registration, non-self Site Manager approval, expiring/replay-safe QR, Security check-in/out. |
| IAA-07 — Web + Worker mobile | Enrollment, Worker QR, Security gate desk, Visitor visit management; loading/denied/unavailable/retry states. |
| IAA-08 — Evaluation và hardening | Bộ ảnh/điều kiện được phép dùng, FAR/FRR/unknown/latency measurements, liveness limitation, retention/deletion, PostgreSQL integration tests và demo cases. |

Thứ tự: `IAA-01 → IAA-02 → IAA-03 → IAA-04 → IAA-05`; `IAA-06` có thể chạy song song sau IAA-02; rồi `IAA-07 → IAA-08`.

## 7. Kịch bản nghiệm thu

1. Đại diện Contractor A enroll Worker A với consent và 3 mẫu hợp lệ; không thể xem/sửa Worker hoặc FaceProfile của Contractor B.
2. Face scan match Worker A và assignment còn hiệu lực: Backend trả `ALLOWED`, Security Officer ghi `IN` một lần dù retry request.
3. Face scan unknown/low-confidence/nhiều mặt/AI unavailable: hệ thống không cho vào tự động, hiện QR fallback. QR hợp lệ + assignment hợp lệ mới cho phép ghi event; QR lỗi chuyển manual review/reject.
4. Assignment hết hạn, Worker/Contractor inactive hoặc FaceProfile revoked: face/QR đều không bypass được quyền Backend.
5. `OUT` không có `IN` vẫn lưu có cờ đối soát; không tự tính công.
6. Visitor có Visit đã duyệt dùng QR đúng hạn check-in/out; MF04 không có face frame, embedding hoặc AI request.
7. Báo cáo evaluation ghi rõ phần cứng, model/version/license, threshold, dữ liệu thử nghiệm, FAR/FRR/unknown và giới hạn giả mạo; không tuyên bố chuẩn production khi chưa có liveness/benchmark.

## 8. Không thuộc scope

- Điều khiển barie/turnstile, tìm mặt liên tục trong CCTV, hay tự chốt danh tính từ một Gate Event cho camera khác.
- Liveness/anti-spoofing production trước khi có đánh giá riêng.
- AI PPE MF05, observation/authorization Zone MF06, tính công MF03 và toàn bộ workflow Incident MF08.
- Dùng public InsightFace weights cho mục đích thương mại khi chưa có license phù hợp.

## 9. Definition of Done

- MF01 đăng ký khuôn mặt; MF02 face-first, QR fallback; MF04 Visitor QR-only đúng với 10 main flows.
- Không có `Operator`; sáu role và data scope được Backend thực thi.
- Face matching chỉ là technical evidence; Backend quyết định quyền theo Worker/Contractor/Site/Zone/time.
- Consent, template lifecycle, verification, QR fallback, Gate/Visit Event và audit trail đầy đủ; raw sinh trắc học không lộ vào client storage/log.
- License model, quality evaluation, error paths, PostgreSQL integration tests và UI error states được kiểm chứng trước demo.
