# Kế hoạch: Dashboard nhà thầu, đội công nhân và đổi ca trong đội

Ngày: 2026-10-08. Trạng thái: đã triển khai backend, contract/client và Web trên nhánh `feat/contractor-teams-20261008`; quality gate và 122 PostgreSQL integration tests đều PASS. Docker local đã build lại, migration và runtime đã cập nhật; chưa nghiệm thu trình duyệt/thiết bị thật.

## 1. Yêu cầu đã nhận

- Dashboard đại diện nhà thầu ghi rõ các site nhà thầu đang làm việc và số công nhân, số đội đang quản lý.
- Đại diện nhà thầu tạo đội như Đội sơn, Đội sàn, rồi phân công công nhân vào đội.
- Hoán đổi ca giữa hai công nhân chỉ được thực hiện khi cùng đội và có lịch phù hợp để đổi cho nhau.
- Giữ quy trình hiện hành: công nhân gửi yêu cầu → đồng nghiệp đồng ý → đại diện nhà thầu duyệt → đổi lịch cả hai trong một transaction.

Phần này bổ sung quản lý nhân sự nhà thầu và sửa MF07. MF03 tiếp tục tính công từ lịch và sự kiện đã xác nhận.

## 2. Hiện trạng từ code

- `apps/web/src/components/dashboard/DashboardView.tsx` hiển thị dashboard mẫu, chưa kết nối số liệu nhà thầu/công nhân/đội.
- `WorkerEntity` đã có `siteId`, `contractorId`; chưa có entity đội hoặc quan hệ thành viên đội trong danh sách entity hiện tại.
- `ScheduleConfigurationService.listSwapCandidates` lọc cùng site, nhà thầu, ngày, phiên bản lịch, công nhân/lịch active và shift ID khác nhau. Chưa lọc cùng đội; shift ID khác nhau chưa chứng minh hai khoảng giờ không chồng lấn.
- `SchedulingWorkflowService` đã có tạo yêu cầu, xác nhận đồng nghiệp, duyệt đại diện và áp dụng atomic. Cần bổ sung quy tắc đội và điều kiện thời gian vào các điểm này.
- Deadline hiện hành cho phép yêu cầu trong lúc ca đang diễn ra, khóa khi ca kết thúc. Không tự đổi deadline trong hạng mục này.

## 3. Quy tắc đã được người dùng xác nhận

- Mỗi đội thuộc một nhà thầu tại một site. Mỗi công nhân thuộc tối đa một đội đang hoạt động tại site đó; không cho phép đồng thời thuộc nhiều đội. Công nhân đang chờ phân đội được hiển thị “Chưa vào đội” và chưa được swap.
- “Lịch trái nhau” nghĩa là **cùng ngày làm việc, hai ca khác nhau và không chồng giờ**. Với ca qua đêm, ngày làm việc là ngày bắt đầu ca theo quy tắc lịch hiện hành; so sánh khoảng giờ thực tế theo timezone của ca.
- Điều kiện swap gồm cả cùng đội và lịch trái nhau; cùng nhà thầu nhưng khác đội vẫn không được swap.

Ví dụ nghiệm thu: A và B cùng Đội sơn, A làm 08:00–12:00, B làm 13:00–17:00 cùng ngày → có thể gửi swap. A ở Đội sơn, B ở Đội sàn → không được swap dù cùng nhà thầu. Hai ca 08:00–12:00 và 10:00–14:00 → không hợp lệ vì chồng giờ. Ca 08:00–12:00 và 12:00–16:00 tiếp giáp được coi là không chồng giờ.

## 4. Dashboard nhà thầu

### Thông tin hiển thị

- Tên nhà thầu và danh sách site đang tham gia hợp lệ: tên, mã site; có địa chỉ nếu dữ liệu hiện có cung cấp.
- Chọn site để xem rõ phạm vi của các chỉ số.
- Ba chỉ số tại site được chọn: **Công nhân đang quản lý**, **Đội đang hoạt động**, **Công nhân chưa vào đội**.
- Danh sách đội: tên đội, số thành viên active và nút xem/quản lý.
- Liên kết đến quản lý công nhân, quản lý đội và duyệt yêu cầu đổi ca.

