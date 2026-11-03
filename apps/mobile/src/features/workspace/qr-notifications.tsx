import { WorkerQrPanel } from './worker-qr-panel';
import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  Platform,
  ScrollView,
  PanResponder,
  Animated,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { UserNotificationResponse } from '@smartsite/api-client';
import { useWorkspace } from './workspace-context';
import { ErrorNotice, Page, Pager, QueryState } from '../shared/ui';
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

interface SwipeableNotificationCardProps {
  notification: UserNotificationResponse;
  isUnread: boolean;
  target: NavigationTarget | null;
  onPress: () => void;
  onDelete: () => void;
  onMarkRead?: () => void;
  isPending: boolean;
  t: (key: string) => string;
}

function SwipeableNotificationCard({
  notification: n,
  isUnread,
  target,
  onPress,
  onDelete,
  onMarkRead,
  isPending,
  t,
}: SwipeableNotificationCardProps) {
  const [translateX] = useState(() => new Animated.Value(0));

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return gestureState.dx > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
        },
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dx > 0) {
            translateX.setValue(gestureState.dx);
          } else {
            translateX.setValue(0);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx > 90) {
            Animated.timing(translateX, {
              toValue: 500,
              duration: 220,
              useNativeDriver: false,
            }).start(() => {
              onDelete();
            });
          } else {
            Animated.spring(translateX, {
              toValue: 0,
              friction: 8,
              tension: 50,
              useNativeDriver: false,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, {
            toValue: 0,
            friction: 8,
            tension: 50,
            useNativeDriver: false,
          }).start();
        },
      }),
    [onDelete, translateX],
  );

  return (
    <View style={notifStyles.swipeContainer}>
      {/* Background delete action revealed when swiped right */}
      <View style={notifStyles.swipeBackground}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('notifications.deleteNotification')}
          style={notifStyles.swipeDeleteAction}
          onPress={onDelete}
        >
          <View style={notifStyles.swipeDeleteContent}>
            <IconTrash size={22} color="#FFFFFF" />
            <Text style={notifStyles.swipeDeleteText}>{t('notifications.deleteNotification')}</Text>
          </View>
        </Pressable>
      </View>

      {/* Foreground notification card */}
      <Animated.View
        style={[
          notifStyles.swipeForeground,
          {
            transform: [{ translateX }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={notificationTitle(n)}
          onPress={onPress}
          style={({ pressed }) => [
            notifStyles.card,
            isUnread && notifStyles.unreadCard,
            pressed && { opacity: 0.94 },
          ]}
        >
          {isUnread && <View style={notifStyles.unreadIndicator} />}

          <View style={notifStyles.cardContent}>
            {/* Header Row: Icon, Title, and Time */}
            <View style={notifStyles.cardHeader}>
              <View style={notifStyles.headerLeft}>
                <View style={notifStyles.iconBox}>{getNotificationIcon(n.event)}</View>
                <View style={notifStyles.titleCol}>
                  <View style={notifStyles.titleRow}>
                    {isUnread && <View style={notifStyles.unreadDot} />}
                    <Text
                      numberOfLines={2}
                      style={[notifStyles.cardTitle, isUnread && notifStyles.unreadTitle]}
                    >
                      {notificationTitle(n)}
                    </Text>
                  </View>
                  <Text style={notifStyles.siteText}>
                    {n.siteName} · {displayTime(n.createdAt)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Notification Body */}
            <Text numberOfLines={3} style={notifStyles.cardBody}>
              {notificationMessage(n)}
            </Text>

            {/* Unmatched scope notice if needed */}
            {!target && (
              <Text style={notifStyles.noticeText}>{t('notifications.unmatchedScopeNotice')}</Text>
            )}

            {/* Card Actions Row */}
            <View style={notifStyles.cardFooter}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('notifications.openDetails')}
                style={notifStyles.openDetailsLink}
                onPress={onPress}
              >
                <Text style={notifStyles.openDetailsText}>{t('notifications.openDetails')}</Text>
                <IconChevronRight size={16} color="#F66B17" />
              </Pressable>

              <View style={notifStyles.footerActions}>
                <Text style={notifStyles.swipeHintText}>
                  {t('notifications.swipeToDeleteHint')}
                </Text>
                {isUnread && onMarkRead && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('notifications.markRead')}
                    disabled={isPending}
                    style={({ pressed }) => [
                      notifStyles.pillActionBtn,
                      notifStyles.readActionBtn,
                      pressed && { opacity: 0.7 },
                    ]}
                    onPress={onMarkRead}
                  >
                    <IconCheck size={14} color="#065F46" />
                    <Text style={notifStyles.readActionText}>{t('notifications.markRead')}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </Pressable>
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
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<'ALL' | 'UNREAD'>('ALL');
  const [selectedNotification, setSelectedNotification] = useState<UserNotificationResponse | null>(
    null,
  );
  const command = useCommand();

  const query = useQuery({
    queryKey: [...queryKey, 'notifications', offset, filter],
    queryFn: () => client.listNotifications(token, { offset, limit: 20, readStatus: filter }),
    refetchInterval: 30000,
  });

  const handleOpenDetail = (n: UserNotificationResponse) => {
    if (!n.readAt) {
      command.mutate(() => client.readNotification(token, n.id));
    }
    setSelectedNotification(n);
  };

  const selectedTarget = selectedNotification
    ? notificationTarget(selectedNotification, scope.siteId, scope.role)
    : null;

  return (
    <Page title={t('notifications.title')}>
      {/* Top Filter and Actions Section */}
      <View style={notifStyles.headerControls}>
        {/* Filter Segmented Pills */}
        <View style={notifStyles.filterPillBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('notifications.all')}
            style={[notifStyles.filterPill, filter === 'ALL' && notifStyles.filterPillActive]}
            onPress={() => {
              setFilter('ALL');
              setOffset(0);
            }}
          >
            <Text
              style={[
                notifStyles.filterPillText,
                filter === 'ALL' && notifStyles.filterPillTextActive,
              ]}
            >
              {t('notifications.all')}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('notifications.unread')}
            style={[notifStyles.filterPill, filter === 'UNREAD' && notifStyles.filterPillActive]}
            onPress={() => {
              setFilter('UNREAD');
              setOffset(0);
            }}
          >
            <Text
              style={[
                notifStyles.filterPillText,
                filter === 'UNREAD' && notifStyles.filterPillTextActive,
              ]}
            >
              {t('notifications.unread')}
            </Text>
          </Pressable>
        </View>

        {/* Compact Utility Buttons */}
        <View style={notifStyles.actionsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('notifications.markAllRead')}
            disabled={command.isPending}
            style={({ pressed }) => [
              notifStyles.compactUtilBtn,
              (pressed || command.isPending) && { opacity: 0.6 },
            ]}
            onPress={() => command.mutate(() => client.readAllNotifications(token))}
          >
            <IconCheck size={16} color="#059669" />
            <Text style={notifStyles.compactUtilBtnText}>{t('notifications.markAllRead')}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('notifications.clearRead')}
            disabled={command.isPending}
            style={({ pressed }) => [
              notifStyles.compactUtilBtn,
              (pressed || command.isPending) && { opacity: 0.6 },
            ]}
            onPress={() =>
              command.mutate(async () => {
                await client.deleteReadNotifications(token);
                setOffset(0);
              })
            }
          >
            <IconTrash size={16} color="#DC2626" />
            <Text style={notifStyles.compactUtilBtnTextDanger}>{t('notifications.clearRead')}</Text>
          </Pressable>
        </View>
      </View>

      <ErrorNotice error={command.error} />

      <QueryState query={query}>
        {(data) => (
          <View style={notifStyles.listContainer}>
            {!data.items.length && (
              <View style={notifStyles.emptyCard}>
                <View style={notifStyles.emptyIconCircle}>
                  <IconBell size={32} color="#94A3B8" hasUnread={false} />
                </View>
                <Text style={notifStyles.emptyText}>{t('notifications.noNotifications')}</Text>
              </View>
            )}

            {data.items.map((n) => {
              const target = notificationTarget(n, scope.siteId, scope.role);
              const isUnread = !n.readAt;

              return (
                <SwipeableNotificationCard
                  key={n.id}
                  notification={n}
                  isUnread={isUnread}
                  target={target}
                  onPress={() => handleOpenDetail(n)}
                  onDelete={() => command.mutate(() => client.deleteNotification(token, n.id))}
                  onMarkRead={
                    isUnread
                      ? () => command.mutate(() => client.readNotification(token, n.id))
                      : undefined
                  }
                  isPending={command.isPending}
                  t={t}
                />
              );
            })}

            <Pager offset={offset} total={data.total} onChange={setOffset} />
          </View>
        )}
      </QueryState>

      {/* Visual, Intuitive Notification Detail Modal */}
      {selectedNotification && (
        <Modal
          transparent
          animationType="slide"
          visible={!!selectedNotification}
          onRequestClose={() => setSelectedNotification(null)}
        >
          <View style={notifStyles.modalOverlay}>
            <Pressable
              style={notifStyles.modalBackdrop}
              onPress={() => setSelectedNotification(null)}
            />
            <View style={notifStyles.modalSheet}>
              <ScrollView style={{ flexShrink: 1 }}>
                {/* Drag handle */}
                <View style={notifStyles.modalDragHandle} />

                {/* Modal Top Bar */}
                <View style={notifStyles.modalHeaderRow}>
                  {(() => {
                    const cat = getNotificationCategory(selectedNotification.event, t);
                    return (
                      <View style={[notifStyles.categoryBadge, { backgroundColor: cat.bg }]}>
                        {getNotificationIcon(selectedNotification.event)}
                        <Text style={[notifStyles.categoryBadgeText, { color: cat.color }]}>
                          {cat.label}
                        </Text>
                      </View>
                    );
                  })()}

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('common.close')}
                    style={notifStyles.modalCloseBtn}
                    onPress={() => setSelectedNotification(null)}
                  >
                    <Text style={notifStyles.modalCloseText}>✕</Text>
                  </Pressable>
                </View>

                {/* Notification Large Title */}
                <Text style={notifStyles.modalTitle}>
                  {notificationTitle(selectedNotification)}
                </Text>

                {/* Metadata Info Row */}
                <View style={notifStyles.modalMetaBox}>
                  <View style={notifStyles.metaRow}>
                    <Text style={notifStyles.metaIconText}>📍</Text>
                    <Text style={notifStyles.metaValueText}>{selectedNotification.siteName}</Text>
                  </View>
                  <View style={notifStyles.metaRow}>
                    <Text style={notifStyles.metaIconText}>🕒</Text>
                    <Text style={notifStyles.metaValueText}>
                      {t('notifications.receivedAt')}: {displayTime(selectedNotification.createdAt)}
                    </Text>
                  </View>
                </View>

                {/* Detailed Message Box */}
                <View style={notifStyles.messageCard}>
                  <Text style={notifStyles.messageText}>
                    {notificationMessage(selectedNotification)}
                  </Text>
                </View>

                {/* Modal Action Buttons */}
                <View style={notifStyles.modalActionsContainer}>
                  {selectedTarget ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('notifications.viewTarget')}
                      style={({ pressed }) => [
                        notifStyles.primaryTargetBtn,
                        pressed && { opacity: 0.88 },
                      ]}
                      onPress={() => {
                        const tgt = selectedTarget;
                        setSelectedNotification(null);
                        navigate(tgt);
                      }}
                    >
                      <Text style={notifStyles.primaryTargetBtnText}>
                        {t('notifications.viewTarget')}
                      </Text>
                      <IconChevronRight size={18} color="#FFFFFF" />
                    </Pressable>
                  ) : (
                    <Text style={notifStyles.noTargetNotice}>
                      {t('notifications.unmatchedScopeNotice')}
                    </Text>
                  )}

                  <View style={notifStyles.modalSecondaryRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('notifications.deleteNotification')}
                      style={({ pressed }) => [
                        notifStyles.modalDeleteBtn,
                        pressed && { opacity: 0.7 },
                      ]}
                      onPress={() => {
                        const id = selectedNotification.id;
                        setSelectedNotification(null);
                        command.mutate(() => client.deleteNotification(token, id));
                      }}
                    >
                      <IconTrash size={16} color="#DC2626" />
                      <Text style={notifStyles.modalDeleteBtnText}>
                        {t('notifications.deleteNotification')}
                      </Text>
                    </Pressable>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('common.close')}
                      style={({ pressed }) => [
                        notifStyles.modalDismissBtn,
                        pressed && { opacity: 0.7 },
                      ]}
                      onPress={() => setSelectedNotification(null)}
                    >
                      <Text style={notifStyles.modalDismissBtnText}>{t('common.close')}</Text>
                    </Pressable>
                  </View>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </Page>
  );
}

