import { translate as tr } from '../../i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '../workspace/workspace-context';
import { displayTime, instant, useCommand, useRequestId } from '../shared/data';
import { Button, Choice, ErrorNotice, Hint, Page, QueryState } from '../shared/ui';
import { DateTimeField } from '../shared/date-time-field';
import { useTranslation } from '../../i18n';

import { StyleSheet, View, Text, Pressable } from 'react-native';
import { colors } from '../../theme/colors';
import { IconMapPin } from '../../components/common/Icons';
import { RequestSheet } from '../shared/request-sheet';
import { FormSection } from '../shared/form-section';
import { AccessOverview, WorkerZoneOverview, type AccessFormContext } from './access-overview';

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
        <QueryState query={team}>{(data) => <WorkerZoneOverview data={data} />}</QueryState>
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
  const [formContext, setFormContext] = useState<AccessFormContext>({});
  const command = useCommand(),
    requestId = useRequestId();
  const query = useQuery({
    queryKey: [...queryKey, 'access-setup'],
    queryFn: () => client.accessSetup(token, scope.siteId),
  });
  const open = (kind: 'ASSIGN' | 'GRANT', context: AccessFormContext = {}) => {
    command.reset();
    setWorker('');
    setZones([]);
    setAssignment(context.assignmentId ?? '');
    setPermission(context.permissionId ?? '');
    setFormContext(context);
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
          const permissionHistory = data.contractorPermissions.filter((permission) =>
            participationIds.has(permission.siteContractorId),
          );
          const permissions = permissionHistory.filter((permission) => !permission.revokedAt);
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
              {!modal && <ErrorNotice error={command.error} />}
              <AccessOverview
                data={{
                  ...data,
                  workers,
                  assignments,
                  contractorPermissions: permissionHistory,
                  workerPermissions,
                }}
                tab={tab}
                onTab={setTab}
                onRequest={open}
                unavailable={query.isError}
              />
              {modal && (modal === 'ASSIGN' || data.canGrantWorkerZones) && (
                <RequestSheet
                  visible
                  variant="compact"
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
                    <FormSection title={t('schedule.worker')}>
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
                      ) : formContext.assignmentId && selectedAssignment ? (
                        <Text style={contractorAccessStyles.name}>
                          {selectedAssignment.workerName}
                        </Text>
                      ) : (
                        <Choice
                          label={t('access.approvedAssignment')}
                          value={assignmentId}
                          onChange={(next) => {
                            setAssignment(next);
                            const nextAssignment = approvedAssignments.find(
                              (item) => item.id === next,
                            );
                            const parent = permissions.find((item) => item.id === permissionId);
                            if (
                              !parent ||
                              parent.siteContractorId !== nextAssignment?.siteContractorId
                            )
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
                    <FormSection title={t('access.validityTitle')}>
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
