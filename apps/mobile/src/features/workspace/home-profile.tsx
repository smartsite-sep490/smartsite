import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, Platform } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { useWorkspace } from './workspace-context';
import { allPages, displayTime, localDate, minutes, required, useCommand } from '../shared/data';
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
              <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.compactActionTitle}>
                {t('contractorHome.pendingRequests')}
              </Text>
              <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.compactActionSub}>
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
              <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.compactActionTitle}>
                {t('contractorHome.attendanceReconciliation')}
              </Text>
              <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.compactActionSub}>
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
              <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.compactActionTitle}>
                {t('contractorHome.assignedChecklists')}
              </Text>
              <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.compactActionSub}>
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
            <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.bentoTitlePrimary}>
              {t('contractorHome.addWorker')}
            </Text>
            <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.bentoSubPrimary}>
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
            <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.bentoTitleSecondary}>
              {t('contractorHome.assignSchedule')}
            </Text>
            <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.bentoSubSecondary}>
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
          <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.userName}>
            {user.displayName}
          </Text>
          <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.companyInfo}>
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
            <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.shiftNameBadge}>
              {matchingShift.name}
            </Text>
          )}
        </View>

        <Text numberOfLines={1} style={homeStyles.shiftHours}>
          {matchingShift
            ? `${displayTime(matchingShift.startsAt)} – ${displayTime(matchingShift.endsAt)}`
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
                <Text numberOfLines={1} style={homeStyles.zoneChipText}>
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
          <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.primaryActionBtnText}>
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
          <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.secondaryActionBtnText}>
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
  const { scope, user, client, token, queryKey } = useWorkspace();
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
        <WorkerDocuments workerId={worker.data.id} />
      </Page>
    );
  return (
    <Page title={t('profile.title')}>
      {scope.role === 'worker' && worker.data && (
        <>
          <Hint>{t(`documents.${worker.data.documentStatus ?? 'PENDING'}`)}</Hint>
          {worker.data.documentStatus !== 'ACTIVE' && <Hint>{t('documents.readOnly')}</Hint>}
          <Button secondary label={t('documents.title')} onPress={() => setDocuments(true)} />
        </>
      )}
      {/* Hero Profile Card */}
      <View style={homeStyles.profileHeroCard}>
        <View style={homeStyles.profileAvatarRow}>
          <WorkerAvatar size={60} role={scope.role} />
          <View style={homeStyles.profileHeroInfo}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.profileHeroName}>
              {user.displayName}
            </Text>
            <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.profileHeroUsername}>
              @{user.username}
            </Text>
            <View style={homeStyles.profileRoleBadge}>
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
          </View>
        </View>

        <View style={homeStyles.profileSiteRow}>
          <Text numberOfLines={1} style={homeStyles.profileSiteText}>
            📍 {scope.siteName}
          </Text>
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

        <Button secondary label={t('scope.switchScope')} onPress={onScopeChange} />
      </View>

      {/* Security Section with Change Password Action */}
      <View style={homeStyles.profileSectionCard}>
        <Text numberOfLines={1} style={homeStyles.profileSectionTitle}>
          {t('profile.securityTitle')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('profile.changePassword')}
          style={({ pressed }) => [homeStyles.profileMenuRow, pressed && { opacity: 0.7 }]}
          onPress={() => setShowPasswordModal(true)}
        >
          <View style={homeStyles.profileMenuLeft}>
            <View style={homeStyles.profileMenuIconBox}>
              <IconLock size={18} color={palette.navy} />
            </View>
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.profileMenuTitle}>
                {t('profile.changePassword')}
              </Text>
              <Text numberOfLines={1} ellipsizeMode="tail" style={homeStyles.profileMenuSubtitle}>
                {t('profile.changePasswordSubtitle')}
              </Text>
            </View>
          </View>
          <IconChevronRight size={18} color="#94A3B8" />
        </Pressable>
      </View>

      {/* Logout Button */}
      <View style={{ marginTop: 6, marginBottom: 20 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.logout')}
          disabled={command.isPending}
          style={({ pressed }) => [homeStyles.logoutButton, pressed && { opacity: 0.8 }]}
          onPress={() => command.mutate(() => session.logout())}
        >
          <Text style={homeStyles.logoutButtonText}>{t('common.logout')}</Text>
        </Pressable>
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
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
    marginBottom: 2,
  },
  userName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.4,
    marginBottom: 2,
  },
  companyInfo: {
    fontSize: 12.5,
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
    marginTop: 4,
  },
  primaryActionBtn: {
    flex: 1,
    backgroundColor: '#F66B17',
    borderRadius: 14,
    paddingVertical: 14,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    elevation: 3,
    shadowColor: '#F66B17',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
  secondaryActionBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 14,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
  },
  secondaryActionBtnText: {
    color: '#0F1E36',
    fontSize: 14.5,
    fontWeight: '700',
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
    fontSize: 13,
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
  },
  shiftCardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  shiftNameBadge: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#F66B17',
    backgroundColor: '#FFF4EE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  shiftHours: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  shiftBreak: {
    fontSize: 12.5,
    color: '#64748B',
    marginBottom: 12,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusText: {
    fontSize: 12,
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
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  zoneChipText: {
    fontSize: 11,
    color: '#334155',
    fontWeight: '600',
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
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    minHeight: 96,
    justifyContent: 'space-between',
  },
  statLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  statHint: {
    fontSize: 11,
    color: '#94A3B8',
  },
  temporaryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  temporaryBadgeText: {
    fontSize: 10.5,
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
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#EFF2F6',
    gap: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  profileAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  profileHeroInfo: {
    flex: 1,
    gap: 4,
  },
  profileHeroName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.3,
  },
  profileHeroUsername: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  profileRoleBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
    marginTop: 2,
  },
  profileRoleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  profileSiteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#F1F5F9',
  },
  profileSiteText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  workerCodeBadge: {
    backgroundColor: '#FFF4EE',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  workerCodeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#F66B17',
  },
  noProfileText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  profileSectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#EFF2F6',
    gap: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  profileSectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F1E36',
  },
  langToggleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  langToggleBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  langToggleBtnActive: {
    backgroundColor: '#FFF4EE',
    borderColor: '#F66B17',
  },
  langToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  langToggleTextActive: {
    color: '#F66B17',
    fontWeight: '800',
  },
  logoutButton: {
    backgroundColor: '#FEE2E2',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#DC2626',
  },
  miniDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  profileMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 52,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EFF2F6',
  },
  profileMenuLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileMenuIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFF4EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileMenuTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F1E36',
  },
  profileMenuSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
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
  },
  workforceTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  },
  workforceHeroLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
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
  },
  needsActionTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  needsActionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
