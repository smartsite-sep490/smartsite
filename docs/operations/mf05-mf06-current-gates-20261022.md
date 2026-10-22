# MF05/MF06 — checklist hiện tại ngày 22/10

**Chưa hoàn tất sản phẩm.** Bản này thay thế các dòng tiến độ cũ còn ghi chờ cutover local73. Mỗi dấu hoàn thành dưới đây chỉ áp dụng đúng phạm vi bằng chứng đã nêu; không đồng nghĩa nghiệm thu cả phase.

## Phase 2 — giao diện sản phẩm

- [x] Web v34 (`cb187d7`): cấu hình camera riêng; màn giám sát ưu tiên hình; chi tiết mở theo nhu cầu; phóng lớn từng camera và toàn màn hình lưới; pagination và giữ draft/scope. Có kiểm tra phần mềm và bản phục vụ đã đối chiếu.
- [x] Source local bổ sung tên/mã camera vào nhãn truy cập nút phóng to/bằng chứng, kể cả camera trùng tên hoặc chưa đặt tên; nút bằng chứng báo mở dialog. Hai ca mới tái hiện lỗi trước sửa, 41 ca liên quan/3 file PASS, TypeScript với contracts hiện tại và lint PASS. Đã phục vụ trong Web35/flow38; chưa kiểm trình đọc màn hình thật.
- [x] Source MF06 sửa giờ trong overlay/chi tiết quan sát LIVE và REPLAY về `capturedAt` của frame, thống nhất với bảng sự kiện; bỏ giờ xem và fallback `00:00`. Hai ca RED trước sửa, 28 ca liên quan/4 file PASS, scoped TypeScript/lint PASS. Web v35 đã build, khóa asset/source pins và phục vụ trong flow38; xem `mf06-preview-capture-time-20261022.md`.
- [ ] Xem và thao tác thật trên `/ppe`, `/zones`, `/camera-setup`: bố cục, chữ, bàn phím, phóng lớn, bằng chứng, trạng thái lỗi và người mới sử dụng. Inventory trình duyệt đã hiện lại nhưng chưa chứng minh policy URL local đã thay đổi; đang chờ trả lời câu hỏi cài đặt truy cập. Không thử lại đường bị chặn. Chưa có nghiệm thu hiển thị.
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
- [x] Human duyệt thêm 11 ảnh/25 khung Hook; cộng T12 thành 12 ảnh/27 khung mới. Chuyển nhãn thử trong bộ nhớ giữ đủ 5.765 mẫu/659 VAL, chỉ đổi đúng 24 hàng đã chỉ định và giữ lớp0–13. Chưa xuất dataset; còn 2.512 khung Hook nguồn cũ chưa được xác minh theo định nghĩa connector-only. Xem `train-target-transform-review-20261022.md`.
- [x] Human xác nhận 10 khung dương trên hai ảnh công nghiệp C01/C02. Receipt khóa ảnh/tọa độ/figure; giữ riêng ngoài TRAIN. Chưa xác nhận nhãn đầy đủ, negative, consent hay independence; chưa đưa vào bộ qualification. Xem `independent-ppe-source-audit-20261022.md`.
- [x] Bổ sung và xem hai nguồn C04/C05; tổng bốn ảnh reserved/ba nhóm nguồn đề xuất, bảy family có ví dụ nhìn thấy nhưng Boots vẫn thiếu. Probe nhỏ gọi pipeline hiện tại xác nhận kính ở vùng thân vẫn cho technical PRESENT: containment chưa chứng minh đang đeo. Không chạy model hay đổi thuật toán/ngưỡng. Xem `reserved-ppe-coverage-wearing-boundary-20261022.md`; chưa đóng gate wearer/qualification.
- [x] Bổ sung C07/C08 và C10: bảy ảnh reserved/năm nhóm nguồn đề xuất, Boots vật thể đã có nhưng chưa chứng minh Boots đang mang trong công trường. C10 có EXIF6; đã khóa pixel display, kiểm chiều/hướng/RGB và round-trip hai box. Tám box C04/C10 đã được human duyệt tọa độ; xem cập nhật intake bên dưới. Review độc lập xác nhận khoảng thiếu wearer và intake đánh giá cũ chỉ hai family; Root kiểm13 source pins, chưa sửa schema/thuật toán. Xem `ppe-footwear-orientation-review-20261022.md`.
- [x] AI local `2c0dfae`: intake review quan hệ PPE phiên bản riêng, khóa ảnh/EXIF/receipt/tọa độ, giữ DRAFT và UNKNOWN. Bốn ảnh C01/C02/C04/C10: 18 khung dương được duyệt. Bản draft gốc giữ 11 quan hệ chưa xác định; receipt riêng sau đó ghi human duyệt 9 liên kết/vùng review trên C01/C02/C04 (3 mũ, 4 găng, 1 kính, 1 vest), SHA256 dc78eae95b99e1a357128936c3f055ca585076f10c87f8e481a6a229b6fac111. Human sau đó duyệt riêng C05: kính đang treo dưới mặt; receipt e43268252c26e9d5daab65f4f8b38df772e24706e00db58f402ec20cd5783e6c chỉ xác nhận quan hệ này, chưa duyệt tọa độ/negative. Chưa có Boots đang mang được duyệt; không xác nhận độ vừa khít, an toàn, nhãn đầy đủ hay model. Final 129 ca liên quan/4 file và scoped lint PASS; chưa đổi runtime, TRAIN hay model. Xem `ppe-relation-intake-20261022.md`.
- [ ] Bộ qualification đủ mọi PPE, nhãn và coverage được review, phân nhóm video/scene, quyền sử dụng rõ. Bộ 30 frame hiện tại chưa đủ: nhiều ảnh đen/hoạt hình/phỏng vấn/máy thi công. Không gọi ảnh chưa nhãn là negative hoặc human GT.
- [ ] Xử lý bất nhất phạm vi nhãn Hook/Harness và các sai số đã xem bằng dữ liệu được review; không sửa tập đánh giá cũ để làm đẹp điểm. Đã nhận bản bàn giao inventory/phương án cuối từ phiên AI, Root kiểm 6 artifact pins và 12 source pins; không coi phiên còn chạy. Phương án NO-Gloves 72 ảnh/151 khung là thay đổi dữ liệu thật so với V9, nhưng chưa mở lượt train: cả 72 ảnh đều có target class6 và chỉ có một target Gloves kế thừa, chưa đủ đối chứng được review cho tay đeo găng/tay bị che.

