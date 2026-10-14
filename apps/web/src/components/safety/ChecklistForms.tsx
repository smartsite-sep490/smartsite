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
const presets = {
  HEIGHT: [
    {
      text: 'Team briefed on the hazards and precautions of this specific task',
      evidenceRequired: false,
    },
    {
      text: 'Fall-protection equipment prepared for this team/task; provide dated photos',
      evidenceRequired: true,
    },
    { text: 'Work area and access arrangements checked', evidenceRequired: false },
    {
      text: 'Attach the inspection or training documents requested for this task',
      evidenceRequired: true,
    },
  ],
  ELECTRICAL: [
    { text: 'Work-specific safety briefing completed', evidenceRequired: false },
    {
      text: 'Protective equipment prepared for this electrical task; provide dated photos',
      evidenceRequired: true,
    },
    { text: 'Work area and equipment condition checked', evidenceRequired: true },
    { text: 'Required inspection or training documents available', evidenceRequired: true },
  ],
};
export function CreateChecklistForm(
  p: WorkflowProps & {
    draft?: { teamId: string; day: string };
    pending: boolean;
    onSubmit: (input: Omit<CreateChecklistCommand, 'commandId'>) => void;
  },
) {
  const [day, setDay] = useState(p.draft?.day ?? localDay()),
    [contractor, setContractor] = useState(''),
    [teamId, setTeam] = useState(p.draft?.teamId ?? ''),
    [zoneId, setZone] = useState(''),
    [windowChoice, setWindowChoice] = useState(''),
    [preset, setPreset] = useState<'HEIGHT' | 'ELECTRICAL'>('HEIGHT'),
    [items, setItems] = useState(() => presets.HEIGHT.map((i) => ({ ...i })));
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
      label="Assign checklist"
      onSubmit={(form) => {
        if (!team || !zoneId) throw Error('Choose a team and Zone');
        if (!items.length || items.some((i) => !i.text.trim()))
          throw Error('Every criterion needs a description');
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
          Work date
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
          Contractor
          <select
            className={fieldClass}
            value={contractor}
            onChange={(e) => {
              setContractor(e.target.value);
              setTeam('');
              setZone('');
            }}
          >
            <option value="">All contractors</option>
            {contractors.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Team
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
            <option value="">Choose a team</option>
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
          Zone
          <select
            className={fieldClass}
            required
            value={zoneId}
            onChange={(e) => setZone(e.target.value)}
          >
            <option value="">Choose a recorded Zone grant</option>
            {detail.data?.zones.map((z) => (
              <option key={z.id + z.validFrom} value={z.id}>
                {z.name} · {z.code}
              </option>
            ))}
          </select>
        </label>
        {windows.length > 1 && (
          <label className="text-sm font-semibold">
            Planned work window
            <select
              className={fieldClass}
              value={windowChoice}
              onChange={(e) => setWindowChoice(e.target.value)}
            >
              <option value="">Choose a shift or enter custom times</option>
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
            No planned shift for this team/date. Enter the work window explicitly.
          </p>
        )}
        <fieldset
          disabled={detail.isPending && !!teamId}
          key={day + teamId + (planned?.startsAt ?? 'custom')}
        >
          <Field
            name="startsAt"
            label="Work starts"
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
            label="Work ends"
            type="datetime-local"
            required
            defaultValue={planned ? localInput(planned.endsAt) : ''}
          />
        </fieldset>
      </div>
      <p className="text-xs text-[var(--text-secondary)]">
        Times use {timezone}. The team's Zone grant must cover the whole work window.
      </p>
      <RequestError error={contractors.error} retry={() => void contractors.refetch()} />
      <RequestError error={teams.error} retry={() => void teams.refetch()} />
      <RequestError error={detail.error} retry={() => void detail.refetch()} />
      {detail.data && !detail.data.zones.length && (
        <p className="text-sm">
          No applicable Zone grant. Coordinate with the Site Manager before assigning.
        </p>
      )}
      <Field
        name="description"
        label="Work description"
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
        Suggested checklist
        <select
          className={fieldClass}
          value={preset}
          onChange={(e) => {
            const value = e.target.value as typeof preset;
            setPreset(value);
            setItems(presets[value].map((i) => ({ ...i })));
          }}
        >
          <option value="HEIGHT">Working at height</option>
          <option value="ELECTRICAL">Electrical work</option>
        </select>
      </label>
      <p className="text-xs text-[var(--text-secondary)]">
        Adapt these suggested criteria to the actual work. Criteria become fixed when assigned.
      </p>
      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={index} className={cardClass}>
            <label className="block text-sm font-semibold">
              Criterion {index + 1}
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
              Require evidence for criterion {index + 1} when reported as Pass
            </label>
            <button
              className={buttonClass}
              type="button"
              disabled={items.length === 1}
              onClick={() => setItems(items.filter((_, n) => n !== index))}
            >
              Remove criterion {index + 1}
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
        Add criterion
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
  const [draft, setDraft] = useState<Record<string, DraftResult>>(() =>
      Object.fromEntries(items.map((i) => [i.id, { answer: '', note: '', files: [] }])),
    ),
    [error, setError] = useState<unknown>();
  const change = (id: string, patch: Partial<DraftResult>) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id]!, ...patch } }));
  return (
    <CommandForm
      pending={pending}
      label="Submit checklist"
      onSubmit={() => {
        const files: File[] = [];
        const results = items.map((item) => {
          const r = draft[item.id]!;
          if (!r.answer) throw Error('Choose a result for every criterion');
          if (r.answer !== 'PASS' && !r.note.trim())
            throw Error('Explain failed or not applicable items');
          if (r.answer === 'PASS' && item.evidenceRequired && !r.files.length)
            throw Error('Add required evidence or report the missing evidence as Fail');
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
        Report each criterion. JPEG, PNG or PDF; up to 3 files per criterion, 5 MiB per file and 20
        MiB in total.
      </p>
      {items.map((item) => {
        const r = draft[item.id]!;
        return (
          <section key={item.id} className={cardClass}>
            <h3 className="font-semibold">
              {item.position + 1}. {item.text}
            </h3>
            <label className="block text-sm font-semibold">
              Result: {item.text}
              <select
                className={fieldClass}
                required
                value={r.answer}
                onChange={(e) =>
                  change(item.id, { answer: e.target.value as DraftResult['answer'] })
                }
              >
                <option value="">Choose result</option>
                <option value="PASS">Pass</option>
                <option value="FAIL">Fail</option>
                <option value="NOT_APPLICABLE">Not applicable</option>
              </select>
            </label>
            <label className="block text-sm font-semibold">
              Notes: {item.text}
              <textarea
                className={fieldClass}
                required={r.answer === 'FAIL' || r.answer === 'NOT_APPLICABLE'}
                maxLength={2000}
                value={r.note}
                onChange={(e) => change(item.id, { note: e.target.value })}
              />
            </label>
            <label className="block text-sm font-semibold">
              Evidence: {item.text}
              {item.evidenceRequired && (
                <span className="block text-xs font-normal">
                  Required to report this criterion as Pass.
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
                    if (next.length > 3) throw Error('At most three files per criterion');
                    if (
                      next.some(
                        (f) =>
                          !['image/jpeg', 'image/png', 'application/pdf'].includes(f.type) ||
                          f.size < 1 ||
                          f.size > 5242880,
                      )
                    )
                      throw Error('Choose a JPEG, PNG or PDF at most 5 MiB');
                    const total = Object.entries(draft).reduce(
                      (sum, [id, value]) =>
                        sum + (id === item.id ? next : value.files).reduce((n, f) => n + f.size, 0),
                      0,
                    );
                    if (total > 20971520) throw Error('Files must total at most 20 MiB');
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
                  {file.name} · {(file.size / 1024).toFixed(1)} KiB
                </p>
                {file.type !== 'application/pdf' && (
                  <BlobImage blob={file} alt={'Selected evidence for ' + item.text} />
                )}
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    change(item.id, { files: r.files.filter((_, n) => n !== index) });
                    setError(undefined);
                  }}
                >
                  Remove {file.name}
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
