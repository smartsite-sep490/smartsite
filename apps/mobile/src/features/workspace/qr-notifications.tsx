import { WorkerQrPanel } from './worker-qr-panel';
import React, { useMemo, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { UserNotificationResponse } from '@smartsite/api-client';
import { useWorkspace } from './workspace-context';
import { Button, CompactTabs, ErrorNotice, Hint, Page, Pager, QueryState } from '../shared/ui';
import { RequestSheet } from '../shared/request-sheet';
import { ManagementAction } from '../shared/management-ui';
import { EmptyState } from '../contractor/contractor-presentation';
import { colors } from '../../theme/colors';
import { displayTime, useCommand } from '../shared/data';
import type { NavigationTarget } from '../../SmartSiteMobileApp';
import { notificationTarget } from './notification-target';
import { useTranslation } from '../../i18n';
import { notificationTitle, notificationMessage } from '../../i18n/messages';
import {
  IconBell,
  IconCalendar,
  IconClock,
  IconAlert,
  IconCheck,
  IconTrash,
  IconChevronDown,
  IconChevronRight,
} from '../../components/common/Icons';

export function QrScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <Page title={t('qr.title')} onBack={onBack}>
      <WorkerQrPanel />
    </Page>
  );
}
function getNotificationCategory(event: string, t: (key: string) => string) {
  if (event.includes('SCHEDULE') || event.includes('SWAP')) {
    return { label: t('notifications.categorySchedule'), color: '#2563EB', bg: '#EFF6FF' };
  }
  if (event.includes('TIME') || event.includes('EXIT') || event.includes('ENTRY')) {
    return { label: t('notifications.categoryAttendance'), color: '#059669', bg: '#EDFAF2' };
  }
  if (event.includes('ALERT') || event.includes('EXCEEDED') || event.includes('ABSENT')) {
    return { label: t('notifications.categorySafety'), color: '#EA580C', bg: '#FFF7ED' };
  }
  return { label: t('notifications.categoryGeneral'), color: '#F66B17', bg: '#FFF4EE' };
}

function getNotificationIcon(event: string) {
  if (event.includes('SCHEDULE') || event.includes('SWAP')) {
    return <IconCalendar size={18} color="#2563EB" />;
  }
  if (event.includes('TIME') || event.includes('EXIT') || event.includes('ENTRY')) {
    return <IconClock size={18} color="#059669" />;
  }
  if (event.includes('ALERT') || event.includes('EXCEEDED') || event.includes('ABSENT')) {
    return <IconAlert size={18} color="#EA580C" />;
  }
  return <IconBell size={18} color="#F66B17" hasUnread={false} />;
}

