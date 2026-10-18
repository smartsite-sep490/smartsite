import { localizedLabel } from '../../i18n/messages';
import { translate as tr } from '../../i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '../workspace/workspace-context';
import { displayTime, instant, useCommand, useRequestId } from '../shared/data';
import { Body, Button, Card, Choice, ErrorNotice, Hint, Page, QueryState } from '../shared/ui';
import { DateTimeField } from '../shared/date-time-field';
import { useTranslation } from '../../i18n';

import { StyleSheet, View, Text } from 'react-native';

export function AccessScreen({ onBack }: { onBack: () => void }) {
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
  return <ContractorAccess onBack={onBack} />;
}
function ContractorAccess({ onBack }: { onBack: () => void }) {
  useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [workerId, setWorker] = useState(''),
    [zoneIds, setZones] = useState<string[]>([]),
    [assignmentId, setAssignment] = useState(''),
    [permissionId, setPermission] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const command = useCommand(),
    requestId = useRequestId();
  const query = useQuery({
    queryKey: [...queryKey, 'access-setup'],
    queryFn: () => client.accessSetup(token, scope.siteId),
  });
  const interval = () => {
    const validFrom = instant(from),
      validUntil = instant(to);
    if (validUntil <= validFrom) throw new Error(tr('validation.endAfterStart'));
    return { validFrom, validUntil };
  };
  return (
    <Page title={tr('access.title')} onBack={onBack}>
      <ErrorNotice error={command.error} />
      <QueryState query={query}>
        {(data) => {
          const workers = data.workers.filter((w) => w.contractorId === scope.contractorId);
          const workerIds = new Set(workers.map((w) => w.id));
          const assignments = data.assignments.filter((a) => workerIds.has(a.workerId));
          const participationIds = new Set(
            data.participations
              .filter((p) => p.contractorId === scope.contractorId)
              .map((p) => p.id),
          );
          const permissions = data.contractorPermissions.filter(
            (p) => participationIds.has(p.siteContractorId) && !p.revokedAt,
          );
          return (
            <>
              <Card>
                <Body>{tr('access.requestAssignment')}</Body>
                <Hint>{tr('access.assignmentHint')}</Hint>
                <Choice
                  label={tr('schedule.worker')}
                  value={workerId}
                  options={workers.map((w) => ({ value: w.id, label: w.name }))}
                  onChange={setWorker}
                />
                <Body>{tr('access.requestedZones')}</Body>
                {data.zones.map((z) => (
                  <Button
                    key={z.id}
                    secondary
                    label={`${zoneIds.includes(z.id) ? '☑' : '☐'} ${z.name}`}
                    onPress={() =>
                      setZones(
                        zoneIds.includes(z.id)
                          ? zoneIds.filter((v) => v !== z.id)
                          : [...zoneIds, z.id],
                      )
                    }
                  />
                ))}
                <DateTimeField label={tr('access.validFrom')} value={from} onChange={setFrom} />
                <DateTimeField label={tr('access.validUntil')} value={to} onChange={setTo} />
                <Button
                  label={tr('access.submitAssignment')}
                  disabled={command.isPending || !workerId || !zoneIds.length || !from || !to}
                  onPress={() =>
                    command.mutate(async () => {
                      const times = interval();
                      await client.createWorkerSiteZoneAssignment(token, workerId, {
                        siteId: scope.siteId,
                        zoneIds,
                        validFrom: times.validFrom,
                        validUntil: times.validUntil,
                      });
                      setWorker('');
                      setZones([]);
                    })
                  }
                />
              </Card>
              <Card>
                <Body>{tr('access.assignmentStatus')}</Body>
                {!assignments.length && <Hint>{tr('access.noAssignments')}</Hint>}
                {assignments.map((a) => (
                  <Card key={a.id}>
                    <Body>
                      {a.workerName} · {localizedLabel(a.status)}
                    </Body>
                    <Hint>
                      {displayTime(a.validFrom)} → {displayTime(a.validUntil)}
                    </Hint>
                    {a.reviewNote && <Hint>{a.reviewNote}</Hint>}
                  </Card>
                ))}
              </Card>
              {data.canGrantWorkerZones && (
                <Card>
                  <Body>{tr('access.grantWithinScope')}</Body>
                  <Choice
                    label={tr('access.approvedAssignment')}
                    value={assignmentId}
                    onChange={setAssignment}
                    options={assignments
                      .filter((a) => a.status === 'APPROVED')
                      .map((a) => ({ value: a.id, label: a.workerName }))}
                  />
                  <Choice
                    label={tr('access.contractorZoneGrant')}
                    value={permissionId}
                    onChange={setPermission}
                    options={permissions.map((p) => ({
                      value: p.id,
                      label: `${data.zones.find((z) => z.id === p.zoneId)?.name ?? tr('common.zone')} · ${displayTime(p.validUntil)}`,
                    }))}
                  />
                  <Hint>{tr('access.selectedValidity')}</Hint>
                  <Button
                    label={tr('access.grantWorker')}
                    disabled={command.isPending || !assignmentId || !permissionId || !from || !to}
                    onPress={() =>
                      command.mutate(() => {
                        const input = {
                          workerAssignmentId: assignmentId,
                          contractorZonePermissionId: permissionId,
                          ...interval(),
                        };
                        return client.grantWorkerZone(token, scope.siteId, {
                          ...input,
                          requestId: requestId(input),
                        });
                      })
                    }
                  />
                  {data.workerPermissions
                    .filter((p) => assignments.some((a) => a.id === p.workerAssignmentId))
                    .map((p) => (
                      <Card key={p.id}>
                        <Body>
                          {assignments.find((a) => a.id === p.workerAssignmentId)?.workerName} ·{' '}
                          {p.revokedAt ? tr('access.revoked') : tr('access.granted')}
                        </Body>
                        <Hint>
                          {displayTime(p.validFrom)} → {displayTime(p.validUntil)}
                        </Hint>
                        {!p.revokedAt && (
                          <Button
                            secondary
                            label={tr('access.revokeWorker')}
                            disabled={command.isPending}
                            onPress={() =>
                              command.mutate(() =>
                                client.revokeZonePermission(token, scope.siteId, p.id, 'worker'),
                              )
                            }
                          />
                        )}
                      </Card>
                    ))}
                </Card>
              )}
            </>
          );
        }}
      </QueryState>
    </Page>
  );
}

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
  },
  zoneIconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#FFF4EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneInfoCol: {
    flex: 1,
    gap: 4,
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
