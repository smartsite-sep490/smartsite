# MF05/MF06 — checklist hiện tại ngày 22/10

**Chưa hoàn tất sản phẩm.** Bản này thay thế các dòng tiến độ cũ còn ghi chờ cutover local73. Mỗi dấu hoàn thành dưới đây chỉ áp dụng đúng phạm vi bằng chứng đã nêu; không đồng nghĩa nghiệm thu cả phase.

## Phase 2 — giao diện sản phẩm

- [x] Web v34 (`cb187d7`): cấu hình camera riêng; màn giám sát ưu tiên hình; chi tiết mở theo nhu cầu; phóng lớn từng camera và toàn màn hình lưới; pagination và giữ draft/scope. Có kiểm tra phần mềm và bản phục vụ đã đối chiếu.
- [x] Source local bổ sung tên/mã camera vào nhãn truy cập nút phóng to/bằng chứng, kể cả camera trùng tên hoặc chưa đặt tên; nút bằng chứng báo mở dialog. Hai ca mới tái hiện lỗi trước sửa, 41 ca liên quan/3 file PASS, TypeScript với contracts hiện tại và lint PASS. Chưa rollout thay Web v34, chưa kiểm trình đọc màn hình thật.
- [ ] Xem và thao tác thật trên `/ppe`, `/zones`, `/camera-setup`: bố cục, chữ, bàn phím, phóng lớn, bằng chứng, trạng thái lỗi và người mới sử dụng. Công cụ hiện báo `Local browser use is disabled in Work settings`; human đã cho phép, không cần xin lại. Chưa có nghiệm thu hiển thị.
- [ ] Owner xác nhận luồng desktop dễ dùng. Mobile để sau.

## Phase 3 — Backend, database và hợp đồng

- [x] Source Backend `5e118c5` đăng ký đủ 73 migration; có source/compiled pins và kiểm tra giới hạn release.
- [x] Human duyệt; cutover website local sang schema73 đã thực hiện, giữ dữ liệu/quyền/IDs/selections và giữ schema72 để khôi phục. Lịch sử quyền đã kích hoạt READY qua phiên WEB Admin gốc. Bằng chứng: `local73-activation-20261022.md` (`6ba00c4`). Không còn chờ quyết định local73.
- [x] API cấu hình, lịch sử và ảnh có các bằng chứng scope/auth/HTTP/PostgreSQL và actual-main riêng. Đây không phải chứng nhận mọi API hay identity ngoài hiện trường.
- [ ] Ghép với camera/model đạt chuẩn để chứng minh ảnh thật → quan sát hợp lệ → assessment/sự kiện lưu → cảnh báo/thông báo → Web. Không thay eventId bằng alertId và không suy Worker từ track.
- [ ] Xác nhận Worker/team/nguồn Face-consent và quyền tại thời điểm ghi hình bằng dữ liệu có thẩm quyền; READY của journal không tự chứng minh identity.

## Phase 4 — vận hành và release

- [x] Khôi phục SQL schema73 có READY đã diễn tập trên schema riêng: 92 bảng business/audit và 73 ledger rows được đối chiếu; clone dọn đúng phạm vi. Bằng chứng: `local73-ready-recovery-20261022.md` (`b98a0d4`).
- [ ] Chứng minh khôi phục DB + media có dữ liệu đại diện theo release hiện tại. Inventory media của lần khôi phục SQL trên rỗng; các fixture restore trước là bằng chứng riêng, không thay được media hiện trường.
- [ ] Chốt môi trường HTTPS, cấu hình release, giới hạn tài nguyên, tải/soak/capacity, CI và review/release authority. Không tự provision, push, merge hoặc deploy.
- [ ] Visitor Excel bundle vẫn thuộc người phụ trách Access; không tự sửa phần đã được yêu cầu bàn giao.

## Phase 5 — dữ liệu và protocol AI

