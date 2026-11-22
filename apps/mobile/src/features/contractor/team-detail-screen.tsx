import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ApiError, type ContractorTeamWorkerResponse } from '@smartsite/api-client';
import {
  IconPencil,
  IconShield,
  IconSwap,
  IconTrash,
  IconUser,
  IconUsers,
} from '../../components/common/Icons';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { allPages, required, useCommand, useRequestId } from '../shared/data';
import { Button, Choice, ErrorNotice, Field, Hint, Page, QueryState } from '../shared/ui';
import {
  ManagementAction,
  ManagementBadge,
  ManagementLink,
  ManagementSection,
  ManagementTabs,
} from '../shared/management-ui';
import { RequestSheet } from '../shared/request-sheet';
import { useWorkspace } from '../workspace/workspace-context';
import { EmptyState } from './contractor-presentation';
import { TeamZonePanel } from './team-zone-panel';

type Member = ContractorTeamWorkerResponse;
type ActionKind =
  | 'TEAM'
  | 'MEMBER'
  | 'ADD'
  | 'TRANSFER'
  | 'REMOVE'
  | 'LEADER'
  | 'CLEAR_LEADER'
  | 'EDIT'
  | 'ARCHIVE';
type Action = { kind: ActionKind; member?: Member; version: number };

