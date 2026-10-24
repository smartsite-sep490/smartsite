import { useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import type { PpeTranslationKey } from '../../i18n/ppe-catalog';
import { useLocale } from '../../i18n/ppe-locale';
import { getZonePpeScopeKey } from '../ppe/zone-ppe-scope';
import { CameraDiscardBanner, CameraFeedbackNotice } from './CameraDialogPrimitives';
import { CAMERA_BUTTON_STYLES, CAMERA_FIELD_STYLES } from './camera-dialog-styles';

export interface CameraRegistrationFormProps {
  apiUrl: string;
  token: string | null;
  sessionScope: string | null;
  credentialId: number;
  siteId: string | null;
  siteName: string;
  canManageCamera: boolean;
  client?: SmartSiteManagementClient;
  onCreated?: (camera: CameraResponse) => void;
  onUnauthorized?: () => void;
  onCancel?: () => void;
  /** A containing dialog can own the discard decision; standalone forms confirm locally. */
  onCancelRequest?: () => void;
  onDraftStateChange?: (state: { dirty: boolean; saving: boolean }) => void;
}

const clientIds = new WeakMap<SmartSiteManagementClient, number>();
let nextClientId = 1;
type CameraInput = Parameters<SmartSiteManagementClient['createCamera']>[2];
type FieldErrors = Partial<Record<keyof CameraInput, PpeTranslationKey>>;
const fields = ['code', 'name', 'externalId'] as const;
const labelKeys: Record<keyof CameraInput, PpeTranslationKey> = {
  code: 'cameraSetup.field.code',
  name: 'cameraSetup.field.name',
  externalId: 'cameraSetup.field.externalId',
};
const validationKeys: Record<keyof CameraInput, PpeTranslationKey> = {
  code: 'cameraSetup.register.validation.code',
  name: 'cameraSetup.register.validation.name',
  externalId: 'cameraSetup.register.validation.externalId',
};
const dtoErrorKeys: Record<keyof CameraInput, PpeTranslationKey> = {
  code: 'cameraSetup.register.validation.dtoCode',
  name: 'cameraSetup.register.validation.dtoName',
  externalId: 'cameraSetup.register.validation.dtoExternalId',
};

/** Registration stores metadata only; source provisioning and capture remain separate. */
export function CameraRegistrationForm(props: CameraRegistrationFormProps) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const defaultClient = useMemo(() => new SmartSiteManagementClient(props.apiUrl), [props.apiUrl]);
  const client = props.client ?? defaultClient;
  let clientId = clientIds.get(client);
  if (clientId === undefined) {
    clientId = nextClientId++;
    clientIds.set(client, clientId);
  }
  const scopeKey = getZonePpeScopeKey(queryClient, {
    apiUrl: props.apiUrl,
    token: props.token ?? '',
    sessionScope: props.sessionScope ?? '',
    credentialId: props.credentialId,
    siteId: props.siteId ?? '',
  });
  if (!props.canManageCamera || !props.token || !props.sessionScope || !props.siteId) {
    return (
      <p className="min-w-0 rounded-2xl border border-slate-200/90 bg-slate-50/90 px-3.5 py-2.5 text-xs leading-relaxed text-[#6B6B6B] break-words">
        {t('cameraSetup.register.authRequired')}
      </p>
    );
  }
  return (
    <ScopedCameraRegistrationForm
      key={JSON.stringify([scopeKey, clientId])}
      {...props}
      token={props.token}
      siteId={props.siteId}
      client={client}
      scopeKey={scopeKey}
    />
  );
}

function validate(input: CameraInput): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of ['code', 'name'] as const) {
    const limit = field === 'code' ? 64 : 255;
    if (
      !input[field] ||
      Array.from(input[field]).length > limit ||
      /[\p{Cc}\p{Cs}]/u.test(input[field])
    ) {
      errors[field] = validationKeys[field];
    }
  }
  if (
    !input.externalId.trim() ||
    Array.from(input.externalId).length > 128 ||
    /[\p{Cs}]/u.test(input.externalId) ||
    input.externalId.includes('\0') ||
    /^[a-z][a-z0-9+.-]*:\/\//iu.test(input.externalId.trim())
  ) {
    errors.externalId = validationKeys.externalId;
  }
  return errors;
}

