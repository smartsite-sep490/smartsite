import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { AttendanceSessionResponse } from '@smartsite/api-client';
import { useTranslation, translate as tr } from '../../i18n';
import { useWorkspace } from '../workspace/workspace-context';
import { useScopedWorkers } from '../workspace/use-scoped-workers';
import { instant, required, useCommand, useRequestId } from '../shared/data';
import { Button, ErrorNotice, Field, Hint, Page, QueryState } from '../shared/ui';
import { DateTimeField } from '../shared/date-time-field';
import { RequestSheet } from '../shared/request-sheet';
import { IconChevronLeft } from '../../components/common/Icons';
import { colors } from '../../theme/colors';
import { AttendanceReviewSheet, type AttendanceReviewTarget } from './attendance-review-sheet';
import {
  AttendanceDayView,
  AttendanceCorrectionHistory,
  attendanceFullTime,
} from './attendance-day-view';

export function AttendanceDetail({ dayId, onBack }: { dayId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [session, setSession] = useState<AttendanceSessionResponse | null>(null);
  const [correctionSent, setCorrectionSent] = useState(false);
  const [review, setReview] = useState<AttendanceReviewTarget | null>(null);
  const [reviewSaved, setReviewSaved] = useState(false);
  const workers = useScopedWorkers();

  const query = useQuery({
    queryKey: [...queryKey, 'day', dayId],
    queryFn: () => client.attendanceDayDetail(token, scope.siteId, dayId),
  });

  const overview = useQuery({
    queryKey: [...queryKey, 'corrections', dayId],
    queryFn: () => client.attendanceOverview(token, scope.siteId, { dayId }),
    enabled: !!query.data && !!workers.data?.some((w) => w.id === query.data?.day.workerId),
  });

  if (!workers.isSuccess)
    return (
      <Page title={tr('attendance.workerScope')} onBack={onBack}>
        <QueryState query={workers}>{() => null}</QueryState>
      </Page>
    );

  if (query.data && !workers.data.some((w) => w.id === query.data.day.workerId))
    return (
      <Page title={tr('attendance.outOfScope')} onBack={onBack}>
        <Hint>{tr('attendance.scopeHint')}</Hint>
      </Page>
    );

  return (
    <ScrollView
      style={attStyles.screen}
      contentContainerStyle={attStyles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={attStyles.headingRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          style={attStyles.iconButton}
        >
          <IconChevronLeft size={20} color={colors.textPrimary} />
        </Pressable>
        <View style={attStyles.headingCopy}>
          <Text style={attStyles.eyebrow}>{t('tabs.attendance')}</Text>
          <Text accessibilityRole="header" style={attStyles.detailPageTitle}>
            {t('attendance.dayDetail')}
          </Text>
        </View>
      </View>
      {correctionSent && (
        <Text accessibilityLiveRegion="polite" style={attStyles.successNotice}>
          {t('attendance.adjustmentSuccess')}
        </Text>
      )}
      {reviewSaved && (
        <Text accessibilityLiveRegion="polite" style={attStyles.successNotice}>
          {t('attendanceReview.saved')}
        </Text>
      )}
      <QueryState query={query}>
        {(data) => (
          <>
            <AttendanceDayView
              detail={data}
              siteName={scope.siteName}
              canCorrect={
                scope.role === 'worker' &&
                !!overview.data?.canRequestCorrection &&
                !overview.data.hasPendingCorrection
              }
              onCorrect={setSession}
              onIgnore={
                scope.role === 'contractor'
                  ? (value) => setReview({ kind: 'duplicate', value })
                  : undefined
              }
            />
            {scope.role === 'contractor' && data.canAcknowledgeEarlyCheckout && (
              <Button
                secondary
                label={t('attendanceReview.acknowledge')}
                onPress={() => setReview({ kind: 'day', value: data.day })}
              />
            )}
            {data.zoneAttendanceReview && (
              <View style={attStyles.correctionOriginal}>
                <Text style={attStyles.quickTitle}>{t('attendanceReview.zoneTitle')}</Text>
                <Text style={attStyles.quickHint}>
                  {t('attendanceReview.zoneEvidence', {
                    ins: data.zoneAttendanceReview.gateInCount,
                    outs: data.zoneAttendanceReview.gateOutCount,
                    sessions: data.zoneAttendanceReview.sessionCount,
                  })}
                </Text>
                <Text style={attStyles.quickHint}>
                  {t('attendanceReview.zoneRollCall')}{' '}
                  {t(`labels.${data.zoneAttendanceReview.teamAttendanceStatus}`)}
                </Text>
                <Text style={attStyles.quickHint}>
                  {t(
                    data.zoneAttendanceReview.status === 'CONFIRMED'
                      ? 'attendanceReview.zoneConfirmed'
                      : data.zoneAttendanceReview.status === 'CONFLICTED'
                        ? 'attendanceReview.zoneConflict'
                        : 'attendanceReview.zoneHint',
                  )}
                </Text>
                {data.zoneAttendanceReview.decision && (
                  <>
                    <Text style={attStyles.quickHint}>
                      {t('attendanceReview.zoneReviewedBy', {
                        name: data.zoneAttendanceReview.decision.reviewedByName ?? '',
                        time: attendanceFullTime(
                          data.zoneAttendanceReview.decision.reviewedAt,
                          data.day.timezone,
                        ),
                      })}
                    </Text>
                    <Text style={attStyles.quickHint}>
                      {data.zoneAttendanceReview.decision.reason}
                    </Text>
                  </>
                )}
                {scope.role === 'contractor' && data.zoneAttendanceReview.canConfirm && (
                  <Button
                    label={t('attendanceReview.confirmZoneHours')}
                    onPress={() =>
                      setReview({
                        kind: 'zone',
                        value: data.day,
                        evidenceHash: data.zoneAttendanceReview!.evidenceHash,
                      })
                    }
                  />
                )}
              </View>
            )}
            {data.gateAbsenceReview && (
              <View style={attStyles.correctionOriginal}>
                <Text style={attStyles.quickTitle}>{t('attendanceReview.absenceTitle')}</Text>
                <Text style={attStyles.quickHint}>
                  {t('attendanceReview.absenceEvidence', {
                    gates: data.gateAbsenceReview.gateEventCount,
                    events: data.gateAbsenceReview.attendanceEventCount,
                    sessions: data.gateAbsenceReview.sessionCount,
                  })}
                </Text>
                <Text style={attStyles.quickHint}>
                  {t(
                    data.gateAbsenceReview.status === 'CONFIRMED_ABSENT'
                      ? 'attendanceReview.absenceConfirmed'
                      : data.gateAbsenceReview.status === 'CONFLICTED'
                        ? 'attendanceReview.absenceChanged'
                        : 'attendanceReview.absenceHint',
                  )}
                </Text>
                {data.gateAbsenceReview.decision && (
                  <Text style={attStyles.quickHint}>{data.gateAbsenceReview.decision.reason}</Text>
                )}
                {scope.role === 'contractor' &&
                  data.gateAbsenceReview.canConfirm &&
                  data.gateAbsenceReview.teamAttendance && (
                    <Button
                      label={t('attendanceReview.confirmAbsence')}
                      onPress={() =>
                        setReview({
                          kind: 'absence',
                          value: data.day,
                          teamAttendanceVersion: data.gateAbsenceReview!.teamAttendance!.version,
                        })
                      }
                    />
                  )}
              </View>
            )}
            <QueryState query={overview}>
              {(history) => (
                <AttendanceCorrectionHistory
                  data={history}
                  workDate={data.day.workDate}
                  timezone={data.day.timezone}
                  onReview={
                    scope.role === 'contractor'
                      ? (value) => setReview({ kind: 'correction', value })
                      : undefined
                  }
                />
              )}
            </QueryState>
          </>
        )}
      </QueryState>

      {/* Slide-up Modal: Yêu cầu sửa phiên công */}
      {review && query.data && (
        <AttendanceReviewSheet
          target={review}
          stale={
            (review.kind === 'zone' &&
              (query.isError ||
                query.isFetching ||
                review.value.id !== query.data.day.id ||
                !query.data.zoneAttendanceReview?.canConfirm ||
                review.value.version !== query.data.day.version ||
                review.evidenceHash !== query.data.zoneAttendanceReview.evidenceHash)) ||
            (review.kind === 'absence' &&
              (query.isError ||
                review.value.id !== query.data.day.id ||
                query.isFetching ||
                !query.data.gateAbsenceReview?.canConfirm ||
                review.value.version !== query.data.day.version ||
                review.teamAttendanceVersion !==
                  query.data.gateAbsenceReview.teamAttendance?.version))
          }
          timezone={query.data.day.timezone}
          onClose={() => setReview(null)}
          onSaved={() => setReviewSaved(true)}
        />
      )}
      {session && query.data && (
        <CorrectionModal
          session={session}
          timezone={query.data.day.timezone}
          visible={Boolean(session)}
          onSubmitted={() => setCorrectionSent(true)}
          onClose={() => setSession(null)}
        />
      )}
    </ScrollView>
  );
}

import { useRequestFeedback } from '../shared/request-feedback';

function CorrectionModal({
  session,
  timezone,
  visible,
  onClose,
  onSubmitted,
}: {
  session: AttendanceSessionResponse;
  timezone: string;
  visible: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const { t } = useTranslation();
  const { scope, client, token } = useWorkspace();
  const [from, setFrom] = useState(session.effectiveInAt ?? session.rawInAt ?? ''),
    [to, setTo] = useState(session.effectiveOutAt ?? session.rawOutAt ?? ''),
    [reason, setReason] = useState('');
  const command = useCommand(),
    requestId = useRequestId();
  const reportSubmitted = useRequestFeedback();

  return (
    <RequestSheet
      visible={visible}
      onClose={onClose}
      busy={command.isPending}
      title={t('attendance.requestSessionCorrection')}
      subtitle={t('attendance.correctionHint')}
      footer={
        <View style={{ marginTop: 16 }}>
          <ErrorNotice error={command.error} />
          <Button
            label={tr('attendance.submitToManager')}
            disabled={command.isPending || !from || !to || !reason.trim()}
            onPress={() =>
              command.mutate(async () => {
                const proposedInAt = instant(from),
                  proposedOutAt = instant(to);
                if (proposedOutAt <= proposedInAt) throw new Error(tr('validation.exitAfterEntry'));
                const input = {
                  expectedSessionVersion: session.version,
                  proposedInAt,
                  proposedOutAt,
                  reason: required(reason, tr('validation.reasonLabel')),
                };
                await client.requestAttendanceCorrection(token, scope.siteId, session.id, {
                  ...input,
                  requestId: requestId(input),
                });
                reportSubmitted();
                onSubmitted?.();
                onClose();
              })
            }
          />
        </View>
      }
    >
      <View style={attStyles.correctionOriginal}>
        <Text style={attStyles.quickTitle}>{t('attendanceUi.originalTimes')}</Text>
        <Text style={attStyles.quickHint}>
          {t('attendance.checkIn')}: {attendanceFullTime(session.rawInAt, timezone)}
        </Text>
        <Text style={attStyles.quickHint}>
          {t('attendance.checkOut')}: {attendanceFullTime(session.rawOutAt, timezone)}
        </Text>
      </View>
      <DateTimeField compact label={tr('attendance.proposedIn')} value={from} onChange={setFrom} />
      <DateTimeField compact label={tr('attendance.proposedOut')} value={to} onChange={setTo} />
      <Field
        label={tr('attendance.correctionReason')}
        multiline
        value={reason}
        onChangeText={setReason}
      />
    </RequestSheet>
  );
}

const attStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32, gap: 14 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  headingCopy: { flex: 1, minWidth: 0 },
  eyebrow: {
    color: colors.primary,
    fontSize: 10,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  detailPageTitle: { color: colors.textPrimary, fontSize: 22, lineHeight: 30, fontWeight: '800' },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  correctionOriginal: {
    padding: 14,
    borderRadius: 14,
    gap: 8,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  quickHint: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
  successNotice: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.successBg,
    color: colors.successText,
    fontSize: 14,
    lineHeight: 21,
  },
});
