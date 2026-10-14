# Controlled local demo runtime

This controller starts the local SmartSite application and the companion `smartsite-ai` processes
without opening extra console windows. It records child PIDs plus creation-time/command fingerprints,
the named source profile, safe endpoints and log paths under the configured data directory. Camera
credentials and the Backend service token are read from local files outside Git. The controller passes
them to selected child processes through an allowlisted environment; for this local demo only, the Web
build embeds the service token as described under **Limitations**.

## Local files

Copy [`scripts/smartsite-runtime.config.example.json`](../../scripts/smartsite-runtime.config.example.json)
outside the repository and replace every example path with an absolute local path. The controller
accepts three named sources: `mp4`, `laptop`, and `tapo`. A source argument can never be an RTSP URL.

The Backend credential file has this local-only form:

```text
Token: <local-backend-service-token>
```

The Tapo credential file is read only for the `tapo` profile:

```text
Username: <camera-account-username>
Password: <camera-account-password>
Host: <camera-lan-address>
Stream: stream1
```

The Tapo manifest must reference an environment variable instead of containing an RTSP URI:

```json
{
  "source": {
    "kind": "env",
    "name": "SMARTSITE_AI_CAMERA_TAPO_SOURCE"
  }
}
```

## Commands

Run from the `smartsite` repository. Use `--build` after application code or container inputs changed,
and at least once after installing this controller so the local-only WebSocket URL/token are baked
into the Web demo image. Normal later starts can reuse the existing images.

```powershell
pnpm demo:runtime -- start --source mp4 --build --config D:\SmartSiteData\runtime\control.json
pnpm demo:runtime -- status --config D:\SmartSiteData\runtime\control.json
pnpm demo:runtime -- stop --config D:\SmartSiteData\runtime\control.json
```

Use `laptop` for camera device `0`, or `tapo` after the workstation and camera are reachable on the
same LAN. Starting the same live profile twice is idempotent. Starting a different profile while a
runtime is live fails and requires an explicit `stop` first.
If startup cleanup fails, the controller preserves a `cleanup-required` state and requires `stop`
before another start.

`status` distinguishes process state from HTTP health. AI API readiness proves only that FastAPI is
ready. For MP4, YOLO11s and the replay source are opened when the Web realtime client connects. A
finite MP4 worker normally exits at EOF; running `start --source mp4` again replays that source without
restarting the healthy API.

Worker logs for non-credentialed MP4/laptop sources are written under `<dataRoot>/control/logs`. API
output is discarded because Uvicorn WebSocket access logs include the local credential in the URL. Operator
output is scrubbed for RTSP credentials, Bearer headers, tokens and passwords. Tapo AI child output
is discarded because native OpenCV/FFmpeg diagnostics cannot be guaranteed to redact an RTSP URI.
Use the credential-safe source probe and controller health output for that profile. `stop` terminates
only the PIDs recorded by this controller, then runs Compose `down` without `-v`, so the local
PostgreSQL volume and evidence remain intact.

## Limitations

The synchronized MP4 preview requires an AI build that supplies `previewVersion: 1`, JPEG pixels,
and detections in one WebSocket message. Web paints those pixels and normalized boxes on one canvas;
it does not use the separately playing fixture as a realtime background. Old metadata-only AI
responses are rejected with an explicit unavailable state. Image decoding holds one active image
and at most one latest pending frame; a five-second frame stall clears the realtime preview.
The deadline starts when the socket opens, including when no first frame arrives. Socket
construction failures produce a generic unavailable message, and queued callbacks from a closed
connection are ignored before reconnect starts.
The local timeline remains a separately labeled fallback. This preview is transient and does not
replace the retained evidence served by the Backend alert-review endpoints.
The controller excludes the Backend ingestion URL from the preview API environment, while retaining
its local WebSocket authentication token. Only the durable worker delivers events and retains images;
opening or replaying the diagnostic preview must not create additional business alerts.

- The local Compose profile is a demonstration environment, not a production deployment.
- A Tapo source cannot be claimed live until the source probe succeeds on the current network.
- The realtime WebSocket overlay and the durable event worker are separate AI consumers. The
  controller gives exclusive laptop/Tapo sources only to the durable worker; the WebSocket overlay is
  deliberately unavailable for those profiles until a shared frame fan-out service is implemented.
- The local Web image embeds its local-only WebSocket credential at build time. Never deploy that
  image or reuse this mechanism for production authentication.

## Safety overview/checklists

Luồng Safety dùng stack hiện có và root .env khi chạy Compose trực tiếp. Apply migration `SafetyChecklists1792195200000` trước khi triển khai Backend, sau đó Web; không bật synchronize. Migration bổ sung 5 bảng checklist và mở rộng evidence, audit, notification. Rollback bị chặn khi còn dữ liệu checklist, để tránh mất lịch sử.

