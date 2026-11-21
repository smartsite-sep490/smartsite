import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
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
import {
  IconDocument,
  IconUser,
  IconChevronRight,
  IconUsers,
  IconPlus,
  IconSearch,
  IconPencil,
} from '../../components/common/Icons';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { ManagementBadge } from '../shared/management-ui';
import { EmptyState } from './contractor-presentation';

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
    queryFn: ({ signal }) =>
      allPages((page) => client.listWorkers(token, scope.siteId, page), signal),
  });
  const opened =
    selected ??
    workers.data?.find(
      (worker) => worker.id === requestedWorker && worker.contractorId === scope.contractorId,
    );
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
        {scope.contractorName} {'\u00b7'} {scope.siteName}
      </Text>
      <QueryState query={workers}>
        {(allData) => {
          const people = allData.filter((worker) => worker.contractorId === scope.contractorId);
          const operational = (worker: WorkerResponse) =>
            worker.isActive && worker.documentStatus === 'ACTIVE';
          const activeCount = people.filter(operational).length;
          const filtered = people.filter(
            (worker) =>
              `${worker.displayName} ${worker.externalId}`
                .toLocaleLowerCase()
                .includes(search.trim().toLocaleLowerCase()) &&
              (statusFilter === 'ALL' ||
                (statusFilter === 'ACTIVE' ? operational(worker) : !operational(worker))),
          );
          return (
            <>
              <View style={styles.stats}>
                {[
                  { label: t('profile.totalWorkforce'), value: people.length, attention: false },
                  { label: t('workforce.statusActive'), value: activeCount, attention: false },
                  {
                    label: t('contractorHome.needsAction'),
                    value: people.length - activeCount,
                    attention: true,
                  },
                ].map((item) => (
                  <View key={item.label} style={styles.stat}>
                    <Text
                      style={[
                        styles.statValue,
                        item.attention && item.value > 0 && styles.attentionText,
                      ]}
                    >
                      {item.value}
                    </Text>
                    <Text style={styles.statLabel}>{item.label}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.toolbar}>
                <View style={styles.searchBox}>
                  <IconSearch size={17} color={colors.textMuted} />
                  <TextInput
                    accessibilityLabel={t('workforce.searchPlaceholder')}
                    placeholder={t('workforce.searchPlaceholder')}
                    placeholderTextColor={colors.textTertiary}
                    style={styles.searchInput}
                    value={search}
                    autoCorrect={false}
                    onChangeText={(value) => {
                      setSearch(value);
                      setOffset(0);
                    }}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('workforce.createAccount')}
                  onPress={() => setCreating(true)}
                  style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
                >
                  <IconPlus size={17} color={colors.textWhite} />
                  <Text style={styles.addText}>{t('contractorUi.addWorkerShort')}</Text>
                </Pressable>
              </View>
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
              <Text style={styles.caption}>
                {t('contractorUi.workerCount', { count: filtered.length })}
              </Text>
              {!filtered.length && (
                <EmptyState
                  icon={<IconUsers size={25} color={colors.textMuted} />}
                  title={t('workforce.noWorkers')}
                  hint={t('contractorUi.workerEmptyHint')}
                />
              )}
              {!!filtered.length && (
                <View style={styles.roster}>
                  {filtered.slice(offset, offset + 8).map((worker, index) => (
                    <Pressable
                      key={worker.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${t('workforce.workerProfile')}: ${worker.displayName}`}
                      onPress={() => setSelected(worker)}
                      style={({ pressed }) => [
                        styles.rosterRow,
                        index > 0 && styles.rowDivider,
                        pressed && styles.pressed,
                      ]}
                    >
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
                        <Text numberOfLines={1} style={styles.rosterName}>
                          {worker.displayName}
                        </Text>
                        <Text numberOfLines={1} style={styles.caption}>
                          {worker.externalId} {'\u00b7'}{' '}
                          {t(worker.userId ? 'workforce.hasAccount' : 'workforce.noAccount')}
                        </Text>
                        <View style={styles.rosterStatus}>
                          <ManagementBadge
                            label={
                              !worker.isActive
                                ? t('workforce.statusInactive')
                                : worker.documentStatus === 'ACTIVE'
                                  ? t('workforce.statusActive')
                                  : t(`documents.${worker.documentStatus ?? 'PENDING'}`)
                            }
                            tone={
                              !worker.isActive
                                ? 'neutral'
                                : operational(worker)
                                  ? 'success'
                                  : worker.documentStatus === 'EXPIRED'
                                    ? 'danger'
                                    : 'warning'
                            }
                          />
                        </View>
                      </View>
                      <IconChevronRight size={16} color={colors.textTertiary} />
                    </Pressable>
                  ))}
                </View>
              )}
              {(filtered.length > 8 || offset > 0) && (
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('workforce.editWorker')}
        onPress={() => setEditing(true)}
        style={({ pressed }) => [styles.editAction, pressed && styles.pressed]}
      >
        <IconPencil size={16} color={colors.primary} />
        <Text style={styles.editText}>{t('workforce.editWorker')}</Text>
      </Pressable>
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
  stats: { flexDirection: 'row', gap: 9 },
  stat: {
    flex: 1,
    minWidth: 0,
    padding: 12,
    gap: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  statValue: { color: colors.textPrimary, fontSize: 22, lineHeight: 29, fontWeight: '700' },
  statLabel: { color: colors.textMuted, fontSize: 11, lineHeight: 17 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchBox: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, minWidth: 0, minHeight: 44, color: colors.textPrimary, fontSize: 13 },
  addButton: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  addText: { color: colors.textWhite, fontSize: 13, fontWeight: '600' },
  roster: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  rosterRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  rosterName: { fontSize: 14, lineHeight: 21, fontWeight: '600', color: colors.textPrimary },
  rosterStatus: { alignItems: 'flex-start' },
  editAction: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
  },
  editText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
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
