# SmartSite — Rà soát chức năng, luồng nghiệp vụ và quyền actor trên main

| Thông tin          | Giá trị                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| Ngày rà soát       | 14/10/2026                                                                                              |
| Repository         | `smartsite-sep490/smartsite`                                                                            |
| Mốc code đối chiếu | `origin/main` — `4c7300ac73e43ef84aaf0e051400a9d83e4bd167`                                              |
| Tài liệu yêu cầu   | “Danh mục chức năng đề xuất”, phiên bản 0.1 ngày 17/09/2026, do người dùng cung cấp                     |
| Phương pháp        | Đọc controller, service, policy, entity và UI; đối chiếu actor, phạm vi và chuyển trạng thái            |
| Giới hạn xác minh  | Rà soát tĩnh; không chạy lại kiểm thử nghiệp vụ, camera hoặc đo các chỉ tiêu NFR trong lượt rà soát này |
| Thay đổi thực hiện | Chỉ lập tài liệu này; không sửa code nghiệp vụ                                                          |

## 1. Kết luận chung

**Chưa thể kết luận các luồng và quyền đã chuẩn hết theo bản dự thảo.** Có chức năng đã triển khai đáng kể, có chức năng đang giao actor khác với tài liệu, và có màn hình mới chỉ là giới thiệu.

“Thiếu” hoặc “lệch” trong báo cáo là chênh lệch so với bản dự thảo được cung cấp, không mặc nhiên là một quyết định phạm vi đã được phê duyệt. Nếu nhóm giữ quy trình rút gọn đã lựa chọn trước đây, cần cập nhật tài liệu và ghi nhận quyết định tương ứng.

Không quy đổi số màn hình/API thành số FR hoặc số Use Case đã hoàn thành. Một endpoint, entity hay enum trạng thái tồn tại chưa chứng minh toàn bộ quy trình nghiệp vụ tương ứng đã hoàn tất.

| Vấn đề quan trọng           | Hiện trạng trên main                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| Người duyệt công/tăng ca    | Contractor Representative đang duyệt; tài liệu yêu cầu Site Manager.                             |
| Người duyệt đổi/hoán đổi ca | Contractor Representative đang duyệt; tài liệu yêu cầu Site Manager.                             |
| Chứng chỉ trong MF01        | Chưa có hồ sơ chứng chỉ, quy trình kiểm tra và đánh giá hết hạn theo yêu cầu.                    |
| Quyền Administrator         | Một số API cho Admin thay thế role nghiệp vụ, gồm duyệt phân công và xác minh Alert; lệch BR-01. |
| Luồng khách                 | Đăng ký công khai, chưa gắn Host với tài khoản đăng nhập; chưa bảo đảm Host không tự duyệt.      |
| Khóa tài khoản và quyền vào | Có khoảng trống kiểm tra trạng thái tài khoản trong đường Face/manual và bước xác nhận qua cổng. |
| MF09 và MF10                | Mới có trang giới thiệu; chưa có backend nghiệp vụ tương ứng.                                    |
| Mobile                      | Hiện chỉ có màn hình kiểm tra kết nối backend; chưa có các luồng Worker trên ứng dụng mobile.    |

## 2. Nền tảng — Tài khoản, tổ chức, Site và cấu hình

| Actor / yêu cầu           | Đã có                                                                                    | Thiếu hoặc chưa khớp                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Administrator — FR-01..04 | Tạo/xem tài khoản; thay role theo Site; khóa/mở; thu hồi phiên khi thay quyền hoặc khóa. | Admin hiện là global Admin, chưa có phạm vi quản trị được ủy quyền. Chưa thấy lịch sử role có thời điểm hiệu lực như tài liệu yêu cầu.                                           |
| Administrator — FR-05     | Đặt lại mật khẩu và thu hồi phiên.                                                       | Admin đặt trực tiếp mật khẩu thay thế; chưa có liên kết/mã một lần có hạn để người dùng tự đặt.                                                                                  |
| Administrator — FR-06..09 | Có danh mục nhà thầu và tra cứu quan hệ tham gia Site.                                   | Luồng tạo nhà thầu đang hoạt động chủ yếu thuộc Site Manager. Chưa có đầy đủ cập nhật, tạm ngưng/kích hoạt tổ chức và lịch sử theo FR-08/09.                                     |
| Administrator — FR-10..13 | Tạo/xem/đổi tên Site, cấp role Site Manager.                                             | Site mới có thông tin cơ bản; thiếu vị trí, thời gian, trạng thái và lịch sử hiệu lực. Database giới hạn một Site Manager/Site, chưa hỗ trợ người quản lý thứ hai duyệt độc lập. |
| Site Manager — FR-14..16  | Tạo Zone, đổi tên, cấu hình chính sách và PPE yêu cầu.                                   | Chưa có đủ vòng đời ngưng/xóa/lưu trữ Zone.                                                                                                                                      |
| Site Manager — FR-18      | Có API quản lý camera và Region.                                                         | Các API này đang yêu cầu Admin, chưa giao đúng cho Site Manager theo tài liệu.                                                                                                   |
| Site Manager — FR-19      | Tạo/gắn nhà thầu vào Site.                                                               | Chưa thấy đủ thao tác gia hạn, tạm ngưng, kết thúc Participation có hiệu lực và lịch sử.                                                                                         |
| Mọi tài khoản — ADD-01    | Đăng nhập, đăng xuất, refresh phiên, xem thông tin tài khoản và đổi mật khẩu.            | Chưa có quên mật khẩu hoàn chỉnh. Trang đăng ký Web hiện mô phỏng thành công, không tạo tài khoản thật.                                                                          |

