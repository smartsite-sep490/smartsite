import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
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
} from '../shared/ui';
import { useTranslation } from '../../i18n';
import { IconUsers } from '../../components/common/Icons';
import { colors } from '../../theme/colors';

export function TeamsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED' | 'ALL'>('ACTIVE'),
    [offset, setOffset] = useState(0),
    [team, setTeam] = useState<ContractorTeamResponse | null>(null),
    [creating, setCreating] = useState(false);

  const query = useQuery({
    queryKey: [...queryKey, 'teams', search, status, offset],
    queryFn: () =>
      client.listContractorTeams(token, scope.siteId, scope.contractorId, {
        search,
        status,
        offset,
        limit: 20,
      }),
  });

  if (team) return <TeamDetail key={team.id} teamId={team.id} onBack={() => setTeam(null)} />;

  return (
    <Page title={t('teams.title')} onBack={onBack}>
      <Button label={t('teams.createTeam')} onPress={() => setCreating(true)} />

      <Field
        label={t('teams.searchTeam')}
        value={search}
        onChangeText={(v) => {
          setSearch(v);
          setOffset(0);
        }}
      />
      <Choice
        label={t('teams.status')}
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
            {!data.items.length && <Hint>Không có nhóm phù hợp.</Hint>}
            {data.items.map((teamItem) => (
              <View key={teamItem.id} style={teamStyles.teamCard}>
                <View style={teamStyles.teamHeaderRow}>
                  <View style={teamStyles.teamIconBox}>
                    <IconUsers size={22} color={colors.primary} />
                  </View>
                  <View style={teamStyles.teamInfoCol}>
                    <Text style={teamStyles.teamNameText}>{teamItem.name}</Text>
                    {teamItem.description ? (
                      <Text style={teamStyles.teamDescText} numberOfLines={2}>
                        {teamItem.description}
                      </Text>
                    ) : null}
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
                    👥 {teamItem.memberCount} thành viên
                  </Text>
                </View>

                <Button
                  secondary
                  label="Thành viên & khu vực của nhóm"
                  onPress={() => setTeam(teamItem)}
                />
              </View>
            ))}
            <Pager offset={offset} total={data.total} onChange={setOffset} />
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={teamStyles.modalOverlay}
      >
        <Pressable style={teamStyles.modalBackdrop} onPress={onClose} />
        <View style={teamStyles.modalSheet}>
          <View style={teamStyles.modalDragHandle} />
          <Text style={teamStyles.modalTitle}>{t('teams.createTeam')}</Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Field label={t('teams.newTeamName')} value={name} onChangeText={setName} />
            <Field
              label={t('teams.newTeamDesc')}
              value={description}
              onChangeText={setDescription}
              multiline
            />
            <ErrorNotice error={command.error} />

            <View style={{ marginTop: 16 }}>
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
              <Button secondary label={t('common.cancel')} onPress={onClose} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
function TeamDetail({ teamId, onBack }: { teamId: string; onBack: () => void }) {
  const { scope, client, token, queryKey } = useWorkspace();
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
    <Page title="Chi tiết nhóm" onBack={onBack}>
      <ErrorNotice error={command.error} />
      <QueryState query={detail}>
        {(t) => (
          <>
            <Card>
              <Body>
                {t.name} · {t.isActive ? 'Hoạt động' : 'Lưu trữ'} · {t.memberCount} thành viên
              </Body>
              <Hint>{t.description}</Hint>
              {t.isActive && (
                <>
                  <Button
                    secondary
                    label={edit ? 'Đóng chỉnh sửa' : 'Đổi tên / mô tả'}
                    onPress={() => {
                      setName(t.name);
                      setDescription(t.description);
                      setEdit(!edit);
                    }}
                  />
                  {edit && (
                    <>
                      <Field label="Tên nhóm" value={name} onChangeText={setName} />
                      <Field
                        label="Mô tả"
                        value={description}
                        onChangeText={setDescription}
                        multiline
                      />
                      <Button
                        label="Lưu thay đổi nhóm"
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
                                name: required(name, 'tên nhóm'),
                                description,
                              },
                            );
                            setEdit(false);
                          })
                        }
                      />
                    </>
                  )}
                  <Field
                    label="Lý do chuyển / gỡ thành viên / lưu trữ"
                    value={reason}
                    onChangeText={setReason}
                  />
                  <Button
                    secondary
                    label="Lưu trữ nhóm trống"
                    disabled={command.isPending || t.memberCount > 0 || !reason.trim()}
                    onPress={() =>
                      command.mutate(async () => {
                        await client.archiveContractorTeam(
                          token,
                          scope.siteId,
                          scope.contractorId,
                          t.id,
                          { expectedVersion: t.version, reason: required(reason, 'lý do') },
                        );
                        onBack();
                      })
                    }
                  />
                </>
              )}
            </Card>
            <QueryState query={workers}>
              {(members) => (
                <Card>
                  <Body>Thành viên hiện tại</Body>
                  {members
                    .filter((w) => w.teamId === teamId)
                    .map((w) => (
                      <Body key={w.workerId}>{w.displayName}</Body>
                    ))}
                  {!members.some((w) => w.teamId === teamId) && (
                    <Hint>Nhóm chưa có thành viên.</Hint>
                  )}
                  {t.isActive && (
                    <>
                      <Choice
                        label="Công nhân cần thêm / chuyển / gỡ"
                        value={workerId}
                        onChange={setWorkerId}
                        options={members.map((w) => ({
                          value: w.workerId,
                          label: `${w.displayName} · ${w.teamName ?? 'Chưa có nhóm'}`,
                        }))}
                      />
                      <QueryState query={teams}>
                        {(list) => (
                          <Choice
                            label="Nhóm đích"
                            value={targetTeam}
                            onChange={setTargetTeam}
                            options={[
                              { value: '', label: 'Gỡ khỏi nhóm hiện tại' },
                              ...list.map((v) => ({ value: v.id, label: v.name })),
                            ]}
                          />
                        )}
                      </QueryState>
                      <Button
                        label="Xác nhận thành viên"
                        disabled={
                          command.isPending ||
                          !worker ||
                          targetTeam === worker.teamId ||
                          (!targetTeam && !worker.membershipId)
                        }
                        onPress={() =>
                          command.mutate(async () => {
                            if (!worker) throw new Error('Chọn công nhân.');
                            if (worker.membershipId) required(reason, 'lý do chuyển hoặc gỡ nhóm');
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
                          })
                        }
                      />
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
  const { scope, client, token, queryKey } = useWorkspace();
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
    <Card>
      <Body>Khu vực của nhóm</Body>
      <QueryState query={query}>
        {(data) => {
          const current = data.permissions.find((p) => !p.revokedAt);
          return (
            <>
              {data.permissions.map((p) => (
                <Card key={p.id}>
                  <Body>
                    {p.name} ·{' '}
                    {p.revokedAt ? 'Đã thu hồi' : p.effective ? 'Hiệu lực' : 'Ngoài thời hạn'}
                  </Body>
                  <Hint>
                    {displayTime(p.validFrom)} → {displayTime(p.validUntil)}
                  </Hint>
                  {!p.revokedAt && (
                    <Button
                      secondary
                      label="Thu hồi quyền khu vực nhóm"
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
              <Choice
                label="Khu vực nhà thầu đã được cấp"
                value={permission}
                options={data.availableZones.map((p) => ({ value: p.permissionId, label: p.name }))}
                onChange={(v) => {
                  setPermission(v);
                  const p = data.availableZones.find((vv) => vv.permissionId === v);
                  if (p) {
                    setFrom(localDate(new Date(p.validFrom), timezone));
                    setTo(localDate(new Date(Date.parse(p.validUntil) - 1), timezone));
                  }
                }}
              />
              <Field label="Từ ngày (YYYY-MM-DD)" value={from} onChangeText={setFrom} />
              <Field label="Đến hết ngày (YYYY-MM-DD)" value={to} onChangeText={setTo} />
              <Hint>Múi giờ: {timezone}. Thời hạn phải nằm trong quyền nhà thầu đã được cấp.</Hint>
              <ErrorNotice error={command.error} />
              <Button
                label={current ? 'Cập nhật khu vực nhóm' : 'Cấp khu vực nhóm'}
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
                    const commandInput = { ...input, requestId: requestId([current?.id, input]) };
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
                  })
                }
              />
            </>
          );
        }}
      </QueryState>
    </Card>
  );
}

const teamStyles = StyleSheet.create({
  teamCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#EFF2F6',
    gap: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  teamHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  teamIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFF4EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamInfoCol: {
    flex: 1,
    gap: 2,
  },
  teamNameText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F1E36',
  },
  teamDescText: {
    fontSize: 12,
    color: '#64748B',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
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
  memberCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberCountText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    paddingTop: 12,
    maxHeight: '85%',
  },
  modalDragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F1E36',
    marginBottom: 14,
  },
});
