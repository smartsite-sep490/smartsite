import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  SafetyIdentificationRetrospectiveAssessment,
  SmartSiteManagementClient,
} from '@smartsite/api-client';
import { Badge, Button, Card } from '../ui';
import { formatIdentificationDateTime } from './safetyIdentificationDetailShared';
import { isHardDenial, type IdentificationQueryPrefix } from './IdentificationWorkspaceScope';

const pageSize = 10;
const labels = {
  en: {
    title: 'Zone reassessments',
    show: 'View zone reassessments',
    hide: 'Hide zone reassessments',
    refresh: 'Refresh',
    loading: 'Loading reassessments…',
    failed: 'Could not load zone reassessments.',
    empty: 'No reassessments have been requested for this case.',
    original: 'Original assessment',
    noOriginal: 'Awaiting original result',
    capture: 'Recorded at',
    zone: 'Zone',
    camera: 'Camera',
    previous: 'Previous',
    next: 'Next',
    entry: 'Zone entry to reassess',
    choose: 'Choose a zone entry',
    request: 'Request reassessment',
    queued: 'Reassessment queued.',
    submitError: 'Could not request reassessment. You can retry.',
    optionsError: 'Could not load zone entries eligible for reassessment.',
    noOptions: 'No zone entries in this case are eligible for a new reassessment.',
    status: {
      PENDING: 'Queued',
      CLAIMED: 'In progress',
      ALLOWED: 'Access authorized',
      DENIED: 'Access unauthorized',
      UNAVAILABLE: 'Unable to assess',
      FAILED: 'Assessment failed',
      CANCELLED: 'Cancelled',
    },
    unrestricted: 'Zone did not require authorization',
    prohibited: 'Entry prohibited for everyone',
  },
  vi: {
    title: 'Lịch sử đánh giá lại quyền vào vùng',
    show: 'Xem lịch sử đánh giá lại',
    hide: 'Ẩn lịch sử đánh giá lại',
    refresh: 'Làm mới',
    loading: 'Đang tải lịch sử đánh giá…',
    failed: 'Chưa tải được lịch sử đánh giá lại.',
    empty: 'Hồ sơ này chưa có yêu cầu đánh giá lại.',
    original: 'Đánh giá ban đầu',
    noOriginal: 'Chưa có kết quả ban đầu',
    capture: 'Thời điểm ghi hình',
    zone: 'Khu vực',
    camera: 'Camera',
    previous: 'Trang trước',
    next: 'Trang sau',
    entry: 'Lượt vào vùng cần đánh giá lại',
    choose: 'Chọn lượt vào vùng',
    request: 'Gửi yêu cầu đánh giá lại',
    queued: 'Đã gửi yêu cầu đánh giá lại.',
    submitError: 'Chưa gửi được yêu cầu. Bạn có thể thử lại.',
    optionsError: 'Chưa tải được các lượt vào vùng đủ điều kiện đánh giá lại.',
    noOptions: 'Hồ sơ này không có lượt vào vùng nào đủ điều kiện đánh giá lại thêm.',
    status: {
      PENDING: 'Đang chờ xử lý',
      CLAIMED: 'Đang đánh giá',
      ALLOWED: 'Có quyền vào vùng',
      DENIED: 'Không có quyền vào vùng',
      UNAVAILABLE: 'Chưa thể đánh giá',
      FAILED: 'Đánh giá thất bại',
      CANCELLED: 'Đã hủy',
    },
    unrestricted: 'Khu vực không yêu cầu cấp quyền',
    prohibited: 'Khu vực cấm mọi người',
  },
};