function parseCreatedCamera(value: unknown, siteId: string, input: CameraInput): CameraResponse {
  if (!value || typeof value !== 'object')
    throw new ApiError('invalid-response', 'Invalid camera response.');
  const row = value as Partial<CameraResponse>;
  if (
    typeof row.id !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(row.id) ||
    row.siteId !== siteId ||
    row.code !== input.code ||
    row.name !== input.name ||
    row.externalId !== input.externalId ||
    (row.status !== 'ACTIVE' && row.status !== 'INACTIVE') ||
    !Number.isSafeInteger(row.configurationVersion) ||
    (row.configurationVersion ?? 0) < 1 ||
    typeof row.createdAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(row.createdAt) ||
    !Number.isFinite(Date.parse(row.createdAt))
  ) {
    throw new ApiError('invalid-response', 'Invalid camera response.');
  }
  return {
    id: row.id,
    siteId,
    code: input.code,
    name: input.name,
    externalId: input.externalId,
    status: row.status,
    configurationVersion: row.configurationVersion!,
    createdAt: row.createdAt,
  };
}

function publicErrorKey(error: unknown): PpeTranslationKey {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'cameraSetup.register.error.401';
    if (error.status === 403) return 'cameraSetup.register.error.403';
    if (error.status === 404) return 'cameraSetup.register.error.404';
    if (error.status === 400) return 'cameraSetup.register.error.400';
    if (error.status === 409) return 'cameraSetup.register.error.409';
    if (error.status === 429) return 'cameraSetup.register.error.429';
  }
  return 'cameraSetup.register.error.default';
}

