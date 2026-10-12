# MF03 — Đối soát, xác nhận giờ làm và duyệt ngoại lệ

Ngày lập kế hoạch: 2026-10-08.

Trạng thái ngày 2026-10-08: đã triển khai backend, migration, contract/client và Web cho Phase 1–5; đã chạy kiểm thử tự động của Phase 6 và cập nhật database/backend/Web local. Chưa nghiệm thu bằng camera/QR thật và chưa có review của thành viên khác. Theo yêu cầu tiếp theo của người dùng, tài khoản hiện có, tài khoản mới và reset mật khẩu không còn bước bắt buộc đổi mật khẩu.

Hướng dẫn sử dụng, API và triển khai: [MF03 vận hành](../operations/mf03-attendance.md). Bản code được kiểm tra riêng tại `D:\SmartSite\smartsite-mf03` để không ghi đè các thay đổi khác trong checkout gốc.

Rà soát mới nhất: [báo cáo nghiệm thu MF03 ngày 2026-10-08](../reviews/mf03-acceptance-review-2026-10-08.md). Hàng đợi yêu cầu đã bổ sung phân trang riêng; lịch thay đổi có UI đối chiếu và hướng dẫn khôi phục theo snapshot cũ. Quyền thay snapshot/tính theo ca mới chưa được chốt. Chưa xác nhận hoàn thành nghiệm thu toàn bộ Phase 6 bằng trình duyệt và thiết bị thật.

Kế hoạch dựa trên code trong checkout `D:\SmartSite\smartsite` tại thời điểm khảo sát; chưa đối chiếu với commit mới trên remote. Các quyết định nghiệp vụ dưới đây đã được người dùng xác nhận và thay thế các quy tắc MF03 xung đột trong tài liệu kế hoạch cũ.

## 1. Mục tiêu và quy tắc đã chốt

Tự động chuyển các lượt vào/ra cổng đã xác nhận bằng **khuôn mặt hoặc QR** thành giờ làm của công nhân. Hệ thống ghép với ca được phân, cộng các khoảng làm việc, phát hiện bất thường và tạo bảng công.

Luồng nghiệp vụ:

```text
Xác nhận qua cổng → Ghép ca → Tính các khoảng làm việc → Phát hiện bất thường
  → Không có bất thường: xác nhận giờ → Bảng công
  → Có bất thường: yêu cầu điều chỉnh → Đại diện nhà thầu duyệt
    → Tính lại và xác nhận giờ → Bảng công
```

| Tình huống                            | Cách xử lý                                                              |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Có ca trong ngày                      | Ghép lượt vào/ra với ca đó                                              |
| Vào trước giờ bắt đầu ca              | Chỉ bắt đầu tính từ giờ bắt đầu ca                                      |
| Vào muộn                              | Tính từ giờ vào thực tế                                                 |
| Ra giữa ca                            | Đóng khoảng đang làm, dừng tính và nhắc công nhân                       |
| Vào lại trong ca                      | Mở khoảng mới; không cộng thời gian ở ngoài                             |
| Checkout khi hết ca                   | Cộng các khoảng hợp lệ để xác nhận tổng giờ                             |
| Checkout sau hết ca, không có tăng ca | Giờ làm thường chỉ tính đến cuối ca                                     |
| Hết ca nhưng thiếu checkout           | Giữ giờ tạm tính, chưa chốt; sau 5 phút thông báo công nhân và đại diện |
| Không có ca                           | Lưu ra/vào, thông báo hai bên và chờ xử lý; chưa cộng giờ               |
| Tăng ca                               | Phải được đại diện duyệt trước khi khoảng tăng ca bắt đầu               |
| Xin nghỉ                              | Hỗ trợ cả ca và một phần ca; đại diện duyệt; không cộng giờ nghỉ        |

