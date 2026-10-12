# Kịch bản nghiệm thu thủ công MF03 và MF07

Ngày soạn: 12/10/2026. Đối chiếu source và hướng dẫn vận hành trong checkout hiện tại.

Đây là **kịch bản để thực hiện**, không phải báo cáo đã PASS. Mọi trường hợp bắt đầu ở trạng thái NOT RUN. Kiểm thử tự động trước đây không thay thế kết quả nghiệm thu trình duyệt/thiết bị của bạn.

## 1. Chuẩn bị và cách ghi kết quả

- Web local: <http://localhost:5173>. Refresh bằng Ctrl+F5 trước khi bắt đầu.
- Dùng công trường/nhà thầu và tài khoản thử nghiệm được phép; không dùng dữ liệu nhân sự thật để tạo tình huống lỗi.
- Mở các browser profile riêng cho từng vai trò; nhiều tab cùng profile thường dùng chung phiên đăng nhập. Ghi rõ vai trò và Site đang chọn ở mỗi bước.
- Giữ máy/thiết bị đúng giờ, múi giờ `Asia/Ho_Chi_Minh`. Form nghỉ/tăng ca theo múi giờ ca; form sửa công theo múi giờ thiết bị.
- Lượt qua cổng gồm hai bước: xác minh Face/QR và Security xác nhận thực sự qua cổng. Chỉ xác minh chưa tạo công.
- QR Worker: Security mở fallback session cho kết quả Face không kết luận được hoặc báo `CAMERA_UNAVAILABLE`; Worker mở **QR của tôi**, chọn đúng Site, nhập mã session và trình QR. Security mở session phải quét/xác nhận đúng cổng và chiều. QR không bỏ qua quyền hoặc thiếu lịch; session/token có hạn dùng.
- Ghi thời gian IN/OUT thực tế tới giây. Hệ thống cộng thời lượng rồi lấy phút hoàn chỉnh; thao tác lệch vài giây có thể làm tổng thấp hơn ví dụ lý tưởng 1 phút. Đối chiếu timestamp thực tế trước khi kết luận FAIL.
- Các case tính công dùng **Worker/ngày riêng**, hoặc chạy ngày khác. Không gộp nhiều tình huống độc lập vào cùng ngày vì chỉ có một ca chính/Worker/ngày.
- Các case sau phụ thuộc trạng thái cũ phải thực hiện đúng chuỗi được chỉ định. Case đổi đội, thu hồi quyền, archive và mất mạng chạy sau luồng thành công.
- Không đổi giờ hệ thống, sửa trực tiếp DB hoặc backdate sự kiện để rút ngắn bài test. Case qua đêm/ngày kế tiếp cần chạy theo thời gian thật. Nếu không đủ thời gian/thiết bị, ghi BLOCKED với lý do.

### Tài khoản và dữ liệu tối thiểu

| Mã         | Vai trò/dữ liệu                  | Điều kiện                                                       |
| ---------- | -------------------------------- | --------------------------------------------------------------- |
| SM-A       | Site Manager của Site A          | Tạo ca/phiên bản lịch, cấp ca cho nhà thầu                      |
| REP-A      | Đại diện Contractor A tại Site A | Quản lý đội, phân ca, duyệt đúng phạm vi; khác tài khoản Worker |
| SEC-A      | Security của Site A              | Vận hành cổng test G1 và xác nhận passage                       |
| W1, W2     | Worker của Contractor A/Site A   | Cùng đội T1; account/Worker/face profile active; có quyền G1    |
| W3         | Worker cùng nhà thầu/site        | Đội T2, để thử swap khác đội                                    |
| W4         | Worker cùng nhà thầu/site        | Chưa vào đội; dùng kiểm tra thành viên mới                      |
| W5, W6     | Worker dự phòng                  | Dùng các bài công/ngày riêng, thiếu lịch, mất quyền             |
| REP-B, W-B | Đại diện và Worker phạm vi khác  | Contractor B hoặc Site B; để kiểm tra không lộ dữ liệu          |
| SM-B       | Site Manager của Site B          | Không có quyền quản lý Site A                                   |
| ADMIN      | Admin thử nghiệm nếu có          | Kiểm tra Admin không thay quyền phân ca/duyệt của đúng vai trò  |

Nếu chưa đủ tài khoản, nhờ người quản trị chuẩn bị trước; không đánh dấu PASS các case quyền khi chỉ kiểm tra việc ẩn nút.

Đặt tên dữ liệu `UAT-20261012-...` hoặc theo ngày bạn thực sự chạy. Tạo phiên bản lịch V1 có phạm vi ngày bao phủ tất cả ngày test; cấp các ca cần dùng cho Contractor A.

| Ca  | Giờ địa phương      | Nghỉ không tính công | Mục đích                            |
| --- | ------------------- | -------------------- | ----------------------------------- |
| S0  | 08:00–17:00         | Không cấu hình       | Tổng đủ ca = 9 giờ                  |
| S1  | 08:00–17:00         | 12:00–13:00          | Tổng đủ ca = 8 giờ                  |
| S2  | 17:00–20:00         | Không cấu hình       | Swap với S1: tiếp giáp, không chồng |
| S3  | 16:00–19:00         | Không cấu hình       | Swap với S1: chồng giờ, phải chặn   |
| SN  | 22:00–06:00 hôm sau | 02:00–02:30 hôm sau  | Ca qua đêm, đủ ca = 7 giờ 30 phút   |

