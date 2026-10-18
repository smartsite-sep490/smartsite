# MF06 — ví dụ contract cho ghép UI

Hai JSON được giữ nguyên byte từ gói Backend v4 của Tuấn và kiểm lại bằng parser hiện tại trong [canonical contract](../../../contracts/src/mf06-assessment-api.ts).

- [Assessment UNAVAILABLE](mf06-unavailable-assessment.json): outcome và provenance đều không khẳng định danh tính/quyền truy cập.
- [Request NOT_QUEUED](mf06-not-queued-request.json): processing state độc lập với outcome.

Đây là **hai ví dụ độc lập**, dùng UUID/time synthetic. Chúng không chứng minh có request/job/assessment liên kết trong DB. Không seed production, không sửa provenance để biến ví dụ thành trusted evidence.

UI dùng các parser `parseMf06AssessmentResponse`, `parseMf06AssessmentPage`, `parseMf06RequestStatusResponse`, `parseMf06RequestStatusPage` từ `@smartsite/contracts/mf06-assessments`; không tạo DTO riêng. Cả hai ví dụ đã parse thành công và parser từ chối trường thừa.

API thật vẫn quyết định authentication, Site scope, record tồn tại, feature availability và provenance. Tham khảo [báo cáo Backend](../../operations/mf05-mf06-tuan-backend-report.md) và các HTTP integration test trong repo để ghép journey đầy đủ.