export function TeamDetailScreen({
  teamId,
  standalone = false,
  onBack,
}: {
  teamId: string;
  standalone?: boolean;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [tab, setTab] = useState('MEMBERS');
  const [search, setSearch] = useState('');
  const [pickerSearch, setPickerSearch] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [targetTeam, setTargetTeam] = useState('');
  const [reason, setReason] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [notice, setNotice] = useState('');
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
        (page) => client.listContractorTeamWorkers(token, scope.siteId, scope.contractorId, page),
        signal,
      ),
  });
  const teams = useQuery({
    queryKey: [...queryKey, 'all-active-teams'],
    enabled: action?.kind === 'TRANSFER',
    queryFn: ({ signal }) =>
      allPages(
        (page) =>
          client.listContractorTeams(token, scope.siteId, scope.contractorId, {
            ...page,
            status: 'ACTIVE',
          }),
        signal,
      ),
  });
  const members = (workers.data ?? []).filter((member) => member.teamId === teamId);
  const busy = command.isPending;
  const error =
    command.error instanceof ApiError && command.error.status === 404
      ? new Error(t('teamUi.serverUpdateRequired'))
      : command.error;

  return (
    <Page
      title={standalone ? t('teams.details') : undefined}
      onBack={standalone ? onBack : undefined}
    >
      <QueryState query={detail}>
        {(team) => {
          const blocked = detail.isError || workers.isError || busy || !team.isActive;
          const leader = members.find((member) => member.workerId === team.leaderWorkerId);
          const begin = (kind: ActionKind, member?: Member) => {
            command.reset();
            setNotice('');
            setAction({ kind, member, version: team.version });
            setSelectedId(member?.workerId ?? '');
            setPickerSearch('');
            setTargetTeam('');
            setReason('');
            setName(team.name);
            setDescription(team.description);
          };
          const candidates =
            action?.kind === 'ADD'
              ? (workers.data ?? []).filter((member) => !member.membershipId && !member.teamId)
              : members;
          const title =
            action?.kind === 'MEMBER'
              ? (action.member?.displayName ?? team.name)
              : t(`teamUi.action${action?.kind ?? 'TEAM'}`);
          const confirmable = action && !['TEAM', 'MEMBER'].includes(action.kind);
          const canSave =
            !blocked &&
            !!action &&
            (action.kind === 'ADD'
              ? candidates.some((member) => member.workerId === selectedId) && !!workers.data
              : action.kind === 'LEADER'
                ? members.some((member) => member.workerId === selectedId) &&
                  selectedId !== team.leaderWorkerId &&
                  !!workers.data
                : action.kind === 'TRANSFER'
                  ? !!targetTeam && !!teams.data && !teams.isError && reason.trim().length >= 5
                  : action.kind === 'REMOVE'
                    ? reason.trim().length >= 5
                    : action.kind === 'CLEAR_LEADER'
                      ? !!team.leaderWorkerId
                      : action.kind === 'EDIT'
                        ? !!name.trim()
                        : action.kind === 'ARCHIVE'
                          ? team.memberCount === 0 && reason.trim().length >= 5
                          : false);
          const submit = () => {
            if (!action || !canSave || busy) return;
            command.mutate(async () => {
              if (action.kind === 'LEADER' || action.kind === 'CLEAR_LEADER')
                await client.setContractorTeamLeader(
                  token,
                  scope.siteId,
                  scope.contractorId,
                  team.id,
                  {
                    expectedVersion: action.version,
                    workerId: action.kind === 'LEADER' ? selectedId : null,
                  },
                );
              else if (action.kind === 'EDIT')
                await client.updateContractorTeam(
                  token,
                  scope.siteId,
                  scope.contractorId,
                  team.id,
                  {
                    expectedVersion: action.version,
                    name: required(name, t('validation.teamNameLabel')),
                    description: description.trim(),
                  },
                );
              else if (action.kind === 'ARCHIVE') {
                await client.archiveContractorTeam(
                  token,
                  scope.siteId,
                  scope.contractorId,
                  team.id,
                  { expectedVersion: action.version, reason: reason.trim() },
                );
                setAction(null);
                onBack();
                return;
              } else {
                const member =
                  action.kind === 'ADD'
                    ? candidates.find((item) => item.workerId === selectedId)
                    : action.member;
                if (!member) throw new Error(t('validation.chooseWorker'));
                const input = {
                  teamId:
                    action.kind === 'REMOVE'
                      ? null
                      : action.kind === 'TRANSFER'
                        ? targetTeam
                        : team.id,
                  expectedMembershipId: member.membershipId,
                  ...(action.kind !== 'ADD' ? { reason: reason.trim() } : {}),
                };
                await client.assignContractorTeam(
                  token,
                  scope.siteId,
                  scope.contractorId,
                  member.workerId,
                  { ...input, requestId: requestId([member.workerId, input]) },
                );
              }
              setAction(null);
              setNotice(t('teamUi.saved'));
            });
          };
          return (
            <>
              <View style={styles.hero}>
                <View style={styles.heading}>
                  <View style={styles.teamIcon}>
                    <IconUsers size={23} color={colors.primary} />
                  </View>
                  <View style={styles.copy}>
                    <Text accessibilityRole="header" style={styles.teamName}>
                      {team.name}
                    </Text>
                    <Text style={styles.meta}>{scope.contractorName}</Text>
                  </View>
                  {team.isActive && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('teamUi.teamActions')}
                      onPress={() => begin('TEAM')}
                      disabled={blocked}
                      style={styles.more}
                    >
                      <Text style={styles.moreText}>···</Text>
                    </Pressable>
                  )}
                </View>
                <View style={styles.summary}>
                  <ManagementBadge
                    label={t(team.isActive ? 'teams.active' : 'teams.archived')}
                    tone={team.isActive ? 'success' : 'neutral'}
                  />
                  <Text style={styles.meta}>
                    {t('teamUi.memberCount', { count: team.memberCount })}
                  </Text>
                </View>
                {!!team.description && <Text style={styles.description}>{team.description}</Text>}
              </View>
              <View style={styles.leaderCard}>
                <View style={styles.sectionHeading}>
                  <Text style={styles.eyebrow}>{t('rollCall.leader')}</Text>
                  {team.isActive && (
                    <ManagementLink
                      label={t(
                        team.leaderWorkerId ? 'teamUi.changeLeader' : 'teamUi.appointLeader',
                      )}
                      disabled={blocked || !workers.data}
                      onPress={() => begin('LEADER')}
                    />
                  )}
                </View>
                <View style={styles.heading}>
                  <View style={styles.leaderAvatar}>
                    <IconShield size={19} color={colors.primary} />
                  </View>
                  <View style={styles.copy}>
                    <Text style={styles.leaderName}>
                      {leader?.displayName ??
                        t(
                          team.leaderWorkerId
                            ? workers.isPending
                              ? 'common.loading'
                              : 'rollCall.leaderUnavailable'
                            : 'rollCall.noLeader',
                        )}
                    </Text>
                    <Text style={styles.meta}>
                      {t(team.leaderWorkerId ? 'teamUi.leaderRoleHint' : 'teamUi.noLeaderHint')}
                    </Text>
                  </View>
                </View>
              </View>
              {notice && (
                <Text accessibilityLiveRegion="polite" style={styles.notice}>
                  {notice}
                </Text>
              )}
              <ManagementTabs
                value={tab}
                onChange={setTab}
                items={[
                  { value: 'MEMBERS', label: t('teamUi.membersTab'), count: team.memberCount },
                  { value: 'ZONE', label: t('teamUi.zoneTab') },
                ]}
              />
              {tab === 'MEMBERS' && (
                <ManagementSection
                  title={t('teams.currentMembers')}
                  action={
                    team.isActive ? (
                      <ManagementLink
                        label={t('teamUi.addMember')}
                        onPress={() => begin('ADD')}
                        disabled={blocked}
                      />
                    ) : undefined
                  }
                >
                  <QueryState query={workers}>
                    {() => (
                      <>
                        {members.length > 5 && (
                          <Field
                            label={t('teamUi.searchMembers')}
                            value={search}
                            onChangeText={setSearch}
                          />
                        )}
                        {!members.length && (
                          <EmptyState
                            icon={<IconUsers size={25} color={colors.textMuted} />}
                            title={t('teams.noMembers')}
                            hint={t('teamUi.emptyMembersHint')}
                          />
                        )}
                        {members.length > 0 && (
                          <View style={styles.list}>
                            {members
                              .filter((member) =>
                                member.displayName
                                  .toLocaleLowerCase()
                                  .includes(search.trim().toLocaleLowerCase()),
                              )
                              .map((member) => (
                                <View key={member.workerId} style={styles.memberRow}>
                                  <View
                                    style={[
                                      styles.avatar,
                                      member.workerId === team.leaderWorkerId &&
                                        styles.avatarLeader,
                                    ]}
                                  >
                                    <Text style={styles.initial}>
                                      {member.displayName.slice(0, 1).toLocaleUpperCase()}
                                    </Text>
                                  </View>
                                  <View style={styles.copy}>
                                    <Text style={styles.memberName}>{member.displayName}</Text>
                                    <Text style={styles.meta}>
                                      {t(
                                        member.workerId === team.leaderWorkerId
                                          ? 'rollCall.leader'
                                          : 'teamUi.memberRole',
                                      )}
                                    </Text>
                                  </View>
                                  {team.isActive && (
                                    <Pressable
                                      accessibilityRole="button"
                                      accessibilityLabel={t('teamUi.memberActions', {
                                        name: member.displayName,
                                      })}
                                      disabled={blocked}
                                      onPress={() => begin('MEMBER', member)}
                                      style={styles.more}
                                    >
                                      <Text style={styles.moreText}>···</Text>
                                    </Pressable>
                                  )}
                                </View>
                              ))}
                          </View>
                        )}
                        {!!members.length &&
                          !members.some((member) =>
                            member.displayName
                              .toLocaleLowerCase()
                              .includes(search.trim().toLocaleLowerCase()),
                          ) && <Hint>{t('teamUi.noSearchResults')}</Hint>}
                      </>
                    )}
                  </QueryState>
                </ManagementSection>
              )}
              {tab === 'ZONE' && (
                <TeamZonePanel teamId={team.id} teamName={team.name} editable={team.isActive} />
              )}

              {action && (
                <RequestSheet
                  visible
                  variant="compact"
                  title={title}
                  subtitle={
                    action.kind === 'MEMBER' ? team.name : (action.member?.displayName ?? team.name)
                  }
                  busy={busy}
                  onClose={() => setAction(null)}
                  footer={
                    confirmable ? (
                      <View style={styles.footer}>
                        <ErrorNotice error={error} />
                        <Button
                          label={t(`teamUi.confirm${action.kind}`)}
                          disabled={!canSave}
                          onPress={submit}
                        />
                      </View>
                    ) : null
                  }
                >
                  {action.kind === 'TEAM' && (
                    <>
                      <ManagementAction
                        label={t('teams.editNameDescription')}
                        icon={<IconPencil size={19} color={colors.textSecondary} />}
                        onPress={() => begin('EDIT')}
                      />
                      <ManagementAction
                        label={t('contractorUi.archiveTeam')}
                        danger
                        icon={<IconTrash size={19} color={colors.danger} />}
                        onPress={() => begin('ARCHIVE')}
                      />
                    </>
                  )}
                  {action.kind === 'MEMBER' && action.member && (
                    <>
                      <ManagementAction
                        label={t(
                          action.member.workerId === team.leaderWorkerId
                            ? 'teamUi.clearLeader'
                            : 'teamUi.appointLeader',
                        )}
                        icon={<IconShield size={19} color={colors.primary} />}
                        onPress={() =>
                          begin(
                            action.member!.workerId === team.leaderWorkerId
                              ? 'CLEAR_LEADER'
                              : 'LEADER',
                            action.member,
                          )
                        }
                      />
                      <ManagementAction
                        label={t('teamUi.transferMember')}
                        icon={<IconSwap size={19} color={colors.textSecondary} />}
                        onPress={() => begin('TRANSFER', action.member)}
                      />
                      <ManagementAction
                        label={t('teamUi.removeMember')}
                        danger
                        icon={<IconTrash size={19} color={colors.danger} />}
                        onPress={() => begin('REMOVE', action.member)}
                      />
                    </>
                  )}
                  {(action.kind === 'ADD' || (action.kind === 'LEADER' && !action.member)) && (
                    <QueryState query={workers}>
                      {() => (
                        <>
                          <Hint>
                            {t(action.kind === 'ADD' ? 'teamUi.addHint' : 'rollCall.leaderHint')}
                          </Hint>
                          {candidates.length > 5 && (
                            <Field
                              label={t('teamUi.searchWorkers')}
                              value={pickerSearch}
                              onChangeText={setPickerSearch}
                              editable={!busy}
                            />
                          )}
                          {!candidates.length && (
                            <EmptyState
                              title={t(
                                action.kind === 'ADD' ? 'teamUi.noUnassigned' : 'teams.noMembers',
                              )}
                            />
                          )}
                          <View style={styles.list}>
                            {candidates
                              .filter((member) =>
                                member.displayName
                                  .toLocaleLowerCase()
                                  .includes(pickerSearch.trim().toLocaleLowerCase()),
                              )
                              .map((member) => (
                                <Pressable
                                  key={member.workerId}
                                  accessibilityRole="radio"
                                  accessibilityLabel={member.displayName}
                                  accessibilityState={{
                                    checked: selectedId === member.workerId,
                                    disabled: busy,
                                  }}
                                  disabled={busy}
                                  onPress={() => setSelectedId(member.workerId)}
                                  style={[
                                    styles.memberRow,
                                    selectedId === member.workerId && styles.selected,
                                  ]}
                                >
                                  <View style={styles.avatar}>
                                    <IconUser size={17} color={colors.textMuted} />
                                  </View>
                                  <Text style={[styles.memberName, styles.copy]}>
                                    {member.displayName}
                                  </Text>
                                  <View
                                    style={[
                                      styles.radio,
                                      selectedId === member.workerId && styles.radioSelected,
                                    ]}
                                  />
                                </Pressable>
                              ))}
                          </View>
                        </>
                      )}
                    </QueryState>
                  )}
                  {action.kind === 'LEADER' && action.member && (
                    <Hint>{t('teamUi.appointConfirm', { name: action.member.displayName })}</Hint>
                  )}
                  {action.kind === 'CLEAR_LEADER' && <Hint>{t('teamUi.clearLeaderHint')}</Hint>}
                  {action.kind === 'TRANSFER' && (
                    <>
                      <Hint>{t('teamUi.transferHint')}</Hint>
                      <QueryState query={teams}>
                        {(rows) => (
                          <Choice
                            label={t('teams.targetTeam')}
                            value={targetTeam}
                            disabled={busy}
                            options={rows
                              .filter((row) => row.id !== teamId)
                              .map((row) => ({ value: row.id, label: row.name }))}
                            onChange={setTargetTeam}
                          />
                        )}
                      </QueryState>
                    </>
                  )}
                  {action.kind === 'REMOVE' && (
                    <Hint>
                      {t('teamUi.removeConfirm', { name: action.member?.displayName ?? '' })}
                    </Hint>
                  )}
                  {action.kind === 'EDIT' && (
                    <>
                      <Field
                        label={t('teams.teamName')}
                        value={name}
                        maxLength={160}
                        editable={!busy}
                        onChangeText={setName}
                      />
                      <Field
                        label={t('common.description')}
                        value={description}
                        maxLength={1000}
                        editable={!busy}
                        onChangeText={setDescription}
                        multiline
                      />
                    </>
                  )}
                  {action.kind === 'ARCHIVE' && <Hint>{t('teams.archiveHint')}</Hint>}
                  {['TRANSFER', 'REMOVE', 'ARCHIVE'].includes(action.kind) && (
                    <Field
                      label={t('teams.membershipReason')}
                      value={reason}
                      maxLength={1000}
                      editable={!busy}
                      onChangeText={setReason}
                      placeholder={t('teamUi.reasonHint')}
                    />
                  )}
                </RequestSheet>
              )}
            </>
          );
        }}
      </QueryState>
    </Page>
  );
}
const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 16,
    gap: 14,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  teamIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamName: { fontSize: 19, lineHeight: 27, color: colors.textPrimary, fontWeight: '800' },
  meta: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
  summary: { flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  description: { fontSize: 13, lineHeight: 21, color: colors.textSecondary },
  more: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
  },
  moreText: {
    color: colors.textSecondary,
    fontSize: 23,
    lineHeight: 24,
    letterSpacing: 1,
    fontWeight: '700',
  },
  leaderCard: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 4,
    backgroundColor: '#FFFAF6',
    borderWidth: 1,
    borderColor: '#F4E7DA',
    gap: 4,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 44,
  },
  eyebrow: { fontSize: 11, lineHeight: 18, fontWeight: '700', color: '#AA6334' },
  leaderAvatar: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: '#FBEBDD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderName: { fontSize: 15, lineHeight: 22, fontWeight: '700', color: colors.textPrimary },
  notice: { fontSize: 12, lineHeight: 19, color: colors.successText },
  list: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  memberRow: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    minHeight: 72,
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#EDF1F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLeader: { backgroundColor: '#FFF0E2' },
  initial: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  memberName: { fontSize: 14, lineHeight: 21, fontWeight: '600', color: colors.textPrimary },
  selected: { backgroundColor: '#FFF7F1' },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.border },
  radioSelected: { borderWidth: 5, borderColor: colors.primary },
  footer: { gap: 10 },
});
