import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { CreateVisitCommand } from '@smartsite/contracts';
import { SITE_GATES } from '@smartsite/contracts/gate-permissions';
import { QrPassCard } from './QrPassCard';
function localTime(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function readReference() {
  const m = /^#visitor-pass=([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(window.location.hash);
  return m ? { visitId: m[1]!, accessKey: m[2]! } : null;
}
export function VisitorRegistrationView({
  apiUrl,
  onBack,
}: {
  apiUrl: string;
  onBack: () => void;
}) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const [reference, setReference] = useState(readReference),
    [siteId, setSiteId] = useState(''),
    [message, setMessage] = useState('');
  const [schedule] = useState(() => ({
    from: localTime(new Date(Date.now() + 3600_000)),
    until: localTime(new Date(Date.now() + 7200_000)),
  }));
  const [attempt, setAttempt] = useState<CreateVisitCommand | null>(null);
  const sites = useQuery({
    queryKey: ['visitor-registration', apiUrl, 'sites'],
    queryFn: () => client.listVisitorSites(),
  });
  const pass = useQuery({
    queryKey: ['visitor-registration', apiUrl, reference?.visitId, reference?.accessKey],
    enabled: !!reference,
    queryFn: () => client.getVisitorPass(reference!.visitId, reference!.accessKey),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (q) => (q.state.data?.visit.status === 'PENDING' ? 15_000 : 240_000),
  });
  const register = useMutation({
    mutationFn: (input: CreateVisitCommand) =>
      client.registerVisit(siteId || sites.data!.items[0]!.id, input),
    onSuccess: (visit, input) => {
      setReference({ visitId: visit.id, accessKey: input.accessKey });
      window.history.replaceState(null, '', `#visitor-pass=${visit.id}.${input.accessKey}`);
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const input: CreateVisitCommand = {
      requestId: attempt?.requestId ?? crypto.randomUUID(),
      accessKey:
        attempt?.accessKey ??
        Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join(''),
      visitorName: String(f.get('visitorName')),
      company: String(f.get('company')),
      contact: String(f.get('contact')),
      hostName: String(f.get('hostName')),
      purpose: String(f.get('purpose')),
      targetArea: String(f.get('targetArea')),
      groupSize: Number(f.get('groupSize')),
      gateId: String(f.get('gateId')),
      validFrom: new Date(String(f.get('validFrom'))).toISOString(),
      validUntil: new Date(String(f.get('validUntil'))).toISOString(),
    };
    setAttempt(input);
    register.mutate(input);
  };
  const shareUrl = reference
    ? `${window.location.origin}${window.location.pathname}#visitor-pass=${reference.visitId}.${reference.accessKey}`
    : '';
  return (
    <main className="mx-auto my-8 max-w-2xl space-y-5 rounded-2xl border bg-white p-6 shadow-sm">
      <button type="button" onClick={onBack} className="underline">
        Đăng nhập nhân viên / bảo vệ / Site Manager
      </button>
      <h1 className="text-2xl font-bold">Đăng ký tham quan công trường</h1>
      <p className="text-sm text-slate-600">
        Một người đại diện cho cá nhân hoặc cả đoàn. Yêu cầu được chuyển đến Site Manager của site
        đã chọn.
      </p>
      {reference ? (
        <div className="space-y-4">
          <p>Lưu đường dẫn này để kiểm tra phê duyệt và mở QR trên điện thoại.</p>
          <input
            aria-label="Đường dẫn theo dõi lượt tham quan"
            readOnly
            value={shareUrl}
            className="w-full rounded-lg border p-2 text-xs"
          />
          <button
            type="button"
            className="rounded-lg border p-2"
            onClick={() => {
              void navigator.clipboard
                .writeText(shareUrl)
                .then(() => setMessage('Đã sao chép.'))
                .catch(() => setMessage('Chọn và sao chép đường dẫn ở trên.'));
            }}
          >
            Sao chép đường dẫn
          </button>
          {message && <p role="status">{message}</p>}
          {pass.isPending && <p role="status">Đang kiểm tra…</p>}
          {pass.error && (
            <p role="alert" className="text-red-700">
              {pass.error.message}
            </p>
          )}
          {pass.data && (
            <>
              <h2 className="font-bold">
                {pass.data.visit.visitorName} · {pass.data.visit.groupSize} người
              </h2>
              <p>
                Trạng thái:{' '}
                {pass.data.visit.status === 'PENDING'
                  ? 'Chờ Site Manager duyệt'
                  : pass.data.visit.status === 'APPROVED'
                    ? 'Đã duyệt'
                    : 'Bị từ chối'}
              </p>
              <p>
                Site:{' '}
                {sites.data?.items.find((s) => s.id === pass.data.visit.siteId)?.name ??
                  pass.data.visit.siteId}
              </p>
              <p>
                Khu vực: {pass.data.visit.targetArea} · Host: {pass.data.visit.hostName}
              </p>
              <p>
                {new Date(pass.data.visit.validFrom).toLocaleString()} –{' '}
                {new Date(pass.data.visit.validUntil).toLocaleString()}
              </p>
              <p>
                Vào: {pass.data.visit.enteredCount} · Ra: {pass.data.visit.exitedCount} · Còn:{' '}
                {pass.data.visit.enteredCount - pass.data.visit.exitedCount}
              </p>
              {pass.data.pass ? (
                <QrPassCard pass={pass.data.pass} onRefresh={() => void pass.refetch()} />
              ) : (
                pass.data.visit.status === 'APPROVED' && (
                  <p>Lượt tham quan đã hết hạn hoặc hoàn tất.</p>
                )
              )}
            </>
          )}
          <button
            type="button"
            disabled={pass.isFetching}
            className="rounded-lg border p-2"
            onClick={() => void pass.refetch()}
          >
            Kiểm tra trạng thái / làm mới QR
          </button>
          <button
            type="button"
            className="ml-2 rounded-lg border p-2"
            onClick={() => {
              setReference(null);
              setAttempt(null);
              register.reset();
              window.history.replaceState(null, '', window.location.pathname);
            }}
          >
            Đăng ký lượt mới
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2">
            Site đăng ký
            <select
              required
              className="mt-1 w-full rounded-lg border p-2"
              value={siteId || sites.data?.items[0]?.id || ''}
              onChange={(e) => setSiteId(e.target.value)}
            >
              <option value="">Chọn site</option>
              {sites.data?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {sites.isPending && <p>Đang tải site…</p>}
          {sites.error && (
            <p role="alert">
              {sites.error.message}
              <button type="button" className="ml-2 underline" onClick={() => void sites.refetch()}>
                Thử lại
              </button>
            </p>
          )}
          {[
            ['visitorName', 'Tên người đại diện', true],
            ['company', 'Đơn vị / công ty', false],
            ['contact', 'Điện thoại / email liên hệ', true],
            ['hostName', 'Người tiếp đón tại site', true],
            ['purpose', 'Mục đích tham quan', true],
            ['targetArea', 'Khu vực đề nghị tham quan', true],
          ].map(([name, label, required]) => (
            <label key={String(name)}>
              {String(label)}
              <input
                name={String(name)}
                required={Boolean(required)}
                maxLength={name === 'purpose' ? 1000 : 255}
                className="mt-1 w-full rounded-lg border p-2"
              />
            </label>
          ))}
          <label>
            Số lượng người
            <input
              name="groupSize"
              type="number"
              min={1}
              max={1000}
              defaultValue={1}
              required
              className="mt-1 w-full rounded-lg border p-2"
            />
          </label>
          <label>
            Cổng đăng ký
            <select name="gateId" className="mt-1 w-full rounded-lg border p-2">
              {SITE_GATES.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Từ thời điểm
            <input
              name="validFrom"
              type="datetime-local"
              defaultValue={schedule.from}
              required
              className="mt-1 w-full rounded-lg border p-2"
            />
          </label>
          <label>
            Đến thời điểm
            <input
              name="validUntil"
              type="datetime-local"
              defaultValue={schedule.until}
              required
              className="mt-1 w-full rounded-lg border p-2"
            />
          </label>
          {register.error && (
            <p role="alert" className="text-red-700 sm:col-span-2">
              {register.error.message}
            </p>
          )}
          <button
            disabled={register.isPending || !sites.data?.items.length}
            className="rounded-xl bg-orange-600 p-3 font-bold text-white disabled:opacity-50 sm:col-span-2"
          >
            {register.isPending ? 'Đang gửi…' : 'Gửi Site Manager duyệt'}
          </button>
        </form>
      )}
    </main>
  );
}