**Ví dụ nghiệm thu:** ca 08:00–17:00, IN 08:00 → OUT 11:00 → IN 13:00 → OUT 17:00 = **7 giờ làm**. Lượt ra 11:00 gửi nhắc nhưng không bắt duyệt khi công nhân đã quay lại và kết thúc ca đầy đủ.

Một công nhân chỉ có **một ca chính mỗi ngày**. Tăng ca là khoảng bổ sung; ca qua đêm thuộc ngày bắt đầu ca theo múi giờ của ca.

Không trừ nghỉ trưa cố định. Nếu công nhân ở lại công trường và không có khoảng nghỉ được duyệt thì thời gian trong ca vẫn được tính.

## 2. Hướng triển khai từ code hiện tại

Hiện tại, xác nhận qua cổng và ghi chấm công là hai thao tác riêng. Lượt ra/vào tạm thời đang giữ phiên làm việc mở, nên phải đổi hành vi này.

- Dùng `GateEvent` đã xác nhận làm đầu vào. Nhận diện thành công nhưng chưa xác nhận qua cổng không được tính công.
- Mở rộng mô hình `AttendanceEvent` / `AttendanceSession` đang được sử dụng; mỗi session biểu diễn một khoảng IN–OUT.
- Bổ sung bản tổng hợp ngày công, ngoại lệ và liên kết đến các khoảng làm việc. Không xây thêm luồng tính công song song bằng mô hình `AttendancePair` cũ.
- Giữ nguyên sự kiện gốc. Sửa công được duyệt chỉ thay đổi dữ liệu hiệu lực và lưu lịch sử.
- Tận dụng bảng công và hộp thông báo hiện có, bổ sung migration, API và giao diện tương ứng.
- Chuyển quyền duyệt xin nghỉ từ Site Manager sang đại diện nhà thầu có quyền tại đúng công trường và nhà thầu.

Các điểm tích hợp chính là `AttendanceService`, điểm xác nhận passage dùng chung trong `QrAccessService`, luồng scheduling/absence, hộp thông báo và giao diện Attendance trên Web. Backend sở hữu toàn bộ quyết định nghiệp vụ; không cần thay đổi thuật toán nhận diện trong repo AI.

## 3. Các phase thực hiện

### Phase 1 — Dữ liệu, contract và quy tắc tính giờ

**Đầu ra:** mô hình dữ liệu và bộ tính giờ có thể kiểm thử độc lập.

- Bổ sung tổng hợp ngày công gồm ca, ngày làm, các khoảng IN–OUT, giờ thường, giờ tăng ca, giờ tạm tính, giờ xác nhận, trạng thái và version.
- Lưu thông tin ca được dùng để đối soát, tránh việc sửa lịch âm thầm thay đổi công đã chốt.
- Tổng giờ là độ dài các khoảng hiện diện giao với ca hoặc khoảng tăng ca được duyệt, loại thời gian nghỉ được duyệt và khoảng trùng.
- Cộng thời lượng chính xác trước, rồi lấy số phút hoàn chỉnh cho tổng; giao diện hiển thị giờ và phút.
- Bổ sung kiểm tra một ca chính/ngày vào tất cả thao tác phân ca, đổi ca, swap và thay người.
- Dữ liệu cũ có nhiều ca hoặc phiên không rõ ràng được đánh dấu chờ xử lý; không tự xóa hay gộp.
- Chuẩn hóa quyền duyệt theo tài khoản đang hoạt động và phạm vi Site/Contractor hiện hành.
- Mỗi thay đổi schema có migration TypeORM; giữ `synchronize=false`. Dùng UTC trong lưu trữ và RFC 3339 tại API.

**Điều kiện hoàn thành phase:** contract, migration và bộ tính giờ thống nhất; có kiểm thử tính tổng nhiều khoảng, giới hạn ca, múi giờ và dữ liệu trùng.

### Phase 2 — Tự động chấm công từ Face/QR

**Đầu ra:** quét vào/ra đã xác nhận tự cập nhật giờ công.

