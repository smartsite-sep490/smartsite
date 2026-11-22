# Đại diện nhà thầu trên mobile: sửa lỗi và đối chiếu chức năng

Ngày đối chiếu: 15/11/2026. Phạm vi: tài khoản `contractor.mf01`, các màn hình mobile của đại diện nhà thầu, luồng web tương ứng và API đã có. Không đối chiếu đăng ký khuôn mặt. Bảng chức năng bên dưới là đối chiếu mã nguồn; chỉ những thao tác được ghi riêng ở phần kiểm chứng mới đã chạy với tài khoản thật.

## Các thay đổi đã làm

- Chọn ngày/giờ bằng các cột kéo trực tiếp trong modal. iOS dùng spinner trên nền trắng, ép giao diện sáng và màu chữ đậm; Android dùng các cột kéo JavaScript. Có dòng **Đang chọn** hiển thị bản nháp trước khi bấm **Xong**; **Hủy** giữ giá trị trước đó. Áp dụng cho phân lịch, đề nghị phân công, cấp quyền, ngày hết hạn khu vực nhóm và các biểu mẫu dùng chung trường ngày/giờ.
- Khóa phần gửi ở chân modal khi còn bản nháp ngày/giờ chưa xác nhận. Không cần cài thêm native module hoặc mở một modal chọn ngày chồng lên biểu mẫu.
- Ngày lịch gửi dạng `YYYY-MM-DD`, độc lập múi giờ thiết bị; thời điểm gửi theo ISO UTC. Chuyển từ ngày 31 sang tháng ngắn hơn tự điều chỉnh về ngày hợp lệ.
- Màn hình khu vực giải thích ai gửi đề nghị, ai duyệt và ai cấp quyền. Khi nhà thầu chưa được cấp khu vực hoặc chưa có phân công đã duyệt, màn hình nêu điều kiện còn thiếu và không mở biểu mẫu cấp quyền trống.
- Nút **Gửi đề nghị phân công** chỉ xuất hiện trong tab **Phân công**. Tab Quyền nhà thầu dùng để xem quyền được giao; tab Quyền công nhân có thao tác cấp quyền công nhân riêng.
- Biểu mẫu phân công có sẵn thời gian hiện tại đến 8 giờ sau, hiển thị các khoảng tham gia công trường và báo rõ khi thời gian không nằm trong phạm vi cho phép. Đề nghị phân công vẫn gửi được trước khi nhà thầu được cấp khu vực.
- Lọc quyền khu vực theo đợt tham gia của phân công được chọn; đổi phân công sẽ xóa lựa chọn quyền cũ. Báo riêng phân công đã hết thời hạn.
- Sửa API tạo đề nghị phân công: chọn một đợt tham gia còn phù hợp, chứa **toàn bộ** khoảng đề nghị, thay cho lấy bản ghi `isActive=true` đầu tiên. Giữ kiểm tra vai trò, nhà thầu, công trường, công nhân và khu vực.

## Dữ liệu thực tế của tài khoản

Tài khoản có hai phạm vi trong `Demo Construction Site`. Cần chọn đúng nhà thầu khi đăng nhập/chuyển phạm vi.

| Phạm vi             | Công nhân | Quyền khu vực nhà thầu | Phân công vào khu vực                              |
| ------------------- | --------: | ---------------------: | -------------------------------------------------- |
| Nhà thầu Test MF01  |         2 |                      0 | Một đề nghị mẫu PENDING tạo lúc 15:16 ngày 15/11   |
| Demo Contractor Co. |         2 |                      0 | Có một phân công APPROVED, hết hạn ngày 08/10/2026 |

Công trường có khu vực `Gate 1 Test Area`, nhưng có khu vực trong danh mục không đồng nghĩa nhà thầu đã được cấp quyền sử dụng khu vực đó.

Test MF01 có một đợt tham gia cũ đã hết hạn ngày 09/11/2026 và đợt mới từ 14/11/2026 đến 14/11/2027. Cả hai bản ghi đều mang `isActive=true`. API cũ kiểm tra được có đợt phù hợp nhưng sau đó lại lấy bản ghi đầu tiên, nên có thể từ chối đề nghị theo thời hạn của đợt cũ. Bản sửa chọn đợt bao trọn khoảng đề nghị; không ghép các đợt rời nhau để nới quyền.