export function SafetyIdentificationRetrospectiveHistory({
  client,
  accessToken,
  scopeKey,
  queryPrefix,
  runGuardedQuery,
  siteId,
  caseId,
  episodeId,
  caseVersion,
  vietnamese,
}: {
  client: SmartSiteManagementClient;
  accessToken: string;
  scopeKey: string;
  queryPrefix: IdentificationQueryPrefix;
  runGuardedQuery: <T>(work: () => Promise<T>) => Promise<T>;
  siteId: string;
  caseId: string;
  episodeId: string;
  caseVersion: number;
  vietnamese: boolean;
}) {
  const copy = vietnamese ? labels.vi : labels.en;
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selection, setSelection] = useState<{
    initialRequestId: string;
    commandId: string;
  } | null>(null);
  const queryClient = useQueryClient();
  const historyKey = [...queryPrefix, 'site', siteId, 'zone-reassessments', scopeKey, caseId];
  const query = useQuery({
    queryKey: [...historyKey, offset],
    queryFn: ({ signal }) =>
      runGuardedQuery(() =>
        client.listSafetyIdentificationRetrospectiveAssessments(
          accessToken,
          siteId,
          caseId,
          { offset, limit: pageSize },
          { signal },
        ),
      ),
    enabled: expanded,
    gcTime: 0,
    retry: false,
  });
  const options = useQuery({
    queryKey: [
      ...queryPrefix,
      'site',
      siteId,
      'zone-reassessment-options',
      scopeKey,
      caseId,
      caseVersion,
    ],
    queryFn: ({ signal }) =>
      runGuardedQuery(() =>
        client.listSafetyIdentificationRetrospectiveOptions(accessToken, siteId, caseId, {
          signal,
        }),
      ),
    enabled: expanded,
    gcTime: 0,
    retry: false,
  });
  const submit = useMutation({
    mutationFn: (entry: NonNullable<typeof selection>) =>
      runGuardedQuery(() =>
        client.requestSafetyIdentificationRetrospectiveAssessment(accessToken, siteId, caseId, {
          ...entry,
          episodeId,
          identificationVersion: caseVersion,
        }),
      ),
    onSuccess: async () => {
      setSelection(null);
      setOffset(0);
      await Promise.all([
        options.refetch(),
        queryClient.invalidateQueries({ queryKey: historyKey }),
      ]);
    },
  });
  const denied =
    isHardDenial(query.error) || isHardDenial(options.error) || isHardDenial(submit.error);
  const candidates =
    !denied &&
    !options.isError &&
    options.data?.episodeId === episodeId &&
    options.data.identificationVersion === caseVersion
      ? options.data.items
      : [];
  const selected = candidates.find((item) => item.initialRequestId === selection?.initialRequestId);
  const page = query.isError || denied ? undefined : query.data;

  function verdict(item: SafetyIdentificationRetrospectiveAssessment) {
    if (item.reasonCode === 'POLICY_NONE' && item.status === 'ALLOWED') return copy.unrestricted;
    if (item.reasonCode === 'POLICY_PROHIBITED' && item.status === 'DENIED') return copy.prohibited;
    return copy.status[item.status] ?? copy.status.UNAVAILABLE;
  }

  return (
    <div className="min-w-0 space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        onClick={() => setExpanded((open) => !open)}
      >
        {expanded ? copy.hide : copy.show}
      </Button>
      {expanded && (
        <Card id={panelId} role="region" aria-label={copy.title} className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{copy.title}</h3>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={query.isFetching || options.isFetching || submit.isPending}
              onClick={() => {
                void query.refetch();
                void options.refetch();
              }}
            >
              {copy.refresh}
            </Button>
          </div>
          {candidates.length > 0 && (
            <form
              className="space-y-2 border-b border-slate-200 pb-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (selection && selected && !submit.isPending && !options.isFetching)
                  submit.mutate(selection);
              }}
            >
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid min-w-0 flex-1 gap-1 text-sm font-medium">
                  {copy.entry}
                  <select
                    className="min-w-0 w-full rounded-md border border-slate-300 bg-white px-2 py-2"
                    value={selected?.initialRequestId ?? ''}
                    disabled={submit.isPending}
                    onChange={(event) => {
                      submit.reset();
                      const initialRequestId = event.target.value;
                      setSelection(
                        initialRequestId
                          ? { initialRequestId, commandId: crypto.randomUUID() }
                          : null,
                      );
                    }}
                  >
                    <option value="">{copy.choose}</option>
                    {candidates.map((item) => (
                      <option key={item.initialRequestId} value={item.initialRequestId}>
                        {item.zoneName} · {item.cameraName} ·{' '}
                        {formatIdentificationDateTime(item.capturedAt)}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!selected || options.isFetching}
                  isLoading={submit.isPending}
                >
                  {copy.request}
                </Button>
              </div>
            </form>
          )}
          {options.isError && (
            <p role="alert" className="text-sm text-rose-700">
              {copy.optionsError}
            </p>
          )}
          {options.isSuccess && !candidates.length && (
            <p className="text-sm text-slate-600">{copy.noOptions}</p>
          )}
          {submit.isError && (
            <p role="alert" className="text-sm text-rose-700">
              {copy.submitError}
            </p>
          )}
          {submit.isSuccess && (
            <p role="status" className="text-sm text-emerald-700">
              {copy.queued}
            </p>
          )}
          {query.isPending && (
            <p role="status" className="text-sm">
              {copy.loading}
            </p>
          )}
          {query.isError && (
            <p role="alert" className="text-sm text-rose-700">
              {copy.failed}
            </p>
          )}
          {page?.total === 0 && <p className="text-sm text-slate-600">{copy.empty}</p>}
          {page && page.items.length > 0 && (
            <ul className="space-y-2">
              {page.items.map((item) => (
                <li
                  key={item.requestId}
                  className="min-w-0 space-y-2 rounded-lg border border-slate-200 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 break-words text-sm font-medium">
                      {item.zoneName ?? copy.zone} · {item.cameraName ?? copy.camera}
                    </p>
                    <Badge>{verdict(item)}</Badge>
                  </div>
                  <dl className="grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
                    <div>
                      <dt className="font-medium">{copy.capture}</dt>
                      <dd>
                        <time dateTime={item.capturedAt}>
                          {formatIdentificationDateTime(item.capturedAt)}
                        </time>
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium">{copy.original}</dt>
                      <dd>
                        {item.originalOutcome ? copy.status[item.originalOutcome] : copy.noOriginal}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
          {page && (offset > 0 || page.total > pageSize) && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(offset - pageSize)}
              >
                {copy.previous}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={offset + pageSize >= page.total}
                onClick={() => setOffset(offset + pageSize)}
              >
                {copy.next}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