- Tích hợp tại điểm xác nhận passage dùng chung cho Face và QR.
- IN hợp lệ mở khoảng hiện diện; OUT đóng khoảng; IN tiếp theo mở khoảng mới.
- Ghép ca bằng công nhân, công trường, ngày làm và múi giờ; hỗ trợ vào trước ca và checkout sau ca.
- Không có ca vẫn lưu dấu vết, tạo ngoại lệ và thông báo; chỉ tính lại sau khi được bổ sung ca hợp lệ.
- Chống xử lý lặp bằng ID sự kiện; khóa theo công nhân để tránh hai phiên mở đồng thời.
- IN lặp, OUT thiếu IN hoặc dữ liệu sai thứ tự không tạo giờ giả; giữ sự kiện và đưa vào xử lý.
- Bỏ thao tác “Record work check-in/out” riêng trên Web. Endpoint cũ được giữ để trả lại kết quả đã có khi gọi lại, tránh cộng công hai lần.
- Bảo toàn kiểm tra quyền vào cổng; lỗi nghiệp vụ đối soát phải được ghi thành ngoại lệ, không làm mất lượt ra/vào đã xác nhận.

**Điều kiện hoàn thành phase:** Face và QR tạo cùng kết quả tính công; ví dụ ra/vào giữa ca đạt 7 giờ; retry và xử lý đồng thời không cộng trùng.

### Phase 3 — Phát hiện bất thường và thông báo

**Đầu ra:** cảnh báo xuất hiện đúng người, đúng thời điểm và không gửi trùng.

- OUT trước cuối ca gửi nhắc công nhân ngay; thông báo ghi rõ thời gian tính công đã tạm dừng.
- Vào lại thì tiếp tục tính. Nếu đến cuối ca vẫn ở ngoài, đánh dấu rời ca sớm để đại diện xử lý, trừ khi khoảng nghỉ đã được duyệt.
- Thiếu checkout sau 5 phút gửi cho công nhân và đại diện; không tạo OUT giả và không tự chốt công.
- Khi có tăng ca được duyệt tiếp nối ca chính, mốc nhắc checkout là cuối khoảng tăng ca.
- Worker chạy mỗi phút, quét cả các mốc đã quá hạn để xử lý được sau khi backend khởi động lại.
- Dùng khóa và ràng buộc duy nhất để chống gửi trùng khi có nhiều backend instance.
- Mở rộng hộp thông báo hiện có với đích điều hướng đến ngày công hoặc yêu cầu cần duyệt.
- Không có đại diện đủ quyền nhận thông báo thì vẫn lưu ngoại lệ và ghi nhận tình trạng thiếu người nhận để vận hành xử lý.

**Điều kiện hoàn thành phase:** cảnh báo thiếu OUT được tạo ở lần quét đầu tiên từ cuối ca + 5 phút; restart không bỏ sót và nhiều instance không gửi trùng.

### Phase 4 — Xin tăng ca, xin nghỉ và sửa công

**Đầu ra:** đại diện duyệt ngoại lệ với lịch sử đầy đủ.

- Công nhân gửi khoảng tăng ca và lý do. Chỉ chấp nhận phê duyệt trước giờ bắt đầu; không cộng giờ ngoài ca chưa được duyệt.
- Giờ tăng ca được tính theo hiện diện thực tế trong khoảng đã duyệt, không tự cộng đủ số giờ xin.
- Bảo đảm các khoảng tăng ca, ca chính và nghỉ không dẫn đến cộng thời lượng trùng.
- Mở rộng xin nghỉ với nghỉ cả ca và khoảng nghỉ trong ca; bảo toàn ca gốc để đối soát.
- Nghỉ được duyệt không cộng giờ và không bị coi là rời ca không phép.
- Tận dụng luồng sửa công hiện có, bổ sung kiểm tra khoảng chồng lấn và tính lại tổng ngày.
- Đại diện có thể xác nhận ngoại lệ rời sớm với giờ thực tế, hoặc duyệt yêu cầu sửa công có lý do.
- Mọi quyết định lưu người duyệt, thời điểm, lý do và version. Từ chối duyệt nếu dữ liệu đã thay đổi hoặc người duyệt không còn đúng phạm vi.
- Gửi thông báo khi có yêu cầu và khi duyệt/từ chối; ngăn tự duyệt yêu cầu của chính mình.
- Các command gửi lại cần có idempotency; review đồng thời chỉ có một quyết định hợp lệ.

