import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useManagementClient } from '../../features/auth/auth-session';
import { translate as tr } from '../../i18n';
import { userErrorMessage } from '../../i18n/messages';
import { Button, Dialog } from '../ui';
import { loadAllPages } from '../workforce/load-all-pages';
import { teamText } from './team-attendance-copy';

export function TeamLeaderDialog({
  apiUrl,
  token,
  sessionScope,
  siteId,
  contractorId,
  teamId,
  teamName,
  onClose,
}: {
  apiUrl: string;
  token: string;
  sessionScope: string;
  siteId: string;
  contractorId: string;
  teamId: string;
  teamName: string;
  onClose: () => void;
}) {
  useTranslation();
  const client = useManagementClient(apiUrl),
    cache = useQueryClient(),
    selectId = useId();
  const key = ['team-leader', apiUrl, sessionScope, siteId, contractorId, teamId];
  const data = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const [team, members] = await Promise.all([
        client.contractorTeamDetail(token, siteId, contractorId, teamId),
        loadAllPages(
          (page) =>
            client.listContractorTeamWorkers(token, siteId, contractorId, { ...page, teamId }),
          signal,
        ),
      ]);
      return { team, members: members.items.filter((m) => m.teamId === teamId && m.membershipId) };
    },
    refetchInterval: 15000,
    retry: false,
  });
  const [draft, setDraft] = useState<{ workerId: string | null; expectedVersion: number } | null>(
    null,
  );
  const mutation = useMutation({
    mutationFn: (input: NonNullable<typeof draft>) =>
      client.setContractorTeamLeader(token, siteId, contractorId, teamId, input),
    onSuccess: async () => {
      setDraft(null);
      await Promise.all([
        cache.invalidateQueries({ queryKey: key }),
        cache.invalidateQueries({
          queryKey: ['contractor-teams', apiUrl, sessionScope, siteId, contractorId],
        }),
        cache.invalidateQueries({
          queryKey: ['contractor-teams-active-all', apiUrl, sessionScope, siteId, contractorId],
        }),
        cache.invalidateQueries({ queryKey: ['my-contractor-team', apiUrl, sessionScope, siteId] }),
        cache.invalidateQueries({
          queryKey: ['team-zone-attendance', apiUrl, sessionScope, siteId],
        }),
      ]);
    },
  });
  const value = data.data;
  const changed = !!draft && draft.expectedVersion !== value?.team.version;
  const known = value?.team.leaderWorkerId !== undefined;
  const selected = draft ? draft.workerId : value?.team.leaderWorkerId;
  const currentName = value?.members.find(
    (m) => m.workerId === value.team.leaderWorkerId,
  )?.displayName;
  const valid =
    !!draft &&
    !!value &&
    known &&
    value.team.isActive &&
    !changed &&
    !data.isError &&
    !data.isFetching &&
    (draft.workerId === null || value.members.some((m) => m.workerId === draft.workerId)) &&
    draft.workerId !== value.team.leaderWorkerId;
  return (
    <Dialog
      open
      title={`${teamText('teamWeb.manageLeader')} · ${teamName}`}
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
    >
      <p className="text-sm text-slate-600">{teamText('teamWeb.leaderHint')}</p>
      {data.isPending ? (
        <p role="status">{tr('common.loading')}</p>
      ) : data.isError ? (
        <p role="alert" className="text-sm text-rose-700">
          {userErrorMessage(data.error)}
        </p>
      ) : (
        value && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (valid && draft && !mutation.isPending) mutation.mutate(draft);
            }}
          >
            <p className="rounded-xl bg-slate-50 p-3 text-sm">
              {!known
                ? teamText('teamWeb.unavailableLeader')
                : value.team.leaderWorkerId
                  ? teamText('teamWeb.currentLeader', {
                      name: currentName ?? teamText('teamWeb.unavailableLeader'),
                    })
                  : teamText('teamWeb.noLeader')}
            </p>
            {!value.members.length && <p>{teamText('teamWeb.noMembers')}</p>}
            <label htmlFor={selectId} className="block text-sm font-semibold">
              {teamText('teamWeb.selectLeader')}
            </label>
            <select
              id={selectId}
              className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm focus-visible:outline-2 focus-visible:outline-orange-600"
              disabled={!known || !value.team.isActive || mutation.isPending}
              value={selected ?? ''}
              onChange={(event) => {
                mutation.reset();
                setDraft({
                  workerId: event.target.value || null,
                  expectedVersion: value.team.version,
                });
              }}
            >
              <option value="">{teamText('teamWeb.removeLeader')}</option>
              {value.team.leaderWorkerId && !currentName && (
                <option value={value.team.leaderWorkerId} disabled>
                  {teamText('teamWeb.unavailableLeader')}
                </option>
              )}
              {value.members.map((member) => (
                <option key={member.workerId} value={member.workerId}>
                  {member.displayName}
                </option>
              ))}
            </select>
            {changed && (
              <p role="alert" className="text-sm text-amber-800">
                {teamText('teamWeb.changed')}
              </p>
            )}
            {mutation.isError && (
              <p role="alert" className="text-sm text-rose-700">
                {userErrorMessage(mutation.error)}
              </p>
            )}
            {mutation.isSuccess && (
              <p role="status" className="text-sm text-emerald-700">
                {teamText('teamWeb.leaderSaved')}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => {
                  setDraft(null);
                  mutation.reset();
                  void data.refetch();
                }}
              >
                {teamText('teamWeb.refresh')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!valid}
                isLoading={mutation.isPending}
              >
                {teamText('teamWeb.saveLeader')}
              </Button>
            </div>
          </form>
        )
      )}
      {data.isError && (
        <Button variant="outline" onClick={() => void data.refetch()}>
          {tr('common.retry')}
        </Button>
      )}
    </Dialog>
  );
}
