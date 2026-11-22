import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import { IconChevronRight, IconMapPin } from '../../components/common/Icons';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { useWorkspace } from '../workspace/workspace-context';
import { Field, Hint } from '../shared/ui';
import {
  ManagementBadge,
  ManagementLink,
  ManagementPeriod,
  ManagementSection,
} from '../shared/management-ui';
import { RequestSheet } from '../shared/request-sheet';
import { EmptyState } from '../contractor/contractor-presentation';

type Setup = Awaited<ReturnType<SmartSiteManagementClient['accessSetup']>>;
type MyTeam = Awaited<ReturnType<SmartSiteManagementClient['myContractorTeam']>>;

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

export function AccessOverview({ data }: { data: Setup }) {
  const { t } = useTranslation();
  const { scope } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(20);
  const [referenceTime, setReferenceTime] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setReferenceTime(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const permissions = data.contractorPermissions.filter((permission) => !permission.revokedAt);
  const zoneName = (id: string) =>
    data.zones.find((zone) => zone.id === id)?.name ?? t('common.zone');
  const visible = permissions.filter((permission) =>
    zoneName(permission.zoneId).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const selected = permissions.find((permission) => permission.id === selectedId);
  const active = (permission: Setup['contractorPermissions'][number]) =>
    Date.parse(permission.validFrom) <= referenceTime &&
    (!permission.validUntil || Date.parse(permission.validUntil) > referenceTime);
  const badge = (permission: Setup['contractorPermissions'][number]) => (
    <ManagementBadge
      label={t(active(permission) ? 'access.effective' : 'access.notEffective')}
      tone={active(permission) ? 'success' : 'neutral'}
    />
  );
  return (
    <>
      <Text style={styles.hint}>{t('areaUi.zonesHint')}</Text>
      <ManagementSection title={t('access.contractorZones')}>
        {permissions.length > 5 && (
          <Field
            label={t('areaUi.searchZones')}
            value={search}
            onChangeText={(value) => {
              setSearch(value);
              setLimit(20);
            }}
          />
        )}
        {!permissions.length && (
          <EmptyState
            icon={<IconMapPin size={26} color={colors.textMuted} />}
            title={t('access.noZones')}
            hint={t('access.noContractorGrantHint')}
          />
        )}
        {visible.slice(0, limit).map((permission) => (
          <Pressable
            key={permission.id}
            accessibilityRole="button"
            accessibilityLabel={t('areaUi.openZone', { name: zoneName(permission.zoneId) })}
            onPress={() => setSelectedId(permission.id)}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          >
            <View style={styles.heading}>
              <View style={styles.icon}>
                <IconMapPin size={20} color={colors.primary} />
              </View>
              <Text style={styles.name}>{zoneName(permission.zoneId)}</Text>
              <IconChevronRight size={17} color={colors.textTertiary} />
            </View>
            {badge(permission)}
            <ManagementPeriod from={permission.validFrom} to={permission.validUntil} />
          </Pressable>
        ))}
        {!!search && !visible.length && <Hint>{t('teamUi.noSearchResults')}</Hint>}
        {visible.length > limit && (
          <ManagementLink label={t('areaUi.showMore')} onPress={() => setLimit(limit + 20)} />
        )}
      </ManagementSection>
      {selected && (
        <RequestSheet
          visible
          variant="compact"
          title={t('teamUi.zoneDetails')}
          subtitle={scope.contractorName}
          onClose={() => setSelectedId(null)}
          footer={null}
        >
          <Text style={styles.detailName}>{zoneName(selected.zoneId)}</Text>
          {badge(selected)}
          <ManagementPeriod from={selected.validFrom} to={selected.validUntil} />
          <Hint>{t('access.authorizationHint')}</Hint>
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
  hint: { fontSize: 12, lineHeight: 20, color: colors.textMuted },
  pressed: { opacity: 0.65 },
  detailName: { fontSize: 17, lineHeight: 25, fontWeight: '700', color: colors.textPrimary },
});