**Điều kiện hoàn thành phase:** xin nghỉ cả ca/một phần ca, tăng ca và sửa công chạy đủ luồng gửi → duyệt/từ chối → thông báo → tính lại; có kiểm thử quyền và xung đột version.

### Phase 5 — Xác nhận giờ, bảng công và Web

**Đầu ra:** công nhân và đại diện sử dụng được toàn bộ MF03 trên Web.

- Ngày có đủ lượt, không còn ngoại lệ hoặc yêu cầu chờ xử lý được tự xác nhận khi ca kết thúc.
- Ngày bất thường chỉ xác nhận sau khi xử lý; phân biệt rõ giờ tạm tính với giờ chính thức.
- Bảng công chỉ cộng các ngày đã xác nhận; cho xem chi tiết giờ thường, tăng ca và nghỉ có phép.
- Khi correction được duyệt cho ngày đã xác nhận, cập nhật tổng ngày và bảng công liên quan theo version, giữ lịch sử kết quả trước đó.
- Công nhân xem ca hôm nay, trạng thái đang làm/đang ở ngoài, các lượt vào/ra, tổng giờ và yêu cầu của mình.
- Đại diện xem danh sách theo ngày, công nhân và trạng thái; mở chi tiết để duyệt.
- Site Manager xem trong phạm vi công trường; Security vận hành cổng và xem kết quả cần thiết.
- Bổ sung contract và shared API client cho tổng hợp ngày công, chi tiết khoảng làm, tăng ca, nghỉ một phần ca, xử lý ngoại lệ và bảng công.
- Có phân trang, bộ lọc ngày, trạng thái tải/lỗi/rỗng và xử lý xung đột khi dữ liệu thay đổi.
- Dùng TanStack Query quản lý dữ liệu server và cập nhật cache sau mutation; không viết DTO riêng trong Web.

**Điều kiện hoàn thành phase:** công nhân và đại diện hoàn thành được luồng nghiệp vụ trên Web; bảng công phản ánh đúng các ngày đã xác nhận và các điều chỉnh được duyệt.

### Phase 6 — Kiểm thử và triển khai

**Đầu ra:** luồng hoàn chỉnh có bằng chứng kiểm thử và hướng dẫn vận hành.

- Migration bổ sung dữ liệu; giữ nguyên sự kiện và kết quả lịch sử. Không tự chuyển lượt qua cổng cũ thành công chính thức.
- Áp dụng tự động chấm công từ thời điểm triển khai; dữ liệu lịch sử chỉ tính lại qua thao tác đối soát có audit.
- Cập nhật tài liệu MF03/MF07 theo quyền duyệt và quy tắc mới.
- Triển khai theo thứ tự migration → backend/worker → Web.
- Theo dõi số ngày chưa chốt, sự kiện chưa xử lý và độ trễ cảnh báo; khi tắt luồng mới vẫn bảo toàn dữ liệu cổng để xử lý lại.
- Mỗi phase kèm kiểm thử phần vừa hoàn thành; phase này tập trung hồi quy và nghiệm thu đầu cuối.

**Điều kiện hoàn thành phase:** quality gate và integration test liên quan đạt; demo Face/QR được xác minh riêng theo môi trường thực tế; tài liệu nêu rõ các phần đã kiểm thử và phần còn phụ thuộc thiết bị.

## 4. Kiểm thử và tiêu chí hoàn thành

### Tính giờ và đối soát

