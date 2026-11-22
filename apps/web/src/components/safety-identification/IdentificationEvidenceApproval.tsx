import { SmartNativeSelect } from '../ui/SmartNativeSelect';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ApiError } from '@smartsite/api-client';
import { useEffect, useId, useState } from 'react';
import { Button } from '../ui';
import { sameId, type ManagementClient } from './IdentificationWorkspaceScope';
import type { EvidenceApproval } from './safetyIdentificationFormTypes';

type Preview = EvidenceApproval['preview'];
type Source = Omit<Preview, 'episodeId' | 'masks'> & { sha256: string };
type Cursor = { offset: number; throughSequence: string };
type SourcePage = { items: Source[]; next?: Cursor };
type Mask = Preview['masks'][number];

export function IdentificationEvidenceApproval({
  client,
  token,
  siteId,
  episodeId,
  vietnamese,
  disabled,
  onApprove,
}: {
  client: ManagementClient;
  token: string;
  siteId: string;
  episodeId: string;
  vietnamese: boolean;
  disabled: boolean;
  onApprove: (approval?: EvidenceApproval) => void;
}) {
  const instance = useId();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState('');
  const [masks, setMasks] = useState<Mask[]>([]);
  const [draft, setDraft] = useState({ left: '0', top: '0', right: '50', bottom: '50' });
  const [input, setInput] = useState<{ preview: Preview; frameSha256: string }>();
  const [image, setImage] = useState<{ url: string; approval: EvidenceApproval }>();
  const [previewError, setPreviewError] = useState(false);
  const [approved, setApproved] = useState(false);
  const pickCopy = (vi: string, en: string) => (vietnamese ? vi : en);
  const sources = useInfiniteQuery({
    queryKey: ['c02-evidence-sources', instance, siteId, episodeId],
    enabled: open,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    initialPageParam: null as Cursor | null,
    getNextPageParam: (page: SourcePage) => page.next,
    queryFn: async ({ signal, pageParam }): Promise<SourcePage> => {
      if (!pageParam)
        try {
          const episode = await client.getSafetyEpisode(token, siteId, episodeId, { signal });
          if (!sameId(episode.siteId, siteId) || !sameId(episode.id, episodeId))
            throw new Error('Mismatched evidence source');
          return {
            items: episode.findings.flatMap(({ alertId, evidenceRefs }) =>
              evidenceRefs
                .filter((ref) => ref.available)
                .map((ref) => ({
                  alertId,
                  eventId: ref.eventId,
                  personObservationIndex: ref.personObservationIndex,
                  evidenceIndex: ref.evidenceIndex,
                  sha256: ref.sha256,
                })),
            ),
          };
        } catch (error) {
          if (!(error instanceof ApiError) || ![404, 409].includes(error.status ?? 0)) throw error;
        }
      const page = await client.listTrackedEpisodeObservations(
        token,
        siteId,
        episodeId,
        { limit: 20, ...pageParam },
        { signal },
      );
      if (!sameId(page.episodeId, episodeId)) throw new Error('Mismatched evidence source');
      if (
        pageParam &&
        (page.offset !== pageParam.offset || page.throughSequence !== pageParam.throughSequence)
      )
        throw new Error('Mismatched evidence page');
      const offset = page.offset + page.items.length;
      return {
        items: page.items.flatMap(({ alertId, eventId, personObservationIndex, frames }) =>
          frames.map((frame) => ({ alertId, eventId, personObservationIndex, ...frame })),
        ),
        next:
          page.hasMore && offset > page.offset
            ? { offset, throughSequence: page.throughSequence }
            : undefined,
      };
    },
  });
  const choices = sources.data?.pages.flatMap((page) => page.items) ?? [];
  const hardDenial =
    sources.error instanceof ApiError && [401, 403, 404].includes(sources.error.status ?? 0);

  useEffect(() => {
    if (!input) return;
    const controller = new AbortController();
    let url: string | undefined;
    void client
      .previewSafetyIdentificationEvidence(token, siteId, input.preview, input.frameSha256, {
        signal: controller.signal,
      })
      .then(({ blob, sha256 }) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage({ url, approval: { ...input, sha256 } });
      })
      .catch(() => {
        if (!controller.signal.aborted) setPreviewError(true);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [client, token, siteId, input]);

  function clearPreview() {
    setInput(undefined);
    setImage(undefined);
    setPreviewError(false);
    setApproved(false);
    onApprove(undefined);
  }

  function addMask() {
    const { left, top, right, bottom } = draft;
    const values = [left, top, right, bottom];
    if (
      values.some((v) => !/^\d{1,3}$/.test(v) || Number(v) > 100) ||
      Number(left) >= Number(right) ||
      Number(top) >= Number(bottom)
    )
      return;
    clearPreview();
    setMasks([
      ...masks,
      {
        left: Number(left) * 100,
        top: Number(top) * 100,
        right: Number(right) * 100,
        bottom: Number(bottom) * 100,
      },
    ]);
  }

  const source = index === '' || hardDenial ? undefined : choices[Number(index)];
  async function loadMore() {
    if (!sources.hasNextPage || sources.isFetchingNextPage) return;
    const result = await sources.fetchNextPage({ cancelRefetch: false });
    if (result.error instanceof ApiError && [401, 403, 404].includes(result.error.status ?? 0))
      clearPreview();
  }
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-semibold">
        {pickCopy('Ảnh bằng chứng (tùy chọn)', 'Evidence image (optional)')}
      </legend>
      <Button
        type="button"
        variant="outline"
        aria-expanded={open}
        onClick={() => {
          clearPreview();
          setOpen(!open);
        }}
      >
        {open ? pickCopy('Bỏ ảnh', 'Remove image') : pickCopy('Chọn ảnh', 'Choose image')}
      </Button>
      {open && (
        <>
          {sources.isPending && !sources.isError && (
            <p role="status">{pickCopy('Đang tìm ảnh…', 'Loading image sources…')}</p>
          )}
          {sources.isError && (
            <p role="alert">
              {pickCopy('Không tải được nguồn ảnh.', 'Image sources could not be loaded.')}
            </p>
          )}
          {sources.isSuccess && choices.length === 0 && !sources.hasNextPage && (
            <p>{pickCopy('Chưa có ảnh để chia sẻ.', 'No image is available to share.')}</p>
          )}
          <label className="block text-sm">
            {pickCopy('Nguồn ảnh', 'Image source')}
            <SmartNativeSelect
              className="ml-2 rounded border"
              value={index}
              onChange={(event) => {
                clearPreview();
                setMasks([]);
                setIndex(event.target.value);
              }}
            >
              <option value="">{pickCopy('Chọn nguồn', 'Select a source')}</option>
              {(hardDenial ? [] : choices).map((item, i) => (
                <option
                  key={`${item.alertId}:${item.eventId}:${item.evidenceIndex}:${i}`}
                  value={i}
                >
                  {pickCopy('Ảnh', 'Image')} {i + 1}
                </option>
              ))}
            </SmartNativeSelect>
          </label>
          {!hardDenial && sources.hasNextPage && (
            <Button
              type="button"
              variant="outline"
              disabled={sources.isFetchingNextPage}
              onClick={() => void loadMore()}
            >
              {sources.isFetchingNextPage
                ? pickCopy('Đang tải thêm…', 'Loading more…')
                : pickCopy('Tải thêm nguồn ảnh', 'Load more image sources')}
            </Button>
          )}
          {source && (
            <>
              <p className="text-sm">
                {pickCopy(
                  'Nhập tọa độ vùng che theo % của ảnh cắt, tính từ góc trên trái.',
                  'Enter mask coordinates as percentages of the crop, measured from the top left.',
                )}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(['left', 'top', 'right', 'bottom'] as const).map((key) => (
                  <label className="text-sm" key={key}>
                    {
                      {
                        left: pickCopy('Trái', 'Left'),
                        top: pickCopy('Trên', 'Top'),
                        right: pickCopy('Phải', 'Right'),
                        bottom: pickCopy('Dưới', 'Bottom'),
                      }[key]
                    }
                    <input
                      className="block w-full rounded border"
                      type="number"
                      min={0}
                      max={100}
                      value={draft[key]}
                      onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                    />
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={masks.length >= 32}
                  onClick={addMask}
                >
                  {pickCopy('Thêm vùng che', 'Add mask')}
                </Button>
                {masks.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      clearPreview();
                      setMasks(masks.slice(0, -1));
                    }}
                  >
                    {pickCopy('Bỏ vùng che cuối', 'Undo last mask')} ({masks.length})
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    clearPreview();
                    const { sha256, ...selection } = source;
                    setInput({ preview: { episodeId, ...selection, masks }, frameSha256: sha256 });
                  }}
                >
                  {pickCopy('Xem trước ảnh', 'Preview image')}
                </Button>
              </div>
              {previewError && (
                <p role="alert">
                  {pickCopy('Không xem trước được ảnh.', 'The image preview could not be loaded.')}
                </p>
              )}
              {input && !image && !previewError && (
                <p role="status">{pickCopy('Đang dựng ảnh…', 'Preparing preview…')}</p>
              )}
              {image && (
                <div className="space-y-2">
                  <img
                    className="max-h-96 max-w-full rounded-lg object-contain"
                    src={image.url}
                    alt={pickCopy('Ảnh sẽ chia sẻ', 'Image to share')}
                  />
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={approved}
                      onChange={(event) => {
                        setApproved(event.target.checked);
                        onApprove(event.target.checked ? image.approval : undefined);
                      }}
                    />
                    {pickCopy(
                      'Tôi đã kiểm tra ảnh này và xác nhận có thể chia sẻ cho Quản lý công trường.',
                      'I reviewed this image and confirm it can be shared with the Site Manager.',
                    )}
                  </label>
                </div>
              )}
            </>
          )}
        </>
      )}
    </fieldset>
  );
}
