# MF03 — Vận hành chấm công và xác nhận giờ làm

## Quy tắc

- Luồng Face và QR dùng chung điểm xác nhận qua cổng. Chỉ lượt qua cổng đã xác nhận mới tạo chấm công; kết quả nhận diện đơn thuần chưa tính giờ.
- Giờ của ca mẫu được ghép với `WorkerSchedule.workDate` theo múi giờ của ca. Ca qua đêm thuộc ngày bắt đầu ca.
- Mỗi ngày có một ca chính. Nhiều lần IN/OUT tạo nhiều khoảng; các khoảng trùng được gộp trước khi xác định thời gian ra ngoài. Vào trước ca chỉ tính từ đầu ca, vào muộn tính từ giờ vào.
- IN yêu cầu lịch ca active cho ngày làm việc theo múi giờ ca, hoặc ca qua đêm/tăng ca được duyệt đang diễn ra. Lịch ngày cũ/ngày tương lai không thay thế lịch hôm nay. Face, QR và xác minh thủ công đều từ chối `NO_SCHEDULE`; ghi chú Security không cho phép bỏ qua thiếu lịch. Ngoài giờ của một ca đã phân công trong ngày vẫn giữ quy trình Security xác nhận hiện có.
- Khi Worker có danh tính và quyền công trường hợp lệ nhưng thiếu lịch, hệ thống gửi thông báo `ENTRY_DENIED_NO_SCHEDULE` cho Worker, một lần mỗi công trường/ngày giữa các lượt Face/QR/thủ công. Thông báo mở lịch làm việc, không tạo ngày công/IN giả. Lịch bị bỏ phân công giữa xác minh và xác nhận cũng chặn IN, lưu trạng thái DENIED và thông báo trước khi trả lỗi `WORKER_NO_SCHEDULE`.
- OUT vẫn được ghi nhận để công nhân có thể rời công trường khi không có ca. OUT của ngày làm việc mới không tự đóng phiên còn thiếu checkout của ngày cũ; tạo phiên `MISSING_IN` cho ngày mới nếu không có IN phù hợp. Ca qua đêm/tăng ca đang diễn ra vẫn giữ ngày bắt đầu ca. Các sự kiện đã ghi trước bản sửa không được tự sửa hoặc gán lại; dùng đối soát có duyệt.
- Site Manager có thể cấu hình một khoảng nghỉ trưa không tính công khi tạo ca (`breakStartsAt`, `breakEndsAt`); bỏ trống cả hai nghĩa là không cấu hình nghỉ. Backend từ chối thiếu một mốc, khoảng đảo ngược hoặc nằm ngoài ca. Giờ nghỉ dùng múi giờ của ca và được ghép với ngày phân công, kể cả ca qua đêm.
- Giờ công ca chính = giờ ca chuẩn (loại hợp của nghỉ trưa và nghỉ phép được duyệt) trừ vào muộn, về sớm và thời gian ra ngoài vi phạm. Trong ca chỉ tính đến thời điểm hiện tại. Mỗi lượt ra ngoài mặc định miễn trừ 15 phút; vượt ngưỡng chỉ trừ phần vượt. Từ lượt thứ 3 (mặc định tối đa 2 lượt), trừ toàn bộ thời gian của lượt đó. Manager cấu hình ngưỡng 0–120 phút và tối đa 0–10 lượt khi tạo ca. Nghỉ trưa/nghỉ phép không bị trừ hai lần; lượt hoàn toàn trong các khoảng này không đếm. OT vẫn tính riêng theo hiện diện thực tế trong khoảng được duyệt.
- Ca 08:00–17:00, nghỉ 12:00–13:00: hiện diện cả ca tính 480 phút; ra ngoài 11:00–11:30 ở lượt được miễn trừ tính 465 phút; ra ngoài 12:00–13:00 vẫn tính 480 phút.
- Ngày công lưu snapshot giờ nghỉ cùng giờ ca. Ca/ngày công cũ không được tự gán nghỉ hoặc tính lại hồi tố. Luồng này cấu hình lúc tạo ca, chưa có API sửa giờ nghỉ cho ca đã tạo.
- Tăng ca phải được duyệt trước khi bắt đầu. Chỉ cộng phần hiện diện thực tế trong khoảng tăng ca được duyệt, ngoài ca chính.
- Thiếu checkout giữ giờ tạm tính và chờ bổ sung hoặc sửa công được duyệt. Ca hôm sau có thể bắt đầu, còn phiên thiếu checkout hôm trước vẫn giữ nguyên để đối soát.
- OUT trước hết ca nhắc công nhân. Lượt ra ngoài đang diễn ra cũng được kiểm tra mỗi phút: vượt ngưỡng/số lần thì gửi cảnh báo một lần cho Worker và đại diện nhà thầu theo từng lượt. Cảnh báo chỉ nêu lý do và quy tắc trừ công; không hiển thị thời gian ngoài giờ nghỉ hay số phút bị trừ tại lần kiểm tra. Vi phạm tự trừ giờ và không yêu cầu duyệt riêng nếu lượt quét đầy đủ. Đến hết ca vẫn chưa quay lại thì trừ toàn bộ giờ về sớm; cần đại diện xác nhận giờ thực tế hoặc duyệt sửa công.
- Worker chạy khi backend khởi động và mỗi phút, xử lý ngày công theo từng transaction. Thiếu OUT từ cuối ca + 5 phút thông báo cho công nhân và đại diện. Với tăng ca nối tiếp, dùng thời điểm kết thúc khoảng tăng ca đã duyệt.
- Sự kiện gốc không bị sửa. Sửa công thay đổi thời gian hiệu lực và có audit, kiểm tra version và khoảng chồng lấn.
- Chỉ ngày được xác nhận mới được cộng vào bảng công. Các API đọc và duyệt kiểm tra quyền hiện hành và phạm vi công trường/nhà thầu tại backend.

