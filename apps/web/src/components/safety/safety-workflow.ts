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
export const label = (value: string) =>
  value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (c) => c.toUpperCase());
export const date = (value: string | null) => (value ? new Date(value).toLocaleString() : '—');
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
  run: (commandId: string, signal: AbortSignal) => Promise<{ resource: { id: string } }>;
};
export function useWorkflowCommand(p: WorkflowProps, onSuccess?: (id: string) => void) {
  const cache = useQueryClient();
  const lifecycle = useRef<{ active: boolean; controller?: AbortController }>({ active: true });
  const receipt = useRef<{ fingerprint: string; file?: File; commandId: string } | undefined>(
    undefined,
  );
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
    mutationFn: async ({ fingerprint, file, run }: CommandRun) => {
      if (
        !receipt.current ||
        receipt.current.fingerprint !== fingerprint ||
        receipt.current.file !== file
      )
        receipt.current = { fingerprint, file, commandId: crypto.randomUUID() };
      const controller = new AbortController();
      lifecycle.current.controller = controller;
      const result = await run(receipt.current.commandId, controller.signal);
      if (!lifecycle.current.active || controller.signal.aborted) return;
      receipt.current = undefined;
      onSuccess?.(result.resource.id);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['safety-workflow', p.apiUrl, p.scope, p.siteId] }),
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
    throw new Error('Choose a JPEG image at most 1 MiB.');
  return value;
}
