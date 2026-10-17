import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { colors } from '../../theme/colors';
import { IconHome, IconCalendar, IconClock, IconUser, IconUsers, IconDocument } from './Icons';
import { useTranslation } from '../../i18n';

export type WorkerTab = 'home' | 'schedule' | 'attendance' | 'profile';
export type ContractorTab = 'home' | 'workforce' | 'schedule' | 'requests';

interface BottomTabBarProps {
  role: 'worker' | 'contractor';
  activeTab: string;
  onSelectTab: (tab: WorkerTab | ContractorTab) => void;
  pendingRequestsCount?: number;
}

export function BottomTabBar({
  role,
  activeTab,
  onSelectTab,
  pendingRequestsCount = 0,
}: BottomTabBarProps) {
  const { t } = useTranslation();
  const isWorker = role === 'worker';

  if (isWorker) {
    return (
      <View style={styles.container}>
        {/* Tab 1: Trang chủ */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('tabs.home')}
          style={styles.tabItem}
          onPress={() => onSelectTab('home')}
          hitSlop={8}
        >
          <IconHome size={24} color={activeTab === 'home' ? colors.primary : colors.textTertiary} />
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.tabLabel, activeTab === 'home' && styles.tabLabelActive]}
          >
            {t('tabs.home')}
          </Text>
          {activeTab === 'home' && <View style={styles.tabIndicator} />}
        </Pressable>

        {/* Tab 2: Lịch làm */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('tabs.schedule')}
          style={styles.tabItem}
          onPress={() => onSelectTab('schedule')}
          hitSlop={8}
        >
          <IconCalendar
            size={24}
            color={activeTab === 'schedule' ? colors.primary : colors.textTertiary}
          />
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.tabLabel, activeTab === 'schedule' && styles.tabLabelActive]}
          >
            {t('tabs.schedule')}
          </Text>
          {activeTab === 'schedule' && <View style={styles.tabIndicator} />}
        </Pressable>

        {/* Tab 3: Chấm công */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('tabs.attendance')}
          style={styles.tabItem}
          onPress={() => onSelectTab('attendance')}
          hitSlop={8}
        >
          <IconClock
            size={24}
            color={activeTab === 'attendance' ? colors.primary : colors.textTertiary}
          />
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.tabLabel, activeTab === 'attendance' && styles.tabLabelActive]}
          >
            {t('tabs.attendance')}
          </Text>
          {activeTab === 'attendance' && <View style={styles.tabIndicator} />}
        </Pressable>

        {/* Tab 4: Cá nhân */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('tabs.profile')}
          style={styles.tabItem}
          onPress={() => onSelectTab('profile')}
          hitSlop={8}
        >
          <IconUser
            size={24}
            color={activeTab === 'profile' ? colors.primary : colors.textTertiary}
          />
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.tabLabel, activeTab === 'profile' && styles.tabLabelActive]}
          >
            {t('tabs.profile')}
          </Text>
          {activeTab === 'profile' && <View style={styles.tabIndicator} />}
        </Pressable>
      </View>
    );
  }

  // Contractor Tabs: Tổng quan | Nhân sự | Lịch làm | Yêu cầu
  return (
    <View style={styles.container}>
      {/* Tab 1: Tổng quan */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('tabs.overview')}
        style={styles.tabItem}
        onPress={() => onSelectTab('home')}
        hitSlop={8}
      >
        <IconHome size={24} color={activeTab === 'home' ? colors.primary : colors.textTertiary} />
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[styles.tabLabel, activeTab === 'home' && styles.tabLabelActive]}
        >
          {t('tabs.overview')}
        </Text>
        {activeTab === 'home' && <View style={styles.tabIndicator} />}
      </Pressable>

      {/* Tab 2: Nhân sự */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('tabs.workforce')}
        style={styles.tabItem}
        onPress={() => onSelectTab('workforce')}
        hitSlop={8}
      >
        <IconUsers
          size={24}
          color={activeTab === 'workforce' ? colors.primary : colors.textTertiary}
        />
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[styles.tabLabel, activeTab === 'workforce' && styles.tabLabelActive]}
        >
          {t('tabs.workforce')}
        </Text>
        {activeTab === 'workforce' && <View style={styles.tabIndicator} />}
      </Pressable>

      {/* Tab 3: Lịch làm */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('tabs.schedule')}
        style={styles.tabItem}
        onPress={() => onSelectTab('schedule')}
        hitSlop={8}
      >
        <IconCalendar
          size={24}
          color={activeTab === 'schedule' ? colors.primary : colors.textTertiary}
        />
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[styles.tabLabel, activeTab === 'schedule' && styles.tabLabelActive]}
        >
          {t('tabs.schedule')}
        </Text>
        {activeTab === 'schedule' && <View style={styles.tabIndicator} />}
      </Pressable>

      {/* Tab 4: Yêu cầu */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('tabs.requests')}
        style={styles.tabItem}
        onPress={() => onSelectTab('requests')}
        hitSlop={8}
      >
        <View style={styles.iconWrapper}>
          <IconDocument
            size={24}
            color={activeTab === 'requests' ? colors.primary : colors.textTertiary}
          />
          {pendingRequestsCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {pendingRequestsCount > 99 ? '99+' : pendingRequestsCount}
              </Text>
            </View>
          )}
        </View>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[styles.tabLabel, activeTab === 'requests' && styles.tabLabelActive]}
        >
          {t('tabs.requests')}
        </Text>
        {activeTab === 'requests' && <View style={styles.tabIndicator} />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    height: 64,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#EFF2F6',
    paddingBottom: 4,
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    paddingTop: 4,
    minWidth: 0,
    paddingHorizontal: 2,
  },
  tabLabel: {
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: 4,
    fontWeight: '500',
    textAlign: 'center',
  },
  tabLabelActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  tabIndicator: {
    position: 'absolute',
    top: 0,
    width: 24,
    height: 3,
    backgroundColor: colors.primary,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  iconWrapper: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: colors.primary,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
});
