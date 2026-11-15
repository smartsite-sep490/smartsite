import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { AttendanceSessionResponse } from '@smartsite/api-client';
import { localizedLabel } from '../../i18n/messages';
import { useTranslation, translate as tr, uiLocale } from '../../i18n';
import { useWorkspace } from '../workspace/workspace-context';
import { useScopedWorkers } from '../workspace/use-scoped-workers';
import { displayTime, instant, minutes, required, useCommand, useRequestId } from '../shared/data';
import { Body, Button, ErrorNotice, Field, Hint, Page, QueryState } from '../shared/ui';
import { DateTimeField } from '../shared/date-time-field';
import { RequestSheet } from '../shared/request-sheet';
import {
  IconChevronLeft,
  IconChevronDown,
  IconChevronUp,
  IconClock,
} from '../../components/common/Icons';
import { colors } from '../../theme/colors';

export function AttendanceDetail({ dayId, onBack }: { dayId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [session, setSession] = useState<AttendanceSessionResponse | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [correctionSent, setCorrectionSent] = useState(false);
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
      <QueryState query={query}>
        {(data) => (
          <>
            {/* Header Stats Card */}
            <View style={attStyles.detailHeaderCard}>
              <View style={attStyles.detailTitleRow}>
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Text style={attStyles.detailWorkerName}>{data.day.workerName}</Text>
                  <Text style={attStyles.detailSubInfo}>
                    {data.day.workDate} · {data.day.shiftName}
                  </Text>
                </View>
                <View style={attStyles.detailStatusBadge}>
                  <Text style={attStyles.detailStatusText}>{localizedLabel(data.day.status)}</Text>
                </View>
              </View>

              <View style={attStyles.detailStatsGrid}>
                <View style={attStyles.detailStatCol}>
                  <Text style={attStyles.detailStatNumGreen}>
                    {data.day.confirmedMinutes === null ? '—' : minutes(data.day.confirmedMinutes)}
                  </Text>
                  <Text style={attStyles.detailStatLabel}>{t('attendance.confirmedHours')}</Text>
                </View>
                <View style={attStyles.colDivider} />
                <View style={attStyles.detailStatCol}>
                  <Text style={attStyles.detailStatNumOrange}>
                    {minutes(data.day.overtimeMinutes)}
                  </Text>
                  <Text style={attStyles.detailStatLabel}>{t('attendance.overtime')}</Text>
                </View>
                <View style={attStyles.colDivider} />
                <View style={attStyles.detailStatCol}>
                  <Text style={attStyles.detailStatNumGray}>{data.day.exitCount ?? 0}</Text>
                  <Text style={attStyles.detailStatLabel}>{t('workerHome.gateExits')}</Text>
                </View>
              </View>
            </View>

            {/* Vertical Timeline of In/Out Sessions (Matching Lovable) */}
            <View style={attStyles.timelineSection}>
              <Text style={attStyles.sectionTitle}>{t('attendance.timeline')}</Text>
              {!data.sessions.length && <Hint>{tr('attendance.noSessions')}</Hint>}
              {data.sessions.map((s, index) => {
                const isLast = index === data.sessions.length - 1;
                const entry = s.effectiveInAt ?? s.rawInAt;
                return (
                  <View key={s.id} style={attStyles.timelineRow}>
                    <View style={attStyles.timelineTrackCol}>
                      <Text style={attStyles.sessionRailTime}>
                        {entry
                          ? new Date(entry).toLocaleTimeString(uiLocale(), {
                              timeZone: data.day.timezone,
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            })
                          : '—'}
                      </Text>
                      <View style={attStyles.timelineDot} />
                      {!isLast && <View style={attStyles.timelineTrackLine} />}
                    </View>

                    <View style={attStyles.sessionCard}>
                      <View style={attStyles.sessionCardHeader}>
                        <Text style={attStyles.sessionCardTitle}>
                          {t('attendance.sessionCount', { index: index + 1 })} ·{' '}
                          {localizedLabel(s.status)}
                        </Text>
                        <View style={attStyles.workedBadge}>
                          <Text style={attStyles.workedBadgeText}>{minutes(s.workedMinutes)}</Text>
                        </View>
                      </View>

                      <View style={attStyles.sessionClockRow}>
                        <IconClock size={15} color={colors.primary} />
                        <Text style={attStyles.sessionTimes}>
                          {displayTime(s.effectiveInAt ?? s.rawInAt)} →{' '}
                          {displayTime(s.effectiveOutAt ?? s.rawOutAt)}
                        </Text>
                      </View>
                      <Text style={attStyles.sessionRawTimes}>
                        {t('attendance.rawTime', {
                          in: displayTime(s.rawInAt),
                          out: displayTime(s.rawOutAt),
                        })}
                      </Text>

                      {scope.role === 'worker' &&
                        overview.data?.canRequestCorrection &&
                        !overview.data.hasPendingCorrection &&
                        s.status !== 'IGNORED_DUPLICATE' && (
                          <Button
                            secondary
                            label={t('attendance.requestSessionCorrection')}
                            onPress={() => setSession(s)}
                          />
                        )}
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Collapsible Rules Card */}
            <View style={attStyles.rulesCard}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('attendance.rulesTitle')}
                accessibilityState={{ expanded: showRules }}
                style={attStyles.rulesHeader}
                onPress={() => setShowRules(!showRules)}
              >
                <Text style={attStyles.rulesTitle}>{t('attendance.rulesTitle')}</Text>
                {showRules ? (
                  <IconChevronUp size={18} color="#64748B" />
                ) : (
                  <IconChevronDown size={18} color="#64748B" />
                )}
              </Pressable>
              {showRules && (
                <Text style={attStyles.rulesContent}>{t('attendance.rulesContent')}</Text>
              )}
            </View>
          </>
        )}
      </QueryState>

      {/* Correction History */}
      <QueryState query={overview}>
        {(data) => (
          <View style={attStyles.secondaryCard}>
            <Text style={attStyles.listTitle}>{t('attendance.correctionHistory')}</Text>
            {data.hasPendingCorrection && <Hint>{t('attendance.pendingCorrectionWarning')}</Hint>}
            {!data.corrections.length && <Hint>{t('attendance.noRequests')}</Hint>}
            {data.corrections.map((c) => (
              <Body key={c.id}>
                {c.reason} · {localizedLabel(c.status)} · {displayTime(c.proposedInAt)} →{' '}
                {displayTime(c.proposedOutAt)}
                {c.reviewNote ? ` · ${c.reviewNote}` : ''}
              </Body>
            ))}
          </View>
        )}
      </QueryState>

      {/* Slide-up Modal: Yêu cầu sửa phiên công */}
      {session && (
        <CorrectionModal
          session={session}
          visible={Boolean(session)}
          onSubmitted={() => setCorrectionSent(true)}
          onClose={() => setSession(null)}
        />
      )}
    </ScrollView>
  );
}

function CorrectionModal({
  session,
  visible,
  onClose,
  onSubmitted,
}: {
  session: AttendanceSessionResponse;
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
          {t('attendance.checkIn')}: {displayTime(session.rawInAt)}
        </Text>
        <Text style={attStyles.quickHint}>
          {t('attendance.checkOut')}: {displayTime(session.rawOutAt)}
        </Text>
      </View>
      <DateTimeField label={tr('attendance.proposedIn')} value={from} onChange={setFrom} />
      <DateTimeField label={tr('attendance.proposedOut')} value={to} onChange={setTo} />
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
  correctionOriginal: {
    padding: 14,
    borderRadius: 14,
    gap: 8,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  quickHint: { fontSize: 12, lineHeight: 18, color: colors.textMuted },
  successNotice: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.successBg,
    color: colors.successText,
    fontSize: 14,
    lineHeight: 21,
  },
  secondaryCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 32, gap: 18 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headingCopy: { flex: 1, minWidth: 0 },
  eyebrow: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  detailPageTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
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
  listTitle: { flex: 1, color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
  sessionRailTime: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginTop: 14 },
  sessionClockRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  colDivider: {
    width: 1,
    height: 38,
    backgroundColor: '#E2E8F0',
  },
  detailHeaderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    gap: 14,
    shadowColor: '#0F1E36',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  detailTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 10,
  },
  detailWorkerName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F1E36',
  },
  detailSubInfo: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  detailStatusBadge: {
    backgroundColor: '#EDFAF2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  detailStatusText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#065F46',
  },
  detailStatsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F1F5F9',
  },
  detailStatCol: {
    flex: 1,
    alignItems: 'center',
  },
  detailStatNumGreen: {
    fontSize: 20,
    fontWeight: '800',
    color: '#10B981',
  },
  detailStatNumOrange: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F66B17',
  },
  detailStatNumGray: {
    fontSize: 20,
    fontWeight: '800',
    color: '#64748B',
  },
  detailStatLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 2,
  },
  timelineSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F1E36',
    marginBottom: 12,
  },
  timelineRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timelineTrackCol: {
    alignItems: 'center',
    width: 43,
  },
  timelineDot: {
    marginTop: 10,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#F66B17',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#F66B17',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 2,
  },
  timelineTrackLine: {
    flex: 1,
    width: 2,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
  sessionCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    gap: 8,
    shadowColor: '#0F1E36',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 2,
  },
  sessionCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  sessionCardTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: '#0F1E36',
    flexShrink: 1,
    lineHeight: 22,
  },
  workedBadge: {
    backgroundColor: '#EDFAF2',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  workedBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#065F46',
  },
  sessionTimes: {
    flex: 1,
    fontSize: 13,
    lineHeight: 21,
    fontWeight: '800',
    color: '#0F1E36',
  },
  sessionRawTimes: {
    fontSize: 13,
    color: '#64748B',
  },
  rulesCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  rulesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rulesTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#334155',
  },
  rulesContent: {
    fontSize: 13.5,
    color: '#64748B',
    lineHeight: 20,
    marginTop: 8,
  },
});