### Quy tắc số liệu và quyền

- Chỉ lấy cặp Site/Contractor mà tài khoản có quyền đại diện hiện hành và nhà thầu đang tham gia hợp lệ. Tài khoản quản lý nhiều nhà thầu/site được chọn rõ phạm vi; không âm thầm lấy bản ghi đầu tiên.
- Tổng công nhân là số Worker active của nhà thầu tại site, gồm cả công nhân chưa vào đội. Không đếm theo số lịch, lượt IN/OUT hoặc tổng các membership lịch sử.
- Tổng đội chỉ đếm đội active trong phạm vi đã chọn. Đội rỗng vẫn là đội active và có 0 thành viên.
- Tổng công nhân chưa vào đội đếm Worker active không có membership active hợp lệ.
- Nếu có thống kê toàn bộ site, ghi rõ là tổng bản ghi công nhân theo site; chưa suy luận một Worker ở các site là cùng một người khi mô hình chưa có định danh toàn cục tương ứng.
- Backend tính số liệu trực tiếp trong phạm vi quyền; Web không tải hết mọi trang để tự cộng tổng.
- Có loading, empty, error/retry, denied; không hiển thị dữ liệu mẫu như số liệu thật hoặc biến lỗi thành số 0.

## 5. Quản lý đội

Theo quy tắc một đội active/công nhân tại mỗi site đã chốt:

- Tạo đội với tên, mô tả tùy chọn; site và nhà thầu lấy từ phạm vi đã chọn.
- Xem danh sách/chi tiết đội, tìm kiếm và phân trang thành viên.
- Sửa tên/mô tả; tránh tên active trùng trong cùng Site/Contractor theo quy tắc chuẩn hóa được chốt khi triển khai.
- Thêm, bỏ hoặc chuyển công nhân giữa các đội. Danh sách chọn chỉ chứa công nhân active thuộc đúng Site/Contractor.
- Chuyển đội là một transaction: kết thúc membership cũ, tạo membership mới, ghi người xử lý/lý do/thời điểm; không có trạng thái hai đội active tạm thời.
- Lưu trữ đội thay cho xóa lịch sử. Đề xuất chỉ lưu trữ khi đã chuyển/bỏ hết thành viên active.
- Worker xem đội của mình; quyền tạo/sửa/phân thành viên thuộc đại diện đúng Site/Contractor. Đội trưởng và quyền riêng cho đội trưởng chưa được yêu cầu.
- Khi công nhân đổi nhà thầu, bị vô hiệu hóa hoặc tham gia site hết hạn, membership cũ không được tiếp tục cấp điều kiện swap.

## 6. Quy tắc swap sau thay đổi

Danh sách ứng viên và command dùng chung một quy tắc eligibility, luôn kiểm tra ở Backend:

1. Hai công nhân khác nhau, cùng site và nhà thầu hợp lệ.
2. Cả hai có membership active trong cùng đội active. Công nhân chưa có đội không được swap.
3. Cùng ngày làm việc, cùng phiên bản lịch như hiện hành, ca khác nhau và hai khoảng không chồng giờ. Ghép giờ ca mẫu với `workDate` và timezone bằng helper hiện có; ca qua đêm so sánh bằng timestamp thực tế. Dùng khoảng nửa mở `[startsAt, endsAt)`: hai ca tiếp giáp không chồng giờ.
4. Hai lịch/công nhân còn active, chưa hết deadline; mỗi lịch nhận ca mới vẫn đáp ứng quy tắc một ca chính/ngày và kiểm tra xung đột hiện hành.
5. Quyền ca của nhà thầu, điều kiện đồng nghiệp xác nhận và quyền đại diện duyệt vẫn được kiểm tra.
6. Kiểm tra lại tại **liệt kê ứng viên, tạo yêu cầu, đồng nghiệp xác nhận, đại diện duyệt**. Không tin team ID do client gửi làm bằng chứng quyền.
7. Nếu đội, membership hoặc lịch thay đổi trong lúc chờ khiến yêu cầu không còn hợp lệ, không áp dụng; hiển thị lý do và trạng thái conflict theo state machine hiện có. Đề xuất yêu cầu gắn với đội khi gửi; chuyển cả hai sang một đội mới cũng cần gửi yêu cầu mới.
8. Áp dụng cả hai lịch atomic; membership changes và swap phải có quy tắc khóa nhất quán để tránh race. Retry không tạo thêm thay đổi/audit/thông báo.