Đây là ca mẫu cho đối chiếu, không bắt buộc dùng giờ 08:00. Có thể tạo ca ngắn ở tương lai để chạy nhanh; tất cả giờ tạo/form phải nằm trong ngày và phiên bản lịch hợp lệ.

### Phiếu kết quả dùng cho từng case

```text
Case ID:
Trạng thái: NOT RUN / PASS / FAIL / BLOCKED
Ngày giờ thực hiện và timezone:
Vai trò / Site / Contractor / Worker:
Ca / workDate / ID yêu cầu hoặc ngày công:
Kết quả thực tế (timestamp, trạng thái, tổng phút):
Ảnh màn hình / HTTP status và error code nếu có:
Sai khác so với kỳ vọng:
```

Không chụp mật khẩu, bearer token, QR còn hiệu lực hoặc ảnh khuôn mặt vào báo cáo chia sẻ. Có thể dùng ảnh giao diện đã che thông tin và ID dữ liệu test.

## 2. Hai bài chạy nhanh trước khi nghiệm thu đầy đủ

### Bài A — MF07: tạo đội → phân ca → swap → duyệt (khoảng 20–30 phút)

1. SM-A tạo V1 và hai ca **QA**, **QB** cho cùng một ngày tương lai: QA 14:00–14:30, QB 14:30–15:00; điều chỉnh ngày/giờ nếu đã qua. Cấp cả hai cho Contractor A.
2. REP-A mở Dashboard → Teams, tạo T1; Workers → đưa W1/W2 vào T1.
3. REP-A mở Schedule Setup → Worker Assignment: chọn Worker W1, V1, QA, One day; **Preview assignments** rồi **Confirm assignments**. Lặp cho W2 với QB. Không phân cả T1 một ca trong bài này.
4. W1 mở **My Schedule**, kiểm tra đúng ca/ngày/đội; chọn **Request swap** với W2 và nhập lý do test.
5. W2 mở thông báo hoặc yêu cầu nhận được; kiểm tra hai ca rồi **Accept Swap**. Lúc này lịch chưa được đổi.
6. REP-A mở hàng đợi duyệt; kiểm tra tên hai Worker, đội, ngày ca và giờ ca rồi duyệt.
7. W1/W2 refresh: W1 nhận QB, W2 nhận QA, yêu cầu thành `APPLIED`; cả hai nhận thông báo kết quả. Không có ngày nào bị thêm ca thứ hai.
8. Ghi PASS chỉ khi cả hai lịch cùng đổi; một bên đổi là FAIL nghiêm trọng. Dùng ngày/Worker khác cho bài MF03 để tránh lẫn dữ liệu.

### Bài B — MF03: IN → OUT tạm → IN lại → OUT cuối ca (khoảng 35–45 phút)

1. Chọn Worker dự phòng chưa có ca/ngày công hôm nay. SM-A tạo ca ngắn **QC**: bắt đầu T, kết thúc T+30 phút, nghỉ T+10 → T+15. Chọn T cách hiện tại ít nhất 10 phút để kịp setup. REP-A phân QC cho Worker đó.
2. Kiểm tra Worker có quyền G1 và enrollment hợp lệ. Security xác minh rồi xác nhận IN gần T.
3. Worker mở My Work Hours: xuất hiện đúng ngày công, một khoảng mở, giờ hôm nay là tạm tính; chưa cộng vào giờ tháng đã chốt.
4. Security xác nhận OUT gần T+8, IN lại gần T+18. Worker nhận nhắc khi OUT; thời gian ở ngoài không cộng công.
5. Security xác nhận OUT tại hoặc ngay sau T+30. Refresh sau lượt xử lý nền nếu cần.
6. Kiểm tra hai khoảng, timestamp thực tế, hết trạng thái phiên mở. Nếu không có ngoại lệ/yêu cầu chờ, ngày được xác nhận và bảng công cập nhật.
7. Ví dụ lý tưởng IN T, OUT T+8, IN T+18, OUT T+30 = **20 phút**. Nghỉ T+10 → T+15 nằm hoàn toàn trong thời gian ở ngoài nên không được trừ thêm 5 phút.
8. Chạy lại bằng phương thức còn lại Face/QR với Worker/ngày khác để xác nhận cả hai transport thực tế; thành công bằng QR chưa chứng minh Face hoạt động.

## 3. MF07 — Bộ nghiệm thu đầy đủ

Các case không ghi giờ cụ thể dùng ca **chưa bắt đầu**, trừ bài kiểm tra deadline/swap sau IN. Sau mỗi thao tác đổi lịch, kiểm tra bằng cả REP-A và Worker liên quan.

