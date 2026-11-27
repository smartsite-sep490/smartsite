import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  processingStatus,
  type AttendanceNoticeContext,
} from '../src/modules/workforce/notifications/notification-workflow.js';

const context: AttendanceNoticeContext = {
  notification_id: 'notice',
  display_name: 'Synthetic Worker',
  missing_evidence: true,
  request_status: null,
  pending_correction_id: null,
  latest_correction_status: null,
};
test('missing evidence follows submission and rejection without granting resolution', () => {
  assert.equal(processingStatus('MISSING_CHECKOUT', 'WORKER', context), 'ACTION_REQUIRED');
  assert.equal(
    processingStatus('MISSING_CHECKOUT', 'CONTRACTOR_REPRESENTATIVE', context),
    'WAITING_WORKER',
  );
  assert.equal(
    processingStatus('MISSING_ATTENDANCE', 'WORKER', {
      ...context,
      pending_correction_id: 'request',
    }),
    'PENDING_REVIEW',
  );
  assert.equal(
    processingStatus('MISSING_CHECKOUT', 'WORKER', {
      ...context,
      latest_correction_status: 'REJECTED',
    }),
    'NEEDS_RESUBMISSION',
  );
  assert.equal(
    processingStatus('MISSING_CHECKOUT', 'WORKER', {
      ...context,
      latest_correction_status: 'APPROVED',
    }),
    'ACTION_REQUIRED',
  );
  assert.equal(
    processingStatus('MISSING_CHECKOUT', 'WORKER', { ...context, missing_evidence: false }),
    'RESOLVED',
  );
});
test('request completion and informational notices are independent of missing evidence', () => {
  assert.equal(processingStatus('TIME_REQUESTED', 'CONTRACTOR_REPRESENTATIVE', context), undefined);
  for (const request_status of ['PENDING', 'PENDING_MANAGER'])
    assert.equal(
      processingStatus('TIME_REQUESTED', 'CONTRACTOR_REPRESENTATIVE', {
        ...context,
        request_status,
      }),
      'PENDING_REVIEW',
    );
  for (const request_status of ['APPROVED', 'REJECTED', 'CANCELLED', 'CONFLICTED'])
    assert.equal(
      processingStatus('TIME_REQUESTED', 'CONTRACTOR_REPRESENTATIVE', {
        ...context,
        request_status,
      }),
      'RESOLVED',
    );
  for (const event of [
    'EARLY_EXIT',
    'EXIT_DURATION_EXCEEDED',
    'MAX_EXITS_EXCEEDED',
    'TIME_APPROVED',
    'DOCUMENT_EXPIRED',
  ])
    assert.equal(processingStatus(event, 'WORKER', context), undefined);
});