### 2.1. Lưu ý phân quyền

- Global Admin chưa tương đương quản trị viên có scope được ủy quyền như FR-01..04 và BR-01/03.
- Một Site chỉ có một Site Manager trong ràng buộc database. Điều này chưa đáp ứng phương án Manager thứ hai duyệt khi Manager đầu tiên là người gửi theo FR-13 và BR-13.
- Có cả API cũ và API theo Site; không nên chỉ dựa vào tên endpoint để kết luận chức năng dùng được bởi actor dự kiến.
- Quyền tạo nhà thầu, cấp đại diện và cấu hình camera cần thống nhất lại giữa tài liệu và code hiện tại.

### 2.2. Căn cứ code

- [Quản lý tài khoản và role](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/users/users.service.ts).
- [API quản trị tài khoản](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/users/users.controller.ts).
- [Ràng buộc một Manager/Site](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/database/entities/user-role-assignment.entity.ts#L25).
- [Cấu hình Site](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/sites/site-configuration.service.ts).
- [Quyền quản lý camera](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/cameras/cameras.controller.ts#L84).
- [Quản lý nhà thầu theo Site](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/directory/contractors.controller.ts).
- [Trang đăng ký mô phỏng](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/web/src/features/auth/RegisterScreen.tsx#L57).

## 3. MF01 — Hồ sơ và phân công

**Liên quan:** FR-20..24b, FR-39..46, FR-54..56, FR-76, FR-81; BR-02..07; phần lịch thực tế của ADD-11.

| Actor                     | Chức năng đang có                                                                                                                      | Đánh giá quyền / bước thiếu                                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contractor Representative | Tạo Worker kèm tài khoản; mã Worker tự sinh; xem danh sách; sửa hồ sơ cơ bản; tạm dừng/khôi phục; gửi phân công Site/Zone và thời hạn. | Có kiểm tra role, nhà thầu và Participation. Tuy nhiên helper dùng chung vẫn cho global Admin vượt kiểm tra đại diện. Hồ sơ còn thiếu nghề, năng lực và chứng chỉ.                   |
| Worker                    | Có cơ chế xác nhận đồng ý đăng ký mặt; có kiểm tra quyền đối với hồ sơ bản thân.                                                       | Phần phối hợp đăng ký mặt đã có nền tảng. Chưa đủ căn cứ chống một người có nhiều hồ sơ chỉ bằng mã/username.                                                                        |
| Safety Officer            | Có API đánh dấu phân công `SAFETY_REVIEWED`.                                                                                           | Chưa phải kiểm tra chứng chỉ: chưa có loại chứng chỉ, tệp, hiệu lực, kết quả đạt/từ chối/yêu cầu bổ sung.                                                                            |
| Site Manager              | Duyệt/từ chối và thu hồi phân công; lưu người xử lý, phiên bản, thời điểm và audit.                                                    | Có thể duyệt ngay từ `PENDING`, không bắt buộc Safety Review. Chưa bắt buộc lý do từ chối; chưa chặn tự duyệt khi tài khoản có nhiều role. Admin cũng được đi qua kiểm tra role này. |
| System                    | Kiểm tra thời hạn phân công và Participation trong nghiệp vụ vào cổng.                                                                 | Chưa kiểm tra chứng chỉ/năng lực; chưa có luồng điều chuyển Site hoàn chỉnh với hồ sơ xuyên Site và thời điểm hiệu lực.                                                              |

### 3.1. Chuỗi quyền Zone hiện có

Code có chuỗi Manager cấp Zone cho nhà thầu, sau đó đại diện cấp cho Worker/đội. Khoảng thời gian của quyền con phải nằm trong quyền cha và quan hệ tham gia Site. Cần mô tả rõ các bước này trong Use Case MF01 để phân biệt phân công công việc, quyền Zone và quyền cổng.

### 3.2. Nội dung cần bổ sung hoặc chốt lại

- Hồ sơ nghề/năng lực và chứng chỉ có phiên bản, tệp, ngày hiệu lực/hết hạn.
- Safety Officer kiểm tra chứng chỉ và ghi kết quả có căn cứ, lý do hoặc yêu cầu bổ sung.
- Điều kiện bắt buộc trước khi Manager duyệt; không tự coi `SAFETY_REVIEWED` là bằng chứng đã kiểm tra chứng chỉ.
- Lý do từ chối và kiểm tra không tự duyệt khi một tài khoản có nhiều role.
- Chuyển Site/Zone, tạm dừng/kết thúc có thời điểm hiệu lực và giữ lịch sử.
- Thông báo chuyển trạng thái và chính sách đọc lịch sử sau khi nhà thầu hết Participation.

**Đánh giá:** Đã có tạo/quản lý Worker, đăng ký mặt và phân công cơ bản; chưa đạt đầy đủ quy trình hồ sơ–chứng chỉ–duyệt trong dự thảo.

### 3.3. Căn cứ code

- [Tạo và quản lý Worker](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/directory/contractor-worker-accounts.service.ts).
- [Dữ liệu Worker hiện có](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/database/entities/worker.entity.ts).
- [Quyền và quy trình phân công](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/directory/contractor-operations.service.ts#L187).
- [Đăng ký mặt và đồng ý của Worker](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/identity/face-enrollment.service.ts#L84).
- [Cấp quyền Zone](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/access/site-access-setup.service.ts#L280).

## 4. MF02 — Vào ra công trường

**Liên quan:** FR-23, FR-67..70, FR-74/75, FR-82; BR-07..09, BR-16; ADD-18.

| Actor                                 | Chức năng đang có                                                                                                           | Đánh giá quyền / bước thiếu                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Security Officer                      | Xác minh Face, quét QR, xác minh thủ công có lý do, xác nhận qua cổng và ghi sự kiện.                                       | Xác minh thủ công yêu cầu đúng role Security. Tuy nhiên phạm vi bảo vệ đang theo Site, chưa có phân công bảo vệ theo từng cổng. |
| Worker                                | Trình mặt; tạo QR gắn bản thân cho phiên fallback.                                                                          | Đúng hướng, nhưng QR hiện phụ thuộc phiên fallback do người vận hành mở; chưa phải QR cá nhân có thể dùng độc lập mọi lúc.      |
| System                                | Tách kết quả xác minh khỏi lượt qua cổng; kiểm tra lại phân công, nhà thầu, Participation, quyền cổng và lịch khi xác nhận. | Chưa kiểm tra chứng chỉ. Kiểm tra trạng thái tài khoản chưa nhất quán giữa các phương thức.                                     |
| Admin / Site Manager / Safety Officer | Cũng được dùng nhiều thao tác vận hành cổng.                                                                                | Rộng hơn trách nhiệm actor trong tài liệu; cần ghi rõ nếu đây là quyền kiêm nhiệm được chấp nhận.                               |

### 4.1. Điểm cần ưu tiên kiểm thử hồi quy

Theo đường xử lý được đọc:

- Face có đọc trạng thái tài khoản nhưng không dùng kết quả đó để chặn quyết định vào.
- Manual và bước xác nhận qua cổng dùng evaluator chưa kiểm tra tài khoản Worker còn hoạt động và role còn hiệu lực.
- Vì vậy khóa tài khoản chưa bảo đảm chặn mọi đường vào như BR-07. Đây là nhận định từ code, chưa phải kết quả tái hiện runtime trong lượt rà soát này.

Chiều ra đã được xử lý theo hướng không chặn vì phân công hết hạn/thu hồi; có phương thức thủ công để đối chiếu. Cần làm rõ OUT khi không có lượt IN hợp lệ: evaluator cho phép ghi ra theo danh tính, chưa ràng buộc chặt điều kiện “đang hiện diện”.

### 4.2. Căn cứ code

- [Đánh giá điều kiện vào/ra](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/access/worker-access-evaluation.ts).
- [Xử lý Face](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/access/face-gate.service.ts#L251).
- [Manual và xác nhận qua cổng](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/access/qr-access.service.ts#L238).
- [Kiểm tra role và danh mục cổng](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/access/qr-access.service.ts#L68).

## 5. MF03 — Công và tăng ca

**Liên quan:** FR-17, FR-25..28, FR-53, FR-77..79; BR-10..12; ADD-11..13.

| Actor                     | Chức năng đang có                                                                              | Đánh giá quyền / bước thiếu                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Worker                    | Xem công cá nhân; gửi sửa công, tăng ca/nghỉ và theo dõi kết quả.                              | Có kiểm tra bản thân; phù hợp hướng FR-77..79 và ADD-13.                                                                           |
| Contractor Representative | Xem công nhà thầu; duyệt sửa công, tăng ca/nghỉ; xử lý trùng IN và xác nhận ngoại lệ giờ công. | Quyền duyệt rộng hơn tài liệu. FR-53 chỉ giao xem công đội; FR-26/28 giao Manager duyệt.                                           |
| Site Manager              | Xem dữ liệu công.                                                                              | Không được làm người duyệt trong helper `attendanceAccess(..., review=true)`. Thiếu quyền nghiệp vụ theo FR-26..28.                |
| System                    | Ghép sự kiện, tính khoảng hiện diện, trừ nghỉ, xử lý ca qua ngày, ngoại lệ và tăng ca.         | Có triển khai đáng kể. Nhưng ngày đủ điều kiện tự thành `CONFIRMED` và ghi timesheet `APPROVED`; chưa tương đương Manager chốt kỳ. |

### 5.1. Nội dung cần bổ sung hoặc chốt lại

- Chuyển hoặc xác nhận lại quyền duyệt sửa công/tăng ca giữa Manager và đại diện.
- Chốt bảng công theo kỳ/Site, khóa phiên bản đã chốt và điều chỉnh có phê duyệt riêng theo FR-27.
- Phân biệt kết quả đối soát tự động, xác nhận ngoại lệ và phê duyệt/chốt bảng công của người có thẩm quyền.
- Quy định quyền đọc công lịch sử khi Worker bị tạm dừng hoặc nhà thầu hết Participation. Helper hiện có thể chặn truy cập trong các trường hợp này.

Việc tồn tại entity `timesheet` chưa chứng minh FR-27 đã hoàn thành.

### 5.2. Căn cứ code

- [Quyền xem/duyệt công](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/attendance/attendance-access.ts).
- [Duyệt sửa công](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/attendance/attendance.service.ts#L459).
- [Duyệt tăng ca/nghỉ và xác nhận ngoại lệ](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/attendance/attendance-days.service.ts#L629).
- [Tự xác nhận và cập nhật timesheet](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/attendance/attendance-reconciliation.service.ts#L510).

## 6. MF04 — Khách đến công trường

**Liên quan:** FR-29..31, FR-47/48, FR-70..72; BR-13..15; ADD-16.

| Actor                                               | Chức năng đang có                                                                    | Đánh giá quyền / bước thiếu                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Host là Site Manager hoặc Contractor Representative | Có biểu mẫu tên người tiếp đón, Site/Zone và thời gian.                              | API đăng ký không yêu cầu đăng nhập; Host chỉ là tên nhập vào, chưa gắn `hostUserId`. Chưa đúng FR-29/47/48.            |
| Site Manager                                        | Backend cho duyệt/từ chối/hủy lượt thăm đúng Site; Admin đơn thuần không được duyệt. | Phần kiểm tra role này đúng. Nhưng chưa bảo đảm không tự duyệt do chưa có Host định danh.                               |
| Security Officer                                    | Quét QR, ghi vào/ra; checkout thủ công có lý do.                                     | Có kiểm tra Site/cổng, trạng thái, thời hạn và chống dùng lại.                                                          |
| Khách / System                                      | Khách không có tài khoản; tra cứu bằng khóa lượt thăm, lấy QR và xoay QR.            | Phù hợp nguyên tắc không tạo tài khoản khách. Thiết kế hiện yêu cầu cả nhóm vào/ra cùng nhau; cần ghi rõ giới hạn demo. |

### 6.1. Điểm nối UI chưa khớp

Tài khoản chỉ có role Site Manager vào `/access` bị chuyển sang `/site-setup`, trong khi màn hình duyệt khách nằm trong `/access`. Backend có quyền nhưng UI chưa cho actor tiếp cận bình thường qua đường này.

### 6.2. Nội dung cần bổ sung hoặc chốt lại

- Định danh Host bằng tài khoản và kiểm tra Site/Contractor scope.
- Chặn Host tự duyệt; hỗ trợ người duyệt độc lập đủ scope.
- Host xem/quản lý phiếu của mình và nhận QR hợp lệ.
- Sửa/gửi lại theo trạng thái; bắt buộc lý do từ chối.
- Làm rõ giới hạn cả đoàn cùng vào/ra và khả năng ghi ra khi QR lỗi/hết hạn.

### 6.3. Căn cứ code

- [Đăng ký công khai](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/access/qr-access.controller.ts#L18).
- [Đăng ký và duyệt khách](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/access/qr-access.service.ts#L602).
- [Điều hướng Site Manager](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/web/src/app.tsx#L87).
- [Dữ liệu và lệnh lượt thăm](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/access/qr-access.commands.ts).

## 7. MF05 — Giám sát trang bị bảo hộ

**Liên quan:** FR-18, FR-57/58, FR-83/85/86; BR-16/17; ADD-18.

| Actor          | Chức năng đang có                                                           | Đánh giá                                                                                                |
| -------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Site Manager   | Cấu hình PPE yêu cầu tại Zone: mũ, áo.                                      | Đúng hướng; cấu hình camera/Region vẫn đang thuộc Admin.                                                |
| AI / System    | Nhận detection, lưu nguồn/bằng chứng, kiểm tra ngữ cảnh và gộp thành Alert. | Đã có phía tích hợp backend. Chưa thể từ repo này kết luận chất lượng nhận diện thực tế của dịch vụ AI. |
| Safety Officer | Xem bằng chứng, xác nhận, bác bỏ hoặc yêu cầu thêm bằng chứng.              | Đúng actor; nhưng guard cũng cho Admin làm các thao tác review.                                         |

### 7.1. Giới hạn cần thể hiện rõ

- Màn hình PPE có nguồn realtime và nguồn video mẫu; phải phân biệt khi trình diễn và báo cáo kết quả.
- Trang Live Monitoring vẫn có danh sách sự kiện ghi cứng. Chưa nên coi toàn bộ giao diện giám sát là dữ liệu vận hành thật.
- FR-86 đếm người có timestamp và trạng thái nguồn chưa thấy thành một luồng nghiệp vụ hoàn chỉnh trong backend đã đọc.
- Chưa đánh giá model, độ chính xác, camera, ánh sáng hoặc độ trễ trong lượt rà soát này.

### 7.2. Căn cứ code

- [Ingestion AI](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/integrations/ai/ai-ingestion.service.ts).
- [Quyền review Alert](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/safety/alerts/safety-alert-access.guard.ts).
- [PPE realtime và nguồn mẫu](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/web/src/components/ppe/PpeMonitoringView.tsx).
- [Live Monitoring](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/web/src/components/live/LiveMonitoringView.tsx#L25).

## 8. MF06 — Giám sát khu vực hạn chế

**Liên quan:** FR-15/16/18, FR-57/58, FR-82/84/85; BR-07, BR-16/17; ADD-18.

| Actor                     | Chức năng đang có                                                                            | Đánh giá                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Site Manager              | Tạo Zone, chọn cấm tất cả hoặc yêu cầu quyền; cấp Zone cho nhà thầu.                         | Phù hợp phần chính.                                                                                       |
| Contractor Representative | Cấp Zone cho Worker/đội trong quyền nhà thầu được cấp.                                       | Có kiểm tra phạm vi và thời hạn cha/con.                                                                  |
| AI / System               | Phát hiện người vào vùng; chỉ đối chiếu quyền cá nhân khi có định danh được backend tin cậy. | Đúng nguyên tắc: unknown không được tự coi là người có quyền; vùng cấm tất cả không cần biết danh tính.   |
| Safety Officer            | Xác minh danh tính/bằng chứng và Alert.                                                      | Đúng hướng; một số API cấp quyền trực tiếp/lịch sử vẫn chỉ Admin truy cập, cần thống nhất actor vận hành. |

Đây là một trong các phần có kiểm tra quyền tương đối rõ. Tuy vậy chưa nối được điều kiện chứng chỉ/năng lực vì MF01 chưa có dữ liệu đó.

### 8.1. Căn cứ code

- [Đối chiếu quyền Zone](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/zones/zone-entry-authorization.service.ts).
- [Chính sách cấm, unknown và quyền cá nhân](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/zones/zone-authorization.service.ts).
- [API quyền trực tiếp/lịch sử Zone](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/zones/zone-access.controller.ts).

## 9. MF07 — Đổi ca và hoán đổi ca

**Liên quan:** FR-17, FR-24a, FR-76/79/80; ADD-02..04/11.

| Actor                     | Chức năng đang có                                                     | Đánh giá quyền / bước thiếu                                                            |
| ------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Worker A                  | Gửi đổi ca/hoán đổi theo lịch bản thân.                               | Có kiểm tra phạm vi. Đại diện cũng có thể gửi thay Worker; cần ghi vào đặc tả nếu giữ. |
| Worker B                  | Chấp nhận/từ chối đề nghị gửi đúng mình.                              | Phù hợp ADD-02.                                                                        |
| Site Manager              | Có quyền đọc yêu cầu theo Site.                                       | Chưa là người duyệt cuối.                                                              |
| Contractor Representative | Duyệt/từ chối đổi/hoán đổi, không tự duyệt yêu cầu mình gửi.          | Đúng theo code hiện tại, nhưng lệch FR-24a của tài liệu.                               |
| System                    | Khóa dữ liệu, kiểm tra lại lịch/đội, cập nhật nguyên tử và thông báo. | Đã có phần đáng kể của ADD-04.                                                         |

### 9.1. Nội dung cần bổ sung hoặc chốt lại

- Chưa thấy thao tác Worker hủy yêu cầu và xử lý quá hạn phản hồi/duyệt. Có enum `CANCELLED`/`EXPIRED` chưa đủ để coi đã triển khai.
- Điều kiện thời gian đang kiểm tra ca chưa kết thúc, chưa bảo đảm “ca tương lai và chưa check-in”.
- Chưa kiểm tra năng lực/chứng chỉ/Zone đích theo FR-80.
- Hoán đổi đang yêu cầu cùng đội đang hoạt động, chặt hơn điều kiện cùng Site/nhà thầu trong tài liệu.
- Tên trạng thái `PENDING_MANAGER` hiện không phản ánh đúng người duyệt là đại diện.
- Cần thống nhất lại quyền gán lịch thực tế: Manager cấu hình ca/cấp ca cho nhà thầu; đại diện đang gán lịch Worker/đội. ADD-11 hiện mô tả Site Manager/System.

### 9.2. Căn cứ code

- [Đổi ca và kiểm tra thời gian](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/scheduling/scheduling-workflow.service.ts#L308).
- [Người duyệt đổi ca](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/scheduling/scheduling-workflow.service.ts#L426).
- [Người duyệt hoán đổi](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/scheduling/scheduling-workflow.service.ts#L807).
- [Cấu hình ca và lịch](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/scheduling/schedule-configuration.service.ts).
- [Phân lịch Worker/đội](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/scheduling/schedule-assignment.service.ts).

## 10. MF08 — Cảnh báo và sự cố an toàn

**Liên quan:** FR-35/36, FR-51/52, FR-57..66, FR-73; BR-16..19; ADD-14/15/19.

| Actor                     | Chức năng đang có                                                                                   | Đánh giá quyền / bước thiếu                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Safety Officer            | Review Alert; tạo/liên kết Incident; xác định trách nhiệm; giao/giao lại; xét kết quả; đóng/mở lại. | Phần Incident có kiểm tra Site, phiên bản, người được giao và lịch sử khá rõ.                                               |
| Contractor Representative | Người được giao bắt đầu xử lý, nộp nội dung và bằng chứng; xem phần hồ sơ được phép.                | Phù hợp FR-52; có chặn người nộp tự xét kết quả.                                                                            |
| Site Manager              | Xem Incident; tạo Safety Task giao Safety Officer và kiểm tra kết quả task.                         | Đây là luồng bổ sung hiện có. Chưa nhận khắc phục Incident như FR-36/63; corrective action hiện giao cho đại diện nhà thầu. |
| Security Officer          | Chưa thấy luồng nộp báo cáo nguy cơ/sự cố.                                                          | Thiếu FR-73.                                                                                                                |
| Worker                    | Chưa có phản ánh nguy cơ trên mobile.                                                               | ADD-19 chưa triển khai; vẫn là phạm vi tùy chọn theo tài liệu.                                                              |

### 10.1. Nội dung cần bổ sung hoặc chốt lại

- Chưa có quy trình báo cáo thủ công riêng cho Manager/đại diện/bảo vệ chuyển Safety Officer xác minh theo FR-35/51/73.
- Chưa có đủ luồng khắc phục tại chỗ rồi đóng Alert mà không tạo Incident theo FR-60.
- Incident hiện cần xác nhận nhà thầu chịu trách nhiệm để giao việc/đóng; chưa bao phủ tốt sự cố chung giao Site Manager.
- Trạng thái code dùng `SUBMITTED → VERIFIED → CLOSED`, khác tên `Resolved → Closed` trong tài liệu; cần lập bảng ánh xạ, không mặc nhiên coi tên khác là thiếu toàn bộ bước.
- Admin được review Alert, trong khi các lệnh Incident lại yêu cầu role nghiệp vụ cụ thể: chính sách chưa nhất quán.
- Safety Task do Manager giao Safety Officer không thay thế quy trình corrective action của Incident hoặc giao việc tiến độ trong MF10.

### 10.2. Căn cứ code

- [Quy trình Incident](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/safety/safety-workflow.service.ts#L703).
- [Safety Task](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/safety/safety-workflow.service.ts#L1012).
- [Các chuyển trạng thái Alert](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/safety/alerts/safety-alert-review.service.ts#L11).
- [Điều kiện đóng Incident](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/safety/workflow-policy.ts).

## 11. MF09 — Giám sát môi trường qua IoT

**Liên quan:** ADD-08..10; phần cảnh báo môi trường của FR-57/58 và MF08.

| Actor             | Chức năng cần theo tài liệu                                                       | Hiện trạng               |
| ----------------- | --------------------------------------------------------------------------------- | ------------------------ |
| Site Manager      | Quản lý thiết bị, Site/Zone, đơn vị, chu kỳ, ngưỡng có hiệu lực.                  | Chưa thấy triển khai.    |
| Thiết bị / System | Xác thực nguồn, nhận số đo, chống trùng/đến muộn, đánh giá ngưỡng, stale/offline. | Chưa thấy triển khai.    |
| Safety Officer    | Xem số đo và xử lý Environmental Alert qua MF08.                                  | Chưa có luồng tương ứng. |

Trang `/iot` hiện chỉ là phần giới thiệu. **Chưa đáp ứng ADD-08..10.** Chưa thể ghi nhận đã hoàn thành MF09 dựa vào việc có menu hoặc route.

Căn cứ: [Trang IoT hiện tại](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/web/src/app.tsx#L173) và danh mục module backend tại mốc code đã nêu.

## 12. MF10 — Giao việc và theo dõi tiến độ

**Liên quan:** FR-32..34, FR-49/50; BR-20/21; ADD-05..07/17.

| Actor                     | Chức năng cần theo tài liệu                                                 | Hiện trạng                   |
| ------------------------- | --------------------------------------------------------------------------- | ---------------------------- |
| Site Manager              | Catalog, giao việc, điều chỉnh, duyệt từng báo cáo, duyệt hoàn thành riêng. | Chưa thấy backend nghiệp vụ. |
| Contractor Representative | Nhận việc/báo vướng mắc, gửi khối lượng và bằng chứng, đề nghị hoàn thành.  | Chưa thấy triển khai.        |
| System                    | Kiểm tra đơn vị/trùng/phạm vi, chỉ cộng lượng đã duyệt, lưu điều chỉnh.     | Chưa thấy triển khai.        |

Trang `/progress` mới là giới thiệu, còn nhắc 4D BIM/photogrammetry, vượt giới hạn tài liệu. Safety Task trong MF08 không thay thế MF10.

**FR-32..34, FR-49/50 và ADD-05..07/17 chưa hoàn thành.**

Căn cứ: [Trang Progress hiện tại](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/web/src/app.tsx) và danh mục module backend tại mốc code đã nêu.

## 13. Chức năng dùng chung và nền tảng trình diễn

| Nhóm                          | Hiện trạng                                                                             | Nội dung còn thiếu                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Thông báo — ADD-15            | Có inbox theo người nhận và thông báo lịch/đổi ca, một số chuyển giao an toàn.         | Chưa phủ đủ phân công, khách và mọi chuyển trạng thái của ADD-15.                                                             |
| Audit — ADD-15                | Nhiều nghiệp vụ có audit và chống xử lý lặp.                                           | Chưa thể coi đã có giao diện tra cứu audit thống nhất cho toàn bộ chức năng.                                                  |
| Dashboard — FR-37             | Manager và đại diện có dữ liệu nghiệp vụ; dashboard chung còn phần mẫu/chưa nối nguồn. | Chưa đủ dashboard hợp nhất hiện diện, người camera quan sát, công duyệt, tiến độ và an toàn theo nguồn/thời điểm.             |
| Xuất báo cáo — FR-38/66       | Chưa thấy luồng xuất Excel/PDF đáp ứng yêu cầu.                                        | Bộ lọc/scope, metadata nguồn/thời điểm/trạng thái và báo cáo an toàn cần triển khai/xác minh riêng.                           |
| Trạng thái camera/AI — ADD-18 | Có các phần kết nối/preview và trạng thái kỹ thuật.                                    | Chưa đủ căn cứ kết luận toàn bộ quản lý stale/offline, mất/kết nối lại và queue/retry đã hoàn chỉnh theo hợp đồng tích hợp.   |
| Mobile                        | App Expo hiện có màn hình kiểm tra kết nối backend.                                    | Chưa có đăng nhập, QR, lịch/công và yêu cầu Worker trên mobile. Các chức năng Worker đang có chủ yếu nằm trên Web responsive. |

### 13.1. Căn cứ code

- [Thông báo cá nhân](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/notifications/notifications.controller.ts).
- [Phạm vi và phát thông báo](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/backend/src/modules/workforce/notifications/scheduling-notification.service.ts).
- [Dashboard chung](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/web/src/components/dashboard/DashboardView.tsx).
- [Màn hình mobile hiện tại](https://github.com/smartsite-sep490/smartsite/blob/4c7300a/apps/mobile/app/index.tsx).

## 14. Tổng hợp quyền theo sáu actor

| Actor                     | Phần có cơ sở phù hợp                                                                          | Chênh lệch cần ưu tiên                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Administrator             | Quản lý tài khoản, Site, phiên và đọc danh mục.                                                | Global scope; một số quyền duyệt nghiệp vụ được bypass; quản lý camera đang thuộc Admin thay vì Manager; reset password chưa theo cơ chế một lần. |
| Site Manager              | Quản lý nhà thầu/Zone, cấu hình ca, xem tổng quan, duyệt phân công và khách ở backend.         | Thiếu quyền duyệt MF03/MF07; UI cản đường vào duyệt khách; chưa có khắc phục Incident chung, MF09/MF10 và người duyệt độc lập thứ hai.            |
| Contractor Representative | Quản lý Worker/đội, đăng ký mặt, gửi phân công, gán lịch và xử lý corrective action được giao. | Đang có quyền duyệt công/tăng ca/đổi ca vượt mô tả; thiếu chứng chỉ, Host định danh và báo cáo nguy cơ riêng.                                     |
| Safety Officer            | Xác minh Alert, quản lý Incident, xét kết quả và đóng/mở lại trong Site.                       | Chưa có kiểm tra chứng chỉ thực; chưa đủ khắc phục/đóng Alert tại chỗ; chưa có IoT và báo cáo an toàn đầy đủ.                                     |
| Security Officer          | Xác minh cổng, manual có lý do, QR và khách vào/ra.                                            | Chưa có scope bảo vệ theo cổng; chưa có báo cáo nguy cơ; cần thống nhất giới hạn thông tin xem và quyền vận hành của các role khác.               |
| Worker                    | Web có lịch/yêu cầu, công cá nhân, QR fallback và tham gia đăng ký mặt.                        | Chưa có nghiệp vụ trên app mobile; thiếu hủy/quá hạn đổi ca; quyền đọc lịch sử sau tạm dừng chưa chốt; phản ánh nguy cơ ADD-19 chưa triển khai.   |

## 15. Thứ tự đề xuất khi thống nhất backlog

1. **Chốt người duyệt MF03 và MF07:** tài liệu là Manager, code hiện là đại diện. Cập nhật nhất quán API, UI, trạng thái, thông báo, test và Use Case theo quyết định được thông qua.
2. **Đồng bộ quyền Admin và kiểm tra tài khoản Worker:** kiểm tra role nghiệp vụ cụ thể, xung đột trách nhiệm và trạng thái tài khoản tại mọi đường vào cổng, kể cả lúc xác nhận qua cổng.
3. **Hoàn thiện MF01:** chứng chỉ, năng lực, điều kiện duyệt, lý do từ chối, chống tự duyệt, điều chuyển và lịch sử hiệu lực.
4. **Hoàn thiện MF04:** nối UI cho Manager, định danh Host, duyệt độc lập, sửa/gửi lại/hủy và quyền theo dõi phiếu.
5. **Bổ sung phần còn thiếu của các luồng đã có:** chốt kỳ công; hủy/quá hạn đổi ca; điều kiện chưa bắt đầu/chưa check-in; báo cáo an toàn của các actor; khắc phục Alert tại chỗ và sự cố chung.
6. **Chốt phạm vi MF09, MF10 và mobile:** hiện chưa có nghiệp vụ hoàn chỉnh để ghi là “đã làm”. Phân biệt rõ phần bắt buộc bàn giao, phần mô phỏng và phần ngoài phạm vi.

## 16. Lưu ý sử dụng báo cáo

- Các dẫn chiếu được ghim vào commit `4c7300a`; cần rà soát lại khi main có thay đổi.
- Báo cáo không xác nhận chất lượng AI, hiệu năng, độ sẵn sàng hoặc mức hoàn thành NFR chỉ từ việc đọc code.
- Những rủi ro suy ra từ đường xử lý, đặc biệt khóa tài khoản tại cổng và điều hướng UI, cần được tái hiện bằng kiểm thử hồi quy trước khi xác nhận bản sửa.
- Số MF trong code/tài liệu cũ có thể khác cách đánh số trong dự thảo: báo cáo này dùng MF07 là đổi ca, MF09 là IoT và MF10 là tiến độ.
- Khi thống nhất phạm vi, cập nhật đồng thời tài liệu chức năng, bảng FR–Use Case, ma trận quyền, kiểm thử và backlog; không tự động coi toàn bộ đề xuất trong phiên bản 0.1 là yêu cầu đã duyệt.