Trong khoảng 01–28/11/2026 đã truy vấn, cả hai nhà thầu chưa có lịch công nhân, ngày công hoặc yêu cầu đổi ca được trả về. Trạng thái rỗng ở các phần này phù hợp với dữ liệu hiện tại.

Đã tạo qua API của chính tài khoản một nhóm trống **`[MẪU] Kiểm thử mobile`** trong **Nhà thầu Test MF01**. Nhóm dùng để xem giao diện và có thể đổi tên/lưu trữ sau khi thử. Chưa tạo lịch giả, chấm công giả hoặc tự cấp quyền vào khu vực.

Theo yêu cầu xem mẫu phân công, đã gửi thêm một đề nghị cho một công nhân đang hoạt động của Test MF01 vào `Gate 1 Test Area`, từ 15:16 đến 23:16 ngày 15/11/2026 (giờ Việt Nam). API tạo thành công và API đọc trả lại đúng bản ghi với trạng thái `PENDING`. Đề nghị nằm trong tab **Phân công**, chưa phải quyền khu vực đã cấp và vẫn cần Quản lý công trường duyệt.

## Cách hiểu quyền và khu vực

1. Đại diện gửi **đề nghị phân công**: chọn công nhân, khu vực cần vào, bắt đầu và kết thúc.
2. Quản lý công trường xét duyệt phân công và cấp quyền khu vực cho nhà thầu.
3. Đại diện cấp quyền cho công nhân từ phân công đã duyệt, trong khu vực nhà thầu được giao. Khoảng cấp quyền phải nằm trong cả phân công, quyền khu vực và đợt tham gia công trường.

Tài khoản này chưa có dữ liệu ở bước cấp quyền khu vực cho nhà thầu, nên chưa thể hoàn thành bước 3. Việc duyệt/thu hồi phân công và cấp quyền khu vực nhà thầu thuộc Quản lý công trường; không tính là thiếu chức năng của đại diện trên mobile.

## Chức năng đã có trong mã mobile

| Nhóm                        | Chức năng                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Tổng quan                   | Thống kê nhà thầu, đường dẫn Nhân sự/Lịch làm/Yêu cầu/Nhóm/Khu vực/Công việc được giao; đã bỏ đường dẫn Công và giờ làm của đội bị trùng |
| Nhân sự                     | Danh sách theo nhà thầu, thêm/sửa công nhân, tạm ngưng, hồ sơ giấy tờ, chụp/chọn ảnh và hỗ trợ OCR                                       |
| Nhóm                        | Tạo/sửa/lưu trữ; chuyển công nhân giữa nhóm; cấp/sửa/thu hồi khu vực nhóm trong quyền nhà thầu                                           |
| Lịch làm                    | Xem theo ngày/tuần, lọc khoảng ngày và công nhân, xem trước và tạo phân lịch ngày/tuần/lặp lại                                           |
| Công và giờ làm             | Tổng hợp, ngày công, chi tiết phiên và lịch sử điều chỉnh; lọc ngày/công nhân trong tab Lịch làm                                         |
| Yêu cầu                     | Đổi ca/đổi ca với người khác; duyệt/từ chối theo phạm vi; xem và xét nghỉ/tăng ca; ghi nhận nghỉ thay công nhân                          |
| Quyền vào khu vực           | Gửi đề nghị phân công, xem trạng thái, xem quyền nhà thầu, cấp/thu hồi quyền công nhân khi đủ điều kiện                                  |
| Công việc an toàn được giao | Phiếu kiểm tra, kết quả/minh chứng và nhiệm vụ khắc phục sự cố được giao                                                                 |
| Tài khoản                   | Thông báo, hồ sơ, đổi mật khẩu, chuyển phạm vi công trường/nhà thầu                                                                      |

## Phần còn thiếu so với web/API

Đây là các khoảng trống xác nhận được trong luồng đại diện, cần làm tiếp nếu muốn đầy đủ như web. Không thay đổi các quyền nghiệp vụ để lấp khoảng trống UI.

