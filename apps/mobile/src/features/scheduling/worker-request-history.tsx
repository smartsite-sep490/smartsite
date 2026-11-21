import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type {
  WorkerRequestKind,
  WorkerRequestResponse,
  WorkerRequestsQuery,
} from '@smartsite/api-client';
import { useTranslation } from '../../i18n';
import { formatRequestDate } from './request-date';
import { localizedLabel } from '../../i18n/messages';
import { useWorkspace } from '../workspace/workspace-context';
import { displayTime } from '../shared/data';
import { Button, Hint, Pager, QueryState } from '../shared/ui';
import { ManagementAction, ManagementBadge } from '../shared/management-ui';
import { RequestSheet } from '../shared/request-sheet';
import { WorkerRequestModal } from '../../components/modals/WorkerRequestModal';
import { TimeRequestModal } from '../attendance/time-request-modal';
import { colors } from '../../theme/colors';
import {
  IconCalendar,
  IconChevronRight,
  IconClock,
  IconDocument,
  IconFilter,
  IconPlus,
  IconSwap,
} from '../../components/common/Icons';
import { EmptyState } from '../contractor/contractor-presentation';

type KindFilter = WorkerRequestKind | 'ALL';
type StatusFilter = NonNullable<WorkerRequestsQuery['status']> | 'ALL';
const requestKinds = ['LEAVE', 'OVERTIME', 'CHANGE', 'SWAP', 'CORRECTION'] as const;
const requestStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'CONFLICTED'] as const;

function RequestIcon({ kind }: { kind: WorkerRequestKind }) {
  const Icon =
    kind === 'LEAVE'
      ? IconCalendar
      : kind === 'OVERTIME'
        ? IconClock
        : kind === 'CORRECTION'
          ? IconDocument
          : IconSwap;
  return <Icon size={19} color={colors.primary} />;
}
function requestDate(row: WorkerRequestResponse) {
  return formatRequestDate(row.workDate, row.createdAt);
}

