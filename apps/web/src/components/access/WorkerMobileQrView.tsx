import { useMemo, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { QrPassCard } from './QrPassCard';
export function WorkerMobileQrView({
  apiUrl,
  token,
  siteId,
  workerName,
}: {
  apiUrl: string;
  token: string;
  siteId: string;
  workerName: string;
}) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const [fallbackId, setFallbackId] = useState('');
  const pass = useMutation({ mutationFn: (id: string) => client.issueWorkerQr(token, siteId, id) });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    pass.mutate(fallbackId.trim());
  };
  return (
    <section className="mx-auto max-w-lg space-y-4 rounded-2xl border bg-white p-6">
      <h2 className="text-xl font-bold">QR dự phòng · {workerName}</h2>
      <p>
        Khi camera lỗi hoặc nhận diện không kết luận được, nhập mã phiên bảo vệ cấp để nhận QR của
        bạn tại site này.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          Mã phiên từ bảo vệ
          <input
            required
            value={fallbackId}
            onChange={(e) => {
              setFallbackId(e.target.value);
              pass.reset();
            }}
            className="mt-1 w-full rounded-lg border p-2"
            placeholder="Mã phiên UUID"
          />
        </label>
        <button
          disabled={pass.isPending}
          className="rounded-lg bg-orange-600 p-3 text-white disabled:opacity-50"
        >
          {pass.isPending ? 'Đang lấy QR…' : 'Lấy QR của tôi'}
        </button>
      </form>
      {pass.error && (
        <p role="alert" className="text-red-700">
          {pass.error.message}
        </p>
      )}
      {pass.data && !pass.isPending && !pass.error && (
        <QrPassCard pass={pass.data} onRefresh={() => pass.mutate(fallbackId.trim())} />
      )}
      <p className="text-xs text-amber-800">
        Backend vẫn kiểm tra quyền cổng, trạng thái worker và nhà thầu trước khi cho phép IN/OUT.
      </p>
    </section>
  );
}