- [x] Protocol 19 learning controls được khóa; V12 có checkpoint/recipe/CSV/nguồn truy vết. Không đổi gate để nhận model đã bị loại.
- [x] Root lập quy tắc phạm vi nhãn PPE (`ppe-annotation-targets-20261022.md`, `cf956fe`): connector Hook khác cả bộ dây, harness khác áo phản quang; ghi rõ trường hợp không xác định. Đây là mục tiêu kỹ thuật, không tự duyệt lại nhãn vendor/human.
- [x] Đối chiếu metadata/license và định danh 5 file video với nguồn hiện tại (`2943a9e`); kiểm tra 30 ảnh/53 source pins và xem đủ 5 contact sheets (`fcaf883`).
- [x] Human duyệt riêng hai khung Hook của một ảnh TRAIN T12; receipt gắn đúng ảnh/tọa độ/hash. Root kiểm 18 bản sao/36 source pins và giữ nguyên nguồn. Xem `train-t12-connector-decision-20261022.md`; chưa xuất dataset hay mở lượt train từ quyết định một ảnh này.
- [ ] Bộ qualification đủ mọi PPE, nhãn và coverage được review, phân nhóm video/scene, quyền sử dụng rõ. Bộ 30 frame hiện tại chưa đủ: nhiều ảnh đen/hoạt hình/phỏng vấn/máy thi công. Không gọi ảnh chưa nhãn là negative hoặc human GT.
- [ ] Xử lý bất nhất phạm vi nhãn Hook/Harness và các sai số đã xem bằng dữ liệu được review; không sửa tập đánh giá cũ để làm đẹp điểm. Phiên AI đang tìm tối đa 3 nguồn công khai phù hợp; kết quả tìm kiếm chưa phải dữ liệu được duyệt.

## Phase 6 — train và đánh giá YOLO11s

- [x] V12 thực sự hoàn thành 3 epoch/exit0, checkpoint tải được; Root đối chiếu hash và tính lại 19 kết quả từ số liệu đã lưu.
- [ ] Model đạt: **V12 bị loại, 6/19 PASS**. NO-Gloves và Mask cải thiện nhưng Gloves/Hook và các lớp khác còn hồi quy. Không apply V12.
- [ ] Chỉ chạy thử nghiệm tiếp khi sửa dữ liệu/protocol có căn cứ và các cổng lifecycle đạt; sau đó cần qualification độc lập và kiểm tra wearer, tay bị che, các PPE nhỏ. Test học/ảnh đã dùng phát triển không thay independent quality.

## Phase 7 — camera/video → Backend → Web

- [ ] Model được chấp nhận chạy trên nguồn thật, mọi camera hỗ trợ cấu hình đúng khả năng thực tế; đo reconnect/drop/latency và giới hạn phần cứng.
- [ ] Mỗi bằng chứng gắn đúng Site/Camera/Region/version/thời gian/hash; mở được ảnh đúng quyền, không dùng ảnh cũ như frame hiện tại.
- [ ] Chứng minh cảnh báo đã lưu, đúng loại PPE và người nhận/scope; Web hiển thị và điều hướng rõ. Fixture thông báo trước không chứng minh toàn luồng camera thật.
- [ ] Phân biệt người chưa xác định, Worker đã xác nhận, team/site và quyền ở thời điểm sự kiện; không tự gán danh tính hoặc kết luận unauthorized khi UNKNOWN.
- [ ] Owner nghiệm thu toàn luồng, có bằng chứng xem được. Chưa có toàn bộ production acceptance.

## Runtime được ghi nhận gần nhất

Website local flow35: Node12916, Web v34, Backend `5e118c5`, schema73 và authority READY; expiry được ghi là 13:19 VN ngày 22/10. Đây là trạng thái ở lần xác minh trước, không cam kết process còn sống sau expiry/reboot. Camera/AI worker/enqueue/Apply của website đang OFF; không tự bật bằng model bị loại.

Checkpoint phục hồi: `checkpoint-main-integration-progress-v179.json` trong tooling `demo-readiness-20261014-v1/main-0dd7d27-integration-20261017-v1/`. Những heading cũ ghi schema72, chờ local73 hoặc training-running là lịch sử.

**Thứ tự tiếp theo:** mở được trình duyệt thì kiểm tra UI thật; song song hoàn thiện dữ liệu/qualification; chỉ sau model đạt mới đóng luồng camera thật và release. Không dùng số test hay tỷ lệ checkbox làm phần trăm hoàn thiện sản phẩm.