| Ưu tiên | Phần còn thiếu                                                                              | Web/API đã có                                                                                                | Mobile hiện tại                                                                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cao     | Danh sách đợt phân lịch, đổi ca/hủy lịch theo ngày, từ một ngày hoặc phần lịch chưa bắt đầu | `ScheduleAssignmentForm` có `BatchEditor`; client có `listScheduleAssignments` và `changeScheduleAssignment` | Chỉ có xem lịch, xem trước và tạo đợt mới; chưa có màn hình quản lý/chỉnh đợt đã tạo                                                                                           |
| Cao     | Hàng đợi duyệt/từ chối yêu cầu điều chỉnh chấm công                                         | `AttendanceView` gọi `reviewAttendanceCorrection`; backend cho phép đại diện đúng phạm vi xét duyệt          | Chi tiết ngày mới hiển thị lịch sử điều chỉnh; chưa có thao tác xét duyệt hoặc hàng đợi dành cho đại diện                                                                      |
| Vừa     | Đường vào báo cáo chi tiết và xuất CSV trong giao diện đại diện mới                         | Web cho đại diện xuất báo cáo; API `attendanceWorkers`/`attendanceExport` đã có                              | `AttendanceReport` đã có mã xuất/chia sẻ CSV, nhưng nằm trong màn hình Attendance cũ. Tab Lịch làm mới và Tổng quan của đại diện chưa có đường truy cập trực tiếp tới phần này |

Nguồn đối chiếu:

- [Điều hướng theo vai trò trên web](../../apps/web/src/features/auth/workspace-access.ts)
- [Quản lý đợt phân lịch trên web](../../apps/web/src/components/workforce/components/ScheduleAssignmentForm.tsx)
- [Chấm công và xét điều chỉnh trên web](../../apps/web/src/components/access/attendance/AttendanceView.tsx)
- [Phân công và quyền khu vực trên web](../../apps/web/src/components/access/permissions/SiteAccessSetupView.tsx)
- [Lịch làm của đại diện trên mobile](../../apps/mobile/src/features/contractor/contractor-schedule.tsx)
- [Báo cáo mobile hiện có](../../apps/mobile/src/features/attendance/attendance-report.tsx)
- [API client dùng chung](../../packages/api-client/src/management.ts)

## Tự kiểm tra trên điện thoại

Bản sửa nút theo từng tab và spinner iOS đang được phục vụ qua `exp://192.168.1.226:8082`. Mở phiên Expo này bằng QR mới; tab Quyền nhà thầu không có nút gửi đề nghị, còn bộ chọn có dòng **Đang chọn** là hai dấu hiệu nhận đúng bản sửa.

Sau khi khởi động lại máy, chạy lại backend bằng bản mã đã sửa và khởi động Metro theo cách vẫn dùng của dự án. Bản sửa API chọn đợt tham gia cần backend được khởi động lại/rebuild nếu đang chạy bản build cũ.

