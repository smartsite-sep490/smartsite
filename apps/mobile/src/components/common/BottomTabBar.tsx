import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { colors } from '../../theme/colors';
import {
  IconHome,
  IconCalendar,
  IconClock,
  IconUser,
  IconUsers,
  IconDocument,
} from './Icons';

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
  pendingRequestsCount = 3,
}: BottomTabBarProps) {
  const isWorker = role === 'worker';

  if (isWorker) {
    return (
      <View style={styles.container}>
        {/* Tab 1: Trang chủ */}
        <Pressable
          style={styles.tabItem}
          onPress={() => onSelectTab('home')}
          hitSlop={8}
        >
          <IconHome
            size={24}
            color={activeTab === 'home' ? colors.primary : colors.textTertiary}
          />
          <Text
            style={[
              styles.tabLabel,
              activeTab === 'home' && styles.tabLabelActive,
            ]}
          >
            Trang chủ
          </Text>
        </Pressable>

        {/* Tab 2: Lịch làm */}
        <Pressable
          style={styles.tabItem}
          onPress={() => onSelectTab('schedule')}
          hitSlop={8}
        >
          <IconCalendar
            size={24}
            color={activeTab === 'schedule' ? colors.primary : colors.textTertiary}
          />
          <Text
            style={[
              styles.tabLabel,
              activeTab === 'schedule' && styles.tabLabelActive,
            ]}
          >
            Lịch làm
          </Text>
        </Pressable>

        {/* Tab 3: Chấm công */}
        <Pressable
          style={styles.tabItem}
          onPress={() => onSelectTab('attendance')}
          hitSlop={8}
        >
          <IconClock
            size={24}
            color={activeTab === 'attendance' ? colors.primary : colors.textTertiary}
          />
          <Text
            style={[
              styles.tabLabel,
              activeTab === 'attendance' && styles.tabLabelActive,
            ]}
          >
            Chấm công
          </Text>
        </Pressable>

        {/* Tab 4: Cá nhân */}
        <Pressable
          style={styles.tabItem}
          onPress={() => onSelectTab('profile')}
          hitSlop={8}
        >
          <IconUser
            size={24}
            color={activeTab === 'profile' ? colors.primary : colors.textTertiary}
          />
          <Text
            style={[
              styles.tabLabel,
              activeTab === 'profile' && styles.tabLabelActive,
            ]}
          >
            Cá nhân
          </Text>
        </Pressable>
      </View>
    );
  }

  // Contractor Tabs (Image 3, 4, 5: Tổng quan | Nhân sự | Lịch làm | Yêu cầu)
  return (
    <View style={styles.container}>
      {/* Tab 1: Tổng quan */}
      <Pressable
        style={styles.tabItem}
        onPress={() => onSelectTab('home')}
        hitSlop={8}
      >
        <IconHome
          size={24}
          color={activeTab === 'home' ? colors.primary : colors.textTertiary}
        />
        <Text
          style={[
            styles.tabLabel,
            activeTab === 'home' && styles.tabLabelActive,
          ]}
        >
          Tổng quan
        </Text>
        {activeTab === 'home' && <View style={styles.tabIndicator} />}
      </Pressable>

      {/* Tab 2: Nhân sự */}
      <Pressable
        style={styles.tabItem}
        onPress={() => onSelectTab('workforce')}
        hitSlop={8}
      >
        <IconUsers
          size={24}
          color={activeTab === 'workforce' ? colors.primary : colors.textTertiary}
        />
        <Text
          style={[
            styles.tabLabel,
            activeTab === 'workforce' && styles.tabLabelActive,
          ]}
        >
          Nhân sự
        </Text>
        {activeTab === 'workforce' && <View style={styles.tabIndicator} />}
      </Pressable>

      {/* Tab 3: Lịch làm */}
      <Pressable
        style={styles.tabItem}
        onPress={() => onSelectTab('schedule')}
        hitSlop={8}
      >
        <IconCalendar
          size={24}
          color={activeTab === 'schedule' ? colors.primary : colors.textTertiary}
        />
        <Text
          style={[
            styles.tabLabel,
            activeTab === 'schedule' && styles.tabLabelActive,
          ]}
        >
          Lịch làm
        </Text>
        {activeTab === 'schedule' && <View style={styles.tabIndicator} />}
      </Pressable>

      {/* Tab 4: Yêu cầu */}
      <Pressable
        style={styles.tabItem}
        onPress={() => onSelectTab('requests')}
        hitSlop={8}
      >
        <View>
          <IconDocument
            size={24}
            color={activeTab === 'requests' ? colors.primary : colors.textTertiary}
          />
          {pendingRequestsCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{pendingRequestsCount}</Text>
            </View>
          )}
        </View>
        <Text
          style={[
            styles.tabLabel,
            activeTab === 'requests' && styles.tabLabelActive,
          ]}
        >
          Yêu cầu
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
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingBottom: 4,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textTertiary,
    marginTop: 4,
  },
  tabLabelActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  tabIndicator: {
    width: 24,
    height: 2.5,
    backgroundColor: colors.primary,
    borderRadius: 2,
    marginTop: 3,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: colors.primary,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
