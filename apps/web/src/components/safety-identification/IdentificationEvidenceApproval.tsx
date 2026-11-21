import { useInfiniteQuery } from '@tanstack/react-query';
import { ApiError } from '@smartsite/api-client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { IconCheck, IconShield } from '../icons';
import { Badge, Button } from '../ui';
import { IdentificationEvidenceCropStage } from './IdentificationEvidenceCropStage';
import {
  C02_MAX_MASKS,
  parsePercentMaskDraft,
  type MaskRectBp,
} from './identificationEvidenceMaskMath';
import {
  sameId,
  WORKSPACE_SELECT_CLASS,
  type ManagementClient,
} from './IdentificationWorkspaceScope';
import { IDENTIFICATION_FIELD_CLASS, type EvidenceApproval } from './safetyIdentificationFormTypes';

type Preview = EvidenceApproval['preview'];
type Source = Omit<Preview, 'episodeId' | 'masks'> & { sha256: string };
type Cursor = { offset: number; throughSequence: string };
type SourcePage = { items: Source[]; next?: Cursor };

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
  const [masks, setMasks] = useState<MaskRectBp[]>([]);
  const [draft, setDraft] = useState({ left: '0', top: '0', right: '50', bottom: '50' });
  const [numericError, setNumericError] = useState<string | null>(null);
  const [cropInput, setCropInput] = useState<{ preview: Preview; frameSha256: string }>();
  const [cropUrl, setCropUrl] = useState<string>();
  const [cropError, setCropError] = useState(false);
  const [input, setInput] = useState<{ preview: Preview; frameSha256: string }>();
  const [image, setImage] = useState<{ url: string; approval: EvidenceApproval }>();
  const [previewError, setPreviewError] = useState(false);
  const [approved, setApproved] = useState(false);

  const onApproveRef = useRef(onApprove);
  useEffect(() => {
    onApproveRef.current = onApprove;
  }, [onApprove]);

  // Scope credentials and client lifetime without storing raw JWT strings in query keys.
  const [tokenTracker, setTokenTracker] = useState(() => ({ token, client, epoch: 0 }));
  if (tokenTracker.token !== token || tokenTracker.client !== client) {
    setTokenTracker({ token, client, epoch: tokenTracker.epoch + 1 });
  }

  const scopeIdentity = `${tokenTracker.epoch}:${siteId}:${episodeId}`;
  const [prevScopeIdentity, setPrevScopeIdentity] = useState(scopeIdentity);
  if (prevScopeIdentity !== scopeIdentity) {
    setPrevScopeIdentity(scopeIdentity);
    setIndex('');
    setMasks([]);
    setNumericError(null);
    setCropInput(undefined);
    setCropUrl(undefined);
    setCropError(false);
    setInput(undefined);
    setImage(undefined);
    setPreviewError(false);
    setApproved(false);
  }

  const initialScopeRef = useRef(scopeIdentity);
  useEffect(() => {
    if (initialScopeRef.current === scopeIdentity) return;
    initialScopeRef.current = scopeIdentity;
    onApproveRef.current(undefined);
  }, [scopeIdentity]);

  const pickCopy = (vi: string, en: string) => (vietnamese ? vi : en);

  const clearPreview = useCallback(() => {
    setInput(undefined);
    setImage(undefined);
    setPreviewError(false);
    setApproved(false);
    onApproveRef.current(undefined);
  }, []);

  const clearAllMedia = useCallback(() => {
    setCropInput(undefined);
    setCropUrl(undefined);
    setCropError(false);
    clearPreview();
  }, [clearPreview]);

  const sources = useInfiniteQuery({
    queryKey: ['c02-evidence-sources', instance, tokenTracker.epoch, siteId, episodeId],
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
    if (!cropInput) return;
    const controller = new AbortController();
    let url: string | undefined;
    void client
      .previewSafetyIdentificationEvidence(
        token,
        siteId,
        cropInput.preview,
        cropInput.frameSha256,
        { signal: controller.signal },
      )
      .then(({ blob }) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setCropUrl(url);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setCropInput(undefined);
        setCropUrl(undefined);
        if (error instanceof ApiError && [401, 403, 404].includes(error.status ?? 0)) {
          clearAllMedia();
        }
        setCropError(true);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [clearAllMedia, client, cropInput, siteId, token]);

  useEffect(() => {
    if (!input) return;
    onApproveRef.current(undefined);
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
      .catch((error) => {
        if (controller.signal.aborted) return;
        setImage(undefined);
        setApproved(false);
        onApproveRef.current(undefined);
        if (error instanceof ApiError && [401, 403, 404].includes(error.status ?? 0)) {
          clearAllMedia();
        }
        setPreviewError(true);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [clearAllMedia, client, input, siteId, token]);

  function addNumericMask() {
    if (masks.length >= C02_MAX_MASKS) {
      setNumericError(pickCopy('Đã đạt tối đa 32 vùng che.', 'Maximum of 32 masks reached.'));
      return;
    }
    const parsed = parsePercentMaskDraft(draft);
    if (!parsed) {
      setNumericError(
        pickCopy(
          'Nhập số nguyên từ 0 đến 100 với Trái < Phải và Trên < Dưới.',
          'Enter whole numbers from 0 to 100 with Left < Right and Top < Bottom.',
        ),
      );
      return;
    }
    setNumericError(null);
    clearPreview();
    setMasks([...masks, parsed]);
  }

  const source = index === '' || hardDenial ? undefined : choices[Number(index)];

  async function loadMore() {
    if (!sources.hasNextPage || sources.isFetchingNextPage) return;
    const result = await sources.fetchNextPage({ cancelRefetch: false });
    if (result.error instanceof ApiError && [401, 403, 404].includes(result.error.status ?? 0)) {
      clearAllMedia();
    }
  }

  const cropLoading = Boolean(cropInput && !cropUrl && !cropError);
  const previewLoading = Boolean(input && !image && !previewError);

  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 space-y-3.5 rounded-2xl border border-slate-200/90 bg-slate-50/60 p-3.5 sm:p-4"
    >
      <legend className="px-1.5 text-xs font-bold uppercase tracking-wider text-[#071A2B]">
        {pickCopy('Ảnh bằng chứng chia sẻ (tùy chọn)', 'Shared subject evidence (optional)')}
      </legend>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-600">
          {pickCopy(
            'Chỉ chia sẻ ảnh cắt đối tượng sau khi che vùng nhạy cảm, xem trước JPEG từ máy chủ và tích xác nhận.',
            'Share a subject crop only after masking sensitive areas, previewing the server JPEG, and confirming below.',
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          onClick={() => {
            clearAllMedia();
            setNumericError(null);
            setMasks([]);
            setIndex('');
            setOpen(!open);
          }}
        >
          {open ? pickCopy('Bỏ ảnh', 'Remove image') : pickCopy('Chọn ảnh', 'Choose image')}
        </Button>
      </div>

      {open && (
        <div className="space-y-3.5">
          {sources.isPending && !sources.isError && (
            <p role="status" className="text-xs font-medium text-slate-600">
              {pickCopy('Đang tìm ảnh…', 'Loading image sources…')}
            </p>
          )}
          {sources.isError && (
            <p
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800"
            >
              {pickCopy('Không tải được nguồn ảnh.', 'Image sources could not be loaded.')}
            </p>
          )}
          {sources.isSuccess && choices.length === 0 && !sources.hasNextPage && (
            <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              {pickCopy('Chưa có ảnh để chia sẻ.', 'No image is available to share.')}
            </p>
          )}

          <div className="flex flex-wrap items-end gap-2.5">
            <label className="min-w-0 flex-1 sm:max-w-xs space-y-1 text-xs font-semibold text-[#071A2B]">
              <span className="block">{pickCopy('Nguồn ảnh', 'Image source')}</span>
              <select
                className={`${WORKSPACE_SELECT_CLASS} w-full`}
                value={index}
                onChange={(event) => {
                  clearAllMedia();
                  setNumericError(null);
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
              </select>
            </label>

            {!hardDenial && sources.hasNextPage && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={sources.isFetchingNextPage}
                onClick={() => void loadMore()}
              >
                {sources.isFetchingNextPage
                  ? pickCopy('Đang tải thêm…', 'Loading more…')
                  : pickCopy('Tải thêm nguồn ảnh', 'Load more image sources')}
              </Button>
            )}
          </div>

          {source && (
            <div className="space-y-3">
              <IdentificationEvidenceCropStage
                vietnamese={vietnamese}
                disabled={disabled}
                cropUrl={cropUrl}
                cropLoading={cropLoading}
                cropError={cropError}
                masks={masks}
                onLoadCrop={() => {
                  setCropUrl(undefined);
                  setCropError(false);
                  const { sha256, ...selection } = source;
                  setCropInput({
                    preview: { episodeId, ...selection, masks: [] },
                    frameSha256: sha256,
                  });
                }}
                onCropDecodeError={() => {
                  setCropInput(undefined);
                  setCropUrl(undefined);
                  setCropError(true);
                }}
                onAddMask={(mask) => {
                  setNumericError(null);
                  clearPreview();
                  setMasks((prev) => (prev.length >= C02_MAX_MASKS ? prev : [...prev, mask]));
                }}
                onRemoveMaskAt={(removeIdx) => {
                  setNumericError(null);
                  clearPreview();
                  setMasks((prev) => prev.filter((_, idx) => idx !== removeIdx));
                }}
                onClearMasks={() => {
                  setNumericError(null);
                  clearPreview();
                  setMasks([]);
                }}
              />

              <details
                open={!cropUrl}
                className="rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 text-xs"
              >
                <summary className="cursor-pointer select-none font-semibold text-slate-700 hover:text-[#071A2B]">
                  {pickCopy(
                    'Nhập tọa độ vùng che bằng số % (hỗ trợ bàn phím)',
                    'Numeric percentage coordinates (keyboard fallback)',
                  )}
                </summary>
                <div className="mt-2.5 space-y-2.5 border-t border-slate-100 pt-2.5">
                  <p className="text-xs text-slate-600">
                    {pickCopy(
                      'Nhập tọa độ vùng che theo % của ảnh cắt, tính từ góc trên trái (0–100%).',
                      'Enter mask coordinates as percentages of the crop, measured from the top left (0–100%).',
                    )}
                  </p>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {(['left', 'top', 'right', 'bottom'] as const).map((key) => (
                      <label className="space-y-1 text-xs font-semibold text-slate-700" key={key}>
                        <span className="block">
                          {
                            {
                              left: pickCopy('Trái', 'Left'),
                              top: pickCopy('Trên', 'Top'),
                              right: pickCopy('Phải', 'Right'),
                              bottom: pickCopy('Dưới', 'Bottom'),
                            }[key]
                          }
                        </span>
                        <input
                          className={`${IDENTIFICATION_FIELD_CLASS} py-1.5 text-xs tabular-nums`}
                          type="number"
                          min={0}
                          max={100}
                          value={draft[key]}
                          onChange={(event) => {
                            const nextDraft = { ...draft, [key]: event.target.value };
                            setDraft(nextDraft);
                            if (numericError && parsePercentMaskDraft(nextDraft)) {
                              setNumericError(null);
                            }
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  {numericError && (
                    <p
                      role="alert"
                      data-testid="c02-numeric-mask-error"
                      className="text-xs font-medium text-rose-700"
                    >
                      {numericError}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={masks.length >= C02_MAX_MASKS}
                      onClick={addNumericMask}
                    >
                      {pickCopy('Thêm vùng che', 'Add mask')}
                    </Button>
                    {masks.length > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setNumericError(null);
                          clearPreview();
                          setMasks(masks.slice(0, -1));
                        }}
                      >
                        {pickCopy('Bỏ vùng che cuối', 'Undo last mask')} ({masks.length})
                      </Button>
                    )}
                  </div>
                </div>
              </details>

              <div className="space-y-2.5 rounded-xl border border-slate-200/90 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="info" className="normal-case text-[11px] font-semibold">
                      {pickCopy('Bước 2 · Xem trước & Xác nhận', 'Step 2 · Preview & Confirm')}
                    </Badge>
                    <span className="text-xs font-medium text-slate-600">
                      {pickCopy(
                        'Kiểm tra ảnh JPEG đã áp vùng che từ máy chủ trước khi đính kèm.',
                        'Inspect the server-masked JPEG before approving it for the Site Manager.',
                      )}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    isLoading={previewLoading}
                    onClick={() => {
                      clearPreview();
                      const { sha256, ...selection } = source;
                      setInput({
                        preview: { episodeId, ...selection, masks },
                        frameSha256: sha256,
                      });
                    }}
                  >
                    {pickCopy('Xem trước ảnh', 'Preview image')}
                  </Button>
                </div>

                {previewError && (
                  <p
                    role="alert"
                    className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800"
                  >
                    {pickCopy(
                      'Không xem trước được ảnh.',
                      'The image preview could not be loaded.',
                    )}
                  </p>
                )}

                {previewLoading && (
                  <p role="status" className="text-xs font-medium text-slate-600">
                    {pickCopy('Đang dựng ảnh…', 'Preparing preview…')}
                  </p>
                )}

                {image && (
                  <div className="space-y-3 border-t border-slate-100 pt-3">
                    <div className="flex justify-center rounded-xl border border-slate-200 bg-slate-950/95 p-2">
                      <img
                        className="max-h-80 max-w-full rounded-lg object-contain"
                        src={image.url}
                        alt={pickCopy('Ảnh sẽ chia sẻ', 'Image to share')}
                      />
                    </div>
                    <label
                      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-xs font-medium transition-colors ${
                        approved
                          ? 'border-emerald-300 bg-emerald-50/80 text-emerald-950'
                          : 'border-slate-200 bg-slate-50/80 text-[#071A2B] hover:bg-slate-100/70'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={approved}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-400 accent-emerald-700"
                        onChange={(event) => {
                          setApproved(event.target.checked);
                          onApprove(event.target.checked ? image.approval : undefined);
                        }}
                      />
                      <span className="leading-relaxed">
                        {pickCopy(
                          'Tôi đã kiểm tra ảnh này và xác nhận có thể chia sẻ cho Quản lý công trường.',
                          'I reviewed this image and confirm it can be shared with the Site Manager.',
                        )}
                      </span>
                    </label>
                    {approved && (
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                        <IconCheck className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          {pickCopy(
                            'Đã xác nhận ảnh cắt để gửi kèm yêu cầu xác minh.',
                            'Approved masked crop ready to attach to this request.',
                          )}
                        </span>
                      </div>
                    )}
                    {!approved && (
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <IconShield className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span>
                          {pickCopy(
                            'Chưa tích xác nhận: yêu cầu sẽ không đính kèm ảnh này khi gửi.',
                            'Unchecked: submitting the request will not attach this image until confirmed.',
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}
