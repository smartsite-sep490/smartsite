# Research stack và cách chia module SmartSite

Ngày: 18/09/2026. Trạng thái: đề xuất sau đối chiếu tài liệu chính thức; chưa kiểm chứng bằng build toàn hệ thống. Không thay đổi các quyết định đã chốt: React Native, Neon PostgreSQL, TanStack Query, OpenAI API trong sản phẩm, hai repo và giữ nhánh sau merge.

## Kết luận đề xuất

Giữ Web React/TypeScript/Vite, Backend NestJS modular monolith, Mobile React Native/Expo development build. Dùng pnpm workspaces; Turborepo điều phối lint/test/build. Neon PostgreSQL và TypeORM Data Mapper cho dữ liệu. TanStack Query là lớp server state duy nhất. AI camera chạy ở repo riêng theo FastAPI/YOLO11/ArcFace trong docs; vai trò OpenAI cần chốt use case.

Chọn Vite vì yêu cầu hiện là dashboard gọi Backend riêng. Next.js là phương án khi có nhu cầu SSR/SEO cụ thể. Tầng dữ liệu sử dụng TypeORM Data Mapper (@nestjs/typeorm, typeorm) và pg, synchronize: false, quản lý chặt chẽ schema bằng reviewed migrations. Không đổi NestJS sang hệ khác chỉ theo độ mới.

## Kết quả có ảnh hưởng đến thiết kế

| Kiểm tra                           | Kết quả                                                                           | Quyết định thiết kế đề xuất                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Expo monorepo                      | Hỗ trợ workspaces/pnpm, Metro có cấu hình tự động; dependency trùng vẫn cần xử lý | Mỗi app khai báo dependency riêng, dùng workspace packages có phạm vi hẹp                        |
| Expo native                        | Development build cho phép dùng native library/cấu hình riêng                     | Dùng development build, kiểm thử Android/iOS thực tế                                             |
| TanStack Query trên Mobile         | Có hướng dẫn kết nối onlineManager/focusManager với native events                 | Cấu hình mạng và AppState; phân biệt app focus với screen focus                                  |
| NestJS module                      | Provider được đóng gói và chia sẻ bằng exports/imports                            | Module nghiệp vụ chỉ xuất các service công khai cần dùng                                         |
| Neon pooling                       | Transaction pooling khác kết nối direct                                           | Runtime pooled có giới hạn pool; migration/admin dùng direct; kiểm thử với ORM phiên bản đã chọn |
| TypeORM runtime                    | Hỗ trợ TypeORM 0.3.x với NestJS 12 qua @nestjs/typeorm và pg driver               | Chọn TypeORM Data Mapper, kiểm tra synchronize: false                                            |
| YOLO11                             | Model detection mặc định được huấn luyện trên COCO                                | Cần weights/dataset PPE riêng và đánh giá thực nghiệm                                            |
| ArcFace triển khai qua InsightFace | License code và pretrained weights khác nhau                                      | Chốt artifact, nguồn, điều kiện sử dụng; không suy từ MIT code sang mọi weights                  |

Docs monorepo hiện có ví dụ SDK 58 trong khi snapshot npm trước đó trả Expo 57.0.23. Không lấy ví dụ docs hoặc nhãn latest đơn lẻ làm bằng chứng bộ phiên bản đã ổn định. Chốt release/peer dependencies/lockfile tại thời điểm scaffold và kiểm tra build. Các con số trong stack-proposal chỉ là snapshot.

## Cấu trúc để dễ làm

```text
smartsite/
  apps/
    web/src/{app,features,shared}/
    mobile/{app,src/features,src/shared}/
    backend/src/{modules,platform}/
  packages/
    api-client/       Client sinh từ OpenAPI, không chứa ORM model
    config-eslint/
    config-typescript/
  contracts/         Schema/event Backend–AI có version
  docs/
  infra/
```

