import { createContext } from 'react';
import { ApiError } from '@smartsite/api-client';
import { translate as tr } from '../../i18n';

export type FieldErrors = Record<string, string>;
export const WorkflowErrors = createContext<FieldErrors>({});
export const WorkflowServerError = createContext<unknown>(undefined);
export const WorkflowReload = createContext<(() => void) | undefined>(undefined);

export function apiFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiError) || ![400, 409, 413, 415].includes(error.status ?? 0)) return {};
  return Object.fromEntries(
    (error.backendError?.issues ?? []).map((issue) => {
      const path = issue.path
        .slice(1)
        .split('/')
        .map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'))
        .join('.');
      const name =
        path === 'initialAction.description'
          ? 'actionDescription'
          : path === 'initialAction.assignedTo'
            ? 'assignedTo'
            : path === 'initialAction.dueAt'
              ? 'dueAt'
              : path === 'responsibilityReason'
                ? 'reason'
                : path;
      const key =
        (
          {
            END_BEFORE_START: 'endAfterStart',
            ZONE_GRANT_REQUIRED: 'zoneGrant',
            EVIDENCE_REQUIRED: 'evidenceRequired',
            NOTE_REQUIRED: 'noteRequired',
            BLANK_VALUE: 'required',
          } as Record<string, string>
        )[issue.code] ?? 'invalid';
      return [name, tr('safetyForm.' + key)];
    }),
  );
}

export function controlError(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): string | undefined {
  if (!control.willValidate || control.type === 'hidden') return;
  const value = control.value.trim();
  if (control.required && !value) return tr('safetyForm.required');
  if (!value) return;
  if (
    control instanceof HTMLInputElement &&
    ['date', 'datetime-local'].includes(control.type) &&
    !Number.isFinite(Date.parse(value))
  )
    return tr('safetyForm.invalidDate');
  if (
    control instanceof HTMLInputElement &&
    control.dataset.validation === 'uuid' &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    return tr('safetyForm.invalidId');
  if (!(control instanceof HTMLSelectElement)) {
    if (control.minLength > 0 && value.length < control.minLength)
      return tr('safetyForm.minLength', { count: control.minLength });
    if (control.maxLength > 0 && control.value.length > control.maxLength)
      return tr('safetyForm.maxLength', { count: control.maxLength });
  }
  if (!control.validity.valid) return tr('safetyForm.invalid');
}

export function formControl(
  value: EventTarget | Element | null,
): value is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  return (
    value instanceof HTMLInputElement ||
    value instanceof HTMLSelectElement ||
    value instanceof HTMLTextAreaElement
  );
}

export function focusField(form: HTMLFormElement, errors: FieldErrors) {
  const control = Array.from(form.elements).find(
    (element) =>
      formControl(element) &&
      element.type !== 'hidden' &&
      errors[element.name] &&
      !element.matches(':disabled'),
  );
  if (!(control instanceof HTMLElement)) return;
  let ancestor = control.parentElement;
  while (ancestor && ancestor !== form) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    ancestor = ancestor.parentElement;
  }
  control.focus();
  control.scrollIntoView?.({ block: 'nearest' });
}
