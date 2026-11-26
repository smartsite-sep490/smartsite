import { localizedLabel } from '../../i18n/messages';
import { translate as tr } from '../../i18n';
import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
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
  Choice,
  ErrorNotice,
  Field,
  Hint,
  Page,
  Pager,
  QueryState,
  Disclosure,
} from '../shared/ui';
import { ManagementLink, ManagementTabs } from '../shared/management-ui';
import { EmptyState } from '../contractor/contractor-presentation';
import { IconChevronRight, IconDocument, IconShield } from '../../components/common/Icons';
import { colors } from '../../theme/colors';
import { WorkMeta, WorkStatus, WorkSummary, workStyles } from './assigned-work-ui';
import { Attachments, EvidenceButton } from '../shared/uploads';
import { useTranslation } from '../../i18n';
import { ScreenHeader } from '../../components/common/ScreenHeader';

export function AssignedWorkScreen({
  initialId,
  initialKind,
  initialActionId,
  onBack,
  onScopeChange,
}: {
  initialId?: string;
  initialKind?: string;
  initialActionId?: string;
  onBack: () => void;
  onScopeChange?: () => void;
}) {
  useTranslation();
  const { scope, client, token, user, queryKey } = useWorkspace();
  const [kind, setKind] = useState(initialKind === 'incident' ? 'incident' : 'checklist'),
    [id, setId] = useState(initialId ?? ''),
    [offset, setOffset] = useState(0);
  const targetKey = [initialKind, initialId, initialActionId].join(':');
  const [previousTarget, setPreviousTarget] = useState(targetKey);
  if (previousTarget !== targetKey) {
    setPreviousTarget(targetKey);
    setKind(initialKind === 'incident' ? 'incident' : 'checklist');
    setId(initialId ?? '');
    setOffset(0);
  }
  const checklists = useQuery({
    queryKey: [...queryKey, 'assigned-checklists', offset],
    queryFn: async ({ signal }) => {
      const rows = (
        await allPages(
          (p) => client.listSafetyChecklists(token, scope.siteId, { assignedTo: user.id, ...p }),
          signal,
        )
      ).filter((c) => c.contractorId === scope.contractorId);
      return { items: rows.slice(offset, offset + 8), total: rows.length };
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
      ).filter((i) => i.siteId === scope.siteId && i.contractorId === scope.contractorId);
      return { items: rows.slice(offset, offset + 8), total: rows.length };
    },
    enabled: kind === 'incident' && !id,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });
  const header = (
    <ScreenHeader
      mode="detail"
      showSiteInfo
      siteName={scope.siteName}
      scopeLabel={scope.contractorName}
      onScopeChange={onScopeChange}
      title={tr(
        id
          ? kind === 'checklist'
            ? 'assignedWork.assignedChecklist'
            : 'assignedWork.correctiveAction'
          : 'assignedWork.title',
      )}
      onBack={() => {
        if (id) setId('');
        else onBack();
      }}
    />
  );
  if (id)
    return (
      <>
        {header}
        {kind === 'checklist' ? (
          <ChecklistDetail
            id={id}
            onIncident={(value) => {
              setKind('incident');
              setId(value);
            }}
          />
        ) : (
          <IncidentDetail
            key={[id, id === initialId ? initialActionId : undefined].join(':')}
            id={id}
            actionId={id === initialId ? initialActionId : undefined}
          />
        )}
      </>
    );
  const total = kind === 'incident' ? incidents.data?.total : checklists.data?.total;
  return (
    <>
      {header}
      <Page>
        <Text style={workStyles.context}>{scope.siteName}</Text>
        <ManagementTabs
          value={kind}
          onChange={(v) => {
            setKind(v);
            setOffset(0);
          }}
          items={[
            {
              value: 'checklist',
              label: tr('assignedWork.checklistTab'),
              accessibilityLabel: tr('assignedWork.checklist'),
            },
            {
              value: 'incident',
              label: tr('assignedWork.correctiveTab'),
              accessibilityLabel: tr('assignedWork.correctiveAction'),
            },
          ]}
        />
        <View style={workStyles.listHeading}>
          <Text style={workStyles.listCount}>
            {total === undefined
              ? tr('assignedWork.listHint')
              : tr('assignedWork.count', { count: total })}
          </Text>
          <ManagementLink
            label={tr('assignedWork.refresh')}
            disabled={kind === 'incident' ? incidents.isFetching : checklists.isFetching}
            onPress={() => {
              void (kind === 'incident' ? incidents : checklists).refetch();
            }}
          />
        </View>
        {kind === 'checklist' ? (
          <QueryState query={checklists}>
            {(data) => (
              <>
                {!data.items.length && (
                  <EmptyState
                    icon={<IconDocument size={26} color={colors.primary} />}
                    title={tr('assignedWork.noChecklists')}
                  />
                )}
                {data.items
                  .filter((c) => c.contractorId === scope.contractorId)
                  .map((c) => (
                    <Pressable
                      key={c.id}
                      accessibilityRole="button"
                      accessibilityLabel={tr('assignedWork.openChecklist')}
                      accessibilityHint={c.description}
                      onPress={() => setId(c.id)}
                      style={({ pressed }) => [workStyles.item, pressed && { opacity: 0.7 }]}
                    >
                      <View style={workStyles.badges}>
                        <WorkStatus status={c.status} />
                      </View>
                      <View style={workStyles.heading}>
                        <View style={workStyles.icon}>
                          <IconDocument size={18} color={colors.primary} />
                        </View>
                        <Text style={workStyles.title}>{c.description}</Text>
                      </View>
                      <View style={workStyles.itemMeta}>
                        <WorkMeta
                          label={tr('scheduleAssign.team')}
                          value={c.teamName ?? tr('common.notRecorded')}
                        />
                        <WorkMeta
                          label={tr('common.zone')}
                          value={c.zoneName ?? tr('common.notRecorded')}
                        />
                        <WorkMeta label={tr('common.deadline')} value={displayTime(c.endsAt)} />
                      </View>
                      <View style={workStyles.itemFooter}>
                        <Text style={workStyles.link}>{tr('assignedWork.openChecklist')}</Text>
                        <IconChevronRight size={17} color={colors.primary} />
                      </View>
                    </Pressable>
                  ))}
                {data.total > 8 && (
                  <Pager offset={offset} total={data.total} size={8} onChange={setOffset} />
                )}
              </>
            )}
          </QueryState>
        ) : (
          <QueryState query={incidents}>
            {(data) => (
              <>
                {!data.items.length && (
                  <EmptyState
                    icon={<IconShield size={26} color={colors.primary} />}
                    title={tr('assignedWork.noActions')}
                  />
                )}
                {data.items
                  .filter((i) => i.siteId === scope.siteId && i.contractorId === scope.contractorId)
                  .map((i) => (
                    <Pressable
                      key={i.id}
                      accessibilityRole="button"
                      accessibilityLabel={tr('assignedWork.openAction')}
                      accessibilityHint={i.title}
                      onPress={() => setId(i.id)}
                      style={({ pressed }) => [workStyles.item, pressed && { opacity: 0.7 }]}
                    >
                      <View style={workStyles.badges}>
                        <WorkStatus status={i.status} />
                        <WorkStatus status={i.severity} />
                      </View>
                      <View style={workStyles.heading}>
                        <View style={workStyles.icon}>
                          <IconShield size={18} color={colors.primary} />
                        </View>
                        <Text style={workStyles.title}>{i.title}</Text>
                      </View>
                      {i.zoneName && <WorkMeta label={tr('common.zone')} value={i.zoneName} />}
                      <View style={workStyles.itemFooter}>
                        <Text style={workStyles.link}>{tr('assignedWork.openAction')}</Text>
                        <IconChevronRight size={17} color={colors.primary} />
                      </View>
                    </Pressable>
                  ))}
                {data.total > 8 && (
                  <Pager offset={offset} total={data.total} size={8} onChange={setOffset} />
                )}
              </>
            )}
          </QueryState>
        )}
      </Page>
    </>
  );
}
function ChecklistDetail({ id, onIncident }: { id: string; onIncident: (id: string) => void }) {
  const { t } = useTranslation();
  const { scope, client, token, user, queryKey } = useWorkspace();
  const command = useCommand(),
    requestId = useRequestId();
  const detail = useQuery({
    queryKey: [...queryKey, 'checklist', id],
    queryFn: () => client.getSafetyChecklist(token, scope.siteId, id),
  });
  return (
    <Page>
      <ErrorNotice error={command.error} />
      <QueryState query={detail}>
        {(data) =>
          data.contractorId !== scope.contractorId ? (
            <Hint>{tr('assignedWork.checklistScopeHint')}</Hint>
          ) : (
            <>
              <WorkSummary
                title={data.description}
                status={data.status}
                icon={<IconDocument size={19} color={colors.primary} />}
              >
                <WorkMeta
                  label={tr('scheduleAssign.team')}
                  value={data.teamName ?? tr('common.notRecorded')}
                />
                <WorkMeta
                  label={tr('common.zone')}
                  value={data.zoneName ?? tr('common.notRecorded')}
                />
                <WorkMeta label={tr('assignedWork.startsAt')} value={displayTime(data.startsAt)} />
                <WorkMeta label={tr('common.deadline')} value={displayTime(data.endsAt)} />
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
              </WorkSummary>
              {data.assignedTo === user.id && data.status === 'IN_PROGRESS' && (
                <ChecklistForm key={`${data.id}:${data.version}`} detail={data} />
              )}
              <Disclosure
                title={tr('assignedWork.submissionHistory')}
                initiallyOpen={
                  data.status === 'IN_PROGRESS' &&
                  data.submissions.some((s) => s.status === 'RETURNED')
                }
              >
                {!data.submissions.length && <Hint>{tr('assignedWork.noReports')}</Hint>}
                {data.submissions.map((s) => (
                  <View key={s.id} style={workStyles.record}>
                    <WorkStatus status={s.status} />
                    <Text style={workStyles.recordTitle}>
                      {s.submittedByName ?? tr('common.actor')}
                    </Text>
                    <Hint>
                      {displayTime(s.submittedAt)} · {s.reviewNote ?? ''}
                    </Hint>
                    {s.results.map((r) => (
                      <View key={r.id} style={workStyles.record}>
                        <Text style={workStyles.recordTitle}>
                          {data.items.find((i) => i.id === r.itemId)?.text}
                        </Text>
                        <Hint>
                          {localizedLabel(r.answer)}
                          {r.note ? ` · ${r.note}` : ''}
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
                      </View>
                    ))}
                  </View>
                ))}
              </Disclosure>
              <Disclosure title={tr('assignedWork.actionHistory')}>
                {data.audit.map((a) => (
                  <Hint key={a.id}>
                    {a.actorName ?? tr('common.actor')} · {a.action} · {displayTime(a.occurredAt)}
                    {a.reason ? ` · ${a.reason}` : ''}
                  </Hint>
                ))}
              </Disclosure>
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
    <View style={workStyles.card}>
      <View style={workStyles.criteriaHeading}>
        <Text style={workStyles.criteriaTitle}>{tr('assignedWork.criteria')}</Text>
        <Text style={workStyles.context}>
          {completed}/{detail.items.length} {tr('assignedWork.criteriaUnit')}
        </Text>
      </View>
      <View
        style={workStyles.progressTrack}
        accessible
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: detail.items.length, now: completed }}
        accessibilityLabel={tr('assignedWork.criteria')}
      >
        <View
          style={[
            workStyles.progressValue,
            { width: `${detail.items.length ? (completed / detail.items.length) * 100 : 0}%` },
          ]}
        />
      </View>
      {detail.items.map((item, index) => (
        <Disclosure
          key={item.id}
          title={
            tr('assignedWork.criterion', { number: index + 1 }) +
            (answers[item.id] ? ` · ${localizedLabel(answers[item.id]!)}` : '')
          }
          initiallyOpen={index === 0}
        >
          <Body>{item.text}</Body>
          {item.evidenceRequired && <Hint>{tr('assignedWork.passEvidenceHint')}</Hint>}
          <Choice
            label={tr('assignedWork.checkResult')}
            value={answers[item.id] ?? ''}
            disabled={command.isPending}
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
            editable={!command.isPending}
          />
          <Attachments
            files={filesByItem[item.id] ?? []}
            disabled={command.isPending}
            onChange={(files) => setFiles({ ...filesByItem, [item.id]: files })}
          />
        </Disclosure>
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
    </View>
  );
}
function IncidentDetail({ id, actionId }: { id: string; actionId?: string }) {
  useTranslation();
  const { scope, client, token, user, queryKey } = useWorkspace();
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const focusedTarget = useRef(false);
  const query = useQuery({
    queryKey: [...queryKey, 'incident', id],
    queryFn: () => client.getIncident(token, scope.siteId, id),
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });
  return (
    <Page scrollRef={scrollRef}>
      <ManagementLink
        label={tr('assignedWork.refresh')}
        disabled={query.isFetching}
        onPress={() => void query.refetch()}
      />
      <QueryState query={query}>
        {(data) =>
          data.siteId !== scope.siteId || data.contractorId !== scope.contractorId ? (
            <Hint>{tr('assignedWork.actionScopeHint')}</Hint>
          ) : (
            <>
              <WorkSummary
                title={data.title}
                status={data.status}
                icon={<IconShield size={19} color={colors.primary} />}
              >
                <Text style={workStyles.recordBody}>{data.description}</Text>
                <View style={workStyles.badges}>
                  <WorkStatus status={data.severity} />
                </View>
                {data.zoneName && <WorkMeta label={tr('common.zone')} value={data.zoneName} />}
              </WorkSummary>
              {(data.sourceChecklist || data.alerts.length > 0) && (
                <Disclosure title={tr('assignedWork.sourceDetails')}>
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
                </Disclosure>
              )}
              {actionId &&
                !data.actions.some((a) => a.id === actionId && a.assignedTo === user.id) && (
                  <Hint>{tr('assignedWork.handoverUnavailable')}</Hint>
                )}
              {data.actions
                .filter((a) => a.assignedTo === user.id)
                .map((a) => (
                  <View
                    key={a.id}
                    onLayout={(event) => {
                      if (a.id !== actionId || focusedTarget.current) return;
                      focusedTarget.current = true;
                      const y = event.nativeEvent.layout.y;
                      requestAnimationFrame(() =>
                        scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true }),
                      );
                    }}
                    style={
                      a.id === actionId
                        ? { borderColor: '#F66B17', borderWidth: 2, borderRadius: 20, padding: 3 }
                        : undefined
                    }
                  >
                    {a.id === actionId && <Hint>{tr('assignedWork.linkedHandover')}</Hint>}
                    <ActionForm
                      key={`${a.id}:${a.version}`}
                      action={a}
                      incidentId={id}
                      closed={
                        data.status === 'CLOSED' ||
                        (!!actionId &&
                          !data.actions.some(
                            (target) => target.id === actionId && target.assignedTo === user.id,
                          ))
                      }
                    />
                  </View>
                ))}
              <Disclosure title={tr('assignedWork.reviewHistory')}>
                {data.audit.map((a) => (
                  <Hint key={a.id}>
                    {a.actorName ?? tr('common.actor')} · {a.action} · {displayTime(a.occurredAt)} ·{' '}
                    {a.reason ?? ''}
                  </Hint>
                ))}
              </Disclosure>
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
  closed,
}: {
  action: CorrectiveActionResponse;
  incidentId: string;
  closed: boolean;
}) {
  useTranslation();
  const { scope, client, token } = useWorkspace();
  const [result, setResult] = useState(''),
    [files, setFiles] = useState<NativeUploadFile[]>([]);
  const command = useCommand(),
    requestId = useRequestId();
  return (
    <WorkSummary title={action.description} status={action.status}>
      <WorkMeta label={tr('common.deadline')} value={displayTime(action.dueAt)} />
      {action.status === 'SUBMITTED' && (
        <View style={workStyles.review}>
          <Text style={workStyles.reviewText}>{tr('assignedWork.awaitingReview')}</Text>
        </View>
      )}
      {action.status === 'CLOSED' && !closed && <Hint>{tr('assignedWork.otherWorkOpen')}</Hint>}
      {action.supersededAt ? (
        <Hint>
          {tr('assignedWork.handedOver')} {action.supersededReason}
        </Hint>
      ) : (
        <>
          {!closed && action.status === 'ASSIGNED' && (
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
          {!closed && action.status === 'IN_PROGRESS' && (
            <>
              <Field
                label={tr('assignedWork.actionResult')}
                multiline
                value={result}
                onChangeText={setResult}
                editable={!command.isPending}
              />
              <Attachments
                files={files}
                onChange={setFiles}
                jpegOnly
                maxFiles={1}
                disabled={command.isPending}
              />
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
      {action.submissions.length > 0 && (
        <Disclosure
          title={tr('assignedWork.submissionHistory')}
          initiallyOpen={action.submissions.some((s) => s.status === 'REJECTED')}
        >
          {action.submissions.map((s) => (
            <View key={s.id} style={workStyles.record}>
              <WorkStatus status={s.status} />
              <Text style={workStyles.recordBody}>{s.resultDescription}</Text>
              <Hint>{displayTime(s.submittedAt)}</Hint>
              {s.reviewNote && (
                <View style={workStyles.review}>
                  <Text style={workStyles.reviewText}>{s.reviewNote}</Text>
                </View>
              )}
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
            </View>
          ))}
        </Disclosure>
      )}
    </WorkSummary>
  );
}
