import {
  cloneElement,
  useContext,
  useId,
  type ReactElement,
  type InputHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import { WorkflowErrors } from './workflow-validation';

export function FormField({
  name,
  label,
  required = false,
  children,
  error: ownError,
  hint,
}: {
  name: string;
  label: string;
  required?: boolean;
  children: ReactElement<InputHTMLAttributes<HTMLInputElement>>;
  error?: string;
  hint?: string;
}) {
  useTranslation();
  const errors = useContext(WorkflowErrors);
  const id = useId();
  const error = ownError || errors[name];
  const controlId = children.props.id ?? id;
  return (
    <div className="workflow-field min-w-0" data-invalid={!!error || undefined}>
      <label htmlFor={controlId} className="block text-sm font-semibold">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-[var(--semantic-red-text)]">
            *
          </span>
        )}
      </label>
      {cloneElement(children, {
        id: controlId,
        name,
        required: children.props.required ?? required,
        'aria-required': required || undefined,
        'aria-label': children.props['aria-label'] ?? label,
        'aria-invalid': !!error || undefined,
        'aria-describedby':
          [children.props['aria-describedby'], hint ? id + '-hint' : '', error ? id + '-error' : '']
            .filter(Boolean)
            .join(' ') || undefined,
      })}
      {hint && (
        <p id={id + '-hint'} className="mt-1 text-xs font-normal text-[var(--text-secondary)]">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={id + '-error'}
          role="alert"
          className="mt-1 text-sm font-normal text-[var(--semantic-red-text)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
