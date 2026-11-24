import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AttendanceDayDetailResponse,
  ConfirmAttendanceZoneHoursCommand,
} from '@smartsite/contracts';
import { useManagementClient } from '../../../features/auth/auth-session';
import { uiLocale } from '../../../i18n';
import { userErrorMessage } from '../../../i18n/messages';
import { Button } from '../../ui';
import { attendanceHours } from './attendance-display';
import { teamText } from '../../team-attendance/team-attendance-copy';
import {
  IconCheckCircle2,
  IconClock,
  IconShield,
  IconUsers,
  IconAlertCircle,
  IconAlertTriangle,
  IconUser,
} from '../../icons';

export function ZoneAttendanceReviewCard({
  detail,
  apiUrl,
  token,
  siteId,
  sessionScope,
  unavailable = false,
}: {
  detail: AttendanceDayDetailResponse;
  apiUrl: string;
  token: string;
  siteId: string;
  sessionScope: string;
  unavailable?: boolean;
}) {
  useTranslation();
  const client = useManagementClient(apiUrl),
    cache = useQueryClient(),
    reasonId = useId();
  const [reason, setReason] = useState('');
  const [snapshot, setSnapshot] = useState<Pick<
    ConfirmAttendanceZoneHoursCommand,
    'expectedVersion' | 'evidenceHash'
  > | null>(null);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const mutation = useMutation({
    mutationFn: (input: ConfirmAttendanceZoneHoursCommand) =>
      client.confirmAttendanceZoneHours(token, siteId, detail.day.id, input),
    onSuccess: async () => {
      setReason('');
      setSnapshot(null);
      await Promise.all([
        ...[
          'attendance-day-detail',
          'attendance-days',
          'attendance',
          'attendance-summary',
          'attendance-workers',
          'attendance-worker-report',
          'attendance-timesheets',
        ].map((name) =>
          cache.invalidateQueries({ queryKey: [name, apiUrl, sessionScope, siteId] }),
        ),
        cache.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
    },
  });

  const info = detail.zoneAttendanceReview;
  if (!info) return null;

  const changed =
    !!snapshot &&
    (snapshot.expectedVersion !== detail.day.version ||
      snapshot.evidenceHash !== info.evidenceHash);
  const isConfirmed = info.status === 'CONFIRMED';
  const isConflicted = info.status === 'CONFLICTED';

  return (
    <section
      id="zone-hours-review"
      aria-label={teamText('teamWeb.zoneTitle')}
      className={`rounded-2xl p-1.5 transition-all shadow-xs ${
        isConfirmed
          ? 'border border-emerald-200/90 bg-emerald-50/40'
          : isConflicted
            ? 'border border-rose-200/90 bg-rose-50/40'
            : 'border border-amber-200/90 bg-amber-50/40'
      }`}
    >
      <div className="rounded-xl bg-white p-5 border border-slate-100/90 shadow-2xs space-y-4">
        {/* Header with Title and Status Badge */}
        <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase ${
                  isConfirmed
                    ? 'bg-emerald-100/80 text-emerald-800 border border-emerald-200/70'
                    : isConflicted
                      ? 'bg-rose-100/80 text-rose-800 border border-rose-200/70'
                      : 'bg-amber-100/80 text-amber-800 border border-amber-200/70'
                }`}
              >
                {isConfirmed ? (
                  <IconCheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <IconAlertCircle className="w-3.5 h-3.5 text-amber-600" />
                )}
                <span>
                  {isConfirmed
                    ? teamText('teamWeb.zoneBadgeConfirmed')
                    : teamText('teamWeb.zoneBadgePending')}
                </span>
              </span>
            </div>
            <h4 className="text-base font-bold text-[#071A2B] tracking-tight">
              {teamText('teamWeb.zoneTitle')}
            </h4>
          </div>

          {info.decision && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200/70 text-xs text-slate-600">
              <IconUser className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-medium">
                {teamText('teamWeb.zoneReviewedBy', {
                  name: info.decision.reviewedByName ?? info.decision.reviewedBy ?? '',
                  time: new Date(info.decision.reviewedAt).toLocaleString(uiLocale(), {
                    timeZone: detail.day.timezone,
                  }),
                })}
              </span>
            </div>
          )}
        </div>

        {/* 3-Column Structured Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Gate Evidence */}
          <div className="p-3.5 rounded-xl bg-slate-50/70 border border-slate-200/70 space-y-1.5">
            <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-wider">
              <IconShield className="w-3.5 h-3.5 text-sky-500 shrink-0" />
              <span>{teamText('teamWeb.zoneCardGate')}</span>
            </div>
            <p className="font-semibold text-slate-800 text-xs tabular-nums leading-relaxed">
              {teamText('teamWeb.zoneEvidence', {
                ins: info.gateInCount,
                outs: info.gateOutCount,
                sessions: info.sessionCount,
              })}
            </p>
          </div>

          {/* Shift Hours */}
          <div className="p-3.5 rounded-xl bg-slate-50/70 border border-slate-200/70 space-y-1.5">
            <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-wider">
              <IconClock className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <span>{teamText('teamWeb.zoneCardHours')}</span>
            </div>
            <p className="font-semibold text-slate-800 text-xs tabular-nums leading-relaxed">
              {teamText('teamWeb.zoneHours', {
                regular: attendanceHours(info.regularMinutes),
                overtime: attendanceHours(info.overtimeMinutes),
              })}
            </p>
          </div>

          {/* Leader Roll Call */}
          <div className="p-3.5 rounded-xl bg-slate-50/70 border border-slate-200/70 space-y-1.5">
            <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-wider">
              <IconUsers className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>{teamText('teamWeb.zoneCardRollCall')}</span>
            </div>
            <div className="font-semibold text-slate-800 text-xs flex items-center gap-1.5 flex-wrap">
              <span>{teamText('teamWeb.zoneRollCall')}</span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold ${
                  info.teamAttendanceStatus === 'PRESENT'
                    ? 'bg-emerald-100 text-emerald-800'
                    : info.teamAttendanceStatus === 'ABSENT'
                      ? 'bg-rose-100 text-rose-800'
                      : 'bg-amber-100 text-amber-800'
                }`}
              >
                {teamText(
                  info.teamAttendanceStatus === 'PRESENT'
                    ? 'teamWeb.status.PRESENT'
                    : info.teamAttendanceStatus === 'ABSENT'
                      ? 'teamWeb.status.ABSENT'
                      : 'teamWeb.status.NOT_YET',
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Confirmed State vs Pending Form */}
        {isConfirmed ? (
          <div className="space-y-3 pt-1">
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-emerald-50/80 border border-emerald-200/80 text-emerald-900 text-xs">
              <IconCheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <p role="status" className="font-semibold leading-relaxed">
                {teamText('teamWeb.zoneConfirmed')}
              </p>
            </div>

            {info.decision?.reason && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  {teamText('teamWeb.zoneReason')}
                </span>
                <p className="text-xs font-medium text-slate-800 whitespace-pre-wrap leading-relaxed italic">
                  {info.decision.reason}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 pt-1">
            {isConflicted && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center gap-2"
              >
                <IconAlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{teamText('teamWeb.zoneConflict')}</span>
              </div>
            )}

            <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/60 text-amber-900 text-xs leading-relaxed flex items-start gap-2">
              <IconAlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{teamText('teamWeb.zoneHint')}</span>
            </div>

            {!info.canConfirm ? (
              <p className="text-xs text-slate-500 italic bg-slate-50 p-2.5 rounded-lg border border-slate-200/60">
                {teamText('teamWeb.zoneWaiting')}
              </p>
            ) : (
              <form
                className="space-y-3 pt-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (
                    !snapshot ||
                    !info.canConfirm ||
                    unavailable ||
                    changed ||
                    mutation.isPending ||
                    reason.trim().length < 5
                  )
                    return;
                  const input = { ...snapshot, reason: reason.trim() };
                  const fingerprint = JSON.stringify(input);
                  if (request.current?.fingerprint !== fingerprint)
                    request.current = { fingerprint, id: crypto.randomUUID() };
                  mutation.mutate({ ...input, requestId: request.current.id });
                }}
              >
                <div className="space-y-1.5">
                  <label htmlFor={reasonId} className="block text-xs font-bold text-slate-700">
                    {teamText('teamWeb.zoneReason')}
                  </label>
                  <textarea
                    id={reasonId}
                    className="w-full rounded-xl border border-slate-300 bg-white p-3 text-xs text-slate-800 focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/20 focus:outline-none transition-all placeholder:text-slate-400"
                    rows={3}
                    minLength={5}
                    maxLength={1000}
                    required
                    placeholder={teamText('teamWeb.zoneReasonPlaceholder')}
                    value={reason}
                    disabled={mutation.isPending || unavailable}
                    onChange={(event) => {
                      setReason(event.target.value);
                      mutation.reset();
                      if (!snapshot)
                        setSnapshot({
                          expectedVersion: detail.day.version,
                          evidenceHash: info.evidenceHash,
                        });
                    }}
                  />
                </div>

                {changed && (
                  <div
                    role="alert"
                    className="flex items-center justify-between p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800"
                  >
                    <span>{teamText('teamWeb.zoneChanged')}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSnapshot(null);
                        setReason('');
                        request.current = null;
                        mutation.reset();
                        void cache.invalidateQueries({
                          queryKey: [
                            'attendance-day-detail',
                            apiUrl,
                            sessionScope,
                            siteId,
                            detail.day.id,
                          ],
                        });
                      }}
                    >
                      {teamText('teamWeb.refresh')}
                    </Button>
                  </div>
                )}

                {mutation.isError && (
                  <p role="alert" className="text-xs text-rose-700 font-medium">
                    {userErrorMessage(mutation.error)}
                  </p>
                )}

                <div className="flex justify-end pt-1">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={unavailable || changed || !snapshot || reason.trim().length < 5}
                    isLoading={mutation.isPending}
                    className="px-5 py-2 rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                  >
                    {teamText('teamWeb.zoneConfirm')}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