Phân biệt với **xin chuyển sang ca khác của một công nhân**: yêu cầu cùng đội áp dụng cho swap giữa hai người. Luồng xin đổi ca đơn hiện hành được giữ, trừ khi người dùng yêu cầu sửa riêng.

Với MF03 đã phát sinh công, không thay snapshot hoặc raw events để làm swap qua; giữ cơ chế phát hiện `SCHEDULE_CHANGED` và đối soát đang có. Nghiệm thu riêng trường hợp swap khi một hoặc cả hai công nhân đã IN vì deadline hiện hành vẫn cho phép trong ca.

## 7. Dữ liệu và API dự kiến

| Thành phần                   | Nội dung                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `contractor_team`            | ID, Site/Contractor, tên/mô tả, trạng thái active, version và thời điểm tạo/cập nhật               |
| `contractor_team_membership` | Team/Worker, phạm vi Site/Contractor, thời điểm tham gia/rời đội và thông tin người thực hiện      |
| Swap request                 | Tham chiếu đội kỳ vọng tại lúc gửi và thông tin phục vụ revalidation/audit; giữ lịch sử yêu cầu cũ |
| Dashboard API                | Các phạm vi được phép và tổng hợp tại Site/Contractor được chọn                                    |
| Team API                     | Danh sách/chi tiết/tạo/sửa/lưu trữ đội; liệt kê/thêm/bỏ/chuyển thành viên                          |
| Swap API hiện có             | Bổ sung thông tin đội và lý do không đủ điều kiện; giữ quy trình xác nhận/duyệt                    |

Route dự kiến đặt dưới `/api/v1/sites/:siteId/contractors/:contractorId/...`; chốt tên DTO/route sau khi đối chiếu conventions của module hiện có. Contract/client là nguồn types chung cho Web.

Database cần migration, FK bảo đảm thành viên cùng Site/Contractor với đội, index truy vấn phạm vi và unique constraint cho tối đa một membership active/Worker tại site. Lịch sử membership và audit được giữ khi đổi đội; không chỉ ghi đè một `teamId` trên Worker.

## 8. Thứ tự triển khai

| Phase | Công việc                                                                  | Điều kiện hoàn thành                                                             |
| ----- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1     | Đã chốt một đội/công nhân và lịch swap cùng ngày, khác ca, không chồng giờ | Hoàn tất bước xác nhận hai quy tắc; dùng các ví dụ mục 3 khi triển khai          |
| 2     | Migration/entity và nghiệp vụ đội/thành viên                               | Ràng buộc phạm vi, lịch sử, transaction và quyền có integration test             |
| 3     | Contract/client, Team API và màn quản lý đội                               | Đại diện tạo đội và phân/chuyển thành viên đúng phạm vi                          |
| 4     | Eligibility và workflow swap theo đội                                      | Lọc ứng viên, gửi/xác nhận/duyệt thống nhất; không áp dụng yêu cầu mất điều kiện |
| 5     | API tổng hợp và dashboard nhà thầu                                         | Site/tổng công nhân/tổng đội lấy từ dữ liệu thật, cập nhật sau thay đổi          |
| 6     | Migration dữ liệu cũ, hồi quy MF02/MF03/MF07, kiểm tra trình duyệt         | Có kết quả kiểm tra, giới hạn còn lại và hướng dẫn rollout                       |