## Phase 6 — train và đánh giá YOLO11s

- [x] V12 thực sự hoàn thành 3 epoch/exit0, checkpoint tải được; Root đối chiếu hash và tính lại 19 kết quả từ số liệu đã lưu.
- [x] Kiểm tra loss CPU nhỏ xác nhận UNKNOWN Hook không tạo gradient BCE hoặc GT Hook cho assigner; Hook đã duyệt và NO-Gloves giữ tín hiệu học. Hai forward tổng cộng, một backward trên logits tách rời, không optimizer/update. Đây là cơ chế phần mềm, không phải chất lượng model.
- [ ] Model đạt: **V12 bị loại, 6/19 PASS**. NO-Gloves và Mask cải thiện nhưng Gloves/Hook và các lớp khác còn hồi quy. Không apply V12.
- [ ] Chỉ chạy thử nghiệm tiếp khi sửa dữ liệu/protocol có căn cứ và các cổng lifecycle đạt; sau đó cần qualification độc lập và kiểm tra wearer, tay bị che, các PPE nhỏ. Test học/ảnh đã dùng phát triển không thay independent quality.

## Phase 7 — camera/video → Backend → Web

- [ ] Model được chấp nhận chạy trên nguồn thật, mọi camera hỗ trợ cấu hình đúng khả năng thực tế; đo reconnect/drop/latency và giới hạn phần cứng.
- [ ] Mỗi bằng chứng gắn đúng Site/Camera/Region/version/thời gian/hash; mở được ảnh đúng quyền, không dùng ảnh cũ như frame hiện tại.
- [ ] Chứng minh cảnh báo đã lưu, đúng loại PPE và người nhận/scope; Web hiển thị và điều hướng rõ. Fixture thông báo trước không chứng minh toàn luồng camera thật.
- [ ] Phân biệt người chưa xác định, Worker đã xác nhận, team/site và quyền ở thời điểm sự kiện; không tự gán danh tính hoặc kết luận unauthorized khi UNKNOWN.
- [ ] Owner nghiệm thu toàn luồng, có bằng chứng xem được. Chưa có toàn bộ production acceptance.

## Demo local đã nối — 22/10 17:19VN

- [x] Bốn nguồn preview qua Backend200: hai LIVE (laptop/Tapo), hai REPLAY; Web36 bật. Bản cuối flow41/Node73780, PG69444/schema73 giữ nguyên. Browser chưa nghiệm thu.
- [x] Replay AI thực tạo cảnh báo thiếu mũ/áo và thông báo cho demo.safety; ảnh JPEG được đọc đúng quyền và khớp file lưu. Các cảnh báo PENDING_REVIEW, không phải GT/vi phạm được human xác nhận. Có nhiều lượt chạy cùng clip; không đếm thành công nhân/sự cố độc lập.
- [x] MF06 enqueue/worker đã bật: lượt hash-bound tạo9 request/job SUCCEEDED, lịch sử200 và ảnh SHA-bound200. Kết quả cả9 là ALLOWED/POLICY_NONE theo chính sách hiện có; chưa chứng minh quyền/identity Worker hay phát hiện unauthorized.
- [x] Đã sửa producer AI (7b99080) để gắn SHA ảnh thực và xuất version1.2/1.3.77 ca hash/evidence/domain và21 runtime PASS, lint PASS. Không nới guard ảnh Backend.
- [x] Tapo LIVE durable worker riêng đang xử lý thực (120 frame lúc17:19), outbox/evidence và MF06 auto enqueue. Chưa chứng minh cảnh báo phát sinh từ LIVE. Laptop mới có preview.
- [x] Ảnh nền cấu hình vùng trên bốn nguồn đang chạy: đúng quyền Site Manager, camera/version/SHA, reference5phút; no-op lưu polygon hiện có và đọc lại200, giữ nguyên geometry/version. AI router d3681ee chỉ quan sát raw capture đã chạy, không mở nguồn/model từ request; cold/new camera còn cần binding riêng. Chưa kiểm thao tác kéo/vẽ thật trên browser.
- [ ] Hoàn thiện mọi camera có durable delivery, cold/new source binding, kiểm UI thật, live source recovery/capacity, chất lượng model và identity/authority; các gate production ở trên vẫn OPEN.

Hướng dẫn demo: docs/operations/demo-local-mf05-mf06-20261022.md. Artifact/proof trong SmartSiteData/runs/demo-ai-notification-20261022-v1; checkpoint phục hồi v194. Preview deadline02:41VN23/10, website expiry theo receipt; phải xác minh lại sau reboot/expiry. Không push/merge/deploy.
