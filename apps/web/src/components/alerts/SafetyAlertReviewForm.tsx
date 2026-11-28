import type { SafetyAlertReviewTargetStatus } from '@smartsite/api-client';
import { useTranslation } from 'react-i18next';
import { translate as tr } from '../../i18n';
import { CommandForm } from '../safety/SafetyWorkflowUi';
import { FormField } from '../safety/FormField';
import { buttonClass, fieldClass } from '../safety/safety-workflow';

export function SafetyAlertReviewForm({
  reason,
  onReasonChange,
  pending,
  error,
  onSubmit,
}: {
  reason: string;
  onReasonChange: (reason: string) => void;
  pending: boolean;
  error?: unknown;
  onSubmit: (status: SafetyAlertReviewTargetStatus) => void;
}) {
  useTranslation();
  return (
    <section
      data-tour-anchor="alerts-action-bar"
      className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface-bone)] p-3 sm:p-4"
    >
      <h3 className="text-sm font-bold">{tr('common.record_review_decision')}</h3>
      <p className="mt-1 mb-3 text-xs leading-5 text-[var(--text-secondary)]">
        {tr(
          'safety_alerts_view.explain_the_evidence_behind_the_decision_the_reason_is_required_and_cannot_be_edit',
        )}
      </p>
      <CommandForm
        pending={pending}
        error={error}
        label={tr('common.confirm_violation')}
        onSubmit={(form) =>
          onSubmit(form.get('targetStatus') === 'DISMISSED' ? 'DISMISSED' : 'CONFIRMED')
        }
        secondaryAction={
          <button type="submit" name="targetStatus" value="DISMISSED" className={buttonClass}>
            {tr('common.dismiss_alert')}
          </button>
        }
      >
        <FormField
          name="reason"
          label={tr('common.decision_reason')}
          required
          hint={tr('common.minimum_5_characters')}
        >
          <textarea
            className={fieldClass}
            rows={3}
            required
            minLength={5}
            maxLength={1000}
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
          />
        </FormField>
      </CommandForm>
    </section>
  );
}