- Ca đủ 08:00–17:00 = 9 giờ; vào muộn tính đúng giờ thực tế.
- Vào 07:45, ra 17:20, không tăng ca = 9 giờ.
- Nhiều lần ra/vào cộng đúng; thời gian ngoài cổng không được cộng.
- Thiếu OUT không chốt; cảnh báo sau 5 phút, kể cả sau khi restart.
- Checkout muộn giải quyết thiếu OUT nhưng không tự tạo giờ tăng ca.
- Tăng ca được duyệt trước tính đúng; yêu cầu duyệt sau giờ bắt đầu bị từ chối.
- Nghỉ cả ca hoặc một phần ca được duyệt không cộng giờ nghỉ.
- Không có ca, scan lặp, OUT thiếu IN, ca qua đêm và lịch đổi giữa luồng đều có kết quả xác định.
- Duyệt và sửa công đồng thời không ghi đè hoặc cộng trùng.
- Sửa công sau xác nhận cập nhật bảng công đúng và giữ lịch sử.

### Quyền và tính nhất quán

- Worker không xem công người khác; đại diện không duyệt khác nhà thầu/công trường.
- Kiểm tra trường hợp được phép, bị từ chối, thiếu quyền, quyền đã thu hồi và dữ liệu phạm vi không khả dụng.
- Kiểm thử PostgreSQL thật cho migration, transaction, concurrency và chống gửi trùng.
- Kiểm thử contract/client và các luồng Web, bao gồm lỗi mạng, retry, dữ liệu rỗng và version conflict.
- Hồi quy MF02/MF07: quyền qua cổng, phân ca, đổi ca, swap, xin nghỉ và thông báo hiện có.

### Quality gate khi triển khai

Theo `AGENTS.md`, chạy các kiểm tra áp dụng cho thay đổi:

```sh
pnpm install --frozen-lockfile
pnpm peers check
pnpm check
pnpm --filter @smartsite/mobile check:dependencies
pnpm --filter @smartsite/backend test:integration
```

Chạy migration trên database kiểm thử, kiểm tra định dạng các file thay đổi và Compose readiness nếu có thay đổi cấu hình runtime/container. Không dùng camera thật, GPU hoặc dịch vụ trả phí trong automated test; xác minh thiết bị được báo cáo riêng.

## 5. Phạm vi và mặc định

- Làm **Web trước**; Mobile là giai đoạn riêng, sử dụng lại API chung.
- Thông báo trong tài khoản Web; chưa thêm email, SMS hoặc push.
- MF03 xác nhận thời lượng làm việc; chưa tính lương hay hệ số tăng ca.
- Đi muộn hiển thị rõ và tính thiếu giờ thực tế; mặc định không bắt duyệt nếu dữ liệu đầy đủ.
- Tăng ca được duyệt không tự cấp quyền vào cổng; quyền truy cập vẫn theo cơ chế hiện tại.
- Không giao việc hoặc chỉnh sửa pane của agent khác trong bước tạo tài liệu này.
- Thứ tự thực hiện: **Phase 1 → 2 → 3 → 4 → 5 → 6**.

## 6. Definition of Done

- Các quy tắc đã chốt được thực hiện và đạt các ví dụ nghiệm thu.
- Migration, backend, contract, API client, Web và tài liệu thống nhất.
- Giờ chính thức chỉ được tạo từ dữ liệu hợp lệ hoặc điều chỉnh được duyệt.
- Sự kiện gốc được bảo toàn; retry, xử lý đồng thời và restart không gây mất dữ liệu hoặc cộng trùng.
- Quyền truy cập/duyệt được kiểm tra ở backend theo role và phạm vi dữ liệu.
- Có audit cho yêu cầu, quyết định và thay đổi kết quả; không ghi dữ liệu sinh trắc học hoặc credential vào log.
- Các kiểm tra bắt buộc đạt, không có lỗi chưa giải thích; thay đổi được người khác review trước khi merge.
