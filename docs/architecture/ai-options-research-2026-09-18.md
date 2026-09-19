# AI camera — rà lại lựa chọn ngoài docs

Ngày 18/09/2026. Người dùng cho phép thay FastAPI/YOLO11/ArcFace nếu có phương án phù hợp hơn. Đây là research từ nguồn chính thức, chưa phải benchmark trên phần cứng/dữ liệu SmartSite. Tài liệu này thay giả định phải giữ model chỉ vì đã ghi trong Report 2/NFR12.

**Quyết định 19/09/2026:** chốt YOLO11s làm baseline triển khai cho MF05/MF06 vì mức độ ổn định, tài liệu và đường xuất ONNX/TensorRT phù hợp tiến độ nhóm. RF-DETR Nano/Small và YOLO26s chỉ là đối chứng benchmark tùy chọn; chưa model nào được phép tuyên bố đạt yêu cầu trước khi đo trên dữ liệu SmartSite. Quyết định này thay khuyến nghị YOLO26-first ở bản research ban đầu.

## Tách các lớp cần chọn

- API/control: FastAPI là framework HTTP, không phải mô hình AI hoặc engine xử lý video.
- Video runtime: lấy frame, reconnect, sampling, backpressure, inference, theo dõi và gửi sự kiện.
- Detector PPE/person: YOLO11s là baseline; RF-DETR Nano/Small và YOLO26s là đối chứng tùy chọn.
- Tracking/Zone: tracking ID, polygon, dwell time và debounce; không cung cấp danh tính Worker.
- Identity: định danh có căn cứ, có unknown; liên kết identity với track phải được kiểm chứng riêng.
- Backend: quyết định quyền người/Site/Zone/thời gian và xử lý cảnh báo/incident.
- OpenAI: đã chốt có trong sản phẩm; use case vẫn mở, không tự coi thay detector/identity.

## Các phương án đáng thử

| Phương án | Hỗ trợ sẵn | Đánh đổi / giới hạn | Đánh giá cho SmartSite |
|---|---|---|---|
| Ultralytics YOLO11s + Supervision | Train/export/inference; polygon và công cụ theo dõi | Cần weights PPE phù hợp; AGPL-3.0 hoặc Enterprise khi phát hành đóng/thương mại; code xử lý video/event | Baseline triển khai đã chốt |
| RF-DETR Nano/Small + Supervision | Fine-tune, detection và hệ công cụ Roboflow | Phải đo RAM/VRAM/latency; không suy benchmark hãng sang camera dự án | Đối chứng tùy chọn với YOLO11s |
| Ultralytics YOLO26s + Supervision | Cùng hệ công cụ Ultralytics, kiến trúc mới hơn | Chưa có bằng chứng tốt hơn trên dữ liệu SmartSite; cùng ràng buộc giấy phép Ultralytics | Đối chứng tùy chọn, không chặn triển khai |
| Roboflow Workflows + Inference | Ghép block bằng giao diện; chạy cloud hoặc self-host; ảnh/video/RTSP | Kiểm tra plan/license từng chức năng, dataset privacy, khả năng export và retry | Hợp khi ưu tiên dựng pipeline nhanh, ít code tích hợp |
| NVIDIA DeepStream | Pipeline video/inference/tracking đa luồng trên hệ NVIDIA | Phụ thuộc phần cứng/runtime; cần học GStreamer/plugin | Xem xét khi có nhiều camera và GPU phù hợp |
| AWS Rekognition | API PPE và face collection có sẵn | PPE API chỉ liệt kê face/hand/head cover, chưa đáp ứng áo phản quang; phụ thuộc mạng/API | Không chọn làm giải pháp trọn gói MF05 |

YOLO26 đã phát hành; YOLO27 trên docs đang là preview chưa phát hành. Không chọn preview vì số phiên bản cao hơn. Benchmark CPU/COCO do nhà cung cấp công bố không chứng minh precision PPE hoặc FPS toàn pipeline của SmartSite.

RF-DETR detection N/S/M/L hiện được liệt kê Apache 2.0; các bản XL/2XL detection thuộc PML 1.0. Không gán cùng license cho mọi variant hoặc mọi sản phẩm Roboflow.

## Phần MF06 cần quyết định riêng

Supervision PolygonZone hỗ trợ xác định detection nằm trong polygon bằng anchor cấu hình; bottom-center là mặc định. Góc camera, che chân, mép polygon và rung detection cần bài thử riêng.

