import { uiLocale } from '../../i18n';
import { translate as tr } from '../../i18n';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import '../../i18n';
import './notification-center-catalog';
import * as Popover from '@radix-ui/react-popover';
import { useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { type UserNotificationResponse } from '@smartsite/api-client';
import { useManagementClient, useAuth } from '../auth/auth-session';
import { PpeInboxBellPreview } from './PpeInboxBellPreview';
import { usePpeFrameInboxPreview } from './usePpeFrameInboxPreview';
import {
  IconBell,
  IconCheck,
  IconClock,
  IconCalendar,
  IconUsers,
  IconAlertCircle,
  IconArrowRight,
  IconLoader,
  IconRefreshCw,
  IconTrash,
  IconX,
} from '../../components/icons';
import {
  notificationHref,
  formatNotificationDisplayMessage,
  formatNotificationTitle,
} from './notification-utils';

export const NOTIFICATION_POLL_MS = 15_000;

function formatNotificationTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (Number.isNaN(diffMs)) return date.toLocaleString(uiLocale());

    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) return tr('common.just_now');
    if (diffMinutes < 60) return tr('common.valuem_ago', { value1: diffMinutes });
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return tr('common.valueh_ago', { value1: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return tr('common.valued_ago', { value1: diffDays });

    return date.toLocaleDateString(uiLocale(), { day: '2-digit', month: '2-digit' });
  } catch {
    return isoString;
  }
}

