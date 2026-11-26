import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useId } from 'react';
import type { AccountResponse } from '@smartsite/api-client';
import { useManagementClient } from '../../features/auth/auth-session';
import { IncidentView } from '../safety/IncidentView';
import { SafetyChecklistsView } from '../safety/SafetyChecklistsView';
import { WorksitePicker } from '../shared/WorksitePicker';

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
  const tabsId = useId();
  const choice = params.get('siteId') ?? '';
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
  if (params.get('siteId') && !allowed.some((site) => site.id === params.get('siteId')))
    return <p role="alert">{t('safetyUi.siteUnavailable')}</p>;
  if (!siteId) return <p>{t('common.no_site_assigned')}</p>;
  const workflow = { client, apiUrl, token, user, siteId, scope: user.id };
  return (
    <section className="assigned-work-workspace">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t('shell.assignedWork')}</h1>
        <WorksitePicker
          id="assigned-work-site-select"
          value={siteId}
          sites={allowed}
          onChange={(siteId) => setParams({ siteId })}
        />
      </header>
      <div
        role="tablist"
        aria-label={t('shell.assignedWork')}
        className="assigned-work-tabs"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : checklist ? 0 : 1;
          if (next !== Number(checklist)) navigate(next ? 'checklists' : 'incidents');
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}
      >
        <button
          type="button"
          role="tab"
          id={tabsId + '-incidents'}
          aria-controls={tabsId + '-panel'}
          aria-selected={!checklist}
          tabIndex={checklist ? -1 : 0}
          onClick={() => {
            if (checklist) navigate('incidents');
          }}
        >
          {t('shell.assignedActions')}
        </button>
        <button
          type="button"
          role="tab"
          id={tabsId + '-checklists'}
          aria-controls={tabsId + '-panel'}
          aria-selected={checklist}
          tabIndex={checklist ? 0 : -1}
          onClick={() => {
            if (!checklist) navigate('checklists');
          }}
        >
          {t('workflowUi.checklistsTab')}
        </button>
      </div>
      <div
        role="tabpanel"
        id={tabsId + '-panel'}
        aria-labelledby={tabsId + (checklist ? '-checklists' : '-incidents')}
        className="assigned-work-panel"
      >
        {checklist ? (
          <SafetyChecklistsView
            key={siteId}
            {...workflow}
            active
            embedded
            initialChecklistId={params.get('checklistId') ?? undefined}
            onDraftConsumed={() => {}}
            onIncident={(id) => navigate('incidents', id)}
          />
        ) : (
          <IncidentView
            key={siteId}
            {...workflow}
            embedded
            initialIncidentId={params.get('incidentId') ?? undefined}
            initialActionId={params.get('actionId') ?? undefined}
            onSelect={(id) => navigate('incidents', id)}
            onOpenChecklist={(id) => navigate('checklists', id)}
          />
        )}
      </div>
    </section>
  );
}
