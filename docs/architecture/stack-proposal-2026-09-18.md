# Stack và tiêu chuẩn code — đề xuất 18/09/2026

Đã chốt: React Native, hai repo smartsite/smartsite-ai, giữ nhánh sau merge.
Các lựa chọn còn lại bên dưới là đề xuất để chốt, chưa phải phần mềm đã cài hoặc kiểm chứng tích hợp.

## Phương án đề xuất

| Phần | Lựa chọn | Mục đích |
|---|---|---|
| Web | React + TypeScript + Vite | Dashboard nghiệp vụ gọi Backend riêng |
| Web UI | Tailwind CSS + shadcn/ui | Component và token giao diện có thể tùy chỉnh |
| Dữ liệu/form Web | TanStack Query, React Hook Form, Zod; React Router | Quản lý server state, form, validation và routing |
| Mobile | React Native + Expo development build + Expo Router | Tận dụng TypeScript, quản lý native dependencies theo SDK |
| Backend | NestJS + TypeScript; modular monolith | Module theo nghiệp vụ, triển khai một API trước |
| Database | PostgreSQL + Prisma stable | Quan hệ, transaction, migration; có thể host PostgreSQL tại Supabase |
| AI | Python + FastAPI + PyTorch/OpenCV | API kỹ thuật và worker video riêng; model PPE/identity phải benchmark |
| Monorepo | pnpm workspaces + Turborepo | Quản lý workspace và thứ tự build/cache |
| API | REST + OpenAPI, client sinh từ contract | Giữ Web/Mobile/AI tương thích Backend |
| Chất lượng | ESLint, Prettier, Vitest/Testing Library cho Web; Jest/Supertest cho BE; pytest cho AI; Playwright cho Web E2E | Kiểm tra tự động theo từng nền tảng |
| Vận hành | Docker, Compose local, GitHub Actions; log JSON và correlation ID | Build/deploy độc lập, theo dõi lỗi và tái lập môi trường |

Auth provider, object storage, realtime transport, mobile E2E và hosting sẽ được chốt theo nhu cầu cụ thể. Không xem các mục này là đã triển khai.

## Các hướng đã cân nhắc

- React/Vite + NestJS: đề xuất vì dashboard và API nghiệp vụ riêng đã phù hợp tài liệu hiện tại.
- Next.js + NestJS: cân nhắc nếu xuất hiện nhu cầu SSR/SEO cho trang công khai; hiện chưa thấy yêu cầu đủ mạnh để thêm server frontend.
- .NET/Java Backend: có thể phù hợp nếu nhóm mạnh các hệ này; không tự đổi khỏi NestJS trong Report 2 khi chưa có căn cứ.

## Chính sách phiên bản

Chọn stable mới có bộ dependency tương thích, Node LTS được hỗ trợ; khóa phiên bản và lockfile, CI dùng frozen install. Mobile dùng React/React Native đúng phiên bản Expo SDK hỗ trợ, không ép giống Web. Python phải tương thích PyTorch/CUDA/model đã chọn.

Kết quả đọc npm registry ngày 18/09/2026 (chỉ là snapshot, chưa phải lockfile): React 19.3.0; Vite 8.3.0; TypeScript 7.0.2; Nest core 12.0.3; Expo 57.0.23; React Native 0.87.1; pnpm 12.4.2; Turbo 2.10.13; TanStack Query 5.103.1; Zod 4.6.5. Nhãn latest của Prisma trả 8.0.0-rc.15: đây là prerelease và KHÔNG tự chọn để production. Cần chọn nhánh stable và kiểm tra hỗ trợ Node/database khi cài.

Expo SDK 57 dùng React Native 0.86 và React 19.2 theo changelog chính thức, nên React Native 0.87.1 từ registry không tự động là lựa chọn đúng cho Mobile. Phiên bản TypeScript/decorator và Prisma/NestJS phải qua build/contract test trước khi chốt lockfile.

## Tiêu chuẩn code có thể kiểm chứng

1. TypeScript strict; validation tại đầu vào; quy ước lỗi, pagination và thời gian thống nhất.
2. Backend chia module auth, sites, workforce, shifts, attendance, visitors, safety, zones, work-management, iot; thêm module khi có use case. Controller xử lý HTTP, service/use case xử lý nghiệp vụ; dữ liệu không bị truy cập xuyên module tùy tiện.
3. Phân quyền theo role VÀ Site/Contractor/Zone; kiểm tra phía Backend cho từng tài nguyên. Kiểm thử truy cập chéo phạm vi.
4. Transaction cho thay đổi cần nguyên tử; event AI có idempotency; retry có giới hạn. Ghi audit cho quyết định nghiệp vụ quan trọng.
5. UI tổ chức theo feature; server state qua Query; state dùng chung chỉ thêm khi cần. Share contract/API client, không ép share component native với DOM.
6. Unit test nghiệp vụ, integration test database/API và E2E luồng trọng yếu; CI lint/typecheck/test/build, kiểm tra dependency. Không coi kiểm tra whitespace hiện có là CI ứng dụng đầy đủ.
7. Secret ngoài Git; database migration được version hóa; dữ liệu giả cho test; log có correlation ID và loại dữ liệu nhạy cảm.
8. Healthcheck, image có version/digest, smoke test môi trường triển khai, backup và cách restore/rollback được kiểm chứng.

Không có chứng nhận enterprise chỉ từ cấu trúc thư mục. Phải đánh giá các tiêu chuẩn này trên code và hệ thống chạy thật. Redis/queue hoặc thêm microservice chỉ bổ sung khi có use case, tải hoặc độ tin cậy đòi hỏi.

## Nguồn kiểm tra

- [Node release và LTS](https://nodejs.org/en/about/previous-releases)
- [Expo SDK 57 và bộ phiên bản Mobile](https://expo.dev/changelog/sdk-57)
- [NestJS](https://docs.nestjs.com/) và [OpenAPI](https://docs.nestjs.com/openapi/introduction)
- [Vite](https://vite.dev/guide/), [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview), [shadcn/ui](https://ui.shadcn.com/docs)
- [FastAPI](https://fastapi.tiangolo.com/), [Ultralytics](https://docs.ultralytics.com/), [Playwright](https://playwright.dev/docs/intro)
- npm registry endpoints `https://registry.npmjs.org/<package>/latest` cho snapshot phiên bản; dữ liệu chưa chứng minh toàn bộ stack tương thích hoặc thị phần sử dụng.
