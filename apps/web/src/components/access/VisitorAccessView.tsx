import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { VisitorGateCommand } from '@smartsite/contracts';
import { SITE_GATES } from '@smartsite/contracts/gate-permissions';
import { QrScannerView } from './QrScannerView';
export function VisitorAccessView({
  apiUrl,
  token,
  siteId,
  siteName,
  sessionScope,
  canApprove,
}: {
  apiUrl: string;
  token: string;
  siteId: string;
  siteName?: string;
  sessionScope: string;
  canApprove: boolean;
}) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]),
    cache = useQueryClient();
  const key = ['access-control', apiUrl, sessionScope, 'visits', siteId];
  const visits = useQuery({
    queryKey: key,
    queryFn: () => client.listVisits(token, siteId),
    refetchInterval: 15_000,
  });
  const [qrToken, setQrToken] = useState(''),
    [gateId, setGateId] = useState<string>(SITE_GATES[0].id),
    [count, setCount] = useState(1),
    [message, setMessage] = useState('');
  const pending = useRef<{ gateId: string; input: VisitorGateCommand } | null>(null);
  const decide = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) =>
      client.decideVisit(token, siteId, id, status),
    onSuccess: () => cache.invalidateQueries({ queryKey: key }),
  });
  const verify = useMutation({
    mutationFn: (input: VisitorGateCommand) => client.verifyVisitorQr(token, siteId, gateId, input),
    onSuccess: (r) => {
      setMessage(
        `Đã ghi ${r.direction}: ${r.count} người · ${r.visit.visitorName}. Còn ${r.visit.enteredCount - r.visit.exitedCount} người trong site.`,
      );
      setQrToken('');
      pending.current = null;
      void cache.invalidateQueries({ queryKey: key });
    },
  });
  const confirm = (direction: 'IN' | 'OUT') => {
    const old = pending.current;
    const input =
      old &&
      old.gateId === gateId &&
      old.input.token === qrToken.trim() &&
      old.input.direction === direction &&
      old.input.count === count
        ? old.input
        : { token: qrToken.trim(), direction, count, requestId: crypto.randomUUID() };
    pending.current = { gateId, input };
    setMessage('');
    verify.mutate(input);
  };
  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-2xl border bg-white p-5">
        <h2 className="text-xl font-bold">Lượt tham quan · {siteName}</h2>
        <p>
          {canApprove
            ? 'Danh sách yêu cầu gửi Site Manager của site này duyệt.'
            : 'Site Manager tại site đăng ký duyệt trước khi visitor nhận QR.'}
        </p>
        <a
          href="/visits/register"
          target="_blank"
          rel="noreferrer"
          className="text-orange-700 underline"
        >
          Mở trang đăng ký dành cho visitor
        </a>
        {visits.isPending && <p>Đang tải lượt tham quan…</p>}
        {visits.error && (
          <p role="alert">
            {visits.error.message}
            <button onClick={() => void visits.refetch()} className="ml-2 underline">
              Thử lại
            </button>
          </p>
        )}
        {decide.error && (
          <p role="alert" className="text-red-700">
            {decide.error.message}
          </p>
        )}
        {visits.data?.items.length === 0 && <p>Chưa có yêu cầu tại site này.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {[
                  'Đại diện / liên hệ',
                  'Lịch / cổng / khu vực',
                  'Số lượng',
                  'Trạng thái / duyệt',
                ].map((h) => (
                  <th key={h} className="p-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visits.data?.items.map((v) => (
                <tr key={v.id} className="border-t">
                  <td className="p-3">
                    <strong>{v.visitorName}</strong>
                    <p>{v.company}</p>
                    <p>{v.contact}</p>
                    <p>Host: {v.hostName}</p>
                  </td>
                  <td className="p-3">
                    <p>
                      {new Date(v.validFrom).toLocaleString()} –{' '}
                      {new Date(v.validUntil).toLocaleString()}
                    </p>
                    <p>{SITE_GATES.find((g) => g.id === v.gateId)?.name}</p>
                    <p>{v.targetArea}</p>
                    <p>{v.purpose}</p>
                  </td>
                  <td className="p-3">
                    <p>Đăng ký: {v.groupSize}</p>
                    <p>
                      Vào: {v.enteredCount} · Ra: {v.exitedCount}
                    </p>
                    <p>Còn: {v.enteredCount - v.exitedCount}</p>
                  </td>
                  <td className="space-y-2 p-3">
                    <p>{v.status}</p>
                    {canApprove && v.status === 'PENDING' && (
                      <div className="flex gap-2">
                        <button
                          disabled={decide.isPending}
                          className="rounded-lg bg-emerald-600 p-2 text-white"
                          onClick={() => decide.mutate({ id: v.id, status: 'APPROVED' })}
                        >
                          Duyệt
                        </button>
                        <button
                          disabled={decide.isPending}
                          className="rounded-lg border p-2"
                          onClick={() => decide.mutate({ id: v.id, status: 'REJECTED' })}
                        >
                          Từ chối
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="space-y-4 rounded-2xl border bg-white p-5">
        <h2 className="font-bold">Quét QR visitor tại cổng</h2>
        <label>
          Cổng
          <select
            disabled={verify.isPending}
            value={gateId}
            onChange={(e) => setGateId(e.target.value)}
            className="ml-2 rounded-lg border p-2"
          >
            {SITE_GATES.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <QrScannerView
          disabled={verify.isPending}
          onScan={(value) => {
            setQrToken(value);
            verify.reset();
          }}
        />
        <label className="block">
          QR token
          <input
            disabled={verify.isPending}
            value={qrToken}
            onChange={(e) => setQrToken(e.target.value)}
            className="mt-1 w-full rounded-lg border p-2 font-mono text-xs"
          />
        </label>
        <label className="block">
          Số người thực tế
          <input
            disabled={verify.isPending}
            type="number"
            min={1}
            max={1000}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="ml-2 w-24 rounded-lg border p-2"
          />
        </label>
        <div className="flex gap-3">
          {(['IN', 'OUT'] as const).map((d) => (
            <button
              key={d}
              disabled={
                !qrToken.trim() ||
                verify.isPending ||
                !Number.isInteger(count) ||
                count < 1 ||
                count > 1000
              }
              className="rounded-lg bg-orange-600 px-4 py-2 text-white disabled:opacity-50"
              onClick={() => confirm(d)}
            >
              Xác nhận {d}
            </button>
          ))}
        </div>
        {verify.error && (
          <p role="alert" className="text-red-700">
            {verify.error.message}
          </p>
        )}
        {message && (
          <p role="status" className="text-emerald-700">
            {message}
          </p>
        )}
      </section>
    </div>
  );
}
