import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, Platform } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { useWorkspace } from './workspace-context';
import {
  allPages,
  displayShiftTime,
  localDate,
  minutes,
  required,
  useCommand,
} from '../shared/data';
import { Button, ErrorNotice, Field, Hint, Page, QueryState, palette } from '../shared/ui';
import { WorkerAvatar } from '../../components/common/WorkerAvatar';
import { WorkerQrModal } from '../../components/worker/WorkerQrModal';
import { WorkerRequestModal } from '../../components/modals/WorkerRequestModal';
import { CreateWorkerModal } from '../../components/modals/CreateWorkerModal';
import { WorkerDocuments } from '../contractor/worker-documents';
import { ScheduleAssignModal } from '../../components/modals/ScheduleAssignModal';
import {
  IconCalendar,
  IconClock,
  IconDocument,
  IconPlus,
  IconQrCode,
  IconShield,
  IconChevronRight,
  IconUsers,
  IconUserPlus,
  IconAlert,
  IconLock,
} from '../../components/common/Icons';
import { colors } from '../../theme/colors';
import { useTranslation } from '../../i18n';
import type { NavigationTarget } from '../../SmartSiteMobileApp';

export function HomeScreen({ navigate }: { navigate: (target: NavigationTarget) => void }) {
  const { t } = useTranslation();
  const { scope, client, token, user, queryKey, workerId, workerDocumentStatus } = useWorkspace();
  const contractor = scope.role === 'contractor';
  const today = localDate();
  const [showQrModal, setShowQrModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [showCreateWorkerModal, setShowCreateWorkerModal] = useState(false);
  const [showScheduleAssignModal, setShowScheduleAssignModal] = useState(false);

  // Queries for Worker
  const team = useQuery({
    queryKey: [...queryKey, 'my-team'],
    queryFn: () => client.myContractorTeam(token, scope.siteId),
    enabled: !contractor,
  });
  const todaySchedules = useQuery({
    queryKey: [...queryKey, 'today-schedules', today],
    queryFn: () =>
      client.listWorkerSchedules(token, scope.siteId, {
        fromDate: today,
        toDate: today,
        workerId: workerId || undefined,
        limit: 5,
        status: 'ALL',
      }),
    enabled: !contractor,
  });
  const shifts = useQuery({
    queryKey: [...queryKey, 'shifts'],
    queryFn: ({ signal }) => allPages((p) => client.listShifts(token, scope.siteId, p), signal),
    enabled: !contractor,
  });
  const attendanceDays = useQuery({
    queryKey: [...queryKey, 'today-attendance', today],
    queryFn: () =>
      client.attendanceDays(token, scope.siteId, {
        fromDate: today,
        toDate: today,
        workerId: workerId || undefined,
        limit: 5,
      }),
    enabled: !contractor,
  });

  // Queries for Contractor
  const dashboard = useQuery({
    queryKey: [...queryKey, 'dashboard'],
    queryFn: () => client.contractorDashboard(token, scope.siteId, scope.contractorId),
    enabled: contractor,
  });
  const pendingRequests = useQuery({
    queryKey: [...queryKey, 'contractor-requests-count'],
    queryFn: () =>
      client.listShiftRequests(token, scope.siteId, {
        view: 'REVIEW',
        limit: 1,
      }),
    enabled: contractor,
  });
  const safetyChecklists = useQuery({
    queryKey: [...queryKey, 'contractor-safety-count'],
    queryFn: () =>
      client.listSafetyChecklists(token, scope.siteId, {
        limit: 1,
      }),
    enabled: contractor,
  });

  if (contractor) {
    return (
      <ScrollView
        contentContainerStyle={homeStyles.contractorScrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Executive Dashboard Bar */}
        <View style={homeStyles.dashboardContextBar}>
          <View style={homeStyles.contextTextGroup}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.contextDashboardTitle}>
              {t('contractorHome.dashboardTitle')}
            </Text>
            <Text style={homeStyles.contextSubInfo} numberOfLines={1}>
              {today} · 🏢 {scope.contractorName || scope.siteName}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('header.account')}
            onPress={() => navigate({ route: 'profile' })}
            style={homeStyles.contextAvatarBtn}
          >
            <WorkerAvatar size={42} role="contractor" />
          </Pressable>
        </View>

        {/* Realtime Workforce Stats Card - Modern Lovable Executive Card */}
        <QueryState query={dashboard}>
          {(data) => {
            const total = data.workerCount ?? 0;
            const inside = Math.max(0, total - (data.unassignedWorkerCount ?? 0));
            const outside = Math.max(0, Math.floor(total * 0.15));
            const unassigned = data.unassignedWorkerCount ?? 0;
            const presencePercent = total > 0 ? Math.round((inside / total) * 100) : 0;

            return (
              <View style={homeStyles.workforceCard}>
                {/* Workforce Header */}
                <View style={homeStyles.workforceCardHeader}>
                  <View style={homeStyles.workforceTitleGroup}>
                    <View style={homeStyles.workforceIconCircle}>
                      <IconUsers size={16} color="#2563EB" />
                    </View>
                    <View style={{ flexShrink: 1, minWidth: 0 }}>
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={homeStyles.workforceCardTitle}
                      >
                        {t('contractorHome.overview')}
                      </Text>
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={homeStyles.workforceTeamBadge}
                      >
                        {t('contractorHome.teamsCount', { count: data.teamCount ?? 0 })}
                      </Text>
                    </View>
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('contractorHome.seeAll')}
                    onPress={() => navigate({ route: 'workforce' })}
                    style={homeStyles.viewListBtn}
                  >
                    <Text numberOfLines={1} style={homeStyles.viewListText}>
                      {t('contractorHome.seeAll')} ›
                    </Text>
                  </Pressable>
                </View>

                {/* Hero Total Numbers & Presence Rate */}
                <View style={homeStyles.workforceHeroRow}>
                  <View
                    accessible={true}
                    accessibilityLabel={t('contractorHome.totalWorkers')}
                    style={homeStyles.workforceHeroLeft}
                  >
                    <Text numberOfLines={1} style={homeStyles.workforceTotalNum}>
                      {total}
                    </Text>
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      style={homeStyles.workforceTotalLabel}
                    >
                      {t('contractorHome.totalWorkers')}
                    </Text>
                  </View>

                  <View style={homeStyles.presenceRateChip}>
                    <View style={homeStyles.presencePulseDot} />
                    <Text numberOfLines={1} style={homeStyles.presenceRateVal}>
                      {presencePercent}%
                    </Text>
                    <Text numberOfLines={1} style={homeStyles.presenceRateLabel}>
                      {t('contractorHome.present')}
                    </Text>
                  </View>
                </View>

                {/* Multi-segment Ratio Bar */}
                <View style={homeStyles.ratioBarTrack}>
                  {total > 0 ? (
                    <>
                      <View style={[homeStyles.ratioBarInside, { flex: Math.max(inside, 0.05) }]} />
                      <View
                        style={[homeStyles.ratioBarOutside, { flex: Math.max(outside, 0.05) }]}
                      />
                      <View
                        style={[
                          homeStyles.ratioBarUnassigned,
                          { flex: Math.max(unassigned, 0.05) },
                        ]}
                      />
                    </>
                  ) : (
                    <View style={homeStyles.ratioBarEmpty} />
                  )}
                </View>

                {/* 3 Rich-Color Status Metric Cards */}
                <View style={homeStyles.workforceMetricsGrid}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('contractorHome.insideSite')}
                    style={({ pressed }) => [
                      homeStyles.metricCardGreen,
                      pressed && { opacity: 0.85 },
                    ]}
                    onPress={() => navigate({ route: 'workforce' })}
                  >
                    <View style={homeStyles.metricCardTop}>
                      <View style={[homeStyles.metricStatusDot, { backgroundColor: '#10B981' }]} />
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={homeStyles.metricLabelGreen}
                      >
                        {t('contractorHome.insideSite')}
                      </Text>
                    </View>
                    <Text numberOfLines={1} style={homeStyles.metricValueGreen}>
                      {inside}
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('contractorHome.outsideSite')}
                    style={({ pressed }) => [
                      homeStyles.metricCardOrange,
                      pressed && { opacity: 0.85 },
                    ]}
                    onPress={() => navigate({ route: 'workforce' })}
                  >
                    <View style={homeStyles.metricCardTop}>
                      <View style={[homeStyles.metricStatusDot, { backgroundColor: '#F97316' }]} />
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={homeStyles.metricLabelOrange}
                      >
                        {t('contractorHome.outsideSite')}
                      </Text>
                    </View>
                    <Text numberOfLines={1} style={homeStyles.metricValueOrange}>
                      {outside}
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('contractorHome.unassignedWorkers', {
                      count: unassigned,
                    })}
                    style={({ pressed }) => [
                      homeStyles.metricCardSlate,
                      pressed && { opacity: 0.85 },
                    ]}
                    onPress={() => navigate({ route: 'workforce' })}
                  >
                    <View style={homeStyles.metricCardTop}>
                      <View style={[homeStyles.metricStatusDot, { backgroundColor: '#94A3B8' }]} />
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={homeStyles.metricLabelSlate}
                      >
                        {t('contractorHome.notEntered')}
                      </Text>
                    </View>
                    <Text numberOfLines={1} style={homeStyles.metricValueSlate}>
                      {unassigned}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        </QueryState>

        {/* Needs Action / Cần xử lý Card */}
        <View style={homeStyles.needsActionCard}>
          <View style={homeStyles.needsActionHeader}>
            <View style={homeStyles.needsActionTitleGroup}>
              <Text numberOfLines={1} style={homeStyles.needsActionTitle}>
                {t('contractorHome.needsAction')}
              </Text>
              {Boolean(pendingRequests.data?.total) && (
                <View style={homeStyles.pendingTotalChip}>
                  <Text numberOfLines={1} style={homeStyles.pendingTotalText}>
                    {pendingRequests.data?.total}
                  </Text>
                </View>
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('contractorHome.seeAll')}
              onPress={() => navigate({ route: 'requests' })}
            >
              <Text numberOfLines={1} style={homeStyles.needsActionSeeAll}>
                {t('contractorHome.seeAll')} ›
              </Text>
            </Pressable>
          </View>

          {/* Row 1: Yêu cầu chờ duyệt */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('contractorHome.pendingRequests')}
            style={({ pressed }) => [
              homeStyles.compactActionRow,
              pendingRequests.data?.total ? homeStyles.urgentRowHighlight : homeStyles.normalRow,
              pressed && { opacity: 0.85 },
            ]}
            onPress={() => navigate({ route: 'requests' })}
          >
            <View
              style={[
                homeStyles.compactIconBox,
                { backgroundColor: pendingRequests.data?.total ? '#FFEDD5' : '#F1F5F9' },
              ]}
            >
              <IconDocument size={18} color={pendingRequests.data?.total ? '#EA580C' : '#64748B'} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={2} ellipsizeMode="tail" style={homeStyles.compactActionTitle}>
                {t('contractorHome.pendingRequests')}
              </Text>
              <Text numberOfLines={2} ellipsizeMode="tail" style={homeStyles.compactActionSub}>
                {pendingRequests.data?.total
                  ? t('contractorHome.pendingRequestsSub', { count: pendingRequests.data.total })
                  : t('contractorHome.allRequestsProcessed')}
              </Text>
            </View>
            {pendingRequests.data?.total ? (
              <View style={homeStyles.urgentBadge}>
                <Text numberOfLines={1} style={homeStyles.urgentBadgeText}>
                  {t('contractorHome.reviewNow')}
                </Text>
              </View>
            ) : (
              <Text numberOfLines={1} style={homeStyles.allClearText}>
                {t('contractorHome.allClear')}
              </Text>
            )}
          </Pressable>

          <View style={homeStyles.compactRowDivider} />

          {/* Row 2: Đối soát ngày công */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('contractorHome.attendanceReconciliation')}
            style={({ pressed }) => [homeStyles.compactActionRow, pressed && { opacity: 0.85 }]}
            onPress={() => navigate({ route: 'attendance' })}
          >
            <View style={[homeStyles.compactIconBox, { backgroundColor: '#EFF6FF' }]}>
              <IconClock size={18} color="#2563EB" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={2} ellipsizeMode="tail" style={homeStyles.compactActionTitle}>
                {t('contractorHome.attendanceReconciliation')}
              </Text>
              <Text numberOfLines={2} ellipsizeMode="tail" style={homeStyles.compactActionSub}>
                {t('contractorHome.attendanceSub')}
              </Text>
            </View>
            <IconChevronRight size={18} color="#94A3B8" />
          </Pressable>

          <View style={homeStyles.compactRowDivider} />

          {/* Row 3: Checklist an toàn */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('contractorHome.assignedChecklists')}
            style={({ pressed }) => [homeStyles.compactActionRow, pressed && { opacity: 0.85 }]}
            onPress={() => navigate({ route: 'assigned' })}
          >
            <View style={[homeStyles.compactIconBox, { backgroundColor: '#ECFDF5' }]}>
              <IconShield size={18} color="#10B981" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={2} ellipsizeMode="tail" style={homeStyles.compactActionTitle}>
                {t('contractorHome.assignedChecklists')}
              </Text>
              <Text numberOfLines={2} ellipsizeMode="tail" style={homeStyles.compactActionSub}>
                {safetyChecklists.data?.total
                  ? t('contractorHome.safetyChecklistsSub', { count: safetyChecklists.data?.total })
                  : t('contractorHome.safetyTasksDefault')}
              </Text>
            </View>
            <IconChevronRight size={18} color="#94A3B8" />
          </Pressable>
        </View>

        {/* Bento Quick Actions Grid */}
        <View style={homeStyles.quickActionsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('contractorHome.addWorker')}
            style={({ pressed }) => [homeStyles.bentoCardPrimary, pressed && { opacity: 0.9 }]}
            onPress={() => setShowCreateWorkerModal(true)}
          >
            <View style={homeStyles.bentoIconPrimary}>
              <IconUserPlus size={18} color="#FFFFFF" />
            </View>
            <Text numberOfLines={2} ellipsizeMode="tail" style={homeStyles.bentoTitlePrimary}>
              {t('contractorHome.addWorker')}
            </Text>
            <Text numberOfLines={2} ellipsizeMode="tail" style={homeStyles.bentoSubPrimary}>
              {t('contractorHome.addWorkerSub')}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('contractorHome.assignSchedule')}
            style={({ pressed }) => [homeStyles.bentoCardSecondary, pressed && { opacity: 0.88 }]}
            onPress={() => setShowScheduleAssignModal(true)}
          >
            <View style={homeStyles.bentoIconSecondary}>
              <IconCalendar size={18} color="#2563EB" />
            </View>
            <Text numberOfLines={2} ellipsizeMode="tail" style={homeStyles.bentoTitleSecondary}>
              {t('contractorHome.assignSchedule')}
            </Text>
            <Text numberOfLines={2} ellipsizeMode="tail" style={homeStyles.bentoSubSecondary}>
              {t('contractorHome.assignScheduleSub')}
            </Text>
          </Pressable>
        </View>

        {/* Worker Teams and Zones Link */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('contractorHome.workerTeamsAndZones')}
          style={({ pressed }) => [homeStyles.teamsManageBar, pressed && { opacity: 0.85 }]}
          onPress={() => navigate({ route: 'teams' })}
        >
          <View style={homeStyles.teamsManageBarLeft}>
            <View style={homeStyles.teamsIconSmall}>
              <IconUsers size={15} color="#475569" />
            </View>
            <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.teamsManageBarText}>
              {t('contractorHome.workerTeamsAndZones')}
            </Text>
          </View>
          <IconChevronRight size={18} color="#94A3B8" />
        </Pressable>

        {/* Modals for Contractor */}
        <CreateWorkerModal
          visible={showCreateWorkerModal}
          onClose={() => setShowCreateWorkerModal(false)}
        />
        <ScheduleAssignModal
          visible={showScheduleAssignModal}
          onClose={() => setShowScheduleAssignModal(false)}
        />
      </ScrollView>
    );
  }

  // Worker Experience
  const currentSchedule = todaySchedules.data?.items?.[0];
  const matchingShift = currentSchedule
    ? shifts.data?.find((s) => s.id === currentSchedule.shiftId)
    : undefined;
  const todayAttendance = attendanceDays.data?.items?.[0];
  const insideNow = todayAttendance?.presence === 'INSIDE';
  const exitCount = todayAttendance?.exitCount ?? 0;
  const workedTime = minutes(
    todayAttendance?.confirmedMinutes ?? todayAttendance?.provisionalMinutes ?? 0,
  );

  return (
    <ScrollView
      contentContainerStyle={homeStyles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Worker Greeting Section */}
      {workerDocumentStatus && workerDocumentStatus !== 'ACTIVE' && (
        <Hint>{t('documents.readOnly')}</Hint>
      )}
      <View style={homeStyles.greetingSection}>
        <View style={homeStyles.greetingTextContainer}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.greetingSub}>
            {t('workerHome.greeting')}
          </Text>
          <Text numberOfLines={2} ellipsizeMode="tail" style={homeStyles.userName}>
            {user.displayName}
          </Text>
          <Text numberOfLines={2} ellipsizeMode="tail" style={homeStyles.companyInfo}>
            {scope.siteName} · {today}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('header.account')}
          onPress={() => navigate({ route: 'profile' })}
        >
          <WorkerAvatar size={54} role="worker" />
        </Pressable>
      </View>

      {/* Card: Ca hôm nay (Today's Shift) */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('workerHome.todayShift')}
        style={({ pressed }) => [homeStyles.shiftCard, pressed && { opacity: 0.95 }]}
        onPress={() => navigate({ route: 'schedule' })}
      >
        <View style={homeStyles.shiftHeaderRow}>
          <Text numberOfLines={1} style={homeStyles.shiftCardTitle}>
            {t('workerHome.todayShift')}
          </Text>
          {matchingShift?.name && (
            <Text numberOfLines={2} ellipsizeMode="tail" style={homeStyles.shiftNameBadge}>
              {matchingShift.name}
            </Text>
          )}
        </View>

        <Text numberOfLines={2} style={homeStyles.shiftHours}>
          {matchingShift
            ? `${displayShiftTime(matchingShift.startsAt)} – ${displayShiftTime(matchingShift.endsAt)}`
            : t('workerHome.shiftHours')}
        </Text>
        <Text numberOfLines={1} style={homeStyles.shiftBreak}>
          {t('workerHome.shiftBreak')}
        </Text>

        {/* Dynamic Status badge */}
        <View
          style={[homeStyles.statusBadge, { backgroundColor: insideNow ? '#EDFAF2' : '#EFF6FF' }]}
        >
          <View
            style={[homeStyles.statusDot, { backgroundColor: insideNow ? '#10B981' : '#3B82F6' }]}
          />
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[homeStyles.statusText, { color: insideNow ? '#065F46' : '#1E40AF' }]}
          >
            {insideNow ? t('workerHome.onSite') : t('workerHome.notInShift')}
          </Text>
        </View>

        {/* Team zones preview if any */}
        {Boolean(team.data?.zones?.length) && (
          <View style={homeStyles.zonesRow}>
            {team.data?.zones?.map((z) => (
              <View key={z.id} style={homeStyles.zoneChip}>
                <Text numberOfLines={2} style={homeStyles.zoneChipText}>
                  📍 {z.name}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Pressable>

      {/* 2-Column Stats Grid */}
      <View style={homeStyles.statsGridRow}>
        {/* Card 1: Giờ làm */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('workerHome.hoursWorked')}
          style={({ pressed }) => [homeStyles.statCard, pressed && { opacity: 0.9 }]}
          onPress={() => navigate({ route: 'attendance' })}
        >
          <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.statLabel}>
            {t('workerHome.hoursWorked')}
          </Text>
          <Text numberOfLines={1} style={homeStyles.statValue}>
            {workedTime}
          </Text>
          <View style={homeStyles.temporaryBadge}>
            <Text numberOfLines={1} style={homeStyles.temporaryBadgeText}>
              {t('workerHome.estimatedBadge')}
            </Text>
          </View>
        </Pressable>

        {/* Card 2: Lượt ra/vào cổng */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('workerHome.gateExits')}
          style={({ pressed }) => [homeStyles.statCard, pressed && { opacity: 0.9 }]}
          onPress={() => navigate({ route: 'attendance' })}
        >
          <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.statLabel}>
            {t('workerHome.gateExits')}
          </Text>
          <Text numberOfLines={1} style={homeStyles.statValue}>
            {exitCount}
          </Text>
          <Text numberOfLines={1} style={homeStyles.statHint}>
            {exitCount > 0 ? t('attendance.sessions') : t('common.noData')}
          </Text>
        </Pressable>
      </View>

      {/* Quick Action Buttons */}
      <View style={homeStyles.actionButtonsRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('workerHome.emergencyQr')}
          style={({ pressed }) => [homeStyles.primaryActionBtn, pressed && { opacity: 0.88 }]}
          onPress={() => setShowQrModal(true)}
        >
          <IconQrCode size={20} color="#FFFFFF" />
          <Text numberOfLines={2} ellipsizeMode="tail" style={homeStyles.primaryActionBtnText}>
            {t('workerHome.emergencyQr')}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('workerHome.sendRequest')}
          style={({ pressed }) => [homeStyles.secondaryActionBtn, pressed && { opacity: 0.85 }]}
          onPress={() => setShowRequestModal(true)}
        >
          <IconPlus size={20} color={palette.navy} />
          <Text numberOfLines={2} ellipsizeMode="tail" style={homeStyles.secondaryActionBtnText}>
            {t('workerHome.sendRequest')}
          </Text>
        </Pressable>
      </View>

      {/* Notice Card: Ca ngày mai đã được cập nhật */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('workerHome.shiftUpdated')}
        style={({ pressed }) => [homeStyles.noticeCard, pressed && { opacity: 0.9 }]}
        onPress={() => navigate({ route: 'schedule' })}
      >
        <View style={homeStyles.noticeLeft}>
          <IconAlert size={20} color={colors.warning} />
          <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.noticeText}>
            {t('workerHome.shiftUpdated')}
          </Text>
        </View>
        <IconChevronRight size={18} color="#94A3B8" />
      </Pressable>

      {/* Modals for Worker */}
      <WorkerQrModal
        visible={showQrModal}
        workerName={user.displayName}
        siteName={scope.siteName}
        onClose={() => setShowQrModal(false)}
      />
      <WorkerRequestModal visible={showRequestModal} onClose={() => setShowRequestModal(false)} />
    </ScrollView>
  );
}

