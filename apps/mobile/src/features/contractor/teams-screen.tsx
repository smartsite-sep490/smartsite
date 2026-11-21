import { translate as tr } from '../../i18n';
import { useState } from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { ContractorTeamResponse } from '@smartsite/api-client';
import { useWorkspace } from '../workspace/workspace-context';
import { required, useCommand, useRequestId } from '../shared/data';
import { Button, ErrorNotice, Field, Page, Pager, QueryState } from '../shared/ui';
import { useTranslation } from '../../i18n';
import { IconChevronRight, IconUsers } from '../../components/common/Icons';
import { colors } from '../../theme/colors';
import { RequestSheet } from '../shared/request-sheet';
import { TeamDetailScreen } from './team-detail-screen';
import { ManagementLink, ManagementTabs } from '../shared/management-ui';
import { EmptyState, ListHeading } from './contractor-presentation';

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
      <TeamDetailScreen
        key={team.id}
        teamId={team.id}
        standalone={!onSelectTeam}
        onBack={() => setTeam(null)}
      />
    );

  return (
    <Page>
      <View style={teamStyles.listToolbar}>
        <View style={{ flex: 1 }}>
          <Text style={teamStyles.scopeTitle}>{scope.contractorName}</Text>
          <Text style={teamStyles.caption}>{scope.siteName}</Text>
        </View>
        <ManagementLink label={t('teams.createTeam')} onPress={() => setCreating(true)} />
      </View>

      <Field
        label={t('teams.searchTeam')}
        placeholder={t('teamUi.searchPlaceholder')}
        value={search}
        onChangeText={(v) => {
          setSearch(v);
          setOffset(0);
        }}
      />
      <ManagementTabs
        value={status}
        items={[
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
              <Pressable
                key={teamItem.id}
                accessibilityRole="button"
                accessibilityLabel={t('teamUi.openTeam', { name: teamItem.name })}
                onPress={() => setTeam(teamItem)}
                style={({ pressed }) => [teamStyles.teamCard, pressed && { opacity: 0.65 }]}
              >
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
                    {t('teamUi.memberCount', { count: teamItem.memberCount })}
                  </Text>
                </View>

                <View style={teamStyles.listFooter}>
                  <Text style={[teamStyles.caption, { flex: 1 }]}>
                    {teamItem.zoneAssignments?.find((zone) => !zone.revokedAt)?.name ??
                      t('teamUi.noZoneAssigned')}
                  </Text>
                  <IconChevronRight size={17} color={colors.textTertiary} />
                </View>
              </Pressable>
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
      variant="compact"
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
      <View style={teamStyles.form}>
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
      </View>
    </RequestSheet>
  );
}

const teamStyles = StyleSheet.create({
  listToolbar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  scopeTitle: { fontSize: 14, lineHeight: 22, color: colors.textPrimary, fontWeight: '600' },
  listFooter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