| ID    | Chuẩn bị và thao tác                                                                                                                                                                                               | Kết quả phải thấy                                                                                                                                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 07-01 | REP-A mở Dashboard, chọn Site A/Contractor A; nếu có nhiều scope, đổi scope rồi trở lại.                                                                                                                           | Đúng tên/mã Site và nhà thầu; KPI Worker/đội/chưa vào đội hợp lý. Form/bộ lọc cũ không gửi dữ liệu sang scope mới.                                                                                                                                                                         |
| 07-02 | Tạo T1; thử tạo tên trùng chỉ khác hoa/thường/khoảng trắng; sửa tên/mô tả đội hợp lệ.                                                                                                                              | Tạo/sửa thành công; tên active trùng cùng scope bị chặn, không thêm đội trùng.                                                                                                                                                                                                             |
| 07-03 | Đưa W4 chưa có đội vào T1 không nhập lý do. Sau đó chuyển W4 sang T2 hoặc bỏ đội, thử lý do dưới 5 ký tự rồi lý do hợp lệ.                                                                                         | Thêm mới không cần lý do; chuyển/bỏ đội cần lý do ≥5 ký tự. Worker chỉ có một membership active; lịch đã phân không tự đổi.                                                                                                                                                                |
| 07-04 | Archive đội đang có Worker active; sau đó dùng một đội test rỗng để archive.                                                                                                                                       | Đội còn thành viên hợp lệ bị chặn; đội rỗng archive được, lịch sử vẫn giữ. Không nhầm archive đội với archive ca.                                                                                                                                                                          |
| 07-05 | SM-A tạo V1/ca hợp lệ, chọn nghỉ; thử thiếu một mốc nghỉ, nghỉ ngoài ca, nghỉ kết thúc trước bắt đầu. Cấp ca cho Contractor A.                                                                                     | Khoảng nghỉ hợp lệ được lưu; input sai bị từ chối. REP-A chỉ sử dụng ca đã cấp; Admin/REP/Worker không thay quyền tạo ca của SM.                                                                                                                                                           |
| 07-06 | REP-A chọn Team T1 → One day → preview → confirm cho một ngày trống.                                                                                                                                               | Preview đúng thành viên/ngày/số worker-days; confirm tạo lịch mỗi người. Worker nhìn thấy lịch cá nhân, không thấy lịch Worker khác.                                                                                                                                                       |
| 07-07 | REP-A chọn Worker W3 và phân một ngày khác; chọn ca/phiên bản đúng phạm vi.                                                                                                                                        | Chỉ W3 được phân; Worker không cần thuộc đội để được phân cá nhân. Ca chưa được cấp hoặc archived không được chọn/sử dụng.                                                                                                                                                                 |
| 07-08 | One week: thử chọn thứ Ba; đổi từ One day có ngày thứ Ba sang One week, rồi chọn thứ Hai. Chọn thứ Hai–thứ Sáu làm việc.                                                                                           | Chỉ thứ Hai được chọn làm đầu tuần; ngày không hợp lệ bị xóa để chọn lại. Cuối tuần là Chủ nhật; preview chỉ tạo các weekday được chọn.                                                                                                                                                    |
| 07-09 | Repeat weekly đến ngày kết thúc: T1 có 2 người, chọn 2 tuần đầy đủ thứ Hai–thứ Sáu, không có lịch cũ.                                                                                                              | Preview 10 ngày/người, 20 worker-days; không tạo thứ Bảy/Chủ nhật hoặc ngày ngoài khoảng. Không yêu cầu job tự lặp vô hạn.                                                                                                                                                                 |
| 07-10 | Bỏ chọn W2 khỏi preview đội; phân W2 riêng ca khác cùng ngày.                                                                                                                                                      | Batch đội chỉ gồm người còn chọn; W2 nhận ca riêng, không hai ca chính.                                                                                                                                                                                                                    |
| 07-11 | Preview phạm vi có sẵn một lịch active; thử confirm.                                                                                                                                                               | Xung đột ghi đúng Worker/ngày; không ghi đè lịch cũ, không tạo một phần các ngày còn lại. Lịch inactive trùng khóa lịch sử cũng có thể là conflict.                                                                                                                                        |
| 07-12 | Preview thành công, rồi thay ngày/ca/người trên form.                                                                                                                                                              | Preview cũ không còn dùng được; phải preview lại trước confirm.                                                                                                                                                                                                                            |
| 07-13 | Tab 1 preview; tab 2 REP-A chuyển thành viên hoặc phân lịch xung đột; tab 1 confirm.                                                                                                                               | Backend recheck và từ chối preview lỗi thời; không ghi một phần batch. Tải lại/preview mới có thể tiếp tục.                                                                                                                                                                                |
| 07-14 | Trong Assignment batches, đổi ca/hủy một ngày của riêng W1; tiếp đó đổi/hủy từ một ngày trở đi cho batch khác. Nhập lý do.                                                                                         | Chỉ đúng thành viên/ngày/batch được đổi; các ngày ngoài phạm vi giữ nguyên. Hủy chuyển inactive, giữ hàng/lịch sử.                                                                                                                                                                         |
| 07-15 | Thử đổi/hủy qua batch khi ca đã bắt đầu, đã có attendance hoặc có đơn nghỉ/OT/change/swap pending/approved liên quan. Mỗi điều kiện dùng dữ liệu riêng.                                                            | Từng điều kiện bảo vệ đều chặn; không đổi attendance hay lịch khác trong cùng command. Khác với swap, sửa batch không cho sửa ca đã bắt đầu.                                                                                                                                               |
| 07-16 | Sau khi tạo batch đội, thêm W4 vào đội; xem lịch W4 trước khi áp dụng, rồi dùng Apply remaining dates to new members → preview/confirm.                                                                            | Ban đầu W4 không tự nhận lịch; thao tác explicit tạo các ngày còn lại đúng ca/weekdays, không viết lại công lịch sử.                                                                                                                                                                       |
| 07-17 | Chuyển W3 sang T1 nhưng W3 còn lịch tương lai đội cũ; thử áp dụng lịch T1.                                                                                                                                         | Preview chỉ rõ conflict. Hủy các lịch tương lai thuộc batch cũ phù hợp rồi preview lại; không tự xóa lịch cũ khi chuyển đội.                                                                                                                                                               |
| 07-18 | W1 gửi Request change sang ca hợp lệ; REP-A duyệt. Dùng yêu cầu khác để REP-A từ chối.                                                                                                                             | Duyệt áp dụng một lần và gửi kết quả; từ chối giữ ca cũ. Site Manager không thay đại diện để duyệt.                                                                                                                                                                                        |
| 07-19 | W1/W2 cùng T1, cùng ngày/V1, S1 và S2: W1 gửi swap → W2 Accept Swap → REP-A duyệt.                                                                                                                                 | Trước duyệt cuối lịch giữ nguyên; sau duyệt cả hai cùng đổi, `APPLIED`, không tạo hai ca chính/ngày và có thông báo đúng người.                                                                                                                                                            |
| 07-20 | Swap mới: W2 Decline; swap khác: W2 accept rồi REP-A reject.                                                                                                                                                       | Hai nhánh đều giữ cả hai lịch cũ; phân biệt đồng nghiệp từ chối và đại diện từ chối; người yêu cầu nhận đúng kết quả.                                                                                                                                                                      |
| 07-21 | Thử swap với bản thân, W3 khác đội, W4 chưa đội, W-B khác scope, khác workDate/V1, cùng ca, ca chồng giờ S1/S3.                                                                                                    | Không được đưa vào ứng viên hoặc bị từ chối khi gửi; không đổi lịch. S1/S2 tiếp giáp là trường hợp được phép, không bị coi chồng.                                                                                                                                                          |
| 07-22 | Swap pending: chuyển một người sang T2 trước khi accept/approve. Lặp case rời T1 rồi quay lại T1 trước duyệt.                                                                                                      | Yêu cầu cũ không áp dụng; khi xử lý mất điều kiện chuyển `CONFLICTED`. Membership mới không làm binding cũ hợp lệ trở lại.                                                                                                                                                                 |
| 07-23 | Ca ngắn gần kết thúc: gửi change/swap trong ca, chờ tới cuối ca rồi accept hoặc approve; thử tạo yêu cầu mới sau cuối ca.                                                                                          | Backend khóa lúc chính xác kết thúc, kể cả yêu cầu đã gửi trước. Mã hiện hành `SHIFT_WORK_DATE_PASSED`; từ chối/decline vẫn thực hiện được.                                                                                                                                                |
| 07-24 | Với ca qua đêm, mở lịch/yêu cầu sau nửa đêm nhưng trước cuối ca; thử lại sau cuối ca.                                                                                                                              | Hiển thị next day và ngày bắt đầu đúng; chưa khóa chỉ vì đổi ngày, khóa khi ca thực sự kết thúc.                                                                                                                                                                                           |
| 07-25 | W1 đã IN ở ca S1, W2 có S2 cùng đội/ngày và cả hai ca chưa hết; hoàn thành swap rồi mở MF03 W1.                                                                                                                    | Lịch có thể swap theo điều kiện hiện hành; raw IN/snapshot công cũ giữ nguyên, có `SCHEDULE_CHANGED`, không tự chốt theo ca mới.                                                                                                                                                           |
| 07-26 | SM-A archive ca đang có lịch; Show archived; Worker mở lịch/công cũ; thử phân mới/chọn làm target change.                                                                                                          | Ca ẩn ở selector mới; lịch/công cũ vẫn có tên/giờ, không phát sinh `SCHEDULE_CHANGED` chỉ vì archive. Archive lặp giữ timestamp.                                                                                                                                                           |
| 07-27 | Worker gửi change đến ca còn dùng được; SM-A archive target trước khi đại diện duyệt.                                                                                                                              | Duyệt bị chặn, lịch cũ giữ nguyên; yêu cầu vẫn có thể từ chối.                                                                                                                                                                                                                             |
| 07-28 | Có >20 Worker hoặc >1 trang yêu cầu/đội: lọc tên/ID, Next/Previous, mở đơn cũ từ thông báo.                                                                                                                        | Không mất Worker sau trang đầu; tổng/lọc đúng scope, mở đúng request ngoài trang hiện tại; ngày ca tách khỏi ngày gửi yêu cầu.                                                                                                                                                             |
| 07-29 | Batch chứa ngày đã bắt đầu, một ngày có công và nhiều ngày tương lai. Chọn Edit unstarted schedules → Change shift, ca thay thế, lý do → Confirm schedule change; lặp bài khác với Cancel schedules và một Worker. | Không cần chọn từng ngày. Chỉ lịch active chưa bắt đầu/không có attendance được sửa hoặc hủy; lịch được bảo vệ giữ nguyên. Hiển thị số lịch đã xử lý và bỏ qua. Nếu không còn lịch đủ điều kiện, báo lỗi và không thay đổi. Yêu cầu liên quan trên lịch đủ điều kiện vẫn phải xử lý trước. |

