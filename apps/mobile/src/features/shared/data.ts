import { translate as tr, uiLocale } from '../../i18n';
import { useRef } from 'react';
import * as Crypto from 'expo-crypto';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, type Page } from '@smartsite/api-client';

export async function allPages<T>(
  load: (options: { offset: number; limit: number }) => Promise<Page<T>>,
  signal?: AbortSignal,
): Promise<T[]> {
  const items: T[] = [];
  for (;;) {
    if (signal?.aborted) throw new ApiError('cancelled', tr('validation.loadCancelled'));
    const result = await load({ offset: items.length, limit: 100 });
    if (signal?.aborted) throw new ApiError('cancelled', tr('validation.loadCancelled'));
    items.push(...result.items);
    if (items.length >= result.total) return items;
    if (!result.items.length) throw new Error(tr('validation.incompleteData'));
  }
}
export function useCommand() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (operation: () => Promise<unknown>) => operation(),
    retry: false,
    onSuccess: () => cache.invalidateQueries({ queryKey: ['mobile'] }),
    onError: () => {
      void cache.invalidateQueries({ queryKey: ['mobile'] });
    },
  });
}
/** Keep the same ID for retries of the same payload; edits create a new command. */
export function useRequestId() {
  const current = useRef<{ fingerprint: string; id: string } | null>(null);
  return (input: unknown) => {
    const fingerprint = JSON.stringify(input);
    if (current.current?.fingerprint !== fingerprint)
      current.current = { fingerprint, id: Crypto.randomUUID() };
    return current.current.id;
  };
}
export function localDate(
  value = new Date(),
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}-${parts.find((p) => p.type === 'day')!.value}`;
}
export function instant(value: string) {
  const result = new Date(value);
  if (!value.trim() || !Number.isFinite(+result)) throw new Error(tr('validation.invalidInstant'));
  return result.toISOString();
}
export function displayTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString(uiLocale()) : tr('common.notRecorded');
}
export function displayShiftTime(value: string | null | undefined) {
  if (!value) return tr('common.notRecorded');
  const d = new Date(value);
  if (!Number.isFinite(+d)) return tr('common.notRecorded');
  return d.toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit', hour12: false });
}
export function minutes(value: number | null | undefined) {
  return value === null || value === undefined
    ? tr('common.notConfirmed')
    : tr('common.duration', { hours: Math.floor(value / 60), minutes: value % 60 });
}
export function required(value: string, label: string) {
  if (!value.trim()) throw new Error(tr('validation.required', { label }));
  return value.trim();
}
export function validDates(from: string, to: string) {
  for (const day of [from, to])
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Number.isFinite(Date.parse(day)) ||
      new Date(day).toISOString().slice(0, 10) !== day
    )
      throw new Error(tr('validation.calendarDate'));
  if (from > to) throw new Error(tr('validation.dateRange'));
}
