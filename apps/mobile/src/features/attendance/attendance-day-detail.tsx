import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { AttendanceSessionResponse } from '@smartsite/api-client';
import { useTranslation, translate as tr } from '../../i18n';
import { useWorkspace } from '../workspace/workspace-context';
import { useScopedWorkers } from '../workspace/use-scoped-workers';
import { Button, Hint, Page, QueryState } from '../shared/ui';
import { IconChevronLeft } from '../../components/common/Icons';
import { colors } from '../../theme/colors';
import { AttendanceReviewSheet, type AttendanceReviewTarget } from './attendance-review-sheet';
import { CorrectionModal } from './correction-modal';
import { MissingAttendance } from './missing-attendance';
import {
  AttendanceDayView,
  AttendanceDisclosure,
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
      {scope.role === 'worker' &&
        query.data &&
        workers.data.some((w) => w.id === query.data?.day.workerId) && (
          <MissingAttendance dayId={dayId} />
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
                <AttendanceDisclosure title={t('attendanceReview.zoneTitle')}>
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
                </AttendanceDisclosure>
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
                <AttendanceDisclosure title={t('attendanceReview.absenceTitle')}>
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
                  {!!data.gateAbsenceReview.emptyRejectedReportCount && (
                    <Text style={attStyles.quickHint}>
                      {t('attendanceReview.absenceRejectedReport', {
                        count: data.gateAbsenceReview.emptyRejectedReportCount,
                      })}
                    </Text>
                  )}
                  {data.gateAbsenceReview.decision && (
                    <Text style={attStyles.quickHint}>
                      {data.gateAbsenceReview.decision.reason}
                    </Text>
                  )}
                </AttendanceDisclosure>
                {scope.role === 'contractor' && data.gateAbsenceReview.canConfirm && (
                  <Button
                    label={t('attendanceReview.confirmAbsence')}
                    onPress={() =>
                      setReview({
                        kind: 'absence',
                        value: data.day,
                        teamAttendanceVersion:
                          data.gateAbsenceReview!.expectedTeamAttendanceVersion ??
                          data.gateAbsenceReview!.teamAttendance?.version ??
                          0,
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
                  (query.data.gateAbsenceReview.expectedTeamAttendanceVersion ??
                    query.data.gateAbsenceReview.teamAttendance?.version)))
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
