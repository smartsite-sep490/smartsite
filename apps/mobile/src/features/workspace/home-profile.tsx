import { ContractorHome } from '../contractor/contractor-home';
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { Button, ErrorNotice, Field, Page, QueryState, palette } from '../shared/ui';
import { WorkerAvatar } from '../../components/common/WorkerAvatar';
import { WorkerQrModal } from '../../components/worker/WorkerQrModal';
import { WorkerRequestModal } from '../../components/modals/WorkerRequestModal';
import { WorkerDocuments } from '../contractor/worker-documents';
import {
  IconDocument,
  IconPlus,
  IconQrCode,
  IconShield,
  IconChevronRight,
  IconAlert,
  IconLock,
  IconUser,
  IconMapPin,
  IconGlobe,
  IconLogout,
  IconSwap,
} from '../../components/common/Icons';
import { colors } from '../../theme/colors';
import { useTranslation, setLanguage } from '../../i18n';
import type { NavigationTarget } from '../../SmartSiteMobileApp';

export function HomeScreen({ navigate }: { navigate: (target: NavigationTarget) => void }) {
  const { t } = useTranslation();
  const { scope, client, token, user, queryKey, workerId } = useWorkspace();
  const contractor = scope.role === 'contractor';
  const today = localDate();
  const [showQrModal, setShowQrModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);

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

  if (contractor) return <ContractorHome navigate={navigate} />;

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
  const { t, i18n } = useTranslation();
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
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <Page title={t('documents.title')} onBack={() => setDocuments(false)}>
          <WorkerDocuments workerId={worker.data.id} canSubmitDocuments />
        </Page>
      </SafeAreaView>
    );

  const docStatus = worker.data?.documentStatus ?? 'PENDING';
  const isApproved = docStatus === 'ACTIVE';
  const isPending = docStatus === 'PENDING';
  const isExpired = docStatus === 'EXPIRED';
  const docBadgeBg = isApproved
    ? '#EDFAF2'
    : isPending
      ? '#FFF7ED'
      : isExpired
        ? '#FEF2F2'
        : '#F8FAFC';
  const docBadgeColor = isApproved
    ? '#065F46'
    : isPending
      ? '#C2410C'
      : isExpired
        ? '#991B1B'
        : '#475569';
  const isEn = (i18n.resolvedLanguage ?? i18n.language)?.startsWith('en');

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: '#FFF7ED' }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={profileStyles.scrollContainer}
      >
        {/* 1. Peach Gradient Top Section */}
        <View style={profileStyles.headerCard}>
          {/* Top Header Row with Centered Title & Hexagon/Shield Right Icon */}
          <View style={profileStyles.topHeaderRow}>
            <View style={{ width: 40 }} />
            <Text style={profileStyles.topHeaderTitle}>{t('profile.title')}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('profile.changePassword')}
              onPress={() => setShowPasswordModal(true)}
              hitSlop={8}
              style={({ pressed }) => [profileStyles.topRightBtn, pressed && { opacity: 0.7 }]}
            >
              <View style={profileStyles.hexagonBadge}>
                <IconShield size={18} color="#EA580C" />
              </View>
            </Pressable>
          </View>

          {/* Centered Large Avatar with Ring */}
          <View style={profileStyles.avatarCenteredWrapper}>
            <View style={profileStyles.avatarRing}>
              <WorkerAvatar size={92} role={scope.role} />
            </View>
            <View
              style={[
                profileStyles.avatarRoleBadge,
                { backgroundColor: scope.role === 'worker' ? '#10B981' : '#2563EB' },
              ]}
            >
              <View style={profileStyles.avatarRoleDot} />
            </View>
          </View>

          {/* Centered Display Name */}
          <Text numberOfLines={2} ellipsizeMode="tail" style={profileStyles.userName}>
            {user.displayName}
          </Text>

          {/* Location Pin Row */}
          <View style={profileStyles.locationRow}>
            <IconMapPin size={15} color="#EA580C" />
            <Text numberOfLines={1} ellipsizeMode="tail" style={profileStyles.locationText}>
              {scope.siteName}
            </Text>
          </View>

          {/* Role, Worker Code & Username Badges */}
          <View style={profileStyles.tagsRow}>
            <View
              style={[
                profileStyles.rolePill,
                { backgroundColor: scope.role === 'worker' ? '#EDFAF2' : '#EFF6FF' },
              ]}
            >
              <Text
                style={[
                  profileStyles.rolePillText,
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
                    <View style={profileStyles.workerIdPill}>
                      <Text style={profileStyles.workerIdText}>{data.externalId}</Text>
                    </View>
                  ) : (
                    <Text style={profileStyles.noProfileText}>{t('profile.noWorkerProfile')}</Text>
                  )
                }
              </QueryState>
            )}

            <Text style={profileStyles.usernameText}>@{user.username}</Text>
          </View>
        </View>

        {/* 2. Section "General" (Cài đặt chung) */}
        <View style={profileStyles.generalSection}>
          <Text style={profileStyles.sectionTitle}>{t('profile.generalSection')}</Text>

          <View style={profileStyles.menuGroupCard}>
            {/* Row 1: Profile Setting / Thông tin tài khoản */}
            <View style={profileStyles.menuItem}>
              <View style={[profileStyles.menuIconBox, { backgroundColor: '#EFF6FF' }]}>
                <IconUser size={18} color="#2563EB" />
              </View>
              <View style={profileStyles.menuTextCol}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={profileStyles.menuTitle}>
                  {t('profile.personalInfo')}
                </Text>
                <Text numberOfLines={1} ellipsizeMode="tail" style={profileStyles.menuSubtitle}>
                  @{user.username}
                </Text>
              </View>
              <IconChevronRight size={16} color="#CBD5E1" />
            </View>

            <View style={profileStyles.menuDivider} />

            {/* Row 2: Location / Công trường */}
            <View style={profileStyles.menuItem}>
              <View style={[profileStyles.menuIconBox, { backgroundColor: '#FEF3C7' }]}>
                <IconMapPin size={18} color="#D97706" />
              </View>
              <View style={profileStyles.menuTextCol}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={profileStyles.menuTitle}>
                  {t('profile.siteLocation')}
                </Text>
                <Text numberOfLines={1} ellipsizeMode="tail" style={profileStyles.menuSubtitle}>
                  {scope.siteName}
                </Text>
              </View>
              <IconChevronRight size={16} color="#CBD5E1" />
            </View>

            {/* Optional: Switch Scope (Only for multi-scope users) */}
            {canSwitchScope && (
              <>
                <View style={profileStyles.menuDivider} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('scope.switchScope')}
                  style={({ pressed }) => [
                    profileStyles.menuItem,
                    pressed && { opacity: 0.75, backgroundColor: '#F8FAFC' },
                  ]}
                  onPress={onScopeChange}
                >
                  <View style={[profileStyles.menuIconBox, { backgroundColor: '#FFF7ED' }]}>
                    <IconSwap size={18} color="#EA580C" />
                  </View>
                  <View style={profileStyles.menuTextCol}>
                    <Text numberOfLines={1} ellipsizeMode="tail" style={profileStyles.menuTitle}>
                      {scope.role === 'worker'
                        ? t('profile.switchMode')
                        : t('profile.switchContractor')}
                    </Text>
                    <Text numberOfLines={1} ellipsizeMode="tail" style={profileStyles.menuSubtitle}>
                      {t('scope.chooseAgain')}
                    </Text>
                  </View>
                  <IconChevronRight size={16} color="#CBD5E1" />
                </Pressable>
              </>
            )}

            {/* Row 3: Manage Documents / Worker Documents (Worker only) */}
            {scope.role === 'worker' && (
              <>
                <View style={profileStyles.menuDivider} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('documents.title')}
                  style={({ pressed }) => [
                    profileStyles.menuItem,
                    pressed && { opacity: 0.75, backgroundColor: '#F8FAFC' },
                  ]}
                  onPress={() => setDocuments(true)}
                >
                  <View style={[profileStyles.menuIconBox, { backgroundColor: '#FFF7ED' }]}>
                    <IconDocument size={18} color="#EA580C" />
                  </View>
                  <View style={profileStyles.menuTextCol}>
                    <Text numberOfLines={1} ellipsizeMode="tail" style={profileStyles.menuTitle}>
                      {t('profile.safetyCertificates')}
                    </Text>
                    <Text numberOfLines={1} ellipsizeMode="tail" style={profileStyles.menuSubtitle}>
                      {t('profile.safetyCertificatesSubtitle')}
                    </Text>
                  </View>
                  <View style={[profileStyles.statusBadge, { backgroundColor: docBadgeBg }]}>
                    <Text
                      numberOfLines={1}
                      style={[profileStyles.statusBadgeText, { color: docBadgeColor }]}
                    >
                      {isApproved
                        ? t('profile.validStatus')
                        : isPending
                          ? t('documents.PENDING')
                          : isExpired
                            ? t('profile.expiredStatus')
                            : t('profile.notSubmitted')}
                    </Text>
                  </View>
                  <IconChevronRight size={16} color="#CBD5E1" />
                </Pressable>
              </>
            )}

            <View style={profileStyles.menuDivider} />

            {/* Row 4: Security / Change Password */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('profile.changePassword')}
              style={({ pressed }) => [
                profileStyles.menuItem,
                pressed && { opacity: 0.75, backgroundColor: '#F8FAFC' },
              ]}
              onPress={() => setShowPasswordModal(true)}
            >
              <View style={[profileStyles.menuIconBox, { backgroundColor: '#F1F5F9' }]}>
                <IconLock size={18} color="#475569" />
              </View>
              <View style={profileStyles.menuTextCol}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={profileStyles.menuTitle}>
                  {t('profile.changePassword')}
                </Text>
                <Text numberOfLines={1} ellipsizeMode="tail" style={profileStyles.menuSubtitle}>
                  {t('profile.changePasswordSubtitle')}
                </Text>
              </View>
              <IconChevronRight size={16} color="#CBD5E1" />
            </Pressable>

            <View style={profileStyles.menuDivider} />

            {/* Row 5: Language Toggle */}
            <View style={profileStyles.menuItem}>
              <View style={[profileStyles.menuIconBox, { backgroundColor: '#F0FDF4' }]}>
                <IconGlobe size={18} color="#16A34A" />
              </View>
              <View style={profileStyles.menuTextCol}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={profileStyles.menuTitle}>
                  {t('profile.displayLanguage')}
                </Text>
                <Text numberOfLines={1} ellipsizeMode="tail" style={profileStyles.menuSubtitle}>
                  {isEn ? 'English' : 'Tiếng Việt'}
                </Text>
              </View>
              <View style={profileStyles.langSwitchRow}>
                <Pressable
                  hitSlop={6}
                  onPress={() => void setLanguage('vi')}
                  style={[profileStyles.langOption, !isEn && profileStyles.langOptionActive]}
                >
                  <Text
                    style={[
                      profileStyles.langOptionText,
                      !isEn && profileStyles.langOptionTextActive,
                    ]}
                  >
                    VI
                  </Text>
                </Pressable>
                <Pressable
                  hitSlop={6}
                  onPress={() => void setLanguage('en')}
                  style={[profileStyles.langOption, isEn && profileStyles.langOptionActive]}
                >
                  <Text
                    style={[
                      profileStyles.langOptionText,
                      isEn && profileStyles.langOptionTextActive,
                    ]}
                  >
                    EN
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={profileStyles.menuDivider} />

            {/* Row 6: Logout */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.logout')}
              disabled={command.isPending}
              style={({ pressed }) => [
                profileStyles.menuItem,
                pressed && { opacity: 0.75, backgroundColor: '#FEF2F2' },
                command.isPending && { opacity: 0.6 },
              ]}
              onPress={() => command.mutate(() => session.logout())}
            >
              <View style={[profileStyles.menuIconBox, { backgroundColor: '#FEF2F2' }]}>
                <IconLogout size={18} color="#EF4444" />
              </View>
              <View style={profileStyles.menuTextCol}>
                <Text
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={[profileStyles.menuTitle, { color: '#EF4444', fontWeight: '700' }]}
                >
                  {t('common.logout')}
                </Text>
                <Text numberOfLines={1} ellipsizeMode="tail" style={profileStyles.menuSubtitle}>
                  {t('profile.logoutDevice')}
                </Text>
              </View>
              <IconChevronRight size={16} color="#FECACA" />
            </Pressable>
          </View>
        </View>

        <Text style={profileStyles.appVersionFooter}>SmartSite v0.1.0 · 2026</Text>

        <ChangePasswordModal
          visible={showPasswordModal}
          onClose={() => setShowPasswordModal(false)}
        />
      </ScrollView>
    </SafeAreaView>
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

const profileStyles = StyleSheet.create({
  scrollContainer: {
    paddingBottom: 40,
    backgroundColor: '#F8FAFC',
  },
  headerCard: {
    backgroundColor: '#FFF7ED',
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    paddingTop: 16,
    paddingBottom: 22,
    paddingHorizontal: 20,
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  topHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  topHeaderTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.3,
  },
  topRightBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hexagonBadge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FED7AA',
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  avatarCenteredWrapper: {
    alignSelf: 'center',
    marginBottom: 12,
    position: 'relative',
  },
  avatarRing: {
    padding: 4,
    borderRadius: 60,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  avatarRoleBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3,
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
  userName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F1E36',
    textAlign: 'center',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 10,
  },
  locationText: {
    fontSize: 13.5,
    color: '#64748B',
    fontWeight: '600',
  },
  tagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  rolePill: {
    paddingHorizontal: 10,
    paddingVertical: 3.5,
    borderRadius: 10,
  },
  rolePillText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  workerIdPill: {
    paddingHorizontal: 10,
    paddingVertical: 3.5,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
  },
  workerIdText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#475569',
  },
  noProfileText: {
    fontSize: 11.5,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  usernameText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
  },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#FED7AA',
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  statCol: {
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: 4,
    minWidth: 0,
  },
  statLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
    marginBottom: 4,
    textAlign: 'center',
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    maxWidth: '100%',
  },
  statIconEmoji: {
    fontSize: 13,
  },
  statValueText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F1E36',
    flexShrink: 1,
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#F1F5F9',
  },
  switchSection: {
    paddingHorizontal: 16,
    marginTop: 14,
  },
  switchModeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F1E36',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  switchModeCardStatic: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  switchModeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  switchIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  switchTextCol: {
    flex: 1,
  },
  switchModeTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0F1E36',
    marginBottom: 2,
  },
  switchModeSub: {
    fontSize: 12,
    color: '#64748B',
  },
  toggleTrack: {
    width: 46,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FFEDD5',
    padding: 2,
    justifyContent: 'center',
  },
  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#EA580C',
    alignSelf: 'flex-end',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  staticBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDFAF2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  staticBadgeText: {
    fontSize: 12,
    color: '#065F46',
    fontWeight: '600',
  },
  generalSection: {
    paddingHorizontal: 16,
    marginTop: 18,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#64748B',
    marginBottom: 10,
    paddingLeft: 4,
    letterSpacing: 0.3,
  },
  menuGroupCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F1E36',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  menuIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  menuTextCol: {
    flex: 1,
    marginRight: 8,
  },
  menuTitle: {
    fontSize: 14.5,
    fontWeight: '600',
    color: '#0F1E36',
    marginBottom: 2,
  },
  menuSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginLeft: 66,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginRight: 8,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  langSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 16,
    padding: 2,
    gap: 2,
  },
  langOption: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
  },
  langOptionActive: {
    backgroundColor: '#EA580C',
  },
  langOptionText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#64748B',
  },
  langOptionTextActive: {
    color: '#FFFFFF',
  },
  appVersionFooter: {
    textAlign: 'center',
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 18,
    marginBottom: 8,
  },
});
