import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { AccountResponse } from '@smartsite/api-client';
import { useManagementClient } from '../../features/auth/auth-session';
import { IncidentView } from '../safety/IncidentView';
import { SafetyChecklistsView } from '../safety/SafetyChecklistsView';

export function AssignedWorkView({
  apiUrl,
  token,
  user,
}: {
  apiUrl: string;
  token: string;
  user: AccountResponse;
}) {
  const { t } = useTranslation();
  const client = useManagementClient(apiUrl);
  const [params, setParams] = useSearchParams();
  const [choice, setChoice] = useState(params.get('siteId') ?? '');
  const sites = useQuery({
    queryKey: ['assigned-work-sites', apiUrl, user.id],
    queryFn: () => client.listSites(token, { limit: 100 }),
  });
  const allowed =
    sites.data?.items.filter((site) =>
      user.roleAssignments.some(
        (r) => r.role === 'CONTRACTOR_REPRESENTATIVE' && r.siteId === site.id,
      ),
    ) ?? [];
  const siteId = allowed.some((s) => s.id === choice) ? choice : (allowed[0]?.id ?? '');
  const checklist = params.get('tab') === 'checklists';
  const navigate = (tab: string, id?: string) => {
    setParams({
      siteId,
      tab,
      ...(id ? { [tab === 'checklists' ? 'checklistId' : 'incidentId']: id } : {}),
    });
  };
  if (sites.isPending) return <p role="status">{t('common.loading_sites_c334d0')}</p>;
  if (sites.isError)
    return (
      <p role="alert">
        {t('auth.loadAccountError')}{' '}
        <button onClick={() => sites.refetch()}>{t('accounts.retry')}</button>
      </p>
    );
  if (!siteId) return <p>{t('common.no_site_assigned')}</p>;
  const workflow = { client, apiUrl, token, user, siteId, scope: user.id };
  return (
    <section className="space-y-5">
      <h1 className="text-xl font-bold">{t('shell.assignedWork')}</h1>
      <label className="block min-w-0 text-sm">
        {t('common.site')}{' '}
        <select
          className="mt-1 block w-full min-w-0 max-w-full rounded-lg border border-slate-200 bg-white p-2"
          value={siteId}
          onChange={(e) => {
            setChoice(e.target.value);
            setParams({ siteId: e.target.value });
          }}
        >
          {allowed.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <nav className="flex flex-wrap gap-4">
        <button aria-pressed={!checklist} onClick={() => navigate('incidents')}>
          {t('shell.assignedActions')}
        </button>
        <button aria-pressed={checklist} onClick={() => navigate('checklists')}>
          {t('shell.assignedChecklists')}
        </button>
      </nav>
      {checklist ? (
        <SafetyChecklistsView
          key={siteId}
          {...workflow}
          active
          initialChecklistId={params.get('checklistId') ?? undefined}
          onDraftConsumed={() => {}}
          onIncident={(id) => navigate('incidents', id)}
        />
      ) : (
        <IncidentView
          key={siteId}
          {...workflow}
          initialIncidentId={params.get('incidentId') ?? undefined}
          initialActionId={params.get('actionId') ?? undefined}
          onOpenChecklist={(id) => navigate('checklists', id)}
        />
      )}
    </section>
  );
}
