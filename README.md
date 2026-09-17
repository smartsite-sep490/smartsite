# SmartSite

Monorepo ứng dụng SmartSite: Web, Backend, Mobile, tài liệu nghiệp vụ và cấu hình tích hợp. AI nằm trong repository độc lập `smartsite-ai`.

**Trạng thái:** khung repository; chưa có ứng dụng chạy được. Stack chưa được nhóm chốt. Các mục mở được ghi tại [quyết định stack](docs/architecture/stack-decisions.md).

## Cấu trúc

```text
apps/
  web/          Giao diện web
  backend/      API, nghiệp vụ, quyền, lưu dữ liệu
  mobile/       Ứng dụng di động
contracts/      Nguồn chuẩn của giao tiếp Backend–AI
docs/
  architecture/ Quyết định và ranh giới hệ thống
  requirements/ Phạm vi và tiêu chí MF05/MF06
  planning/     Thứ tự đầu việc để bắt đầu
infra/          Hướng tích hợp local và triển khai
.github/        Mẫu issue, PR và CI ban đầu
```

## Bắt đầu

1. Đọc [kế hoạch bắt đầu](docs/planning/first-milestone.md) và [cách làm việc](CONTRIBUTING.md).
2. Chốt stack bằng một PR cập nhật [stack-decisions.md](docs/architecture/stack-decisions.md).
3. Khởi tạo app cùng lệnh chạy, cấu hình mẫu và CI thật trong từng thư mục.
4. Triển khai một luồng nhỏ MF05 từ sự kiện giả đến màn hình cảnh báo; sau đó thay nguồn giả bằng AI.
5. Với MF06, kiểm chứng cách gắn danh tính trước khi tuyên bố phân biệt được người có quyền và người bị cấm.

Chưa có lệnh `docker compose up` cho hệ thống ở giai đoạn này. [infra/README.md](infra/README.md) ghi rõ cách sẽ tích hợp hai repo và deploy độc lập.

## Tài liệu cần đọc

- [Quyết định hai repo](docs/architecture/ADR-0001-repository-boundaries.md)
- [Phạm vi MF05/MF06](docs/requirements/MF05-MF06.md)
- [Contract Backend–AI đang dự thảo](contracts/README.md)

Chưa phát hành giấy phép nguồn mở. Tài liệu nháp chưa đồng nghĩa đã được giảng viên phê duyệt.
