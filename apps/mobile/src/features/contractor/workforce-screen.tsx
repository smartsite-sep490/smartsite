import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { WorkerResponse } from '@smartsite/api-client';
import { useWorkspace } from '../workspace/workspace-context';
import { allPages, required, useCommand } from '../shared/data';
import {
  Body,
  Button,
  Card,
  Choice,
  ErrorNotice,
  Field,
  Hint,
  Page,
  Pager,
  QueryState,
} from '../shared/ui';
import { CreateWorkerModal } from '../../components/modals/CreateWorkerModal';
import { useTranslation } from '../../i18n';

export function WorkforceScreen() {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<WorkerResponse | null>(null),
    [creating, setCreating] = useState(false);

  const workers = useQuery({
    queryKey: [...queryKey, 'workers'],
    queryFn: ({ signal }) => allPages((p) => client.listWorkers(token, scope.siteId, p), signal),
  });

  if (selected)
    return <WorkerDetail key={selected.id} worker={selected} onBack={() => setSelected(null)} />;

  const avatarColors = [
    { bg: '#FFF4EE', text: '#F66B17' },
    { bg: '#EDFAF2', text: '#10B981' },
    { bg: '#EFF6FF', text: '#2563EB' },
    { bg: '#FEF3C7', text: '#D97706' },
  ];

  return (
    <Page title={t('workforce.title')}>
      <Field
        label={t('workforce.searchPlaceholder')}
        value={search}
        onChangeText={(v) => {
          setSearch(v);
          setOffset(0);
        }}
      />
      <Button label={t('workforce.createAccount')} onPress={() => setCreating(true)} />

      <QueryState query={workers}>
        {(data) => {
          const filtered = data.filter(
            (w) =>
              w.contractorId === scope.contractorId &&
              `${w.displayName} ${w.externalId}`
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase()),
          );
          return (
            <>
              {!filtered.length && <Hint>{t('workforce.noWorkers')}</Hint>}
              {filtered.slice(offset, offset + 20).map((w, index) => {
                const colorScheme = avatarColors[index % avatarColors.length] ?? {
                  bg: '#FFF4EE',
                  text: '#F66B17',
                };
                const initials =
                  w.displayName
                    .split(' ')
                    .map((p) => p[0])
                    .filter(Boolean)
                    .slice(-2)
                    .join('')
                    .toUpperCase() || 'W';

                return (
                  <Card key={w.id}>
                    <View style={wfStyles.workerHeaderRow}>
                      <View style={[wfStyles.avatarCircle, { backgroundColor: colorScheme.bg }]}>
                        <Text style={[wfStyles.avatarText, { color: colorScheme.text }]}>
                          {initials}
                        </Text>
                      </View>

                      <View style={wfStyles.workerInfoCol}>
                        <Body>{w.displayName}</Body>
                        <Hint>
                          {w.externalId} ·{' '}
                          {w.userId ? t('workforce.hasAccount') : t('workforce.noAccount')}
                        </Hint>
                      </View>

                      <View
                        style={[
                          wfStyles.statusPill,
                          { backgroundColor: w.isActive ? '#EDFAF2' : '#F1F5F9' },
                        ]}
                      >
                        <View
                          style={[
                            wfStyles.statusDot,
                            { backgroundColor: w.isActive ? '#10B981' : '#64748B' },
                          ]}
                        />
                        <Text
                          style={[
                            wfStyles.statusText,
                            { color: w.isActive ? '#065F46' : '#64748B' },
                          ]}
                        >
                          {w.isActive ? t('workforce.statusActive') : t('workforce.statusInactive')}
                        </Text>
                      </View>
                    </View>

                    <Button
                      secondary
                      label={t('workforce.workerProfile')}
                      onPress={() => setSelected(w)}
                    />
                  </Card>
                );
              })}
              <Pager offset={offset} total={filtered.length} onChange={setOffset} />
            </>
          );
        }}
      </QueryState>

      {/* Modal: Thêm công nhân (Chỉ mở khi bấm nút) */}
      <CreateWorkerModal
        visible={creating}
        onClose={() => setCreating(false)}
        onSuccess={() => void workers.refetch()}
      />
    </Page>
  );
}

export function CreateWorker({ onBack }: { onBack: () => void }) {
  return <CreateWorkerModal visible onClose={onBack} onSuccess={onBack} />;
}

export function WorkerDetail({ worker, onBack }: { worker: WorkerResponse; onBack: () => void }) {
  const { t } = useTranslation();
  const { scope, client, token } = useWorkspace();
  const [name, setName] = useState(worker.displayName),
    [active, setActive] = useState(worker.isActive);
  const command = useCommand();
  return (
    <Page title={t('workforce.workerProfile')} onBack={onBack}>
      <Card>
        <Body>{worker.externalId}</Body>
        <Hint>{worker.userId ? t('workforce.hasAccount') : t('workforce.noAccount')}</Hint>
        <Field
          label={t('workforce.fullName')}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
        <Choice
          label={t('common.status')}
          value={active ? 'ACTIVE' : 'INACTIVE'}
          onChange={(v) => setActive(v === 'ACTIVE')}
          options={[
            { value: 'ACTIVE', label: t('workforce.statusActive') },
            { value: 'INACTIVE', label: t('workforce.statusInactive') },
          ]}
        />
        <ErrorNotice error={command.error} />
        <Button
          label={t('common.save')}
          disabled={command.isPending || !name.trim()}
          onPress={() =>
            command.mutate(async () => {
              await client.updateContractorWorker(
                token,
                scope.siteId,
                scope.contractorId,
                worker.id,
                {
                  externalId: worker.externalId,
                  displayName: required(name, t('workforce.fullName')),
                  isActive: active,
                  expectedSnapshot: {
                    externalId: worker.externalId,
                    displayName: worker.displayName,
                    isActive: worker.isActive,
                  },
                },
              );
              onBack();
            })
          }
        />
      </Card>
    </Page>
  );
}

const wfStyles = StyleSheet.create({
  workerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '800',
  },
  workerInfoCol: {
    flex: 1,
    gap: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
