# Stack và tiêu chuẩn code — đề xuất 18/09/2026

Đã chốt: React Native, database PostgreSQL tại Supabase, có OpenAI API chạy trong SmartSite, hai repo smartsite/smartsite-ai, giữ nhánh sau merge. Người dùng ưu tiên Redux; đề xuất cụ thể Redux Toolkit + RTK Query. Vai trò/use case OpenAI chưa chốt.
Các lựa chọn còn lại bên dưới là đề xuất để chốt, chưa phải phần mềm đã cài hoặc kiểm chứng tích hợp.

## Phương án đề xuất

| Phần | Lựa chọn | Mục đích |
|---|---|---|
| Web | React + TypeScript + Vite | Dashboard nghiệp vụ gọi Backend riêng |
| Web UI | Tailwind CSS + shadcn/ui | Component và token giao diện có thể tùy chỉnh |
| Dữ liệu/form Web | Redux Toolkit + RTK Query, React Hook Form, Zod; React Router | Quản lý server state, form, validation và routing |
| Mobile | React Native + Expo development build + Expo Router | Tận dụng TypeScript, quản lý native dependencies theo SDK |
| Backend | NestJS + TypeScript; modular monolith | Module theo nghiệp vụ, triển khai một API trước |
| Database | Supabase PostgreSQL; Prisma stable là ORM đề xuất | Database host tại Supabase; auth/storage là quyết định riêng |
| AI | Python + FastAPI + YOLO11/ArcFace theo docs; OpenAI API bổ sung | PPE/identity cần kiểm chứng; vai trò OpenAI chưa chốt |
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

## Đối chiếu AI và cập nhật 18/09/2026

Nguồn: bản xuất Report2 và ChucNang ngày 17/09/2026 trong workspace tham khảo, không phải lần đọc Drive trực tiếp mới.

- Report2 phần training ghi YOLO11, ArcFace và evaluation; mục 6.3 ghi ReactJS, ReactNative, NestJS; Supabase/PostgreSQL và R2.
- FR83 ghi YOLO11 phát hiện thiếu mũ/áo phản quang. FR81–82 ghi face embedding và nhận diện; FR84 ghi người vào Zone, nhận diện và Backend đối soát quyền. NFR12 ghi FastAPI + YOLO11/ArcFace chạy container riêng với NestJS + PostgreSQL.
- Bản đề xuất trước chỉ ghi PyTorch/OpenCV nên chưa diễn đạt đủ lựa chọn model trong docs. Đây vẫn là scaffold, chưa triển khai pipeline AI.
- OpenAI API chạy trong sản phẩm là yêu cầu mới do người dùng xác nhận. Đề xuất kết hợp: pipeline camera tạo sự kiện; OpenAI hỗ trợ mô tả/tóm tắt sự kiện hoặc báo cáo khi nhóm chốt use case. Không coi model ngôn ngữ là nguồn quyết định danh tính/quyền Zone.
- Nếu muốn OpenAI thay YOLO/ArcFace, đó là thay đổi kiến trúc cần sửa FR/NFR và đo độ trễ, chi phí, chất lượng trước khi chốt.
- Supabase là PostgreSQL được quản lý, không loại bỏ NestJS. Đề xuất thao tác nghiệp vụ đi qua Backend; secrets/service role không đưa vào Web/Mobile. Chưa chốt Supabase Auth/Storage hay thay Cloudflare R2.
- Redux Toolkit cho shared client state, RTK Query cho API/cache; state cục bộ ở component/form. Bỏ TanStack Query khỏi đề xuất mặc định để tránh hai lớp cache cùng trách nhiệm.

Nguồn bổ sung: https://redux.js.org/introduction/why-rtk-is-redux-today ; https://redux-toolkit.js.org/rtk-query/overview ; https://supabase.com/docs/guides/database/overview ; https://developers.openai.com/api/docs/guides/images-vision .