function ScopedCameraRegistrationForm(
  props: CameraRegistrationFormProps & {
    token: string;
    siteId: string;
    client: SmartSiteManagementClient;
    scopeKey: string;
  },
) {
  const { t } = useLocale();
  const id = useId();
  const [draft, setDraft] = useState<CameraInput>({ code: '', name: '', externalId: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState<{
    kind: 'error' | 'success';
    key: PpeTranslationKey;
  } | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const active = useRef(false);
  const submitting = useRef(false);
  const dirty = Object.values(draft).some((value) => value.length > 0);
  const onDraftStateChange = props.onDraftStateChange;
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const create = useMutation({
    mutationKey: ['camera-registration', props.scopeKey],
    retry: false,
    gcTime: 0,
    mutationFn: async (input: CameraInput) => {
      const camera = await props.client.createCamera(props.token, props.siteId, input);
      return parseCreatedCamera(camera, props.siteId, input);
    },
    onSuccess: (camera) => {
      if (!active.current) return;
      submitting.current = false;
      setDraft({ code: '', name: '', externalId: '' });
      setFeedback({
        kind: 'success',
        key: 'ppe.admin.registrationSuccess',
      });
      props.onCreated?.(camera);
    },
    onError: (error) => {
      if (!active.current) return;
      submitting.current = false;
      setFeedback({ kind: 'error', key: publicErrorKey(error) });
      if (error instanceof ApiError) {
        const fieldErrors: FieldErrors = {};
        for (const issue of error.backendError?.issues ?? []) {
          const field = fields.find((field) => `/${field}` === issue.path);
          if (field) {
            fieldErrors[field] = dtoErrorKeys[field];
          }
        }
        setErrors(fieldErrors);
        if ([401, 403, 404].includes(error.status ?? 0)) setBlocked(true);
        if (error.status === 401) props.onUnauthorized?.();
      }
    },
  });
  useLayoutEffect(() => {
    onDraftStateChange?.({ dirty, saving: create.isPending });
  }, [dirty, create.isPending, onDraftStateChange]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!active.current || submitting.current || blocked || !props.canManageCamera) return;
    const input = { ...draft, code: draft.code.trim(), name: draft.name.trim() };
    const invalid = validate(input);
    setErrors(invalid);
    setFeedback(null);
    setConfirmDiscard(false);
    if (Object.keys(invalid).length) {
      const field = fields.find((key) => invalid[key]);
      if (field) document.getElementById(`${id}-${field}`)?.focus();
      return;
    }
    submitting.current = true;
    create.mutate(input);
  };
  const cancel = () => {
    if (submitting.current) return;
    if (props.onCancelRequest) {
      props.onCancelRequest();
      return;
    }
    if (dirty) setConfirmDiscard(true);
    else props.onCancel?.();
  };
  return (
    <form
      aria-label={t('ppe.admin.registerCamera')}
      noValidate
      onSubmit={submit}
      className="min-w-0 space-y-4"
    >
      <div className="min-w-0 rounded-2xl border border-slate-200/90 bg-slate-50/90 p-3.5 text-xs leading-relaxed text-[#6B6B6B] shadow-xs break-words">
        {t('cameraSetup.register.introPrefix')}{' '}
        <strong className="font-semibold text-[#111111] break-words">{props.siteName}</strong>.{' '}
        {t('cameraSetup.register.introSuffix')}
      </div>
      {fields.map((field) => (
        <div key={field} className="min-w-0 space-y-1.5">
          <label htmlFor={`${id}-${field}`} className={CAMERA_FIELD_STYLES.label}>
            {t(labelKeys[field])}
          </label>
          <input
            id={`${id}-${field}`}
            value={draft[field]}
            autoComplete="off"
            required
            disabled={create.isPending || blocked}
            aria-invalid={Boolean(errors[field])}
            aria-describedby={
              [
                field === 'externalId' ? `${id}-source-help` : '',
                errors[field] ? `${id}-${field}-error` : '',
              ]
                .filter(Boolean)
                .join(' ') || undefined
            }
            onChange={(event) => {
              setDraft((previous) => ({ ...previous, [field]: event.target.value }));
              setErrors((previous) => ({ ...previous, [field]: undefined }));
              setFeedback(null);
            }}
            className={CAMERA_FIELD_STYLES.input}
          />
          {field === 'externalId' && (
            <p id={`${id}-source-help`} className={CAMERA_FIELD_STYLES.help}>
              {t('cameraSetup.register.sourceHelp')}
            </p>
          )}
          {errors[field] && (
            <p id={`${id}-${field}-error`} className={CAMERA_FIELD_STYLES.error}>
              {t(errors[field]!)}
            </p>
          )}
        </div>
      ))}
      {feedback && <CameraFeedbackNotice kind={feedback.kind} messageKey={feedback.key} />}
      {confirmDiscard && (
        <CameraDiscardBanner
          disabled={create.isPending}
          onKeepEditing={() => {
            setConfirmDiscard(false);
            document.getElementById(`${id}-cancel`)?.focus();
          }}
          onDiscardChanges={() => {
            setDraft({ code: '', name: '', externalId: '' });
            setConfirmDiscard(false);
            props.onCancel?.();
          }}
        />
      )}
      <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-200 pt-3.5">
        {(props.onCancel || props.onCancelRequest) && (
          <button
            id={`${id}-cancel`}
            type="button"
            disabled={create.isPending}
            onClick={cancel}
            className={CAMERA_BUTTON_STYLES.secondary}
          >
            {t('zoneSetup.action.cancel')}
          </button>
        )}
        <button
          type="submit"
          disabled={create.isPending || blocked}
          className={CAMERA_BUTTON_STYLES.primary}
        >
          {create.isPending ? t('cameraSetup.register.submitting') : t('ppe.admin.registerCamera')}
        </button>
      </div>
    </form>
  );
}