Tracking ID có thể đổi sau che khuất/reconnect, không phải Worker ID. Re-identification quần áo cũng không đủ để khẳng định danh tính. Thay detector mạnh hơn không tự giải quyết quyền vào.

Các hướng identity để đánh giá:

1. InsightFace/ArcFace self-host: kiểm soát inference, phải chọn bộ face detector/alignment/embedding, threshold, chất lượng ảnh và dữ liệu đăng ký. InsightFace Server có REST/UI giúp giảm công tích hợp; xem rõ phạm vi runtime và model hỗ trợ trước khi dùng.
2. AWS Rekognition face collection: giảm phần tự vận hành face search nhưng cần tài khoản, quyền dịch vụ, chi phí và đường truyền; vẫn phải xử lý chất lượng ảnh và match sai/unknown.
3. Điểm vào Zone có camera gần/credential như QR hoặc thẻ: có thể giảm khó khăn định danh nếu quy trình cho phép. Đây là thay đổi thiết kế cần nhóm chốt; không tự bỏ yêu cầu người được phép/người bị cấm. Không gán một lần quét thẻ cho track ở xa thiếu căn cứ.

Code InsightFace có MIT nhưng public pretrained models được công bố cho non-commercial research. Cần kiểm tra artifact cụ thể trước khi chọn cách phát hành; không đánh đồng license code/model. Chưa chọn identity provider cuối.

## Phương án khuyến nghị có điều kiện

Triển khai proof of concept Python + YOLO11s + Supervision; FastAPI giữ API/control cho tích hợp riêng. Có thể so sánh RF-DETR Nano/Small hoặc YOLO26s trên cùng tập dữ liệu PPE sau khi baseline chạy được. Chỉ đổi baseline khi đối chứng cải thiện chất lượng hoặc tổng công vận hành thực tế. Không lắp tất cả các nền tảng cùng lúc.

## Cách chốt bằng bằng chứng

Người dùng xác nhận dự kiến khoảng 1–3 camera, GPU NVIDIA RTX 4060. Chưa xác định desktop/laptop, VRAM, CPU, độ phân giải, FPS và ngân sách. Ưu tiên thử local GPU; chưa khẳng định đáp ứng đồng thời 3 camera. Kế hoạch đề xuất:

- Dùng clip cùng điều kiện, đủ ca đủ/thiếu mũ/áo, che khuất, xa/gần và người ngoài vùng; giữ tập test độc lập theo clip/camera, không chia ngẫu nhiên frame gần nhau gây rò rỉ.
- Fine-tune các detector trên cùng tập train, đánh giá cả gán PPE đúng người và kết luận thiếu/unknown, không chỉ mAP bbox.
- Đo precision/recall theo PPE, bỏ sót và báo giả theo sự kiện, false alerts mỗi camera-giờ, p95 độ trễ đầu-cuối, FPS xử lý, RAM/VRAM và thời gian reconnect.
- MF06 đo phát hiện vào/ra Zone, ID switch, tỷ lệ gán danh tính sai/unknown, allowed/denied/unknown và thay đổi quyền theo thời gian.
- Tính chi phí cloud theo số ảnh/frame thực gửi mỗi tháng; compute/video decoding, storage và API là các khoản riêng. Không có giá hoặc SLA đã chốt ở research này.
- Model/phần cứng chỉ được chốt sau khi so kết quả với tiêu chí nghiệp vụ và NFR được nhóm thống nhất. Chưa chạy thử hay gửi hình ảnh thực lên nhà cung cấp.

## Nguồn chính thức

- https://docs.ultralytics.com/models/yolo26
- https://docs.ultralytics.com/models/yolo11
- https://www.ultralytics.com/license
- https://github.com/roboflow/rf-detr
- https://docs.roboflow.com/workflows
- https://supervision.roboflow.com/latest/detection/tools/polygon_zone/
- https://docs.nvidia.com/metropolis/deepstream/9.0/text/DS_Overview.html
- https://docs.aws.amazon.com/rekognition/latest/APIReference/API_DetectProtectiveEquipment.html
- https://docs.aws.amazon.com/rekognition/latest/dg/collections.html
- https://github.com/deepinsight/insightface#license
- https://github.com/deepinsight/insightface/blob/master/server/README.md
