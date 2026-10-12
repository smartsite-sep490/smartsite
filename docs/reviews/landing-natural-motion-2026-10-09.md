# Landing cinematic — 2026-10-09

Theo yêu cầu, giữ video hiện tại và chuyển từ seek theo scroll sang phát tự nhiên khi nằm trong vùng nhìn. Scroll chỉ điều khiển chữ/lớp phủ và transform của stage; video pause khi ra ngoài vùng nhìn hoặc tab bị ẩn. Người dùng có thể Pause/Play; autoplay bị chặn có thao tác Play, lỗi tải có poster và Retry. Reduced motion dùng ảnh tĩnh, không pin hoặc tải video.

Khoảng pin giảm từ 14 viewport xuống 4 trên desktop, 2,5 dưới 768px. Timeline chữ có scrub 0,55 giây với ba chặng Workforce & access, Safety & evidence, Operations & review. Giữ route, navigation, brand và video `/smartsite-journey.mp4`; không thêm dependency.

## Kiểm tra

- 7 test của cinematic đạt: tải gần viewport, playback không ghi currentTime, pause/visibility, autoplay denied, retry, desktop/mobile distance và reduced motion.
- Toàn Web: 354/354 test, 41 file; Web TypeScript/build, lint các file cinematic, frozen install offline, peer check và Mobile dependency check đạt.
- `pnpm check` toàn workspace chưa đạt trong lần này: lượt đầu mất file `.test-build` giữa lúc test Backend chạy; lượt sau lint quét thư mục build tạm `.test-build-contractor-review` của công việc song song và báo 147 lỗi trong JS đã compile. Người dùng xác nhận chat MF07 đang làm việc song song. Không sửa/xóa artifact của chat đó hoặc đánh dấu quality gate toàn repo đạt.
- Browser kiểm tra desktop và viewport hẹp: video tự tiến khi không cuộn; Pause giữ currentTime 11,296168 trong khi scroll tiếp tục đổi chữ; viewport 375px không tràn ngang. Kiểm tra bản build tĩnh riêng để tránh hot reload từ các file đang sửa song song.
- Docker Web build đạt; cập nhật riêng Web, container healthy, `/healthz` HTTP 200; trình duyệt ở cổng 5173 xác minh video phát tự nhiên và lớp chữ mới.

Đây là kiểm tra chức năng và bố cục trên trình duyệt desktop với viewport hẹp, chưa phải benchmark FPS toàn trang hoặc kiểm tra điện thoại thật. Video gốc vẫn 24fps. Chưa commit/merge hay có review của thành viên khác.
