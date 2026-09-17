# ADR-0001 — Hai repo cho SmartSite

Ngày: 2026-09-17

Trạng thái: đã chốt cách chia repo theo trao đổi với người dùng.

## Quyết định

- `smartsite`: Web, Backend, Mobile, tài liệu, contract và cấu hình tích hợp.
- `smartsite-ai`: code AI camera, thử nghiệm/đánh giá và cách đóng gói AI.
- Hai repo thuộc cùng GitHub Organization. Không dùng Git submodule ở giai đoạn bắt đầu.
- Nhóm cùng làm các phần; người chịu trách nhiệm thay đổi và review được chọn theo issue.

## Ranh giới

Backend giữ dữ liệu nghiệp vụ, quyền theo Site/Zone/người/thời gian, xử lý sự kiện và quy trình MF08. AI nhận video/cấu hình camera, tạo kết quả quan sát và tham chiếu bằng chứng; không ghi trực tiếp vào database nghiệp vụ.

Contract gốc ở `smartsite/contracts`. Repo AI ghi phiên bản hoặc commit contract đang dùng. Hai repo có pipeline và phiên bản phát hành riêng; hợp đồng giao tiếp phải tương thích.

## Build và deploy

Repo không quyết định máy chủ. Web, Backend và AI có thể build/deploy riêng. AI có thể chạy máy GPU hoặc máy tại công trường; FE/BE có thể ở dịch vụ khác. Backend nghiệp vụ không xử lý vòng lặp video trong cùng tiến trình.

Compose tích hợp đặt trong `smartsite/infra`. Dùng image AI theo phiên bản khi chạy tích hợp; override local có thể build từ checkout `../smartsite-ai`. Chỉ tạo Compose chạy thật khi có Dockerfile, entrypoint và healthcheck của các service.

## Hệ quả

Thay đổi Web–Backend–Mobile có thể cùng một PR. Đổi giao tiếp AI cần hai PR phối hợp và bài kiểm tra tương thích. Không bắt buộc deploy cả hệ thống khi chỉ thay một module.
