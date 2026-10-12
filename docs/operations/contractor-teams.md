# Dashboard nhà thầu, đội công nhân và swap ca

## Luồng sử dụng

Phân lịch cho đội theo ngày/tuần/lặp có thời hạn, xem trước xung đột và sửa/hủy ngày tương lai: [Team schedule assignments](team-schedule-assignments.md).

1. Đăng nhập bằng đại diện nhà thầu, mở Dashboard. Nếu có nhiều phạm vi, chọn rõ cặp Site/Contractor; nếu chỉ có một phạm vi, màn hình dùng phạm vi đó. Tên/mã site và tên nhà thầu luôn hiển thị cùng số liệu.
2. **Overview** hiển thị tổng Worker active, đội active và Worker chưa vào đội tại phạm vi đã chọn. Số công nhân không phụ thuộc số lịch hoặc số membership lịch sử.
3. Trong **Teams**, tạo đội như Đội sơn, Đội sàn. Tìm kiếm/phân trang, sửa tên/mô tả hoặc archive đội rỗng. Tên được chuẩn hóa NFKC và chữ thường để chặn tên active trùng trong cùng phạm vi.
4. Trong **Workers**, thêm công nhân chưa có đội chỉ cần chọn đội và xác nhận, không cần lý do. Chuyển hoặc bỏ đội vẫn cần lý do từ 5 ký tự. Chuyển đội kết thúc membership cũ và tạo membership mới atomic; lịch sử và audit được giữ. Form gửi ID membership đã tải để phát hiện thay đổi đồng thời.
5. Worker mở lịch của mình để xem đội hiện tại. Chưa vào đội, đang tải hoặc không xác minh được đội thì chưa gửi swap; màn hình có trạng thái tải/lỗi/thử lại.
6. Worker chọn ca và đồng nghiệp hợp lệ → đồng nghiệp xác nhận → đại diện nhà thầu duyệt. Backend kiểm tra lại đội, membership, lịch và quyền tại từng bước; không tin danh sách đã tải ở Web là bằng chứng còn đủ điều kiện.

## Quy tắc swap

- Hai người khác nhau, cùng nhà thầu/site và cùng đội active.
- Cùng ngày bắt đầu ca (`workDate`) và cùng phiên bản lịch theo MF07 hiện hành; ca khác nhau, khoảng giờ thực tế không chồng lấn.
- Hai ca tiếp giáp được phép. Ca qua đêm dùng timestamp thực tế ghép từ `workDate`, giờ ca mẫu và timezone.
- Hai lịch/công nhân còn active; các ca vẫn được cấp cho nhà thầu và chưa kết thúc. Thông báo deadline hiện hành giữ mã `SHIFT_WORK_DATE_PASSED`.
- Yêu cầu lưu đội và hai membership kỳ vọng. Đổi đội hoặc rời đội rồi quay lại tạo membership mới sẽ làm yêu cầu cũ không còn hợp lệ, kể cả cuối cùng hai người lại ở cùng một đội.
- Xác nhận/duyệt mất điều kiện chuyển yêu cầu sang `CONFLICTED` với lý do; không đổi một phần lịch. Các chuyển trạng thái swap có audit và thông báo theo luồng hiện có.
- Xin chuyển ca đơn của một công nhân giữ quy tắc cũ. Điều kiện cùng đội áp dụng cho swap hai người.
- Nếu đã có công MF03, giờ ca gốc và raw evidence không bị thay. Lịch đổi được MF03 đánh dấu `SCHEDULE_CHANGED` để đối soát; không tự chốt công theo ca mới.

## API và payload

Tất cả endpoint dùng user bearer token và prefix `/api/v1`.

