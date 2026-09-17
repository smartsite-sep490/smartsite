# Stack: cần chốt trước khi dựng ứng dụng

Cập nhật 2026-09-18: **đã chốt Mobile dùng React Native**, bỏ Flutter. Các phần còn lại đang đề xuất, chưa được chốt toàn bộ.

| Thành phần | Đang có trong tài liệu | Cần quyết định |
|---|---|---|
| Web | Report 2: ReactJS | Công cụ build, phiên bản và package manager |
| Backend | Report 2: NestJS | Xác nhận framework, truy cập dữ liệu, migration, auth |
| Mobile | **React Native — đã chốt 18/09/2026** | Chốt Expo, thư viện và bộ phiên bản tương thích |
| AI | NFR: Python/FastAPI, YOLO11/ArcFace | Kiểm chứng khả thi, model/license, cách định danh, hardware |
| Dữ liệu | **Neon PostgreSQL — thay Supabase theo quyết định mới nhất 18/09/2026** | ORM, schema, backup, cách kết nối; Auth/Storage riêng |
| Bằng chứng | Report 2: Cloudflare R2 | Quyền truy cập, retention, upload/download |
| Deploy | Report 2: Google Cloud/Cloud Run | Tách nền tảng web/API với nơi chạy video/GPU |

Nguồn đã đối chiếu: bản xuất Report 2 và tab Chức Năng ngày 17/09/2026. Các lựa chọn này là nội dung tài liệu, không phải code đã tồn tại hay quyết định cuối.

Không tự thay stack thành .NET hoặc Flutter chỉ vì ví dụ so sánh repo. Quyết định mới cần ghi lý do ngắn, người chốt và cập nhật Report 2/3.

Yêu cầu chất lượng mới: code có ranh giới module, phân quyền theo phạm vi dữ liệu, kiểm thử, log, migration và CI/CD rõ ràng. Chọn stable tương thích và được duy trì; không tự động dùng beta/RC chỉ vì nhãn latest. Xem [đề xuất stack](stack-proposal-2026-09-18.md).

Người dùng xác nhận OpenAI API chạy trong sản phẩm, vai trò cụ thể chưa chốt. Đã chốt TanStack Query cho server state/API cache trên Web và React Native. Redux Toolkit chỉ dùng cho shared client state khi cần; không dùng RTK Query. AI camera đối chiếu FR83/84 và NFR12: YOLO11/ArcFace + FastAPI, không tự thay bằng OpenAI.

Database hiện hành là Neon PostgreSQL; chưa tạo Neon project hoặc di chuyển dữ liệu. TanStack Query đã được người dùng chốt ngày 18/09/2026; thay đề xuất RTK Query trước đây. Chưa cài dependency hoặc chốt patch version.

Cập nhật AI: người dùng cho phép thay baseline docs. YOLO11/ArcFace không còn là ràng buộc lựa chọn; xem ai-options-research-2026-09-18.md. Model/runtime/identity chưa chốt trước khi có dữ liệu và hardware.
