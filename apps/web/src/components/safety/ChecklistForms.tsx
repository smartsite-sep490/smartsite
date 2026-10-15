import { useTranslation } from 'react-i18next';
import { translate as tr } from '../../i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  ChecklistItemResponse,
  ChecklistResultInput,
  CreateChecklistCommand,
  ChecklistAnswer,
} from '@smartsite/api-client';
import { type WorkflowProps, fieldClass, buttonClass, cardClass } from './safety-workflow';
import { Assignee, BlobImage, CommandForm, Field, RequestError } from './SafetyWorkflowUi';
import {
  browserTimezone,
  localDay,
  localInput,
  safetyContractors,
  safetyTeams,
} from './safety-context';
const presets = () => ({
  HEIGHT: [
    {
      text: tr(
        'safety_workspace.team_briefed_on_the_hazards_and_precautions_of_this_specific_task',
      ),
      evidenceRequired: false,
    },
    {
      text: tr(
        'safety_workspace.fall_protection_equipment_prepared_for_this_team_task_provide_dated_photos',
      ),
      evidenceRequired: true,
    },
    {
      text: tr('safety_workspace.work_area_and_access_arrangements_checked'),
      evidenceRequired: false,
    },
    {
      text: tr(
        'safety_workspace.attach_the_inspection_or_training_documents_requested_for_this_task',
      ),
      evidenceRequired: true,
    },
  ],
  ELECTRICAL: [
    {
      text: tr('safety_workspace.work_specific_safety_briefing_completed'),
      evidenceRequired: false,
    },
    {
      text: tr(
        'safety_workspace.protective_equipment_prepared_for_this_electrical_task_provide_dated_photos',
      ),
      evidenceRequired: true,
    },
    {
      text: tr('safety_workspace.work_area_and_equipment_condition_checked'),
      evidenceRequired: true,
    },
    {
      text: tr('safety_workspace.required_inspection_or_training_documents_available'),
      evidenceRequired: true,
    },
  ],
});
export function CreateChecklistForm(
  p: WorkflowProps & {
    draft?: { teamId: string; day: string };
    pending: boolean;
    onSubmit: (input: Omit<CreateChecklistCommand, 'commandId'>) => void;
  },
) {
  useTranslation();

  const [day, setDay] = useState(p.draft?.day ?? localDay()),
    [contractor, setContractor] = useState(''),
    [teamId, setTeam] = useState(p.draft?.teamId ?? ''),
    [zoneId, setZone] = useState(''),
    [windowChoice, setWindowChoice] = useState(''),
    [preset, setPreset] = useState<'HEIGHT' | 'ELECTRICAL'>('HEIGHT'),
    [items, setItems] = useState(() => presets().HEIGHT);
  const timezone = browserTimezone(),
    base = ['safety-workflow', p.apiUrl, p.scope, p.siteId] as const;
  const contractors = useQuery({
    queryKey: [...base, 'contractor-options'],
    queryFn: ({ signal }) => safetyContractors(p, signal),
    retry: false,
  });
  const teams = useQuery({
    queryKey: [...base, 'team-options', day, timezone, contractor],
    queryFn: ({ signal }) => safetyTeams(p, day, timezone, contractor, signal),
    enabled: !!day,
    retry: false,
  });
  const team = teams.data?.find((t) => t.id === teamId);
  const detail = useQuery({
    queryKey: [...base, 'checklist-team', teamId, day, timezone],
    queryFn: ({ signal }) =>
      p.client.getSafetyTeam(
        p.token,
        p.siteId,
        teamId,
        { date: day, timezone, limit: 20 },
        { signal },
      ),
    enabled: !!teamId && !!day,
    retry: false,
  });
  const windows = detail.data?.workWindows ?? [];
  const planned =
    windows.length === 1
      ? windows[0]
      : windowChoice
        ? windows[Number(windowChoice) - 1]
        : undefined;
  return (
    <CommandForm
      pending={p.pending}
      label={tr('safety_workspace.assign_checklist')}
      onSubmit={(form) => {
        if (!team || !zoneId) throw Error(tr('safety_workspace.choose_a_team_and_zone'));
        if (!items.length || items.some((i) => !i.text.trim()))
          throw Error(tr('safety_workspace.every_criterion_needs_a_description'));
        p.onSubmit({
          teamId,
          zoneId,
          assignedTo: String(form.get('assignedTo') ?? ''),
          description: String(form.get('description') ?? '').trim(),
          startsAt: new Date(String(form.get('startsAt'))).toISOString(),
          endsAt: new Date(String(form.get('endsAt'))).toISOString(),
          items: items.map((i) => ({ ...i, text: i.text.trim() })),
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">
          {tr('common.work_date')}
          <input
            className={fieldClass}
            required
            type="date"
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              setWindowChoice('');
              setZone('');
            }}
          />
        </label>
        <label className="text-sm font-semibold">
          {tr('common.contractor')}
          <select
            className={fieldClass}
            value={contractor}
            onChange={(e) => {
              setContractor(e.target.value);
              setTeam('');
              setZone('');
            }}
          >
            <option value="">{tr('safety_workspace.all_contractors')}</option>
            {contractors.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          {tr('labels.TEAM')}
          <select
            className={fieldClass}
            required
            value={teamId}
            onChange={(e) => {
              setTeam(e.target.value);
              setWindowChoice('');
              setZone('');
            }}
          >
            <option value="">{tr('safety_workspace.choose_a_team')}</option>
            {teams.data
              ?.filter((t) => t.isActive)
              .map((t) => (
                <option value={t.id} key={t.id}>
                  {t.contractorName} · {t.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          {tr('common.zone')}
          <select
            className={fieldClass}
            required
            value={zoneId}
            onChange={(e) => setZone(e.target.value)}
          >
            <option value="">{tr('safety_workspace.choose_a_recorded_zone_grant')}</option>
            {detail.data?.zones.map((z) => (
              <option key={z.id + z.validFrom} value={z.id}>
                {z.name} · {z.code}
              </option>
            ))}
          </select>
        </label>
        {windows.length > 1 && (
          <label className="text-sm font-semibold">
            {tr('safety_workspace.planned_work_window')}
            <select
              className={fieldClass}
              value={windowChoice}
              onChange={(e) => setWindowChoice(e.target.value)}
            >
              <option value="">
                {tr('safety_workspace.choose_a_shift_or_enter_custom_times')}
              </option>
              {windows.map((w, i) => (
                <option key={i} value={String(i + 1)}>
                  {w.shiftName} · {localInput(w.startsAt)} – {localInput(w.endsAt)}
                </option>
              ))}
            </select>
          </label>
        )}
        {!windows.length && !detail.isPending && (
          <p className="text-xs">
            {tr(
              'safety_workspace.no_planned_shift_for_this_team_date_enter_the_work_window_explicitly',
            )}
          </p>
        )}
        <fieldset
          disabled={detail.isPending && !!teamId}
          key={day + teamId + (planned?.startsAt ?? 'custom')}
        >
          <Field
            name="startsAt"
            label={tr('safety_workspace.work_starts')}
            type="datetime-local"
            required
            defaultValue={planned ? localInput(planned.startsAt) : ''}
          />
        </fieldset>
        <fieldset
          disabled={detail.isPending && !!teamId}
          key={day + teamId + 'end' + (planned?.endsAt ?? 'custom')}
        >
          <Field
            name="endsAt"
            label={tr('safety_workspace.work_ends')}
            type="datetime-local"
            required
            defaultValue={planned ? localInput(planned.endsAt) : ''}
          />
        </fieldset>
      </div>
      <p className="text-xs text-[var(--text-secondary)]">
        {tr(
          'safety_workspace.times_use_value1_the_team_s_zone_grant_must_cover_the_whole_work_window',
          { value1: timezone },
        )}
      </p>
      <RequestError error={contractors.error} retry={() => void contractors.refetch()} />
      <RequestError error={teams.error} retry={() => void teams.refetch()} />
      <RequestError error={detail.error} retry={() => void detail.refetch()} />
      {detail.data && !detail.data.zones.length && (
        <p className="text-sm">
          {tr(
            'safety_workspace.no_applicable_zone_grant_coordinate_with_the_site_manager_before_assigning',
          )}
        </p>
      )}
      <Field
        name="description"
        label={tr('safety_workspace.work_description')}
        type="textarea"
        maxLength={2000}
        required
      />
      {team && (
        <Assignee
          key={team.contractorId}
          p={p}
          role="CONTRACTOR_REPRESENTATIVE"
          contractorId={team.contractorId}
        />
      )}
      <label className="text-sm font-semibold">
        {tr('safety_workspace.suggested_checklist')}
        <select
          className={fieldClass}
          value={preset}
          onChange={(e) => {
            const value = e.target.value as typeof preset;
            setPreset(value);
            setItems(presets()[value]);
          }}
        >
          <option value="HEIGHT">{tr('safety_workspace.working_at_height')}</option>
          <option value="ELECTRICAL">{tr('safety_workspace.electrical_work')}</option>
        </select>
      </label>
      <p className="text-xs text-[var(--text-secondary)]">
        {tr(
          'safety_workspace.adapt_these_suggested_criteria_to_the_actual_work_criteria_become_fixed_when_assigned',
        )}
      </p>
      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={index} className={cardClass}>
            <label className="block text-sm font-semibold">
              {tr('safety_workspace.criterion_value1', { value1: index + 1 })}
              <textarea
                className={fieldClass}
                required
                maxLength={1000}
                value={item.text}
                onChange={(e) =>
                  setItems(items.map((i, n) => (n === index ? { ...i, text: e.target.value } : i)))
                }
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={item.evidenceRequired}
                onChange={(e) =>
                  setItems(
                    items.map((i, n) =>
                      n === index ? { ...i, evidenceRequired: e.target.checked } : i,
                    ),
                  )
                }
              />
              {tr('safety_workspace.require_evidence_for_criterion_value1_when_reported_as_pass', {
                value1: index + 1,
              })}
            </label>
            <button
              className={buttonClass}
              type="button"
              disabled={items.length === 1}
              onClick={() => setItems(items.filter((_, n) => n !== index))}
            >
              {tr('safety_workspace.remove_criterion_value1', { value1: index + 1 })}
            </button>
          </div>
        ))}
      </div>
      <button
        className={buttonClass}
        type="button"
        disabled={items.length >= 30}
        onClick={() => setItems([...items, { text: '', evidenceRequired: false }])}
      >
        {tr('safety_workspace.add_criterion')}
      </button>
    </CommandForm>
  );
}
type DraftResult = { answer: '' | ChecklistAnswer; note: string; files: File[] };
export function ReportChecklistForm({
  items,
  pending,
  onSubmit,
}: {
  items: ChecklistItemResponse[];
  pending: boolean;
  onSubmit: (results: ChecklistResultInput[], files: File[]) => void;
}) {
  useTranslation();

  const [draft, setDraft] = useState<Record<string, DraftResult>>(() =>
      Object.fromEntries(items.map((i) => [i.id, { answer: '', note: '', files: [] }])),
    ),
    [error, setError] = useState<unknown>();
  const change = (id: string, patch: Partial<DraftResult>) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id]!, ...patch } }));
  return (
    <CommandForm
      pending={pending}
      label={tr('safety_workspace.submit_checklist')}
      onSubmit={() => {
        const files: File[] = [];
        const results = items.map((item) => {
          const r = draft[item.id]!;
          if (!r.answer) throw Error(tr('safety_workspace.choose_a_result_for_every_criterion'));
          if (r.answer !== 'PASS' && !r.note.trim())
            throw Error(tr('safety_workspace.explain_failed_or_not_applicable_items'));
          if (r.answer === 'PASS' && item.evidenceRequired && !r.files.length)
            throw Error(
              tr('safety_workspace.add_required_evidence_or_report_the_missing_evidence_as_fail'),
            );
          const fileIndexes = r.files.map((f) => {
            files.push(f);
            return files.length - 1;
          });
          return { itemId: item.id, answer: r.answer, note: r.note.trim(), fileIndexes };
        });
        onSubmit(results, files);
      }}
    >
      <p className="text-sm text-[var(--text-secondary)]">
        {tr(
          'safety_workspace.report_each_criterion_jpeg_png_or_pdf_up_to_3_files_per_criterion_5_mib_per_file_and_20_mib_in_total',
        )}
      </p>
      {items.map((item) => {
        const r = draft[item.id]!;
        return (
          <section key={item.id} className={cardClass}>
            <h3 className="font-semibold">
              {item.position + 1}. {item.text}
            </h3>
            <label className="block text-sm font-semibold">
              {tr('safety_workspace.result_value1', { value1: item.text })}
              <select
                className={fieldClass}
                required
                value={r.answer}
                onChange={(e) =>
                  change(item.id, { answer: e.target.value as DraftResult['answer'] })
                }
              >
                <option value="">{tr('safety_workspace.choose_result')}</option>
                <option value="PASS">{tr('safety_workspace.pass')}</option>
                <option value="FAIL">{tr('safety_workspace.fail')}</option>
                <option value="NOT_APPLICABLE">{tr('safety_workspace.not_applicable')}</option>
              </select>
            </label>
            <label className="block text-sm font-semibold">
              {tr('safety_workspace.notes_value1', { value1: item.text })}
              <textarea
                className={fieldClass}
                required={r.answer === 'FAIL' || r.answer === 'NOT_APPLICABLE'}
                maxLength={2000}
                value={r.note}
                onChange={(e) => change(item.id, { note: e.target.value })}
              />
            </label>
            <label className="block text-sm font-semibold">
              {tr('safety_workspace.evidence_value1', { value1: item.text })}
              {item.evidenceRequired && (
                <span className="block text-xs font-normal">
                  {tr('safety_workspace.required_to_report_this_criterion_as_pass')}
                </span>
              )}
              <input
                className={fieldClass}
                type="file"
                multiple
                accept="image/jpeg,image/png,application/pdf"
                onChange={(e) => {
                  const next = [...r.files, ...Array.from(e.currentTarget.files ?? [])];
                  e.currentTarget.value = '';
                  try {
                    if (next.length > 3)
                      throw Error(tr('safety_workspace.at_most_three_files_per_criterion'));
                    if (
                      next.some(
                        (f) =>
                          !['image/jpeg', 'image/png', 'application/pdf'].includes(f.type) ||
                          f.size < 1 ||
                          f.size > 5242880,
                      )
                    )
                      throw Error(tr('safety_workspace.choose_a_jpeg_png_or_pdf_at_most_5_mib'));
                    const total = Object.entries(draft).reduce(
                      (sum, [id, value]) =>
                        sum + (id === item.id ? next : value.files).reduce((n, f) => n + f.size, 0),
                      0,
                    );
                    if (total > 20971520)
                      throw Error(tr('safety_workspace.files_must_total_at_most_20_mib'));
                    change(item.id, { files: next });
                    setError(undefined);
                  } catch (error) {
                    setError(error);
                  }
                }}
              />
            </label>
            {r.files.map((file, index) => (
              <div key={index} className="space-y-2 rounded-lg bg-[var(--surface-bone)] p-3">
                <p className="break-words text-sm">
                  {tr('safety_workflow_ui.value_value_kib', {
                    value1: file.name,
                    value2: (file.size / 1024).toFixed(1),
                  })}
                </p>
                {file.type !== 'application/pdf' && (
                  <BlobImage
                    blob={file}
                    alt={tr('safety_workspace.selected_evidence_for_value1', { value1: item.text })}
                  />
                )}
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    change(item.id, { files: r.files.filter((_, n) => n !== index) });
                    setError(undefined);
                  }}
                >
                  {tr('safety_workspace.remove_value1', { value1: file.name })}
                </button>
              </div>
            ))}
          </section>
        );
      })}
      <RequestError error={error} />
    </CommandForm>
  );
}
