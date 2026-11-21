# Kiểm thử luồng hồ sơ công nhân

Phạm vi MF01: đại diện nhà thầu nộp và bổ sung; công nhân chỉ xem; Safety duyệt từng giấy.
Dùng giấy tờ tổng hợp có chữ “DỮ LIỆU KIỂM THỬ”, không dùng CCCD hoặc giấy tờ thật.

## Cấu hình và thứ tự phát hành

1. Chạy các migration hiện có và WorkerDocumentReviewWorkflow1795478400000 trước backend mới.
   Migration thêm safety_card_required mặc định true và version mặc định 1; giữ ai_analysis và lịch sử.
2. Phát hành Backend, Web và Mobile đồng bộ. API tải từng giấy và sửa ngày trực tiếp đã được thay
   bằng document-submissions; ứng dụng Mobile cũ cần cập nhật trước khi nộp giấy.
3. Giữ cấu hình Python, Tesseract (vie + eng), Poppler (pdfinfo, pdftotext, pdftoppm) như hiện có.
4. Đặt OPENAI_API_KEY bằng secret phía server. WORKER_DOCUMENT_OPENAI_MODEL giữ mặc định gpt-4.1-mini;
   đổi bằng ID model hỗ trợ ảnh/PDF và Structured Outputs. WORKER_DOCUMENT_OPENAI_TIMEOUT_MS mặc định
   30000; client chờ 40000 ms, không tự retry. Tăng timeout server trên 40000 không tăng thời gian chờ client.
5. Không cần Cloud Tasks, Cloud Scheduler, worker AI hay bảng công việc mới. Không tự gọi AI khi nộp.

Rollback ứng dụng phải phối hợp cả ba client/server. Không rollback migration sau khi đã có
khai báo thẻ tùy chọn mà chưa đánh giá việc mất các giá trị khai báo và phiên bản.

## Kịch bản trên Web

1. Đăng nhập đại diện nhà thầu, mở **Đăng ký công nhân** (/worker-onboarding), chọn công trường.
   Nhập thông tin, hai mặt CCCD giả lập, chọn rõ Có/Không cần thẻ nhóm 3.
2. Chọn Không, nộp giấy khám sức khỏe và bảo hiểm lao động. Chọn Có thì thêm thẻ.
   File JPEG/PNG/PDF tối đa 5 MiB; PDF tối đa bốn trang; CCCD chỉ nhận ảnh.
   Ngày khám/cấp của giấy khám và ngày hết hạn của bảo hiểm/thẻ được khai bắt buộc.
3. Kiểm tra gợi ý OCR, sửa ngày, rồi bấm **Gửi hồ sơ**. Sửa ngày không gửi lại file để OCR.
   File hỏng/vượt giới hạn bị chặn. Ảnh mờ, không đọc rõ, lệch ngày/CCCD hoặc hết hạn chỉ cảnh báo.
   Nếu OCR bận nhưng file đã kiểm tra mở được, vẫn gửi với ngày nhập tay.
4. Hồ sơ vào Chờ duyệt, chưa được tự duyệt và chưa có cuộc gọi AI.
   Nếu bước nộp lỗi sau tạo tài khoản, giao diện báo tài khoản đã tạo. Thử lại tiếp tục công nhân đó.
5. Đăng nhập Safety cùng công trường, mở **Hồ sơ công nhân** (/worker-documents).
   Tick một số hồ sơ hoặc chọn cả trang, kiểm tra số giấy rồi bấm **Quét nhanh bằng AI**.
   Chỉ giấy hiện tại đang chờ duyệt được quét; giấy đã có kết quả thành công được dùng lại.
6. Kiểm tra Đang quét, tiến độ và ba kết quả:
   **Chưa phát hiện điểm lệch**, **Cần chú ý**, **Chưa đủ thông tin**.
   Cảnh báo vẫn kèm số giấy chưa có kết quả. Kết quả thuận lợi không có nghĩa là Đã duyệt.
7. Bấm Dừng: lượt đang chạy được hoàn tất, các lượt chưa bắt đầu không được gửi.
   Đổi công trường/bộ lọc/trang xóa lựa chọn; rời màn hình không tiếp tục gửi các lượt sau.
8. Mở bản gốc, đóng bằng Escape hoặc nút đóng. Xem đối chiếu loại giấy, ngày và CCCD bên ngoài
   bản xem. Thử lại giấy AI lỗi ở chi tiết hồ sơ hoặc chọn lại trên hàng chờ.
