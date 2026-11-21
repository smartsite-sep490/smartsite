import { useId, useState, type JSX } from 'react';
import { IconCheck } from '../icons';
import { Alert, AlertDescription, Button, Card } from '../ui';
import { IDENTIFICATION_MAX_REASON_LENGTH } from './IdentificationCopy';
import type { IdentificationWorkspaceCopy } from './IdentificationWorkspaceCopy';
import {
  DETAIL_FIELD_CLASS,
  DETAIL_FIELD_ERROR_CLASS,
  validateIdentificationDetailReason,
  type DetailPendingAction,
} from './safetyIdentificationDetailShared';

export interface SafetyIdentificationReviewCardProps {
  visible: boolean;
  copy: IdentificationWorkspaceCopy;
  pendingAction: DetailPendingAction;
  isAnyPending: boolean;
  conflictLocked: boolean;
  reviewError: string | null;
  onRefreshAfterConflict: () => void;
  onReview: (decision: 'ACCEPT' | 'RETURN', reason: string) => void;
}

export function SafetyIdentificationReviewCard({
  visible,
  copy,
  pendingAction,
  isAnyPending,
  conflictLocked,
  reviewError,
  onRefreshAfterConflict,
  onReview,
}: SafetyIdentificationReviewCardProps): JSX.Element | null {
  const baseId = useId();
  const [reviewReason, setReviewReason] = useState('');
  const [reviewValidationError, setReviewValidationError] = useState<string | null>(null);

  if (!visible) {
    return null;
  }

  function handleReviewDecision(decision: 'ACCEPT' | 'RETURN') {
    if (isAnyPending || conflictLocked) return;
    const err = validateIdentificationDetailReason(reviewReason, copy);
    setReviewValidationError(err);
    if (err) return;
    onReview(decision, reviewReason.trim());
  }

  return (
    <Card aria-labelledby={`${baseId}-review-heading`} className="space-y-4">
      <header className="space-y-1 border-b border-slate-100 pb-3">
        <h3 id={`${baseId}-review-heading`} className="text-sm font-bold text-[#071A2B]">
          {copy.detail.reviewTitle}
        </h3>
        <p className="text-xs text-slate-600 leading-relaxed">{copy.detail.reviewSubtitle}</p>
      </header>

      {reviewError && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{reviewError}</span>
            {conflictLocked && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isAnyPending}
                onClick={onRefreshAfterConflict}
              >
                {copy.detail.conflictRefreshButton}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor={`${baseId}-review-reason`}
            className="block text-xs font-semibold text-slate-800"
          >
            {copy.detail.reviewReasonLabel}
          </label>
          <span className="font-mono text-xs text-slate-500 tabular-nums" aria-hidden="true">
            {reviewReason.length}/{IDENTIFICATION_MAX_REASON_LENGTH}
          </span>
        </div>
        <textarea
          id={`${baseId}-review-reason`}
          rows={3}
          value={reviewReason}
          disabled={isAnyPending || conflictLocked}
          placeholder={copy.detail.reviewReasonPlaceholder}
          aria-invalid={Boolean(reviewValidationError)}
          onChange={(event) => {
            setReviewReason(event.target.value);
            if (
              reviewValidationError &&
              !validateIdentificationDetailReason(event.target.value, copy)
            ) {
              setReviewValidationError(null);
            }
          }}
          className={`${DETAIL_FIELD_CLASS} resize-y ${
            reviewValidationError ? DETAIL_FIELD_ERROR_CLASS : ''
          }`}
        />
        <p className="text-xs text-slate-600">{copy.detail.reviewReasonHint}</p>
        {reviewValidationError && (
          <p role="alert" className="text-xs font-medium text-rose-600">
            {reviewValidationError}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
        <Button
          type="button"
          variant="outline"
          size="md"
          isLoading={pendingAction === 'return'}
          disabled={isAnyPending || conflictLocked}
          onClick={() => handleReviewDecision('RETURN')}
        >
          {pendingAction === 'return' ? copy.detail.returningButton : copy.detail.returnButton}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="md"
          isLoading={pendingAction === 'accept'}
          disabled={isAnyPending || conflictLocked}
          leftIcon={<IconCheck className="w-3.5 h-3.5" />}
          onClick={() => handleReviewDecision('ACCEPT')}
        >
          {pendingAction === 'accept' ? copy.detail.acceptingButton : copy.detail.acceptButton}
        </Button>
      </div>
    </Card>
  );
}
