import type {
  SafetyIdentificationHistoryEntry,
  SafetyIdentificationOutcome,
  SafetyIdentificationStatus,
} from '@smartsite/contracts/safety-identification';

export type StatusFilterValue = 'ALL' | SafetyIdentificationStatus;
export type HistoryKind = SafetyIdentificationHistoryEntry['kind'];

export interface WaitingGuidanceCopy {
  waitingLabel: string;
  waitingActor: string;
  nextActionLabel: string;
  nextAction: string;
}

export interface IdentificationWorkspaceCopy {
  header: {
    eyebrow: string;
    title: string;
    officerSubtitle: string;
    managerSubtitle: string;
    officerBadge: string;
    managerBadge: string;
    refreshQueue: string;
    newFromEpisode: string;
    closeCreate: string;
  };
  access: {
    deniedTitle: string;
    deniedDescription: string;
  };
  unavailable: {
    badgeLabel: string;
    queueTitle: string;
    queueDescription: string;
    detailTitle: string;
    detailDescription: string;
  };
  filters: {
    siteLabel: string;
    siteFallbackPrefix: string;
    statusLabel: string;
    allStatuses: string;
    statuses: Record<SafetyIdentificationStatus, string>;
  };
  createPanel: {
    episodeSectionLabel: string;
    prefilledEpisodeLabel: string;
    episodeSelectLabel: string;
    episodeSelectPlaceholder: string;
    episodeLoading: string;
    episodeEmpty: string;
    episodeRequiredError: string;
    conflictLockedNotice: string;
  };
  queue: {
    title: string;
    listAriaLabel: string;
    loading: string;
    emptyTitle: string;
    emptyOfficerDescription: string;
    emptyManagerDescription: string;
    retryLabel: string;
    showingRange: (from: number, to: number, total: number) => string;
    zeroTotal: string;
    previousPage: string;
    nextPage: string;
    episodePrefix: string;
    versionPrefix: (version: number) => string;
    duePrefix: string;
    createdPrefix: string;
    proposalPrefix: string;
  };
  waitingByStatus: Record<SafetyIdentificationStatus, WaitingGuidanceCopy>;
  outcomes: Record<SafetyIdentificationOutcome, string>;
  detail: {
    emptyTitle: string;
    emptyDescription: string;
    title: string;
    refreshLabel: string;
    loading: string;
    technicalDetailsLabel: string;
    requestIdLabel: string;
    evidenceOneLine: string;
    metadataTitle: string;
    episodeLabel: string;
    subjectLabel: string;
    subjectSummaryTracked: string;
    subjectSummaryEventLocal: (personIndex: number) => string;
    subjectTracked: (segmentId: string) => string;
    subjectScopeHash: string;
    subjectEventLocal: (eventId: string, personIndex: number) => string;
    requestedByLabel: string;
    assignedToLabel: string;
    createdAtLabel: string;
    updatedAtLabel: string;
    dueAtLabel: string;
    noDueDate: string;
    requestReasonLabel: string;
    evidenceTitle: string;
    evidenceSummaryShared: (count: number) => string;
    evidenceSummaryNoneAttached: string;
    approvedEvidenceCardTitle: string;
    approvedEvidenceCardHint: string;
    evidenceUnavailableBadge: string;
    evidenceReasonCodeLabel: string;
    evidenceUnavailableBody: string;
    separationTitle: string;
    separationBody: string;
    lifecycleStripAriaLabel: string;
    lifecycleStage1Title: string;
    lifecycleStage1Awaiting: string;
    lifecycleStage1Submitted: string;
    lifecycleStage1Cancelled: string;
    lifecycleStage1CancelledWithProposal: string;
    lifecycleStage2Title: string;
    lifecycleStage2Pending: string;
    lifecycleStage2Accepted: string;
    lifecycleStage2Cancelled: string;
    lifecycleStage2UnknownNote: string;
    lifecycleStage3Title: string;
    lifecycleStage3Body: string;
    proposalTitle: string;
    proposalAcceptedTitle: string;
    proposalCancelledTitle: string;
    proposalPendingBadge: string;
    proposalAcceptedBadge: string;
    proposalCancelledBadge: string;
    proposalCancelledPrefix: string;
    proposalEmpty: string;
    proposalOutcomeLabel: string;
    proposalWorkerLabel: string;
    proposalContractorLabel: string;
    proposalNotSpecified: string;
    proposalRecordedInTechnical: string;
    proposalRespondedByLabel: string;
    proposalRespondedAtLabel: string;
    proposalReasonLabel: string;
    conflictBannerTitle: string;
    conflictBannerBody: string;
    conflictRefreshButton: string;
    managerSelfRequestNotice: string;
    managerReadOnlyStatusNotice: string;
    reviewTitle: string;
    reviewSubtitle: string;
    reviewReasonLabel: string;
    reviewReasonPlaceholder: string;
    reviewReasonHint: string;
    acceptButton: string;
    acceptingButton: string;
    returnButton: string;
    returningButton: string;
    adminActionsTitle: string;
    adminActionsSubtitle: string;
    reassignToggle: string;
    cancelToggle: string;
    reassignTargetLabel: string;
    reassignLoading: string;
    reassignUnavailable: string;
    reassignSameAssigneeNotice: string;
    reassignReasonLabel: string;
    reassignReasonPlaceholder: string;
    reassignSubmit: string;
    reassignSubmitting: string;
    cancelReasonLabel: string;
    cancelReasonPlaceholder: string;
    cancelWarning: string;
    cancelSubmit: string;
    cancelSubmitting: string;
    closedFollowUpTitle: string;
    closedFollowUpBody: string;
    openIncidentsLink: string;
    returnToInboxLink: string;
    originCaseContextNotice: string;
    cancelledFollowUpTitle: string;
    cancelledFollowUpBody: string;
    createFollowUpButton: string;
    historyTitle: string;
    historySubtitle: string;
    historyLoading: string;
    historyEmpty: string;
    historyKinds: Record<HistoryKind, string>;
    historyActorLabel: string;
    historyAssignedToLabel: string;
    historyProposalLabel: string;
  };
  validation: {
    reasonRequired: string;
    reasonTooLong: string;
    reassignUnavailable: string;
  };
  knownErrors: Record<string, string>;
}
