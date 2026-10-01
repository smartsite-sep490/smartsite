import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { type WorkerResponse, type WorkerGatePermissionsResponse } from '@smartsite/contracts';
import { SITE_GATES } from '@smartsite/contracts/gate-permissions';

export function GatePermissionEditor({
  snapshot,
  client,
  token,
  siteId,
  onSaved,
}: {
  snapshot: WorkerGatePermissionsResponse;
  client: SmartSiteManagementClient;
  token: string;
  siteId: string;
  onSaved: (value: WorkerGatePermissionsResponse) => void;
}) {
  const [gateIds, setGateIds] = useState(() => [
    ...new Set(
      snapshot.items
        .filter(
          (item) =>
            SITE_GATES.some((gate) => gate.id === item.gateId) &&
            new Date(item.validFrom).getTime() <= Date.now() &&
            (!item.validUntil || new Date(item.validUntil).getTime() > Date.now()),
        )
        .map((item) => item.gateId),
    ),
  ]);
  const save = useMutation({
    mutationFn: () =>
      client.setWorkerGatePermissions(token, siteId, snapshot.workerId, {
        gateIds,
        expectedPermissionIds: snapshot.items.map((item) => item.id),
      }),
    onSuccess: onSaved,
  });
  return (
    <div className="space-y-4">
      <fieldset disabled={save.isPending} className="space-y-3">
        <legend className="mb-2 font-semibold">Cửa được phép vào</legend>
        {SITE_GATES.map((gate) => (
          <label key={gate.id} className="flex items-center gap-3 rounded-xl border p-4">
            <input
              type="checkbox"
              checked={gateIds.includes(gate.id)}
              onChange={(event) =>
                setGateIds((previous) =>
                  event.target.checked
                    ? [...previous, gate.id]
                    : previous.filter((id) => id !== gate.id),
                )
              }
            />
            <span>{gate.name}</span>
          </label>
        ))}
      </fieldset>
      <p className="text-sm text-slate-600">
        Lưu sẽ thay quyền hiện tại bằng các cửa đã chọn, có hiệu lực ngay đến khi thu hồi. Không
        chọn cửa nào = không được vào cửa nào.
      </p>
      <p className="text-sm text-slate-600">
        Quyền cửa không thay thế kiểm tra khuôn mặt, tài khoản và nhà thầu đang hoạt động tại công
        trình.
      </p>
      {save.error && (
        <p role="alert" className="text-red-700">
          {save.error.message}
        </p>
      )}
      <button
        disabled={save.isPending}
        onClick={() => save.mutate()}
        className="rounded-lg bg-orange-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
      >
        {save.isPending ? 'Đang lưu…' : 'Lưu quyền vào cửa'}
      </button>
    </div>
  );
}

export function WorkerGatePermissionsView({
  apiUrl,
  token,
  siteId,
  sessionScope,
}: {
  apiUrl: string;
  token: string;
  siteId: string;
  sessionScope: string;
}) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [savedWorkerId, setSavedWorkerId] = useState('');
  const workers = useQuery({
    queryKey: ['access-control', apiUrl, sessionScope, siteId, 'gate-permission-workers'],
    enabled: !!siteId,
    queryFn: async () => {
      const items: WorkerResponse[] = [];
      let total: number;
      do {
        const page = await client.listWorkers(token, siteId, { offset: items.length, limit: 100 });
        items.push(...page.items);
        total = page.total;
        if (!page.items.length) break;
      } while (items.length < total);
      return items;
    },
  });
  const key = ['access-control', apiUrl, sessionScope, siteId, workerId, 'gate-permissions'];
  const permissions = useQuery({
    queryKey: key,
    queryFn: () => client.getWorkerGatePermissions(token, siteId, workerId),
    enabled: !!siteId && !!workerId,
  });
  const visible =
    workers.data?.filter((worker) =>
      `${worker.displayName} ${worker.externalId}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
    ) ?? [];
  return (
    <section className="space-y-5 rounded-2xl border bg-white p-6">
      <h2 className="text-xl font-bold">Quyền vào cửa của công nhân</h2>
      <label className="block">
        Tìm công nhân
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="mt-2 block w-full rounded-lg border p-3"
          placeholder="Họ tên hoặc mã công nhân"
        />
      </label>
      {workers.isPending && <p>Đang tải công nhân…</p>}
      {workers.error && (
        <p role="alert">
          {workers.error.message} <button onClick={() => void workers.refetch()}>Thử lại</button>
        </p>
      )}
      <label className="block">
        Chọn công nhân
        <select
          value={workerId}
          disabled={workers.isPending}
          onChange={(event) => {
            setWorkerId(event.target.value);
            setSavedWorkerId('');
          }}
          className="mt-2 block w-full rounded-lg border p-3"
        >
          <option value="">Chọn công nhân của công trình</option>
          {visible.map((worker) => (
            <option key={worker.id} value={worker.id}>
              {worker.displayName} ({worker.externalId})
              {!worker.userId ? ' — chưa liên kết account' : ''}
              {!worker.isActive ? ' — ngừng hoạt động' : ''}
            </option>
          ))}
        </select>
      </label>
      {!workers.isPending && !visible.length && <p>Không có công nhân phù hợp.</p>}
      {workerId && permissions.isPending && <p>Đang tải quyền vào cửa…</p>}
      {permissions.error && (
        <p role="alert">
          {permissions.error.message}{' '}
          <button
            onClick={() => {
              setSavedWorkerId('');
              void permissions.refetch();
            }}
          >
            Tải lại quyền
          </button>
        </p>
      )}
      {workerId && (
        <button
          className="text-sm text-orange-700"
          onClick={() => {
            setSavedWorkerId('');
            void permissions.refetch();
          }}
        >
          Tải lại quyền hiện tại
        </button>
      )}
      {savedWorkerId === workerId && workerId && (
        <p role="status" className="text-emerald-700">
          Đã lưu quyền vào cửa vào DB.
        </p>
      )}
      {permissions.data && !permissions.isFetching && (
        <GatePermissionEditor
          key={`${workerId}:${permissions.data.items.map((item) => item.id).join(',')}`}
          snapshot={permissions.data}
          client={client}
          token={token}
          siteId={siteId}
          onSaved={(value) => {
            queryClient.setQueryData(key, value);
            setSavedWorkerId(value.workerId);
          }}
        />
      )}
    </section>
  );
}
