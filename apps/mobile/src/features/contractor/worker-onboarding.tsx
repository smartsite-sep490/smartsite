import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkerOnboardingBatchResult, WorkerOnboardingDraft } from '@smartsite/api-client';
import { IconChevronRight } from '../../components/common/Icons';
import { CreateWorkerModal } from '../../components/modals/CreateWorkerModal';
import { useTranslation } from '../../i18n';
import { localizeMessage } from '../../i18n/messages';
import { colors } from '../../theme/colors';
import { useWorkspace } from '../workspace/workspace-context';
import { Button, ErrorNotice, Hint, Pager, QueryState } from '../shared/ui';

const PAGE_SIZE = 12;
const BATCH_LIMIT = 50;

export function WorkerOnboarding({
  onOpenWorker,
  openAdd = false,
}: {
  onOpenWorker: (workerId: string) => void;
  openAdd?: boolean;
}) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const cache = useQueryClient();
  const { siteId, contractorId } = scope;
  const [editor, setEditor] = useState<WorkerOnboardingDraft | 'new' | null>(
    openAdd ? 'new' : null,
  );
  const [checked, setChecked] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const [results, setResults] = useState<Record<string, WorkerOnboardingBatchResult>>({});
  const drafts = useQuery({
    queryKey: [...queryKey, 'worker-onboarding'],
    queryFn: () => client.listWorkerOnboardingDrafts(token, siteId, contractorId),
  });
  const batch = useMutation({
    mutationFn: ({
      action,
      rows,
    }: {
      action: 'provision' | 'send';
      rows: WorkerOnboardingDraft[];
    }) =>
      action === 'provision'
        ? client.provisionWorkerOnboardingBatch(
            token,
            siteId,
            contractorId,
            rows.map(({ id, version }) => ({ id, version })),
          )
        : client.sendWorkerDocumentsBatch(
            token,
            siteId,
            contractorId,
            rows.flatMap(({ workerId, workerVersion }) =>
              workerId && workerVersion !== null ? [{ id: workerId, version: workerVersion }] : [],
            ),
          ),
    onSuccess: ({ items }, { action, rows }) => {
      const returned: Record<string, WorkerOnboardingBatchResult> = {};
      for (const row of rows) {
        const id = action === 'provision' ? row.id : row.workerId;
        const result = items.find((item) => item.id === id);
        if (result) returned[row.id] = result;
      }
      setResults((previous) => ({ ...previous, ...returned }));
      setChecked((previous) => previous.filter((id) => returned[id]?.status !== 'SUCCEEDED'));
    },
    onSettled: () => cache.invalidateQueries({ queryKey }),
  });
  const rows = drafts.data?.items ?? [];
  const selected = checked.map((id) => rows.find((row) => row.id === id)).filter((row) => !!row);
  const provision = selected.filter((row) => row.canProvision);
  const send = selected.filter((row) => row.canSubmit);
  const toggle = (id: string) =>
    setChecked((previous) =>
      previous.includes(id)
        ? previous.filter((item) => item !== id)
        : previous.length < BATCH_LIMIT
          ? [...previous, id]
          : previous,
    );
  const saved = () => {
    setOffset(0);
    void drafts.refetch();
  };

  return (
    <View style={styles.panel}>
      <Button
        label={t('onboarding.addWorker')}
        onPress={() => setEditor('new')}
        disabled={batch.isPending}
      />
      <Hint>{t('onboarding.hint')}</Hint>
      <QueryState query={drafts}>
        {({ items }) => (
          <>
            {!!items.length && (
              <View style={styles.actions}>
                <Text style={styles.count}>
                  {t('onboarding.selected', { count: selected.length })}
                </Text>
                {checked.length === BATCH_LIMIT && <Hint>{t('onboarding.batchLimit')}</Hint>}
                <Button
                  label={t('onboarding.provision')}
                  disabled={!provision.length || batch.isPending}
                  onPress={() => batch.mutate({ action: 'provision', rows: provision })}
                />
                <Button
                  secondary
                  label={t('onboarding.send')}
                  disabled={!send.length || batch.isPending}
                  onPress={() => batch.mutate({ action: 'send', rows: send })}
                />
                {batch.isPending && <Hint>{t('onboarding.working')}</Hint>}
                <ErrorNotice error={batch.error} />
              </View>
            )}
            {!items.length && <Hint>{t('onboarding.empty')}</Hint>}
            <View>
              {items.slice(offset, offset + PAGE_SIZE).map((row) => {
                const name =
                  row.displayName || row.email || row.username || t('onboarding.untitled');
                const selected = checked.includes(row.id);
                const result = results[row.id];
                const status = row.workerId
                  ? row.canSubmit
                    ? 'readyToSubmit'
                    : row.submissionStatus === 'PENDING_REVIEW'
                      ? 'sentToSafety'
                      : row.missingKinds.length
                        ? 'missingDocuments'
                        : 'accountCreated'
                  : row.canProvision
                    ? 'readyToProvision'
                    : !row.displayName ||
                        !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(row.username) ||
                        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)
                      ? 'missingLogin'
                      : row.safetyCardRequired === null
                        ? 'missingSafetyCardSetting'
                        : 'incomplete';
                return (
                  <View key={row.id} style={styles.row}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityLabel={name}
                      accessibilityState={{
                        checked: selected,
                        disabled: batch.isPending || (!selected && checked.length === BATCH_LIMIT),
                      }}
                      disabled={batch.isPending || (!selected && checked.length === BATCH_LIMIT)}
                      onPress={() => toggle(row.id)}
                      style={styles.checkboxHit}
                    >
                      <View style={[styles.checkbox, selected && styles.checked]}>
                        {selected && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('onboarding.open', { name })}
                      onPress={() => (row.workerId ? onOpenWorker(row.workerId) : setEditor(row))}
                      disabled={batch.isPending}
                      style={styles.rowAction}
                    >
                      <View style={styles.rowContent}>
                        <Text style={styles.name}>{name}</Text>
                        <Text style={styles.meta}>
                          {[row.workerCode, t('onboarding.' + status)].filter(Boolean).join(' · ')}
                        </Text>
                        {!!row.missingKinds.length && (
                          <Text style={styles.meta}>
                            {row.missingKinds
                              .map((kind) =>
                                !row.workerId && row.documents[kind]?.originalName
                                  ? t('onboarding.missingDate', {
                                      document: t('documents.' + kind),
                                    })
                                  : t('documents.' + kind),
                              )
                              .join(' · ')}
                          </Text>
                        )}
                        {result && (
                          <Text
                            style={result.status === 'FAILED' ? styles.error : styles.success}
                            accessibilityLiveRegion="polite"
                          >
                            {result.status === 'FAILED'
                              ? result.error?.message
                                ? localizeMessage(result.error.message)
                                : t('common.unexpectedError')
                              : t('onboarding.rowDone')}
                          </Text>
                        )}
                      </View>
                      <IconChevronRight size={16} color={colors.textMuted} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
            {items.length > PAGE_SIZE && (
              <Pager offset={offset} total={items.length} size={PAGE_SIZE} onChange={setOffset} />
            )}
          </>
        )}
      </QueryState>
      {editor && (
        <CreateWorkerModal
          key={editor === 'new' ? editor : editor.id}
          visible
          draft={editor === 'new' ? undefined : editor}
          onClose={() => setEditor(null)}
          onSuccess={saved}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 12 },
  actions: { gap: 8, padding: 12, borderRadius: 12, backgroundColor: colors.surface },
  count: { fontWeight: '700', color: colors.textPrimary },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderColor: colors.borderLight,
  },
  checkboxHit: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  checkbox: {
    width: 21,
    height: 21,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.textWhite, fontWeight: '700' },
  rowAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingVertical: 9,
    paddingRight: 12,
  },
  rowContent: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontSize: 14, color: colors.textPrimary, fontWeight: '700' },
  meta: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  error: { fontSize: 12, lineHeight: 17, color: colors.dangerText },
  success: { fontSize: 12, lineHeight: 17, color: colors.successText },
});
