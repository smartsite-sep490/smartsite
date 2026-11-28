import { SmartNativeSelect } from '../ui/SmartNativeSelect';
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
import { FormField } from './FormField';
import type { FieldErrors } from './workflow-validation';
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
    [items, setItems] = useState(() => presets().HEIGHT),
    [itemsEdited, setItemsEdited] = useState(false),
    [confirmPreset, setConfirmPreset] = useState(false);
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
  const zones = detail.isError ? [] : (detail.data?.zones ?? []);
  const zoneIds = [...new Set(zones.map((z) => z.id))];
  const selectedZone = zoneIds.includes(zoneId) ? zoneId : zoneIds.length === 1 ? zoneIds[0]! : '';
  const applyPreset = () => {
    setItems(presets()[preset]);
    setItemsEdited(false);
    setConfirmPreset(false);
  };
  return (
    <CommandForm
      pending={p.pending}
      label={tr('safety_workspace.assign_checklist')}
      validate={(form) => {
        const errors: FieldErrors = {};
        if (!team || detail.isPending || detail.isError)
          errors.teamId = tr('safety_workspace.choose_a_team_and_zone');
        if (!selectedZone) errors.zoneId = tr('safetyForm.required');
        const startsAt = Date.parse(String(form.get('startsAt') ?? ''));
        const endsAt = Date.parse(String(form.get('endsAt') ?? ''));
        if (Number.isFinite(startsAt) && Number.isFinite(endsAt)) {
          if (endsAt <= startsAt) errors.endsAt = tr('safetyForm.endAfterStart');
          else if (
            selectedZone &&
            !zones.some(
              (zone) =>
                zone.id === selectedZone &&
                Date.parse(zone.validFrom) <= startsAt &&
                Date.parse(zone.validUntil) >= endsAt,
            )
          )
            errors.zoneId = tr('safetyForm.zoneGrant');
        }
        return errors;
      }}
      onSubmit={(form) => {
        if (!team || !selectedZone || detail.isPending || detail.isError)
          throw Error(tr('safety_workspace.choose_a_team_and_zone'));
        if (!items.length || items.some((i) => !i.text.trim()))
          throw Error(tr('safety_workspace.every_criterion_needs_a_description'));
        p.onSubmit({
          teamId,
          zoneId: selectedZone,
          assignedTo: String(form.get('assignedTo') ?? ''),
          description: String(form.get('description') ?? '').trim(),
          startsAt: new Date(String(form.get('startsAt'))).toISOString(),
          endsAt: new Date(String(form.get('endsAt'))).toISOString(),
          items: items.map((i) => ({ ...i, text: i.text.trim() })),
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2 font-semibold">{tr('safetyForm.workWindow')}</div>
        <FormField name="workDate" label={tr('common.work_date')} required>
          <input
            name="workDate"
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
        </FormField>
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">
            {tr('safetyForm.contractorFilter')}
          </summary>
          <label className="text-sm font-semibold">
            {tr('common.contractor')}
            <SmartNativeSelect
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
            </SmartNativeSelect>
          </label>
        </details>
        <FormField name="teamId" label={tr('labels.TEAM')} required>
          <SmartNativeSelect
            className={fieldClass}
            required
            name="teamId"
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
          </SmartNativeSelect>
        </FormField>
        <FormField name="zoneId" label={tr('common.zone')} required>
          <SmartNativeSelect
            className={fieldClass}
            required
            name="zoneId"
            value={selectedZone}
            onChange={(e) => setZone(e.target.value)}
          >
            <option value="">{tr('safety_workspace.choose_a_recorded_zone_grant')}</option>
            {zones.map((z) => (
              <option key={z.id + z.validFrom} value={z.id}>
                {z.name} · {z.code}
              </option>
            ))}
          </SmartNativeSelect>
        </FormField>
        {selectedZone && (
          <div className="sm:col-span-2 text-xs text-[var(--text-secondary)]">
            {zones
              .filter((zone) => zone.id === selectedZone)
              .map((zone, index) => (
                <p key={index}>
                  {tr('safetyForm.grantWindow', {
                    from: localInput(zone.validFrom),
                    until: localInput(zone.validUntil),
                  })}
                </p>
              ))}
          </div>
        )}
        {windows.length > 1 && (
          <label className="text-sm font-semibold">
            {tr('safety_workspace.planned_work_window')}
            <SmartNativeSelect
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
            </SmartNativeSelect>
          </label>
        )}
        {!windows.length && !detail.isPending && (
          <p className="text-xs">
            {tr(
              'safety_workspace.no_planned_shift_for_this_team_date_enter_the_work_window_explicitly',
            )}
          </p>
        )}
        {planned && (
          <p className="sm:col-span-2 text-sm">
            {planned.shiftName} · {localInput(planned.startsAt)} – {localInput(planned.endsAt)}
          </p>
        )}
        <details
          className="sm:col-span-2"
          open={!planned}
          onInvalidCapture={(e) => {
            e.currentTarget.open = true;
          }}
        >
          <summary className="cursor-pointer text-sm font-semibold">
            {tr('safety_ux.adjust_work_times')}
          </summary>
          <div className="grid gap-3 sm:grid-cols-2">
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
        </details>
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
          autoSelectSingle
        />
      )}
      <details
        onInvalidCapture={(e) => {
          e.currentTarget.open = true;
        }}
      >
        <summary className="cursor-pointer font-semibold">
          {tr('safety_ux.criteria_summary', {
            count: items.length,
            evidence: items.filter((i) => i.evidenceRequired).length,
          })}
        </summary>
        <label className="text-sm font-semibold">
          {tr('safety_workspace.suggested_checklist')}
          <SmartNativeSelect
            className={fieldClass}
            value={preset}
            onChange={(e) => {
              const value = e.target.value as typeof preset;
              setPreset(value);
              setConfirmPreset(false);
            }}
          >
            <option value="HEIGHT">{tr('safety_workspace.working_at_height')}</option>
            <option value="ELECTRICAL">{tr('safety_workspace.electrical_work')}</option>
          </SmartNativeSelect>
        </label>
        <button
          className={buttonClass}
          type="button"
          onClick={() => (itemsEdited ? setConfirmPreset(true) : applyPreset())}
        >
          {tr('safety_ux.apply_template')}
        </button>
        {confirmPreset && (
          <div className={cardClass} role="group" aria-label={tr('safety_ux.replace_criteria')}>
            <p>{tr('safety_ux.replace_criteria_warning')}</p>
            <button className={buttonClass} type="button" onClick={applyPreset}>
              {tr('safety_ux.replace_criteria')}
            </button>
            <button className={buttonClass} type="button" onClick={() => setConfirmPreset(false)}>
              {tr('safety_ux.keep_criteria')}
            </button>
          </div>
        )}
        <p className="text-xs text-[var(--text-secondary)]">
          {tr(
            'safety_workspace.adapt_these_suggested_criteria_to_the_actual_work_criteria_become_fixed_when_assigned',
          )}
        </p>
        <div className="space-y-3">
          {items.map((item, index) => (
            <div key={index} className={cardClass}>
              <FormField
                name={`items.${index}.text`}
                label={tr('safety_workspace.criterion_value1', { value1: index + 1 })}
                required
              >
                <textarea
                  name={`items.${index}.text`}
                  className={fieldClass}
                  required
                  maxLength={1000}
                  value={item.text}
                  onChange={(e) => {
                    setItemsEdited(true);
                    setItems(
                      items.map((i, n) => (n === index ? { ...i, text: e.target.value } : i)),
                    );
                  }}
                />
              </FormField>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={item.evidenceRequired}
                  onChange={(e) => {
                    setItemsEdited(true);
                    setItems(
                      items.map((i, n) =>
                        n === index ? { ...i, evidenceRequired: e.target.checked } : i,
                      ),
                    );
                  }}
                />
                {tr(
                  'safety_workspace.require_evidence_for_criterion_value1_when_reported_as_pass',
                  {
                    value1: index + 1,
                  },
                )}
              </label>
              <button
                className={buttonClass}
                type="button"
                disabled={items.length === 1}
                onClick={() => {
                  setItemsEdited(true);
                  setItems(items.filter((_, n) => n !== index));
                }}
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
          onClick={() => {
            setItemsEdited(true);
            setItems([...items, { text: '', evidenceRequired: false }]);
          }}
        >
          {tr('safety_workspace.add_criterion')}
        </button>
      </details>
    </CommandForm>
  );
}
type DraftResult = {
  answer: '' | ChecklistAnswer;
  note: string;
  files: File[];
  showNote?: boolean;
};
export function ReportChecklistForm({
  items,
  pending,
  onSubmit,
  disabled = false,
}: {
  items: ChecklistItemResponse[];
  pending: boolean;
  onSubmit: (results: ChecklistResultInput[], files: File[]) => void;
  disabled?: boolean;
}) {
  useTranslation();

  const [draft, setDraft] = useState<Record<string, DraftResult>>(() =>
      Object.fromEntries(items.map((i) => [i.id, { answer: '', note: '', files: [] }])),
    ),
    [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const change = (id: string, patch: Partial<DraftResult>) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id]!, ...patch } }));
  return (
    <CommandForm
      pending={pending}
      disabled={disabled}
      label={tr('safety_workspace.submit_checklist')}
      validate={(form) => {
        const errors: FieldErrors = {};
        items.forEach((item, index) => {
          const result = {
            ...draft[item.id]!,
            answer: String(form.get(`results.${index}.answer`) ?? ''),
            note: String(form.get(`results.${index}.note`) ?? ''),
          };
          if (!result.answer) errors[`results.${index}.answer`] = tr('safetyForm.required');
          if (result.answer && result.answer !== 'PASS' && !result.note.trim())
            errors[`results.${index}.note`] = tr('safetyForm.noteRequired');
          if (result.answer === 'PASS' && item.evidenceRequired && !result.files.length)
            errors[`results.${index}.fileIndexes`] = tr('safetyForm.evidenceRequired');
        });
        return errors;
      }}
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
      <p role="status" className="text-sm font-semibold">
        {tr('safety_ux.report_progress', {
          answered: Object.values(draft).filter((r) => r.answer).length,
          total: items.length,
        })}
      </p>
      <p className="text-sm text-[var(--text-secondary)]">
        {tr(
          'safety_workspace.report_each_criterion_jpeg_png_or_pdf_up_to_3_files_per_criterion_5_mib_per_file_and_20_mib_in_total',
        )}
      </p>
      {items.map((item, index) => {
        const r = draft[item.id]!;
        return (
          <section key={item.id} className={cardClass}>
            <h3 className="font-semibold">
              {item.position + 1}. {item.text}
            </h3>
            <FormField
              name={`results.${index}.answer`}
              label={tr('safety_workspace.result_value1', { value1: item.text })}
              required
            >
              <SmartNativeSelect
                name={`results.${index}.answer`}
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
              </SmartNativeSelect>
            </FormField>
            {r.answer === 'FAIL' || r.answer === 'NOT_APPLICABLE' || r.showNote || !!r.note ? (
              <FormField
                name={`results.${index}.note`}
                label={tr('safety_workspace.notes_value1', { value1: item.text })}
                required={r.answer === 'FAIL' || r.answer === 'NOT_APPLICABLE'}
              >
                <textarea
                  name={`results.${index}.note`}
                  className={fieldClass}
                  required={r.answer === 'FAIL' || r.answer === 'NOT_APPLICABLE'}
                  maxLength={2000}
                  value={r.note}
                  onChange={(e) => change(item.id, { note: e.target.value })}
                />
              </FormField>
            ) : (
              <button
                type="button"
                className={buttonClass}
                onClick={() => change(item.id, { showNote: true })}
              >
                {tr('safety_ux.add_note')}
              </button>
            )}
            <details open={(item.evidenceRequired && r.answer === 'PASS') || r.files.length > 0}>
              <summary className="cursor-pointer text-sm font-semibold">
                {tr(item.evidenceRequired ? 'safety_ux.evidence_for_pass' : 'safetyForm.evidence')}
              </summary>
              <FormField
                name={`results.${index}.fileIndexes`}
                label={tr('safety_workspace.evidence_value1', { value1: item.text })}
                required={item.evidenceRequired && r.answer === 'PASS'}
                error={fileErrors[item.id]}
                hint={
                  item.evidenceRequired
                    ? tr('safety_workspace.required_to_report_this_criterion_as_pass')
                    : undefined
                }
              >
                <input
                  className={fieldClass}
                  type="file"
                  required={false}
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
                          sum +
                          (id === item.id ? next : value.files).reduce((n, f) => n + f.size, 0),
                        0,
                      );
                      if (total > 20971520)
                        throw Error(tr('safety_workspace.files_must_total_at_most_20_mib'));
                      change(item.id, { files: next });
                      setFileErrors((previous) => ({ ...previous, [item.id]: '' }));
                    } catch (error) {
                      setFileErrors((previous) => ({
                        ...previous,
                        [item.id]:
                          error instanceof Error ? error.message : tr('safetyForm.invalid'),
                      }));
                    }
                  }}
                />
              </FormField>
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
                      alt={tr('safety_workspace.selected_evidence_for_value1', {
                        value1: item.text,
                      })}
                    />
                  )}
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => {
                      change(item.id, { files: r.files.filter((_, n) => n !== index) });
                      setFileErrors((previous) => ({ ...previous, [item.id]: '' }));
                    }}
                  >
                    {tr('safety_workspace.remove_value1', { value1: file.name })}
                  </button>
                </div>
              ))}
            </details>
          </section>
        );
      })}
    </CommandForm>
  );
}
