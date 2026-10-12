# Rà soát backend/UI quản lý đội và swap — 2026-10-08

Phạm vi: [kế hoạch đã chốt](../planning/contractor-dashboard-teams-shift-swap-plan.md). Nhánh `feat/contractor-teams-20261008`; giữ các thay đổi MF03 đang có, chưa commit/merge.

Codex thực hiện backend, migration, contract/client và integration. Theo chỉ định của người dùng, agy thực hiện Web qua Herdr và review read-only backend; Codex rà soát UI và sửa các điểm lệch thông qua giao việc tiếp cho agy. Báo cáo riêng của agy tại `D:\SmartSite\agy-team-ui-report.md`.

## Đối chiếu yêu cầu

| Yêu cầu                                       | Backend                                                                                         | UI / kiểm chứng                                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Site làm việc, tổng công nhân, tổng đội       | API scopes và tổng hợp có quyền Site/Contractor hiện hành                                       | Dashboard tên/mã site, phạm vi rõ, KPI từ API; test HTTP dùng phiên đăng nhập thật                                             |
| Một đội active/công nhân tại site             | Unique index, FK/trigger kiểm tra phạm vi                                                       | Form phân/chuyển/bỏ đội; test hai lệnh đồng thời chỉ một lệnh thắng và direct SQL không thêm được membership active thứ hai    |
| Tạo/sửa/archive đội                           | Chuẩn hóa tên, version, không archive khi còn thành viên hợp lệ; giữ audit/history              | Giao diện đội, phân trang/tìm kiếm và conflict handling                                                                        |
| Cùng đội, cùng ngày, ca khác, không chồng giờ | Eligibility dùng chung cho đọc ứng viên và command; deadline/assignment ca được kiểm tra        | Worker thấy đội của mình, chỉ gửi swap khi xác minh được đội; không client tự suy luận eligibility                             |
| Đồng nghiệp xác nhận rồi đại diện duyệt       | Giữ state machine; bind đội/hai membership; swap atomic                                         | UI hiện hành giữ bước xác nhận/duyệt, thông báo conflict                                                                       |
| Đổi đội trong lúc chờ không áp dụng           | Revalidation khi xác nhận/duyệt, khóa Worker/Team; trạng thái conflict                          | Test chuyển đội giữa các bước và race chuyển đội/duyệt; hai lịch cùng đổi hoặc cùng giữ nguyên                                 |
| Bảo toàn MF03                                 | Swap không thay raw IN hoặc snapshot ngày công                                                  | Integration có IN tổng hợp thật qua pipeline, sau swap snapshot/raw không đổi và có `SCHEDULE_CHANGED`                         |
| Phạm vi quyền và dữ liệu cũ                   | Current DB roles/grants/participation; pending legacy swap conflict, applied history giữ nguyên | Test Worker không quản lý đội, nhà thầu khác không bị lộ dữ liệu, grant thu hồi bị chặn; migration không tự gom Worker vào đội |

## Các điểm lệch phát hiện và sửa

- UI ban đầu tự chọn site đầu tiên khi có nhiều scopes: chuyển sang chọn rõ phạm vi; chỉ tự dùng nếu có duy nhất một scope.
- Form/filter cũ còn giữ khi đổi site: đóng form và reset bộ lọc/phân trang để không gửi Worker/Team cũ vào phạm vi mới.
- Dropdown chỉ tải 100 đội: dùng helper tải đủ các trang.
- Query key dùng bearer token hoặc chỉ Worker ID: dùng session scope; không đưa raw token vào query key.
- Worker card hiển thị chưa vào đội cả khi đang tải/API lỗi: tách loading/error/retry và chặn gửi swap khi chưa xác minh thành công.
- UI tạo/gán đội cần giữ request ID cho retry cùng input; các payload dùng version/membership kỳ vọng của contract.
- Typecheck phát hiện callback dashboard dùng `string` thay `ActiveTab`; sửa type tương thích với navigation hiện có, không dùng `any` để bỏ kiểm tra.
- Guard cùng đội/non-overlap ban đầu chạy trước deadline và làm đổi mã lỗi ca đã kết thúc: đưa guard deadline lên trước trong create, giữ `SHIFT_WORK_DATE_PASSED` và kiểm tra cả deadline ở discovery.

## Giới hạn nghiệm thu

- Integration HTTP xác minh endpoint/validation/auth/response trên NestJS và PostgreSQL test thật; Web interaction tests sử dụng jsdom với mock client.
- Browser automation không khởi tạo được (`trusted Node process exited unexpectedly` sau reset). Chưa chạy toàn bộ UI → API trong trình duyệt thật hoặc kiểm tra responsive/keyboard trực quan.
- Chưa benchmark tải lớn cho discovery ứng viên; chưa có review độc lập của thành viên con người theo Definition of Done.
- Sau kiểm tra source, Backend/Web đã được build lại bằng Dockerfile chuẩn và cập nhật runtime local theo yêu cầu; migration đã chạy, schema không drift. Chưa phát hành production. Xem [kiểm tra Docker MF03/MF07](mf03-mf07-docker-recheck-2026-10-08.md) cho bằng chứng runtime riêng.

## Kết quả quality gate

- `pnpm check`: PASS — lint không warning, typecheck, unit/interaction tests và build cả workspace (Backend/Web/Mobile).
- Backend unit: **267/267**; Web: **344/344**; API client: **43/43**; contracts: **80/80**; scripts: **23/23**.
- PostgreSQL integration toàn bộ: **122/122**, không skip; migration/entity metadata không drift. Log tại `D:\SmartSite\contractor-teams-integration-final.log`.
- Frozen install offline, peer check và Mobile dependency check: PASS; không thêm dependency trong tính năng này.
- Prettier các file thuộc tính năng và `git diff --check`: PASS. Ba file còn lệch format được sửa bằng Prettier, không đổi logic.

Kết luận: backend, contract/client và UI đã khớp các quy tắc xác nhận trong phạm vi source, kiểm thử tự động và smoke test runtime local. Chưa nghiệm thu trình duyệt/thiết bị thật; không đánh dấu các phần đó hoàn tất.