export function NotificationBell({
  apiUrl,
  userId,
  enabled = true,
  assignedWork = false,
  showApprovalToast = false,
  ppeInboxSiteIds = [],
}: {
  apiUrl: string;
  userId: string;
  enabled?: boolean;
  assignedWork?: boolean;
  showApprovalToast?: boolean;
  ppeInboxSiteIds?: readonly string[];
}) {
  useTranslation();
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);

  const { accessToken } = useAuth();
  const client = useManagementClient(apiUrl);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [readStatus, setReadStatus] = useState<'ALL' | 'UNREAD'>('ALL');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [targetSingleDelete, setTargetSingleDelete] = useState<UserNotificationResponse | null>(
    null,
  );
  const [deletedCount, setDeletedCount] = useState<number | 'single' | null>(null);
  const [approvalToast, setApprovalToast] = useState<UserNotificationResponse | null>(null);
  const shownApprovalIds = useRef(new Set<string>());
  const deleteMessage =
    deletedCount === null
      ? ''
      : deletedCount === 'single'
        ? tr('common.notification_deleted')
        : tr('counts.deletedNotifications', { count: deletedCount });
  const hasSession = !!accessToken;
  const showPpeInbox = enabled && hasSession && !!userId && ppeInboxSiteIds.length > 0;
  const ppeFrames = usePpeFrameInboxPreview({
    apiUrl,
    token: accessToken,
    userId,
    siteIds: ppeInboxSiteIds,
    enabled: showPpeInbox,
  });
  const key = ['notifications', apiUrl, userId];

  // Active tab: 'camera' (Camera & PPE Alerts) or 'system' (Schedule & System)
  const defaultTab = showPpeInbox ? 'camera' : 'system';
  const [tabSelection, setTabSelection] = useState<{
    available: boolean;
    value: 'camera' | 'system';
  }>({ available: showPpeInbox, value: defaultTab });
  if (tabSelection.available !== showPpeInbox) {
    setTabSelection({ available: showPpeInbox, value: defaultTab });
  }
  const activeTab = tabSelection.available === showPpeInbox ? tabSelection.value : defaultTab;
  const setActiveTab = (value: 'camera' | 'system') =>
    setTabSelection({ available: showPpeInbox, value });

  const query = useInfiniteQuery({
    queryKey: [...key, readStatus],
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      client.listNotifications(
        accessToken!,
        { readStatus, offset: pageParam, limit: 20 },
        { signal, timeoutMs: 10_000 },
      ),
    getNextPageParam: (last, _pages, offset) =>
      offset + last.items.length < last.total ? offset + 20 : undefined,
    enabled: enabled && !!accessToken && !!userId,
    refetchInterval: NOTIFICATION_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    retry: false,
  });

  const data = query.data
    ? {
        unreadCount: query.data.pages[0]?.unreadCount ?? 0,
        items: [
          ...new Map(
            query.data.pages.flatMap((page) => page.items).map((item) => [item.id, item]),
          ).values(),
        ],
      }
    : undefined;

  useEffect(() => {
    if (!showApprovalToast || !enabled || !userId) return;
    const approvals = query.data?.pages[0]?.items.filter(
      (item) =>
        !item.readAt &&
        item.event === 'REQUEST_APPLIED' &&
        'requestType' in item.target &&
        item.target.requestType === 'SWAP',
    );
    if (!approvals?.length) return;
    let newest: UserNotificationResponse | null = null;
    for (const item of approvals) {
      const key = `smartsite:swap-approval:${userId}:${item.id}`;
      if (shownApprovalIds.current.has(key) || window.sessionStorage.getItem(key)) continue;
      shownApprovalIds.current.add(key);
      window.sessionStorage.setItem(key, '1');
      newest ??= item;
    }
    if (newest) setApprovalToast(newest);
  }, [showApprovalToast, enabled, userId, query.data]);

  useEffect(() => {
    if (!approvalToast) return;
    const timeout = window.setTimeout(() => setApprovalToast(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [approvalToast]);

  useEffect(
    () => () => {
      void queryClient.cancelQueries({ queryKey: ['notifications', apiUrl, userId] });
      queryClient.removeQueries({ queryKey: ['notifications', apiUrl, userId] });
    },
    [apiUrl, userId, queryClient, hasSession],
  );

  const markRead = useMutation({
    mutationFn: (notification: UserNotificationResponse) =>
      client.readNotification(accessToken!, notification.id),
    onSuccess: (_result, notification) => {
      void queryClient.invalidateQueries({ queryKey: key });
      setOpen(false);
      navigate(notificationHref(notification, assignedWork));
    },
  });

  const markAll = useMutation({
    mutationFn: () => client.readAllNotifications(accessToken!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const deleteRead = useMutation({
    mutationFn: () => client.deleteReadNotifications(accessToken!),
    onSuccess: async (result) => {
      setConfirmDelete(false);
      setDeletedCount(result.deleted);
      await queryClient.resetQueries({ queryKey: key });
    },
  });

  const deleteSingle = useMutation({
    mutationFn: (id: string) => client.deleteNotification(accessToken!, id),
    onSuccess: async () => {
      setTargetSingleDelete(null);
      setDeletedCount('single');
      await queryClient.resetQueries({ queryKey: key });
    },
  });

  const unavailable = query.isError || !enabled;
  const legacyCount = unavailable ? undefined : data?.unreadCount;
  const count =
    legacyCount === undefined || (showPpeInbox && !ppeFrames.isSuccess)
      ? undefined
      : legacyCount + (showPpeInbox ? (ppeFrames.data?.unreadCount ?? 0) : 0);
  const actionError = markRead.isError || markAll.isError;
  const actionPending =
    markRead.isPending || markAll.isPending || deleteRead.isPending || deleteSingle.isPending;
  const firstPage = query.data?.pages[0];
  const readCount =
    readStatus === 'ALL' && firstPage ? Math.max(0, firstPage.total - firstPage.unreadCount) : 0;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        markRead.reset();
        markAll.reset();
        if (!deleteRead.isPending) {
          deleteRead.reset();
          setConfirmDelete(false);
        }
        if (!deleteSingle.isPending) {
          deleteSingle.reset();
          setTargetSingleDelete(null);
        }
        if (!deleteRead.isPending && !deleteSingle.isPending) {
          setDeletedCount(null);
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={
            count === undefined
              ? tr('common.notifications')
              : tr('common.notifications_value_unread', { value1: count })
          }
          className="relative flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 hover:text-slate-950 shadow-2xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 cursor-pointer"
        >
          <IconBell className="w-4 h-4 text-slate-700 group-hover:text-slate-950" />
          {count !== undefined && count > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 rounded-full bg-[#B94708] text-white font-semibold text-xs tabular-nums flex items-center justify-center px-1.5 border-2 border-white"
              aria-hidden="true"
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
          {unavailable && (
            <span
              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-500 border-2 border-white"
              aria-hidden="true"
            />
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={10}
          align="end"
          role="dialog"
          aria-label={tr('common.notifications')}
          className="z-50 w-[min(460px,calc(100vw-24px))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg text-slate-900"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 bg-slate-50/80 px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <IconBell className="w-4 h-4 text-slate-700 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-950 truncate">
                {tr('common.notifications')}
              </h2>
              {count !== undefined && count > 0 && (
                <span className="text-xs font-semibold tabular-nums text-slate-600 shrink-0">
                  · {tr('common.value_new', { value1: count })}
                </span>
              )}
            </div>

            <button
              type="button"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:text-slate-950 hover:bg-slate-200/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer shrink-0"
              disabled={unavailable || !legacyCount || actionPending}
              onClick={() => markAll.mutate()}
            >
              <IconCheck className="w-4 h-4 text-slate-600" />
              <span>
                {tr(
                  showPpeInbox
                    ? 'notification_bell.mark_other_as_read'
                    : 'notification_bell.mark_all_as_read',
                )}
              </span>
            </button>
          </div>

          {/* Tab Selector — only when PPE inbox is active */}
          {showPpeInbox && (
            <div className="px-4 py-2 border-b border-slate-200/80 bg-white">
              <div className="inline-flex p-0.5 bg-slate-100 rounded-lg border border-slate-200/80 text-sm gap-0.5 w-full">
                <button
                  type="button"
                  aria-pressed={activeTab === 'camera'}
                  onClick={() => setActiveTab('camera')}
                  className={`flex-1 inline-flex min-h-9 items-center justify-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 cursor-pointer ${
                    activeTab === 'camera'
                      ? 'bg-white font-semibold text-slate-950 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  <span>{tSafety('notificationCenter.cameraAlerts')}</span>
                  {showPpeInbox &&
                    ppeFrames.isSuccess &&
                    (ppeFrames.data?.unreadCount ?? 0) > 0 && (
                      <span className="ml-1.5 text-xs font-semibold text-amber-800 tabular-nums">
                        ({ppeFrames.data?.unreadCount ?? 0})
                      </span>
                    )}
                </button>
                <button
                  type="button"
                  aria-pressed={activeTab === 'system'}
                  onClick={() => setActiveTab('system')}
                  className={`flex-1 inline-flex min-h-9 items-center justify-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 cursor-pointer ${
                    activeTab === 'system'
                      ? 'bg-white font-semibold text-slate-950 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  <span>{tSafety('notificationCenter.scheduleSystem')}</span>
                  {legacyCount !== undefined && legacyCount > 0 && (
                    <span className="ml-1.5 text-xs font-semibold text-slate-600 tabular-nums">
                      ({legacyCount})
                    </span>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Camera & PPE Alerts Tab Content */}
          {showPpeInbox && activeTab === 'camera' && accessToken && open && (
            <>
              <div className="max-h-[55vh] overflow-y-auto">
                <PpeInboxBellPreview
                  query={ppeFrames}
                  siteIds={ppeInboxSiteIds}
                  onNavigate={() => setOpen(false)}
                />
              </div>
              {!unavailable && data && !data.items.length && (
                <div className="flex items-center justify-between gap-2 bg-slate-50/80 px-4 py-2.5 text-sm text-slate-600">
                  <span>{tr('notification_bell.no_other_notifications_yet')}</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('system')}
                    className="font-semibold text-slate-800 underline decoration-slate-300 underline-offset-2 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 rounded cursor-pointer"
                  >
                    {tSafety('notificationCenter.scheduleSystem')}
                  </button>
                </div>
              )}
            </>
          )}

          {/* Schedule & System Tab Content */}
          {(!showPpeInbox || activeTab === 'system') && (
            <>
              {/* Segmented Filter Control */}
              <div
                className="px-4 py-2 border-b border-slate-100/80 bg-white"
                aria-label={tr('common.notification_filter')}
              >
                <div className="inline-flex p-0.5 bg-slate-100 rounded-lg border border-slate-200/80 text-sm gap-1 w-full sm:w-auto">
                  {(['ALL', 'UNREAD'] as const).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      aria-pressed={readStatus === filter}
                      disabled={actionPending}
                      onClick={() => {
                        setReadStatus(filter);
                        setConfirmDelete(false);
                        setTargetSingleDelete(null);
                        deleteRead.reset();
                        deleteSingle.reset();
                        setDeletedCount(null);
                      }}
                      className={`flex-1 sm:flex-initial px-3 py-1 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                        readStatus === filter
                          ? 'bg-white font-semibold text-slate-950 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-950'
                      }`}
                    >
                      {filter === 'ALL' ? tr('common.all') : tr('common.unread')}
                    </button>
                  ))}
                </div>
              </div>

              {readStatus === 'ALL' && (
                <div className="px-4 py-2 border-b border-slate-100">
                  <button
                    type="button"
                    className="text-sm font-medium text-rose-700 rounded-lg px-2 py-1 hover:bg-rose-50 focus-visible:outline-2 disabled:opacity-40 cursor-pointer"
                    disabled={unavailable || !readCount || actionPending}
                    onClick={() => {
                      setConfirmDelete(true);
                      setTargetSingleDelete(null);
                      setDeletedCount(null);
                      deleteRead.reset();
                      deleteSingle.reset();
                    }}
                  >
                    {tr('common.delete_read_notifications')}
                  </button>
                </div>
              )}
              {confirmDelete && (
                <div
                  role="alertdialog"
                  aria-label={tr('common.delete_read_notifications_16bed9')}
                  aria-describedby="delete-read-description"
                  className="mx-4 my-2 p-3 rounded-xl border border-rose-200 bg-rose-50 space-y-2 text-xs"
                >
                  <p id="delete-read-description">
                    {tr(
                      'notification_bell.delete_all_your_read_notifications_unread_notifications_will_be_kept_this_cannot_b',
                    )}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-lg px-3 py-1.5 border border-slate-200 focus-visible:outline-2 disabled:opacity-40"
                      disabled={deleteRead.isPending}
                      onClick={() => {
                        setConfirmDelete(false);
                        deleteRead.reset();
                      }}
                    >
                      {tr('common.cancel')}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg px-3 py-1.5 bg-rose-700 text-white focus-visible:outline-2 disabled:opacity-40"
                      disabled={actionPending || unavailable}
                      onClick={() => deleteRead.mutate()}
                    >
                      {deleteRead.isPending ? tr('common.deleting') : tr('common.confirm_deletion')}
                    </button>
                  </div>
                </div>
              )}
              {targetSingleDelete && (
                <div
                  role="alertdialog"
                  aria-label={tr('common.delete_notification')}
                  aria-describedby="delete-single-description"
                  className="mx-4 my-2 p-3 rounded-xl border border-rose-200 bg-rose-50 space-y-2 text-xs"
                >
                  <p id="delete-single-description">
                    {tr(
                      'notification_bell.delete_notification_ldquo_value_rdquo_this_cannot_be_undone_from_the_app',
                      { value1: formatNotificationTitle(targetSingleDelete) },
                    )}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-lg px-3 py-1.5 border border-slate-200 focus-visible:outline-2 disabled:opacity-40"
                      disabled={deleteSingle.isPending}
                      onClick={() => {
                        setTargetSingleDelete(null);
                        deleteSingle.reset();
                      }}
                    >
                      {tr('common.cancel')}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg px-3 py-1.5 bg-rose-700 text-white focus-visible:outline-2 disabled:opacity-40"
                      disabled={actionPending || unavailable}
                      onClick={() => deleteSingle.mutate(targetSingleDelete.id)}
                    >
                      {deleteSingle.isPending
                        ? tr('common.deleting')
                        : tr('common.confirm_deletion')}
                    </button>
                  </div>
                </div>
              )}
              {deleteRead.isError && (
                <p role="alert" className="mx-4 my-2 text-xs text-rose-700">
                  {tr('notification_bell.could_not_delete_read_notifications_please_try_again')}
                </p>
              )}
              {deleteSingle.isError && (
                <p role="alert" className="mx-4 my-2 text-xs text-rose-700">
                  {tr('notification_bell.could_not_delete_notification_please_try_again')}
                </p>
              )}
              {deleteMessage && (
                <p role="status" className="mx-4 my-2 text-xs text-slate-600">
                  {deleteMessage}
                </p>
              )}

              {/* Action Error Banner */}
              {actionError && (
                <div
                  role="alert"
                  className="mx-4 mt-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-xs text-rose-700 font-medium"
                >
                  <IconAlertCircle className="w-4 h-4 shrink-0" />
                  <span>
                    {tr('notification_bell.could_not_update_this_notification_try_again')}
                  </span>
                </div>
              )}

              {/* Notification List Scroll Area */}
              <div className="max-h-[60vh] overflow-y-auto divide-y divide-slate-100/80">
                {query.isLoading && (
                  <div
                    role="status"
                    className="p-10 text-center flex flex-col items-center justify-center gap-2.5 text-xs text-slate-600"
                  >
                    <IconLoader className="w-5 h-5 text-slate-500 animate-spin" />
                    <span>{tr('common.loading_notifications')}</span>
                  </div>
                )}

                {unavailable ? (
                  <div role="alert" className="p-8 text-center space-y-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 mx-auto flex items-center justify-center">
                      <IconAlertCircle className="w-5 h-5" />
                    </div>
                    <p className="text-xs font-medium text-slate-600">
                      {enabled
                        ? tr('notification_bell.notifications_are_currently_unavailable')
                        : tr('notification_bell.notifications_are_unavailable_for_this_account')}
                    </p>
                    {enabled && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
                        onClick={() => void query.refetch()}
                      >
                        <IconRefreshCw className="w-3 h-3 text-slate-500" />
                        <span>{tr('common.retry')}</span>
                      </button>
                    )}
                  </div>
                ) : (
                  data && (
                    <>
                      {!data.items.length && (
                        <div className="p-10 text-center space-y-2">
                          <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-500 mx-auto flex items-center justify-center">
                            <IconBell className="w-5 h-5" />
                          </div>
                          <p className="text-xs font-semibold text-slate-600">
                            {readStatus === 'UNREAD'
                              ? tr(
                                  showPpeInbox
                                    ? 'notification_bell.no_other_unread_notifications'
                                    : 'notification_bell.you_have_no_unread_notifications',
                                )
                              : tr(
                                  showPpeInbox
                                    ? 'notification_bell.no_other_notifications_yet'
                                    : 'common.no_notifications_yet',
                                )}
                          </p>
                          {!showPpeInbox && (
                            <p className="text-xs text-slate-600">
                              {readStatus === 'UNREAD'
                                ? tr(
                                    'notification_bell.all_recent_notifications_have_been_reviewed',
                                  )
                                : tr(
                                    'notification_bell.updates_regarding_shifts_swaps_and_decisions_will_appear_here',
                                  )}
                            </p>
                          )}
                        </div>
                      )}

                      <ul className="divide-y divide-slate-100">
                        {data.items.map((item) => {
                          const isUnread = !item.readAt;
                          const isApplied = item.event === 'REQUEST_APPLIED';
                          const isRejected =
                            item.event === 'REQUEST_REJECTED' || item.event === 'SWAP_DECLINED';
                          const isSwap =
                            item.event === 'SWAP_REQUESTED' || item.event === 'SWAP_CONFIRMED';

                          return (
                            <li key={item.id} className="relative group">
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => markRead.mutate(item)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    markRead.mutate(item);
                                  }
                                }}
                                className={`relative flex w-full items-start gap-3 border-l-[3px] px-4 py-3 transition-colors focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-teal-800 cursor-pointer ${
                                  isUnread
                                    ? 'border-l-teal-700 bg-teal-50/20 hover:bg-teal-50/40'
                                    : 'border-l-transparent bg-white hover:bg-slate-50'
                                }`}
                              >
                                {/* Event Icon Badge */}
                                <div
                                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border mt-0.5 ${
                                    isApplied
                                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                      : isRejected
                                        ? 'bg-rose-50 border-rose-200 text-rose-700'
                                        : isSwap
                                          ? 'bg-amber-50 border-amber-200 text-amber-800'
                                          : 'bg-slate-100 border-slate-200 text-slate-700'
                                  }`}
                                >
                                  {isApplied ? (
                                    <IconCheck className="w-4 h-4" />
                                  ) : isRejected ? (
                                    <IconAlertCircle className="w-4 h-4" />
                                  ) : isSwap ? (
                                    <IconUsers className="w-4 h-4" />
                                  ) : (
                                    <IconClock className="w-4 h-4" />
                                  )}
                                </div>

                                {/* Main Content */}
                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      {isUnread && (
                                        <span
                                          className="w-2 h-2 rounded-full bg-teal-700 shrink-0"
                                          aria-label={tr('common.unread')}
                                        />
                                      )}
                                      <span
                                        className={`text-sm leading-snug break-words ${
                                          isUnread
                                            ? 'font-semibold text-slate-950'
                                            : 'font-medium text-slate-800'
                                        }`}
                                      >
                                        {formatNotificationTitle(item)}
                                      </span>
                                    </div>
                                    <time
                                      dateTime={item.createdAt}
                                      className="text-xs font-medium text-slate-600 shrink-0 tabular-nums"
                                    >
                                      {formatNotificationTime(item.createdAt)}
                                    </time>
                                  </div>

                                  <p
                                    className="text-sm leading-relaxed text-slate-700 break-words whitespace-pre-line"
                                    title={formatNotificationDisplayMessage(item)}
                                  >
                                    {formatNotificationDisplayMessage(item)}
                                  </p>

                                  {/* Compact metadata strip */}
                                  {(item.siteName || item.workDate || item.fromShiftName || item.toShiftName) && (
                                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-0.5 text-xs text-slate-600 tabular-nums">
                                      {item.siteName && <span>{item.siteName}</span>}
                                      {item.workDate && (
                                        <span className="inline-flex items-center gap-1">
                                          <IconCalendar className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                                          {item.workDate}
                                        </span>
                                      )}
                                      {(item.fromShiftName || item.toShiftName) && (
                                        <span className="inline-flex items-center gap-1">
                                          <IconClock className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                                          {item.fromShiftName} → {item.toShiftName}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Actions (Delete single notification & Arrow) */}
                                <div className="flex items-center gap-1 self-center pl-1 shrink-0">
                                  <button
                                    type="button"
                                    title={tr('common.delete_notification_511c88')}
                                    aria-label={tr('common.delete_notification_511c88')}
                                    disabled={
                                      actionPending || confirmDelete || !!targetSingleDelete
                                    }
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setTargetSingleDelete(item);
                                      setConfirmDelete(false);
                                      setDeletedCount(null);
                                      deleteSingle.reset();
                                      deleteRead.reset();
                                    }}
                                    className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-50 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 transition-colors cursor-pointer disabled:opacity-40"
                                  >
                                    <IconTrash className="w-4 h-4" />
                                  </button>
                                  <div className="text-slate-500 group-hover:text-slate-800 group-hover:translate-x-0.5 transition-all">
                                    <IconArrowRight className="w-3.5 h-3.5" />
                                  </div>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>

                      {query.hasNextPage && (
                        <button
                          type="button"
                          disabled={query.isFetchingNextPage}
                          className="w-full py-3 text-sm font-semibold text-slate-700 hover:text-slate-950 hover:bg-slate-50 border-t border-slate-100/80 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                          onClick={() => void query.fetchNextPage()}
                        >
                          {query.isFetchingNextPage ? (
                            <>
                              <IconLoader className="w-3.5 h-3.5 text-slate-500 animate-spin" />
                              <span>{tr('common.loading')}</span>
                            </>
                          ) : (
                            <span>{tr('common.load_more')}</span>
                          )}
                        </button>
                      )}
                    </>
                  )
                )}
              </div>
            </>
          )}

          <Popover.Close className="sr-only">{tr('common.close_notifications')}</Popover.Close>
        </Popover.Content>
      </Popover.Portal>
      {approvalToast && (
        <div
          role="status"
          aria-label={tr('common.shift_swap_approved')}
          className="fixed top-5 right-5 z-50 pointer-events-auto max-w-sm sm:max-w-md w-[calc(100vw-2.5rem)] animate-in slide-in-from-top-4 fade-in duration-300"
        >
          <div className="relative overflow-hidden rounded-2xl bg-[#071A2B]/95 backdrop-blur-xl border border-white/15 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.35),0_0_0_1px_rgba(16,185,129,0.25)] text-white">
            <div className="flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-sm">
                <IconCheck className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                    {tr('common.shift_swap_approved')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setApprovalToast(null)}
                    className="text-slate-300 hover:text-white rounded-lg p-1 transition-colors cursor-pointer"
                    aria-label={tr('common.dismiss_notification')}
                  >
                    <IconX className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-xs font-semibold text-slate-100 leading-snug">
                  {formatNotificationDisplayMessage(approvalToast)}
                </p>
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-400" />
          </div>
        </div>
      )}
    </Popover.Root>
  );
}