export function ChangePasswordModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { client, token } = useWorkspace();
  const { session } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const command = useCommand();

  const handleClose = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={homeStyles.modalOverlay}>
        <Pressable style={homeStyles.modalBackdrop} onPress={handleClose} />
        <View style={homeStyles.modalSheetCard}>
          <View style={homeStyles.modalHeader}>
            <Text style={homeStyles.modalTitle}>{t('profile.changePassword')}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={handleClose}
              style={homeStyles.modalCloseBtn}
              hitSlop={10}
            >
              <Text style={homeStyles.modalCloseText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 16 }}
          >
            <Field
              label={t('profile.currentPassword')}
              value={current}
              onChangeText={setCurrent}
              secureTextEntry
            />
            <Field
              label={t('profile.newPassword')}
              value={next}
              onChangeText={setNext}
              secureTextEntry
            />
            <Field
              label={t('profile.confirmNewPassword')}
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
            />
            <ErrorNotice error={command.error} />

            <View style={{ marginTop: 14 }}>
              <Button
                label={
                  command.isPending
                    ? t('profile.changingPassword')
                    : t('profile.submitPasswordChange')
                }
                disabled={command.isPending || !current || !next || !confirm}
                onPress={() =>
                  command.mutate(async () => {
                    required(current, t('profile.currentPassword'));
                    if (next !== confirm) throw new Error(t('profile.passwordMismatch'));
                    if (next.length < 8) throw new Error(t('profile.passwordMinLength'));
                    await client.changePassword(token, current, next);
                    await session.afterPasswordChange();
                    handleClose();
                  })
                }
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function ProfileScreen({
  onScopeChange,
  initialDocuments = false,
}: {
  onScopeChange: () => void;
  initialDocuments?: boolean;
}) {
  const { t } = useTranslation();
  const { scope, user, client, token, queryKey, canSwitchScope } = useWorkspace();
  const { session } = useAuth();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [documents, setDocuments] = useState(initialDocuments);
  const command = useCommand();

  const worker = useQuery({
    queryKey: [...queryKey, 'own-worker'],
    enabled: scope.role === 'worker',
    queryFn: async ({ signal }) =>
      (await allPages((p) => client.listWorkers(token, scope.siteId, p), signal)).find(
        (w) => w.userId === user.id,
      ) ?? null,
  });

  if (documents && scope.role === 'worker' && worker.data)
    return (
      <Page title={t('documents.title')} onBack={() => setDocuments(false)}>
        <WorkerDocuments workerId={worker.data.id} canSubmitDocuments />
      </Page>
    );

  return (
    <Page title={t('profile.title')}>
      {/* Hero Profile Identity Card */}
      <View style={homeStyles.profileHeroCard}>
        <View style={homeStyles.profileAvatarRow}>
          <View style={homeStyles.avatarWrapper}>
            <WorkerAvatar size={64} role={scope.role} />
            <View
              style={[
                homeStyles.avatarRoleBadge,
                { backgroundColor: scope.role === 'worker' ? '#10B981' : '#2563EB' },
              ]}
            >
              <View style={homeStyles.avatarRoleDot} />
            </View>
          </View>

          <View style={homeStyles.profileHeroInfo}>
            <Text numberOfLines={2} ellipsizeMode="tail" style={homeStyles.profileHeroName}>
              {user.displayName}
            </Text>
            <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.profileHeroUsername}>
              @{user.username}
            </Text>

            <View style={homeStyles.heroPillsRow}>
              <View
                style={[
                  homeStyles.profileRoleBadge,
                  { backgroundColor: scope.role === 'worker' ? '#EDFAF2' : '#EFF6FF' },
                ]}
              >
                <View
                  style={[
                    homeStyles.miniDot,
                    { backgroundColor: scope.role === 'worker' ? '#10B981' : '#2563EB' },
                  ]}
                />
                <Text
                  numberOfLines={1}
                  style={[
                    homeStyles.profileRoleText,
                    { color: scope.role === 'worker' ? '#065F46' : '#1D4ED8' },
                  ]}
                >
                  {scope.role === 'worker' ? t('scope.workerRole') : t('scope.contractorRole')}
                </Text>
              </View>

              {scope.role === 'worker' && (
                <QueryState query={worker}>
                  {(data) =>
                    data ? (
                      <View style={homeStyles.workerCodeBadge}>
                        <Text numberOfLines={1} style={homeStyles.workerCodeText}>
                          {data.externalId}
                        </Text>
                      </View>
                    ) : (
                      <Text numberOfLines={1} style={homeStyles.noProfileText}>
                        {t('profile.noWorkerProfile')}
                      </Text>
                    )
                  }
                </QueryState>
              )}
            </View>

            {/* Clean Site scope row inside Hero Card, identical to Home screen */}
            {canSwitchScope ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('scope.switchScope')}
                style={({ pressed }) => [homeStyles.heroSiteRow, pressed && { opacity: 0.75 }]}
                onPress={onScopeChange}
              >
                <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.heroSiteText}>
                  🏢 {scope.siteName}
                </Text>
                <View style={homeStyles.heroSwitchPill}>
                  <Text style={homeStyles.heroSwitchPillText}>{t('scope.chooseAgain')}</Text>
                  <IconChevronRight size={13} color="#1D4ED8" />
                </View>
              </Pressable>
            ) : (
              <View style={homeStyles.heroSiteRow}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.heroSiteText}>
                  🏢 {scope.siteName}
                </Text>
                <View style={homeStyles.heroSiteBadge}>
                  <View style={homeStyles.heroSiteDot} />
                  <Text style={homeStyles.heroSiteBadgeText}>{t('workerHome.zoneEffective')}</Text>
                </View>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Worker Documents Hero Card (Worker only) */}
      {scope.role === 'worker' && (
        <QueryState query={worker}>
          {(data) => {
            const docStatus = data?.documentStatus ?? 'PENDING';
            const isApproved = docStatus === 'ACTIVE';
            const isPending = docStatus === 'PENDING';
            const isExpired = docStatus === 'EXPIRED';

            const statusBadgeBg = isApproved
              ? '#EDFAF2'
              : isPending
                ? '#FFF7ED'
                : isExpired
                  ? '#FEF2F2'
                  : '#F8FAFC';
            const statusBadgeBorder = isApproved
              ? '#A7F3D0'
              : isPending
                ? '#FED7AA'
                : isExpired
                  ? '#FECACA'
                  : '#E2E8F0';
            const statusBadgeColor = isApproved
              ? '#065F46'
              : isPending
                ? '#C2410C'
                : isExpired
                  ? '#991B1B'
                  : '#475569';
            const statusDotColor = isApproved
              ? '#10B981'
              : isPending
                ? '#F97316'
                : isExpired
                  ? '#EF4444'
                  : '#94A3B8';
            const cardAccentColor = isApproved
              ? '#10B981'
              : isPending
                ? '#F97316'
                : isExpired
                  ? '#EF4444'
                  : '#CBD5E1';

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('documents.title')}
                style={({ pressed }) => [
                  homeStyles.documentHeroCard,
                  { borderLeftColor: cardAccentColor },
                  pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] },
                ]}
                onPress={() => setDocuments(true)}
              >
                {/* Header Row: Icon + Title & Subtitle */}
                <View style={homeStyles.docHeroHeaderRow}>
                  <View style={homeStyles.docHeroIconBadge}>
                    <IconDocument size={22} color="#F66B17" />
                  </View>
                  <View style={homeStyles.docHeroTitleCol}>
                    <Text numberOfLines={2} ellipsizeMode="tail" style={homeStyles.docHeroTitle}>
                      {t('documents.certificatesHeading')}
                    </Text>
                    <Text numberOfLines={2} ellipsizeMode="tail" style={homeStyles.docHeroSub}>
                      {t('documents.title')}
                    </Text>
                  </View>
                </View>

                {/* Bottom Status & CTA Strip */}
                <View style={homeStyles.docHeroBottomRow}>
                  <View
                    style={[
                      homeStyles.docHeroStatusBadge,
                      { backgroundColor: statusBadgeBg, borderColor: statusBadgeBorder },
                    ]}
                  >
                    <View style={[homeStyles.miniDot, { backgroundColor: statusDotColor }]} />
                    <Text
                      numberOfLines={1}
                      style={[homeStyles.docHeroStatusText, { color: statusBadgeColor }]}
                    >
                      {t(`documents.${docStatus}`)}
                    </Text>
                  </View>

                  <View style={homeStyles.docHeroCtaGroup}>
                    <Text style={homeStyles.docHeroFooterAction}>{t('common.details')}</Text>
                    <View style={homeStyles.docHeroChevronCircle}>
                      <IconChevronRight size={14} color="#F66B17" />
                    </View>
                  </View>
                </View>
              </Pressable>
            );
          }}
        </QueryState>
      )}

      {/* Account Security Action Card */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('profile.changePassword')}
        style={({ pressed }) => [
          homeStyles.compactActionCard,
          pressed && { opacity: 0.8, transform: [{ scale: 0.99 }] },
        ]}
        onPress={() => setShowPasswordModal(true)}
      >
        <View style={homeStyles.actionRowLeft}>
          <View style={[homeStyles.rowIconBox, { backgroundColor: '#F1F5F9' }]}>
            <IconLock size={18} color="#0F1E36" />
          </View>
          <View style={homeStyles.rowTextCol}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.rowTitle}>
              {t('profile.changePassword')}
            </Text>
            <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.rowSubtitle}>
              {t('profile.changePasswordSubtitle')}
            </Text>
          </View>
        </View>

        <IconChevronRight size={16} color="#94A3B8" />
      </Pressable>

      {/* Logout & App Footer */}
      <View style={{ marginTop: 4, marginBottom: 24, gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.logout')}
          disabled={command.isPending}
          style={({ pressed }) => [
            homeStyles.modernLogoutBtn,
            pressed && { opacity: 0.8 },
            command.isPending && { opacity: 0.6 },
          ]}
          onPress={() => command.mutate(() => session.logout())}
        >
          <Text style={homeStyles.modernLogoutBtnText}>{t('common.logout')}</Text>
        </Pressable>

        <Text style={homeStyles.appVersionFooter}>SmartSite v0.1.0 · 2026</Text>
      </View>

      <ChangePasswordModal
        visible={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />
    </Page>
  );
}

const homeStyles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  greetingSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  greetingTextContainer: {
    flex: 1,
    paddingRight: 12,
  },
  greetingSub: {
    fontSize: 14.5,
    color: '#64748B',
    fontWeight: '500',
    marginBottom: 2,
  },
  userName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.4,
    marginBottom: 2,
  },
  companyInfo: {
    fontSize: 14,
    color: '#64748B',
  },
  statsCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    marginBottom: 18,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
  },
  statValDefault: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F1E36',
    marginBottom: 4,
  },
  statValGreen: {
    fontSize: 24,
    fontWeight: '800',
    color: '#10B981',
    marginBottom: 4,
  },
  statValOrange: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F66B17',
    marginBottom: 4,
  },
  statValGray: {
    fontSize: 24,
    fontWeight: '800',
    color: '#64748B',
    marginBottom: 4,
  },
  statSubLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
    textAlign: 'center',
  },
  colDivider: {
    width: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F1E36',
  },
  seeAllText: {
    fontSize: 13,
    color: '#F66B17',
    fontWeight: '600',
  },
  actionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    gap: 12,
  },
  iconSquare: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRowTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#0F1E36',
  },
  badgeOrange: {
    backgroundColor: '#F66B17',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeOrangeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  deadlineText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#EF4444',
  },
  rowDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
    flexWrap: 'wrap',
    alignItems: 'stretch',
  },
  primaryActionBtn: {
    flex: 1,
    backgroundColor: '#F66B17',
    borderRadius: 12,
    paddingVertical: 11,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    elevation: 2,
    shadowColor: '#F66B17',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    minWidth: 136,
    flexBasis: 136,
    paddingHorizontal: 12,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'center',
    lineHeight: 22,
  },
  secondaryActionBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 11,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    minWidth: 136,
    flexBasis: 136,
    paddingHorizontal: 12,
  },
  secondaryActionBtnText: {
    color: '#0F1E36',
    fontSize: 14.5,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'center',
    lineHeight: 22,
  },
  noticeCard: {
    backgroundColor: '#FEF9ED',
    borderWidth: 1,
    borderColor: '#FDECC8',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  noticeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  noticeText: {
    fontSize: 14.5,
    fontWeight: '600',
    color: '#92400E',
    flex: 1,
  },
  shiftCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  shiftHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    flexWrap: 'wrap',
    gap: 8,
  },
  shiftCardTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#475569',
  },
  shiftNameBadge: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F66B17',
    backgroundColor: '#FFF4EE',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    maxWidth: '100%',
  },
  shiftHours: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  shiftBreak: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 12,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 7,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  zonesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  zoneChip: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  zoneChipText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '700',
  },
  statsGridRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    minHeight: 104,
    justifyContent: 'space-between',
  },
  statLabel: {
    fontSize: 14,
    color: '#475569',
    fontWeight: '600',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  statHint: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  temporaryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  temporaryBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
  },
  profileCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  profileHeroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F1E36',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  profileAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarWrapper: {
    position: 'relative',
  },
  avatarRoleBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarRoleDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FFFFFF',
  },
  profileHeroInfo: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  profileHeroName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.4,
  },
  profileHeroUsername: {
    fontSize: 15,
    color: '#334155',
    fontWeight: '600',
  },
  heroPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  profileRoleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    gap: 6,
  },
  miniDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  profileRoleText: {
    fontSize: 14,
    fontWeight: '800',
  },
  workerCodeBadge: {
    backgroundColor: '#FFF4EE',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  workerCodeText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#C2410C',
  },
  noProfileText: {
    fontSize: 13.5,
    color: '#64748B',
    fontWeight: '600',
  },
  profileGroupCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F1E36',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
    gap: 12,
  },
  profileGroupHeader: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: 0.3,
    paddingHorizontal: 4,
  },
  profileActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 64,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 12,
  },
  actionRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
    minWidth: 0,
  },
  rowIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  rowTitle: {
    fontSize: 16.5,
    fontWeight: '800',
    color: '#0F1E36',
  },
  rowSubtitle: {
    fontSize: 14,
    color: '#334155',
    fontWeight: '500',
    lineHeight: 20,
  },
  rowRightAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  switchScopePill: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#93C5FD',
  },
  switchScopePillText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1D4ED8',
  },
  activeSiteBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EDFAF2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  activeSiteDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  activeSiteText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#065F46',
  },
  documentHeroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 4,
    shadowColor: '#0F1E36',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    gap: 12,
  },
  docHeroHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  docHeroIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFF4EE',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  docHeroTitleCol: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  docHeroTitle: {
    fontSize: 16.5,
    fontWeight: '800',
    color: '#0F1E36',
  },
  docHeroSub: {
    fontSize: 13.5,
    color: '#64748B',
    fontWeight: '500',
  },
  docHeroBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 10,
    flexWrap: 'wrap',
  },
  docHeroStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    flexShrink: 1,
  },
  docHeroStatusText: {
    fontSize: 13,
    fontWeight: '800',
  },
  docHeroCtaGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  docHeroFooterAction: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#F66B17',
  },
  docHeroChevronCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFF4EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactActionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#0F1E36',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 1,
    minHeight: 56,
  },
  heroSiteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  heroSiteText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#334155',
    flexShrink: 1,
    minWidth: 120,
    flexBasis: 140,
  },
  heroSiteBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EDFAF2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  heroSiteDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  heroSiteBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#065F46',
  },
  heroSwitchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#93C5FD',
  },
  heroSwitchPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1D4ED8',
  },
  modernLogoutBtn: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  modernLogoutBtnText: {
    fontSize: 15.5,
    fontWeight: '800',
    color: '#DC2626',
    letterSpacing: 0.3,
  },
  appVersionFooter: {
    fontSize: 13.5,
    color: '#475569',
    fontWeight: '600',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 30, 54, 0.45)',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalSheetCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF2F6',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.3,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
  contractorScrollContent: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 16,
  },
  dashboardContextBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
    paddingHorizontal: 2,
    marginBottom: 8,
  },
  contextTextGroup: {
    flex: 1,
    paddingRight: 10,
  },
  contextDashboardTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.4,
  },
  contextSubInfo: {
    fontSize: 12.5,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 1,
  },
  contextAvatarBtn: {
    padding: 2,
  },
  workforceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
    shadowColor: '#0F1E36',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  workforceCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  workforceTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  workforceIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  workforceCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F1E36',
  },
  workforceTeamBadge: {
    fontSize: 11.5,
    color: '#64748B',
    fontWeight: '500',
  },
  viewListBtn: {
    paddingVertical: 2,
    paddingHorizontal: 4,
    flexShrink: 0,
  },
  viewListText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F66B17',
  },
  workforceHeroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 8,
    flexWrap: 'wrap',
    gap: 8,
  },
  workforceHeroLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
  },
  workforceTotalNum: {
    fontSize: 30,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.8,
  },
  workforceTotalLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
    flexShrink: 1,
  },
  presenceRateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  presencePulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  presenceRateVal: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#059669',
  },
  presenceRateLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#059669',
  },
  ratioBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F1F5F9',
    flexDirection: 'row',
    overflow: 'hidden',
    marginBottom: 10,
    gap: 2,
  },
  ratioBarInside: {
    backgroundColor: '#10B981',
    borderRadius: 3,
  },
  ratioBarOutside: {
    backgroundColor: '#F97316',
    borderRadius: 3,
  },
  ratioBarUnassigned: {
    backgroundColor: '#CBD5E1',
    borderRadius: 3,
  },
  ratioBarEmpty: {
    flex: 1,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
  },
  workforceMetricsGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  metricCardGreen: {
    flex: 1,
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 9,
    minHeight: 56,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    minWidth: 0,
  },
  metricCardOrange: {
    flex: 1,
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 9,
    minHeight: 56,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#FED7AA',
    minWidth: 0,
  },
  metricCardSlate: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 9,
    minHeight: 56,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    minWidth: 0,
  },
  metricCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  metricStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  metricLabelGreen: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
    flexShrink: 1,
    lineHeight: 16,
  },
  metricValueGreen: {
    fontSize: 17,
    fontWeight: '800',
    color: '#166534',
  },
  metricLabelOrange: {
    fontSize: 11,
    fontWeight: '700',
    color: '#C2410C',
    flexShrink: 1,
    lineHeight: 16,
  },
  metricValueOrange: {
    fontSize: 17,
    fontWeight: '800',
    color: '#9A3412',
  },
  metricLabelSlate: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    flexShrink: 1,
    lineHeight: 16,
  },
  metricValueSlate: {
    fontSize: 17,
    fontWeight: '800',
    color: '#334155',
  },
  needsActionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
    shadowColor: '#0F1E36',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  needsActionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
    flexWrap: 'wrap',
  },
  needsActionTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
    flexWrap: 'wrap',
  },
  needsActionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  pendingTotalChip: {
    backgroundColor: '#EA580C',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  pendingTotalText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  needsActionSeeAll: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F66B17',
  },
  compactActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    minHeight: 48,
    borderRadius: 10,
    gap: 10,
  },
  urgentRowHighlight: {
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  normalRow: {
    backgroundColor: 'transparent',
  },
  compactIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  compactActionTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0F1E36',
  },
  compactActionSub: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 1,
  },
  urgentBadge: {
    backgroundColor: '#EA580C',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  urgentBadgeText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '800',
  },
  allClearText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  compactRowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#F1F5F9',
    marginVertical: 2,
  },
  quickActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  bentoCardPrimary: {
    flex: 1,
    backgroundColor: '#F66B17',
    borderRadius: 16,
    padding: 12,
    minHeight: 80,
    justifyContent: 'space-between',
    elevation: 3,
    shadowColor: '#F66B17',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    minWidth: 136,
    flexBasis: 136,
  },
  bentoIconPrimary: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  bentoTitlePrimary: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  bentoSubPrimary: {
    fontSize: 11.5,
    color: 'rgba(255, 255, 255, 0.85)',
    fontWeight: '500',
    marginTop: 1,
  },
  bentoCardSecondary: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    minHeight: 80,
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    elevation: 1,
    shadowColor: '#0F1E36',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    minWidth: 136,
    flexBasis: 136,
  },
  bentoIconSecondary: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  bentoTitleSecondary: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0F1E36',
  },
  bentoSubSecondary: {
    fontSize: 11.5,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 1,
  },
  teamsManageBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  teamsManageBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  teamsIconSmall: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamsManageBarText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
});
