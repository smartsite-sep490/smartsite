import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { ContractorTeamCalendarItem } from '@smartsite/api-client';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { useWorkspace } from '../workspace/workspace-context';
import { Button, Pager, QueryState } from '../shared/ui';
import { RollCallBadge } from '../scheduling/schedule-day-sheet';

export function ContractorTeamAttendancePanel({
  item,
  onDay,
}: {
  item: ContractorTeamCalendarItem;
  onDay: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { client, token, scope, queryKey } = useWorkspace();
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: [
      ...queryKey,
      'contractor-zone-attendance',
      item.teamId,
      item.workDate,
      item.shiftId,
      item.scheduleVersionId,
      offset,
    ],
    queryFn: () =>
      client.contractorTeamAttendance(token, scope.siteId, scope.contractorId, item.teamId, {
        workDate: item.workDate,
        shiftId: item.shiftId,
        scheduleVersionId: item.scheduleVersionId,
        offset,
        limit: 8,
      }),
    refetchInterval: 15000,
  });
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('teamReview.title')}
      </Text>
      <Text style={styles.hint}>{t('teamReview.hint')}</Text>
      <QueryState query={query}>
        {(data) => (
          <>
            <View style={styles.metrics}>
              {[
                ['present', data.present],
                ['absent', data.absent],
                ['pending', data.pending],
                ['matched', data.matched],
              ].map(([key, count]) => (
                <View key={key} style={styles.metric}>
                  <Text style={styles.count}>{count}</Text>
                  <Text style={styles.hint}>{t(`teamReview.${key}`)}</Text>
                </View>
              ))}
            </View>
            {!data.items.length && <Text style={styles.hint}>{t('common.noData')}</Text>}
            {data.items.map((member) => (
              <View key={member.scheduleId} style={styles.member}>
                <View style={styles.row}>
                  <Text style={styles.name}>{member.displayName}</Text>
                  <RollCallBadge status={member.status} />
                </View>
                {member.zoneName && <Text style={styles.hint}>{member.zoneName}</Text>}
                <Text
                  style={[
                    styles.hint,
                    member.gateCheck === 'MATCHED' ? styles.success : styles.notice,
                  ]}
                >
                  {t(
                    member.gateCheck === 'NOT_YET'
                      ? 'teamReview.notCompared'
                      : `rollCall.gate${member.gateCheck}`,
                  )}
                </Text>
                {member.dayId && (
                  <Button
                    secondary
                    label={t('attendance.dayDetail')}
                    onPress={() => onDay(member.dayId!)}
                  />
                )}
              </View>
            ))}
            {data.total > 8 && (
              <Pager offset={offset} total={data.total} size={8} onChange={setOffset} />
            )}
          </>
        )}
      </QueryState>
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: 12, borderTopWidth: 1, borderColor: colors.borderLight, paddingTop: 16 },
  title: { fontSize: 15, lineHeight: 23, fontWeight: '700', color: colors.textPrimary },
  hint: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: {
    flexGrow: 1,
    flexBasis: 100,
    borderRadius: 12,
    padding: 10,
    gap: 4,
    backgroundColor: colors.surfaceSubtle,
  },
  count: { fontSize: 21, lineHeight: 28, fontWeight: '700', color: colors.textPrimary },
  member: { padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 14, gap: 8 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  success: { color: colors.successText },
  notice: { color: colors.warningText },
});