Trong phase 6 cần kiểm tra cả thao tác bàn phím, responsive, mất mạng và conflict trên Web thật. Không cần đổi repo AI cho yêu cầu này.

## 9. Dữ liệu cũ và rollout

- Worker hiện có được giữ nguyên và hiển thị “Chưa vào đội”; không tự tạo đội chung vì sẽ vô tình cho mọi công nhân cùng nhà thầu tiếp tục swap.
- Migration và backend bật rule cùng đội ngay khi triển khai; công nhân cũ chưa có đội sẽ bị chặn swap. Đại diện cần tạo đội và phân thành viên trước khi tiếp tục sử dụng swap; không có giai đoạn bỏ qua rule để hỗ trợ dữ liệu cũ.
- Yêu cầu swap cũ đang chờ phải được rà soát theo rule mới; đề xuất đánh dấu conflict và gửi lại khi không có tham chiếu đội hợp lệ. Yêu cầu đã áp dụng giữ nguyên lịch sử, không đổi ngược lịch.
- Migration trước, Backend/contract-client trước, Web sau. Không bỏ kiểm tra đội ở Backend để hỗ trợ một client cũ gửi payload thiếu dữ liệu.
- Không trộn thay đổi này với việc merge/commit toàn bộ các thay đổi MF03 chưa commit; lập nhánh/PR tập trung khi bắt đầu triển khai.

## 10. Nghiệm thu và kiểm thử

- Dashboard hiện đúng tên site và các tổng sau tạo đội, thêm/chuyển/bỏ thành viên, archive đội hoặc disable Worker; số công nhân không thay đổi chỉ vì chuyển đội.
- Nhà thầu có nhiều site không bị cộng/hiển thị lẫn phạm vi; quyền bị thu hồi không còn xem hoặc thao tác được.
- Không thể thêm Worker khác nhà thầu/site; hai thao tác chuyển/thêm đồng thời không tạo nhiều membership active.
- Cùng đội + ca hợp lệ → đồng nghiệp đồng ý → đại diện duyệt → hai lịch đổi atomic.
- Khác đội, chưa vào đội, đội inactive, cùng ca, chồng giờ, khác ngày, lệch phiên bản lịch hoặc ca hết hạn → bị chặn ở Backend kể cả gửi request trực tiếp.
- Công nhân đổi đội sau khi gửi, đồng nghiệp đã đồng ý nhưng rời đội trước duyệt, ca sửa giữa hai bước, quyền bị thu hồi → không swap; có lý do rõ và audit/thông báo phù hợp.
- Ca tiếp giáp, ca qua đêm, timezone và một/both Worker đã IN được kiểm tra với MF03; không mất sự kiện gốc hoặc tự cộng giờ sai.
- Kiểm thử PostgreSQL thật cho migration, FK, uniqueness, transaction và concurrency; unit test eligibility; contract/client test và Web interaction test.
- Theo `AGENTS.md`: frozen install, peer check, `pnpm check`, Mobile dependency check, relevant PostgreSQL integration, changed-file formatting và `git diff --check`; Compose readiness nếu runtime thay đổi.

Phase 1–5 đã có implementation và kiểm thử tự động. Phase 6 đã có migration test, hồi quy PostgreSQL, hướng dẫn rollout và Docker local cập nhật; kiểm tra responsive, bàn phím và mất mạng trên trình duyệt thật còn chưa thực hiện. Xem [báo cáo đối chiếu backend/UI](../reviews/contractor-teams-backend-ui-review-2026-10-08.md), [kiểm tra Docker MF03/MF07](../reviews/mf03-mf07-docker-recheck-2026-10-08.md) và [hướng dẫn vận hành](../operations/contractor-teams.md) để biết kết quả, giới hạn và các bước đưa vào sử dụng.
