import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { NavigationTarget } from '../../SmartSiteMobileApp';
import {
  IconCalendar,
  IconChevronRight,
  IconClock,
  IconDocument,
  IconShield,
  IconUsers,
} from '../../components/common/Icons';
import { WorkerAvatar } from '../../components/common/WorkerAvatar';
import { CreateWorkerModal } from '../../components/modals/CreateWorkerModal';
import { ScheduleAssignModal } from '../../components/modals/ScheduleAssignModal';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { Button, Card, Disclosure, Page, QueryState } from '../shared/ui';
import { useWorkspace } from '../workspace/workspace-context';

export function ContractorHome({ navigate }: { navigate: (target: NavigationTarget) => void }) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const dashboard = useQuery({
    queryKey: [...queryKey, 'dashboard'],
    queryFn: () => client.contractorDashboard(token, scope.siteId, scope.contractorId),
  });
  const requests = useQuery({
    queryKey: [...queryKey, 'contractor-requests-count'],
    queryFn: () => client.listShiftRequests(token, scope.siteId, { view: 'REVIEW', limit: 1 }),
  });
  return (
    <Page title={t('tabs.overview')}>
      <View style={styles.context}>
        <View style={styles.contextCopy}>
          <Text numberOfLines={2} style={styles.contractor}>
            {scope.contractorName}
          </Text>
          <Text numberOfLines={1} style={styles.site}>
            {scope.siteName}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('header.account')}
          onPress={() => navigate({ route: 'profile' })}
          style={styles.avatar}
        >
          <WorkerAvatar role="contractor" size={42} />
        </Pressable>
      </View>
      <QueryState query={dashboard}>
        {(data) => (
          <Card>
            <View style={styles.metrics}>
              <View style={styles.metric}>
                <Text style={styles.metricValue}>{data.workerCount}</Text>
                <Text numberOfLines={1} ellipsizeMode="tail" style={styles.metricLabel}>
                  {t('profile.totalWorkforce')}
                </Text>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metric}>
                <Text style={styles.metricValue}>{data.teamCount}</Text>
                <Text numberOfLines={1} ellipsizeMode="tail" style={styles.metricLabel}>
                  {t('profile.totalTeams')}
                </Text>
              </View>
            </View>
            {data.unassignedWorkerCount > 0 && (
              <Text style={styles.notice}>
                {t('contractorUi.unassigned', { count: data.unassignedWorkerCount })}
              </Text>
            )}
          </Card>
        )}
      </QueryState>
      <Text style={styles.sectionTitle}>{t('contractorUi.quickActions')}</Text>
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button label={t('contractorHome.addWorker')} onPress={() => setCreating(true)} />
        </View>
        <View style={styles.action}>
          <Button
            secondary
            label={t('contractorHome.assignSchedule')}
            onPress={() => setAssigning(true)}
          />
        </View>
      </View>
      <QueryState query={requests}>
        {(data) => (
          <HomeAction
            title={t('contractorHome.pendingRequests')}
            subtitle={t('contractorUi.pending', { count: data.pendingCount })}
            icon={<IconDocument size={21} color={colors.primary} />}
            onPress={() => navigate({ route: 'requests' })}
          />
        )}
      </QueryState>
      <HomeAction
        title={t('contractorHome.teamAttendance')}
        subtitle={t('contractorUi.attendanceHint')}
        icon={<IconClock size={21} color={colors.primary} />}
        onPress={() => navigate({ route: 'attendance' })}
      />
      <HomeAction
        title={t('contractorUi.assignedWork')}
        subtitle={t('contractorUi.assignedHint')}
        icon={<IconShield size={21} color={colors.primary} />}
        onPress={() => navigate({ route: 'assigned' })}
      />
      <Disclosure title={t('contractorUi.managementTools')}>
        <HomeAction
          title={t('teams.title')}
          icon={<IconUsers size={21} color={colors.primary} />}
          onPress={() => navigate({ route: 'teams' })}
        />
        <HomeAction
          title={t('access.title')}
          icon={<IconShield size={21} color={colors.primary} />}
          onPress={() => navigate({ route: 'access' })}
        />
        <HomeAction
          title={t('schedule.title')}
          icon={<IconCalendar size={21} color={colors.primary} />}
          onPress={() => navigate({ route: 'schedule' })}
        />
      </Disclosure>
      {creating && (
        <CreateWorkerModal
          visible
          onClose={() => setCreating(false)}
          onSuccess={() => void dashboard.refetch()}
        />
      )}
      {assigning && <ScheduleAssignModal visible onClose={() => setAssigning(false)} />}
    </Page>
  );
}

function HomeAction({
  title,
  subtitle,
  icon,
  onPress,
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.65 }]}
    >
      <View style={styles.icon}>{icon}</View>
      <View style={styles.contextCopy}>
        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.rowTitle}>
          {title}
        </Text>
        {subtitle && (
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.rowSubtitle}>
            {subtitle}
          </Text>
        )}
      </View>
      <IconChevronRight size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  context: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  contextCopy: { flex: 1, minWidth: 0 },
  contractor: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', lineHeight: 23 },
  site: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  avatar: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  metrics: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  metric: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  metricValue: { fontSize: 32, fontWeight: '800', color: colors.textPrimary, lineHeight: 38 },
  metricLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  metricDivider: { width: 1, height: 42, backgroundColor: colors.borderLight },
  notice: {
    color: '#9A3412',
    backgroundColor: colors.primaryLight,
    padding: 10,
    borderRadius: 12,
    fontSize: 12,
    lineHeight: 19,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 13,
    minHeight: 64,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  icon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
  },
  rowTitle: { fontSize: 14, fontWeight: '700', lineHeight: 21, color: colors.textPrimary },
  rowSubtitle: { fontSize: 12, color: colors.textMuted, lineHeight: 18, marginTop: 3 },
});
