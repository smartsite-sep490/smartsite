import { WorkerQrPanel } from './worker-qr-panel';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from './workspace-context';
import {
  Button,
  Card,
  Body,
  Hint,
  ErrorNotice,
  Page,
  Pager,
  QueryState,
  Choice,
} from '../shared/ui';
import { displayTime, useCommand } from '../shared/data';
import type { NavigationTarget } from '../../SmartSiteMobileApp';
import { notificationTarget } from './notification-target';
import { useTranslation } from '../../i18n';
import { notificationTitle, notificationMessage } from '../../i18n/messages';

export function QrScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <Page title={t('qr.title')} onBack={onBack}>
      <WorkerQrPanel />
    </Page>
  );
}
export function NotificationsScreen({
  navigate,
  onBack,
}: {
  navigate: (target: NavigationTarget) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { client, token, scope, queryKey } = useWorkspace();
  const [offset, setOffset] = useState(0),
    [filter, setFilter] = useState<'ALL' | 'UNREAD'>('ALL');
  const command = useCommand();
  const query = useQuery({
    queryKey: [...queryKey, 'notifications', offset, filter],
    queryFn: () => client.listNotifications(token, { offset, limit: 20, readStatus: filter }),
    refetchInterval: 30000,
  });
  return (
    <Page title={t('notifications.title')} onBack={onBack}>
      <Choice
        label={t('notifications.filter')}
        value={filter}
        onChange={(v) => {
          setFilter(v as 'ALL' | 'UNREAD');
          setOffset(0);
        }}
        options={[
          { value: 'ALL', label: t('notifications.all') },
          { value: 'UNREAD', label: t('notifications.unread') },
        ]}
      />
      <ErrorNotice error={command.error} />
      <Button
        secondary
        label={t('notifications.markAllRead')}
        disabled={command.isPending}
        onPress={() => command.mutate(() => client.readAllNotifications(token))}
      />
      <Button
        secondary
        label={t('notifications.clearRead')}
        disabled={command.isPending}
        onPress={() =>
          command.mutate(async () => {
            await client.deleteReadNotifications(token);
            setOffset(0);
          })
        }
      />
      <QueryState query={query}>
        {(data) => (
          <>
            {!data.items.length && <Hint>{t('notifications.noNotifications')}</Hint>}
            {data.items.map((n) => {
              const target = notificationTarget(n, scope.siteId, scope.role);
              return (
                <Card key={n.id}>
                  <Body>
                    {n.readAt ? '' : '● '}
                    {notificationTitle(n)}
                  </Body>
                  <Body>{notificationMessage(n)}</Body>
                  <Hint>
                    {n.siteName} · {displayTime(n.createdAt)}
                  </Hint>
                  {target ? (
                    <Button
                      secondary
                      label={t('notifications.openDetails')}
                      disabled={command.isPending}
                      onPress={() =>
                        command.mutate(async () => {
                          if (!n.readAt) await client.readNotification(token, n.id);
                          navigate(target);
                        })
                      }
                    />
                  ) : (
                    <Hint>{t('notifications.unmatchedScopeNotice')}</Hint>
                  )}
                  {!n.readAt && (
                    <Button
                      secondary
                      label={t('notifications.markRead')}
                      disabled={command.isPending}
                      onPress={() => command.mutate(() => client.readNotification(token, n.id))}
                    />
                  )}
                  <Button
                    secondary
                    label={t('notifications.deleteNotification')}
                    disabled={command.isPending}
                    onPress={() => command.mutate(() => client.deleteNotification(token, n.id))}
                  />
                </Card>
              );
            })}
            <Pager offset={offset} total={data.total} onChange={setOffset} />
          </>
        )}
      </QueryState>
    </Page>
  );
}