| Endpoint                                                 | Response / command                                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /contractor-dashboard/scopes`                       | `{ items: ContractorDashboardScope[] }`, các Site/Contractor còn quyền đại diện và tham gia hợp lệ                                                                        |
| `GET /sites/:siteId/my-team`                             | Worker xem mình: `{ workerId, displayName, membershipId, teamId, teamName }`; `200` với các trường đội `null` khi chưa vào đội, `403` khi không có quyền/không còn hợp lệ |
| `GET /sites/:siteId/contractors/:contractorId/dashboard` | `{ scope, workerCount, teamCount, unassignedWorkerCount }`                                                                                                                |
| `GET .../teams`                                          | `{ items, total }`; query `offset`, `limit` (1–100, mặc định 20), `search`, `status=ACTIVE\|ARCHIVED\|ALL`                                                                |
| `GET .../teams/:id`                                      | Chi tiết đội, gồm `version` và `memberCount`                                                                                                                              |
| `POST .../teams`                                         | `{ requestId, name, description? }`; `requestId` là UUID ổn định cho cùng lần gửi, trả đội mới                                                                            |
| `PATCH .../teams/:id`                                    | `{ expectedVersion, name, description }`                                                                                                                                  |
| `POST .../teams/:id/archive`                             | `{ expectedVersion, reason }`; chặn khi còn membership của Worker active trong đúng phạm vi                                                                               |
| `GET .../team-workers`                                   | `{ items, total }`; query `offset`, `limit`, `search`, `teamId` hoặc `unassigned=true`                                                                                    |
| `PUT .../team-workers/:workerId/team`                    | `{ requestId, expectedMembershipId, teamId, reason }`; dùng `teamId:null` để bỏ đội; ID kỳ vọng phải được gửi rõ, có thể `null` khi chưa có đội                           |

`...` trong bảng là `/sites/:siteId/contractors/:contractorId`. Các type chuẩn ở `contracts/src/contractor-team-api.ts`; Web dùng `SmartSiteManagementClient`, không khai báo DTO song song.

`reason` có thể bỏ qua khi `expectedMembershipId:null` để thêm công nhân chưa có đội. Khi chuyển hoặc bỏ membership hiện có, `reason` vẫn bắt buộc từ 5 đến 1000 ký tự. Thêm đội không có lý do lưu chuỗi rỗng; người thực hiện, thời điểm và audit vẫn được giữ, không thay schema.

Ví dụ phân công:

```json
{
  "requestId": "11111111-1111-4111-8111-111111111111",
  "expectedMembershipId": null,
  "teamId": "22222222-2222-4222-8222-222222222222"
}
```

Khi gặp conflict, tải lại dữ liệu rồi thao tác theo version/membership mới. Không thay ID kỳ vọng để bỏ qua việc đối chiếu. Giữ request ID cho retry cùng nội dung.

## Dữ liệu cũ và triển khai

- Chạy migration `ContractorTeams1791676800004` trước backend mới, sau đó cập nhật Web. `synchronize` vẫn tắt.
- Worker cũ vẫn được giữ và hiển thị chưa vào đội. Không tự tạo đội chung. Rule cùng đội được backend mới áp dụng ngay; đại diện cần phân đội trước khi công nhân tiếp tục sử dụng swap.
- Migration đánh dấu các swap cũ chưa áp dụng, chưa có binding đội là `CONFLICTED`; giữ lý do yêu cầu và lịch sử swap đã `APPLIED`. Người dùng gửi lại sau khi được phân đội.
- Unique index ngăn hai membership active/Worker tại site; FK và trigger chặn gán sai Site/Contractor. Khi Worker bị disable hoặc đổi phạm vi, membership cũ không cấp quyền swap.
- Archive có thể kết thúc các membership không còn Worker active trong đúng phạm vi; việc này và lý do được ghi audit. Worker được bật lại phải được phân đội mới.
- Downgrade từ chối khi đã có đội để giữ lịch sử. Không drop bảng/column chứa lịch sử để quay lại backend cũ.
- Ngày 2026-10-08 đã build lại Dockerfile chuẩn, backup database local, chạy migration và cập nhật Backend/Web local. Container healthy, schema không drift và không pending migration. Xem [kế hoạch đội và swap](../planning/contractor-dashboard-teams-shift-swap-plan.md); chưa nghiệm thu thiết bị/trình duyệt thật.

## Kiểm chứng

Đối chiếu kế hoạch và kết quả kiểm tra: [kế hoạch đội và swap](../planning/contractor-dashboard-teams-shift-swap-plan.md).