## API

Các endpoint dưới đây yêu cầu user token và bắt đầu bằng `/api/v1/sites/:siteId`.

| Endpoint                                          | Mục đích                                                                                                                                                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /attendance-days`                            | Ngày công trong phạm vi được phép; lọc `fromDate`, `toDate`, `workerId`, `status`, `offset`, `limit`                                                                                                                                                                         |
| `GET /attendance-days/:id`                        | Chi tiết ngày công và từng khoảng vào/ra                                                                                                                                                                                                                                     |
| `GET /attendance-timesheets`                      | Tổng giờ đã xác nhận theo công nhân và khoảng ngày                                                                                                                                                                                                                           |
| `POST /attendance-time-requests`                  | Worker xin `OVERTIME` hoặc `LEAVE` với request ID, lịch, khoảng thời gian và lý do                                                                                                                                                                                           |
| `GET /attendance-time-requests`                   | Hàng đợi có phân trang riêng: `kind=OVERTIME\|LEAVE` bắt buộc, `status=PENDING\|APPROVED\|REJECTED`, `workerId`, `offset`, `limit` (1–100; mặc định 20). `PENDING` ánh xạ sang `PENDING_MANAGER` đối với nghỉ; trả `{ items, total }` trong phạm vi hiện hành của người đọc. |
| `POST /attendance-time-requests/:kind/:id/review` | Đại diện duyệt/từ chối, kèm ghi chú                                                                                                                                                                                                                                          |
| `POST /attendance-days/:id/confirm`               | Đại diện xác nhận giờ thực tế của ngày rời sớm, kèm version và ghi chú                                                                                                                                                                                                       |
| `POST /attendance-sessions/:id/ignore-duplicate`  | Đại diện bỏ qua IN trùng với `expectedSessionVersion` và `reason`; lưu người xử lý, thời điểm và audit                                                                                                                                                                       |
| `GET /attendance`                                 | Danh sách session/correction tương thích với luồng cũ                                                                                                                                                                                                                        |
| `POST /attendance-sessions/:id/corrections`       | Worker xin sửa giờ, kèm session version                                                                                                                                                                                                                                      |
| `POST /attendance-corrections/:id/review`         | Đại diện duyệt/từ chối sửa công                                                                                                                                                                                                                                              |

`POST /gate-events/:id/attendance` vẫn trả lại session đã có cho lượt qua cổng được xử lý tự động; không tạo thêm giờ khi gọi lại. Luồng xin nghỉ MF07 sử dụng chung bảng `absence_request` và quyền duyệt đại diện.

Ví dụ yêu cầu tăng ca:

```json
{
  "requestId": "11111111-1111-4111-8111-111111111111",
  "workerScheduleId": "22222222-2222-4222-8222-222222222222",
  "kind": "OVERTIME",
  "startsAt": "2026-10-09T17:00:00+07:00",
  "endsAt": "2026-10-09T18:00:00+07:00",
  "reason": "Hoàn thành hạng mục được giao"
}
```

Form nghỉ/tăng ca trên Web nhập ngày và giờ theo múi giờ của ca được chọn, rồi chuyển sang UTC RFC 3339 để gửi Backend. Form correction hiện vẫn nhập theo múi giờ thiết bị. Backend dùng múi giờ của ca khi xác định ngày làm.

Form correction tách **Proposed in / Proposed out** thành lịch chọn ngày và dropdown giờ **00–23**, phút **00–59**; không yêu cầu nhập giây/millisecond. Có thể chọn ngày lịch sử và ngày ra khác ngày vào cho ca qua đêm. Múi giờ thiết bị hiển thị ngay dưới các ô. Thời điểm đã ghi nhận được giữ nguyên độ chính xác nếu không chỉnh; ô được chỉnh sẽ gửi thời điểm tới phút, với giây/millisecond bằng 0. Chọn phiên khác sẽ tải lại ngày/giờ đúng phiên, không giữ giá trị đã nhập cho phiên trước.

Danh sách **Assigned shift** trong form nghỉ/tăng ca chỉ hiển thị lịch active hôm nay hoặc tương lai, đối chiếu theo múi giờ từng ca; lịch sử ngày công vẫn giữ nguyên. Lựa chọn có ngày, tên ca, khung giờ và múi giờ. Khi chọn Overtime, gợi ý bắt đầu cuối ca (hoặc mốc tương lai gần nếu cuối ca đã qua) và kết thúc một giờ sau; khi chọn Leave, gợi ý khoảng ca chính. Đây chỉ là giá trị gợi ý có thể chỉnh, không phải giờ được tự động duyệt/cộng công. Các ô **Start date**, **Start time**, **End date**, **End time** cho phép đặt ngày kết thúc khác với ngày bắt đầu, bao gồm ca qua đêm. Không tải được giờ ca thì form báo unavailable/retry, không cho gửi dựa trên dữ liệu thiếu.

## Chạy thử trên Web

### Dashboard Worker — cập nhật ngày 2026-10-10

- Worker mở **My Work Hours**: giờ ghi nhận hôm nay là `provisionalMinutes`, còn **Confirmed Hours This Month** và **Confirmed Overtime This Month** lấy từ API `attendance-timesheets` cho toàn tháng, độc lập với phân trang/bộ lọc lịch sử. Tăng ca đã nằm trong tổng giờ chốt, không cộng lại lần nữa.
- **Days Needing Attention This Month** lấy `total` từ API ngày công lọc `NEEDS_REVIEW` và khoảng tháng. Lỗi API hiển thị unavailable/retry, không thay bằng số 0.
- Khoảng hôm nay tải từ chi tiết đúng ngày công. Thông báo có `dayId` mở ngày được chỉ định và đổi tiêu đề theo ngày. Khi chưa có dữ liệu hôm nay, không lấy lịch sử ngày cũ để hiển thị như hôm nay.
- Dashboard dùng múi giờ của ngày công gần nhất để xác định ngày/tháng; trước khi có ngày công, dùng múi giờ thiết bị và hiển thị múi giờ đang dùng. Ca qua đêm vẫn thuộc `workDate` bắt đầu ca.
- Các phiên lịch sử chưa checkout được ghi **Open session**; không khẳng định công nhân hiện đang trong công trường. IN trùng/đã bỏ qua không hiển thị marker như OUT thật.
- Theo yêu cầu người dùng, giữ **Request Overtime or Leave** và danh sách yêu cầu cá nhân. Worker không có thao tác duyệt của đại diện hoặc Enrol Worker. Backend tiếp tục kiểm tra quyền/scope cho tất cả API.

1. Đăng nhập bằng mật khẩu hiện tại. Sau migration `OptionalPasswordChange1791676800002`, không còn bước bắt buộc đổi mật khẩu sau khi cấp/reset.
2. Đại diện phân ca cho Worker tại đúng công trường và ngày làm. Đăng ký khuôn mặt và quyền qua cổng theo MF01/MF02 trước khi thử với thiết bị thật.
3. Security xác minh Face hoặc QR rồi xác nhận Worker đã thực sự qua cổng. Không cần thao tác ghi chấm công riêng.
4. Mở **Site Access → Attendance (MF03)**. Worker xem công của mình; đại diện xem và duyệt trong phạm vi nhà thầu.
5. Với ca 08:00–17:00, thử IN 08:00 → OUT 11:00 → IN 13:00 → OUT 17:00: tổng phải là 7 giờ.
6. Thử thiếu OUT: giờ phải vẫn tạm tính; thông báo được tạo từ 17:05 ở lần quét của worker nền tiếp theo.
7. Thử tăng ca được duyệt trước: IN/OUT phải giới hạn theo khoảng tăng ca đã duyệt. Thử nghỉ một phần ca: thời gian nghỉ không cộng vào giờ làm.
8. Xem **Confirmed timesheet** để đối chiếu tổng ngày được xác nhận.

Kiểm thử tự động dùng dữ liệu tổng hợp và database `smartsite_test`. Không dùng camera thật hoặc dịch vụ trả phí trong các test này.

## Xử lý IN trùng, thiếu IN và phiên chưa checkout

### Chặn lượt quét lặp tại cổng

Backend kiểm tra lượt qua cổng gần nhất của Worker trong cùng Site trước khi xác nhận lượt mới, dưới khóa Worker của transaction. Khi cùng chiều IN/OUT trong ngày làm việc và chưa có lượt ngược chiều, trả HTTP 409 với `GATE_PASSAGE_ALREADY_RECORDED` và thông báo **Already checked in/out**. Không tạo thêm GateEvent, AttendanceEvent hay AttendanceSession, không tiêu thụ QR và không sinh thêm ngoại lệ cần đại diện duyệt. Các attempt xác minh vẫn được giữ; lỗi quyền, identity, phiên hết hạn và QR hết hiệu lực vẫn bị từ chối theo quy tắc cũ.

Ngày làm tiếp theo vẫn có thể bắt đầu khi ngày cũ thiếu checkout. Ca qua đêm/tăng ca đã duyệt dùng giờ kết thúc của ngày công để giữ ranh giới ngày làm. IN → OUT → IN trong một ngày được ghi nhận bình thường.

Nếu Security xác nhận đây thực sự là một lượt qua cổng riêng biệt, không phải camera quét lại, chọn **This is a separate physical passage, not a repeated scan** và nhập lý do mới tối thiểu 5 ký tự. Command bổ sung `separatePassage: true` cùng `reviewNote`. Backend chỉ cho Security đúng Site dùng ngoại lệ này và ghi audit; MF03 vẫn giữ cảnh báo thiếu/trùng bằng chứng thực tế để đại diện đối soát. Không tự tạo OUT giả hoặc đổi IN thành OUT.

Không cần migration mới. Deploy Backend và client/Web cùng nhau để nhận diện error code mới và trường command bổ sung. Các dòng duplicate cũ không tự bị xóa/bỏ qua; dùng quy trình dưới đây khi xác định là lượt quét lặp.

1. **IN trùng:** đại diện mở Attendance → View ngày công, nhập Review note tối thiểu 5 ký tự và bấm **Ignore duplicate IN** trên dòng trùng. Chỉ dòng có raw CHECK_IN nhưng không phải khoảng làm việc hợp lệ mới được bỏ qua. Worker, Security và người ngoài Site/Contractor không được thực hiện; không tự duyệt công của mình. Session chuyển `IGNORED`, lưu `ignoredBy`, `ignoredAt`, `ignoreReason`, tăng version và ghi audit `ATTENDANCE_DUPLICATE_IGNORED`. Raw AttendanceEvent/GateEvent không đổi và dòng này không cộng giờ.
2. **Thiếu IN:** Worker mở View để tải đúng phiên của ngày đó, chọn session có OUT nhưng thiếu IN trong form correction. Giờ OUT đã ghi nhận được điền sẵn, giữ cả giây/millisecond. Worker nhập giờ IN thực tế và lý do; đại diện duyệt yêu cầu. Không tự dùng đầu ca làm giờ IN. Backend chặn khoảng dương bị chồng lấn và phiên có version đã thay đổi.
3. **Phiên đang mở:** Worker quét OUT bằng Face/QR; Security xác nhận actual passage. OUT đóng phiên mở của đúng ngày và tính lại tổng. Khi ngày trước thiếu checkout nhưng hôm nay đã có các lượt ra/vào, OUT không tự đóng phiên cũ. Nếu Worker đã rời mà quên quét, dùng correction với giờ ra thực tế và đại diện duyệt; không tạo GateEvent giả.
4. Bỏ qua một IN trùng không tự chốt ngày khi vẫn còn MISSING_IN, MISSING_OUT hay request chờ duyệt. Gửi lại cùng thao tác ignore, cùng version gốc/người xử lý/lý do không tạo thêm audit. Version cũ, dòng thật, pending correction hoặc quyền bị thu hồi bị từ chối.
5. UI dùng `rawInAt`/`rawOutAt` để phân biệt IN trùng với OUT. Marker thời gian trong `effectiveOutAt` của dòng duplicate không phải sự kiện OUT; không hiển thị nó như checkout. Dòng thiếu IN không được coi là Active Inside. `IGNORED` không thể được sửa thành một khoảng làm việc để cộng giờ.

Migration `Mf03AttendanceDuplicateReview1791676800003` cần chạy trước backend mới. Downgrade bị từ chối khi có session IGNORED để giữ lịch sử xử lý.

## Hàng đợi yêu cầu và ca thay đổi

- Sau khi Worker gửi form nghỉ/tăng ca thành công, form được thay bằng thẻ **Request submitted.** và trạng thái lấy từ Backend: **Pending approval**, **Approved** hoặc **Rejected**, kèm thời gian/lý do/ghi chú duyệt. Thẻ tải lại trạng thái mỗi 15 giây, độc lập bộ lọc hàng đợi. Bấm **New request** mới mở lại form; việc này không tự gửi thêm đơn. Sau tải lại trang, xem các đơn đã gửi trong **Time Requests**.
- Đại diện bấm **Approve** để duyệt trực tiếp trong **Time Requests**, không cần ghi chú. Bấm **Reject** mở form **Reason for rejection**, bắt buộc lý do rồi bấm **Confirm rejection**; **Cancel rejection** không gửi quyết định. OT vẫn phải được duyệt trước khi bắt đầu. Xác nhận ngày công vẫn cần ghi chú theo quy trình riêng.
- Mỗi Worker tại một công trường chỉ được có một yêu cầu sửa công `PENDING`, kể cả khi yêu cầu thuộc ngày/phiên khác với bộ lọc đang xem. Backend khóa Worker trong transaction trước khi kiểm tra và tạo đơn; retry cùng request ID và cùng nội dung trả lại đơn cũ. Chỉ sau khi contractor chấp thuận hoặc từ chối mới được gửi đơn tiếp. Không tự xóa hoặc từ chối các đơn trùng đã tồn tại trước bản sửa.
- Trong **Correction requests**, contractor xem giờ đã ghi nhận, khoảng giờ đề nghị và lý do của Worker. **Approve correction** duyệt ngay, không cần lý do. **Reject correction** mới mở ô **Rejection reason**; **Confirm rejection** bắt buộc lý do, **Cancel rejection** không gửi quyết định. Giờ công vẫn được tính lại bằng quy tắc hiện diện/nghỉ trưa hiện hành khi correction được chấp thuận; không thay đổi sự kiện quét gốc.
- Thông báo **TIME_REQUESTED** chỉ gửi đến đại diện nhà thầu cần xử lý. Worker theo dõi trạng thái trong Attendance và nhận **TIME_APPROVED / TIME_REJECTED** khi có kết quả. Các bản TIME_REQUESTED cũ gửi nhầm cho vai trò WORKER bị loại khỏi danh sách và bộ đếm thông báo tại Backend; bản ghi gốc không bị xóa. Cảnh báo khác như EARLY_EXIT và MISSING_CHECKOUT giữ nguyên người nhận.

Ví dụ duyệt nghỉ/tăng ca: `{ "approve": true }`. Ví dụ từ chối: `{ "approve": false, "reviewNote": "No additional work is needed" }`. Client cũ vẫn có thể gửi ghi chú kèm approve; Backend mới chấp nhận để tương thích. Cập nhật Backend trước Web. Không cần migration.

- Trong **Time requests**, chọn Queue type và Request status, rồi dùng **Previous requests / Next requests**. Phân trang hàng đợi độc lập với phân trang ngày công; bộ lọc Worker áp dụng cho cả hai. Sau gửi/duyệt, hàng đợi được tải lại. Khi API lỗi, dùng **Retry time requests**; không duyệt từ danh sách đã lỗi.
- Khi có `SCHEDULE_CHANGED`, mở **View** để đối chiếu ca gốc dùng tính công và ca được phân hiện tại. Các mốc thời gian được hiển thị theo múi giờ tương ứng của ca. Lịch không tồn tại hoặc giờ ca không hợp lệ được hiển thị là unavailable.
- Nhờ Site Manager khôi phục giờ ca, đại diện nhà thầu khôi phục phân ca phù hợp với công nhân/ngày gốc. Thay ca mẫu có thể ảnh hưởng công nhân khác. Liên kết **Open workforce schedule** mở phân ca đúng công trường; quyền sửa vẫn được kiểm tra ở backend.
- Worker nền tính lại ở lượt quét tiếp theo; Refresh tải lại kết quả. Mọi ngoại lệ khác cũng phải được giải quyết trước khi chốt. UI ẩn xác nhận rời sớm nếu còn ngoại lệ khác; backend vẫn chặn độc lập. Bước này không thay snapshot, không tạo sự kiện cổng và không cấp quyền tự tính lại theo ca mới.

Lần bổ sung phân trang/đối chiếu ca ngày 2026-10-08 đã đạt `pnpm check` (Backend 265, Web 330, client 42 test) và PostgreSQL integration 114/114. Cập nhật Backend trước Web; không cần migration mới ngoài các migration MF03 hiện có. Artifact đã build nhưng image local chưa được cập nhật cho lần bổ sung này. Xem phần kiểm tra mới nhất trong báo cáo bên dưới.

## Kết quả kiểm tra ngày 2026-10-08

Rà soát yêu cầu, sửa lỗi và giới hạn còn lại: [kế hoạch đối soát MF03](../planning/mf03-attendance-reconciliation-plan.md). Chưa nghiệm thu toàn bộ các ngoại lệ và phần cứng/UI trình duyệt thật.

Bản MF03 được kiểm tra riêng tại `D:\SmartSite\smartsite-mf03`, nhánh `feat/mf03-verified-20261008`, trên nền commit `480c04c`. Checkout gốc vẫn giữ các thay đổi khác của người dùng.

- Cài dependency với frozen lockfile thành công; không thêm dependency mới.
- `pnpm peers check` và kiểm tra dependency Mobile đạt.
- `pnpm check` đạt: lint, typecheck, unit/consumer/Web test và build cả workspace. Sau bổ sung xử lý IN trùng/sửa IN thiếu, Backend có 263 unit test đạt; Web có 324 test; API client có 42 test.
- Bộ integration PostgreSQL có 112 test đạt, bao gồm zero metadata drift, migration giữ dữ liệu cũ, Face/QR passage, retry, phân quyền, nhiều khoảng làm việc, thiếu checkout, ca qua đêm, nghỉ, tăng ca và bỏ yêu cầu đổi mật khẩu bắt buộc.
- Prettier trên tất cả file thay đổi và `git diff --check` đạt.

Database local đã chạy các migration MF03 và `OptionalPasswordChange1791676800002`; không còn tài khoản bị đánh dấu bắt buộc đổi mật khẩu. Backend/Web ở cổng 3000/5173 đã được cập nhật. Do registry chậm, image local được tạo từ dependency hiện có (lockfile không đổi) và artifact mới build tại checkout gốc để giữ các thay đổi khác của người dùng. Compose readiness, đăng nhập thực tế của đại diện, `GET /attendance-days` và `GET /attendance-timesheets` đều trả 200; API trả `mustChangePassword: false`. Chưa xác minh giao diện bằng trình duyệt hay camera/QR thật. Cần review và nghiệm thu thiết bị trước khi phát hành.

## Triển khai và dữ liệu cũ

- Bản sửa ranh giới ngày công/quyền vào theo lịch cần migration `GateScheduleDenial1791849600000` trước Backend/Web mới. Migration mở rộng enum CHECK thông báo, không sửa sự kiện vào/ra hay ngày công cũ; downgrade từ chối khi đã có lịch sử thông báo từ chối mới.

- Chạy migration `ShiftBreak1791763200001` trước Backend có hỗ trợ nghỉ trưa, sau đó cập nhật Web. Migration thêm các cột nullable cho Shift và Attendance Day, giữ dữ liệu cũ không có nghỉ. Downgrade bị từ chối khi có cấu hình hoặc snapshot nghỉ để bảo vệ lịch sử; khi rollback ứng dụng vẫn giữ schema và cấu hình nghỉ.
- `POST /shifts` nhận hai mốc nghỉ RFC 3339 tùy chọn; `GET /shifts` và API ngày công trả hai mốc nullable. Client cũ có thể bỏ qua trường response mới; client mới chỉ gửi cấu hình nghỉ khi Backend và migration mới đã triển khai. Không thay đổi contract AI.

- Chạy migration `Mf03AttendanceReconciliation1791676800000` và `Mf03DailyOpenSessions1791676800001` trước khi khởi động backend mới; sau đó cập nhật Web.
- Không chạy migration bằng kết nối khác với database đang phục vụ ứng dụng. Bản local đang mở trong Docker sử dụng PostgreSQL ở cổng 5432; database test ở cổng 5433.
- Không backfill các lượt qua cổng cũ thành giờ công chính thức. Tự động chấm công áp dụng cho các lượt được xác nhận bằng backend mới.
- Các lịch nhiều ca cũ được giữ nguyên và đánh dấu trong `attendance_schedule_conflict`; không thêm ca chính mới trùng ngày. Đại diện cần xử lý lịch xung đột trước khi xác nhận công.
- Khi lịch đổi sau khi ngày công đã bắt đầu, snapshot giờ ca không bị thay đổi âm thầm. Ngày công được đánh dấu `SCHEDULE_CHANGED`; cần khôi phục lịch phù hợp với snapshot hoặc giải quyết lịch trước khi chốt.
- Tắt hoặc quay lại backend cũ vẫn phải giữ các bảng/sự kiện MF03. Migration từ chối downgrade gây mất dữ liệu chấm công.
- Theo dõi log `attendance.reconcile.day_failed`, `attendance.shift.invalid`, `attendance.notification.no_representative` và các ngày `NEEDS_REVIEW`.
- Xác minh Face/QR bằng thiết bị thật và review của người khác là bước nghiệm thu riêng trước khi phát hành.

## Cập nhật Docker và kiểm tra lại MF03/MF07

Ngày 2026-10-08 đã build Backend/migrate/Web bằng Dockerfile chuẩn và cập nhật runtime local. Migration quản lý đội đã chạy; schema runtime không drift, không pending migration. PostgreSQL integration chạy lại đạt **122/122** và Web tests **344/344**. Hai Worker demo đăng nhập và đọc API MF03/MF07 thành công. Xem [kế hoạch đối soát MF03](../planning/mf03-attendance-reconciliation-plan.md) cho phạm vi, backup và các phần chưa nghiệm thu. Những số liệu ở các mục kiểm tra trước đó là lịch sử từng lần kiểm tra.

## Triển khai chính sách ra ngoài

Áp dụng migration `1792281600000-ShiftExitGracePeriod` và `1792281600001-AttendanceExitNotifications` trước khi chạy Backend mới. Migration thứ hai mở rộng constraint thông báo; không rollback khi còn lịch sử vi phạm. Giờ thường không vượt mốc kết thúc ca: checkout 17:30 cho ca kết thúc 17:00 không cộng 30 phút, trừ khi có OT được duyệt tương ứng (tính riêng theo hiện diện thực tế).
