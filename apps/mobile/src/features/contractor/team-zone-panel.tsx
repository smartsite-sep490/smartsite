import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { IconMapPin } from '../../components/common/Icons';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { localDate, useCommand, useRequestId, validDates } from '../shared/data';
import { Button, Choice, ErrorNotice, Hint, QueryState } from '../shared/ui';
import { CalendarDateField } from '../shared/calendar-date-field';
import { RequestSheet } from '../shared/request-sheet';
import {
  ManagementBadge,
  ManagementLink,
  ManagementPeriod,
  ManagementSection,
} from '../shared/management-ui';
import { useWorkspace } from '../workspace/workspace-context';
import { EmptyState } from './contractor-presentation';

type ZoneAction =
  | { kind: 'EDIT'; currentId?: string }
  | { kind: 'DETAIL' | 'REVOKE'; id: string }
  | { kind: 'HISTORY' };

export function TeamZonePanel({
  teamId,
  teamName,
  editable,
}: {
  teamId: string;
  teamName: string;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const { client, token, scope, queryKey } = useWorkspace();
  const [action, setAction] = useState<ZoneAction | null>(null);
  const [permissionId, setPermission] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [notice, setNotice] = useState('');
  const command = useCommand(),
    requestId = useRequestId();
  const query = useQuery({
    queryKey: [...queryKey, 'team-zones', teamId],
    queryFn: () => client.teamZoneSetup(token, scope.siteId, scope.contractorId, teamId),
  });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <QueryState query={query}>
      {(data) => {
        const current = data.permissions.find((permission) => !permission.revokedAt);
        const selected =
          action && 'id' in action
            ? data.permissions.find((permission) => permission.id === action.id)
            : undefined;
        const beginEdit = () => {
          command.reset();
          setNotice('');
          setAction({ kind: 'EDIT', currentId: current?.id });
          setPermission(current?.contractorZonePermissionId ?? '');
          setFrom(current ? localDate(new Date(current.validFrom), timezone) : '');
          setTo(current ? localDate(new Date(Date.parse(current.validUntil) - 1), timezone) : '');
        };
        const badge = (permission: (typeof data.permissions)[number]) => (
          <ManagementBadge
            label={t(
              permission.revokedAt
                ? 'access.revoked'
                : permission.effective
                  ? 'teams.effective'
                  : 'teams.outsideValidity',
            )}
            tone={permission.revokedAt ? 'neutral' : permission.effective ? 'success' : 'warning'}
          />
        );
        return (
          <ManagementSection
            title={t('teamUi.assignedZone')}
            action={
              editable && !current ? (
                <ManagementLink
                  label={t('teams.grantZone')}
                  onPress={beginEdit}
                  disabled={query.isError}
                />
              ) : undefined
            }
          >
            {!current && (
              <EmptyState
                icon={<IconMapPin size={27} color={colors.textMuted} />}
                title={t('access.noZones')}
                hint={t('teamUi.zoneEmptyHint')}
              />
            )}
            {current && (
              <View style={styles.card}>
                <View style={styles.heading}>
                  <View style={styles.icon}>
                    <IconMapPin size={21} color={colors.primary} />
                  </View>
                  <View style={styles.copy}>
                    <Text style={styles.name}>{current.name}</Text>
                    {badge(current)}
                  </View>
                </View>
                <ManagementPeriod from={current.validFrom} to={current.validUntil} />
                <View style={styles.actions}>
                  <ManagementLink
                    label={t('schedule.details')}
                    onPress={() => {
                      command.reset();
                      setAction({ kind: 'DETAIL', id: current.id });
                    }}
                  />
                  {editable && (
                    <ManagementLink
                      label={t('teams.updateZone')}
                      onPress={beginEdit}
                      disabled={query.isError}
                    />
                  )}
                </View>
              </View>
            )}
            {notice && (
              <Text accessibilityLiveRegion="polite" style={styles.notice}>
                {notice}
              </Text>
            )}
            {data.permissions.some((permission) => !!permission.revokedAt) && (
              <ManagementLink
                label={t('teamUi.zoneHistory')}
                onPress={() => setAction({ kind: 'HISTORY' })}
              />
            )}
            {action && (
              <RequestSheet
                visible
                variant="compact"
                title={t(
                  action.kind === 'EDIT'
                    ? action.currentId
                      ? 'teams.updateZone'
                      : 'teams.grantZone'
                    : action.kind === 'REVOKE'
                      ? 'teams.revokeZone'
                      : action.kind === 'HISTORY'
                        ? 'teamUi.zoneHistory'
                        : 'teamUi.zoneDetails',
                )}
                subtitle={teamName}
                busy={command.isPending}
                onClose={() => setAction(null)}
                footer={
                  <View style={styles.footer}>
                    <ErrorNotice error={command.error} />
                    {action.kind === 'EDIT' && (
                      <Button
                        label={t(action.currentId ? 'teams.updateZone' : 'teams.grantZone')}
                        disabled={
                          command.isPending || query.isError || !permissionId || !from || !to
                        }
                        onPress={() =>
                          command.mutate(async () => {
                            validDates(from, to);
                            const input = {
                              contractorZonePermissionId: permissionId,
                              startDate: from,
                              endDate: to,
                              timezone,
                            };
                            const body = {
                              ...input,
                              requestId: requestId([action.currentId, input]),
                            };
                            if (action.currentId)
                              await client.updateTeamZone(
                                token,
                                scope.siteId,
                                scope.contractorId,
                                teamId,
                                action.currentId,
                                body,
                              );
                            else
                              await client.grantTeamZone(
                                token,
                                scope.siteId,
                                scope.contractorId,
                                teamId,
                                body,
                              );
                            setAction(null);
                            setNotice(t('teamUi.zoneSaved'));
                          })
                        }
                      />
                    )}
                    {action.kind === 'DETAIL' && editable && selected && !selected.revokedAt && (
                      <Button
                        secondary
                        label={t('teams.revokeZone')}
                        disabled={query.isError}
                        onPress={() => {
                          command.reset();
                          setAction({ kind: 'REVOKE', id: selected.id });
                        }}
                      />
                    )}
                    {action.kind === 'REVOKE' && selected && editable && (
                      <Button
                        label={t('teamUi.confirmRevokeZone')}
                        disabled={command.isPending || query.isError || !!selected.revokedAt}
                        onPress={() =>
                          command.mutate(async () => {
                            await client.revokeTeamZone(
                              token,
                              scope.siteId,
                              scope.contractorId,
                              teamId,
                              selected.id,
                            );
                            setAction(null);
                            setNotice(t('teamUi.zoneRevoked'));
                          })
                        }
                      />
                    )}
                  </View>
                }
              >
                {action.kind === 'EDIT' && (
                  <>
                    {!data.availableZones.length && (
                      <Hint>{t('access.noContractorGrantHint')}</Hint>
                    )}
                    <Choice
                      label={t('teams.contractorZone')}
                      value={permissionId}
                      disabled={command.isPending}
                      options={data.availableZones.map((zone) => ({
                        value: zone.permissionId,
                        label: zone.name,
                      }))}
                      onChange={(value) => {
                        setPermission(value);
                        const zone = data.availableZones.find(
                          (item) => item.permissionId === value,
                        );
                        if (zone) {
                          setFrom(localDate(new Date(zone.validFrom), timezone));
                          setTo(localDate(new Date(Date.parse(zone.validUntil) - 1), timezone));
                        }
                      }}
                    />
                    <CalendarDateField
                      label={t('teams.validFromLabel')}
                      value={from}
                      onChange={setFrom}
                      disabled={command.isPending}
                    />
                    <CalendarDateField
                      label={t('teams.validUntilLabel')}
                      value={to}
                      onChange={setTo}
                      disabled={command.isPending}
                    />
                    <Text style={styles.meta}>
                      {t('teams.timezone')} {timezone}
                    </Text>
                  </>
                )}
                {selected && (
                  <>
                    <Text style={styles.name}>{selected.name}</Text>
                    {badge(selected)}
                    <ManagementPeriod from={selected.validFrom} to={selected.validUntil} />
                  </>
                )}
                {action.kind === 'REVOKE' && <Hint>{t('teamUi.revokeZoneHint')}</Hint>}
                {action.kind === 'HISTORY' &&
                  data.permissions
                    .filter((permission) => !!permission.revokedAt)
                    .map((permission) => (
                      <View key={permission.id} style={styles.history}>
                        <Text style={styles.name}>{permission.name}</Text>
                        {badge(permission)}
                        <ManagementPeriod from={permission.validFrom} to={permission.validUntil} />
                      </View>
                    ))}
              </RequestSheet>
            )}
          </ManagementSection>
        );
      }}
    </QueryState>
  );
}
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 16,
    gap: 16,
  },
  heading: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 6 },
  name: { fontSize: 15, lineHeight: 23, fontWeight: '700', color: colors.textPrimary },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  meta: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
  footer: { gap: 8 },
  notice: { color: colors.successText, fontSize: 12, lineHeight: 19 },
  history: { paddingBottom: 16, gap: 10, borderBottomWidth: 1, borderColor: colors.borderLight },
});