## 4. MF03 — Bộ nghiệm thu đầy đủ

Với mỗi case định lượng, REP-A phân đúng ca trước khi IN; Worker có quyền cổng hợp lệ. Kết quả giờ dưới đây dùng timestamp lý tưởng. Nếu chạy ca ngắn, tính lại bằng công thức ở cuối phần này.

| ID    | Chuẩn bị và thao tác                                                                                                                                                    | Kết quả phải thấy                                                                                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 03-01 | Có lịch hôm nay: SEC-A chỉ xác minh Face/QR, chưa xác nhận passage; W mở My Work Hours. Sau đó Security xác nhận IN.                                                    | Chưa confirm không tạo IN/công; confirm tạo đúng một khoảng mở/ngày công. Không cần nút ghi chấm công riêng.                                                                                           |
| 03-02 | S0: IN 08:00, OUT 17:00, không đơn pending/ngoại lệ.                                                                                                                    | 540 phút, không trừ nghỉ cố định; ngày CONFIRMED sau xử lý, bảng công tăng 540 phút.                                                                                                                   |
| 03-03 | S1: IN 08:00, OUT 17:00.                                                                                                                                                | 480 phút thường; thấy nghỉ 12:00–13:00 trong chi tiết, chỉ trừ một lần.                                                                                                                                |
| 03-04 | S1: IN 07:45, OUT 17:20, không tăng ca.                                                                                                                                 | Giới hạn giờ thường trong ca, 480 phút; thời gian sớm/muộn không tự thành OT. Ngoài giờ vẫn phải qua policy Security hiện hành.                                                                        |
| 03-05 | S1: IN 08:30, OUT 17:00.                                                                                                                                                | 450 phút thường; thể hiện giờ vào muộn. Nếu không còn ngoại lệ thì không bắt đại diện duyệt chỉ vì đi muộn.                                                                                            |
| 03-06 | S1: IN 08:00 → OUT 11:00 → IN 13:00 → OUT 17:00.                                                                                                                        | Hai khoảng, 420 phút; nhắc khi OUT tạm, quay lại và hoàn thành ca không cần duyệt lần rời tạm.                                                                                                         |
| 03-07 | S1: IN 08:00 → OUT 12:00 → IN 13:00 → OUT 17:00.                                                                                                                        | 480 phút; không trừ thêm giờ nghỉ đã nằm trong thời gian ở ngoài.                                                                                                                                      |
| 03-08 | S1: IN 08:00 → OUT 11:00 → IN 11:30 → OUT 17:00.                                                                                                                        | 450 phút: trừ 30 phút ra ngoài và 60 phút nghỉ trong hiện diện.                                                                                                                                        |
| 03-09 | S1: IN 08:00 → OUT 15:00, không quay lại. Chờ qua cuối ca; REP-A mở View, nhập review note và Confirm actual hours for early departure.                                 | Trước xử lý còn cần review; xác nhận giờ thực tế 360 phút, không tự cộng đến 17:00; audit có người/lý do, bảng công cập nhật sau xác nhận.                                                             |
| 03-10 | Ca ngắn: IN rồi không OUT. Chờ cuối ca +5 phút và lượt worker nền tiếp theo.                                                                                            | Giữ giờ tạm tính, không chốt/không cộng bảng công; Worker và đại diện đủ quyền nhận cảnh báo thiếu OUT; không tự tạo OUT. Nền quét mỗi phút, ghi giờ nhận thực tế.                                     |
| 03-11 | Sau 03-10, refresh nhiều lần; nếu người vận hành cho phép, restart Backend local rồi kiểm tra lại.                                                                      | Không gửi trùng thông báo cùng ngoại lệ; restart không làm mất ngày chưa chốt. Case restart có thể BLOCKED nếu không tiện gián đoạn local.                                                             |
| 03-12 | Sau thiếu OUT cùng ngày, xác nhận OUT muộn thật.                                                                                                                        | Đóng đúng phiên/ngày, tổng thường vẫn giới hạn cuối ca; không tự cộng OT chưa duyệt. Kiểm tra ngoại lệ thiếu OUT đã được tính lại.                                                                     |
| 03-13 | Ngày D có IN thiếu OUT; ngày D+1 phân ca và ghi IN/OUT đầy đủ.                                                                                                          | D+1 có phiên riêng; OUT D+1 không đóng phiên D. Ngày D vẫn chờ xử lý, không mất raw events.                                                                                                            |
| 03-14 | Worker hôm nay không có lịch nhưng identity/quyền G1 hợp lệ; thử Face, QR và lặp lại.                                                                                   | IN DENIED; Gate Desk ghi Access Denied và You have not been assigned a work shift for today.; không tạo công. Worker nhận một thông báo thiếu lịch/Site/ngày, mở lịch. QR hoặc ghi chú không override. |
| 03-15 | Worker có lịch hôm qua hoặc ngày mai nhưng không lịch hôm nay; thử IN.                                                                                                  | Vẫn bị chặn như 03-14; lịch sai ngày không thay thế lịch hôm nay.                                                                                                                                      |
| 03-16 | Worker không có IN phù hợp ngày hôm nay: Security xác nhận OUT thực tế.                                                                                                 | Cho phép ghi nhận rời cổng theo policy hiện hành; tạo MISSING_IN, không tự lấy đầu ca làm giờ vào/không tạo giờ giả. Worker gửi correction với giờ IN thực tế để đại diện xét.                         |
| 03-17 | IN thành công; quét/xác nhận IN lần nữa, không OUT xen giữa. Lặp tương tự OUT → OUT.                                                                                    | Already checked in/out; không thêm passage/session hoặc công, không tạo duplicate cần review từ một scan lặp thông thường.                                                                             |
| 03-18 | Dùng dữ liệu test: sau IN, Security xác nhận một passage IN riêng biệt thực sự, chọn This is a separate physical passage, not a repeated scan và ghi lý do ≥5 ký tự.    | Có audit/ngoại lệ bằng chứng trùng; không cộng thêm khoảng làm việc giả, không đổi IN thành OUT.                                                                                                       |
| 03-19 | REP-A mở dòng IN trùng từ 03-18; Review note → Ignore duplicate IN. Thử Worker làm thao tác tương tự nếu dùng API kiểm tra quyền.                                       | Dòng trùng IGNORED, raw events giữ nguyên, không thêm giờ; Worker bị từ chối. Nếu còn thiếu IN/OUT thì chưa chốt ngày.                                                                                 |
| 03-20 | Worker xin OT 17:00–18:00 cho S1; đại diện Approve trước 17:00. Worker hiện diện 08:00–18:00.                                                                           | 480 phút thường +60 phút OT =540 phút tổng. Approve không bắt ghi chú; OT không tự cấp quyền vào cổng.                                                                                                 |
| 03-21 | OT 17:00–18:00 đã duyệt trước; Worker chỉ hiện diện OT 17:20–17:50, hoặc kết thúc 18:20.                                                                                | Trường hợp 17:20–17:50 chỉ 30 phút OT; ở tới 18:20 cũng không vượt khoảng OT đã duyệt. Không cộng mặc định toàn giờ xin.                                                                               |
| 03-22 | Xin OT rồi chờ qua giờ bắt đầu mới Approve; thử khoảng OT chồng ca chính/giờ kết thúc trước bắt đầu.                                                                    | Duyệt muộn và khoảng sai bị chặn; không cộng giờ ngoài ca đó. Tách từng input để xác định lỗi.                                                                                                         |
| 03-23 | Worker gửi Leave cả ca; đại diện duyệt trước bài test.                                                                                                                  | Ngày có bản tổng hợp cho nghỉ đã duyệt tính 0 phút; không cộng giờ nghỉ hoặc coi khoảng nghỉ được duyệt là rời ca không phép. Không kết luận trạng thái cổng từ việc nghỉ.                             |
| 03-24 | S1: Leave 14:00–15:00 đã duyệt, hiện diện 08:00–17:00.                                                                                                                  | 420 phút thường; chỉ loại khoảng nghỉ đã duyệt và nghỉ trưa.                                                                                                                                           |
| 03-25 | S1: Leave 12:00–13:00 đã duyệt, hiện diện 08:00–17:00.                                                                                                                  | 480 phút, không trừ cùng khoảng nghỉ hai lần.                                                                                                                                                          |
| 03-26 | Worker gửi OT/Leave; kiểm tra Request submitted., refresh trang/đợi polling; REP-A mở Time Requests.                                                                    | Worker có Pending approval, không nhận thông báo nhiệm vụ duyệt đơn của chính mình; đại diện đúng scope nhận đơn. Approve gửi kết quả cho Worker.                                                      |
| 03-27 | Đơn OT/Leave khác: REP-A Reject, thử reason rỗng, Cancel rejection, rồi nhập lý do và Confirm rejection.                                                                | Rỗng không gửi; Cancel giữ pending; từ chối hợp lệ giữ giờ theo dữ liệu trước và Worker thấy Rejected/lý do.                                                                                           |
| 03-28 | Worker có phiên thiếu OUT/giờ sai: mở đúng ngày → Request correction, nhập thời gian thực tế và lý do; gửi. Thử gửi correction cho phiên/ngày khác khi đơn còn pending. | Chỉ một correction pending/Worker/Site, kể cả ngoài bộ lọc ngày. UI báo chờ duyệt; Backend không tạo đơn thứ hai.                                                                                      |
| 03-29 | REP-A mở correction từ 03-28, kiểm tra recorded/proposed intervals và lý do Worker; Approve correction không ghi note.                                                  | Tính lại công/bảng công, giữ sự kiện gốc và lịch sử; Worker được gửi đơn mới sau quyết định.                                                                                                           |
| 03-30 | Correction mới: chọn Reject correction, thử lý do rỗng rồi nhập lý do hợp lệ.                                                                                           | Từ chối cần lý do; giờ cũ giữ nguyên, Worker thấy lý do và có thể gửi lại sau review.                                                                                                                  |
| 03-31 | Ngày đã confirmed: đề nghị chỉnh OUT về sớm hơn với lý do test, đại diện duyệt; refresh Worker và REP.                                                                  | Tổng ngày và tổng bảng công cùng giảm đúng; raw OUT ban đầu không bị sửa. Không giữ số liệu cache cũ sau duyệt.                                                                                        |
| 03-32 | Thử correction kết thúc trước bắt đầu hoặc chồng lên phiên hợp lệ khác.                                                                                                 | Không tạo khoảng dương sai/chồng; thông báo lỗi rõ và không thay tổng công. Dòng IGNORED không được sửa để thành khoảng tính giờ.                                                                      |
| 03-33 | SN: IN 22:00 ngày D, OUT 06:00 D+1.                                                                                                                                     | 450 phút, nghỉ qua đêm ghép đúng ngày; workDate là D, không tách thành hai ngày công.                                                                                                                  |
| 03-34 | Sau swap ở 07-25, mở MF03 chi tiết, thử chốt.                                                                                                                           | Có đối chiếu snapshot gốc/lịch hiện tại, SCHEDULE_CHANGED chặn chốt; không tự thay giờ ca gốc/raw evidence. Không có bước UAT giả định quyền thay snapshot đã được duyệt.                              |
| 03-35 | Worker xem My Work Hours: hôm nay, giờ tháng, OT tháng, Days Needing Attention; đổi filter lịch sử và Next page.                                                        | Summary tháng độc lập trang/filter lịch sử, giữ phút; OT là một phần tổng đã chốt, không cộng lại lần hai. Chưa có hôm nay không lấy khoảng hôm qua làm hôm nay.                                       |
| 03-36 | Mở ngày lịch sử có phiên chưa OUT hoặc duplicate IGNORED.                                                                                                               | Open session không khẳng định đang trong công trường; marker reconciliation không hiện như raw OUT; lịch sử đúng ngày đang mở.                                                                         |
| 03-37 | Có >20 yêu cầu/ngày công: lọc kind/status/date/Worker, Next/Previous rồi mở chi tiết và đơn cũ.                                                                         | Đúng total/phạm vi; không mất đơn sau trang đầu; lọc không làm form correction dùng nhầm phiên ngày khác.                                                                                              |

