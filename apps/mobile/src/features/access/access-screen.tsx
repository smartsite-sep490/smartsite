import { localizedLabel } from '../../i18n/messages';
import { translate as tr } from '../../i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '../workspace/workspace-context';
import { displayTime, instant, useCommand, useRequestId } from '../shared/data';
import {
  Button,
  Card,
  Choice,
  CompactTabs,
  ErrorNotice,
  Hint,
  Page,
  QueryState,
} from '../shared/ui';
import { DateTimeField } from '../shared/date-time-field';
import { useTranslation } from '../../i18n';

import { StyleSheet, View, Text, Pressable } from 'react-native';
import { colors } from '../../theme/colors';
import { IconMapPin, IconDocument, IconShield } from '../../components/common/Icons';
import { RequestSheet } from '../shared/request-sheet';
import { FormSection } from '../shared/form-section';
import { EmptyState, ListHeading } from '../contractor/contractor-presentation';

export function AccessScreen({
  onBack,
  embedded = false,
}: {
  onBack: () => void;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const team = useQuery({
    queryKey: [...queryKey, 'my-team'],
    queryFn: () => client.myContractorTeam(token, scope.siteId),
    enabled: scope.role === 'worker',
  });
  if (scope.role === 'worker')
    return (
      <Page title={t('access.myZones')} onBack={onBack}>
        <QueryState query={team}>
          {(data) => (
            <>
              <View style={accessStyles.teamBadgeCard}>
                <Text style={accessStyles.teamBadgeTitle}>
                  👥 {data.teamName ?? t('workerHome.noTeam')}
                </Text>
                <Text style={accessStyles.teamBadgeSub}>
                  {data.zones?.length ?? 0} {t('access.assignedZones').toLowerCase()}
                </Text>
              </View>

              {!data.zones?.length && <Hint>{t('access.noZones')}</Hint>}
              {data.zones?.map((z) => {
                const isActive = !z.revokedAt && z.effective;
                const isRevoked = Boolean(z.revokedAt);
                return (
                  <View key={z.id} style={accessStyles.zoneCard}>
                    <View style={accessStyles.zoneCardHeader}>
                      <View style={accessStyles.zoneIconBox}>
                        <Text style={{ fontSize: 18 }}>📍</Text>
                      </View>
                      <View style={accessStyles.zoneInfoCol}>
                        <Text style={accessStyles.zoneNameText}>{z.name}</Text>
                        <Text style={accessStyles.zoneTimeText}>
                          {displayTime(z.validFrom)} → {displayTime(z.validUntil)}
                        </Text>
                      </View>
                      <View
                        style={[
                          accessStyles.statusPill,
                          {
                            backgroundColor: isRevoked
                              ? '#FEE2E2'
                              : isActive
                                ? '#EDFAF2'
                                : '#F1F5F9',
                          },
                        ]}
                      >
                        <View
                          style={[
                            accessStyles.statusDot,
                            {
                              backgroundColor: isRevoked
                                ? '#EF4444'
                                : isActive
                                  ? '#10B981'
                                  : '#64748B',
                            },
                          ]}
                        />
                        <Text
                          style={[
                            accessStyles.statusText,
                            {
                              color: isRevoked ? '#DC2626' : isActive ? '#065F46' : '#475569',
                            },
                          ]}
                        >
                          {isRevoked
                            ? tr('access.revoked')
                            : isActive
                              ? t('access.effective')
                              : t('access.notEffective')}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}

              <View style={accessStyles.noticeBox}>
                <Text style={accessStyles.noticeBoxText}>{tr('access.authorizationHint')}</Text>
              </View>
            </>
          )}
        </QueryState>
      </Page>
    );
  return <ContractorAccess onBack={onBack} embedded={embedded} />;
}
function ContractorAccess({ onBack, embedded }: { onBack: () => void; embedded: boolean }) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [tab, setTab] = useState('ZONES');
  const [modal, setModal] = useState<'ASSIGN' | 'GRANT' | null>(null);
  const [workerId, setWorker] = useState('');
  const [zoneIds, setZones] = useState<string[]>([]);
  const [assignmentId, setAssignment] = useState('');
  const [permissionId, setPermission] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openedAt] = useState(() => Date.now());
  const command = useCommand(),
    requestId = useRequestId();
  const query = useQuery({
    queryKey: [...queryKey, 'access-setup'],
    queryFn: () => client.accessSetup(token, scope.siteId),
  });
  const open = (kind: 'ASSIGN' | 'GRANT') => {
    command.reset();
    setWorker('');
    setZones([]);
    setAssignment('');
    setPermission('');
    const start = new Date();
    setFrom(start.toISOString());
    setTo(new Date(+start + 8 * 3600_000).toISOString());
    setModal(kind);
  };
  const interval = () => {
    const validFrom = instant(from),
      validUntil = instant(to);
    if (validUntil <= validFrom) throw new Error(tr('validation.endAfterStart'));
    return { validFrom, validUntil };
  };
  return (
    <Page title={embedded ? undefined : t('access.title')} onBack={embedded ? undefined : onBack}>
      <Text style={contractorAccessStyles.caption}>
        {scope.contractorName} · {scope.siteName}
      </Text>
      <QueryState query={query}>
        {(data) => {
          const workers = data.workers.filter(
            (worker) => worker.contractorId === scope.contractorId,
          );
          const workerIds = new Set(workers.map((worker) => worker.id));
          const assignments = data.assignments.filter((assignment) =>
            workerIds.has(assignment.workerId),
          );
          const participations = data.participations.filter(
            (participation) => participation.contractorId === scope.contractorId,
          );
          const participationIds = new Set(participations.map((participation) => participation.id));
          const permissions = data.contractorPermissions.filter(
            (permission) =>
              participationIds.has(permission.siteContractorId) && !permission.revokedAt,
          );
          const workerPermissions = data.workerPermissions.filter((permission) =>
            assignments.some((assignment) => assignment.id === permission.workerAssignmentId),
          );
          const approvedAssignments = assignments.filter(
            (assignment) => assignment.status === 'APPROVED' && assignment.validUntil,
          );
          const selectedAssignment = approvedAssignments.find(
            (assignment) => assignment.id === assignmentId,
          );
          const matchingPermissions = permissions.filter(
            (permission) =>
              !selectedAssignment ||
              permission.siteContractorId === selectedAssignment.siteContractorId,
          );
          const fits = (
            start: string,
            end: string,
            parentStart: string,
            parentEnd: string | null,
          ) =>
            Date.parse(start) >= Date.parse(parentStart) &&
            (!parentEnd || Date.parse(end) <= Date.parse(parentEnd));
          return (
            <>
              <CompactTabs
                value={tab}
                options={[
                  { value: 'ZONES', label: t('access.contractorZones') },
                  { value: 'ASSIGNMENTS', label: t('access.assignmentsTab') },
                  ...(data.canGrantWorkerZones
                    ? [{ value: 'WORKERS', label: t('access.workerPermissionsTab') }]
                    : []),
                ]}
                onChange={setTab}
              />
              {!modal && <ErrorNotice error={command.error} />}
              {tab === 'ZONES' && (
                <>
                  <ListHeading
                    title={t('access.contractorZones')}
                    count={t('access.zoneCount', { count: permissions.length })}
                  />
                  {!permissions.length && (
                    <EmptyState
                      icon={<IconMapPin size={26} color={colors.primary} />}
                      title={t('access.noZones')}
                    />
                  )}
                  {!permissions.length && (
                    <Text style={contractorAccessStyles.notice}>
                      {t('access.noContractorGrantHint')}
                    </Text>
                  )}
                  {permissions.map((permission) => (
                    <Card key={permission.id}>
                      <View style={contractorAccessStyles.heading}>
                        <View style={contractorAccessStyles.icon}>
                          <IconMapPin size={20} color={colors.primary} />
                        </View>
                        <Text style={contractorAccessStyles.name}>
                          {data.zones.find((zone) => zone.id === permission.zoneId)?.name ??
                            t('common.zone')}
                        </Text>
                      </View>
                      <Text style={contractorAccessStyles.caption}>
                        {t('access.validFrom')}: {displayTime(permission.validFrom)}
                      </Text>
                      <Text style={contractorAccessStyles.caption}>
                        {t('access.validUntil')}: {displayTime(permission.validUntil)}
                      </Text>
                    </Card>
                  ))}
                  <Text style={contractorAccessStyles.notice}>{t('access.authorizationHint')}</Text>
                </>
              )}
              {tab === 'ASSIGNMENTS' && (
                <>
                  <Text style={contractorAccessStyles.notice}>{t('access.flowHint')}</Text>
                  <Button
                    label={t('access.requestAssignment')}
                    disabled={!workers.length || !data.zones.length || query.isRefetchError}
                    onPress={() => open('ASSIGN')}
                  />
                  {!workers.length && <Hint>{t('access.noWorkersHint')}</Hint>}
                  <ListHeading
                    title={t('access.assignmentStatus')}
                    count={t('access.assignmentCount', { count: assignments.length })}
                  />
                  {!assignments.length && (
                    <EmptyState
                      icon={<IconDocument size={26} color={colors.primary} />}
                      title={t('access.noAssignments')}
                    />
                  )}
                  {assignments.map((assignment) => (
                    <Card key={assignment.id}>
                      <View style={contractorAccessStyles.heading}>
                        <Text style={contractorAccessStyles.name}>{assignment.workerName}</Text>
                        <Text style={contractorAccessStyles.badge}>
                          {localizedLabel(assignment.status)}
                        </Text>
                      </View>
                      <Text style={contractorAccessStyles.caption}>
                        {displayTime(assignment.validFrom)} → {displayTime(assignment.validUntil)}
                      </Text>
                      {assignment.status === 'APPROVED' &&
                        assignment.validUntil &&
                        Date.parse(assignment.validUntil) <= openedAt && (
                          <Hint>{t('access.assignmentExpired')}</Hint>
                        )}
                      {assignment.reviewNote && (
                        <Text style={contractorAccessStyles.reason}>{assignment.reviewNote}</Text>
                      )}
                    </Card>
                  ))}
                </>
              )}
              {tab === 'WORKERS' && data.canGrantWorkerZones && (
                <>
                  <Button
                    secondary
                    label={t('access.grantWithinScope')}
                    disabled={
                      !permissions.length || !approvedAssignments.length || query.isRefetchError
                    }
                    onPress={() => open('GRANT')}
                  />
                  {!permissions.length && (
                    <Text style={contractorAccessStyles.notice}>
                      {t('access.noContractorGrantHint')}
                    </Text>
                  )}
                  {!approvedAssignments.length && (
                    <Hint>{t('access.approvedAssignmentRequired')}</Hint>
                  )}
                  <ListHeading
                    title={t('access.workerPermissionsTab')}
                    count={t('access.permissionCount', { count: workerPermissions.length })}
                  />
                  {!workerPermissions.length && (
                    <EmptyState
                      icon={<IconShield size={26} color={colors.primary} />}
                      title={t('access.noWorkerPermissions')}
                    />
                  )}
                  {workerPermissions.map((permission) => (
                    <Card key={permission.id}>
                      <View style={contractorAccessStyles.heading}>
                        <Text style={contractorAccessStyles.name}>
                          {
                            assignments.find(
                              (assignment) => assignment.id === permission.workerAssignmentId,
                            )?.workerName
                          }
                        </Text>
                        <Text style={contractorAccessStyles.badge}>
                          {t(permission.revokedAt ? 'access.revoked' : 'access.granted')}
                        </Text>
                      </View>
                      <Text style={contractorAccessStyles.caption}>
                        {displayTime(permission.validFrom)} → {displayTime(permission.validUntil)}
                      </Text>
                      {!permission.revokedAt && (
                        <Button
                          secondary
                          label={t('access.revokeWorker')}
                          disabled={command.isPending || query.isRefetchError}
                          onPress={() =>
                            command.mutate(() =>
                              client.revokeZonePermission(
                                token,
                                scope.siteId,
                                permission.id,
                                'worker',
                              ),
                            )
                          }
                        />
                      )}
                    </Card>
                  ))}
                </>
              )}
              {modal && (modal === 'ASSIGN' || data.canGrantWorkerZones) && (
                <RequestSheet
                  visible
                  variant="form"
                  title={t(
                    modal === 'ASSIGN' ? 'access.requestAssignment' : 'access.grantWithinScope',
                  )}
                  subtitle={scope.contractorName}
                  icon={<IconMapPin size={23} color={colors.primary} />}
                  onClose={() => setModal(null)}
                  busy={command.isPending}
                  footer={
                    <View style={contractorAccessStyles.form}>
                      <ErrorNotice error={command.error} />
                      <Button
                        label={t(
                          modal === 'ASSIGN' ? 'access.submitAssignment' : 'access.grantWorker',
                        )}
                        disabled={
                          command.isPending ||
                          query.isRefetchError ||
                          !from ||
                          !to ||
                          (modal === 'ASSIGN'
                            ? !workerId || !zoneIds.length
                            : !assignmentId || !permissionId)
                        }
                        onPress={() =>
                          command.mutate(async () => {
                            if (modal === 'ASSIGN') {
                              const times = interval();
                              if (
                                !participations.some((participation) =>
                                  fits(
                                    times.validFrom,
                                    times.validUntil,
                                    participation.validFrom,
                                    participation.validUntil,
                                  ),
                                )
                              )
                                throw new Error(t('access.assignmentOutsideParticipation'));
                              await client.createWorkerSiteZoneAssignment(token, workerId, {
                                siteId: scope.siteId,
                                zoneIds,
                                ...times,
                              });
                              setWorker('');
                              setZones([]);
                              setTab('ASSIGNMENTS');
                            } else {
                              const input = {
                                workerAssignmentId: assignmentId,
                                contractorZonePermissionId: permissionId,
                                ...interval(),
                              };
                              const selectedPermission = matchingPermissions.find(
                                (permission) => permission.id === permissionId,
                              );
                              const participation = participations.find(
                                (participation) =>
                                  participation.id === selectedAssignment?.siteContractorId,
                              );
                              if (
                                !selectedAssignment ||
                                !selectedPermission ||
                                !participation ||
                                !fits(
                                  input.validFrom,
                                  input.validUntil,
                                  selectedAssignment.validFrom,
                                  selectedAssignment.validUntil,
                                ) ||
                                !fits(
                                  input.validFrom,
                                  input.validUntil,
                                  selectedPermission.validFrom,
                                  selectedPermission.validUntil,
                                ) ||
                                !fits(
                                  input.validFrom,
                                  input.validUntil,
                                  participation.validFrom,
                                  participation.validUntil,
                                )
                              )
                                throw new Error(t('access.workerGrantOutsideScope'));
                              await client.grantWorkerZone(token, scope.siteId, {
                                ...input,
                                requestId: requestId(input),
                              });
                              setTab('WORKERS');
                            }
                            setModal(null);
                          })
                        }
                      />
                    </View>
                  }
                >
                  <View
                    pointerEvents={command.isPending ? 'none' : 'auto'}
                    style={contractorAccessStyles.form}
                  >
                    <FormSection number="01" title={t('schedule.worker')}>
                      {modal === 'ASSIGN' ? (
                        <>
                          <Text style={contractorAccessStyles.caption}>
                            {t('access.assignmentHint')}
                          </Text>
                          <Choice
                            label={t('schedule.worker')}
                            value={workerId}
                            options={workers.map((worker) => ({
                              value: worker.id,
                              label: worker.name,
                            }))}
                            onChange={setWorker}
                          />
                        </>
                      ) : (
                        <Choice
                          label={t('access.approvedAssignment')}
                          value={assignmentId}
                          onChange={(next) => {
                            setAssignment(next);
                            setPermission('');
                          }}
                          options={approvedAssignments.map((assignment) => ({
                            value: assignment.id,
                            label: assignment.workerName,
                          }))}
                        />
                      )}
                    </FormSection>
                    <FormSection
                      number="02"
                      title={t(
                        modal === 'ASSIGN' ? 'access.requestedZones' : 'access.contractorZoneGrant',
                      )}
                    >
                      {modal === 'ASSIGN' ? (
                        <>
                          {!data.zones.length && <Hint>{t('access.noZones')}</Hint>}
                          {data.zones.map((zone) => (
                            <Pressable
                              key={zone.id}
                              accessibilityRole="checkbox"
                              accessibilityLabel={zone.name}
                              accessibilityState={{ checked: zoneIds.includes(zone.id) }}
                              onPress={() =>
                                setZones((previous) =>
                                  previous.includes(zone.id)
                                    ? previous.filter((id) => id !== zone.id)
                                    : [...previous, zone.id],
                                )
                              }
                              style={contractorAccessStyles.zoneOption}
                            >
                              <View
                                style={[
                                  contractorAccessStyles.checkbox,
                                  zoneIds.includes(zone.id) && contractorAccessStyles.checked,
                                ]}
                              >
                                <Text style={contractorAccessStyles.checkmark}>
                                  {zoneIds.includes(zone.id) ? '✓' : ''}
                                </Text>
                              </View>
                              <Text style={contractorAccessStyles.zoneOptionText}>{zone.name}</Text>
                            </Pressable>
                          ))}
                        </>
                      ) : (
                        <Choice
                          label={t('access.contractorZoneGrant')}
                          value={permissionId}
                          onChange={setPermission}
                          options={matchingPermissions.map((permission) => ({
                            value: permission.id,
                            label: `${data.zones.find((zone) => zone.id === permission.zoneId)?.name ?? t('common.zone')} · ${displayTime(permission.validUntil)}`,
                          }))}
                        />
                      )}
                    </FormSection>
                    <FormSection number="03" title={t('access.validityTitle')}>
                      {participations.map((participation) => (
                        <Hint key={participation.id}>
                          {t('access.participationRange', {
                            from: displayTime(participation.validFrom),
                            to: participation.validUntil
                              ? displayTime(participation.validUntil)
                              : t('access.noEnd'),
                          })}
                        </Hint>
                      ))}
                      {modal === 'GRANT' && <Hint>{t('access.workerGrantIntervalHint')}</Hint>}
                      <DateTimeField
                        compact
                        label={t('access.validFrom')}
                        value={from}
                        onChange={setFrom}
                        disabled={command.isPending}
                      />
                      <DateTimeField
                        compact
                        label={t('access.validUntil')}
                        value={to}
                        onChange={setTo}
                        disabled={command.isPending}
                      />
                    </FormSection>
                  </View>
                </RequestSheet>
              )}
            </>
          );
        }}
      </QueryState>
    </Page>
  );
}

const contractorAccessStyles = StyleSheet.create({
  form: { gap: 12 },
  heading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    justifyContent: 'space-between',
  },
  name: {
    flex: 1,
    minWidth: 100,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  caption: { fontSize: 12, lineHeight: 20, color: colors.textMuted },
  badge: {
    maxWidth: '100%',
    paddingHorizontal: 9,
    paddingVertical: 5,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 8,
    overflow: 'hidden',
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    padding: 14,
    borderRadius: 12,
    fontSize: 12,
    lineHeight: 20,
    color: colors.textMuted,
    backgroundColor: colors.surfaceSubtle,
  },
  reason: { fontSize: 14, lineHeight: 22, color: colors.textPrimary },
  zoneOption: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { fontSize: 13, fontWeight: '700', color: colors.textWhite },
  zoneOptionText: { flex: 1, fontSize: 14, lineHeight: 21, color: colors.textPrimary },
});

const accessStyles = StyleSheet.create({
  teamBadgeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#EFF2F6',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  teamBadgeTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F1E36',
  },
  teamBadgeSub: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  zoneCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#EFF2F6',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  zoneCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  zoneIconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#FFF4EE',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  zoneInfoCol: {
    flex: 1,
    gap: 4,
    minWidth: 100,
    flexBasis: 120,
  },
  zoneNameText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F1E36',
  },
  zoneTimeText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
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
  noticeBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    marginTop: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  noticeBoxText: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
  },
});
