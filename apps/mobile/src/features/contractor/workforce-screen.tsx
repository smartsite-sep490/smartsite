import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { WorkerResponse } from '@smartsite/api-client';
import { useWorkspace } from '../workspace/workspace-context';
import { allPages, required, useCommand } from '../shared/data';
import {
  Body,
  Button,
  Card,
  ErrorNotice,
  Field,
  Hint,
  Page,
  Pager,
  QueryState,
} from '../shared/ui';
import { CreateWorkerModal } from '../../components/modals/CreateWorkerModal';
import { WorkerDocuments } from './worker-documents';
import { WorkerAvatar } from '../../components/common/WorkerAvatar';
import { IconDocument, IconUser, IconChevronRight } from '../../components/common/Icons';
import { useTranslation } from '../../i18n';

export function WorkforceScreen({ initialWorkerId }: { initialWorkerId?: string } = {}) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [requestedWorker, setRequestedWorker] = useState(initialWorkerId ?? '');
  const [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<WorkerResponse | null>(null),
    [creating, setCreating] = useState(false);

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
              {filtered.slice(offset, offset + 8).map((w, index) => {
                const operational = w.isActive && w.documentStatus === 'ACTIVE';
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
                  <Pressable
                    key={w.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('workforce.workerProfile')}: ${w.displayName}`}
                    onPress={() => setSelected(w)}
                  >
                    <Card>
                      <View style={wfStyles.workerHeaderRow}>
                        <View style={[wfStyles.avatarCircle, { backgroundColor: colorScheme.bg }]}>
                          <Text style={[wfStyles.avatarText, { color: colorScheme.text }]}>
                            {initials}
                          </Text>
                        </View>

                        <View style={wfStyles.workerInfoCol}>
                          <Body>{w.displayName}</Body>
                          <Hint>{w.externalId}</Hint>
                        </View>

                        <View
                          style={[
                            wfStyles.statusPill,
                            { backgroundColor: operational ? '#EDFAF2' : '#F1F5F9' },
                          ]}
                        >
                          <View
                            style={[
                              wfStyles.statusDot,
                              { backgroundColor: operational ? '#10B981' : '#64748B' },
                            ]}
                          />
                          <Text
                            style={[
                              wfStyles.statusText,
                              { color: operational ? '#065F46' : '#64748B' },
                            ]}
                          >
                            {!w.isActive
                              ? t('workforce.statusInactive')
                              : w.documentStatus === 'ACTIVE'
                                ? t('workforce.statusActive')
                                : t(`documents.${w.documentStatus ?? 'PENDING'}`)}
                          </Text>
                        </View>
                      </View>
                    </Card>
                  </Pressable>
                );
              })}
              <Pager offset={offset} total={filtered.length} size={8} onChange={setOffset} />
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
  const [name, setName] = useState(worker.displayName),
    [active, setActive] = useState(worker.isActive);
  const command = useCommand();
  const [documents, setDocuments] = useState(initialDocuments);
  if (documents)
    return (
      <Page title={t('documents.title')} onBack={() => setDocuments(false)}>
        <WorkerDocuments workerId={worker.id} canUpload />
      </Page>
    );

  return (
    <Page title={t('workforce.workerProfile')} onBack={onBack}>
      <View style={wfStyles.detailContainer}>
        {/* 1. Hero Worker Card */}
        <View style={wfStyles.heroCard}>
          <View style={wfStyles.heroAvatarWrapper}>
            <WorkerAvatar size={62} role="worker" />
            <View
              style={[
                wfStyles.heroStatusDotBadge,
                { backgroundColor: active ? '#10B981' : '#94A3B8' },
              ]}
            />
          </View>

          <View style={wfStyles.heroTextCol}>
            <Text style={wfStyles.heroName} numberOfLines={1} ellipsizeMode="tail">
              {name || worker.displayName}
            </Text>

            <View style={wfStyles.heroPillsRow}>
              <View style={wfStyles.codeBadge}>
                <Text style={wfStyles.codeBadgeText}>{worker.externalId}</Text>
              </View>

              <View
                style={[
                  wfStyles.accountBadge,
                  { backgroundColor: worker.userId ? '#EDFAF2' : '#F1F5F9' },
                ]}
              >
                <View
                  style={[
                    wfStyles.accountDot,
                    { backgroundColor: worker.userId ? '#10B981' : '#94A3B8' },
                  ]}
                />
                <Text
                  style={[
                    wfStyles.accountBadgeText,
                    { color: worker.userId ? '#065F46' : '#64748B' },
                  ]}
                >
                  {worker.userId ? t('workforce.hasAccount') : t('workforce.noAccount')}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* 2. Form Card: Thông tin cơ bản */}
        <View style={wfStyles.formCard}>
          <View style={wfStyles.formCardHeader}>
            <View style={wfStyles.formHeaderIconBox}>
              <IconUser size={16} color="#EA580C" />
            </View>
            <Text style={wfStyles.formCardTitle}>{t('workforce.editWorker')}</Text>
          </View>

          <Field
            label={t('workforce.fullName')}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />

          {/* Status selector */}
          <View style={wfStyles.statusFieldGroup}>
            <Text style={wfStyles.statusFieldLabel}>{t('common.status')}</Text>
            <View style={wfStyles.statusToggleRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('workforce.statusActive')}
                onPress={() => setActive(true)}
                style={[wfStyles.statusToggleBtn, active && wfStyles.statusToggleBtnActive]}
              >
                <View
                  style={[
                    wfStyles.statusDotIndicator,
                    { backgroundColor: active ? '#10B981' : '#CBD5E1' },
                  ]}
                />
                <Text
                  style={[wfStyles.statusToggleText, active && wfStyles.statusToggleTextActive]}
                >
                  {t('workforce.statusActive')}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('workforce.statusInactive')}
                onPress={() => setActive(false)}
                style={[wfStyles.statusToggleBtn, !active && wfStyles.statusToggleBtnInactive]}
              >
                <View
                  style={[
                    wfStyles.statusDotIndicator,
                    { backgroundColor: !active ? '#EF4444' : '#CBD5E1' },
                  ]}
                />
                <Text
                  style={[wfStyles.statusToggleText, !active && wfStyles.statusToggleTextInactive]}
                >
                  {t('workforce.statusInactive')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* 3. Quick Action: Hồ sơ giấy tờ & Chứng chỉ */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('documents.title')}
          onPress={() => setDocuments(true)}
          style={({ pressed }) => [
            wfStyles.documentsNavCard,
            pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] },
          ]}
        >
          <View style={wfStyles.docNavIconBox}>
            <IconDocument size={20} color="#EA580C" />
          </View>
          <View style={wfStyles.docNavTextCol}>
            <Text style={wfStyles.docNavTitle}>{t('documents.title')}</Text>
            <Text style={wfStyles.docNavSubtitle}>{t('profile.safetyCertificatesSubtitle')}</Text>
          </View>
          <IconChevronRight size={18} color="#94A3B8" />
        </Pressable>

        <ErrorNotice error={command.error} />

        {/* 4. Action Button */}
        <View style={wfStyles.actionBtnWrapper}>
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
      </View>
    </Page>
  );
}

const wfStyles = StyleSheet.create({
  workerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '800',
  },
  workerInfoCol: {
    flex: 1,
    gap: 2,
    minWidth: 100,
    flexBasis: 120,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    gap: 5,
    maxWidth: '100%',
    flexShrink: 0,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
    lineHeight: 18,
  },
  /* Modern Worker Detail Styles */
  detailContainer: {
    gap: 14,
    paddingBottom: 24,
  },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  heroAvatarWrapper: {
    position: 'relative',
    flexShrink: 0,
  },
  heroStatusDotBadge: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  heroTextCol: {
    flex: 1,
    gap: 6,
    minWidth: 120,
  },
  heroName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  heroPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  codeBadge: {
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFEDD5',
  },
  codeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
    color: '#EA580C',
  },
  accountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  accountDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  accountBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  formCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  formHeaderIconBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  formCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  statusFieldGroup: {
    gap: 8,
  },
  statusFieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  statusToggleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statusToggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  statusToggleBtnActive: {
    backgroundColor: '#EDFAF2',
    borderColor: '#10B981',
  },
  statusToggleBtnInactive: {
    backgroundColor: '#FEF2F2',
    borderColor: '#EF4444',
  },
  statusDotIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  statusToggleTextActive: {
    color: '#065F46',
  },
  statusToggleTextInactive: {
    color: '#991B1B',
  },
  documentsNavCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#FED7AA',
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  docNavIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FFEDD5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  docNavTextCol: {
    flex: 1,
    gap: 2,
  },
  docNavTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  docNavSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
  },
  actionBtnWrapper: {
    marginTop: 4,
  },
});
