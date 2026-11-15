import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { WorkerResponse } from '@smartsite/api-client';
import { useWorkspace } from '../workspace/workspace-context';
import { allPages, required, useCommand } from '../shared/data';
import { Button, CompactTabs, ErrorNotice, Field, Page, Pager, QueryState } from '../shared/ui';
import { RequestSheet } from '../shared/request-sheet';
import { FormSection } from '../shared/form-section';
import { CreateWorkerModal } from '../../components/modals/CreateWorkerModal';
import { WorkerDocuments } from './worker-documents';
import { WorkerAvatar } from '../../components/common/WorkerAvatar';
import { IconDocument, IconUser, IconChevronRight, IconUsers } from '../../components/common/Icons';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { EmptyState, ListHeading, Metrics } from './contractor-presentation';

export function WorkforceScreen({ initialWorkerId }: { initialWorkerId?: string } = {}) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [requestedWorker, setRequestedWorker] = useState(initialWorkerId ?? '');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<WorkerResponse | null>(null);
  const [creating, setCreating] = useState(false);
  const workers = useQuery({
    queryKey: [...queryKey, 'workers'],
    queryFn: ({ signal }) => allPages((p) => client.listWorkers(token, scope.siteId, p), signal),
  });
  const opened =
    selected ??
    workers.data?.find((w) => w.id === requestedWorker && w.contractorId === scope.contractorId);
  if (opened)
    return (
      <WorkerDetail
        key={opened.id}
        worker={opened}
        initialDocuments={!!requestedWorker}
        onBack={() => {
          setSelected(null);
          setRequestedWorker('');
        }}
      />
    );
  return (
    <Page title={t('workforce.title')}>
      <Text style={styles.subtitle}>
        {scope.contractorName} · {scope.siteName}
      </Text>
      <QueryState query={workers}>
        {(allData) => {
          const people = allData.filter((w) => w.contractorId === scope.contractorId);
          const operational = (w: WorkerResponse) => w.isActive && w.documentStatus === 'ACTIVE';
          const activeCount = people.filter(operational).length;
          const filtered = people.filter((w) => {
            if (
              !`${w.displayName} ${w.externalId}`
                .toLocaleLowerCase()
                .includes(search.trim().toLocaleLowerCase())
            )
              return false;
            return (
              statusFilter === 'ALL' ||
              (statusFilter === 'ACTIVE' ? operational(w) : !operational(w))
            );
          });
          return (
            <>
              <Metrics
                items={[
                  { label: t('profile.totalWorkforce'), value: people.length },
                  { label: t('workforce.statusActive'), value: activeCount },
                  {
                    label: t('contractorHome.needsAction'),
                    value: people.length - activeCount,
                    attention: true,
                  },
                ]}
              />
              <Button label={t('workforce.createAccount')} onPress={() => setCreating(true)} />
              <View style={styles.searchCard}>
                <Field
                  label={t('workforce.searchPlaceholder')}
                  placeholder={t('workforce.searchPlaceholder')}
                  value={search}
                  onChangeText={(value) => {
                    setSearch(value);
                    setOffset(0);
                  }}
                />
                <CompactTabs
                  value={statusFilter}
                  options={[
                    { value: 'ALL', label: t('common.all') },
                    { value: 'ACTIVE', label: t('workforce.statusActive') },
                    { value: 'PENDING', label: t('contractorHome.needsAction') },
                  ]}
                  onChange={(value) => {
                    setStatusFilter(value);
                    setOffset(0);
                  }}
                />
              </View>
              <ListHeading
                title={t('workforce.title')}
                count={t('contractorUi.workerCount', { count: filtered.length })}
              />
              {!filtered.length && (
                <EmptyState
                  icon={<IconUsers size={26} color={colors.primary} />}
                  title={t('workforce.noWorkers')}
                  hint={t('contractorUi.workerEmptyHint')}
                />
              )}
              {filtered.slice(offset, offset + 8).map((worker) => (
                <Pressable
                  key={worker.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('workforce.workerProfile')}: ${worker.displayName}`}
                  onPress={() => setSelected(worker)}
                  style={({ pressed }) => [styles.workerCard, pressed && styles.pressed]}
                >
                  <View style={styles.workerHeading}>
                    <View style={styles.initials}>
                      <Text style={styles.initialsText}>
                        {worker.displayName
                          .split(' ')
                          .map((part) => part[0])
                          .filter(Boolean)
                          .slice(-2)
                          .join('')
                          .toUpperCase() || 'W'}
                      </Text>
                    </View>
                    <View style={styles.copy}>
                      <Text style={styles.workerName}>{worker.displayName}</Text>
                      <Text style={styles.caption}>{worker.externalId}</Text>
                    </View>
                    <IconChevronRight size={18} color={colors.textMuted} />
                  </View>
                  <View style={styles.workerFooter}>
                    <Text style={styles.caption}>
                      {t(worker.userId ? 'workforce.hasAccount' : 'workforce.noAccount')}
                    </Text>
                    <View style={[styles.status, !operational(worker) && styles.attentionStatus]}>
                      <Text
                        style={[styles.statusText, !operational(worker) && styles.attentionText]}
                      >
                        {!worker.isActive
                          ? t('workforce.statusInactive')
                          : worker.documentStatus === 'ACTIVE'
                            ? t('workforce.statusActive')
                            : t(`documents.${worker.documentStatus ?? 'PENDING'}`)}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              ))}
              {filtered.length > 8 && (
                <Pager offset={offset} total={filtered.length} size={8} onChange={setOffset} />
              )}
            </>
          );
        }}
      </QueryState>
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

export function WorkerDetail({
  worker,
  onBack,
  initialDocuments = false,
}: {
  worker: WorkerResponse;
  onBack: () => void;
  initialDocuments?: boolean;
}) {
  const { t } = useTranslation();
  const { scope, client, token } = useWorkspace();
  const [name, setName] = useState(worker.displayName);
  const [active, setActive] = useState(worker.isActive);
  const [documents, setDocuments] = useState(initialDocuments);
  const [editing, setEditing] = useState(false);
  const command = useCommand();
  if (documents)
    return (
      <Page title={t('documents.title')} onBack={() => setDocuments(false)}>
        <WorkerDocuments workerId={worker.id} canUpload />
      </Page>
    );
  return (
    <Page title={t('workforce.workerProfile')} onBack={onBack}>
      <View style={styles.workerCard}>
        <View style={styles.workerHeading}>
          <WorkerAvatar size={54} role="worker" />
          <View style={styles.copy}>
            <Text style={styles.workerName}>{worker.displayName}</Text>
            <Text style={styles.caption}>{worker.externalId}</Text>
          </View>
        </View>
        <View style={styles.workerFooter}>
          <Text style={styles.caption}>
            {t(worker.userId ? 'workforce.hasAccount' : 'workforce.noAccount')}
          </Text>
          <Text style={styles.caption}>
            {t(worker.isActive ? 'workforce.statusActive' : 'workforce.statusInactive')}
          </Text>
        </View>
      </View>
      <Button label={t('workforce.editWorker')} onPress={() => setEditing(true)} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('documents.title')}
        onPress={() => setDocuments(true)}
        style={({ pressed }) => [styles.workerCard, pressed && styles.pressed]}
      >
        <View style={styles.workerHeading}>
          <IconDocument size={24} color={colors.primary} />
          <View style={styles.copy}>
            <Text style={styles.workerName}>{t('documents.title')}</Text>
            <Text style={styles.caption}>{t('profile.safetyCertificatesSubtitle')}</Text>
          </View>
          <IconChevronRight size={18} color={colors.textMuted} />
        </View>
      </Pressable>
      {editing && (
        <RequestSheet
          visible
          onClose={() => setEditing(false)}
          busy={command.isPending}
          variant="form"
          icon={<IconUser size={23} color={colors.primary} />}
          title={t('workforce.editWorker')}
          subtitle={`${worker.externalId} · ${worker.displayName}`}
          footer={
            <View style={styles.form}>
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
            </View>
          }
        >
          <FormSection number="01" title={t('workforce.editWorker')}>
            <Field
              label={t('workforce.fullName')}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              editable={!command.isPending}
            />
            <Text style={styles.caption}>{t('common.status')}</Text>
            <View pointerEvents={command.isPending ? 'none' : 'auto'}>
              <CompactTabs
                value={active ? 'ACTIVE' : 'INACTIVE'}
                options={[
                  { value: 'ACTIVE', label: t('workforce.statusActive') },
                  { value: 'INACTIVE', label: t('workforce.statusInactive') },
                ]}
                onChange={(value) => setActive(value === 'ACTIVE')}
              />
            </View>
          </FormSection>
        </RequestSheet>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: 12, lineHeight: 20, color: colors.textMuted, marginTop: -8 },
  searchCard: { gap: 14 },
  workerCard: {
    padding: 16,
    borderRadius: 18,
    gap: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  workerHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  initials: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: { fontSize: 14, fontWeight: '700', color: colors.primaryHover },
  workerName: { fontSize: 15, lineHeight: 23, fontWeight: '700', color: colors.textPrimary },
  caption: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
  workerFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  status: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.surfaceSubtle,
    maxWidth: '100%',
  },
  statusText: { fontSize: 12, lineHeight: 18, fontWeight: '600', color: colors.textSecondary },
  attentionStatus: { backgroundColor: colors.warningLightBg },
  attentionText: { color: colors.warningText },
  pressed: { opacity: 0.65 },
  form: { gap: 12 },
});
