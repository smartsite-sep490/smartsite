import { translate as tr } from '../../i18n';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { ContractorTeamResponse, ContractorTeamWorkerResponse } from '@smartsite/api-client';
import { useWorkspace } from '../workspace/workspace-context';
import {
  allPages,
  displayTime,
  localDate,
  required,
  useCommand,
  useRequestId,
  validDates,
} from '../shared/data';
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
  CompactTabs,
} from '../shared/ui';
import { useTranslation } from '../../i18n';
import { IconUsers } from '../../components/common/Icons';
import { colors } from '../../theme/colors';
import { RequestSheet } from '../shared/request-sheet';
import { FormSection } from '../shared/form-section';
import { CalendarDateField } from '../shared/calendar-date-field';
import { DetailLink, EmptyState, ListHeading } from './contractor-presentation';

export function TeamsScreen({
  selectedTeam,
  onSelectTeam,
}: {
  selectedTeam?: ContractorTeamResponse | null;
  onSelectTeam?: (team: ContractorTeamResponse | null) => void;
}) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED' | 'ALL'>('ACTIVE'),
    [offset, setOffset] = useState(0);
  const [internalTeam, setInternalTeam] = useState<ContractorTeamResponse | null>(null);
  const team = selectedTeam !== undefined ? selectedTeam : internalTeam;
  const setTeam = onSelectTeam ?? setInternalTeam;
  const [creating, setCreating] = useState(false);

  const query = useQuery({
    queryKey: [...queryKey, 'teams', search, status, offset],
    queryFn: () =>
      client.listContractorTeams(token, scope.siteId, scope.contractorId, {
        search,
        status,
        offset,
        limit: 8,
      }),
  });

  if (team)
    return (
      <TeamDetail
        key={team.id}
        teamId={team.id}
        standalone={!onSelectTeam}
        onBack={() => setTeam(null)}
      />
    );

  return (
    <Page>
      <Text style={teamStyles.caption}>
        {scope.contractorName} · {scope.siteName}
      </Text>
      <Button label={t('teams.createTeam')} onPress={() => setCreating(true)} />

      <Field
        label={t('teams.searchTeam')}
        placeholder={t('teams.searchTeam')}
        value={search}
        onChangeText={(v) => {
          setSearch(v);
          setOffset(0);
        }}
      />
      <CompactTabs
        value={status}
        options={[
          { value: 'ACTIVE', label: t('teams.active') },
          { value: 'ARCHIVED', label: t('teams.archived') },
          { value: 'ALL', label: t('common.all') },
        ]}
        onChange={(v) => {
          setStatus(v as typeof status);
          setOffset(0);
        }}
      />
      <QueryState query={query}>
        {(data) => (
          <>
            <ListHeading
              title={t('teams.title')}
              count={t('teams.listCount', { count: data.total })}
            />
            {!data.items.length && (
              <EmptyState
                icon={<IconUsers size={26} color={colors.primary} />}
                title={tr('teams.noneInScope')}
                hint={t('teams.emptyHint')}
              />
            )}
            {data.items.map((teamItem) => (
              <View key={teamItem.id} style={teamStyles.teamCard}>
                <View style={teamStyles.teamHeaderRow}>
                  <View style={teamStyles.teamIconBox}>
                    <IconUsers size={22} color={colors.primary} />
                  </View>
                  <View style={teamStyles.teamInfoCol}>
                    <Text style={teamStyles.teamNameText}>{teamItem.name}</Text>
                  </View>
                  <View
                    style={[
                      teamStyles.statusPill,
                      { backgroundColor: teamItem.isActive ? '#EDFAF2' : '#F1F5F9' },
                    ]}
                  >
                    <View
                      style={[
                        teamStyles.statusDot,
                        { backgroundColor: teamItem.isActive ? '#10B981' : '#64748B' },
                      ]}
                    />
                    <Text
                      style={[
                        teamStyles.statusText,
                        { color: teamItem.isActive ? '#065F46' : '#64748B' },
                      ]}
                    >
                      {teamItem.isActive ? t('teams.active') : t('teams.archived')}
                    </Text>
                  </View>
                </View>

                <View style={teamStyles.memberCountRow}>
                  <Text style={teamStyles.memberCountText}>
                    {teamItem.memberCount} {tr('teams.membersUnit')}
                  </Text>
                </View>

                <DetailLink label={tr('teams.membersAndZones')} onPress={() => setTeam(teamItem)} />
              </View>
            ))}
            {data.total > 8 && (
              <Pager offset={offset} total={data.total} size={8} onChange={setOffset} />
            )}
          </>
        )}
      </QueryState>

      {/* Modal: Tạo nhóm mới (Chỉ mở khi bấm nút) */}
      <CreateTeamModal
        visible={creating}
        onClose={() => setCreating(false)}
        onSuccess={() => void query.refetch()}
      />
    </Page>
  );
}