- Safety mở **Safety Operations → Overview**, chọn Site/ngày/nhà thầu/đội và xem lịch dự kiến, Zone/camera đang liên kết, cảnh báo và tình trạng checklist. **View related alerts** / **View checklists for this date** giữ đúng ngữ cảnh đội/ngày.
- Safety dùng **Assign checklist** hoặc **New checklist** để chọn nhóm, Zone, công việc, khoảng giờ, đại diện và tiêu chí. Tiêu chí đã giao không sửa; cần đổi thì hủy hồ sơ chưa hoàn tất và giao lại.
- Đại diện được phân công theo Site/nhà thầu dùng **Start checklist → Submit checklist**. Safety dùng **Record checklist** hoặc **Request update**; mỗi lần nộp giữ kết quả và minh chứng riêng. Checklist đã ghi nhận vẫn giữ các mục Fail và không tự cấp phép/chặn lịch, chấm công hoặc vào cửa.
- Từ mục Fail đã ghi nhận, Safety dùng **Create incident**, xác minh trách nhiệm rồi bàn giao bằng luồng Incident hiện có. Notification dùng chung inbox; account đại diện cần contractor_representative_assignment theo đúng Site/nhà thầu, grant toàn cục không đủ.

Giới hạn file ở [Object storage](object-storage.md#checklist-evidence). Checklist không yêu cầu AI/video; Alerts từ video vẫn cần checkpoint/spec thật. Không dùng script seed local để ghi Neon.

### Phase 2: lịch tuần và ngữ cảnh an toàn

- Trong **Overview**, chọn **Day / Week**, **Today** hoặc chuyển tuần; tuần bắt đầu thứ Hai. Chọn ô đội/ngày để xem công việc và lịch tương ứng. Ca qua đêm vẫn thuộc ngày lịch nguồn, có ngày kết thúc rõ ràng.
- Desktop dùng danh sách đội bên trái, chi tiết bên phải; màn hình nhỏ chọn đội rồi dùng **Back**. **View related alerts**, **View checklists for this date** và đường quay lại giữ lựa chọn Overview. Đổi Site/account bỏ ngữ cảnh cũ.
- **Zones and cameras** hiển thị đội cùng Zone, cấu hình camera và bộ đếm theo ngày. **Alert evidence** là ảnh cảnh báo có thời điểm, không phải live. Active chỉ là trạng thái cấu hình. Manager xem tổng hợp; ảnh tiếp tục yêu cầu quyền Alerts của Safety/Admin. Không có file thì hiển thị unavailable.
- **Assign checklist** gợi ý đúng khung giờ lịch nếu chỉ có một khung; nếu nhiều khung phải chọn, không có lịch phải nhập giờ. Safety chỉnh mẫu gợi ý theo công việc trước khi giao; mẫu không phải bộ tiêu chuẩn đã chứng nhận.
- Tiến độ và thời điểm nộp được tách riêng. Lần đầu nộp trước/sau giờ bắt đầu khác với lần bổ sung; pending review là đang chờ Safety. Fail đã ghi nhận có thể mở Incident, theo dõi trạng thái đóng/mở lại; đóng Incident không đổi Fail thành Pass.

**Demo nhanh:** Safety chọn DEMO-ATLD-VI, ngày 14/10/2026 → Week → ô đội Sơn ngày 14 → xem công việc, Zone/camera → mở checklist MẪU 05 để xem PNG/PDF → quay lại Overview. Đội Điện có MẪU 06 còn Fail và Incident MẪU 07. Các cảnh báo mẫu không có frame camera thật nên không có ảnh camera thay thế. Bộ dữ liệu mẫu được giữ nguyên.

**Kiểm chứng Phase 2 — 14/10/2026:** frozen install và peers đạt; pnpm check đạt (Web 436, Backend unit 293, contract 80, client 54, scripts 24); Mobile dependency check đạt. PostgreSQL test riêng: toàn suite 140 đạt, lượt cuối hai suite checklist/workflow 20/20 đạt sau bổ sung assertions ca qua đêm/camera. Compose build/readiness đạt. Browser 1280×800, 768 và 390 không tràn ngang; tuần/đường quay lại, nhập giờ theo lịch hoặc để trống khi không có lịch, PNG/PDF R2 và Escape được kiểm tra. Safety/Manager smoke đọc tuần, đội, thời điểm nộp và file private đạt; Manager không nhận reference ảnh Alert. Session kiểm tra đã thu hồi, không tạo hồ sơ/object mới. Ảnh camera thật chưa smoke vì demo không có frame; build Web còn cảnh báo bundle lớn. Phase 2 không đổi schema/MF03–MF07, không merge main.

Bổ sung UI checklist: sửa lệch Refresh 16px do spacing của card trong hàng flex; rút mô tả và thu gọn tiêu chí đã có báo cáo. Lint, 32 test Web liên quan và Compose build/readiness đạt; kiểm tra desktop 1280×800/mobile 390, lọc Submitted → Refresh giữ đúng 1 hồ sơ, tiêu chí mở/đóng bằng bàn phím và không có console error. API/backend Phase 2 triển khai trước Web; không có migration mới.

Điều hướng checklist: thông báo khác Site mở đúng hồ sơ đích. Đổi hồ sơ hoặc ngữ cảnh đội/ngày đóng biểu mẫu cũ; phản hồi từ lần gửi trước không đổi hồ sơ mới đang xem. Đổi ngôn ngữ vẫn giữ nội dung đang nhập. Rời biểu mẫu không hoàn tác báo cáo đã được Backend ghi nhận; quay lại hồ sơ và Refresh để đối chiếu kết quả.

Ngữ cảnh đội của Alert dùng cùng điều kiện với Overview: participation phải active, khoảng quyền được xét tại thời điểm cảnh báo và loại quyền hết hạn hoặc đã thu hồi tại thời điểm đó. Thu hồi quyền sau thời điểm cảnh báo vẫn giữ ngữ cảnh hợp lệ trước đó. Không đổi schema hoặc contract API.