const notifStyles = StyleSheet.create({
  headerControls: {
    gap: 12,
    marginBottom: 8,
  },
  filterPillBar: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  filterPill: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  filterPillActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F1E36',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  filterPillText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#64748B',
  },
  filterPillTextActive: {
    color: '#0F1E36',
    fontWeight: '800',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  compactUtilBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    minHeight: 44,
    minWidth: 150,
    flexBasis: 160,
  },
  compactUtilBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F1E36',
    flexShrink: 1,
    textAlign: 'center',
    lineHeight: 21,
  },
  compactUtilBtnTextDanger: {
    fontSize: 14,
    fontWeight: '700',
    color: '#DC2626',
    flexShrink: 1,
    textAlign: 'center',
    lineHeight: 21,
  },
  listContainer: {
    gap: 12,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 12,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#64748B',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    shadowColor: '#0F1E36',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
    position: 'relative',
  },
  unreadCard: {
    backgroundColor: '#FFFCF9',
    borderColor: '#FED7AA',
  },
  unreadIndicator: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    backgroundColor: '#F66B17',
  },
  cardContent: {
    padding: 16,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#EFF2F6',
    marginTop: 2,
  },
  titleCol: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F66B17',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F1E36',
    flex: 1,
    lineHeight: 23,
  },
  unreadTitle: {
    fontWeight: '800',
    color: '#0F1E36',
  },
  siteText: {
    fontSize: 13.5,
    color: '#64748B',
    fontWeight: '500',
  },
  cardBody: {
    fontSize: 15,
    lineHeight: 22,
    color: '#334155',
  },
  noticeText: {
    fontSize: 13,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F1F5F9',
    gap: 8,
    flexWrap: 'wrap',
  },
  openDetailsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    flexShrink: 1,
  },
  openDetailsText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F66B17',
    flexShrink: 1,
    lineHeight: 21,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  pillActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    minHeight: 34,
  },
  readActionBtn: {
    backgroundColor: '#EDFAF2',
  },
  readActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#065F46',
  },
  swipeContainer: {
    position: 'relative',
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#DC2626',
  },
  swipeBackground: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#DC2626',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingLeft: 18,
    borderRadius: 18,
  },
  swipeDeleteAction: {
    flexDirection: 'row',
    alignItems: 'center',
    height: '100%',
    paddingRight: 24,
  },
  swipeDeleteContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  swipeDeleteText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  swipeForeground: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
  },
  swipeHintText: {
    fontSize: 12.5,
    color: '#94A3B8',
    fontWeight: '500',
    fontStyle: 'italic',
  },

  /* Notification Detail Modal Styles */
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 38 : 24,
    paddingTop: 12,
    maxHeight: '90%',
    gap: 14,
  },
  modalDragHandle: {
    width: 44,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 6,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  categoryBadgeText: {
    fontSize: 13,
    fontWeight: '700',
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
    fontSize: 15,
    fontWeight: '700',
    color: '#64748B',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.3,
    lineHeight: 28,
  },
  modalMetaBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: '#EFF2F6',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaIconText: {
    fontSize: 14,
  },
  metaValueText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    flex: 1,
    minWidth: 0,
    lineHeight: 22,
  },
  messageCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    minHeight: 80,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 25,
    color: '#1E293B',
    fontWeight: '500',
  },
  modalActionsContainer: {
    gap: 10,
    marginTop: 4,
  },
  primaryTargetBtn: {
    backgroundColor: '#F66B17',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#F66B17',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
    minHeight: 50,
  },
  primaryTargetBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'center',
    lineHeight: 22,
  },
  noTargetNotice: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  modalSecondaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modalDeleteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    paddingVertical: 12,
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  modalDeleteBtnText: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'center',
    lineHeight: 21,
  },
  modalDismissBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingVertical: 12,
    minHeight: 46,
  },
  modalDismissBtnText: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'center',
    lineHeight: 21,
  },
});
