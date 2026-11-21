import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import { IconChevronRight, IconMapPin, IconShield, IconUser } from '../../components/common/Icons';
import { localizedLabel } from '../../i18n/messages';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { useWorkspace } from '../workspace/workspace-context';
import { useCommand } from '../shared/data';
import { Button, ErrorNotice, Field, Hint } from '../shared/ui';
import {
  ManagementBadge,
  ManagementLink,
  ManagementPeriod,
  ManagementSection,
  ManagementTabs,
} from '../shared/management-ui';
import { RequestSheet } from '../shared/request-sheet';
import { EmptyState } from '../contractor/contractor-presentation';

type Setup = Awaited<ReturnType<SmartSiteManagementClient['accessSetup']>>;
type MyTeam = Awaited<ReturnType<SmartSiteManagementClient['myContractorTeam']>>;
export type AccessFormContext = { assignmentId?: string; permissionId?: string };
type Selection = { kind: 'ZONE' | 'ASSIGNMENT' | 'PERMISSION' | 'REVOKE'; id: string };

export function WorkerZoneOverview({ data }: { data: MyTeam }) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data.zones?.find((zone) => zone.id === selectedId);
  const badge = (zone: NonNullable<MyTeam['zones']>[number]) => (
    <ManagementBadge
      label={t(
        zone.revokedAt
          ? 'access.revoked'
          : zone.effective
            ? 'access.effective'
            : 'access.notEffective',
      )}
      tone={!zone.revokedAt && zone.effective ? 'success' : 'neutral'}
    />
  );
  return (
    <>
      <View style={styles.card}>
        <Text style={styles.hint}>{t('areaUi.yourTeam')}</Text>
        <Text style={styles.detailName}>{data.teamName ?? t('workerHome.noTeam')}</Text>
        <Text style={styles.hint}>{t('areaUi.workerHint')}</Text>
      </View>
      <ManagementSection title={t('access.assignedZones')}>
        {!data.zones?.length && (
          <EmptyState
            icon={<IconMapPin size={27} color={colors.textMuted} />}
            title={t('access.noZones')}
          />
        )}
        {data.zones?.map((zone) => (
          <Pressable
            key={zone.id}
            accessibilityRole="button"
            accessibilityLabel={t('areaUi.openZone', { name: zone.name })}
            onPress={() => setSelectedId(zone.id)}
            style={styles.card}
          >
            <View style={styles.heading}>
              <View style={styles.icon}>
                <IconMapPin size={21} color={colors.primary} />
              </View>
              <Text style={styles.name}>{zone.name}</Text>
              <IconChevronRight size={17} color={colors.textTertiary} />
            </View>
            {badge(zone)}
            <ManagementPeriod from={zone.validFrom} to={zone.validUntil} />
          </Pressable>
        ))}
      </ManagementSection>
      {selected && (
        <RequestSheet
          visible
          variant="compact"
          title={selected.name}
          subtitle={data.teamName ?? undefined}
          onClose={() => setSelectedId(null)}
          footer={null}
        >
          {badge(selected)}
          <ManagementPeriod from={selected.validFrom} to={selected.validUntil} />
          <Hint>{t('access.authorizationHint')}</Hint>
        </RequestSheet>
      )}
    </>
  );
}

