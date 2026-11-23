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
  return (
    <section
      aria-label={teamText('teamWeb.zoneTitle')}
      className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm"
    >
      <h4 className="font-bold text-slate-900">{teamText('teamWeb.zoneTitle')}</h4>
      <p>
        {teamText('teamWeb.zoneEvidence', {
          ins: info.gateInCount,
          outs: info.gateOutCount,
          sessions: info.sessionCount,
        })}
      </p>
      <p>
        {teamText('teamWeb.zoneHours', {
          regular: attendanceHours(info.regularMinutes),
          overtime: attendanceHours(info.overtimeMinutes),
        })}
      </p>
      <p>
        {teamText('teamWeb.zoneRollCall')}{' '}
        {teamText(
          info.teamAttendanceStatus === 'PRESENT'
            ? 'teamWeb.status.PRESENT'
            : info.teamAttendanceStatus === 'ABSENT'
              ? 'teamWeb.status.ABSENT'
              : 'teamWeb.status.NOT_YET',
        )}
      </p>
      {info.decision && (
        <p className="text-xs text-slate-600">
          {teamText('teamWeb.zoneReviewedBy', {
            name: info.decision.reviewedByName ?? '',
            time: new Date(info.decision.reviewedAt).toLocaleString(uiLocale(), {
              timeZone: detail.day.timezone,
            }),
          })}
        </p>
      )}
      {info.status === 'CONFIRMED' ? (
        <>
          <p role="status" className="font-semibold text-emerald-800">
            {teamText('teamWeb.zoneConfirmed')}
          </p>
          <p className="whitespace-pre-wrap">{info.decision?.reason}</p>
        </>
      ) : (
        <>
          {info.status === 'CONFLICTED' && <p role="alert">{teamText('teamWeb.zoneConflict')}</p>}
          <p>{teamText('teamWeb.zoneHint')}</p>
          {!info.canConfirm ? (
            <p className="text-xs text-slate-600">{teamText('teamWeb.zoneWaiting')}</p>
          ) : (
            <form
              className="space-y-3"
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
              <label htmlFor={reasonId} className="block font-semibold">
                {teamText('teamWeb.zoneReason')}
              </label>
              <textarea
                id={reasonId}
                className="w-full rounded-xl border border-slate-300 bg-white p-3 focus-visible:outline-2 focus-visible:outline-orange-600"
                minLength={5}
                maxLength={1000}
                required
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
              {changed && (
                <>
                  <p role="alert">{teamText('teamWeb.zoneChanged')}</p>
                  <Button
                    variant="outline"
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
                </>
              )}
              {mutation.isError && (
                <p role="alert" className="text-rose-700">
                  {userErrorMessage(mutation.error)}
                </p>
              )}
              <Button
                type="submit"
                variant="primary"
                disabled={unavailable || changed || !snapshot || reason.trim().length < 5}
                isLoading={mutation.isPending}
              >
                {teamText('teamWeb.zoneConfirm')}
              </Button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