type NotificationRowProps = {
  notification: UserNotificationResponse;
  divider: boolean;
  onPress: () => void;
  onDelete: () => void;
  onMarkRead: () => void;
  isPending: boolean;
  t: (key: string) => string;
};
function NotificationRow({
  notification,
  divider,
  onPress,
  onDelete,
  onMarkRead,
  isPending,
  t,
}: NotificationRowProps) {
  const [translateX] = useState(() => new Animated.Value(0));
  const unread = !notification.readAt;
  const category = getNotificationCategory(notification.event, t);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          !isPending && gesture.dx > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_, gesture) => translateX.setValue(Math.max(0, gesture.dx)),
        onPanResponderRelease: (_, gesture) => {
          if (!isPending && gesture.dx > 90) {
            Animated.timing(translateX, {
              toValue: 500,
              duration: 220,
              useNativeDriver: false,
            }).start(() => {
              onDelete();
              translateX.setValue(0);
            });
          } else
            Animated.spring(translateX, {
              toValue: 0,
              friction: 8,
              tension: 50,
              useNativeDriver: false,
            }).start();
        },
        onPanResponderTerminate: () =>
          Animated.spring(translateX, { toValue: 0, useNativeDriver: false }).start(),
      }),
    [isPending, onDelete, translateX],
  );
  return (
    <View style={[styles.swipeContainer, divider && styles.divider]}>
      <View style={styles.swipeBackground}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('notifications.deleteNotification')}
          disabled={isPending}
          onPress={onDelete}
          style={styles.swipeDelete}
        >
          <IconTrash size={20} color={colors.textWhite} />
          <Text style={styles.swipeDeleteText}>{t('notifications.deleteNotification')}</Text>
        </Pressable>
      </View>
      <Animated.View
        {...panResponder.panHandlers}
        style={[styles.foreground, unread && styles.unread, { transform: [{ translateX }] }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={notificationTitle(notification)}
          accessibilityHint={t('notifications.openDetails')}
          onPress={onPress}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <View style={[styles.icon, { backgroundColor: category.bg }]}>
            {getNotificationIcon(notification.event)}
          </View>
          <View style={styles.copy}>
            <View style={styles.titleRow}>
              <Text numberOfLines={2} style={[styles.title, unread && styles.unreadTitle]}>
                {notificationTitle(notification)}
              </Text>
              {unread && <View style={styles.unreadDot} />}
            </View>
            {notification.processingStatus && (
              <Text
                style={{
                  color: notification.processingStatus === 'RESOLVED' ? '#047857' : '#92400E',
                  fontSize: 12,
                  fontWeight: '600',
                }}
              >
                {t(`notifications.workflowStatus_${notification.processingStatus}`)}
              </Text>
            )}
            <Text numberOfLines={2} style={styles.message}>
              {notificationMessage(notification)}
            </Text>
            <Text numberOfLines={1} style={styles.meta}>
              {notification.siteName} {'\u00b7'} {displayTime(notification.createdAt)}
            </Text>
          </View>
          {!unread && <IconChevronRight size={15} color={colors.textTertiary} />}
        </Pressable>
        {unread && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('notifications.markRead')}
            disabled={isPending}
            onPress={onMarkRead}
            style={[styles.readAction, isPending && styles.pressed]}
          >
            <IconCheck size={18} color={colors.primary} />
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

export function NotificationsScreen({
  navigate,
}: {
  navigate: (target: NavigationTarget) => void;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const { client, token, scope, queryKey } = useWorkspace();
  const size = 10;
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<'ALL' | 'UNREAD'>('ALL');
  const [selected, setSelected] = useState<UserNotificationResponse | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const command = useCommand();
  const query = useQuery({
    queryKey: [...queryKey, 'notifications', offset, filter],
    queryFn: () => client.listNotifications(token, { offset, limit: size, readStatus: filter }),
    refetchInterval: 30000,
  });
  const target = selected ? notificationTarget(selected, scope.siteId, scope.role) : null;
  const open = (row: UserNotificationResponse) => {
    setSelected(row);
    if (!row.readAt && !command.isPending)
      command.mutate(() => client.readNotification(token, row.id));
  };
  const remove = (id: string) =>
    command.mutate(async () => {
      await client.deleteNotification(token, id);
      if (query.data?.items.length === 1 && offset > 0) setOffset(Math.max(0, offset - size));
      setSelected(null);
    });
  return (
    <Page>
      <CompactTabs
        value={filter}
        options={[
          { value: 'ALL', label: t('notifications.all') },
          { value: 'UNREAD', label: t('notifications.unread') },
        ]}
        onChange={(value) => {
          setFilter(value as typeof filter);
          setOffset(0);
        }}
      />
      <View style={styles.toolbar}>
        <Text style={styles.count}>
          {query.data ? t('notifications.unreadCount', { count: query.data.unreadCount }) : ''}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('notifications.actions')}
          onPress={() => {
            command.reset();
            setActionsOpen(true);
          }}
          style={({ pressed }) => [styles.moreAction, pressed && styles.pressed]}
        >
          <Text style={styles.moreText}>{t('notifications.actions')}</Text>
          <IconChevronDown size={15} color={colors.textMuted} />
        </Pressable>
      </View>
      {!selected && !actionsOpen && <ErrorNotice error={command.error} />}
      <QueryState query={query}>
        {(data) => (
          <>
            {!data.items.length ? (
              <EmptyState
                icon={<IconBell size={25} color={colors.textMuted} hasUnread={false} />}
                title={t('notifications.noNotifications')}
                hint={t('notifications.emptyHint')}
              />
            ) : (
              <View style={styles.list}>
                {data.items.map((row, index) => (
                  <NotificationRow
                    key={row.id}
                    notification={row}
                    divider={index > 0}
                    onPress={() => open(row)}
                    onDelete={() => remove(row.id)}
                    onMarkRead={() => command.mutate(() => client.readNotification(token, row.id))}
                    isPending={command.isPending}
                    t={t}
                  />
                ))}
              </View>
            )}
            {(data.total > size || offset > 0) && (
              <Pager offset={offset} total={data.total} size={size} onChange={setOffset} />
            )}
          </>
        )}
      </QueryState>
      {selected && (
        <RequestSheet
          visible
          variant="compact"
          title={t('notifications.detailTitle')}
          subtitle={getNotificationCategory(selected.event, t).label}
          icon={getNotificationIcon(selected.event)}
          onClose={() => setSelected(null)}
          busy={command.isPending}
          footer={
            <View style={styles.footer}>
              <ErrorNotice error={command.error} />
              {target && (
                <Button
                  label={t('notifications.viewTarget')}
                  onPress={() => {
                    setSelected(null);
                    navigate(target);
                  }}
                />
              )}
              <View style={styles.secondaryActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('notifications.deleteNotification')}
                  disabled={command.isPending}
                  onPress={() => remove(selected.id)}
                  style={({ pressed }) => [
                    styles.textAction,
                    (pressed || command.isPending) && styles.pressed,
                  ]}
                >
                  <IconTrash size={16} color={colors.dangerText} />
                  <Text style={styles.deleteText}>{t('notifications.deleteNotification')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('common.close')}
                  disabled={command.isPending}
                  onPress={() => setSelected(null)}
                  style={styles.textAction}
                >
                  <Text style={styles.moreText}>{t('common.close')}</Text>
                </Pressable>
              </View>
            </View>
          }
        >
          <Text style={styles.detailTitle}>{notificationTitle(selected)}</Text>
          <View style={styles.detailMeta}>
            <Text style={styles.site}>{selected.siteName}</Text>
            <Text style={styles.meta}>
              {t('notifications.receivedAt')}: {displayTime(selected.createdAt)}
            </Text>
          </View>
          <Text selectable style={styles.detailMessage}>
            {notificationMessage(selected)}
          </Text>
          {!target && <Hint>{t('notifications.unmatchedScopeNotice')}</Hint>}
        </RequestSheet>
      )}
      {actionsOpen && (
        <RequestSheet
          visible
          variant="compact"
          title={t('notifications.actions')}
          onClose={() => setActionsOpen(false)}
          busy={command.isPending}
          footer={<ErrorNotice error={command.error} />}
        >
          <ManagementAction
            label={t('notifications.markAllRead')}
            icon={<IconCheck size={19} color={colors.primary} />}
            disabled={command.isPending || query.data?.unreadCount === 0}
            onPress={() =>
              command.mutate(async () => {
                await client.readAllNotifications(token);
                setActionsOpen(false);
              })
            }
          />
          <ManagementAction
            label={t('notifications.clearRead')}
            danger
            icon={<IconTrash size={19} color={colors.dangerText} />}
            disabled={command.isPending}
            onPress={() =>
              command.mutate(async () => {
                await client.deleteReadNotifications(token);
                setOffset(0);
                setActionsOpen(false);
              })
            }
          />
        </RequestSheet>
      )}
    </Page>
  );
}
const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  count: { flex: 1, color: colors.textMuted, fontSize: 12, lineHeight: 19 },
  moreAction: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
  },
  moreText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  list: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  swipeContainer: { overflow: 'hidden' },
  divider: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  swipeBackground: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.danger,
  },
  swipeDelete: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
  },
  swipeDeleteText: { color: colors.textWhite, fontSize: 12, fontWeight: '600' },
  foreground: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface },
  unread: { backgroundColor: '#FFFAF7' },
  row: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    gap: 12,
  },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: colors.textPrimary, fontSize: 13, lineHeight: 20, fontWeight: '500' },
  unreadTitle: { fontWeight: '700' },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  message: { color: colors.textSecondary, fontSize: 12, lineHeight: 19 },
  meta: { color: colors.textMuted, fontSize: 11, lineHeight: 18 },
  readAction: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  footer: { gap: 8 },
  secondaryActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  textAction: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 8,
  },
  deleteText: { color: colors.dangerText, fontSize: 12, fontWeight: '600' },
  detailTitle: { color: colors.textPrimary, fontSize: 17, lineHeight: 25, fontWeight: '700' },
  detailMeta: { padding: 14, gap: 5, borderRadius: 14, backgroundColor: colors.surfaceSubtle },
  site: { color: colors.textPrimary, fontSize: 13, lineHeight: 20, fontWeight: '500' },
  detailMessage: { color: colors.textPrimary, fontSize: 14, lineHeight: 23 },
});
