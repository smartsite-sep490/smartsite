# MF03 / MF07 — kiểm tra lại Docker ngày 2026-10-08

Nhánh `feat/contractor-teams-20261008`, checkout `D:\SmartSite\smartsite`. Theo yêu cầu, đã build lại bằng Dockerfile chuẩn và cập nhật runtime local; không sửa logic trong lần kiểm tra này.

## Kết quả

| Phần                      | Bằng chứng hiện tại                                                                                                                                | Trạng thái                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Image Backend/migrate/Web | `docker compose -f infra/compose.yaml build backend migrate web`, frozen lockfile trong image                                                      | PASS                                   |
| Khởi động/migration       | Compose `up -d --wait --wait-timeout 120 backend web`; migrate exit 0; PostgreSQL, Backend, Web healthy                                            | PASS                                   |
| Schema database ứng dụng  | Kiểm tra từ container Backend: 0 metadata drift statements, không pending migration; có `ContractorTeams1791676800004` và các migration MF03       | PASS                                   |
| MF03                      | Tổng nhiều khoảng IN/OUT, thiếu checkout, thông báo, nghỉ/tăng ca, correction, quyền, concurrency, snapshot khi ca thay đổi, migration dữ liệu cũ  | PASS trong PostgreSQL integration      |
| MF07                      | Query/phạm vi/ca đã kết thúc, thông báo, cùng đội và ca không chồng giờ, xác nhận/duyệt, chuyển đội khi chờ, transfer/approval race và swap atomic | PASS trong PostgreSQL integration      |
| Hồi quy tích hợp          | Chạy lại toàn bộ `pnpm --filter @smartsite/backend test:integration`                                                                               | **122/122**, 0 fail/skip               |
| UI tự động                | Chạy lại toàn bộ `pnpm --filter @smartsite/web test`                                                                                               | **344/344**, 40 files                  |
| Runtime Worker            | Hai Worker demo đăng nhập, không bị buộc đổi mật khẩu; đọc ngày công/bảng công/hàng đợi nghỉ và tăng ca/lịch/đổi ca/swap/đội                       | HTTP 200                               |
| Runtime scope             | Worker có representative scopes rỗng; truy cập dashboard scoped bị từ chối                                                                         | Đúng semantics, HTTP 403 cho dashboard |
| Health/Web                | Backend `/api/v1/health/ready`, Web `/healthz` và `/`                                                                                              | HTTP 200                               |

Đã xác minh URL migration chỉ trỏ đến service `postgres`, database `smartsite` local trước khi triển khai. Backup trước migration: `D:\SmartSite\runtime-backups\pre-mf03-mf07-20261008.dump`. Volume được giữ nguyên. Smoke test không tạo IN/OUT hay ngày công giả trong database ứng dụng; các tình huống ghi/swap/concurrency được kiểm tra trên database test riêng.

Log build: `D:\SmartSite\docker-mf03-mf07-build.log`; log integration: `D:\SmartSite\mf03-mf07-recheck.log`; log Web: `D:\SmartSite\mf03-mf07-web-recheck.log`.

## Mức hoàn thành và phần còn lại

Backend, contract/client và UI của các luồng chính MF03/MF07 đã được triển khai, kiểm thử tự động lại và đưa vào Docker local. Các quy tắc đội/swap đã khớp [kế hoạch](../planning/contractor-dashboard-teams-shift-swap-plan.md).

- Hai Worker demo hiện chưa vào đội. Đại diện cần tạo đội và phân thành viên trước khi thử swap; migration không tự gom Worker vào đội. Các swap cũ chưa áp dụng thiếu binding đội được chuyển `CONFLICTED`, swap đã áp dụng giữ nguyên lịch sử.
- Chưa nghiệm thu toàn bộ đường thao tác UI → API bằng trình duyệt thật. Thử công cụ trình duyệt lần này vẫn lỗi `node_repl kernel exited unexpectedly`, nguyên nhân Windows sandbox `apply deny-read ACLs`. UI tests dùng jsdom/mock client; runtime smoke dùng HTTP thật.
- Chưa kiểm tra Face/QR với thiết bị thật, responsive/keyboard trực quan và benchmark tải lớn. Service AI thuộc profile riêng đang dừng, không được build/start trong lần kiểm tra MF03/MF07 này; đường Face thật chưa được xác nhận.
- `SCHEDULE_CHANGED` tiếp tục giữ snapshot cũ và chặn xác nhận; UI hướng dẫn khôi phục lịch. Chưa có quyết định nghiệp vụ cho phép tự thay snapshot sang lịch mới.
- Chưa có review độc lập của thành viên con người; chưa commit/merge hay phát hành production.

Vì vậy có thể xác nhận **luồng chính đạt kiểm thử tự động và runtime local đã cập nhật**, nhưng chưa xác nhận nghiệm thu toàn bộ thiết bị/trình duyệt hoặc Definition of Done đầy đủ. Web local: `http://localhost:5173`.
