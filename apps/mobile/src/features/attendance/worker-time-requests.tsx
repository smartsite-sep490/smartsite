import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '../../i18n';
import { localizedLabel } from '../../i18n/messages';
import { colors } from '../../theme/colors';
import { useWorkspace } from '../workspace/workspace-context';
import { displayTime } from '../shared/data';
import { Button, Hint, Pager, QueryState } from '../shared/ui';

export function WorkerTimeRequests({
  onCreate,
}: {
  onCreate: (kind: 'LEAVE' | 'OVERTIME') => void;
}) {
  const { t } = useTranslation();
  const { client, token, scope, workerId, queryKey } = useWorkspace();
  const [kind, setKind] = useState<'LEAVE' | 'OVERTIME'>('LEAVE');
  const [status, setStatus] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [offset, setOffset] = useState(0);
  const size = 8;
  const query = useQuery({
    queryKey: [...queryKey, 'worker-time-requests', kind, status, offset, workerId],
    enabled: scope.role === 'worker' && !!workerId,
    queryFn: async () => {
      const result = await client.attendanceTimeRequests(token, scope.siteId, {
        kind,
        workerId,
        offset,
        limit: size,
        ...(status === 'ALL' ? {} : { status }),
      });
      return { ...result, items: result.items.filter((r) => r.workerId === workerId) };
    },
    refetchInterval: 15000,
  });
  return (
    <>
      <View style={styles.kindRow}>
        {(['LEAVE', 'OVERTIME'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={t(
              value === 'LEAVE' ? 'attendanceUi.leaveAction' : 'attendanceUi.overtimeAction',
            )}
            accessibilityState={{ selected: kind === value }}
            style={[styles.kindButton, kind === value && styles.selectedKind]}
            onPress={() => {
              setKind(value);
              setOffset(0);
            }}
          >
            <Text style={[styles.kindText, kind === value && styles.selectedKindText]}>
              {t(value === 'LEAVE' ? 'attendanceUi.leaveAction' : 'attendanceUi.overtimeAction')}
            </Text>
          </Pressable>
        ))}
      </View>
      <Button label={t('attendanceUi.newRequest')} onPress={() => onCreate(kind)} />
      <View style={styles.filters}>
        {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={t(
              `attendanceUi.${value === 'ALL' ? 'allStatuses' : value.toLowerCase()}`,
            )}
            accessibilityState={{ selected: status === value }}
            onPress={() => {
              setStatus(value);
              setOffset(0);
            }}
            style={[styles.filter, status === value && styles.activeFilter]}
          >
            <Text style={[styles.filterText, status === value && styles.activeFilterText]}>
              {t(`attendanceUi.${value === 'ALL' ? 'allStatuses' : value.toLowerCase()}`)}
            </Text>
          </Pressable>
        ))}
      </View>
      <QueryState query={query}>
        {(data) => (
          <>
            {!data.items.length && (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>{t('attendanceUi.emptyRequests')}</Text>
                <Hint>{t('attendanceUi.emptyRequestsHint')}</Hint>
              </View>
            )}
            {data.items.map((r) => {
              const approved = r.status === 'APPROVED',
                rejected = r.status === 'REJECTED';
              const tint = approved
                ? colors.successText
                : rejected
                  ? colors.dangerText
                  : colors.warningText;
              const bg = approved
                ? colors.successBg
                : rejected
                  ? colors.dangerBg
                  : colors.warningBg;
              return (
                <View key={r.id} style={styles.card}>
                  <View style={styles.cardHeading}>
                    <Text style={styles.cardTitle}>
                      {t(
                        r.kind === 'LEAVE'
                          ? 'attendanceUi.leaveAction'
                          : 'attendanceUi.overtimeAction',
                      )}
                    </Text>
                    <View style={[styles.badge, { backgroundColor: bg }]}>
                      <Text style={[styles.badgeText, { color: tint }]}>
                        {localizedLabel(r.status)}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.period}>
                    {displayTime(r.startsAt)} → {displayTime(r.endsAt)}
                  </Text>
                  <Text style={styles.label}>{t('attendanceUi.requestReason')}</Text>
                  <Text style={styles.reason}>{r.reason}</Text>
                  {r.kind === 'LEAVE' && r.noticeType && (
                    <Text style={styles.meta}>
                      {t(
                        r.noticeType === 'EMERGENCY'
                          ? 'leavePolicy.emergency'
                          : 'leavePolicy.planned',
                      )}
                    </Text>
                  )}
                  {r.submittedOnBehalf && (
                    <Text style={styles.meta}>{t('leavePolicy.submittedOnBehalf')}</Text>
                  )}
                  {r.createdAt && (
                    <Text style={styles.meta}>
                      {t('attendanceUi.submittedOn')} {displayTime(r.createdAt)}
                    </Text>
                  )}
                  {r.reviewNote && (
                    <View style={[styles.review, { backgroundColor: bg }]}>
                      <Text style={[styles.label, { color: tint }]}>
                        {t('attendanceUi.reviewNote')}
                      </Text>
                      <Text style={[styles.reason, { color: tint }]}>{r.reviewNote}</Text>
                    </View>
                  )}
                </View>
              );
            })}
            <Pager offset={offset} total={data.total} size={size} onChange={setOffset} />
          </>
        )}
      </QueryState>
    </>
  );
}

const styles = StyleSheet.create({
  kindRow: { flexDirection: 'row', gap: 10 },
  kindButton: {
    flex: 1,
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  selectedKind: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  kindText: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  selectedKindText: { color: colors.primary },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  activeFilter: { borderColor: colors.slateDark, backgroundColor: colors.slateDark },
  filterText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  activeFilterText: { color: '#FFFFFF' },
  card: {
    padding: 18,
    borderRadius: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  period: { fontSize: 14, lineHeight: 22, color: colors.textPrimary, fontWeight: '600' },
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  reason: { fontSize: 14, lineHeight: 22, color: colors.textPrimary },
  meta: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
  review: { borderRadius: 12, padding: 12, gap: 5 },
  empty: { padding: 24, backgroundColor: colors.surface, borderRadius: 18, gap: 10 },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
});