Chỉ tạo package dùng chung khi có ít nhất hai nơi thực sự dùng. Không dùng shared như kho chứa nghiệp vụ lẫn lộn. Web DOM và Mobile native giữ component riêng; có thể share kiểu API và logic thuần tương thích.

Backend chia theo nghiệp vụ: identity-access, sites, contractors, workforce, scheduling, attendance, visitors, safety, work-management, iot. Camera và zone configuration có thể bắt đầu trong sites, tách khi trách nhiệm lớn. OpenAI integration nằm sau một adapter riêng; không trộn prompt vào controller.

Ví dụ một module ban đầu:

```text
modules/safety/
  safety.module.ts
  alerts.controller.ts
  alerts.service.ts
  alerts.repository.ts
  dto/
  policies/
  tests/
```

Controller xử lý transport; service/use case xử lý nghiệp vụ; repository chứa truy vấn. Không tạo generic BaseRepository hoặc bốn tầng interface cho mọi CRUD. Khi approve/close/reopen trở nên phức tạp, tách use case theo hành động. Module khác gọi public service, không import repository nội bộ. Kiểm tra vòng phụ thuộc bằng lint/architecture checks khi có code.

Web feature ví dụ safety có api/, hooks/, components/, pages/; form ở component/React Hook Form, query keys và mutation theo feature. Cache key bao gồm phạm vi Site và filter; xóa/invalidate cache khi đổi phiên hoặc thay quyền để tránh hiển thị dữ liệu cũ sai phạm vi.

AI repo chia camera_input/, detection/, tracking/, identity/, zone_geometry/, event_delivery/, api/. Worker video có vòng đời riêng với HTTP server; model không load lại mỗi request. Track ID không phải Worker ID. Backend chịu trách nhiệm quyền Zone và trạng thái alert/incident; OpenAI lỗi/timeout không làm dừng camera hoặc tự phê duyệt sự cố.

## Điều kiện trước khi gọi source là sẵn sàng production

- Lint/typecheck/build và kiểm thử chạy trong CI bằng lockfile; app chưa có nên CI hiện tại chưa chứng minh điều này.
- Integration test trên PostgreSQL; kiểm thử role + Site/Contractor/Zone, dữ liệu chéo phạm vi và thu hồi phiên.
- Transaction cho thao tác nguyên tử; idempotency event AI; retry giới hạn và audit quyết định quan trọng.
- API/schema có version, test producer/consumer; dữ liệu mẫu giả hỗ trợ làm Web/BE không cần GPU.
- Migration có kiểm soát, secrets ngoài client/Git; log JSON/correlation ID, healthcheck/readiness, backup/restore và rollback được thử.
- Một thành viên khác dựng được từ checkout mới theo README.

Auth/session cần thiết kế riêng theo yêu cầu khóa tài khoản thu hồi phiên ngay; JWT tự nó chưa đáp ứng yêu cầu này. Không mặc định mọi token đã cấp sẽ mất hiệu lực khi khóa user. Hosting, camera/GPU, ngân sách OpenAI và chức năng OpenAI vẫn là quyết định mở, không thể giải quyết chỉ bằng chọn library.

## Nguồn chính thức đã đọc

- https://docs.expo.dev/guides/monorepos/
- https://docs.expo.dev/develop/development-builds/introduction/
- https://tanstack.com/query/latest/docs/framework/react/react-native
- https://docs.nestjs.com/modules
- https://docs.nestjs.com/security/authentication
- https://neon.com/docs/connect/connection-pooling
- https://typeorm.io/
- https://docs.ultralytics.com/models/yolo11/
- https://docs.ultralytics.com/datasets/detect/construction-ppe/
- https://github.com/deepinsight/insightface#license

Neon/TypeORM được đối chiếu tài liệu chính thức. Research không phải benchmark, kiểm thử tương thích hoặc số liệu thị phần. Chưa cài hoặc tạo ứng dụng trong lượt này.