### Công thức đối chiếu giờ

```text
Giờ thường = hợp các khoảng IN–OUT giao với ca
             trừ phần giao với hợp (nghỉ giữa ca + Leave đã duyệt).
OT         = hiện diện thực tế trong khoảng OT đã duyệt, ngoài ca chính.
Tổng chốt  = giờ thường + OT, chỉ cộng vào bảng công khi ngày đã confirmed.
```

Ví dụ S1 hiện diện đủ 08:00–17:00: 9 giờ −1 giờ nghỉ =8 giờ. Leave 12:00–13:00 chồng nghỉ không tạo phép trừ thứ hai. Mỗi tổng được tính từ thời lượng thực tế, không làm tròn từng session riêng rồi cộng.

## 5. Quyền, lỗi mạng, retry và cạnh tranh — áp dụng cả hai luồng

Các bài yêu cầu kiểm tra Backend có thể dùng DevTools → Network với tài khoản test, API docs development hoặc công cụ HTTP nội bộ. Ghi status/error code; không chia sẻ token. Chỉ ẩn nút trên UI chưa đủ chứng minh authorization. Không sửa DB để vượt guard.

| ID   | Thao tác                                                                                                                                  | Kết quả phải thấy                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| X-01 | W1 thử mở ngày công/lịch/đơn W2 qua URL/ID/API nếu có; REP-B thử dữ liệu Contractor A.                                                    | Backend từ chối hoặc không trả dữ liệu ngoài scope; không lộ tên, giờ công, đơn hoặc danh sách ứng viên trái quyền.                                 |
| X-02 | Worker/Security thử duyệt OT, Leave, correction, swap; SM-A thử thay REP-A duyệt; Admin thử phân ca Worker.                               | Chặn vai trò không sở hữu command; quyền Admin không tự thay rule phân ca Worker của đại diện.                                                      |
| X-03 | SM-B thử archive/tạo ca Site A; REP-A thử Worker/Team/Contractor ID của Site B.                                                           | Chặn scope sai, không ghi dữ liệu một phần.                                                                                                         |
| X-04 | Một đại diện có liên kết Worker thử tự duyệt yêu cầu attendance của chính mình, nếu có cấu hình tài khoản này.                            | Chặn self-review; nếu không có tài khoản phù hợp ghi BLOCKED.                                                                                       |
| X-05 | Tab đã mở form; quản trị test thu hồi grant/participation hoặc disable account trước submit/approve.                                      | Backend recheck quyền hiện hành; không lưu/duyệt dựa trên màn hình cũ. Khôi phục quyền sau bài test nếu còn dùng tài khoản.                         |
| X-06 | W không có quyền G1 hoặc face profile/account không còn active; thử Face/QR, kể cả có OT đã duyệt.                                        | Không cho phép IN dựa trên OT/QR; dữ liệu identity/quyền chưa xác minh không trở thành allowed.                                                     |
| X-07 | Tab DevTools offline rồi refresh vùng lịch/công/đội; trở lại online và Retry.                                                             | Loading/error/retry rõ; summary unavailable thay vì 0; không chọn ứng viên/approve theo permission/team chưa tải được.                              |
| X-08 | Hai profile/tab REP-A cùng mở một đơn/version; tab 1 approve, tab 2 quyết định khác.                                                      | Chỉ một quyết định hợp lệ; tab cũ nhận conflict hoặc kết quả đã xử lý, không ghi đè/kích hoạt tác dụng hai lần.                                     |
| X-09 | Gửi lại **cùng request ID và payload** của create batch/correction; nhấn confirm passage lặp. Dùng replay Network trên test data nếu cần. | Một batch/đơn/tác dụng nghiệp vụ; retry không cộng giờ/gửi outcome trùng. Gửi command mới với ID mới là bài khác, không được coi là retry.          |
| X-10 | Mở notification swap/attendance → kiểm tra đích → mark read/read all → Delete read notifications và xác nhận.                             | Mở đúng Site/ngày/request; đọc/xóa thông báo không duyệt nghiệp vụ. Chỉ thông báo đã đọc của mình biến mất, unread và dữ liệu lịch/công còn nguyên. |
| X-11 | Width 360–390px, desktop; thao tác bằng Tab/Enter/Escape khi phù hợp.                                                                     | Nút/input dùng được, focus rõ, không mất nội dung quyết định/giờ; lỗi và trạng thái đọc được, không bị modal che nút xác nhận.                      |
| X-12 | Tắt cấp camera hoặc Face/AI unavailable; dùng fallback QR theo quy trình; QR hết hạn/sai session/sai cổng hoặc dùng lại sau confirm.      | Có trạng thái unavailable và luồng fallback thực; token sai/hết hạn/đã dùng không tạo passage/công. Không nhận diện giả hoặc tự grant quyền.        |