9. Từ chối một giấy với lý do. Đại diện nhận thông báo và mở đúng công nhân, thấy lý do,
   chỉ chọn giấy cần thay rồi **Gửi hồ sơ**. Bản bị từ chối vẫn nằm trong lịch sử.
10. Safety mở bản thay thế, xác nhận ngày/bản gốc và duyệt từng giấy.
    Hai giấy hợp lệ đủ khi Không cần thẻ; Có cần thẻ thì thẻ cũng phải được duyệt và còn hạn.
    Gia hạn đang chờ hoặc bị từ chối không vô hiệu giấy cũ đang được duyệt và còn hạn.

## Quyền và Mobile

- Công nhân mở hồ sơ để xem trạng thái, bản gốc và thông báo; không có nút nộp/sửa.
  Gọi API nộp bằng tài khoản công nhân phải bị backend từ chối.
- Đại diện nhà thầu khác hoặc Safety công trường khác không đọc được hồ sơ/kết quả AI.
  Mất quyền hoặc logout trong lúc file đang xử lý phải ngăn lưu cả bộ và dọn file mới.
- Mobile đại diện: đăng ký và gửi cả bộ; mở hồ sơ để bổ sung/gia hạn. Mobile công nhân chỉ xem.
  Ngày khai báo hiển thị riêng với ngày chính thức. Safety dùng Web responsive trên điện thoại.
- Sửa cùng hồ sơ ở hai cửa sổ: lượt dựa trên phiên bản cũ nhận xung đột; tải lại bản nháp trước khi gửi.
- Lặp cùng requestId và nội dung trả biên nhận cũ; không tạo giấy, thông báo hoặc cuộc gọi AI mới.

## Kiểm tra tự động

Các test tự động giả lập OpenAI và dùng dữ liệu tổng hợp; không dùng API trả phí.

    pnpm install --frozen-lockfile
    pnpm peers check
    pnpm check
    EXPO_OFFLINE=1 pnpm --filter @smartsite/mobile check:dependencies
    pnpm test:ocr
    TEST_DATABASE_URL=<PostgreSQL test cục bộ> pnpm --filter @smartsite/backend test:integration
    pnpm --filter @smartsite/web exec playwright test worker-document-workflow.e2e.ts

Trên PowerShell, đặt biến môi trường bằng $env:EXPO_OFFLINE và $env:TEST_DATABASE_URL.
PostgreSQL test phải dùng database/user smartsite_test trên localhost:5433, tách database runtime.
Playwright kiểm thử giao diện thật với API giả lập, lưu ảnh desktop và điện thoại trong test-results.
Các test PostgreSQL kiểm tra transaction, version, replay, quyền, lease AI và nhắc hạn trên dữ liệu thật.

Khi Docker sẵn sàng, chạy Compose build/readiness theo .github/workflows/application-checks.yml.
Cần kiểm tra riêng bằng thiết bị Mobile và OpenAI thật trên giấy mẫu được phép trước khi phát hành.

## Kết quả kiểm chứng cục bộ ngày 21/11/2026

- `pnpm install --frozen-lockfile`, `pnpm peers check` và `pnpm check`: đạt.
  Đã chạy lại `pnpm check` sau khi cập nhật nhánh theo `origin/main` tại `6c2ff6ed`.
  `pnpm check` bao gồm lint, typecheck, test và build; Web build và Mobile export Android/iOS đạt.
- Web: 1.149 test đạt, bốn test HTTP có điều kiện được bỏ qua theo cấu hình có sẵn.
  Backend: 833; shared contracts: 259; API client: 257; Mobile: 167; scripts: 24 test đạt.
- PostgreSQL 18.7 cục bộ: 644 test integration đạt, gồm migration lên/xuống, không có schema drift,
  transaction, quyền bị thu hồi, idempotency, xung đột phiên bản và lease AI. Database test đã dừng.
- OCR helper: 13 test đạt với fixture tổng hợp và giả lập Tesseract/Poppler.
- Playwright: ba kịch bản đạt trên desktop 1440 px và điện thoại 390/360 px với API giả lập.
- Mobile dependency check đạt khi đặt `EXPO_OFFLINE=1`, dùng danh sách tương thích SDK đã ghim.
- Prettier cho file thay đổi và `git diff --check`: đạt. Không thay lockfile hoặc thêm runtime dependency.

Docker daemon không phản hồi nên Compose build/readiness chưa được xác minh. Chưa chạy Tesseract/Poppler
thật trên máy này, OpenAI trả phí hoặc thiết bị Mobile thật. Không nộp giấy, sửa dữ liệu hay chạy migration
trên production. Cần review của người phụ trách trước khi phát hành đồng bộ Backend/Web/Mobile.
