import { localizedLabel } from '../../i18n/messages';
import { translate as tr } from '../../i18n';
import { useState } from 'react';
import { File } from 'expo-file-system';
import { useQuery } from '@tanstack/react-query';
import type {
  ChecklistDetailResponse,
  ChecklistAnswer,
  ChecklistResultInput,
  NativeUploadFile,
  CorrectiveActionResponse,
} from '@smartsite/api-client';
import { useWorkspace } from '../workspace/workspace-context';
import { allPages, displayTime, required, useCommand, useRequestId } from '../shared/data';
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
import { Attachments, EvidenceButton } from '../shared/uploads';
import { useTranslation } from '../../i18n';

export function AssignedWorkScreen({
  initialId,
  initialKind,
  onBack,
}: {
  initialId?: string;
  initialKind?: string;
  onBack: () => void;
}) {
  useTranslation();
  const { scope, client, token, user, queryKey } = useWorkspace();
  const [kind, setKind] = useState(initialKind === 'incident' ? 'incident' : 'checklist'),
    [id, setId] = useState(initialId ?? ''),
    [offset, setOffset] = useState(0);
  const checklists = useQuery({
    queryKey: [...queryKey, 'assigned-checklists', offset],
    queryFn: async ({ signal }) => {
      const rows = (
        await allPages(
          (p) => client.listSafetyChecklists(token, scope.siteId, { assignedTo: user.id, ...p }),
          signal,
        )
      ).filter((c) => c.contractorId === scope.contractorId);
      return { items: rows.slice(offset, offset + 20), total: rows.length };
    },
    enabled: kind === 'checklist' && !id,
  });
  const incidents = useQuery({
    queryKey: [...queryKey, 'assigned-incidents', offset],
    queryFn: async ({ signal }) => {
      const rows = (
        await allPages(
          (p) => client.listIncidents(token, scope.siteId, { assignedTo: user.id, ...p }),
          signal,
        )
      ).filter((i) => !i.contractorId || i.contractorId === scope.contractorId);
      return { items: rows.slice(offset, offset + 20), total: rows.length };
    },
    enabled: kind === 'incident' && !id,
  });
  if (id)
    return kind === 'checklist' ? (
      <ChecklistDetail
        id={id}
        onBack={() => setId('')}
        onIncident={(value) => {
          setKind('incident');
          setId(value);
        }}
      />
    ) : (
      <IncidentDetail id={id} onBack={() => setId('')} />
    );
  return (
    <Page title={tr('assignedWork.title')} onBack={onBack}>
      <Choice
        label={tr('assignedWork.workType')}
        value={kind}
        onChange={(v) => {
          setKind(v);
          setOffset(0);
        }}
        options={[
          { value: 'checklist', label: tr('assignedWork.checklist') },
          { value: 'incident', label: tr('assignedWork.correctiveAction') },
        ]}
      />
      {kind === 'checklist' ? (
        <QueryState query={checklists}>
          {(data) => (
            <>
              {!data.items.length && <Hint>{tr('assignedWork.noChecklists')}</Hint>}
              {data.items
                .filter((c) => c.contractorId === scope.contractorId)
                .map((c) => (
                  <Card key={c.id}>
                    <Body>{c.description}</Body>
                    <Hint>
                      {c.teamName} · {c.zoneName} · {localizedLabel(c.status)}
                    </Hint>
                    <Hint>
                      {tr('common.deadline')} {displayTime(c.endsAt)}
                    </Hint>
                    <Button
                      secondary
                      label={tr('assignedWork.openChecklist')}
                      onPress={() => setId(c.id)}
                    />
                  </Card>
                ))}
              <Pager offset={offset} total={data.total} onChange={setOffset} />
            </>
          )}
        </QueryState>
      ) : (
        <QueryState query={incidents}>
          {(data) => (
            <>
              {!data.items.length && <Hint>{tr('assignedWork.noActions')}</Hint>}
              {data.items
                .filter((i) => !i.contractorId || i.contractorId === scope.contractorId)
                .map((i) => (
                  <Card key={i.id}>
                    <Body>{i.title}</Body>
                    <Hint>
                      {localizedLabel(i.status)} · {localizedLabel(i.severity)}
                    </Hint>
                    <Button
                      secondary
                      label={tr('assignedWork.openAction')}
                      onPress={() => setId(i.id)}
                    />
                  </Card>
                ))}
              <Pager offset={offset} total={data.total} onChange={setOffset} />
            </>
          )}
        </QueryState>
      )}
    </Page>
  );
}
function ChecklistDetail({
  id,
  onBack,
  onIncident,
}: {
  id: string;
  onBack: () => void;
  onIncident: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { scope, client, token, user, queryKey } = useWorkspace();
  const command = useCommand(),
    requestId = useRequestId();
  const detail = useQuery({
    queryKey: [...queryKey, 'checklist', id],
    queryFn: () => client.getSafetyChecklist(token, scope.siteId, id),
  });
  return (
    <Page title={tr('assignedWork.assignedChecklist')} onBack={onBack}>
      <ErrorNotice error={command.error} />
      <QueryState query={detail}>
        {(data) =>
          data.contractorId !== scope.contractorId ? (
            <Hint>{tr('assignedWork.checklistScopeHint')}</Hint>
          ) : (
            <>
              <Card>
                <Body>{data.description}</Body>
                <Hint>
                  {data.teamName} · {data.zoneName} · {localizedLabel(data.status)}
                </Hint>
                <Hint>
                  {displayTime(data.startsAt)} → {displayTime(data.endsAt)}
                </Hint>
                {data.assignedTo === user.id && data.status === 'ASSIGNED' && (
                  <Button
                    label={t('assignedWork.startChecklist')}
                    disabled={command.isPending}
                    onPress={() =>
                      command.mutate(() => {
                        const input = { expectedVersion: data.version };
                        return client.checklistCommand(token, scope.siteId, data.id, 'start', {
                          ...input,
                          commandId: requestId(input),
                        });
                      })
                    }
                  />
                )}
              </Card>
              {data.assignedTo === user.id && data.status === 'IN_PROGRESS' && (
                <ChecklistForm key={`${data.id}:${data.version}`} detail={data} />
              )}
              <Card>
                <Body>{tr('assignedWork.submissionHistory')}</Body>
                {!data.submissions.length && <Hint>{tr('assignedWork.noReports')}</Hint>}
                {data.submissions.map((s) => (
                  <Card key={s.id}>
                    <Body>
                      {localizedLabel(s.status)} · {s.submittedByName ?? tr('common.actor')}
                    </Body>
                    <Hint>
                      {displayTime(s.submittedAt)} · {s.reviewNote ?? ''}
                    </Hint>
                    {s.results.map((r) => (
                      <Card key={r.id}>
                        <Body>{data.items.find((i) => i.id === r.itemId)?.text}</Body>
                        <Hint>
                          {r.answer} · {r.note}
                        </Hint>
                        {r.evidence.map((e) => (
                          <EvidenceButton
                            key={e.id}
                            mediaType={e.mediaType}
                            load={() => client.getChecklistEvidence(token, scope.siteId, id, e.id)}
                          />
                        ))}
                        {r.linkedIncident && (
                          <Button
                            secondary
                            label={tr('assignedWork.incident', { id: r.linkedIncident.title })}
                            onPress={() => onIncident(r.linkedIncident!.id)}
                          />
                        )}
                      </Card>
                    ))}
                  </Card>
                ))}
              </Card>
              <Card>
                <Body>{tr('assignedWork.actionHistory')}</Body>
                {data.audit.map((a) => (
                  <Hint key={a.id}>
                    {a.actorName ?? tr('common.actor')} · {a.action} · {displayTime(a.occurredAt)}
                    {a.reason ? ` · ${a.reason}` : ''}
                  </Hint>
                ))}
              </Card>
            </>
          )
        }
      </QueryState>
    </Page>
  );
}
function ChecklistForm({ detail }: { detail: ChecklistDetailResponse }) {
  const { t } = useTranslation();
  const { client, token, scope } = useWorkspace();
  const [answers, setAnswers] = useState<Record<string, ChecklistAnswer>>({}),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [filesByItem, setFiles] = useState<Record<string, NativeUploadFile[]>>({});
  const command = useCommand(),
    requestId = useRequestId();
  const completed = detail.items.filter((i) => !!answers[i.id]).length;
  return (
    <Card>
      <Body>
        {completed}/{detail.items.length} {tr('assignedWork.criteriaUnit')}
      </Body>
      {detail.items.map((item) => (
        <Card key={item.id}>
          <Body>{item.text}</Body>
          <Hint>{item.evidenceRequired ? tr('assignedWork.passEvidenceHint') : ''}</Hint>
          <Choice
            label={tr('assignedWork.checkResult')}
            value={answers[item.id] ?? ''}
            options={[
              { value: 'PASS', label: tr('assignedWork.pass') },
              { value: 'FAIL', label: tr('assignedWork.fail') },
              { value: 'NOT_APPLICABLE', label: tr('assignedWork.notApplicable') },
            ]}
            onChange={(value) => setAnswers({ ...answers, [item.id]: value as ChecklistAnswer })}
          />
          <Field
            label={tr('assignedWork.criterionNote')}
            value={notes[item.id] ?? ''}
            onChangeText={(value) => setNotes({ ...notes, [item.id]: value })}
            multiline
          />
          <Attachments
            files={filesByItem[item.id] ?? []}
            onChange={(files) => setFiles({ ...filesByItem, [item.id]: files })}
          />
        </Card>
      ))}
      <ErrorNotice error={command.error} />
      <Button
        label={t('assignedWork.submitChecklist')}
        disabled={command.isPending || completed !== detail.items.length}
        onPress={() =>
          command.mutate(async () => {
            const files: NativeUploadFile[] = [];
            const results: ChecklistResultInput[] = detail.items.map((item) => {
              const answer = answers[item.id];
              if (!answer) throw new Error(tr('validation.completeCriteria'));
              const note = notes[item.id]?.trim() ?? '';
              if ((answer === 'FAIL' || answer === 'NOT_APPLICABLE') && !note)
                throw new Error(tr('validation.criterionNoteRequired'));
              const selected = filesByItem[item.id] ?? [];
              if (item.evidenceRequired && answer === 'PASS' && !selected.length)
                throw new Error(tr('validation.criterionEvidenceRequired'));
              const fileIndexes = selected.map((file) => {
                const index = files.length;
                files.push(file);
                return index;
              });
              return { itemId: item.id, answer, note, fileIndexes };
            });
            if (files.reduce((total, f) => total + new File(f.uri).size, 0) > 20 * 1024 * 1024)
              throw new Error(tr('validation.evidenceTotal'));
            const input = { expectedVersion: detail.version, results };
            await client.submitSafetyChecklist(
              token,
              scope.siteId,
              detail.id,
              { ...input, commandId: requestId([input, files]) },
              files,
            );
          })
        }
      />
    </Card>
  );
}
function IncidentDetail({ id, onBack }: { id: string; onBack: () => void }) {
  useTranslation();
  const { scope, client, token, user, queryKey } = useWorkspace();
  const query = useQuery({
    queryKey: [...queryKey, 'incident', id],
    queryFn: () => client.getIncident(token, scope.siteId, id),
  });
  return (
    <Page title={tr('assignedWork.correctiveAction')} onBack={onBack}>
      <QueryState query={query}>
        {(data) =>
          data.contractorId && data.contractorId !== scope.contractorId ? (
            <Hint>{tr('assignedWork.actionScopeHint')}</Hint>
          ) : (
            <>
              <Card>
                <Body>{data.title}</Body>
                <Body>{data.description}</Body>
                <Hint>
                  {localizedLabel(data.status)} · {localizedLabel(data.severity)} ·{' '}
                  {data.zoneName ?? ''}
                </Hint>
                {data.sourceChecklist && (
                  <Hint>
                    {tr('assignedWork.sourceChecklist')} {data.sourceChecklist.description} ·{' '}
                    {data.sourceChecklist.itemText} · {data.sourceChecklist.note}
                  </Hint>
                )}
                {data.alerts.map((a) => (
                  <Hint key={a.id}>
                    {tr('assignedWork.linkedAlert')} {localizedLabel(a.alertType)} ·{' '}
                    {localizedLabel(a.status)}
                  </Hint>
                ))}
              </Card>
              {data.actions
                .filter((a) => a.assignedTo === user.id)
                .map((a) => (
                  <ActionForm key={`${a.id}:${a.version}`} action={a} incidentId={id} />
                ))}
              <Card>
                <Body>{tr('assignedWork.reviewHistory')}</Body>
                {data.audit.map((a) => (
                  <Hint key={a.id}>
                    {a.actorName ?? tr('common.actor')} · {a.action} · {displayTime(a.occurredAt)} ·{' '}
                    {a.reason ?? ''}
                  </Hint>
                ))}
              </Card>
            </>
          )
        }
      </QueryState>
    </Page>
  );
}
function ActionForm({
  action,
  incidentId,
}: {
  action: CorrectiveActionResponse;
  incidentId: string;
}) {
  useTranslation();
  const { scope, client, token } = useWorkspace();
  const [result, setResult] = useState(''),
    [files, setFiles] = useState<NativeUploadFile[]>([]);
  const command = useCommand(),
    requestId = useRequestId();
  return (
    <Card>
      <Body>{action.description}</Body>
      <Hint>
        {localizedLabel(action.status)} {tr('assignedWork.deadlineSuffix')}{' '}
        {displayTime(action.dueAt)}
      </Hint>
      {action.supersededAt ? (
        <Hint>
          {tr('assignedWork.handedOver')} {action.supersededReason}
        </Hint>
      ) : (
        <>
          {action.status === 'ASSIGNED' && (
            <Button
              label={tr('assignedWork.startAction')}
              disabled={command.isPending}
              onPress={() =>
                command.mutate(() => {
                  const input = { expectedVersion: action.version };
                  return client.incidentCommand(
                    token,
                    scope.siteId,
                    incidentId,
                    'start',
                    { ...input, commandId: requestId(['start', action.id, input]) },
                    action.id,
                  );
                })
              }
            />
          )}
          {action.status === 'IN_PROGRESS' && (
            <>
              <Field
                label={tr('assignedWork.actionResult')}
                multiline
                value={result}
                onChangeText={setResult}
              />
              <Attachments files={files} onChange={setFiles} jpegOnly maxFiles={1} />
              <Button
                label={tr('assignedWork.submitToSafety')}
                disabled={command.isPending || !result.trim()}
                onPress={() =>
                  command.mutate(() => {
                    const input = {
                      expectedVersion: action.version,
                      resultDescription: required(result, tr('validation.resultLabel')),
                    };
                    return client.incidentCommand(
                      token,
                      scope.siteId,
                      incidentId,
                      'submit',
                      { ...input, commandId: requestId([action.id, input, files]) },
                      action.id,
                      files[0],
                    );
                  })
                }
              />
            </>
          )}
        </>
      )}
      <ErrorNotice error={command.error} />
      {action.submissions.map((s) => (
        <Card key={s.id}>
          <Body>{s.resultDescription}</Body>
          <Hint>
            {localizedLabel(s.status)} · {displayTime(s.submittedAt)} · {s.reviewNote ?? ''}
          </Hint>
          {s.evidence && (
            <EvidenceButton
              mediaType={s.evidence.mediaType}
              load={() =>
                client.getWorkflowEvidence(
                  token,
                  scope.siteId,
                  'incidents',
                  incidentId,
                  s.evidence!.id,
                )
              }
            />
          )}
        </Card>
      ))}
    </Card>
  );
}
