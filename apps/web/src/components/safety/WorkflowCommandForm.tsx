import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { translate as tr } from '../../i18n';
import { notifyWorkflowFailure } from './workflow-feedback';
import { primaryClass } from './safety-workflow';
import { RequestError } from './SafetyWorkflowUi';
import {
  apiFieldErrors,
  controlError,
  focusField,
  formControl,
  WorkflowErrors,
  WorkflowReload,
  WorkflowServerError,
  type FieldErrors,
} from './workflow-validation';

export function WorkflowCommandForm({
  children,
  onSubmit,
  pending,
  label,
  disabled = false,
  secondaryAction,
  validate,
  error: suppliedError,
}: {
  children: ReactNode;
  onSubmit: (form: FormData) => void;
  pending: boolean;
  label: string;
  disabled?: boolean;
  secondaryAction?: ReactNode;
  validate?: (form: FormData) => FieldErrors;
  error?: unknown;
}) {
  useTranslation();
  const inheritedError = useContext(WorkflowServerError);
  const reload = useContext(WorkflowReload);
  const error = suppliedError ?? inheritedError;
  const ref = useRef<HTMLFormElement>(null);
  const [local, setLocal] = useState<FieldErrors>({});
  const [edited, setEdited] = useState<{ error: unknown; fields: string[] }>({
    error: undefined,
    fields: [],
  });
  const serverErrors = apiFieldErrors(error);
  const activeServer = Object.fromEntries(
    Object.entries(serverErrors).filter(
      ([name]) => edited.error !== error || !edited.fields.includes(name),
    ),
  );
  const errors = { ...activeServer, ...local };
  const validateForm = (form: HTMLFormElement, data: FormData) => {
    const only = data.get('responsibilityOnly') === 'true';
    const found: FieldErrors = {};
    for (const element of Array.from(form.elements)) {
      if (
        !formControl(element) ||
        !element.name ||
        (only && !['contractorId', 'reason'].includes(element.name))
      )
        continue;
      const message = controlError(element);
      if (message) found[element.name] = message;
    }
    return { ...found, ...validate?.(data) };
  };
  useLayoutEffect(() => {
    if (error && ref.current) focusField(ref.current, apiFieldErrors(error));
  }, [error]);
  useLayoutEffect(() => {
    const form = ref.current;
    if (!form || !validate) return;
    const current = validate(new FormData(form));
    setLocal((previous) => {
      const next = { ...previous };
      for (const name of Object.keys(previous)) {
        const control = Array.from(form.elements).find(
          (element) => formControl(element) && element.name === name,
        );
        const message =
          current[name] ?? (control && formControl(control) ? controlError(control) : undefined);
        if (message) next[name] = message;
        else delete next[name];
      }
      return JSON.stringify(next) === JSON.stringify(previous) ? previous : next;
    });
  }, [validate]);
  const update = (target: EventTarget, blur: boolean) => {
    if (!formControl(target) || !target.name || !ref.current) return;
    if (target instanceof HTMLInputElement && ['checkbox', 'radio'].includes(target.type)) return;
    const current = validateForm(ref.current, new FormData(ref.current));
    const name = target.name;
    setLocal((previous) => {
      const next = { ...previous };
      for (const key of Object.keys(next)) {
        if (current[key]) next[key] = current[key]!;
        else delete next[key];
      }
      if (blur && current[name]) next[name] = current[name]!;
      return next;
    });
    if (!blur)
      setEdited((previous) => ({
        error,
        fields: [...(previous.error === error ? previous.fields : []), name],
      }));
  };
  return (
    <WorkflowErrors.Provider value={errors}>
      <form
        ref={ref}
        noValidate
        className="flex min-h-0 flex-1 flex-col"
        onBlurCapture={(e) => update(e.target, true)}
        onChange={(e) => update(e.target, false)}
        onSubmit={(e) => {
          e.preventDefault();
          if (pending || disabled) return;
          const form = e.currentTarget;
          const data = new FormData(form);
          const submitter = (e.nativeEvent as SubmitEvent).submitter;
          if (submitter instanceof HTMLButtonElement && submitter.name)
            data.set(submitter.name, submitter.value);
          const found = validateForm(form, data);
          setLocal(found);
          if (Object.keys(found).length) {
            focusField(form, found);
            return;
          }
          try {
            onSubmit(data);
          } catch (caught) {
            notifyWorkflowFailure(caught);
          }
        }}
      >
        <fieldset className="contents" disabled={pending || disabled}>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="workflow-form-fields min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-1">
              {children}
            </div>
            <div className="mt-4 flex shrink-0 flex-wrap gap-2 border-t border-[var(--border)] bg-white pt-4">
              <button className={primaryClass} type="submit">
                {pending ? tr('common.saving') : label}
              </button>
              {secondaryAction}
            </div>
          </div>
        </fieldset>
        {error != null && !Object.keys(serverErrors).length && (
          <RequestError error={error} retry={reload} />
        )}
        {Object.keys(serverErrors).length > 0 && (
          <p className="mt-2 text-sm text-[var(--text-secondary)]">{tr('safetyForm.checkForm')}</p>
        )}
      </form>
    </WorkflowErrors.Provider>
  );
}