## 6. Bài nối MF07 → MF03 bắt buộc

1. REP-A phân ca theo đội cho ngày D tương lai bằng preview/batch.
2. W1 mở lịch cá nhân đúng D; kiểm tra ca và giờ nghỉ.
3. Đến D, Security xác nhận IN/OUT bằng Face hoặc QR; MF03 dùng ca đã phân và nghỉ đúng cấu hình.
4. W1 xin OT/Leave ở ngày test riêng; REP-A duyệt từ đúng scope, Worker nhận outcome; giờ chốt phản ánh hiện diện/nghỉ thực tế.
5. Ngày khác, thực hiện swap hợp lệ **trước IN**; khi vào ca mới, MF03 ghép ca mới đúng.
6. Ngày khác, thực hiện swap hợp lệ **sau IN** theo 07-25; MF03 giữ snapshot cũ, có SCHEDULE_CHANGED, không tự tính/chốt theo ca mới.
7. Archive template có lịch/công lịch sử; lịch cũ và tổng tháng không đổi chỉ vì archive, không dùng template đó cho lịch mới.

Đánh dấu từng bước riêng; swap PASS nhưng attendance sau swap sai vẫn làm bài nối FAIL.

## 7. Thứ tự chạy và tiêu chí nghiệm thu

1. **Buổi 1:** chuẩn bị tài khoản/scope → bài A → 07-01 đến 07-22 và 07-26 đến 07-28 → quyền cơ bản.
2. **Buổi 2:** bài B bằng Face và QR → các case MF03 tính giờ, xin/duyệt, sửa công → lỗi mạng/thông báo/keyboard.
3. **Có thời gian chờ:** thiếu OUT cuối ca +5 phút, deadline change/swap, ca qua đêm, ngày D/D+1. Không bỏ những bài này rồi ghi đã nghiệm thu đầy đủ.
4. **Cuối cùng:** bài nối hai luồng, các case cạnh tranh/retry/quyền thu hồi và review kết quả bởi thành viên khác.

