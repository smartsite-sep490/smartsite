import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AttendanceDayDetailResponse,
  ConfirmAttendanceAbsenceCommand,
} from '@smartsite/contracts';
import { useManagementClient } from '../../../features/auth/auth-session';
import { uiLocale } from '../../../i18n';
import { userErrorMessage } from '../../../i18n/messages';
import { Button } from '../../ui';
import { teamText } from '../../team-attendance/team-attendance-copy';

export function GateAbsenceReviewCard({
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
    ConfirmAttendanceAbsenceCommand,
    'expectedVersion' | 'expectedTeamAttendanceVersion'
  > | null>(null);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const mutation = useMutation({
    mutationFn: (input: ConfirmAttendanceAbsenceCommand) =>
      client.confirmAttendanceAbsence(token, siteId, detail.day.id, input),
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
  const info = detail.gateAbsenceReview;
  if (!info) return null;
  const changed =
    !!snapshot &&
    (snapshot.expectedVersion !== detail.day.version ||
      snapshot.expectedTeamAttendanceVersion !== info.teamAttendance?.version);
  return (
    <section
      aria-label={teamText('teamWeb.absenceTitle')}
      className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm"
    >
      <h4 className="font-bold text-slate-900">{teamText('teamWeb.absenceTitle')}</h4>
      <p>
        {teamText('teamWeb.absenceEvidence', {
          gates: info.gateEventCount,
          events: info.attendanceEventCount,
          sessions: info.sessionCount,
        })}
      </p>
      {info.teamAttendance?.status === 'PRESENT' && (
        <p className="text-xs text-slate-600">
          {teamText('teamWeb.absenceRecorded', {
            time: new Date(info.teamAttendance.recordedAt).toLocaleString(uiLocale(), {
              timeZone: detail.day.timezone,
            }),
          })}
        </p>
      )}
      {info.status === 'CONFIRMED_ABSENT' ? (
        <>
          <p role="status" className="font-semibold text-emerald-800">
            {teamText('teamWeb.absenceConfirmed')}
          </p>
          <p className="whitespace-pre-wrap">{info.decision?.reason}</p>
        </>
      ) : info.status === 'CONFLICTED' ? (
        <p role="alert">{teamText('teamWeb.absenceConflict')}</p>
      ) : (
        <>
          <p>{teamText('teamWeb.absenceHint')}</p>
          {!info.canConfirm ? (
            <p className="text-xs text-slate-600">{teamText('teamWeb.absenceWaiting')}</p>
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
                {teamText('teamWeb.absenceReason')}
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
                  if (!snapshot && info.teamAttendance)
                    setSnapshot({
                      expectedVersion: detail.day.version,
                      expectedTeamAttendanceVersion: info.teamAttendance.version,
                    });
                }}
              />
              {changed && (
                <>
                  <p role="alert">{teamText('teamWeb.absenceChanged')}</p>
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
                {teamText('teamWeb.absenceConfirm')}
              </Button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
