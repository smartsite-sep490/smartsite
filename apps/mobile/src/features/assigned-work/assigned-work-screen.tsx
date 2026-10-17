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
    <Page title="Công việc được giao" onBack={onBack}>
      <Choice
        label="Loại công việc"
        value={kind}
        onChange={(v) => {
          setKind(v);
          setOffset(0);
        }}
        options={[
          { value: 'checklist', label: 'Phiếu kiểm tra an toàn' },
          { value: 'incident', label: 'Khắc phục được giao' },
        ]}
      />
      {kind === 'checklist' ? (
        <QueryState query={checklists}>
          {(data) => (
            <>
              {!data.items.length && <Hint>Chưa có phiếu được giao.</Hint>}
              {data.items
                .filter((c) => c.contractorId === scope.contractorId)
                .map((c) => (
                  <Card key={c.id}>
                    <Body>{c.description}</Body>
                    <Hint>
                      {c.teamName} · {c.zoneName} · {c.status}
                    </Hint>
                    <Hint>Hạn: {displayTime(c.endsAt)}</Hint>
                    <Button secondary label="Mở phiếu kiểm tra" onPress={() => setId(c.id)} />
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
              {!data.items.length && <Hint>Chưa có công việc khắc phục.</Hint>}
              {data.items
                .filter((i) => !i.contractorId || i.contractorId === scope.contractorId)
                .map((i) => (
                  <Card key={i.id}>
                    <Body>{i.title}</Body>
                    <Hint>
                      {i.status} · {i.severity}
                    </Hint>
                    <Button secondary label="Mở công việc khắc phục" onPress={() => setId(i.id)} />
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
    <Page title="Phiếu kiểm tra được giao" onBack={onBack}>
      <ErrorNotice error={command.error} />
      <QueryState query={detail}>
        {(data) =>
          data.contractorId !== scope.contractorId ? (
            <Hint>Phiếu thuộc phạm vi nhà thầu khác. Chọn đúng nhà thầu trước khi thao tác.</Hint>
          ) : (
            <>
              <Card>
                <Body>{data.description}</Body>
                <Hint>
                  {data.teamName} · {data.zoneName} · {data.status}
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
                <Body>Lịch sử nộp / trả kết quả</Body>
                {!data.submissions.length && <Hint>Chưa có báo cáo.</Hint>}
                {data.submissions.map((s) => (
                  <Card key={s.id}>
                    <Body>
                      {s.status} · {s.submittedByName ?? 'Người thực hiện'}
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
                            label={`Sự cố: ${r.linkedIncident.title}`}
                            onPress={() => onIncident(r.linkedIncident!.id)}
                          />
                        )}
                      </Card>
                    ))}
                  </Card>
                ))}
              </Card>
              <Card>
                <Body>Lịch sử thao tác</Body>
                {data.audit.map((a) => (
                  <Hint key={a.id}>
                    {a.actorName ?? 'Người thực hiện'} · {a.action} · {displayTime(a.occurredAt)}
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
        {completed}/{detail.items.length} tiêu chí
      </Body>
      {detail.items.map((item) => (
        <Card key={item.id}>
          <Body>{item.text}</Body>
          <Hint>{item.evidenceRequired ? 'Cần bằng chứng khi đạt.' : ''}</Hint>
          <Choice
            label="Kết quả kiểm tra"
            value={answers[item.id] ?? ''}
            options={[
              { value: 'PASS', label: 'Đạt' },
              { value: 'FAIL', label: 'Không đạt' },
              { value: 'NOT_APPLICABLE', label: 'Không áp dụng' },
            ]}
            onChange={(value) => setAnswers({ ...answers, [item.id]: value as ChecklistAnswer })}
          />
          <Field
            label="Ghi chú tiêu chí"
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
              if (!answer) throw new Error('Hoàn thành tất cả tiêu chí.');
              const note = notes[item.id]?.trim() ?? '';
              if ((answer === 'FAIL' || answer === 'NOT_APPLICABLE') && !note)
                throw new Error('Ghi chú bắt buộc khi không đạt hoặc không áp dụng.');
              const selected = filesByItem[item.id] ?? [];
              if (item.evidenceRequired && answer === 'PASS' && !selected.length)
                throw new Error('Tiêu chí đạt cần đính kèm bằng chứng theo yêu cầu.');
              const fileIndexes = selected.map((file) => {
                const index = files.length;
                files.push(file);
                return index;
              });
              return { itemId: item.id, answer, note, fileIndexes };
            });
            if (files.reduce((total, f) => total + new File(f.uri).size, 0) > 20 * 1024 * 1024)
              throw new Error('Tổng dung lượng bằng chứng tối đa 20 MB.');
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
  const { scope, client, token, user, queryKey } = useWorkspace();
  const query = useQuery({
    queryKey: [...queryKey, 'incident', id],
    queryFn: () => client.getIncident(token, scope.siteId, id),
  });
  return (
    <Page title="Khắc phục được giao" onBack={onBack}>
      <QueryState query={query}>
        {(data) =>
          data.contractorId && data.contractorId !== scope.contractorId ? (
            <Hint>Công việc thuộc nhà thầu khác. Chọn đúng phạm vi.</Hint>
          ) : (
            <>
              <Card>
                <Body>{data.title}</Body>
                <Body>{data.description}</Body>
                <Hint>
                  {data.status} · {data.severity} · {data.zoneName ?? ''}
                </Hint>
                {data.sourceChecklist && (
                  <Hint>
                    Nguồn phiếu: {data.sourceChecklist.description} ·{' '}
                    {data.sourceChecklist.itemText} · {data.sourceChecklist.note}
                  </Hint>
                )}
                {data.alerts.map((a) => (
                  <Hint key={a.id}>
                    Cảnh báo liên kết: {a.alertType} · {a.status}
                  </Hint>
                ))}
              </Card>
              {data.actions
                .filter((a) => a.assignedTo === user.id)
                .map((a) => (
                  <ActionForm key={`${a.id}:${a.version}`} action={a} incidentId={id} />
                ))}
              <Card>
                <Body>Lịch sử xử lý</Body>
                {data.audit.map((a) => (
                  <Hint key={a.id}>
                    {a.actorName ?? 'Người thực hiện'} · {a.action} · {displayTime(a.occurredAt)} ·{' '}
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
  const { scope, client, token } = useWorkspace();
  const [result, setResult] = useState(''),
    [files, setFiles] = useState<NativeUploadFile[]>([]);
  const command = useCommand(),
    requestId = useRequestId();
  return (
    <Card>
      <Body>{action.description}</Body>
      <Hint>
        {action.status} · Hạn: {displayTime(action.dueAt)}
      </Hint>
      {action.supersededAt ? (
        <Hint>Đã chuyển giao: {action.supersededReason}</Hint>
      ) : (
        <>
          {action.status === 'ASSIGNED' && (
            <Button
              label="Bắt đầu khắc phục"
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
              <Field label="Kết quả khắc phục" multiline value={result} onChangeText={setResult} />
              <Attachments files={files} onChange={setFiles} jpegOnly maxFiles={1} />
              <Button
                label="Nộp kết quả cho cán bộ an toàn"
                disabled={command.isPending || !result.trim()}
                onPress={() =>
                  command.mutate(() => {
                    const input = {
                      expectedVersion: action.version,
                      resultDescription: required(result, 'kết quả'),
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
            {s.status} · {displayTime(s.submittedAt)} · {s.reviewNote ?? ''}
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
