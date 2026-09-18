import { useQuery } from '@tanstack/react-query';
import { getBackendHealth } from '@smartsite/api-client';

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function App() {
  const health = useQuery({
    queryKey: ['backend', apiUrl, 'health'],
    queryFn: ({ signal }) => getBackendHealth(apiUrl, { signal }),
  });

  const status = health.isPending
    ? 'Đang kiểm tra kết nối'
    : health.isError
      ? 'Chưa kết nối được Backend'
      : 'Backend đang hoạt động';

  return (
    <div className="shell">
      <header className="header">
        <a className="brand" href="/" aria-label="SmartSite, trang chủ">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          SmartSite
        </a>
        <span className="environment">Môi trường phát triển</span>
      </header>
      <main>
        <p className="eyebrow">SMARTSITE / KHỞI TẠO DỰ ÁN</p>
        <h1>
          Nền tảng cho một
          <br />
          công trường an toàn hơn.
        </h1>
        <p className="intro">
          Bộ khung ứng dụng đã sẵn sàng để phát triển. Bắt đầu với luồng giám sát PPE, sau đó kết
          nối camera và kiểm tra quyền vào khu vực.
        </p>

        <section className="connection" aria-labelledby="connection-heading">
          <div>
            <h2 id="connection-heading">Kết nối hệ thống</h2>
            <p className="status" role="status" aria-live="polite">
              <span className={`dot ${health.isSuccess ? 'online' : ''}`} aria-hidden="true" />
              {status}
            </p>
            <p className="hint">
              {health.isError
                ? 'Kiểm tra Backend đã chạy và địa chỉ API trong cấu hình môi trường.'
                : 'Kiểm tra này xác nhận API phản hồi; không xác nhận camera hoặc database đã sẵn sàng.'}
            </p>
          </div>
          <button type="button" disabled={health.isFetching} onClick={() => void health.refetch()}>
            {health.isFetching ? 'Đang kiểm tra…' : 'Kiểm tra lại'}
          </button>
        </section>

        <section className="milestones" aria-label="Phạm vi phát triển tiếp theo">
          <article>
            <span className="number">05</span>
            <h2>Giám sát PPE</h2>
            <p>
              Phát hiện dấu hiệu thiếu trang bị bảo hộ và lưu bằng chứng để cán bộ an toàn xác minh.
            </p>
            <span className="phase">Chưa triển khai nghiệp vụ</span>
          </article>
          <article>
            <span className="number">06</span>
            <h2>Kiểm soát khu vực</h2>
            <p>Theo dõi người vào vùng và đối chiếu quyền. Danh tính chưa rõ được xử lý riêng.</p>
            <span className="phase">Chưa triển khai nghiệp vụ</span>
          </article>
        </section>
      </main>
      <footer>
        SmartSite · SEP490 <span>Phiên bản nền dự án</span>
      </footer>
    </div>
  );
}
