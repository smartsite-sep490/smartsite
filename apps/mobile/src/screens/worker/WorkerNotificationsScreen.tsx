import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { colors } from '../../theme/colors';
import { ScreenHeader } from '../../components/common/ScreenHeader';
import {
  IconCalendar,
  IconCheck,
  IconDocument,
  IconChevronRight,
} from '../../components/common/Icons';

interface NotificationItem {
  id: string;
  type: 'warning' | 'shift' | 'overtime' | 'attendance';
  title: string;
  content: string;
  time: string;
  isUnread: boolean;
}

const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'n-1',
    type: 'warning',
    title: 'Vượt số lần ra ngoài cho phép',
    content: 'Ngày 14/10: lượt ra ngoài thứ 3, toàn bộ thời gian lượt này bị trừ công.',
    time: '16/10 · 08:15',
    isUnread: true,
  },
  {
    id: 'n-2',
    type: 'shift',
    title: 'Ca làm đã thay đổi',
    content: 'Ca ngày 17/10: 08:00 – 12:00',
    time: '15/10 · 17:40',
    isUnread: true,
  },
  {
    id: 'n-3',
    type: 'overtime',
    title: 'Tăng ca đã được duyệt',
    content: '16/10: 17:30 – 19:30',
    time: '15/10 · 10:02',
    isUnread: false,
  },
  {
    id: 'n-4',
    type: 'attendance',
    title: 'Ngày công đã xác nhận',
    content: 'Ngày 13/10: 8 giờ',
    time: '14/10 · 09:00',
    isUnread: false,
  },
];

interface WorkerNotificationsScreenProps {
  onBack: () => void;
  onSelectNotification?: (item: NotificationItem) => void;
}

export function WorkerNotificationsScreen({
  onBack,
  onSelectNotification,
}: WorkerNotificationsScreenProps) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [notifications, setNotifications] = useState<NotificationItem[]>(INITIAL_NOTIFICATIONS);

  const handleMarkAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isUnread: false })));
  };

  const unreadCount = notifications.filter((n) => n.isUnread).length;
  const filtered = notifications.filter((n) => (filter === 'all' ? true : n.isUnread));

  return (
    <View style={styles.container}>
      <ScreenHeader mode="detail" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Title row */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>Thông báo</Text>
          <Pressable onPress={handleMarkAllRead} hitSlop={8}>
            <Text style={styles.readAllText}>Đọc tất cả</Text>
          </Pressable>
        </View>

        {/* Filter Toggle */}
        <View style={styles.toggleBar}>
          <Pressable
            style={[styles.toggleBtn, filter === 'all' && styles.toggleBtnActive]}
            onPress={() => setFilter('all')}
          >
            <Text style={[styles.toggleBtnText, filter === 'all' && styles.toggleBtnTextActive]}>
              Tất cả
            </Text>
          </Pressable>
          <Pressable
            style={[styles.toggleBtn, filter === 'unread' && styles.toggleBtnActive]}
            onPress={() => setFilter('unread')}
          >
            <Text style={[styles.toggleBtnText, filter === 'unread' && styles.toggleBtnTextActive]}>
              Chưa đọc ({unreadCount})
            </Text>
          </Pressable>
        </View>

        {/* Notifications list */}
        {filtered.map((item) => {
          return (
            <Pressable
              key={item.id}
              style={({ pressed }) => [styles.itemCard, pressed && { opacity: 0.9 }]}
              onPress={() => onSelectNotification?.(item)}
            >
              {/* Left icon circle */}
              {item.type === 'warning' && (
                <View style={[styles.iconCircle, { backgroundColor: '#EF4444' }]}>
                  <Text style={styles.iconSymbolWhite}>!</Text>
                </View>
              )}
              {item.type === 'shift' && (
                <View style={[styles.iconCircle, { backgroundColor: '#F97316' }]}>
                  <IconCalendar size={18} color="#FFFFFF" />
                </View>
              )}
              {item.type === 'overtime' && (
                <View style={[styles.iconCircle, { backgroundColor: '#10B981' }]}>
                  <IconCheck size={18} color="#FFFFFF" />
                </View>
              )}
              {item.type === 'attendance' && (
                <View style={[styles.iconCircle, { backgroundColor: '#10B981' }]}>
                  <IconDocument size={18} color="#FFFFFF" />
                </View>
              )}

              {/* Text content */}
              <View style={styles.itemContent}>
                <View style={styles.itemTitleRow}>
                  {item.isUnread && <View style={styles.unreadDot} />}
                  <Text style={styles.itemTitle}>{item.title}</Text>
                </View>
                <Text style={styles.itemText}>{item.content}</Text>
                <Text style={styles.itemTime}>{item.time}</Text>
              </View>

              <IconChevronRight size={18} color={colors.textTertiary} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.4,
  },
  readAllText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  toggleBar: {
    flexDirection: 'row',
    backgroundColor: '#F1F4F8',
    borderRadius: 14,
    padding: 4,
    marginBottom: 20,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  toggleBtnActive: {
    backgroundColor: '#0F1E36',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  toggleBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  toggleBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F4F8',
    paddingVertical: 16,
    gap: 14,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSymbolWhite: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
  },
  itemContent: {
    flex: 1,
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.primary,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F1E36',
  },
  itemText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: 4,
  },
  itemTime: {
    fontSize: 12,
    color: colors.textTertiary,
  },
});