Với bản backend có phân loại nghỉ dự kiến/khẩn cấp, kiểm tra điều kiện triển khai `LeaveNotice1795046400000` trong [hướng dẫn nghỉ/tăng ca](worker-leave.md#deployment-and-verification) trước khi chạy. Không chạy tất cả migration đang chờ vào database đang dùng khi chưa rà soát thứ tự và tác động.

1. Đăng nhập `contractor.mf01`, chọn **Nhà thầu Test MF01** trong Demo Construction Site. Mở **Nhóm công nhân**, tìm `[MẪU] Kiểm thử mobile`.
2. Mở **Khu vực và quyền vào ra**. Khi chưa có quyền nhà thầu, phải thấy hướng dẫn nhờ Quản lý công trường cấp quyền, không còn biểu mẫu cấp quyền với lựa chọn trống.
3. Bấm **Gửi đề nghị phân công**, chọn công nhân và Gate 1 Test Area. Kéo ngày/giờ, bấm Xong từng bộ chọn rồi gửi. Chọn khoảng nằm trong đợt 14/11/2026–14/11/2027. Kết quả cần là đề nghị chờ duyệt; không tự có quyền vào.
4. Thử Hủy sau khi kéo: giá trị cũ phải giữ nguyên. Khi bộ chọn đang mở, nút gửi ở chân modal chưa được thao tác.
5. Mở **Lịch làm → Phân lịch**, thử chọn một ngày, theo tuần và lặp lại. Bộ chọn ngày phải kéo được; chỉnh ngày phải làm mất bản xem trước cũ. Chỉ xác nhận tạo lịch khi nội dung xem trước đúng ý.
6. Mở bộ lọc công/ngày; thử ngày không có dữ liệu, chuyển tuần/tháng và chuyển nhà thầu. Không được lẫn công nhân/nhóm/quyền của nhà thầu khác.
7. Mở các yêu cầu nghỉ/tăng ca/đổi ca khi có dữ liệu; kiểm tra chi tiết và lý do. Luồng API có dữ liệu rỗng vẫn phải hiện trạng thái rõ ràng.

## Kiểm chứng và giới hạn

- Sau phản hồi picker vẫn trống: 16 test tập trung/2 file đã qua, có kiểm tra spinner iOS ép theme sáng/màu chữ đậm, hiển thị bản nháp và chỉ gửi khi Xong; kiểm tra nút gửi chỉ nằm ở tab Phân công. Typecheck mobile và lint các tệp sửa đã qua. Cả bundle entry iOS thực tế và bundle picker trên cổng 8082 trả 200, chứa dòng bản nháp và cấu hình theme sáng. Chưa xác nhận trực quan trên iPhone của người dùng.

- Trước lần reset máy, đăng nhập thật thành công, 24 lượt GET nghiệp vụ đã trả 200; tạo nhóm mẫu qua POST thành công, sau đó đăng xuất phiên kiểm tra.
- Mobile: 132 test/29 file đã qua, bao gồm kéo ngày, tháng ngắn/năm nhuận, Hủy/Xong, thời gian ISO, chặn gửi bản nháp, scope và yêu cầu phân công/cấp quyền.
- Typecheck mobile và backend đã qua. Bộ test đơn vị dịch vụ nhà thầu: 7/7, có hồi quy đợt tham gia được gia hạn và khoảng thời gian không hợp lệ. Lint các tệp sửa đã qua.
- Cài đặt theo lockfile và kiểm tra peer đã qua. Expo dependency check báo các bản patch SDK hiện có chưa khớp khuyến nghị; chưa nâng dependency ngoài phạm vi sửa lỗi.
- Lần chạy kiểm tra toàn workspace bị gián đoạn khi máy reset; không coi là đã qua. Một số test backend khác cần ghi fixture ngoài workspace và bị sandbox chặn trong lần chạy trước.
- Đã thêm test PostgreSQL cho trường hợp gia hạn, nhưng chưa chạy được sau reset: database test trả `ECONNREFUSED`, Docker Desktop Linux Engine không hoạt động. Chưa coi kiểm tra tích hợp này là đã qua.
- Không mở app/emulator để kiểm tra giao diện theo yêu cầu người dùng. Các bước trên dành cho kiểm tra thực tế trên thiết bị.

## Trạng thái sau lần máy reset

Cập nhật sau lần crash thứ hai: minidump ghi lỗi 0x3B lúc 15:18:06. Phân tích trên máy cho thấy tiến trình Metro/Node đang gọi xử lý thông báo thay đổi thư mục qua NTFS khi kernel bị lỗi; mẫu đo trước đó 7 giây vẫn còn khoảng 2,8 GB RAM trống. Đây là bằng chứng về tác vụ liên quan, chưa xác định nguyên nhân gốc của lỗi kernel. Metro và backend đã được chạy lại tạm thời ở chế độ không watch; API readiness trả 200 và phân công mẫu vẫn đọc được sau reset. Trong chế độ này cần khởi động lại Metro sau các sửa đổi code rồi Reload trong Expo Go.

Thông tin ban đầu, trước khi có minidump của lần crash thứ hai:

Các tệp sửa và test hồi quy vẫn còn trên đĩa. Windows ghi sự kiện Kernel-Power 41 và EventLog 6008, xác nhận lần tắt máy đột ngột lúc khoảng 14:33 ngày 15/11/2026. Trong khoảng nhật ký đã xem chưa thấy sự kiện bugcheck 1001, cạn tài nguyên 2004 hoặc WHEA giải thích nguyên nhân; chưa thể kết luận nguyên nhân treo máy.

Sau khi khởi động lại, máy có khoảng 15,42 GB RAM sử dụng được, 8,31 GB RAM trống tại thời điểm đọc; ổ C còn khoảng 7,3 GB trống và ổ D còn 50,9 GB. Các kiểm tra cuối được chạy tuần tự với giới hạn heap Node, không mở emulator hoặc app.