function CreateTeamModal({
  visible,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { t } = useTranslation();
  const { scope, client, token } = useWorkspace();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const command = useCommand(),
    requestId = useRequestId();

  return (
    <RequestSheet
      visible={visible}
      variant="form"
      title={t('teams.createTeam')}
      subtitle={scope.contractorName + ' · ' + scope.siteName}
      icon={<IconUsers size={23} color={colors.primary} />}
      busy={command.isPending}
      onClose={onClose}
      footer={
        <View style={teamStyles.form}>
          <ErrorNotice error={command.error} />
          <Button
            label={t('teams.saveTeam')}
            disabled={command.isPending || !name.trim()}
            onPress={() =>
              command.mutate(async () => {
                const input = {
                  name: required(name, t('teams.newTeamName')),
                  description: description.trim(),
                };
                await client.createContractorTeam(token, scope.siteId, scope.contractorId, {
                  ...input,
                  requestId: requestId(input),
                });
                setName('');
                setDescription('');
                onSuccess?.();
                onClose();
              })
            }
          />
        </View>
      }
    >
      <FormSection number="01" title={t('teams.details')}>
        <Field
          label={t('teams.newTeamName')}
          value={name}
          onChangeText={setName}
          editable={!command.isPending}
        />
        <Field
          label={t('teams.newTeamDesc')}
          value={description}
          onChangeText={setDescription}
          multiline
          editable={!command.isPending}
        />
      </FormSection>
    </RequestSheet>
  );
}

function TeamDetail({
  teamId,
  standalone = false,
  onBack,
}: {
  teamId: string;
  standalone?: boolean;
  onBack: () => void;
}) {
  useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [managing, setManaging] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [edit, setEdit] = useState(false),
    [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [reason, setReason] = useState(''),
    [workerId, setWorkerId] = useState(''),
    [targetTeam, setTargetTeam] = useState(teamId);
  const command = useCommand(),
    requestId = useRequestId();
  const detail = useQuery({
    queryKey: [...queryKey, 'team', teamId],
    queryFn: () => client.contractorTeamDetail(token, scope.siteId, scope.contractorId, teamId),
  });
  const workers = useQuery({
    queryKey: [...queryKey, 'team-workers'],
    queryFn: ({ signal }) =>
      allPages(
        (p) => client.listContractorTeamWorkers(token, scope.siteId, scope.contractorId, p),
        signal,
      ),
  });
  const teams = useQuery({
    queryKey: [...queryKey, 'all-active-teams'],
    queryFn: ({ signal }) =>
      allPages(
        (p) =>
          client.listContractorTeams(token, scope.siteId, scope.contractorId, {
            ...p,
            status: 'ACTIVE',
          }),
        signal,
      ),
  });
  const worker: ContractorTeamWorkerResponse | undefined = workers.data?.find(
    (w) => w.workerId === workerId,
  );
  return (
    <Page
      title={standalone ? tr('teams.details') : undefined}
      onBack={standalone ? onBack : undefined}
    >
      <ErrorNotice error={command.error} />
      <QueryState query={detail}>
        {(t) => (
          <>
            <Card>
              <View style={teamStyles.teamHeaderRow}>
                <View style={teamStyles.teamIconBox}>
                  <IconUsers size={22} color={colors.primary} />
                </View>
                <View style={teamStyles.teamInfoCol}>
                  <Text style={teamStyles.teamNameText}>{t.name}</Text>
                  <Text style={teamStyles.caption}>
                    {t.memberCount} {tr('teams.membersUnit')}
                  </Text>
                </View>
                <Text style={teamStyles.badge}>
                  {t.isActive ? tr('teams.active') : tr('teams.archived')}
                </Text>
              </View>
              <Hint>{t.description}</Hint>
              {t.isActive && (
                <>
                  <Button
                    secondary
                    label={tr('teams.editNameDescription')}
                    onPress={() => {
                      setName(t.name);
                      setDescription(t.description);
                      command.reset();
                      setEdit(!edit);
                    }}
                  />
                  {edit && (
                    <RequestSheet
                      visible
                      variant="form"
                      title={tr('teams.editNameDescription')}
                      subtitle={t.name}
                      icon={<IconUsers size={23} color={colors.primary} />}
                      busy={command.isPending}
                      onClose={() => setEdit(false)}
                      footer={
                        <View style={teamStyles.form}>
                          <ErrorNotice error={command.error} />
                          <Button
                            label={tr('teams.saveChanges')}
                            disabled={command.isPending || !name.trim()}
                            onPress={() =>
                              command.mutate(async () => {
                                await client.updateContractorTeam(
                                  token,
                                  scope.siteId,
                                  scope.contractorId,
                                  t.id,
                                  {
                                    expectedVersion: t.version,
                                    name: required(name, tr('validation.teamNameLabel')),
                                    description,
                                  },
                                );
                                setEdit(false);
                              })
                            }
                          />
                        </View>
                      }
                    >
                      <FormSection number="01" title={tr('teams.details')}>
                        <View
                          pointerEvents={command.isPending ? 'none' : 'auto'}
                          style={teamStyles.form}
                        >
                          <Field label={tr('teams.teamName')} value={name} onChangeText={setName} />
                          <Field
                            label={tr('common.description')}
                            value={description}
                            onChangeText={setDescription}
                            multiline
                          />
                        </View>
                      </FormSection>
                    </RequestSheet>
                  )}
                  <Button
                    secondary
                    label={tr('contractorUi.archiveTeam')}
                    onPress={() => {
                      setReason('');
                      setArchiving(true);
                      command.reset();
                    }}
                  />
                  {archiving && (
                    <RequestSheet
                      visible
                      variant="form"
                      title={tr('contractorUi.archiveTeam')}
                      subtitle={t.name}
                      icon={<IconUsers size={23} color={colors.primary} />}
                      busy={command.isPending}
                      onClose={() => setArchiving(false)}
                      footer={
                        <View style={teamStyles.form}>
                          <ErrorNotice error={command.error} />
                          <Button
                            secondary
                            label={tr('teams.archiveEmpty')}
                            disabled={command.isPending || t.memberCount > 0 || !reason.trim()}
                            onPress={() =>
                              command.mutate(async () => {
                                await client.archiveContractorTeam(
                                  token,
                                  scope.siteId,
                                  scope.contractorId,
                                  t.id,
                                  {
                                    expectedVersion: t.version,
                                    reason: required(reason, tr('validation.reasonLabel')),
                                  },
                                );
                                onBack();
                              })
                            }
                          />
                        </View>
                      }
                    >
                      <FormSection number="01" title={tr('contractorUi.archiveTeam')}>
                        <Hint>{tr('teams.archiveHint')}</Hint>
                        <Field
                          label={tr('teams.membershipReason')}
                          value={reason}
                          onChangeText={setReason}
                          multiline
                          editable={!command.isPending}
                        />
                      </FormSection>
                    </RequestSheet>
                  )}
                </>
              )}
            </Card>
            <QueryState query={workers}>
              {(members) => (
                <Card>
                  <Body>{tr('teams.currentMembers')}</Body>
                  {members
                    .filter((w) => w.teamId === teamId)
                    .map((w) => (
                      <View key={w.workerId} style={teamStyles.memberRow}>
                        <View style={teamStyles.memberInitial}>
                          <Text style={teamStyles.memberLetter}>
                            {w.displayName.slice(0, 1).toUpperCase()}
                          </Text>
                        </View>
                        <Text style={teamStyles.memberName}>{w.displayName}</Text>
                      </View>
                    ))}
                  {!members.some((w) => w.teamId === teamId) && (
                    <Hint>{tr('teams.noMembers')}</Hint>
                  )}
                  {t.isActive && (
                    <>
                      <Button
                        secondary
                        label={tr('contractorUi.manageMembers')}
                        onPress={() => {
                          setReason('');
                          command.reset();
                          setManaging(true);
                        }}
                      />
                      {managing && (
                        <RequestSheet
                          visible
                          variant="form"
                          title={tr('contractorUi.manageMembers')}
                          subtitle={t.name}
                          icon={<IconUsers size={23} color={colors.primary} />}
                          busy={command.isPending}
                          onClose={() => setManaging(false)}
                          footer={
                            <View style={teamStyles.form}>
                              <ErrorNotice error={command.error} />
                              <Button
                                label={tr('teams.confirmMembership')}
                                disabled={
                                  command.isPending ||
                                  !worker ||
                                  targetTeam === worker.teamId ||
                                  (!targetTeam && !worker.membershipId)
                                }
                                onPress={() =>
                                  command.mutate(async () => {
                                    if (!worker) throw new Error(tr('validation.chooseWorker'));
                                    if (worker.membershipId)
                                      required(reason, tr('validation.transferReasonLabel'));
                                    const input = {
                                      teamId: targetTeam || null,
                                      expectedMembershipId: worker.membershipId,
                                      ...(worker.membershipId ? { reason: reason.trim() } : {}),
                                    };
                                    await client.assignContractorTeam(
                                      token,
                                      scope.siteId,
                                      scope.contractorId,
                                      worker.workerId,
                                      { ...input, requestId: requestId([worker.workerId, input]) },
                                    );
                                    setWorkerId('');
                                    setManaging(false);
                                  })
                                }
                              />
                            </View>
                          }
                        >
                          <FormSection number="01" title={tr('teams.currentMembers')}>
                            <View
                              pointerEvents={command.isPending ? 'none' : 'auto'}
                              style={teamStyles.form}
                            >
                              <Field
                                label={tr('teams.membershipReason')}
                                value={reason}
                                onChangeText={setReason}
                              />
                              <Choice
                                label={tr('teams.workerToMove')}
                                value={workerId}
                                onChange={setWorkerId}
                                options={members.map((w) => ({
                                  value: w.workerId,
                                  label: `${w.displayName} · ${w.teamName ?? tr('teams.unassigned')}`,
                                }))}
                              />
                              <QueryState query={teams}>
                                {(list) => (
                                  <Choice
                                    label={tr('teams.targetTeam')}
                                    value={targetTeam}
                                    onChange={setTargetTeam}
                                    options={[
                                      { value: '', label: tr('teams.removeFromCurrent') },
                                      ...list.map((v) => ({ value: v.id, label: v.name })),
                                    ]}
                                  />
                                )}
                              </QueryState>
                            </View>
                          </FormSection>
                        </RequestSheet>
                      )}
                    </>
                  )}
                </Card>
              )}
            </QueryState>
            {t.isActive && <TeamZones teamId={teamId} />}
          </>
        )}
      </QueryState>
    </Page>
  );
}
function TeamZones({ teamId }: { teamId: string }) {
  useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [managing, setManaging] = useState(false);
  const [permission, setPermission] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const command = useCommand(),
    requestId = useRequestId();
  const query = useQuery({
    queryKey: [...queryKey, 'team-zones', teamId],
    queryFn: () => client.teamZoneSetup(token, scope.siteId, scope.contractorId, teamId),
  });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <FormSection title={tr('teams.zones')}>
      <QueryState query={query}>
        {(data) => {
          const current = data.permissions.find((p) => !p.revokedAt);
          return (
            <>
              {!data.permissions.length && <Hint>{tr('access.noZones')}</Hint>}
              {data.permissions.map((p) => (
                <Card key={p.id}>
                  <Body>
                    {p.name} ·{' '}
                    {p.revokedAt
                      ? tr('access.revoked')
                      : p.effective
                        ? tr('teams.effective')
                        : tr('teams.outsideValidity')}
                  </Body>
                  <Hint>
                    {displayTime(p.validFrom)} → {displayTime(p.validUntil)}
                  </Hint>
                  {!p.revokedAt && (
                    <Button
                      secondary
                      label={tr('teams.revokeZone')}
                      disabled={command.isPending}
                      onPress={() =>
                        command.mutate(() =>
                          client.revokeTeamZone(
                            token,
                            scope.siteId,
                            scope.contractorId,
                            teamId,
                            p.id,
                          ),
                        )
                      }
                    />
                  )}
                </Card>
              ))}
              <Button
                secondary
                label={current ? tr('teams.updateZone') : tr('teams.grantZone')}
                onPress={() => {
                  setPermission('');
                  setFrom('');
                  setTo('');
                  command.reset();
                  setManaging(true);
                }}
              />
              <ErrorNotice error={command.error} />
              {managing && (
                <RequestSheet
                  visible
                  variant="form"
                  title={current ? tr('teams.updateZone') : tr('teams.grantZone')}
                  subtitle={scope.contractorName}
                  icon={<IconUsers size={23} color={colors.primary} />}
                  busy={command.isPending}
                  onClose={() => setManaging(false)}
                  footer={
                    <View style={teamStyles.form}>
                      <ErrorNotice error={command.error} />
                      <Button
                        label={current ? tr('teams.updateZone') : tr('teams.grantZone')}
                        disabled={command.isPending || !permission || !from || !to}
                        onPress={() =>
                          command.mutate(async () => {
                            validDates(from, to);
                            const input = {
                              contractorZonePermissionId: permission,
                              startDate: from,
                              endDate: to,
                              timezone,
                            };
                            const commandInput = {
                              ...input,
                              requestId: requestId([current?.id, input]),
                            };
                            if (current)
                              await client.updateTeamZone(
                                token,
                                scope.siteId,
                                scope.contractorId,
                                teamId,
                                current.id,
                                commandInput,
                              );
                            else
                              await client.grantTeamZone(
                                token,
                                scope.siteId,
                                scope.contractorId,
                                teamId,
                                commandInput,
                              );
                            setManaging(false);
                          })
                        }
                      />
                    </View>
                  }
                >
                  <FormSection number="01" title={tr('teams.zones')}>
                    <View
                      pointerEvents={command.isPending ? 'none' : 'auto'}
                      style={teamStyles.form}
                    >
                      <Choice
                        label={tr('teams.contractorZone')}
                        value={permission}
                        options={data.availableZones.map((p) => ({
                          value: p.permissionId,
                          label: p.name,
                        }))}
                        onChange={(v) => {
                          setPermission(v);
                          const p = data.availableZones.find((vv) => vv.permissionId === v);
                          if (p) {
                            setFrom(localDate(new Date(p.validFrom), timezone));
                            setTo(localDate(new Date(Date.parse(p.validUntil) - 1), timezone));
                          }
                        }}
                      />
                      <CalendarDateField
                        label={tr('teams.validFromLabel')}
                        value={from}
                        onChange={setFrom}
                        disabled={command.isPending}
                      />
                      <CalendarDateField
                        label={tr('teams.validUntilLabel')}
                        value={to}
                        onChange={setTo}
                        disabled={command.isPending}
                      />
                      <Hint>
                        {tr('teams.timezone')} {timezone}
                        {tr('teams.zoneValidityHint')}
                      </Hint>
                    </View>
                  </FormSection>
                </RequestSheet>
              )}
            </>
          );
        }}
      </QueryState>
    </FormSection>
  );
}

const teamStyles = StyleSheet.create({
  caption: { fontSize: 12, lineHeight: 20, color: colors.textMuted },
  form: { gap: 12 },
  badge: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
    backgroundColor: colors.surfaceSubtle,
    padding: 8,
    borderRadius: 8,
    overflow: 'hidden',
  },
  memberRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  memberInitial: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberLetter: { fontSize: 13, fontWeight: '600', color: colors.primaryHover },
  memberName: { flex: 1, fontSize: 14, lineHeight: 22, color: colors.textPrimary },
  teamCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  teamHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  teamIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFF4EE',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  teamInfoCol: {
    flex: 1,
    gap: 2,
    minWidth: 100,
    flexBasis: 120,
  },
  teamNameText: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '700',
    color: '#0F1E36',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
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
  memberCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberCountText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
});