export function AccessOverview({
  data,
  tab,
  onTab,
  onRequest,
  unavailable,
}: {
  data: Setup;
  tab: string;
  onTab: (value: string) => void;
  onRequest: (kind: 'ASSIGN' | 'GRANT', context?: AccessFormContext) => void;
  unavailable: boolean;
}) {
  const { t } = useTranslation();
  const { client, token, scope } = useWorkspace();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [search, setSearch] = useState('');
  const [showRevoked, setShowRevoked] = useState(false);
  const [limit, setLimit] = useState(20);
  const [notice, setNotice] = useState('');
  const [referenceTime, setReferenceTime] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setReferenceTime(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const command = useCommand();
  const permissions = data.contractorPermissions.filter((permission) => !permission.revokedAt);
  const assignments = data.assignments;
  const workerPermissions = data.workerPermissions.filter(
    (permission) => showRevoked || !permission.revokedAt,
  );
  const matches = (value: string) =>
    value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const zoneName = (id: string) =>
    data.zones.find((zone) => zone.id === id)?.name ?? t('common.zone');
  const assignedWorker = (id: string) => assignments.find((assignment) => assignment.id === id);
  const workerZone = (id: string) =>
    data.contractorPermissions.find((permission) => permission.id === id);
  const zone =
    selected?.kind === 'ZONE'
      ? permissions.find((permission) => permission.id === selected.id)
      : undefined;
  const assignment = selected?.kind === 'ASSIGNMENT' ? assignedWorker(selected.id) : undefined;
  const workerPermission =
    selected && ['PERMISSION', 'REVOKE'].includes(selected.kind)
      ? data.workerPermissions.find((permission) => permission.id === selected.id)
      : undefined;
  const grant = (context?: AccessFormContext) => {
    setSelected(null);
    onRequest('GRANT', context);
  };
  const approved = assignments.filter(
    (item) =>
      item.status === 'APPROVED' && item.validUntil && Date.parse(item.validUntil) > referenceTime,
  );
  const zonesVisible = permissions.filter((permission) => matches(zoneName(permission.zoneId)));
  const assignmentsVisible = assignments.filter((item) => matches(item.workerName));
  const workerVisible = workerPermissions.filter((permission) =>
    matches(assignedWorker(permission.workerAssignmentId)?.workerName ?? ''),
  );
  const count =
    tab === 'ZONES'
      ? permissions.length
      : tab === 'ASSIGNMENTS'
        ? assignments.length
        : workerPermissions.length;
  const active = (item: {
    validFrom: string;
    validUntil: string | null;
    revokedAt?: string | null;
  }) =>
    !item.revokedAt &&
    Date.parse(item.validFrom) <= referenceTime &&
    (!item.validUntil || Date.parse(item.validUntil) > referenceTime);
  const workerEffective = (item: Setup['workerPermissions'][number]) => {
    const parent = workerZone(item.contractorZonePermissionId),
      assignment = assignedWorker(item.workerAssignmentId);
    return (
      active(item) &&
      !!parent &&
      active(parent) &&
      !!assignment &&
      assignment.status === 'APPROVED' &&
      active(assignment) &&
      assignment.siteContractorId === parent.siteContractorId
    );
  };
  return (
    <>
      <ManagementTabs
        value={tab}
        onChange={(value) => {
          onTab(value);
          setSearch('');
          setLimit(20);
        }}
        items={[
          {
            value: 'ZONES',
            label: t('areaUi.zonesTab'),
            accessibilityLabel: t('access.contractorZones'),
            count: permissions.length,
          },
          {
            value: 'ASSIGNMENTS',
            label: t('areaUi.assignmentsTab'),
            accessibilityLabel: t('access.assignmentsTab'),
            count: assignments.length,
          },
          ...(data.canGrantWorkerZones
            ? [
                {
                  value: 'WORKERS',
                  label: t('areaUi.permissionsTab'),
                  accessibilityLabel: t('access.workerPermissionsTab'),
                  count: data.workerPermissions.filter((permission) => !permission.revokedAt)
                    .length,
                },
              ]
            : []),
        ]}
      />
      <Text style={styles.hint}>
        {t(
          tab === 'ZONES'
            ? 'areaUi.zonesHint'
            : tab === 'ASSIGNMENTS'
              ? 'areaUi.assignmentsHint'
              : 'areaUi.permissionsHint',
        )}
      </Text>
      {notice && (
        <Text accessibilityLiveRegion="polite" style={styles.success}>
          {notice}
        </Text>
      )}
      <ManagementSection
        title={t(
          tab === 'ZONES'
            ? 'access.contractorZones'
            : tab === 'ASSIGNMENTS'
              ? 'access.assignmentStatus'
              : 'access.workerPermissionsTab',
        )}
        action={
          tab === 'ASSIGNMENTS' ? (
            <ManagementLink
              label={t('access.requestAssignment')}
              disabled={unavailable || !data.workers.length || !data.zones.length}
              onPress={() => onRequest('ASSIGN')}
            />
          ) : tab === 'WORKERS' && data.canGrantWorkerZones ? (
            <ManagementLink
              label={t('access.grantWithinScope')}
              disabled={unavailable || !approved.length || !permissions.length}
              onPress={() => grant()}
            />
          ) : undefined
        }
      >
        {count > 5 && (
          <Field
            label={t(tab === 'ZONES' ? 'areaUi.searchZones' : 'teamUi.searchWorkers')}
            value={search}
            onChangeText={(value) => {
              setSearch(value);
              setLimit(20);
            }}
          />
        )}
        {tab === 'ZONES' && (
          <>
            {!permissions.length && (
              <EmptyState
                icon={<IconMapPin size={26} color={colors.textMuted} />}
                title={t('access.noZones')}
                hint={t('access.noContractorGrantHint')}
              />
            )}
            {zonesVisible.slice(0, limit).map((permission) => (
              <Pressable
                key={permission.id}
                accessibilityRole="button"
                accessibilityLabel={t('areaUi.openZone', { name: zoneName(permission.zoneId) })}
                onPress={() => {
                  command.reset();
                  setSelected({ kind: 'ZONE', id: permission.id });
                }}
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              >
                <View style={styles.heading}>
                  <View style={styles.icon}>
                    <IconMapPin size={20} color={colors.primary} />
                  </View>
                  <Text style={styles.name}>{zoneName(permission.zoneId)}</Text>
                  <IconChevronRight size={17} color={colors.textTertiary} />
                </View>
                <ManagementBadge
                  label={t(active(permission) ? 'access.effective' : 'access.notEffective')}
                  tone={active(permission) ? 'success' : 'neutral'}
                />
                <ManagementPeriod from={permission.validFrom} to={permission.validUntil} />
              </Pressable>
            ))}
          </>
        )}
        {tab === 'ASSIGNMENTS' && (
          <>
            {!assignments.length && (
              <EmptyState
                icon={<IconUser size={26} color={colors.textMuted} />}
                title={t('access.noAssignments')}
              />
            )}
            {assignmentsVisible.slice(0, limit).map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={t('areaUi.openAssignment', { name: item.workerName })}
                onPress={() => {
                  command.reset();
                  setSelected({ kind: 'ASSIGNMENT', id: item.id });
                }}
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              >
                <View style={styles.heading}>
                  <View style={styles.icon}>
                    <IconUser size={20} color={colors.primary} />
                  </View>
                  <Text style={styles.name}>{item.workerName}</Text>
                  <IconChevronRight size={17} color={colors.textTertiary} />
                </View>
                <ManagementBadge
                  label={localizedLabel(item.status)}
                  tone={
                    item.status === 'APPROVED' && active(item)
                      ? 'success'
                      : item.status === 'REJECTED'
                        ? 'danger'
                        : 'neutral'
                  }
                />
                <ManagementPeriod from={item.validFrom} to={item.validUntil} />
                {item.status === 'APPROVED' &&
                  item.validUntil &&
                  Date.parse(item.validUntil) <= referenceTime && (
                    <Text style={styles.hint}>{t('access.assignmentExpired')}</Text>
                  )}
              </Pressable>
            ))}
          </>
        )}
        {tab === 'WORKERS' && data.canGrantWorkerZones && (
          <>
            {!approved.length && <Hint>{t('access.approvedAssignmentRequired')}</Hint>}
            {!workerPermissions.length && (
              <EmptyState
                icon={<IconShield size={26} color={colors.textMuted} />}
                title={t('access.noWorkerPermissions')}
                hint={t(
                  !permissions.length
                    ? 'access.noContractorGrantHint'
                    : !approved.length
                      ? 'access.approvedAssignmentRequired'
                      : 'areaUi.permissionsEmptyHint',
                )}
              />
            )}
            {workerVisible.slice(0, limit).map((permission) => (
              <Pressable
                key={permission.id}
                accessibilityRole="button"
                accessibilityLabel={t('areaUi.openPermission', {
                  name: assignedWorker(permission.workerAssignmentId)?.workerName ?? '',
                })}
                onPress={() => {
                  command.reset();
                  setSelected({ kind: 'PERMISSION', id: permission.id });
                }}
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              >
                <View style={styles.heading}>
                  <View style={styles.icon}>
                    <IconShield size={19} color={colors.primary} />
                  </View>
                  <View style={styles.copy}>
                    <Text style={[styles.name, { flex: 0 }]}>
                      {assignedWorker(permission.workerAssignmentId)?.workerName}
                    </Text>
                    <Text style={styles.hint}>
                      {workerZone(permission.contractorZonePermissionId)
                        ? zoneName(workerZone(permission.contractorZonePermissionId)!.zoneId)
                        : t('common.zone')}
                    </Text>
                  </View>
                  <IconChevronRight size={17} color={colors.textTertiary} />
                </View>
                <ManagementBadge
                  label={t(
                    permission.revokedAt
                      ? 'access.revoked'
                      : workerEffective(permission)
                        ? 'access.effective'
                        : 'access.notEffective',
                  )}
                  tone={workerEffective(permission) ? 'success' : 'neutral'}
                />
                <ManagementPeriod from={permission.validFrom} to={permission.validUntil} />
              </Pressable>
            ))}
            {data.workerPermissions.some((permission) => !!permission.revokedAt) && (
              <ManagementLink
                label={t(showRevoked ? 'areaUi.hideRevoked' : 'areaUi.showRevoked')}
                onPress={() => setShowRevoked(!showRevoked)}
              />
            )}
          </>
        )}
        {count > 0 &&
          !(
            tab === 'ZONES'
              ? zonesVisible
              : tab === 'ASSIGNMENTS'
                ? assignmentsVisible
                : workerVisible
          ).length && <Hint>{t('teamUi.noSearchResults')}</Hint>}
        {(tab === 'ZONES'
          ? zonesVisible
          : tab === 'ASSIGNMENTS'
            ? assignmentsVisible
            : workerVisible
        ).length > limit && (
          <ManagementLink label={t('areaUi.showMore')} onPress={() => setLimit(limit + 20)} />
        )}
      </ManagementSection>

      {selected && (
        <RequestSheet
          visible
          variant="compact"
          title={t(
            selected.kind === 'ZONE'
              ? 'teamUi.zoneDetails'
              : selected.kind === 'ASSIGNMENT'
                ? 'areaUi.assignmentDetails'
                : selected.kind === 'REVOKE'
                  ? 'access.revokeWorker'
                  : 'areaUi.permissionDetails',
          )}
          subtitle={scope.contractorName}
          busy={command.isPending}
          onClose={() => setSelected(null)}
          footer={
            <View style={styles.footer}>
              <ErrorNotice error={command.error} />
              {zone && data.canGrantWorkerZones && (
                <Button
                  label={t('access.grantWithinScope')}
                  disabled={unavailable || !approved.length || !active(zone)}
                  onPress={() => grant({ permissionId: zone.id })}
                />
              )}
              {assignment && data.canGrantWorkerZones && assignment.status === 'APPROVED' && (
                <Button
                  label={t('access.grantWorker')}
                  disabled={unavailable || !active(assignment) || !permissions.length}
                  onPress={() => grant({ assignmentId: assignment.id })}
                />
              )}
              {workerPermission && data.canGrantWorkerZones && !workerPermission.revokedAt && (
                <Button
                  secondary={selected.kind !== 'REVOKE'}
                  label={t(
                    selected.kind === 'REVOKE' ? 'areaUi.confirmRevoke' : 'access.revokeWorker',
                  )}
                  disabled={unavailable || command.isPending}
                  onPress={() => {
                    if (selected.kind !== 'REVOKE') {
                      setSelected({ kind: 'REVOKE', id: workerPermission.id });
                      return;
                    }
                    command.mutate(async () => {
                      await client.revokeZonePermission(
                        token,
                        scope.siteId,
                        workerPermission.id,
                        'worker',
                      );
                      setSelected(null);
                      setNotice(t('areaUi.revoked'));
                    });
                  }}
                />
              )}
            </View>
          }
        >
          {zone && (
            <>
              <Text style={styles.detailName}>{zoneName(zone.zoneId)}</Text>
              <ManagementBadge
                label={t(active(zone) ? 'access.effective' : 'access.notEffective')}
                tone={active(zone) ? 'success' : 'neutral'}
              />
              <ManagementPeriod from={zone.validFrom} to={zone.validUntil} />
              <Hint>{t('access.authorizationHint')}</Hint>
            </>
          )}
          {assignment && (
            <>
              <Text style={styles.detailName}>{assignment.workerName}</Text>
              <ManagementBadge
                label={localizedLabel(assignment.status)}
                tone={
                  assignment.status === 'APPROVED' && active(assignment) ? 'success' : 'neutral'
                }
              />
              <ManagementPeriod from={assignment.validFrom} to={assignment.validUntil} />
              {assignment.reviewNote && (
                <View style={styles.review}>
                  <Text style={styles.hint}>{t('documentUi.reviewNote')}</Text>
                  <Text style={styles.note}>{assignment.reviewNote}</Text>
                </View>
              )}
            </>
          )}
          {workerPermission && (
            <>
              <Text style={styles.detailName}>
                {assignedWorker(workerPermission.workerAssignmentId)?.workerName}
              </Text>
              <Text style={styles.hint}>
                {workerZone(workerPermission.contractorZonePermissionId)
                  ? zoneName(workerZone(workerPermission.contractorZonePermissionId)!.zoneId)
                  : t('common.zone')}
              </Text>
              <ManagementBadge
                label={t(
                  workerPermission.revokedAt
                    ? 'access.revoked'
                    : workerEffective(workerPermission)
                      ? 'access.effective'
                      : 'access.notEffective',
                )}
                tone={workerEffective(workerPermission) ? 'success' : 'neutral'}
              />
              <ManagementPeriod
                from={workerPermission.validFrom}
                to={workerPermission.validUntil}
              />
              {selected.kind === 'REVOKE' && <Hint>{t('areaUi.revokeHint')}</Hint>}
            </>
          )}
        </RequestSheet>
      )}
    </>
  );
}
const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 16,
    backgroundColor: colors.surface,
    gap: 13,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 22,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  hint: { fontSize: 12, lineHeight: 20, color: colors.textMuted },
  success: { fontSize: 12, lineHeight: 19, color: colors.successText },
  pressed: { opacity: 0.65 },
  footer: { gap: 8 },
  detailName: { fontSize: 17, lineHeight: 25, fontWeight: '700', color: colors.textPrimary },
  review: { padding: 12, borderRadius: 12, backgroundColor: colors.surfaceSubtle, gap: 5 },
  note: { color: colors.textSecondary, fontSize: 13, lineHeight: 21 },
});