Đủ nghiệm thu khi mọi case áp dụng PASS, các BLOCKED có kế hoạch chạy bù, không có lỗi cộng công trùng/mất raw evidence/lộ scope/đổi một phần lịch, và có review con người. API-only PASS không thay thiết bị/trình duyệt PASS. Nếu chưa có quyết định xử lý snapshot theo ca mới, ghi rõ giới hạn hiện hành thay vì kỳ vọng tự chốt SCHEDULE_CHANGED.

Sau test: xử lý các yêu cầu pending, hủy lịch test tương lai khi điều kiện bảo vệ cho phép, archive đội test rỗng/ca test theo quyền. Giữ lịch sử attendance/audit; không xóa trực tiếp dữ liệu hoặc rollback migration để dọn thử nghiệm.

## 8. Tài liệu đối chiếu

- [MF03: quy tắc, form, xử lý ngoại lệ](../operations/mf03-attendance.md)
- [Đội và swap: scope, membership, điều kiện](../operations/contractor-teams.md)
- [Phân ca theo batch: preview, lặp, sửa/hủy](../operations/team-schedule-assignments.md)
- [Deadline hiện hành: khóa khi kết thúc ca](../operations/mf07-shift-deadline.md)
- [Archive ca và giữ lịch sử](../operations/shift-archival.md)
- [Báo cáo kiểm tra ngày 11/10](final-request-audit-2026-10-11.md)

Tài liệu notification MF07 có mô tả lịch sử policy theo ngày; deadline trong checklist này theo source/hướng dẫn hiện hành: **khóa tại giờ kết thúc ca**, không mặc định cho phép cả ngày sau khi ca đã hết.
