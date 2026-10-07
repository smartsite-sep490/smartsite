import { useEffect, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ApiError,
  SmartSiteManagementClient,
  type UserNotificationResponse,
} from '@smartsite/api-client';
import { useAuth } from '../auth/auth-session';
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
} from '../../components/icons';
import { notificationHref } from './notification-utils';

export const NOTIFICATION_POLL_MS = 15_000;

function formatNotificationTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (Number.isNaN(diffMs)) return date.toLocaleString('en-GB');

    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
  } catch {
    return isoString;
  }
}

export function NotificationBell({
  apiUrl,
  userId,
  enabled = true,
}: {
  apiUrl: string;
  userId: string;
  enabled?: boolean;
}) {
  const { accessToken, triggerSessionExpired } = useAuth();
  const client = new SmartSiteManagementClient(apiUrl);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [readStatus, setReadStatus] = useState<'ALL' | 'UNREAD'>('ALL');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [targetSingleDelete, setTargetSingleDelete] = useState<UserNotificationResponse | null>(
    null,
  );
  const [deleteMessage, setDeleteMessage] = useState('');
  const hasSession = !!accessToken;
  const key = ['notifications', apiUrl, userId];

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
    if (query.error instanceof ApiError && query.error.status === 401) triggerSessionExpired();
  }, [query.error, triggerSessionExpired]);

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
      navigate(notificationHref(notification));
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
      setDeleteMessage(
        `${result.deleted} read notification${result.deleted === 1 ? '' : 's'} deleted.`,
      );
      await queryClient.resetQueries({ queryKey: key });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) triggerSessionExpired();
    },
  });

  const deleteSingle = useMutation({
    mutationFn: (id: string) => client.deleteNotification(accessToken!, id),
    onSuccess: async () => {
      setTargetSingleDelete(null);
      setDeleteMessage('Notification deleted.');
      await queryClient.resetQueries({ queryKey: key });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) triggerSessionExpired();
    },
  });

  const unavailable = query.isError || !enabled;
  const count = unavailable ? undefined : data?.unreadCount;
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
          setDeleteMessage('');
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={count === undefined ? 'Notifications' : `Notifications, ${count} unread`}
          className="relative flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-600 hover:text-[#071A2B] shadow-2xs transition-all duration-200 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F66B17] cursor-pointer"
        >
          <IconBell className="w-4 h-4 text-slate-600 group-hover:text-[#071A2B]" />
          {count !== undefined && count > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-[#F66B17] text-white font-bold text-[9px] flex items-center justify-center px-1 shadow-[0_2px_6px_rgba(246,107,23,0.4)] border-2 border-white animate-in zoom-in duration-200"
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
          aria-label="Notifications"
          className="z-50 w-[min(440px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 backdrop-blur-2xl shadow-[0_24px_60px_-12px_rgba(7,26,43,0.18)] text-slate-900 animate-in fade-in-0 zoom-in-95 duration-200"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[#071A2B] text-white flex items-center justify-center shadow-2xs">
                <IconBell className="w-3.5 h-3.5 text-[#F66B17]" />
              </div>
              <h2 className="text-xs font-bold tracking-wider text-[#071A2B]">
                Notifications
              </h2>
              {count !== undefined && count > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-100/90 text-amber-800 text-[10px] font-bold border border-amber-200/70">
                  {count} new
                </span>
              )}
            </div>

            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-[#071A2B] hover:bg-slate-200/70 focus-visible:outline-2 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
              disabled={unavailable || !count || actionPending}
              onClick={() => markAll.mutate()}
            >
              <IconCheck className="w-3 h-3 text-[#F66B17]" />
              <span>Mark all as read</span>
            </button>
          </div>

          {/* Segmented Filter Control */}
          <div
            className="px-4 py-2 border-b border-slate-100/80 bg-white"
            aria-label="Notification filter"
          >
            <div className="inline-flex p-0.5 bg-slate-100/90 rounded-xl border border-slate-200/60 text-xs gap-1 w-full sm:w-auto">
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
                    setDeleteMessage('');
                  }}
                  className={`flex-1 sm:flex-initial px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    readStatus === filter
                      ? 'bg-white text-[#071A2B] shadow-2xs'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-white/50'
                  }`}
                >
                  {filter === 'ALL' ? 'All' : 'Unread'}
                </button>
              ))}
            </div>
          </div>

          {readStatus === 'ALL' && (
            <div className="px-4 py-2 border-b border-slate-100">
              <button
                type="button"
                className="text-xs font-semibold text-rose-700 rounded-lg px-2 py-1 hover:bg-rose-50 focus-visible:outline-2 disabled:opacity-40"
                disabled={unavailable || !readCount || actionPending}
                onClick={() => {
                  setConfirmDelete(true);
                  setTargetSingleDelete(null);
                  setDeleteMessage('');
                  deleteRead.reset();
                  deleteSingle.reset();
                }}
              >
                Delete read notifications
              </button>
            </div>
          )}
          {confirmDelete && (
            <div
              role="alertdialog"
              aria-label="Delete read notifications?"
              aria-describedby="delete-read-description"
              className="mx-4 my-2 p-3 rounded-xl border border-rose-200 bg-rose-50 space-y-2 text-xs"
            >
              <p id="delete-read-description">
                Delete all your read notifications? Unread notifications will be kept. This cannot
                be undone from the app.
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
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-lg px-3 py-1.5 bg-rose-700 text-white focus-visible:outline-2 disabled:opacity-40"
                  disabled={actionPending || unavailable}
                  onClick={() => deleteRead.mutate()}
                >
                  {deleteRead.isPending ? 'Deleting...' : 'Confirm deletion'}
                </button>
              </div>
            </div>
          )}
          {targetSingleDelete && (
            <div
              role="alertdialog"
              aria-label="Delete notification?"
              aria-describedby="delete-single-description"
              className="mx-4 my-2 p-3 rounded-xl border border-rose-200 bg-rose-50 space-y-2 text-xs"
            >
              <p id="delete-single-description">
                Delete notification &ldquo;{targetSingleDelete.title}&rdquo;? This cannot be undone
                from the app.
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
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-lg px-3 py-1.5 bg-rose-700 text-white focus-visible:outline-2 disabled:opacity-40"
                  disabled={actionPending || unavailable}
                  onClick={() => deleteSingle.mutate(targetSingleDelete.id)}
                >
                  {deleteSingle.isPending ? 'Deleting...' : 'Confirm deletion'}
                </button>
              </div>
            </div>
          )}
          {deleteRead.isError && (
            <p role="alert" className="mx-4 my-2 text-xs text-rose-700">
              Could not delete read notifications. Please try again.
            </p>
          )}
          {deleteSingle.isError && (
            <p role="alert" className="mx-4 my-2 text-xs text-rose-700">
              Could not delete notification. Please try again.
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
              <span>Could not update this notification. Try again.</span>
            </div>
          )}

          {/* Notification List Scroll Area */}
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-slate-100/80">
            {query.isLoading && (
              <div
                role="status"
                className="p-10 text-center flex flex-col items-center justify-center gap-2.5 text-xs text-slate-400"
              >
                <IconLoader className="w-5 h-5 text-slate-500 animate-spin" />
                <span>Loading notifications…</span>
              </div>
            )}

            {unavailable ? (
              <div role="alert" className="p-8 text-center space-y-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 mx-auto flex items-center justify-center">
                  <IconAlertCircle className="w-5 h-5" />
                </div>
                <p className="text-xs font-medium text-slate-600">
                  {enabled
                    ? 'Notifications are currently unavailable.'
                    : 'Notifications are unavailable for this account.'}
                </p>
                {enabled && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
                    onClick={() => void query.refetch()}
                  >
                    <IconRefreshCw className="w-3 h-3 text-slate-500" />
                    <span>Retry</span>
                  </button>
                )}
              </div>
            ) : (
              data && (
                <>
                  {!data.items.length && (
                    <div className="p-10 text-center space-y-2">
                      <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 text-slate-400 mx-auto flex items-center justify-center">
                        <IconBell className="w-5 h-5" />
                      </div>
                      <p className="text-xs font-semibold text-slate-600">
                        {readStatus === 'UNREAD'
                          ? 'You have no unread notifications.'
                          : 'No notifications yet.'}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {readStatus === 'UNREAD'
                          ? 'All recent notifications have been reviewed.'
                          : 'Updates regarding shifts, swaps, and decisions will appear here.'}
                      </p>
                    </div>
                  )}

                  <ul className="p-2.5 space-y-2">
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
                            className={`relative flex w-full items-start gap-3 p-3 rounded-xl border transition-all duration-200 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#F66B17] cursor-pointer ${
                              isUnread
                                ? 'bg-amber-50/60 border-amber-200/80 hover:bg-amber-50/90 hover:border-amber-300 shadow-2xs'
                                : 'bg-white border-slate-200/70 hover:bg-slate-50 hover:border-slate-300'
                            }`}
                          >
                            {/* Event Icon Badge */}
                            <div
                              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border mt-0.5 ${
                                isApplied
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                                  : isRejected
                                    ? 'bg-rose-50 border-rose-200 text-rose-600'
                                    : isSwap
                                      ? 'bg-amber-50 border-amber-200 text-amber-600'
                                      : 'bg-blue-50 border-blue-200 text-blue-600'
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
                                    <span className="w-2 h-2 rounded-full bg-[#F66B17] shrink-0" aria-label="Unread" />
                                  )}
                                  <span
                                    className={`text-xs font-bold leading-tight line-clamp-1 ${
                                      isUnread ? 'text-[#071A2B]' : 'text-slate-800'
                                    }`}
                                  >
                                    {item.title}
                                  </span>
                                </div>
                                <time
                                  dateTime={item.createdAt}
                                  className="text-[10px] font-medium text-slate-400 shrink-0 font-mono"
                                >
                                  {formatNotificationTime(item.createdAt)}
                                </time>
                              </div>

                              <p className="text-xs leading-relaxed text-slate-600 line-clamp-2">
                                {item.message}
                              </p>

                              {/* Shift details badge strip */}
                              <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[10px] text-slate-500 font-mono">
                                {item.siteName && (
                                  <span className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200/60 px-1.5 py-0.5 rounded text-slate-600">
                                    {item.siteName}
                                  </span>
                                )}
                                {item.workDate && (
                                  <span className="inline-flex items-center gap-1 bg-white border border-slate-200/80 px-1.5 py-0.5 rounded text-slate-700 shadow-2xs">
                                    <IconCalendar className="w-2.5 h-2.5 text-[#F66B17]" />
                                    {item.workDate}
                                  </span>
                                )}
                                {(item.fromShiftName || item.toShiftName) && (
                                  <span className="inline-flex items-center gap-1 bg-white border border-slate-200/80 px-1.5 py-0.5 rounded text-slate-700 shadow-2xs">
                                    <IconClock className="w-2.5 h-2.5 text-blue-600" />
                                    {item.fromShiftName} → {item.toShiftName}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Actions (Delete single notification & Arrow) */}
                            <div className="flex items-center gap-1 self-center pl-1 shrink-0">
                              <button
                                type="button"
                                title="Delete notification"
                                aria-label="Delete notification"
                                disabled={actionPending || confirmDelete || !!targetSingleDelete}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setTargetSingleDelete(item);
                                  setConfirmDelete(false);
                                  setDeleteMessage('');
                                  deleteSingle.reset();
                                  deleteRead.reset();
                                }}
                                className="p-1.5 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all cursor-pointer disabled:opacity-40"
                              >
                                <IconTrash className="w-3.5 h-3.5" />
                              </button>
                              <div className="text-slate-300 group-hover:text-[#F66B17] group-hover:translate-x-0.5 transition-all">
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
                      className="w-full py-3 text-xs font-bold text-slate-700 hover:text-[#071A2B] hover:bg-slate-50 border-t border-slate-100/80 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                      onClick={() => void query.fetchNextPage()}
                    >
                      {query.isFetchingNextPage ? (
                        <>
                          <IconLoader className="w-3.5 h-3.5 text-slate-500 animate-spin" />
                          <span>Loading…</span>
                        </>
                      ) : (
                        <span>Load more</span>
                      )}
                    </button>
                  )}
                </>
              )
            )}
          </div>

          <Popover.Close className="sr-only">Close notifications</Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
