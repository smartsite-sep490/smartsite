import { useId, useState, type FormEvent, type JSX } from 'react';
import { IconX } from '../icons';
import { Alert, AlertDescription, Badge, Button, Card } from '../ui';
import type { NamedCandidate } from './SafetyIdentificationForms';
import type { IdentificationWorkspaceCopy } from './IdentificationWorkspaceCopy';
import {
  DETAIL_FIELD_CLASS,
  DETAIL_FIELD_ERROR_CLASS,
  sameId,
  validateIdentificationDetailReason,
  type DetailPendingAction,
} from './safetyIdentificationDetailShared';

export interface SafetyIdentificationAdminCardProps {
  visible: boolean;
  assignedTo: string;
  eligibleAssignee: NamedCandidate | null;
  assigneeLoading: boolean;
  isEligibleReassignTarget: boolean;
  copy: IdentificationWorkspaceCopy;
  pendingAction: DetailPendingAction;
  isAnyPending: boolean;
  conflictLocked: boolean;
  reassignError: string | null;
  cancelError: string | null;
  onRefreshAfterConflict: () => void;
  onReassign: (assignedTo: string, reason: string) => void;
  onCancelRequest: (reason: string) => void;
}

export function SafetyIdentificationAdminCard({
  visible,
  assignedTo,
  eligibleAssignee,
  assigneeLoading,
  isEligibleReassignTarget,
  copy,
  pendingAction,
  isAnyPending,
  conflictLocked,
  reassignError,
  cancelError,
  onRefreshAfterConflict,
  onReassign,
  onCancelRequest,
}: SafetyIdentificationAdminCardProps): JSX.Element | null {
  const baseId = useId();
  const [adminMode, setAdminMode] = useState<'reassign' | 'cancel' | null>(null);
  const [reassignReason, setReassignReason] = useState('');
  const [reassignValidationError, setReassignValidationError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelValidationError, setCancelValidationError] = useState<string | null>(null);

  if (!visible) {
    return null;
  }

  function handleReassignSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isAnyPending || conflictLocked || assigneeLoading) return;
    if (!eligibleAssignee || !isEligibleReassignTarget) {
      setReassignValidationError(copy.validation.reassignUnavailable);
      return;
    }
    const err = validateIdentificationDetailReason(reassignReason, copy);
    setReassignValidationError(err);
    if (err) return;
    onReassign(eligibleAssignee.id, reassignReason.trim());
  }

  function handleCancelSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isAnyPending || conflictLocked) return;
    const err = validateIdentificationDetailReason(cancelReason, copy);
    setCancelValidationError(err);
    if (err) return;
    onCancelRequest(cancelReason.trim());
  }

  const isExpanded = adminMode !== null || reassignError !== null || cancelError !== null;

  return (
    <Card
      aria-labelledby={`${baseId}-admin-heading`}
      className={isExpanded ? 'space-y-4' : 'py-3.5'}
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-3 ${
          isExpanded ? 'border-b border-slate-100 pb-3' : ''
        }`}
      >
        <div className="space-y-0.5 min-w-0">
          <h3 id={`${baseId}-admin-heading`} className="text-xs font-bold uppercase tracking-wider text-slate-700">
            {copy.detail.adminActionsTitle}
          </h3>
          {isExpanded && (
            <p className="text-xs text-slate-600 leading-relaxed">
              {copy.detail.adminActionsSubtitle}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={adminMode === 'reassign' ? 'default' : 'outline'}
            size="sm"
            aria-expanded={adminMode === 'reassign'}
            onClick={() => setAdminMode((prev) => (prev === 'reassign' ? null : 'reassign'))}
          >
            {copy.detail.reassignToggle}
          </Button>
          <Button
            type="button"
            variant={adminMode === 'cancel' ? 'destructive' : 'outline'}
            size="sm"
            aria-expanded={adminMode === 'cancel'}
            leftIcon={<IconX className="w-3.5 h-3.5" />}
            onClick={() => setAdminMode((prev) => (prev === 'cancel' ? null : 'cancel'))}
          >
            {copy.detail.cancelToggle}
          </Button>
        </div>
      </div>

      {(adminMode === 'reassign' || reassignError !== null) && (
        <form noValidate onSubmit={handleReassignSubmit} className="space-y-3.5">
          {reassignError && (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{reassignError}</span>
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

          <div className="rounded-xl border border-slate-200/90 bg-slate-50/80 p-3.5 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">
                {copy.detail.reassignTargetLabel}
              </span>
              {assigneeLoading ? (
                <span role="status" className="text-xs text-slate-600">
                  {copy.detail.reassignLoading}
                </span>
              ) : eligibleAssignee ? (
                <Badge variant={isEligibleReassignTarget ? 'info' : 'neutral'} dot>
                  {eligibleAssignee.displayName}
                </Badge>
              ) : (
                <Badge variant="warning" dot>
                  {copy.detail.reassignUnavailable}
                </Badge>
              )}
            </div>
            {!assigneeLoading && eligibleAssignee && sameId(eligibleAssignee.id, assignedTo) && (
              <p className="text-xs text-slate-600">{copy.detail.reassignSameAssigneeNotice}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor={`${baseId}-reassign-reason`}
              className="block text-xs font-semibold text-slate-800"
            >
              {copy.detail.reassignReasonLabel}
            </label>
            <textarea
              id={`${baseId}-reassign-reason`}
              rows={2}
              value={reassignReason}
              disabled={isAnyPending || conflictLocked}
              placeholder={copy.detail.reassignReasonPlaceholder}
              aria-invalid={Boolean(reassignValidationError)}
              onChange={(event) => {
                setReassignReason(event.target.value);
                if (
                  reassignValidationError &&
                  !validateIdentificationDetailReason(event.target.value, copy)
                ) {
                  setReassignValidationError(null);
                }
              }}
              className={`${DETAIL_FIELD_CLASS} resize-y ${
                reassignValidationError ? DETAIL_FIELD_ERROR_CLASS : ''
              }`}
            />
            {reassignValidationError && (
              <p role="alert" className="text-xs font-medium text-rose-600">
                {reassignValidationError}
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="default"
              size="md"
              isLoading={pendingAction === 'reassign'}
              disabled={
                isAnyPending || conflictLocked || assigneeLoading || !isEligibleReassignTarget
              }
            >
              {pendingAction === 'reassign'
                ? copy.detail.reassignSubmitting
                : copy.detail.reassignSubmit}
            </Button>
          </div>
        </form>
      )}

      {(adminMode === 'cancel' || cancelError !== null) && (
        <form noValidate onSubmit={handleCancelSubmit} className="space-y-3.5">
          {cancelError && (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{cancelError}</span>
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

          <p className="text-xs text-rose-700 font-medium">{copy.detail.cancelWarning}</p>

          <div className="space-y-1.5">
            <label
              htmlFor={`${baseId}-cancel-reason`}
              className="block text-xs font-semibold text-slate-800"
            >
              {copy.detail.cancelReasonLabel}
            </label>
            <textarea
              id={`${baseId}-cancel-reason`}
              rows={2}
              value={cancelReason}
              disabled={isAnyPending || conflictLocked}
              placeholder={copy.detail.cancelReasonPlaceholder}
              aria-invalid={Boolean(cancelValidationError)}
              onChange={(event) => {
                setCancelReason(event.target.value);
                if (
                  cancelValidationError &&
                  !validateIdentificationDetailReason(event.target.value, copy)
                ) {
                  setCancelValidationError(null);
                }
              }}
              className={`${DETAIL_FIELD_CLASS} resize-y ${
                cancelValidationError ? DETAIL_FIELD_ERROR_CLASS : ''
              }`}
            />
            {cancelValidationError && (
              <p role="alert" className="text-xs font-medium text-rose-600">
                {cancelValidationError}
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="destructive"
              size="md"
              isLoading={pendingAction === 'cancel'}
              disabled={isAnyPending || conflictLocked}
            >
              {pendingAction === 'cancel' ? copy.detail.cancelSubmitting : copy.detail.cancelSubmit}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