export function WorkerRequestHistory({ initialId }: { initialId?: string }) {
  const { t } = useTranslation();
  const { client, token, scope, queryKey } = useWorkspace();
  const [kind, setKind] = useState<KindFilter>('ALL');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState(initialId);
  const [create, setCreate] = useState<'MENU' | 'LEAVE' | 'CHANGE' | 'SWAP' | 'OVERTIME' | null>(
    null,
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftKind, setDraftKind] = useState<KindFilter>('ALL');
  const [draftStatus, setDraftStatus] = useState<StatusFilter>('ALL');
  const size = 10;
  const query = useQuery({
    queryKey: [...queryKey, 'worker-request-history', kind, status, offset],
    queryFn: () =>
      client.myWorkerRequests(token, scope.siteId, {
        ...(kind === 'ALL' ? {} : { kind }),
        ...(status === 'ALL' ? {} : { status }),
        offset,
        limit: size,
      }),
    refetchInterval: 15000,
  });
  const selected = useQuery({
    queryKey: [...queryKey, 'worker-request-detail', selectedId],
    enabled: !!selectedId,
    queryFn: () =>
      client.myWorkerRequests(token, scope.siteId, { requestId: selectedId, limit: 1 }),
    refetchInterval: 15000,
  });
  const label = (value: WorkerRequestKind) => t(`workerRequests.kind${value}`);
  const shortStatus = (value: string) => {
    const key = (
      {
        PENDING: 'pendingShort',
        PENDING_MANAGER: 'pendingShort',
        PENDING_COWORKER: 'coworkerShort',
        APPROVED: 'approvedShort',
        APPLIED: 'approvedShort',
        REJECTED: 'rejectedShort',
        CANCELLED: 'cancelledShort',
        CONFLICTED: 'conflictedShort',
      } as Record<string, string>
    )[value];
    return key ? t(`workerRequests.${key}`) : localizedLabel(value);
  };
  const badge = (value: string, compact = true) => (
    <ManagementBadge
      label={compact ? shortStatus(value) : localizedLabel(value)}
      tone={
        value === 'APPROVED' || value === 'APPLIED'
          ? 'success'
          : value === 'REJECTED' || value === 'CONFLICTED'
            ? 'danger'
            : value.startsWith('PENDING')
              ? 'warning'
              : 'neutral'
      }
    />
  );
  const filterCount = Number(kind !== 'ALL') + Number(status !== 'ALL');
  const clearFilters = () => {
    setKind('ALL');
    setStatus('ALL');
    setOffset(0);
  };
  return (
    <>
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('workerRequests.filters')}
          onPress={() => {
            setDraftKind(kind);
            setDraftStatus(status);
            setFiltersOpen(true);
          }}
          style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}
        >
          <IconFilter size={18} color={filterCount ? colors.primary : colors.textSecondary} />
          <Text style={[styles.filterText, !!filterCount && styles.accent]}>
            {t('workerRequests.filters')}
          </Text>
          {!!filterCount && <Text style={styles.filterCount}>{filterCount}</Text>}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('workerRequests.newRequest')}
          onPress={() => setCreate('MENU')}
          style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}
        >
          <IconPlus size={17} color={colors.textWhite} />
          <Text style={styles.createText}>{t('workerRequests.newRequest')}</Text>
        </Pressable>
      </View>
      {!!filterCount && (
        <View style={styles.activeFilters}>
          <Text style={styles.filterSummary}>
            {[kind !== 'ALL' ? label(kind) : null, status !== 'ALL' ? shortStatus(status) : null]
              .filter(Boolean)
              .join(' \u00b7 ')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('workerRequests.clearFilters')}
            onPress={clearFilters}
            style={styles.clearButton}
          >
            <Text style={styles.clearText}>{t('workerRequests.clearFilters')}</Text>
          </Pressable>
        </View>
      )}
      <QueryState query={query}>
        {(data) => (
          <>
            {!!data.total && (
              <Text style={styles.count}>{t('workerRequests.total', { count: data.total })}</Text>
            )}
            {!data.items.length && (
              <EmptyState
                icon={<IconDocument size={24} color={colors.textMuted} />}
                title={t(filterCount ? 'workerRequests.noMatches' : 'requests.noRequests')}
                hint={t(filterCount ? 'workerRequests.noMatchesHint' : 'workerRequests.emptyHint')}
              />
            )}
            {!!data.items.length && (
              <View style={styles.list}>
                {data.items.map((row, index) => (
                  <Pressable
                    key={`${row.kind}:${row.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t('requests.viewRequest')}
                    accessibilityHint={`${label(row.kind)}, ${requestDate(row)}, ${localizedLabel(row.status)}`}
                    onPress={() => setSelectedId(row.id)}
                    style={({ pressed }) => [
                      styles.row,
                      index > 0 && styles.rowBorder,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.icon}>
                      <RequestIcon kind={row.kind} />
                    </View>
                    <View style={styles.rowBody}>
                      <Text numberOfLines={1} style={styles.rowTitle}>
                        {label(row.kind)}
                      </Text>
                      <View style={styles.rowMeta}>
                        <Text style={styles.date}>{requestDate(row)}</Text>
                        {badge(row.status)}
                      </View>
                      <Text numberOfLines={1} style={styles.reason}>
                        {row.reason}
                      </Text>
                    </View>
                    <IconChevronRight size={16} color={colors.textTertiary} />
                  </Pressable>
                ))}
              </View>
            )}
            {(data.total > size || offset > 0) && (
              <Pager offset={offset} total={data.total} size={size} onChange={setOffset} />
            )}
          </>
        )}
      </QueryState>
      {filtersOpen && (
        <RequestSheet
          visible
          variant="compact"
          title={t('workerRequests.filters')}
          icon={<IconFilter size={22} color={colors.primary} />}
          onClose={() => setFiltersOpen(false)}
          footer={
            <View style={styles.footer}>
              <Button
                label={t('workerRequests.applyFilters')}
                onPress={() => {
                  setKind(draftKind);
                  setStatus(draftStatus);
                  setOffset(0);
                  setFiltersOpen(false);
                }}
              />
              <Button
                secondary
                label={t('workerRequests.clearFilters')}
                onPress={() => {
                  setDraftKind('ALL');
                  setDraftStatus('ALL');
                }}
              />
            </View>
          }
        >
          <Text style={styles.sectionLabel}>{t('requests.kind')}</Text>
          <View style={styles.options}>
            {(['ALL', ...requestKinds] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityLabel={value === 'ALL' ? t('common.all') : label(value)}
                accessibilityState={{ checked: draftKind === value }}
                onPress={() => setDraftKind(value)}
                style={[styles.option, draftKind === value && styles.selectedOption]}
              >
                <Text style={[styles.optionText, draftKind === value && styles.accent]}>
                  {value === 'ALL' ? t('common.all') : label(value)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.sectionLabel}>{t('workerRequests.status')}</Text>
          <View style={styles.options}>
            {(['ALL', ...requestStatuses] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityLabel={
                  value === 'ALL' ? t('attendanceUi.allStatuses') : shortStatus(value)
                }
                accessibilityState={{ checked: draftStatus === value }}
                onPress={() => setDraftStatus(value)}
                style={[styles.option, draftStatus === value && styles.selectedOption]}
              >
                <Text style={[styles.optionText, draftStatus === value && styles.accent]}>
                  {value === 'ALL' ? t('attendanceUi.allStatuses') : shortStatus(value)}
                </Text>
              </Pressable>
            ))}
          </View>
        </RequestSheet>
      )}
      {!!selectedId && (
        <RequestSheet
          visible
          variant="compact"
          title={t('requests.viewRequest')}
          onClose={() => setSelectedId(undefined)}
          footer={null}
        >
          <QueryState query={selected}>
            {(data) => {
              const row = data.items[0];
              return row ? (
                <>
                  <View style={styles.detailHeading}>
                    <View style={styles.icon}>
                      <RequestIcon kind={row.kind} />
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.detailTitle}>{label(row.kind)}</Text>
                      {badge(row.status, false)}
                    </View>
                  </View>
                  <View style={styles.detailMeta}>
                    {row.workDate && (
                      <View style={styles.metaItem}>
                        <Text style={styles.metaLabel}>{t('workerRequests.workDate')}</Text>
                        <Text style={styles.metaValue}>{requestDate(row)}</Text>
                      </View>
                    )}
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>{t('attendanceUi.submittedOn')}</Text>
                      <Text style={styles.metaValue}>{displayTime(row.createdAt)}</Text>
                    </View>
                  </View>
                  {row.startsAt && row.endsAt && (
                    <Hint>
                      {displayTime(row.startsAt)} – {displayTime(row.endsAt)}
                    </Hint>
                  )}
                  <View style={styles.detailSection}>
                    <Text style={styles.sectionLabel}>{t('requests.reason')}</Text>
                    <Text style={styles.detailText}>{row.reason}</Text>
                  </View>
                  {row.reviewNote && (
                    <View style={styles.review}>
                      <Text style={styles.sectionLabel}>{t('attendanceUi.reviewNote')}</Text>
                      <Text style={styles.detailText}>{row.reviewNote}</Text>
                    </View>
                  )}
                </>
              ) : (
                <Hint>{t('requests.noRequests')}</Hint>
              );
            }}
          </QueryState>
        </RequestSheet>
      )}
      {create === 'MENU' && (
        <RequestSheet
          visible
          variant="compact"
          title={t('workerRequests.newRequest')}
          subtitle={t('workerRequests.chooseType')}
          onClose={() => setCreate(null)}
          footer={null}
        >
          {(['LEAVE', 'OVERTIME', 'CHANGE', 'SWAP'] as const).map((value) => (
            <ManagementAction
              key={value}
              label={label(value)}
              icon={<RequestIcon kind={value} />}
              onPress={() => setCreate(value)}
            />
          ))}
        </RequestSheet>
      )}
      {(create === 'LEAVE' || create === 'CHANGE' || create === 'SWAP') && (
        <WorkerRequestModal
          visible
          initialTab={create === 'LEAVE' ? 'leave' : create === 'CHANGE' ? 'change' : 'swap'}
          onClose={() => setCreate(null)}
        />
      )}
      {create === 'OVERTIME' && (
        <TimeRequestModal visible initialKind="OVERTIME" onClose={() => setCreate(null)} />
      )}
    </>
  );
}
const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  filterButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  filterText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  filterCount: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  createButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  createText: { color: colors.textWhite, fontSize: 13, fontWeight: '700' },
  activeFilters: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  filterSummary: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 19 },
  clearButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  clearText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  count: { color: colors.textMuted, fontSize: 12, fontWeight: '500' },
  list: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, minWidth: 0, gap: 7 },
  rowTitle: { color: colors.textPrimary, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  date: { color: colors.textMuted, fontSize: 11, lineHeight: 18 },
  reason: { color: colors.textSecondary, fontSize: 12, lineHeight: 19 },
  pressed: { opacity: 0.65 },
  accent: { color: colors.primary },
  footer: { gap: 8 },
  sectionLabel: { color: colors.textMuted, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  selectedOption: { borderColor: colors.primaryBorder, backgroundColor: colors.primaryLight },
  optionText: { fontSize: 13, lineHeight: 20, color: colors.textSecondary, fontWeight: '500' },
  detailHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  detailTitle: { color: colors.textPrimary, fontSize: 17, lineHeight: 25, fontWeight: '700' },
  detailMeta: {
    padding: 14,
    gap: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceSubtle,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  metaItem: { flex: 1, minWidth: 120, gap: 5 },
  metaLabel: { color: colors.textMuted, fontSize: 11, lineHeight: 17 },
  metaValue: { color: colors.textPrimary, fontSize: 12, lineHeight: 20, fontWeight: '500' },
  detailSection: { gap: 7 },
  detailText: { color: colors.textPrimary, fontSize: 14, lineHeight: 23 },
  review: {
    gap: 7,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceSubtle,
    borderLeftWidth: 3,
    borderLeftColor: colors.primaryBorder,
  },
});
