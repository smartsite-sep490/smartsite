import { useQuery } from '@tanstack/react-query';
import { Text } from 'react-native';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { useWorkspace } from '../workspace/workspace-context';
import { Page, QueryState } from '../shared/ui';
import { AccessOverview, WorkerZoneOverview } from './access-overview';

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
  const access = useQuery({
    queryKey: [...queryKey, 'access-setup'],
    queryFn: () => client.accessSetup(token, scope.siteId),
    enabled: scope.role === 'contractor',
  });
  if (scope.role === 'worker')
    return (
      <Page title={t('access.myZones')} onBack={onBack}>
        <QueryState query={team}>{(data) => <WorkerZoneOverview data={data} />}</QueryState>
      </Page>
    );
  return (
    <Page title={embedded ? undefined : t('access.title')} onBack={embedded ? undefined : onBack}>
      <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 20 }}>
        {scope.contractorName} · {scope.siteName}
      </Text>
      <QueryState query={access}>
        {(data) => {
          const participations = new Set(
            data.participations
              .filter((item) => item.contractorId === scope.contractorId)
              .map((item) => item.id),
          );
          return (
            <AccessOverview
              data={{
                ...data,
                contractorPermissions: data.contractorPermissions.filter((permission) =>
                  participations.has(permission.siteContractorId),
                ),
              }}
            />
          );
        }}
      </QueryState>
    </Page>
  );
}
