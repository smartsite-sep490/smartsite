import { localizedLabel } from '../../i18n/labels';
import { uiLocale } from '../../i18n';
import { translate as tr } from '../../i18n';
import { useEffect, useRef, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AccountResponse, SmartSiteManagementClient } from '@smartsite/api-client';
export type WithoutCommandId<T> = T extends { commandId: string } ? Omit<T, 'commandId'> : never;
export interface WorkflowProps {
  client: SmartSiteManagementClient;
  apiUrl: string;
  token: string;
  scope: string;
  siteId: string;
  user: AccountResponse;
}
export const hasRole = (p: WorkflowProps, role: string) =>
  p.user.roleAssignments.some((r) => r.role === role && r.siteId === p.siteId);
export const fieldClass =
  'mt-1.5 w-full min-w-0 rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-sm font-normal focus:outline-2 focus:outline-[var(--accent)]';
const buttonBase =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed';
export const buttonClass =
  buttonBase +
  ' border-[var(--border)] bg-white text-[var(--text-body)] hover:bg-[var(--surface-bone)]';
export const cardClass =
  'min-w-0 space-y-4 rounded-xl border border-[var(--border)] bg-white p-4 sm:p-5';
export const primaryClass =
  buttonBase +
  ' border-transparent bg-[var(--action-primary)] text-white hover:bg-[var(--action-primary-hover)]';
export const dangerClass =
  buttonBase +
  ' border-red-200 bg-white text-[var(--semantic-red-text)] hover:bg-[var(--semantic-red-bg)]';
export const label = localizedLabel;
export const date = (value: string | null) =>
  value ? new Date(value).toLocaleString(uiLocale()) : '—';
export const formValues = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  return new FormData(event.currentTarget);
};
export const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
export const ids = (form: FormData, key: string) =>
  form
    .getAll(key)
    .flatMap((value) => String(value).split(/[\s,]+/))
    .filter(Boolean);
export const deadline = (form: FormData) =>
  text(form, 'dueAt') ? new Date(text(form, 'dueAt')).toISOString() : null;
type CommandRun = {
  fingerprint: string;
  file?: File;
  files?: File[];
  run: (commandId: string, signal: AbortSignal) => Promise<{ resource: { id: string } }>;
};
export function useWorkflowCommand(p: WorkflowProps, onSuccess?: (id: string) => void) {
  const cache = useQueryClient();
  const lifecycle = useRef<{ active: boolean; controller?: AbortController }>({ active: true });
  const receipt = useRef<
    { fingerprint: string; file?: File; files?: File[]; commandId: string } | undefined
  >(undefined);
  useEffect(() => {
    const current = lifecycle.current;
    current.active = true;
    return () => {
      current.active = false;
      current.controller?.abort();
      for (const mutation of cache.getMutationCache().getAll())
        if (mutation.options.meta?.safetySession === p.scope)
          cache.getMutationCache().remove(mutation);
    };
  }, [cache, p.scope]);
  return useMutation({
    meta: { safetySession: p.scope },
    retry: false,
    mutationFn: async ({ fingerprint, file, files, run }: CommandRun) => {
      if (
        !receipt.current ||
        receipt.current.fingerprint !== fingerprint ||
        receipt.current.file !== file ||
        (receipt.current.files?.length ?? 0) !== (files?.length ?? 0) ||
        (files ?? []).some((f, index) => f !== receipt.current?.files?.[index])
      )
        receipt.current = {
          fingerprint,
          file,
          files: files ? [...files] : undefined,
          commandId: crypto.randomUUID(),
        };
      const controller = new AbortController();
      lifecycle.current.controller = controller;
      const result = await run(receipt.current.commandId, controller.signal);
      if (!lifecycle.current.active || controller.signal.aborted) return;
      receipt.current = undefined;
      onSuccess?.(result.resource.id);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['safety-workflow', p.apiUrl, p.scope, p.siteId] }),
        cache.invalidateQueries({ queryKey: ['notifications', p.apiUrl] }),
        cache.invalidateQueries({ queryKey: ['safety-alerts', p.apiUrl, p.scope] }),
        cache.invalidateQueries({ queryKey: ['safety-alert', p.apiUrl, p.scope] }),
      ]);
      // Do not duplicate server records or authentication credentials in mutation data.
    },
  });
}
export function photo(form: FormData) {
  const value = form.get('file');
  if (!(value instanceof File) || !value.size) return undefined;
  if (value.type !== 'image/jpeg' || value.size > 1048576)
    throw new Error(tr('safety-workflow.choose_a_jpeg_image_at_most_1_mib'));
  return value;
}
