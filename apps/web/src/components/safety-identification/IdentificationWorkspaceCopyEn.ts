import type { IdentificationWorkspaceCopy } from './IdentificationWorkspaceCopyTypes';

export const IDENTIFICATION_WORKSPACE_COPY_EN: IdentificationWorkspaceCopy = {
  header: {
    eyebrow: 'Safety Identification · C02',
    title: 'Identification Request Queue',
    officerSubtitle:
      'Request worker or contractor identification from an episode for the current Site Manager and review submitted proposals per Site.',
    managerSubtitle:
      'Review assigned Site identification requests and submit scoped worker or contractor proposals.',
    officerBadge: 'Safety Officer',
    managerBadge: 'Site Manager',
    refreshQueue: 'Refresh queue',
    newFromEpisode: 'New request from episode',
    closeCreate: 'Close create form',
  },
  access: {
    deniedTitle: 'Identification queue access unavailable',
    deniedDescription:
      'Your current account does not hold an active Safety Officer or Site Manager assignment for any Site.',
  },
  unavailable: {
    badgeLabel: 'Not enabled',
    queueTitle: 'Identification workflow not yet enabled',
    queueDescription:
      'Safety identification requests are currently disabled or unavailable for this Site. Existing safety alerts, person episodes, and incidents remain active.',
    detailTitle: 'Identification workflow unavailable',
    detailDescription:
      'Identification requests will appear here once the feature profile is enabled for this environment.',
  },
  filters: {
    siteLabel: 'Site',
    siteFallbackPrefix: 'Site',
    statusLabel: 'Status',
    allStatuses: 'All statuses',
    statuses: {
      OPEN: 'Open',
      RESPONDED: 'Responded',
      CLOSED: 'Closed',
      CANCELLED: 'Cancelled',
    },
  },
  createPanel: {
    episodeSectionLabel: 'Source episode',
    prefilledEpisodeLabel: 'Selected episode',
    episodeSelectLabel: 'Select Site episode',
    episodeSelectPlaceholder: 'Choose an episode to request identification...',
    episodeLoading: 'Loading Site episodes...',
    episodeEmpty: 'No safety episodes are available for the selected Site.',
    episodeRequiredError: 'Select an episode before creating an identification request.',
    conflictLockedNotice:
      ' Server state changed. Your draft is preserved — refresh before retrying.',
  },
  queue: {
    title: 'Identification requests',
    listAriaLabel: 'Safety identification requests',
    loading: 'Loading identification queue...',
    emptyTitle: 'No matching requests',
    emptyOfficerDescription: 'No identification requests match the current filter for this Site.',
    emptyManagerDescription:
      'No identification requests are currently assigned to you under the selected filter.',
    retryLabel: 'Retry',
    showingRange: (from, to, total) => `Showing ${from}–${to} of ${total}`,
    zeroTotal: '0 requests',
    previousPage: 'Previous',
    nextPage: 'Next',
    episodePrefix: 'Episode',
    versionPrefix: (version) => `Version v${version}`,
    duePrefix: 'Due',
    createdPrefix: 'Created',
    proposalPrefix: 'Current proposal',
  },
  waitingByStatus: {
    OPEN: {
      waitingLabel: 'Waiting on',
      waitingActor: 'Assigned Site Manager',
      nextActionLabel: 'Next permitted action',
      nextAction:
        'Site Manager submits an identification response; Safety Officer may reassign (if Site Manager changed) or cancel.',
    },
    RESPONDED: {
      waitingLabel: 'Waiting on',
      waitingActor: 'Safety Officer',
      nextActionLabel: 'Next permitted action',
      nextAction:
        'Safety Officer accepts the proposal to close the request, returns it to the Site Manager, or reassigns / cancels.',
    },
    CLOSED: {
      waitingLabel: 'Waiting on',
      waitingActor: 'None (request closed)',
      nextActionLabel: 'Next permitted action',
      nextAction:
        'No further action on this request; any Incident responsibility or Corrective Action is decided separately by a Safety Officer in Incidents.',
    },
    CANCELLED: {
      waitingLabel: 'Waiting on',
      waitingActor: 'None (request cancelled)',
      nextActionLabel: 'Next permitted action',
      nextAction:
        'Request ended without an accepted conclusion; Safety Officer may create a new request from the episode if verification is still needed.',
    },
  },
  outcomes: {
    UNRESOLVED: 'Unresolved',
    PARTIAL: 'Partial (contractor only)',
    IDENTIFIED: 'Worker identified',
    DISPUTED: 'Disputed / out of scope',
  },
  detail: {
    emptyTitle: 'Select a request to inspect',
    emptyDescription:
      'Choose an identification request from the queue to inspect episode subject metadata, evidence availability, current proposals, and permitted actions.',
    title: 'Identification request details',
    refreshLabel: 'Refresh details',
    loading: 'Loading latest request details...',
    technicalDetailsLabel: 'Technical details',
    requestIdLabel: 'Request ID',
    evidenceOneLine: 'Subject image is unavailable — review using request details only.',
    metadataTitle: 'Request & subject metadata',
    episodeLabel: 'Episode ID',
    subjectLabel: 'Episode subject',
    subjectTracked: (segmentId) => `Tracked subject (TRACKED) · Segment ${segmentId}`,
    subjectScopeHash: 'Scope SHA-256',
    subjectEventLocal: (eventId, personIndex) =>
      `Event-local observation (EVENT_LOCAL) · Event ${eventId} · Person #${personIndex}`,
    requestedByLabel: 'Requested by (Safety Officer)',
    assignedToLabel: 'Assigned to (Site Manager)',
    createdAtLabel: 'Created at',
    updatedAtLabel: 'Last updated',
    dueAtLabel: 'Due at',
    noDueDate: 'No due date',
    requestReasonLabel: 'Identification request reason',
    evidenceTitle: 'Subject evidence availability',
    evidenceUnavailableBadge: 'Unavailable',
    evidenceReasonCodeLabel: 'Technical reason code',
    evidenceUnavailableBody: 'Subject image is unavailable — review using request details only.',
    separationTitle: 'Domain fact separation',
    separationBody:
      'Site Manager candidate proposals, Officer-accepted request conclusions, Incident responsibility, and Corrective Action closure remain separate records — closing never triggers automatic contractor handover or global identity writes.',
    proposalTitle: 'Current Site Manager proposal',
    proposalEmpty: 'No proposal is recorded for the current open version.',
    proposalOutcomeLabel: 'Proposed outcome',
    proposalWorkerLabel: 'Proposed worker',
    proposalContractorLabel: 'Proposed contractor',
    proposalNotSpecified: 'None selected',
    proposalRecordedInTechnical: 'Recorded (see technical details)',
    proposalRespondedByLabel: 'Responded by',
    proposalRespondedAtLabel: 'Responded at',
    proposalReasonLabel: 'Response rationale',
    conflictBannerTitle: 'Request version or state changed (409)',
    conflictBannerBody:
      'Your draft has been preserved. Load the latest request version before retrying your submission.',
    conflictRefreshButton: 'Load latest version',
    managerSelfRequestNotice:
      'You created this identification request, so you cannot respond to it as Site Manager.',
    managerReadOnlyStatusNotice:
      'This request is not currently Open, so the Site Manager response form is locked.',
    reviewTitle: 'Review Site Manager proposal',
    reviewSubtitle:
      'Accept the proposal to record the request conclusion and close it, or return the request to the Site Manager for follow-up.',
    reviewReasonLabel: 'Review reason',
    reviewReasonPlaceholder:
      'Record why you accept this proposal or what the Site Manager should re-check...',
    reviewReasonHint: 'Required, 1 to 2000 characters.',
    acceptButton: 'Accept & close request',
    acceptingButton: 'Accepting...',
    returnButton: 'Return to Site Manager',
    returningButton: 'Returning...',
    adminActionsTitle: 'Officer request controls',
    adminActionsSubtitle:
      'Reassign when the eligible Site Manager has changed, or cancel the request when identification is no longer needed.',
    reassignToggle: 'Reassign Manager',
    cancelToggle: 'Cancel request',
    reassignTargetLabel: 'Current eligible Site Manager',
    reassignLoading: 'Checking eligible Site Manager...',
    reassignUnavailable: 'No eligible Site Manager available',
    reassignSameAssigneeNotice:
      'The current eligible Site Manager already matches the assigned recipient, so reassignment is not available.',
    reassignReasonLabel: 'Reassignment reason',
    reassignReasonPlaceholder: 'Explain why this request is being reassigned...',
    reassignSubmit: 'Confirm reassignment',
    reassignSubmitting: 'Reassigning...',
    cancelReasonLabel: 'Cancellation reason',
    cancelReasonPlaceholder: 'Explain why this identification request is being cancelled...',
    cancelWarning: 'Once cancelled, this request moves to Cancelled and cannot be reopened.',
    cancelSubmit: 'Confirm cancellation',
    cancelSubmitting: 'Cancelling...',
    closedFollowUpTitle: 'Request closed — No automatic contractor handover',
    closedFollowUpBody:
      'This identification request conclusion is recorded independently. If confirmed safety findings require Incident responsibility or contractor Corrective Actions, perform that separately in Incidents (MF08).',
    openIncidentsLink: 'Open Incidents workspace (MF08)',
    returnToInboxLink: 'Back to the Inbox record',
    originCaseContextNotice: 'Opened from a Safety Inbox person case.',
    cancelledFollowUpTitle: 'Request cancelled',
    cancelledFollowUpBody:
      'This request ended without an accepted identification conclusion. You may open a new identification request for the same episode if verification is still needed.',
    createFollowUpButton: 'Create new request for this episode',
    historyTitle: 'Audit history (Safety Officer only)',
    historySubtitle: 'Immutable per-version record of identification actions.',
    historyLoading: 'Loading request history...',
    historyEmpty: 'No history entries recorded.',
    historyKinds: {
      CREATE: 'Created',
      RESPOND: 'Responded',
      ACCEPT: 'Accepted & closed',
      RETURN: 'Returned',
      REASSIGN: 'Reassigned',
      CANCEL: 'Cancelled',
    },
    historyActorLabel: 'Actor',
    historyAssignedToLabel: 'Assigned to',
    historyProposalLabel: 'Recorded proposal',
  },
  validation: {
    reasonRequired: 'Enter a reason before submitting this action.',
    reasonTooLong: 'Reason must be at most 2000 characters.',
    reassignUnavailable: 'No different eligible Site Manager is available for reassignment.',
  },
  knownErrors: {
    'An active identification request already exists':
      'An open or responded identification request already exists for this episode.',
    'Identification request version changed':
      'The identification request version changed on the server. Load the latest version before retrying.',
    'Identification request state changed':
      'The identification request status changed on the server. Load the latest version before retrying.',
    'Identification proposal is unavailable':
      'The submitted proposal is unavailable or its worker/contractor candidate is no longer eligible on this Site.',
    'Identification command already used':
      'This command identifier was already used with different parameters.',
    'Select the current Site Manager':
      'The selected recipient is no longer the current eligible Site Manager. Refresh assignee details.',
    'Select a different Site Manager':
      'Reassignment requires an eligible Site Manager different from the current assignee and requester.',
    'Invalid identification proposal':
      'The identification proposal does not match the selected outcome or Site worker/contractor scope.',
    'Worker does not belong to the selected contractor':
      'The selected worker does not belong to the selected contractor on this Site.',
    'Select an active site worker': 'The selected worker is not currently active on this Site.',
    'Select a participating site contractor':
      'The selected contractor is not currently participating on this Site.',
    'Request evidence is unavailable':
      'Evidence references cannot be attached while subject derivative media is unavailable.',
    'A reason is required': 'Enter a non-empty reason.',
  },
};
