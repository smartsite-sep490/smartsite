import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { SmartSiteManagementClient, WorkerComplianceResponse } from '@smartsite/api-client';
import { useTranslation } from 'react-i18next';
import { translate as tr } from '../../../i18n';
import { userErrorMessage } from '../../../i18n/messages';
import { SmartNativeSelect } from '../../ui/SmartNativeSelect';
import {
  DocumentAttachmentInput,
  DocumentFilePreview,
  documentButton,
  documentField,
  documentPrimaryButton,
} from './DocumentAttachmentInput';

const sides = ['FRONT', 'BACK'] as const;
const genders = ['MALE', 'FEMALE', 'OTHER'] as const;

export function WorkerIdentityForm(p: {
  client: SmartSiteManagementClient;
  token: string;
  siteId: string;
  profile: WorkerComplianceResponse;
  editable?: boolean;
  onSaved?: () => void;
}) {
  useTranslation();
  const [editing, setEditing] = useState(false);
  const preview = useMutation({
    mutationFn: async (side: (typeof sides)[number]) => {
      const item = p.profile.identityImages.find((image) => image.side === side);
      if (!item) throw new Error(tr('errors.notFound'));
      return {
        blob: await p.client.workerIdentityImageFile(
          p.token,
          p.siteId,
          p.profile.workerId,
          item.id,
        ),
        type: item.mediaType,
        title: tr('documents.' + side),
      };
    },
  });
  if (p.editable && editing) {
    return (
      <IdentityEditor
        {...p}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          p.onSaved?.();
        }}
      />
    );
  }
  return (
    <div className="space-y-3">
      <dl className="grid gap-x-6 gap-y-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-2">
        {(
          [
            ['nationalId', p.profile.nationalId],
            ['phoneNumber', p.profile.phoneNumber],
            ['gender', p.profile.gender && tr('documents.' + p.profile.gender)],
            ['address', p.profile.address],
          ] as const
        ).map(([key, value]) => (
          <div key={key}>
            <dt className="text-slate-600">{tr('documents.' + key)}</dt>
            <dd className="break-words font-medium text-slate-900">{value || '—'}</dd>
          </div>
        ))}
      </dl>
      <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
        {sides.map((side) => {
          const record = p.profile.identityImages.find((image) => image.side === side);
          return (
            <div key={side} className="flex items-center justify-between gap-2 p-3 text-sm">
              <span className="font-medium">{tr('documents.' + side)}</span>
              {record ? (
                <button
                  type="button"
                  className={documentButton}
                  disabled={preview.isPending}
                  aria-label={tr('workerIntake.viewAttachment', { name: tr('documents.' + side) })}
                  onClick={() => preview.mutate(side)}
                >
                  {tr('documents.view')}
                </button>
              ) : (
                <span className="text-slate-600">{tr('documents.noFile')}</span>
              )}
            </div>
          );
        })}
      </div>
      {p.editable && (
        <button type="button" className={documentPrimaryButton} onClick={() => setEditing(true)}>
          {tr('workerIntake.editIdentity')}
        </button>
      )}
      {preview.isError && (
        <p role="alert" className="text-sm text-red-700">
          {userErrorMessage(preview.error)}
        </p>
      )}
      {preview.data && <DocumentFilePreview {...preview.data} onClose={preview.reset} />}
    </div>
  );
}

function IdentityEditor(p: {
  client: SmartSiteManagementClient;
  token: string;
  siteId: string;
  profile: WorkerComplianceResponse;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [baseVersion] = useState(p.profile.identityVersion ?? 0);
  const [nationalId, setNationalId] = useState(p.profile.nationalId ?? '');
  const [phoneNumber, setPhoneNumber] = useState(p.profile.phoneNumber ?? '');
  const [gender, setGender] = useState<WorkerComplianceResponse['gender']>(p.profile.gender);
  const [address, setAddress] = useState(p.profile.address ?? '');
  const [files, setFiles] = useState<Partial<Record<(typeof sides)[number], File>>>({});
  const ready =
    !!nationalId &&
    !!phoneNumber &&
    !!gender &&
    !!address.trim() &&
    sides.every(
      (side) => files[side] || p.profile.identityImages.some((record) => record.side === side),
    );
  const save = useMutation({
    mutationFn: () =>
      p.client.updateMyWorkerIdentity(
        p.token,
        p.siteId,
        {
          expectedVersion: baseVersion,
          nationalId,
          phoneNumber,
          gender: gender!,
          address: address.trim(),
        },
        files,
      ),
    onSuccess: p.onSaved,
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) save.mutate();
      }}
    >
      <fieldset disabled={save.isPending} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium">
            <span>{tr('documents.nationalId')}</span>
            <input
              className={documentField}
              inputMode="numeric"
              required
              pattern="[0-9]{12}"
              maxLength={12}
              value={nationalId}
              onChange={(event) => setNationalId(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            <span>{tr('documents.phoneNumber')}</span>
            <input
              className={documentField}
              type="tel"
              required
              pattern="[+]?[0-9]{9,15}"
              maxLength={16}
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            <span>{tr('documents.gender')}</span>
            <SmartNativeSelect
              className={documentField}
              required
              value={gender ?? ''}
              onChange={(event) =>
                setGender(genders.find((item) => item === event.target.value) ?? null)
              }
            >
              <option value="">{tr('documents.chooseGender')}</option>
              {genders.map((item) => (
                <option value={item} key={item}>
                  {tr('documents.' + item)}
                </option>
              ))}
            </SmartNativeSelect>
          </label>
          <label className="space-y-1 text-sm font-medium">
            <span>{tr('documents.address')}</span>
            <input
              className={documentField}
              required
              maxLength={1000}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {sides.map((side) => (
            <div key={side} className="rounded-lg border border-slate-200 p-3">
              <DocumentAttachmentInput
                label={tr('documents.' + side)}
                imageOnly
                preview
                file={files[side]}
                savedName={
                  p.profile.identityImages.find((image) => image.side === side)?.originalName
                }
                onChange={(file) => setFiles((current) => ({ ...current, [side]: file }))}
              />
            </div>
          ))}
        </div>
        {save.isError && (
          <p role="alert" className="text-sm text-red-700">
            {userErrorMessage(save.error)}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" className={documentPrimaryButton} disabled={!ready}>
            {tr('workerIntake.saveIdentity')}
          </button>
          <button type="button" className={documentButton} onClick={p.onCancel}>
            {tr('common.cancel')}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
