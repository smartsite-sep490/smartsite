import { hasRegisteredFeatureKey, registerFeatureCatalog } from './feature-catalog-registry';

export const PPE_EN_CATALOG = {
  'ppe.wall.sourceReplay': 'REPLAY',
  'ppe.wall.sourceLive': 'LIVE',
  'ppe.wall.sourceConnecting': 'CONNECTING',
  'ppe.wall.sourceUnavailable': 'UNAVAILABLE',
  'ppe.error.metadata401': 'Session expired or unauthorized. Please sign in again.',
  'ppe.error.metadata403': 'You do not have permission to access this resource.',
  'ppe.error.site404': 'Site resource unavailable.',
  'ppe.error.camera404': 'Camera resource unavailable.',
  'ppe.error.siteLoadFailed': 'Could not load sites. Please try again.',
  'ppe.error.cameraLoadFailed': 'Could not load cameras. Please try again.',

  'ppe.preset.FULL_EIGHT.label': 'Full eight',
  'ppe.preset.FULL_EIGHT.shortLabel': 'Full 8',
  'ppe.preset.FULL_EIGHT.description': 'All 8 positive PPE object families',
  'ppe.preset.GROUND.label': 'Ground (Helmet/Vest/Gloves/Boots)',
  'ppe.preset.GROUND.shortLabel': 'Ground',
  'ppe.preset.GROUND.description': 'Helmet, Vest, Gloves, Boots',
  'ppe.preset.EYE_FACE.label': 'Eye/face (Goggles/Mask)',
  'ppe.preset.EYE_FACE.shortLabel': 'Eye/face',
  'ppe.preset.EYE_FACE.description': 'Goggles, Mask',
  'ppe.preset.HEIGHT.label': 'Height (Harness/Hook)',
  'ppe.preset.HEIGHT.shortLabel': 'Height',
  'ppe.preset.HEIGHT.description': 'Harness, Hook',

  'ppe.context.siteScopeFallback': 'Site Scope',
  'ppe.context.noCameraSelected': 'No camera selected',
  'ppe.trackLabel': 'Track #{id}',
  'ppe.untrackedLabel': 'Unknown track',
  'ppe.event.defaultIssue': 'PPE Inspection Issue',
  'ppe.event.statusSnapshotObservation': 'Snapshot Observation',
  'ppe.event.statusObservationActive': 'Observation Active',
  'ppe.event.statusScanning': 'Scanning',

  'ppe.header.badge': 'MF05 Realtime Compliance',
  'ppe.header.title': 'PPE Compliance Monitoring',
  'ppe.header.subtitle':
    'Single-snapshot detector evidence paired with verified server-tracked missing episodes.',
  'ppe.header.status.paused': 'AI Work Paused',
  'ppe.header.status.live': 'Live Monitored',
  'ppe.header.status.replay': 'Replay Mode',
  'ppe.header.status.standby': 'Feed Standby',

  'ppe.pausedBanner.title': 'AI Work Paused by Human Operator',
  'ppe.pausedBanner.summary':
    'Inference and camera analysis paused; zone and region setup remains active.',
  'ppe.pausedBanner.detailsToggle': 'Operational details',
  'ppe.pausedBanner.description':
    'All AI model inference, camera stream analysis, and demo source deployment actions are temporarily paused by human directive. Zone and region configuration remains active and can be saved.',

  'ppe.sessionExpired.title': 'Session pending or expired',
  'ppe.sessionExpired.description':
    'PPE monitoring session is pending or expired. Please sign in to the application to monitor camera feeds.',

  'ppe.layout.monitoringScope': 'Monitoring scope',
  'ppe.layout.configuration': 'Configuration',
  'ppe.check.notesSummary': 'Observation scope & experimental notes',

  'ppe.scope.siteLabel': 'Site',
  'ppe.scope.loadedCount': '({loaded}/{total} loaded)',
  'ppe.scope.loadingSites': 'Loading sites…',
  'ppe.scope.retryingSites': 'Retrying sites…',
  'ppe.scope.retrySites': 'Retry loading sites',
  'ppe.scope.retryingMoreSites': 'Retrying more sites…',
  'ppe.scope.retryMoreSites': 'Retry loading more sites',
  'ppe.scope.loadingMoreSites': 'Loading more sites…',
  'ppe.scope.loadMoreSites': 'Load more sites',

  'ppe.scope.cameraLabel': 'Camera',
  'ppe.scope.loadingCameras': 'Loading cameras…',
  'ppe.scope.refreshingCameras': 'Refreshing cameras…',
  'ppe.scope.retryingCameras': 'Retrying cameras…',
  'ppe.scope.retryCameras': 'Retry loading cameras',
  'ppe.scope.retryingMoreCameras': 'Retrying more cameras…',
  'ppe.scope.retryMoreCameras': 'Retry loading more cameras',
  'ppe.scope.loadingMoreCameras': 'Loading more cameras…',
  'ppe.scope.loadMoreCameras': 'Load more cameras',
  'ppe.scope.noCameraMonitoringAccess':
    'This account does not have camera monitoring access to this site.',

  'ppe.admin.configureByZone': 'Configure PPE by Zone',
  'ppe.admin.registerCamera': 'Register camera',
  'ppe.admin.manageCamera': 'Manage camera',
  'ppe.admin.registrationSuccess':
    'Camera metadata registered. Video availability is checked separately in monitoring.',
  'ppe.admin.dismissStatusAria': 'Dismiss status',
  'ppe.admin.dismiss': 'Dismiss',

  'ppe.viewMode.groupAria': 'Monitoring view mode',
  'ppe.viewMode.single': 'Single Focus',
  'ppe.viewMode.wall': '4-Source Wall',
  'ppe.cadence.paused': 'AI Monitoring Paused',
  'ppe.cadence.wall': 'Wall Monitoring: Up to 4 Feeds',
  'ppe.cadence.single': 'Monitoring Cadence: 500ms (focused)',
  'ppe.cadence.pollingWallTitle': 'Polling active (1s wall / 500ms focused)',
  'ppe.cadence.pollingSingleTitle': 'Polling active (500ms)',

  'ppe.empty.noSites': 'No authorized sites available for monitoring.',
  'ppe.empty.noCamerasLoadedYet':
    'No cameras from this site loaded yet. More camera pages are available.',
  'ppe.empty.noCamerasInScope': 'No cameras available in this site scope.',

  'ppe.overview.heading': 'Camera Overview · {count} loaded cameras',
  'ppe.overview.clickHint': 'Click feed chip to focus',
  'ppe.overview.selectedTitle': 'Selected camera',
  'ppe.overview.selectTitle': 'Select camera',
  'ppe.overview.selectedAria': 'Selected',

  'ppe.wall.heading': '4-Source Wall Monitoring',
  'ppe.wall.subtitle': '(Up to 4 authorized feeds · Click tile to focus)',
  'ppe.wall.switchToSingle': 'Single Focus View',
  'ppe.wall.context.focusedBadge': 'Focused',
  'ppe.wall.context.siteLabel': 'Site',
  'ppe.wall.context.cameraLabel': 'Camera',
  'ppe.wall.context.zonesLabel': 'Zones',
  'ppe.wall.context.loadingZones': 'Loading zones…',
  'ppe.wall.context.noZonesLinked': 'No zones linked',
  'ppe.wall.context.unresolvedZones': '{count} unresolved region(s)',
  'ppe.wall.context.zonesUnavailable': 'Zones temporarily unavailable',
  'ppe.wall.context.zonesAccessDenied': 'Zone metadata unavailable (access denied)',
  'ppe.wall.context.partialLoadError':
    'Partially loaded ({loaded}/{total}) · Could not load more zones',
  'ppe.wall.context.loadMoreZones': 'Load more zones',
  'ppe.wall.context.loadingMoreZones': 'Loading more zones…',
  'ppe.wall.context.retryZones': 'Reload zones',

  'ppe.viewport.pausedTitle': 'Camera preview paused',
  'ppe.viewport.pausedDesc':
    'AI and video streams are paused. You can still manage Zone requirements and saved camera regions.',
  'ppe.viewport.applyingTitle': 'Applying Demo Region...',
  'ppe.viewport.applyingDesc': 'Awaiting fresh camera snapshot after region reconfiguration.',

  'ppe.viewport.rawConnectingTitle': 'Connecting to raw LIVE stream...',
  'ppe.viewport.rawConnectingDesc': 'Authenticated continuous NDJSON stream.',
  'ppe.viewport.rawStalledTitle': 'Raw Live Stream Stalled',
  'ppe.viewport.rawStalledDesc': 'No fresh frames received for more than 2 seconds (2s media TTL).',
  'ppe.viewport.reconnectStream': 'Reconnect Stream',
  'ppe.viewport.rawAccessDeniedTitle': 'Camera Access Denied',
  'ppe.viewport.rawUnavailableTitle': 'Raw Live Stream Unavailable',
  'ppe.viewport.rawError401': 'Your session has expired. Sign in again to view this camera.',
  'ppe.viewport.rawError403': 'You do not have permission to view this camera.',
  'ppe.viewport.rawError429':
    'Too many requests. The stream will reconnect automatically after the server waiting period.',
  'ppe.viewport.rawError503': 'The camera source is offline. Check its connection or try again.',
  'ppe.viewport.rawErrorDefault': 'No active raw video stream available for the selected camera.',
  'ppe.viewport.retryStream': 'Retry Stream',
  'ppe.viewport.switchToAiEvidence': 'Switch to AI Evidence',

  'ppe.viewport.recordedLoadingTitle': 'Loading recorded video MP4...',
  'ppe.viewport.recordedLoadingDesc': 'Authenticated video stream (bounded ≤2MB).',
  'ppe.viewport.recordedAccessDeniedTitle': 'Recorded Video Access Denied',
  'ppe.viewport.recordedUnavailableTitle': 'Recorded Video Unavailable',
  'ppe.viewport.recordedError401':
    'Your session has expired. Sign in again to view this recorded video.',
  'ppe.viewport.recordedError403': 'You do not have permission to view this recorded video.',
  'ppe.viewport.recordedErrorDefault':
    'No active recorded video available for the selected camera.',
  'ppe.viewport.retryVideo': 'Retry Video',

  'ppe.viewport.snapshotConnectingTitle': 'Connecting to camera snapshot (500ms)...',
  'ppe.viewport.snapshotConnectingDesc': 'Authorized site and camera scope verified.',
  'ppe.viewport.snapshotUnavailableTitle': 'Camera Snapshot Unavailable',
  'ppe.viewport.snapshotErrorDefault':
    'No active camera snapshot available for the selected camera.',
  'ppe.viewport.snapshotCooldown429': 'Automatic retry resumes after server cooldown.',
  'ppe.viewport.retrySnapshot': 'Retry Snapshot',

  'ppe.badge.rawTitleLive': 'RAW LIVE STREAM · Unanalyzed Video',
  'ppe.badge.rawTitleStalled': 'RAW LIVE STREAM · Stalled (2s TTL)',
  'ppe.badge.rawTitleUnavailable': 'RAW LIVE STREAM · Unavailable',
  'ppe.badge.recordedTitleReady': 'RECORDED RAW VIDEO · Independent Playback · Not Synced to AI',
  'ppe.badge.recordedTitleLoading': 'RECORDED RAW VIDEO · Loading',
  'ppe.badge.recordedTitleUnavailable': 'RECORDED RAW VIDEO · Unavailable',
  'ppe.badge.aiPaused': 'AI WORK PAUSED',
  'ppe.badge.aiLiveSnapshot': 'MF05 LIVE SNAPSHOT (500ms)',
  'ppe.badge.aiReplaySnapshot': 'MF05 REPLAY SNAPSHOT (500ms)',
  'ppe.badge.aiSnapshotUnavailable': 'MF05 SNAPSHOT UNAVAILABLE',
  'ppe.badge.rawPrefix': 'RAW LIVE STREAM',
  'ppe.badge.rawStateLive': 'Unanalyzed Video',
  'ppe.badge.rawStateStalled': 'Stalled (2s TTL)',
  'ppe.badge.rawStateConnecting': 'Connecting',
  'ppe.badge.stateUnavailable': 'Unavailable',
  'ppe.badge.recordedPrefix': 'RECORDED RAW VIDEO',
  'ppe.badge.recordedStateReady': 'Independent Playback (Not Synced to AI)',
  'ppe.badge.recordedStateLoading': 'Loading',
  'ppe.badge.resultMissing': 'MISSING PPE',
  'ppe.badge.resultVerifying': 'VERIFYING PPE',
  'ppe.badge.resultCompliant': 'CORE PPE OBSERVED',
  'ppe.badge.resultUnknown': 'PPE UNKNOWN',
  'ppe.badge.resultNoTargets': 'NO TARGETS',

  'ppe.viewport.emptyFrameReplay': 'Replay Snapshot Active · No Person detections in frame',
  'ppe.viewport.emptyFrameLive': 'Live Snapshot Active · No Person detections in frame',
  'ppe.viewport.sourceBadge': 'SOURCE: {source}',

  'ppe.toolbar.videoModeGroupAria': 'Video presentation mode',
  'ppe.toolbar.liveRawBtn': 'Live video (Raw)',
  'ppe.toolbar.aiEvidenceBtn': 'AI evidence (Boxes)',
  'ppe.toolbar.recordedModeGroupAria': 'Recorded video presentation mode',
  'ppe.toolbar.recordedRawBtn': 'Recorded video (Raw)',
  'ppe.toolbar.replayAiOnly': 'REPLAY · AI evidence only',
  'ppe.toolbar.captionPaused': 'AI monitoring & streaming paused',
  'ppe.toolbar.captionLiveRaw':
    'Raw source independent (capped 8 frames/s) · AI snapshot polling: 500ms',
  'ppe.toolbar.captionRecordedRaw':
    'Recorded raw MP4 · Source-independent playback (not synced to AI)',
  'ppe.toolbar.captionAiPolling': 'AI snapshot polling: 500ms',
  'ppe.toolbar.switchToWallAria': 'Switch to 4-source wall view',

  'ppe.card.headerTitle': 'AI DETECTION',
  'ppe.card.rawUnanalyzedBadge': 'RAW VIEW UNANALYZED',
  'ppe.card.recordedUnanalyzedBadge': 'RECORDED RAW · NOT SYNCED TO AI',
  'ppe.card.noDetectionBadge': 'NO-DETECTION',
  'ppe.card.evidenceUnavailableBadge': 'AI EVIDENCE UNAVAILABLE',
  'ppe.card.pausedEmptyTitle': 'AI inspection paused — no current evidence',
  'ppe.card.pausedEmptyDesc':
    'Camera stream analysis and snapshot PPE checks are paused. No live detections are being evaluated.',

  'ppe.card.fieldIdentity': 'Identity',
  'ppe.card.identitySnapshotUnavailable': 'AI snapshot unavailable',
  'ppe.card.identityUnknown': 'Unknown — not identified',
  'ppe.card.identityNoPerson': 'No person detected',
  'ppe.card.fieldTrackId': 'Track ID',
  'ppe.card.fieldCamera': 'Camera',
  'ppe.card.fieldWorkArea': 'Work Area',
  'ppe.card.fieldDetected': 'Detected',
  'ppe.card.fieldConfidence': 'Detection Confidence',

  'ppe.check.heading': 'PPE CHECK',
  'ppe.check.experimentalBadge': 'EXPERIMENTAL (5 ITEMS)',
  'ppe.check.coreNote':
    'Core observations: Helmet & Safety Vest. Expanded items are evaluated when reported.',
  'ppe.check.experimentalNote':
    'Experimental 5 AI observations (Helmet, Vest, Gloves, Boots, Goggles): unsupported items remain Unknown. Zero detections do not certify safety clearance.',
  'ppe.check.unavailableTitle': 'AI Evidence Snapshot Unavailable',
  'ppe.check.unavailableRawDesc':
    'Displaying unanalyzed raw camera feed. Periodic snapshot inspection is offline or not received.',
  'ppe.check.unavailableDefaultDesc': 'No active AI preview snapshot received for this camera.',
  'ppe.check.noTrackedIndividuals': 'No tracked individuals in current snapshot',

  'ppe.item.HARD_HAT': 'Helmet',
  'ppe.item.SAFETY_VEST': 'Safety Vest',
  'ppe.item.GLOVES': 'Gloves',
  'ppe.item.BOOTS': 'Boots',
  'ppe.item.GOGGLES': 'Goggles',

  'ppe.status.CONFIRMED_MISSING': 'Missing · confirmed',
  'ppe.status.PENDING_MISSING': 'Missing · checking',
  'ppe.status.PRESENT': 'Detected',
  'ppe.status.NOT_REPORTED': 'Not reported',
  'ppe.status.UNKNOWN': 'Unknown',

  'ppe.episodeWarning.title': 'Active confirmed episode: Missing · confirmed',
  'ppe.episodeWarning.currentSnapshot': 'Current snapshot: {status}',
  'ppe.episodeWarning.descUnknown':
    'Unknown means insufficient current evidence and does not clear confirmed episode.',
  'ppe.episodeWarning.descNotReported':
    'Not reported indicates current snapshot omitted item evidence and does not clear confirmed episode.',
  'ppe.episodeWarning.descPresent':
    'Previous missing episode still confirmed until sustained clearance is verified.',
  'ppe.episodeWarning.descDefault': 'Previous missing episode still confirmed.',

  'ppe.card.rawObjectsCountLink': '{count} raw detector object(s) in drawer ↓',
  'ppe.card.viewDiagnosticsLink': 'View detector diagnostics in drawer ↓',

  'ppe.result.label': 'RESULT',
  'ppe.result.missingDetected': 'MISSING PPE DETECTED',
  'ppe.result.coreAndReportedDetected': 'CORE AND REPORTED PPE DETECTED',
  'ppe.result.helmetAndVestDetected': 'HELMET AND VEST DETECTED',
  'ppe.result.evidenceUnavailable': 'AI EVIDENCE UNAVAILABLE',
  'ppe.result.noObservations': 'NO OBSERVATIONS',
  'ppe.result.scanningSnapshot': 'SCANNING SNAPSHOT',
  'ppe.result.descRawUnavailable':
    'Displaying unanalyzed raw camera feed. AI snapshot inspection is currently unavailable.',
  'ppe.result.descSnapshotOffline': 'Camera snapshot is unavailable or offline.',
  'ppe.result.descCompliantExpanded':
    'Helmet, safety vest, and reported expanded PPE items detected.',
  'ppe.result.descCompliantCoreOnly': 'Expanded items (gloves, boots, goggles) are not assessed.',
  'ppe.result.descMissing': 'Missing PPE observed in snapshot.',
  'ppe.result.descZeroDetectionsReplay':
    'Rendering recorded video replay stream from Camera Preview API. Zero detections do not certify safety clearance.',
  'ppe.result.descZeroDetectionsLive':
    'Streaming live snapshot from Camera Preview API. Zero detections do not certify safety clearance.',
  'ppe.result.descStreamingReplay':
    'Rendering recorded video replay stream from Camera Preview API.',
  'ppe.result.descStreamingLive': 'Streaming live snapshot from Camera Preview API.',

  'ppe.action.reviewAlert': 'Review Alert',

  'ppe.diagnostics.title': 'Technical diagnostics',
  'ppe.diagnostics.subtitle': 'Experimental detector output and demo controls.',
  'ppe.diagnostics.collapseBtn': 'Collapse Diagnostics ↑',
  'ppe.diagnostics.expandBtn': 'Expand Diagnostics ↓',
  'ppe.diagnostics.experimentalObjectsTitle': 'Experimental objects',
  'ppe.diagnostics.objectDetectedBadge': 'Object detected',
  'ppe.diagnostics.noObjectInFrame': 'No object detection in this frame',
  'ppe.diagnostics.boxesOn': 'Boxes On',
  'ppe.diagnostics.boxesOff': 'Boxes Off',
  'ppe.diagnostics.raw15ClassDisclaimer':
    'Raw 15-class detector observations. Object detection only, NOT wearer-compliance states or persisted alerts. Zero detections do not certify safety clearance.',
  'ppe.diagnostics.presetHeading': 'Display focus preset',
  'ppe.diagnostics.presetSubnote': 'Non-persisted display filter',
  'ppe.diagnostics.presetGroupAria': 'Display focus presets',
  'ppe.diagnostics.presetDisclaimer':
    'Display focus only. Does not alter zone required PPE or certify compliance.',
  'ppe.diagnostics.objectOnlyTag': 'object-only',
  'ppe.diagnostics.negativeObservationsHeading': 'Negative observations (raw detector)',

  'ppe.observations.pausedHeading': 'AI observations paused',
  'ppe.observations.replayHeading': 'Replay AI Observations Active',
  'ppe.observations.liveHeading': 'Live AI Observations Active',
  'ppe.observations.pausedDesc':
    'AI monitoring is paused. Zone and camera configuration can still be managed; no new observations or evidence are being captured.',
  'ppe.observations.replayDesc':
    'Technical PPE detections are rendered from recorded video replay stream above. Sample replay timeline rows are hidden during stream playback. Durable safety alerts require Backend worker ingestion; review persisted records in Safety Alerts.',
  'ppe.observations.liveDesc':
    'Technical PPE detections are rendered directly on the live camera feed above. Sample replay timeline rows are hidden during live monitoring. Durable safety alerts require Backend worker ingestion; review persisted records in Safety Alerts.',
  'ppe.observations.viewInSafetyAlerts': 'View in Safety Alerts →',

  'ppe.table.heading': 'PPE Replay Observations',
  'ppe.table.subtitle':
    'Observations from the camera snapshot feed. Live safety alerts are available in Safety Alerts.',
  'ppe.table.filteredByTrack': ' (Filtered by Track #{id})',
  'ppe.table.colTime': 'Time',
  'ppe.table.colWorker': 'Track / Worker',
  'ppe.table.colCamera': 'Camera',
  'ppe.table.colWorkArea': 'Work Area',
  'ppe.table.colIssue': 'Observed Issue',
  'ppe.table.colConfidence': 'Confidence',
  'ppe.table.colStatus': 'Status',
  'ppe.table.colAction': 'Action',
  'ppe.table.empty': 'No PPE events match the selected criteria.',

  'ppe.reviewModal.title': 'Violation Review',
  'ppe.reviewModal.description':
    'Review the scoped observation before continuing to Safety Alerts.',
  'ppe.reviewModal.subjectLabel': 'Subject:',
  'ppe.reviewModal.cameraLabel': 'Camera:',
  'ppe.reviewModal.workAreaLabel': 'Work Area:',
  'ppe.reviewModal.issueLabel': 'Observed Issue:',
  'ppe.reviewModal.timeLabel': 'Time:',
  'ppe.reviewModal.disclaimer':
    'Technical AI observations are informational evidence. Final safety compliance decisions remain with authorized safety officers.',
  'ppe.reviewModal.dismissBtn': 'Dismiss Preview',
  'ppe.reviewModal.continueBtn': 'Review in Safety Alerts',

  'mf06.detail.title': 'Recorded assessment',
  'mf06.detail.disclaimerTitle': 'Historical Technical Assessment · Not Access Permission',
  'mf06.detail.disclaimerBody':
    'This record represents a historical technical assessment projection. It does not confer, represent, or verify current worker identity, zone access permission, or alert status.',
  'mf06.detail.loading': 'Loading assessment details...',
  'mf06.detail.error.401': 'Session expired or unauthorized. Please sign in again.',
  'mf06.detail.error.403': 'You do not have permission to view this assessment.',
  'mf06.detail.error.404': 'Assessment record not found or unavailable.',
  'mf06.detail.error.503': 'Assessment service temporarily unavailable (503).',
  'mf06.detail.error.default': 'Could not load assessment details. Please try again.',
  'mf06.detail.retry': 'Retry',
  'mf06.detail.validationMismatch':
    'Assessment record does not match expected request context ({reason}).',
  'mf06.detail.outcome.ALLOWED': 'Allowed',
  'mf06.detail.outcome.DENIED': 'Denied',
  'mf06.detail.outcome.UNAVAILABLE': 'Unavailable',
  'mf06.detail.reason.AUTHORIZED': 'Authorized',
  'mf06.detail.reason.POLICY_NONE': 'Policy Allowed',
  'mf06.detail.reason.UNAUTHORIZED': 'Unauthorized',
  'mf06.detail.reason.POLICY_PROHIBITED': 'Prohibited by Policy',
  'mf06.detail.reason.INVALID_BINDING': 'Invalid Binding',
  'mf06.detail.reason.IDENTITY_UNAVAILABLE': 'Identity Unavailable',
  'mf06.detail.reason.MEDIA_UNAVAILABLE': 'Media Unavailable',
  'mf06.detail.reason.PROFILE_REVOKED': 'Profile Revoked',
  'mf06.detail.reason.AUTHORITY_UNAVAILABLE': 'Authority Unavailable',
  'mf06.detail.reason.SERVICE_DISABLED': 'Service Disabled',
  'mf06.detail.reason.ABORTED': 'Aborted',
  'mf06.detail.purpose.INITIAL_OBSERVATION_ASSESSMENT': 'Initial Observation',
  'mf06.detail.purpose.RETROSPECTIVE_REVIEW': 'Retrospective Review',
  'mf06.detail.field.captured': 'Captured:',
  'mf06.detail.field.assessed': 'Assessed:',
  'mf06.detail.field.assessmentId': 'Assessment ID:',
  'mf06.detail.field.requestId': 'Request ID:',
  'mf06.detail.field.eventId': 'Event ID:',
  'mf06.detail.field.cameraId': 'Camera ID:',
  'mf06.detail.field.zoneId': 'Zone ID:',
  'mf06.detail.field.provenance': 'Provenance:',

  'mf06.history.error.403': 'You do not have permission to view assessments for this site.',
  'mf06.history.error.404': 'Site or assessment resource unavailable.',
  'mf06.history.error.default': 'Could not load assessment history. Please try again.',
  'mf06.history.noSite': 'Select a site to view historical zone assessments.',
  'mf06.history.sectionAria': 'Restricted Zone Assessment History',
  'mf06.history.heading': 'MF06 Restricted Zone Assessment History',
  'mf06.history.total': 'Total: {total}',
  'mf06.history.disclaimer':
    'Historical records reflect technical camera observations at capture time. They do not constitute active access permissions, confirmed worker identity, or safety alerts.',
  'mf06.history.loading': 'Loading assessment history...',
  'mf06.history.emptyTitle': 'No recorded assessment history.',
  'mf06.history.emptyDesc': 'No zone assessments recorded for this site yet.',
  'mf06.history.viewAssessment': 'View assessment',
  'mf06.history.fieldCamera': 'Camera:',
  'mf06.history.fieldZone': 'Zone:',
  'mf06.history.technicalReferences': 'Technical references',
  'mf06.history.nextPageError': 'Failed to load additional assessments.',
  'mf06.history.retryNextPage': 'Retry loading next page',
  'mf06.history.loadingMore': 'Loading next 20...',
  'mf06.history.loadMore': 'Load more (20)',
  'mf06.case.moduleLabel': 'MF06',
  'mf06.case.reasonLabel': 'Reason:',
  'mf06.case.fieldPurpose': 'Purpose:',
  'mf06.case.fieldEvaluator': 'Evaluator:',
  'mf06.case.evidenceLabel': 'Evidence image:',
  'mf06.case.evidenceOpenRecord': 'View image in record (if available)',
  'mf06.case.identityTeamLabel': 'Person / Team:',
  'mf06.case.identityNotProjected': 'No public person/team data available',
  'mf06.case.currentCameraLabel': 'Camera (current catalog)',

  'mf06.panel.sectionAria': 'Restricted Zone Assessments and Requests',
  'mf06.panel.heading': 'MF06 Restricted Zone Assessments',
  'mf06.panel.tablistAria': 'Assessment views',
  'mf06.panel.tabAssessments': 'Assessments',
  'mf06.panel.tabRequests': 'Requests',

  'mf06.requests.jobStatus.NOT_QUEUED': 'Not Queued',
  'mf06.requests.jobStatus.PENDING': 'Pending',
  'mf06.requests.jobStatus.CLAIMED': 'Claimed (recorded)',
  'mf06.requests.jobStatus.SUCCEEDED': 'Succeeded',
  'mf06.requests.jobStatus.FAILED': 'Failed',
  'mf06.requests.jobStatus.CANCELLED': 'Cancelled',
  'mf06.requests.error.403': 'You do not have permission to view requests for this site.',
  'mf06.requests.error.404': 'Site or assessment request resource unavailable.',
  'mf06.requests.error.503': 'Request status service temporarily unavailable (503).',
  'mf06.requests.error.default': 'Could not load assessment requests. Please try again.',
  'mf06.requests.noSite': 'Select a site to view assessment requests.',
  'mf06.requests.bannerPausedTitle': 'AI Monitoring Paused · Technical Request State',
  'mf06.requests.bannerActiveTitle': 'Technical Request State · Metadata Only',
  'mf06.requests.bannerPausedBody':
    'AI evaluation pipelines are currently paused: no new AI evaluations are performed while paused, and request enqueue is inactive. Displayed requests reflect previously recorded states; persisted CLAIMED states represent historical records, not active worker execution. Technical observations do not convey access permissions or worker identity.',
  'mf06.requests.bannerActiveBody':
    'Displayed requests reflect technical queue and evaluation metadata only; no automated permissions or identity inferences are granted. Persisted CLAIMED states represent historical records, not active worker execution. Technical observations do not convey access permissions or worker identity.',
  'mf06.requests.refreshing': 'Refreshing...',
  'mf06.requests.refresh': 'Refresh',
  'mf06.requests.loading': 'Loading assessment requests...',
  'mf06.requests.emptyTitle': 'No recorded assessment requests.',
  'mf06.requests.emptyDesc': 'No zone evaluation requests recorded for this site yet.',
  'mf06.requests.deadlinePassed': 'Deadline Passed',
  'mf06.requests.attempts': 'Attempts: {count}',
  'mf06.requests.fieldRequested': 'Requested:',
  'mf06.requests.fieldDeadline': 'Deadline:',
  'mf06.requests.deadlineNone': 'None',
  'mf06.requests.nextPageError': 'Failed to load additional requests.',

  'dialog.closeAria': 'Close dialog',

  'zoneSetup.dialog.title': 'Zone PPE configuration',
  'zoneSetup.dialog.description': 'Define requirements and camera regions for {siteName}.',
  'zoneSetup.dialog.zonesDescription': 'Define PPE requirements for areas at {siteName}.',
  'zoneSetup.dialog.discardTitle': 'Discard unsaved Zone changes?',
  'zoneSetup.dialog.discardDescription': 'Your unsaved Zone fields and name changes will be lost.',
  'zoneSetup.dialog.keepEditing': 'Keep editing',
  'zoneSetup.dialog.discardChanges': 'Discard changes',

  'zoneSetup.title': 'Configure PPE by Zone',
  'zoneSetup.subtitlePrefix': 'Define mandatory PPE requirements for hazardous zones at',
  'zoneSetup.subtitleSuffix': '.',
  'zoneSetup.closeAria': 'Close',

  'zoneSetup.field.codeLabel': 'Zone Code',
  'zoneSetup.field.codePlaceholder': 'e.g. ZONE-HAZ-01',
  'zoneSetup.field.nameLabel': 'Zone Name',
  'zoneSetup.field.namePlaceholder': 'e.g. Scaffold Work Area',
  'zoneSetup.field.ppeLegend': 'Required PPE Selection',

  'zoneSetup.ppe.HARD_HAT': 'Hard Hat / Helmet',
  'zoneSetup.ppe.SAFETY_VEST': 'Safety Vest',
  'zoneSetup.ppe.GLOVES': 'Gloves',
  'zoneSetup.ppe.BOOTS': 'Boots',
  'zoneSetup.ppe.GOGGLES': 'Goggles',
  'zoneSetup.ppe.HARNESS': 'Harness',
  'zoneSetup.ppe.MASK': 'Mask',
  'zoneSetup.ppe.HOOK': 'Hook',
  'zoneSetup.ppe.coreTag': '(Core)',
  'zoneSetup.ppe.experimentalTag': '(Experimental)',
  'zoneSetup.ppe.experimentalNote': 'Technical capability · experimental',
  'zoneSetup.ppe.notAvailableNote': 'Not available as a zone requirement',

  'zoneSetup.action.cancel': 'Cancel',
  'zoneSetup.action.clearForm': 'Clear form',
  'zoneSetup.action.saving': 'Saving...',
  'zoneSetup.action.saveZonePpe': 'Save Zone PPE',

  'zoneSetup.validation.codeRequired': 'Zone Code is required.',
  'zoneSetup.validation.codeControlChars': 'Zone Code must not contain control characters.',
  'zoneSetup.validation.codeMaxLength': 'Zone Code must not exceed 64 characters.',
  'zoneSetup.validation.nameRequired': 'Zone Name is required.',
  'zoneSetup.validation.nameControlChars': 'Zone Name must not contain control characters.',
  'zoneSetup.validation.nameMaxLength': 'Zone Name must not exceed 255 characters.',
  'zoneSetup.validation.ppeRequired': 'At least one PPE item must be selected.',

  'zoneSetup.error.401': 'Session expired or unauthorized. Please sign in again.',
  'zoneSetup.error.403': 'You do not have permission to perform this action.',
  'zoneSetup.create.error.wrongScope':
    'Zone was created with an unexpected site scope. Please refresh.',
  'zoneSetup.create.error.409': 'A zone with this code already exists for this site.',
  'zoneSetup.create.error.default':
    'Failed to create zone. Please verify your inputs and network connection.',
  'zoneSetup.create.success':
    'Zone "{code}" created successfully. Link this zone to a camera observation region when ready.',

  'zoneSetup.rename.validation.controlChars':
    'Zone name must not contain control characters or surrogates.',
  'zoneSetup.rename.validation.required': 'Zone name is required.',
  'zoneSetup.rename.validation.maxLength': 'Zone name must not exceed 255 characters.',
  'zoneSetup.rename.error.wrongScope': 'Zone was updated with an unexpected scope or zone.',
  'zoneSetup.rename.error.409':
    'This zone cannot be updated right now. Reload the zone list and try again.',
  'zoneSetup.rename.error.default':
    'Failed to rename zone. Please verify your network connection and try again.',
  'zoneSetup.rename.success': 'Zone name updated to "{name}".',

  'zoneSetup.list.heading': 'Configured Zones for this Site',
  'zoneSetup.list.showingCount': 'Showing {shown} of {total} zones',
  'zoneSetup.list.countOne': '{count} zone',
  'zoneSetup.list.countOther': '{count} zones',
  'zoneSetup.list.loading': 'Loading configured zones...',
  'zoneSetup.list.initialError': 'Could not load configured zones for this site.',
  'zoneSetup.list.retrying': 'Retrying...',
  'zoneSetup.list.retryInitial': 'Retry loading zones',
  'zoneSetup.list.authRevokedError':
    'Could not load configured zones for this site. Access denied or session expired.',
  'zoneSetup.list.nextPageError':
    'Could not load additional zones. Please check your network and try again.',
  'zoneSetup.list.retryNextPage': 'Retry loading more zones',
  'zoneSetup.list.empty': 'No zones configured for this site yet.',
  'zoneSetup.list.emptyReadOnly':
    'No zones configured for this site yet. An assigned Site Manager must create zones before camera regions can be linked.',
  'zoneSetup.list.loadingMore': 'Loading more zones...',
  'zoneSetup.list.loadMore': 'Load more zones',
  'zoneSetup.readOnly.notice':
    'Zone catalog is read-only for your role. Only the assigned Site Manager can create or rename zones for this site.',

  'zoneSetup.rename.headingPrefix': 'Renaming zone:',
  'zoneSetup.rename.policyLockedBadge': 'Policy locked · Name editable',
  'zoneSetup.rename.newNameLabel': 'New zone name',
  'zoneSetup.rename.cancelBtn': 'Cancel rename',
  'zoneSetup.rename.savingBtn': 'Saving name...',
  'zoneSetup.rename.saveBtn': 'Save name',
  'zoneSetup.rename.triggerBtn': 'Rename {code}',

  'zoneSetup.regionLink.emptyHint':
    'Configure and save at least one zone above to enable Camera Observation Region linking.',
  'zoneSetup.regionLink.emptyReadOnlyHint':
    'An assigned Site Manager must create and save at least one zone above to enable Camera Observation Region linking.',
  'zoneSetup.regionLink.emptyTaskHint':
    'Create and save an area policy in step 1 before linking observation regions.',

  'regionSetup.sectionAria': 'Link Zone to Camera Region',
  'regionSetup.title': 'Link Zone to Camera Region',
  'regionSetup.subtitle': 'Draw and bind camera observation polygon geometry to the selected zone.',
  'regionSetup.closeAria': 'Close',
  'regionSetup.field.selectZone': 'Select Zone',
  'regionSetup.field.selectCamera': 'Select Camera',
  'regionSetup.camera.countSummary': '{active} active ({loaded} loaded of {total} on site)',
  'regionSetup.camera.loading': 'Loading cameras…',
  'regionSetup.camera.retrying': 'Retrying cameras…',
  'regionSetup.camera.retryInitial': 'Retry loading cameras',
  'regionSetup.camera.retryingMore': 'Retrying more cameras…',
  'regionSetup.camera.retryNextPage': 'Retry loading more cameras',
  'regionSetup.camera.loadingMore': 'Loading more cameras…',
  'regionSetup.camera.loadMore': 'Load more cameras',
  'regionSetup.error.401': 'Session expired or unauthorized. Please sign in again.',
  'regionSetup.camera.error.403': 'You do not have permission to view these cameras.',
  'regionSetup.region.error.403': 'You do not have permission to view these regions.',
  'regionSetup.camera.error.404': 'Camera resource unavailable.',
  'regionSetup.region.error.404': 'Region resource unavailable.',
  'regionSetup.camera.error.default': 'Could not load cameras. Please try again.',
  'regionSetup.region.error.default': 'Could not load regions. Please try again.',
  'regionSetup.action.drawingActive': 'Drawing Active',
  'regionSetup.action.startDrawing': 'Start Drawing Region',
  'regionSetup.action.startDrawingHint':
    'Click Start Drawing on camera frame to define observation area',
  'regionSetup.previewWarning.aiPaused':
    'AI is paused. Saved camera regions remain available; drawing requires a fresh authorized snapshot.',
  'regionSetup.previewWarning.unavailable':
    'Camera snapshot preview unavailable. A live or replay camera feed is required to draw an area.',
  'regionSetup.previewWarning.externalIdMismatch':
    'Preview external ID does not match selected camera.',
  'regionSetup.previewWarning.connecting': 'Connecting to camera preview...',
  'regionSetup.drawer.undoPoint': 'Undo Point',
  'regionSetup.drawer.resetDrawing': 'Reset Drawing',
  'regionSetup.drawer.deletePoint': 'Delete Point',
  'regionSetup.drawer.zoomIn': 'Zoom In',
  'regionSetup.drawer.zoomOut': 'Zoom Out',
  'regionSetup.drawer.resetView': 'Reset View',
  'regionSetup.drawer.panMode': 'Pan View',
  'regionSetup.drawer.coordXLabel': 'Point X (0–1)',
  'regionSetup.drawer.coordYLabel': 'Point Y (0–1)',
  'regionSetup.drawer.addPoint': 'Add Point',
  'regionSetup.drawer.vertexAria': 'Vertex {index} ({x}, {y})',
  'regionSetup.drawer.editingNotice': 'Editing Region {id} (v{version})',
  'regionSetup.drawer.cancelDrawing': 'Cancel Drawing',
  'regionSetup.drawer.discardPrompt': 'Discard unsaved region geometry changes?',
  'regionSetup.drawer.keepEditing': 'Keep Editing',
  'regionSetup.drawer.confirmDiscard': 'Discard Changes',
  'regionSetup.drawer.pointsCount': 'Points: {count} / 32',
  'regionSetup.drawer.stalePixelsNotice': 'Snapshot pixels expired · draft points retained',
  'regionSetup.drawer.canvasAria': 'Camera Region Drawing Canvas',
  'regionSetup.drawer.shortcutsLabel': 'Shortcuts:',
  'regionSetup.drawer.shortcutUndo': 'Undo',
  'regionSetup.drawer.shortcutCancel': 'Cancel drawing',
  'regionSetup.drawer.saving': 'Saving...',
  'regionSetup.drawer.saveRegion': 'Save Region',
  'regionSetup.validation.minPoints': 'Polygon must contain at least 3 points.',
  'regionSetup.validation.maxPoints': 'Polygon must not exceed 32 points.',
  'regionSetup.validation.duplicateVertices': 'Polygon contains duplicate vertices.',
  'regionSetup.validation.zeroArea': 'Polygon area must not be zero or degenerate.',
  'regionSetup.validation.selfIntersect': 'Polygon edges must not self-intersect or overlap.',
  'regionSetup.validation.maxPointsClick': 'Maximum 32 points allowed per region polygon.',
  'regionSetup.validation.outOfBounds': 'Clicked coordinates are outside the camera frame.',
  'regionSetup.validation.duplicateVertexClick':
    'A vertex with identical coordinates already exists in this polygon.',
  'regionSetup.validation.alreadySaved': 'This polygon draft has already been saved.',
  'regionSetup.error.cancelled': 'Operation cancelled.',
  'regionSetup.error.cameraChangedOrInactive':
    'Camera metadata changed or became inactive. Operation cancelled.',
  'regionSetup.error.wrongScope':
    'Region was created with an unexpected camera or zone scope. Please refresh.',
  'regionSetup.error.403': 'You do not have permission to perform this action.',
  'regionSetup.error.409':
    'Configuration version conflict. Camera configuration was updated by another operator. Please review and try saving again.',
  'regionSetup.error.409Edit':
    'Configuration version conflict. Camera configuration was updated by another operator. Your unsaved draft is kept; please review the current camera configuration and reopen this region to edit from the latest revision.',
  'regionSetup.error.saveDefault':
    'Failed to save observation region. Please verify your inputs and try again.',
  'regionSetup.feedback.saved':
    'Saved region "{id}" (v{version}). Select this region for the AI worker and apply/restart it before monitoring uses it.',
  'regionSetup.list.heading': 'Existing Regions for this Camera & Zone',
  'regionSetup.list.countSummary': '{linked} linked ({loaded} loaded of {total} on camera)',
  'regionSetup.list.loading': 'Loading regions…',
  'regionSetup.list.retrying': 'Retrying regions…',
  'regionSetup.list.retryInitial': 'Retry loading regions',
  'regionSetup.list.emptyHasMore':
    'No linked regions loaded yet for this zone. Loading more camera regions may contain matching areas.',
  'regionSetup.list.empty':
    'No observation regions linked to this zone on the selected camera yet.',
  'regionSetup.list.noCameraSelected':
    'Please select an active camera to view observation regions.',
  'regionSetup.list.versionStatus': 'Version {version} · {status}',
  'regionSetup.list.statusActive': 'Active',
  'regionSetup.list.statusInactive': 'Inactive',
  'regionSetup.list.editGeometry': 'Edit Geometry',
  'regionSetup.list.retryingMore': 'Retrying more regions…',
  'regionSetup.list.retryNextPage': 'Retry loading more regions',
  'regionSetup.list.loadingMore': 'Loading more regions…',
  'regionSetup.list.loadMore': 'Load more regions',
  'regionSetup.reference.heading': 'Authoring Reference Image',
  'regionSetup.reference.purposeNote':
    'Obtains a frozen camera frame for region authoring only. Does not run AI inference or live compliance monitoring.',
  'regionSetup.reference.getBtn': 'Get configuration image',
  'regionSetup.reference.loadingBtn': 'Loading configuration image…',
  'regionSetup.reference.reviewNewBtn': 'Review new reference',
  'regionSetup.reference.loadingCandidateBtn': 'Loading new reference…',
  'regionSetup.reference.capturedAt': 'Captured: {time}',
  'regionSetup.reference.expiresAt': 'Expires: {time}',
  'regionSetup.reference.revisionBadge': 'Config v{version}',
  'regionSetup.reference.expiredBadge': 'Expired',
  'regionSetup.reference.noneLoadedHint':
    'Request a configuration image for the selected active camera before drawing or editing a region.',
  'regionSetup.reference.expiredHint':
    'The configuration reference image has expired. Request a fresh configuration image to continue.',
  'regionSetup.reference.revisionChangedHint':
    'Camera configuration changed (now v{version}). Request a fresh configuration image to continue.',
  'regionSetup.reference.candidateHeading': 'Review Candidate Reference Image',
  'regionSetup.reference.candidateDescription':
    'Inspect how your current draft points align on the new reference frame (v{version}) before replacing the active reference.',
  'regionSetup.reference.candidateCanvasAria': 'Candidate Reference Preview Canvas',
  'regionSetup.reference.candidateExpiredNotice':
    'Candidate reference image has expired. Request another reference image to review.',
  'regionSetup.reference.useNewBtn': 'Use new reference',
  'regionSetup.reference.cancelReviewBtn': 'Keep current reference',
  'regionSetup.reference.error.401':
    'Session expired or unauthorized. Please sign in again to load a configuration image.',
  'regionSetup.reference.error.403':
    'You do not have permission to request a camera configuration image.',
  'regionSetup.reference.error.404':
    'Camera configuration image source was not found for this scope.',
  'regionSetup.reference.error.409':
    'Camera configuration changed while loading the reference image. Please request a fresh image.',
  'regionSetup.reference.error.429':
    'Too many configuration image requests. Please wait before trying again.',
  'regionSetup.reference.error.503':
    'Camera configuration image source is currently unavailable. Verify that the capture observer is active and try again.',
  'regionSetup.reference.error.timeout': 'Configuration image request timed out. Please try again.',
  'regionSetup.reference.error.default':
    'Could not load camera configuration image. Please try again.',
  'regionSetup.error.referenceExpired':
    'Configuration reference image has expired. Review and accept a new reference image before saving.',

  'liveOverview.title': 'Safety Monitoring Overview',
  'liveOverview.subtitle':
    'Navigation and configuration overview only — no combined multi-camera live feed, active model runtime, or incident count is loaded on this page. Camera availability and technical observation evidence are evaluated only on the selected camera page; preview observations never infer worker identity or access authorization.',
  'liveOverview.pausedBanner.title': 'AI Monitoring & Camera Analysis Paused',
  'liveOverview.pausedBanner.description':
    'All AI model inference and live camera analysis are currently paused by operator configuration. Stored zone/region configurations and persisted safety alert records remain accessible through the workspaces below.',
  'liveOverview.ppe.title': 'PPE Monitoring',
  'liveOverview.ppe.description':
    'View per-camera PPE observations and available snapshots. Configure cameras, regions and PPE in Camera setup.',
  'liveOverview.ppe.action': 'Open PPE Monitoring',
  'liveOverview.zones.title': 'Restricted Zones',
  'liveOverview.zones.description':
    'Review zone-entry observations and saved assessments. Configure observation regions in Camera setup.',
  'liveOverview.zones.action': 'Open Restricted Zones',
  'liveOverview.incidents.title': 'Safety Alerts',
  'liveOverview.incidents.description':
    'Review persisted safety alert records from the Backend API, inspect stored evidence snapshots, and complete audited officer verification workflows.',
  'liveOverview.incidents.action': 'Open Safety Alerts',

  'cameraSetup.discardPrompt': 'Discard unsaved camera changes?',
  'cameraSetup.field.code': 'Camera code',
  'cameraSetup.field.name': 'Camera name',
  'cameraSetup.field.externalId': 'Source ID',
  'cameraSetup.register.dialogDescription':
    'Register camera metadata for this site. Video availability is checked separately in monitoring.',
  'cameraSetup.register.authRequired':
    'A Site Manager session assigned to the selected Site is required to register a camera.',
  'cameraSetup.register.introPrefix': 'Register camera metadata for',
  'cameraSetup.register.introSuffix': 'This does not start video capture or AI processing.',
  'cameraSetup.register.sourceHelp':
    'Use the provisioned source identifier. Do not enter an RTSP URL, password or token.',
  'cameraSetup.register.submitting': 'Registering…',
  'cameraSetup.register.validation.code':
    'Camera code must contain 1–64 characters without control characters.',
  'cameraSetup.register.validation.name':
    'Camera name must contain 1–255 characters without control characters.',
  'cameraSetup.register.validation.externalId':
    'Enter an opaque provisioned Source ID (1–128 characters), without a camera URL or credentials.',
  'cameraSetup.register.validation.dtoCode': 'Check camera code and try again.',
  'cameraSetup.register.validation.dtoName': 'Check camera name and try again.',
  'cameraSetup.register.validation.dtoExternalId': 'Check source id and try again.',
  'cameraSetup.register.error.401': 'Your session has expired. Sign in again to register a camera.',
  'cameraSetup.register.error.403': 'You no longer have permission to register cameras.',
  'cameraSetup.register.error.404':
    'This Site is unavailable. Refresh the Site list before continuing.',
  'cameraSetup.register.error.400': 'Check the camera fields and try again.',
  'cameraSetup.register.error.409':
    'The camera code or Source ID is already registered. Verify the camera list before trying again.',
  'cameraSetup.register.error.429': 'Too many requests. Wait before trying again.',
  'cameraSetup.register.error.default':
    'Registration could not be confirmed. Verify the camera list before sending another registration.',
  'cameraSetup.manage.dialogDescription':
    'View camera details, update display name, and manage activation state.',
  'cameraSetup.manage.statusActive': 'ACTIVE',
  'cameraSetup.manage.statusInactive': 'INACTIVE',
  'cameraSetup.manage.metadataNote':
    'Metadata state only. Does not alter physical device power, camera source provisioning, or AI video pipeline.',
  'cameraSetup.manage.conflictNotice':
    'Metadata changed on server. Review fresh camera metadata to continue.',
  'cameraSetup.manage.refreshing': 'Refreshing…',
  'cameraSetup.manage.refreshCamera': 'Refresh camera',
  'cameraSetup.manage.activationHeading': 'Activation State',
  'cameraSetup.manage.deactivationNote':
    'Deactivation disables monitoring access and advances configuration revisions.',
  'cameraSetup.manage.activationNote':
    'Activation restores eligibility for monitoring. Video and AI availability remain separate.',
  'cameraSetup.manage.deactivateBtn': 'Deactivate camera',
  'cameraSetup.manage.activateBtn': 'Activate camera',
  'cameraSetup.manage.confirmDeactivatePrompt':
    'Confirm deactivation? This advances camera and active region revisions. Monitoring will be inactive.',
  'cameraSetup.manage.confirmActivatePrompt':
    'Confirm activation? This advances camera and active region revisions.',
  'cameraSetup.manage.updatingStatus': 'Updating…',
  'cameraSetup.manage.confirmDeactivateBtn': 'Confirm deactivation',
  'cameraSetup.manage.confirmActivateBtn': 'Confirm activation',
  'cameraSetup.manage.savingName': 'Saving name…',
  'cameraSetup.manage.feedback.renamed': 'Camera name updated.',
  'cameraSetup.manage.feedback.refreshed': 'Camera metadata refreshed.',
  'cameraSetup.manage.feedback.activated':
    'Camera activated. Configuration version advanced to v{version}.',
  'cameraSetup.manage.feedback.deactivated':
    'Camera deactivated. Configuration version advanced to v{version}.',
  'cameraSetup.manage.error.401': 'Your session has expired. Sign in again to manage this camera.',
  'cameraSetup.manage.error.403': 'You no longer have permission to manage this camera.',
  'cameraSetup.manage.error.404': 'This camera or Site is unavailable. Refresh before continuing.',
  'cameraSetup.manage.error.400': 'Check the camera name and try again.',
  'cameraSetup.manage.error.409':
    'Camera metadata conflict. Refresh camera metadata before retrying.',
  'cameraSetup.manage.error.429': 'Too many requests. Please wait before trying again.',
  'cameraSetup.manage.error.default':
    'Camera operation could not be completed. Refresh camera metadata and try again.',

  'safety.evidence.error.429': 'Too many requests. Wait before trying again.',
  'safety.evidence.error.network':
    'Cannot reach the evidence service. Check your connection and try again.',
  'safety.evidence.error.timeout': 'Loading evidence timed out. Please try again.',
  'safety.evidence.error.cancelled': 'Evidence loading was cancelled.',
  'safety.evidence.error.invalidResponse':
    'The evidence service returned an invalid image. Please try again.',
  'safety.evidence.frameCaptionBase':
    'Frame view adds no subject highlight; it may show multiple people. Track IDs are not worker identities.',
  'safety.evidence.frameCaptionIdentityReview':
    'Select a person in identity review below to inspect subject bounds.',
  'safety.evidence.frameCaptionSourceObservations':
    'Check the alert subject against source observations.',
  'safety.evidence.unreadableImageMessage':
    'The evidence image could not be displayed. Try loading it again.',
  'safety.evidence.loadingImage': 'Loading image…',
  'safety.evidence.retryImage': 'Retry image',

  'safety.alerts.loginFailed401': 'Sign-in failed. Check your credentials and try again.',
  'safety.alerts.accessRestricted.title': 'Access restricted',
  'safety.alerts.accessRestricted.description':
    'A global Admin or Site-scoped Safety Officer role is required to review safety alerts.',
  'safety.alerts.sessionExpired.description':
    'Your application session is pending or no longer valid. Please sign in to the application to continue.',
  'safety.alerts.retrySites': 'Retry Sites',
  'safety.alerts.retryDetail': 'Retry detail',
  'safety.alerts.recordingReviewDecision': 'Recording review decision…',
  'safety.alerts.zoneAuthUnavailableInline':
    'Cannot verify authorization; unknown identity does not establish unauthorized entry, retrospective manual review does not grant live access.',
  'safety.alerts.zoneAuthUnavailableTitle': 'Cannot verify authorization',
  'safety.alerts.zoneAuthUnavailableBody':
    'Unknown identity does not establish unauthorized entry, retrospective manual review does not grant live access.',

  'safety.subtype.PPE_HARD_HAT_MISSING': 'Missing Hard Hat',
  'safety.subtype.PPE_SAFETY_VEST_MISSING': 'Missing Safety Vest',
  'safety.subtype.PPE_GLOVES_MISSING': 'Missing Gloves',
  'safety.subtype.PPE_BOOTS_MISSING': 'Missing Boots',
  'safety.subtype.PPE_GOGGLES_MISSING': 'Missing Goggles',
  'safety.subtype.ZONE_ENTRY_VIOLATION': 'Zone Entry Violation',
  'safety.subtype.ZONE_ENTRY_UNAUTHORIZED': 'Unauthorized Zone Entry',
  'safety.subtype.ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE': 'Authorization Unavailable',
  'safety.subtype.RESTRICTED_ZONE_INTRUSION': 'Restricted Zone Intrusion',

  'cameraMonitoring.switcherAria': 'Camera monitoring view',
  'cameraMonitoring.codeMf05': 'MF05',
  'cameraMonitoring.codeMf06': 'MF06',

  'ppe.rawCanvas.ariaLabel': 'Raw unanalyzed camera live video stream',

  'ppe.previewCanvas.regionPrefix': 'Region',
  'ppe.previewCanvas.experimentalObjectSummary':
    'Experimental object: {className} ({confidence}%).',
  'ppe.previewCanvas.currentFrameObservationsAria': 'Current frame observations',
  'ppe.previewCanvas.frameDetailsAria': 'Frame observation details',
  'ppe.previewCanvas.frameObservationsCount': 'Frame ({count} observation(s))',
  'ppe.previewCanvas.regionParen': '(Region: {regionId})',
  'ppe.previewCanvas.boxPx': 'Box px: {box}',

  'ppe.wall.tileAriaFocused': 'Camera {camera} (focused)',
  'ppe.wall.tileAriaAvailable': 'Camera {camera} (available)',
  'ppe.wall.awaitingSnapshot': 'Awaiting fresh camera snapshot...',
  'ppe.wall.connectingSnapshot': 'Connecting ({cadence} snapshot)...',
  'ppe.wall.snapshotUnavailable': 'Snapshot Unavailable',
  'ppe.wall.noActiveSnapshot': 'No active camera snapshot available.',
  'ppe.wall.noPersonDetectionsDisclaimer':
    'No Person detections · Zero detections do not certify safety clearance',
  'ppe.wall.cadenceLabel': 'Cadence: {cadence}',
  'ppe.wall.personDetectionsCount': '{count} Person detection(s)',
  'ppe.wall.noPersonDetections': 'No Person detections',
  'ppe.wall.rawObjectsCount': '{count} raw object(s)',
  'ppe.wall.emptyTitle': 'No cameras available for this site',
  'ppe.wall.emptyDesc': 'Select another site or contact an administrator for camera access.',
  'ppe.wall.unassignedSlotTitle': 'Slot {slot} · Unassigned',
  'ppe.wall.unassignedSlotDesc':
    'No authorized camera source assigned. The system does not fabricate simulated feeds.',
  'ppe.wall.enlargeCameraBtn': 'Enlarge camera',
  'ppe.common.details': 'Details',
  'ppe.common.evidence': 'Evidence',
  'ppe.toolbar.evidenceDetailsBtn': 'Evidence & Details',
  'ppe.toolbar.backToGridBtn': 'Back to grid',
  'ppe.fullscreen.enterBtn': 'Fullscreen',
  'ppe.fullscreen.exitBtn': 'Exit fullscreen',
  'ppe.fullscreen.errorBlocked':
    'Browser fullscreen is unavailable or blocked. Keeping enlarged camera view.',
  'ppe.fullscreen.errorUnsupported':
    'Browser Fullscreen API is not supported in this environment. Using enlarged viewport.',
  'ppe.fullscreen.errorFailed':
    'Could not enter browser fullscreen. Using enlarged camera viewport.',

  'mf05Demo.mutationError.400':
    'Invalid region request or malformed configuration parameters (400).',
  'mf05Demo.mutationError.401': 'Authentication session expired or invalid credentials (401).',
  'mf05Demo.mutationError.403':
    'Permission denied: Administrator role required to apply saved regions (403).',
  'mf05Demo.mutationError.409':
    'Configuration conflict: Region or configuration version was modified by another operation (409).',
  'mf05Demo.mutationError.503':
    'Service unavailable: Ingestion backend or stream processor is temporarily down (503).',
  'mf05Demo.mutationError.httpStatus': 'Failed to apply region configuration (HTTP {status}).',
  'mf05Demo.mutationError.default':
    'Failed to apply region configuration due to a connection or server error.',
  'mf05Demo.accessErrorTitle': 'Diagnostic Controls Access Error ({status})',
  'mf05Demo.accessErrorDesc':
    'Permission denied: Diagnostic region controls require proper administrator privileges.',
  'mf05Demo.loading': 'Loading MF05 diagnostic region controls...',
  'mf05Demo.candidatesSummaryApplying':
    'MF05 candidates / evidence (applying — safety not assessed)',
  'mf05Demo.candidatesSummaryCount': 'MF05 candidates / evidence ({count})',
  'mf05Demo.applyingBadge': 'applying — safety not assessed',
  'mf05Demo.heading': 'MF05 Diagnostic Region Control',
  'mf05Demo.badgeLocalDiagnostic': 'Local Diagnostic Only',
  'mf05Demo.stateApplying': 'Applying...',
  'mf05Demo.stateActiveApplied': 'Active & Applied',
  'mf05Demo.statePendingApply': 'Pending Apply',
  'mf05Demo.savedConfigLabel': 'Saved Config',
  'mf05Demo.savedRevValue': 'Saved Rev: {version}',
  'mf05Demo.loadedConfigLabel': 'Loaded Config',
  'mf05Demo.loadedRevValue': 'Loaded Rev: {version}',
  'mf05Demo.none': 'None',
  'mf05Demo.loadedGeometryLabel': 'Loaded Geometry',
  'mf05Demo.loadedGeomValue': 'Loaded Geom: {version}',
  'mf05Demo.activeLoadedRegionLabel': 'Active Loaded Region',
  'mf05Demo.activeSavedRegionLabel': 'Active Saved Region (1 per camera)',
  'mf05Demo.savedRegionSummary': '{id} (v{version} · {points} points)',
  'mf05Demo.noSavedRegions': 'No saved regions available for this camera',
  'mf05Demo.applySavedRegionBtn': 'Apply Saved Region',
  'mf05Demo.adminPermissionRequired': 'Admin permission required to apply region changes.',
  'mf05Demo.failedToApplyTitle': 'Failed to Apply Region',
  'mf05Demo.candidatesHeading': 'MF05 candidate input for MF08, NOT persisted Safety Alert',
  'mf05Demo.candidatesCount': 'Count: {count}',
  'mf05Demo.candidatesDisclaimer':
    'Temporal-confirmed and backend policy filtered candidates. (Zero candidates => no confirmed candidate, NOT safety clear).',
  'mf05Demo.noConfirmedCandidate': 'no confirmed candidate (NOT safety clear)',
  'mf05Demo.fieldSubtype': 'Subtype:',
  'mf05Demo.fieldTrack': 'Track:',
  'mf05Demo.fieldGeom': 'Geom:',
  'mf05Demo.latestEvidenceHeading': 'Latest Actual Evidence Image',
  'mf05Demo.downloadEvidenceBtn': 'Download Evidence',
  'mf05Demo.noEvidenceImage': 'No evidence image available',
  'mf05Demo.evidenceIdentityUnavailable': 'Evidence identity unavailable',
  'mf05Demo.latestEvidenceAlt': 'Latest MF05 evidence candidate',
  'mf05Demo.evidenceBoxOverlayAria': 'evidence bounding box overlay',
  'mf05Demo.fieldEvent': 'Event:',
  'mf05Demo.fieldDimensions': 'Dimensions:',
  'mf05Demo.targetTrack': 'Track: {id}',
  'mf05Demo.targetRegionVersion': 'Region: {regionId} (v{version})',

  'zonePaging.sites.loading': 'Loading sites…',
  'zonePaging.cameras.loading': 'Loading cameras…',
  'zonePaging.regions.loading': 'Loading regions…',
  'zonePaging.sites.loadedCount': '{loaded} of {total} sites loaded',
  'zonePaging.cameras.loadedCount': '{loaded} of {total} cameras loaded',
  'zonePaging.regions.loadedCount': '{loaded} of {total} regions loaded',
  'zonePaging.sites.errorInitial': 'Cannot load sites. Try again.',
  'zonePaging.cameras.errorInitial': 'Cannot load cameras. Try again.',
  'zonePaging.regions.errorInitial': 'Cannot load regions. Try again.',
  'zonePaging.sites.errorMore': 'Cannot load more sites. Try again.',
  'zonePaging.cameras.errorMore': 'Cannot load more cameras. Try again.',
  'zonePaging.regions.errorMore': 'Cannot load more regions. Try again.',
  'zonePaging.sites.retryInitial': 'Retry loading sites',
  'zonePaging.cameras.retryInitial': 'Retry loading cameras',
  'zonePaging.regions.retryInitial': 'Retry loading regions',
  'zonePaging.sites.retryMore': 'Retry loading more sites',
  'zonePaging.cameras.retryMore': 'Retry loading more cameras',
  'zonePaging.regions.retryMore': 'Retry loading more regions',
  'zonePaging.sites.loadingMore': 'Loading more sites…',
  'zonePaging.cameras.loadingMore': 'Loading more cameras…',
  'zonePaging.regions.loadingMore': 'Loading more regions…',
  'zonePaging.sites.loadMore': 'Load more sites',
  'zonePaging.cameras.loadMore': 'Load more cameras',
  'zonePaging.regions.loadMore': 'Load more regions',

  'restrictedZone.status.cannotSavePolygonNotLive':
    'Cannot save polygon: camera snapshot is not live or does not match.',
  'restrictedZone.status.cannotSaveDraftNotLive':
    'Cannot save draft: camera snapshot is not live or does not match.',
  'restrictedZone.event.authBackendRequired': 'Backend evaluation required',
  'restrictedZone.event.resultTechnicalEntry': 'Technical entry',
  'restrictedZone.event.resultScanningSnapshot': 'Scanning Snapshot',
  'restrictedZone.error.previewSessionExpired': 'Camera preview session expired',
  'restrictedZone.error.sessionNoLongerValid': 'Your session is no longer valid. Sign in again.',
  'restrictedZone.sessionExpired.description':
    'Zone session is pending or expired. Please sign in to the application to configure camera regions.',
  'restrictedZone.accessRestricted.title': 'Zone Configuration is restricted',
  'restrictedZone.accessRestricted.description':
    'A global Admin role or assigned Site Safety Officer role is required to view restricted zones.',
  'restrictedZone.session.safetyOfficerActive': 'Safety Officer Session Active (Read-Only)',
  'restrictedZone.session.safetyOfficerDesc':
    'Safety Officer role verified. Snapshot camera monitoring is active in read-only mode.',
  'restrictedZone.regionSelect.labelTitle':
    'Select authoritative region polygon for geometry editing and backend synchronization',
  'restrictedZone.regionSelect.label': 'Region (Geometry Editing)',
  'restrictedZone.regionSelect.editTargetTitle':
    'Editing target only. Live AI intrusion detection displays observed camera zone events without filtering.',
  'restrictedZone.regionSelect.editTarget': 'Edit Target',
  'restrictedZone.regionSelect.selectTitle':
    'Authoritative polygon geometry target for editing and backend sync. Live AI detection stream reflects observed camera zones.',
  'restrictedZone.scope.zoneScopeLabel': 'Zone Scope',
  'restrictedZone.scope.readOnlyTitle':
    'Live AI detections reflect observed camera zones; geometry editing requires the assigned Site Manager',
  'restrictedZone.scope.readOnlyValue': 'Restricted Zone (Read-Only)',
  'restrictedZone.scope.safetyOfficerBadge': 'Safety Officer (Read-Only)',
  'restrictedZone.viewport.connectingTitle': 'Connecting to Camera Snapshot...',
  'restrictedZone.viewport.noCameraSelected': 'No camera selected or available for preview',
  'restrictedZone.badge.liveSnapshot1s': 'MF06 LIVE SNAPSHOT (1s)',
  'restrictedZone.badge.replaySnapshot1s': 'MF06 REPLAY SNAPSHOT (1s)',
  'restrictedZone.badge.snapshotUnavailable': 'MF06 SNAPSHOT UNAVAILABLE',
  'restrictedZone.badge.cameraOffline': 'MF06 CAMERA OFFLINE',
  'restrictedZone.badge.zoneEntry': 'ZONE ENTRY',
  'restrictedZone.badge.scanning': 'SCANNING',
  'restrictedZone.controls.safetyOfficerReadOnlyBadge': 'SAFETY OFFICER (READ-ONLY)',
  'restrictedZone.controls.editDisabledNotLive':
    'Live camera snapshot is required before editing restricted zone geometry',
  'restrictedZone.controls.editDisabledMismatch':
    'Select the matching Backend camera before editing this preview',
  'restrictedZone.controls.resetBtn': 'RESET',
  'restrictedZone.viewport.emptyFrameReplay':
    'Replay Snapshot Active · No AI person observations in this snapshot; no conclusion about safety/authorization',
  'restrictedZone.viewport.emptyFrameLive':
    'Live Snapshot Active · No AI person observations in this snapshot; no conclusion about safety/authorization',
  'restrictedZone.headerOverlay.liveSnapshotTime': 'LIVE SNAPSHOT (1s) - {time}',
  'restrictedZone.headerOverlay.replaySnapshotTime': 'REPLAY SNAPSHOT (1s) - {time}',
  'restrictedZone.headerOverlay.snapshotUnavailable': 'SNAPSHOT UNAVAILABLE',
  'restrictedZone.headerOverlay.offline': 'OFFLINE',
  'restrictedZone.errorBanner.cameraSnapshotPrefix': 'Camera Snapshot: {error}',
  'restrictedZone.toolbar.liveSnapshot1s': 'Live Camera Snapshot (1s)',
  'restrictedZone.toolbar.replaySnapshot1s': 'Replay Camera Snapshot (1s)',
  'restrictedZone.toolbar.cameraOffline': 'Camera Offline',
  'restrictedZone.observations.replayHeading': 'Replay Zone Observations Active',
  'restrictedZone.observations.replayDesc':
    'Technical zone-entry detections are rendered from recorded video replay stream above. Sample replay timeline rows are hidden during stream playback. Durable safety alerts require Backend worker ingestion; review persisted records in Safety Alerts.',
  'restrictedZone.table.subtitle':
    'Observations from the camera snapshot feed. Live safety alerts are available in Safety Alerts.',
  'restrictedZone.reviewModal.previewBadge': 'Technical Observation Preview',
} as const;

export type PpeTranslationKey = keyof typeof PPE_EN_CATALOG;

export const PPE_VI_CATALOG: Record<PpeTranslationKey, string> = {
  'ppe.wall.sourceReplay': 'PHÁT LẠI',
  'ppe.wall.sourceLive': 'TRỰC TIẾP',
  'ppe.wall.sourceConnecting': 'ĐANG KẾT NỐI',
  'ppe.wall.sourceUnavailable': 'KHÔNG KHẢ DỤNG',
  'ppe.error.metadata401':
    'Phiên làm việc đã hết hạn hoặc chưa được xác thực. Vui lòng đăng nhập lại.',
  'ppe.error.metadata403': 'Bạn không có quyền truy cập tài nguyên này.',
  'ppe.error.site404': 'Không tìm thấy tài nguyên công trường.',
  'ppe.error.camera404': 'Không tìm thấy tài nguyên camera.',
  'ppe.error.siteLoadFailed': 'Không thể tải danh sách công trường. Vui lòng thử lại.',
  'ppe.error.cameraLoadFailed': 'Không thể tải danh sách camera. Vui lòng thử lại.',

  'ppe.preset.FULL_EIGHT.label': 'Đầy đủ 8 nhóm',
  'ppe.preset.FULL_EIGHT.shortLabel': 'Đủ 8 nhóm',
  'ppe.preset.FULL_EIGHT.description': 'Tất cả 8 nhóm vật thể PPE dương tính',
  'ppe.preset.GROUND.label': 'Mặt đất (Mũ/Áo/Găng tay/Giày)',
  'ppe.preset.GROUND.shortLabel': 'Mặt đất',
  'ppe.preset.GROUND.description': 'Mũ bảo hộ, Áo phản quang, Găng tay, Giày bảo hộ',
  'ppe.preset.EYE_FACE.label': 'Mắt/mặt (Kính/Khẩu trang)',
  'ppe.preset.EYE_FACE.shortLabel': 'Mắt/mặt',
  'ppe.preset.EYE_FACE.description':
    'Kính bảo hộ, Khẩu trang (chỉ nhận diện vật thể, không xác nhận đeo đúng quy cách hay chứng nhận đạt chuẩn)',
  'ppe.preset.HEIGHT.label': 'Trên cao (Dây đai/Móc treo)',
  'ppe.preset.HEIGHT.shortLabel': 'Trên cao',
  'ppe.preset.HEIGHT.description':
    'Dây an toàn toàn thân, Móc dây cứu sinh (chỉ nhận diện vật thể, không chứng nhận đã móc neo an toàn)',

  'ppe.context.siteScopeFallback': 'Phạm vi công trường',
  'ppe.context.noCameraSelected': 'Chưa chọn camera',
  'ppe.trackLabel': 'Track #{id}',
  'ppe.untrackedLabel': 'Chưa xác định track',
  'ppe.event.defaultIssue': 'Vấn đề kiểm tra PPE',
  'ppe.event.statusSnapshotObservation': 'Quan sát ảnh chụp',
  'ppe.event.statusObservationActive': 'Đang ghi nhận quan sát',
  'ppe.event.statusScanning': 'Đang quét',

  'ppe.header.badge': 'MF05 Giám sát tuân thủ thời gian thực',
  'ppe.header.title': 'Giám sát tuân thủ bảo hộ lao động (PPE)',
  'ppe.header.subtitle':
    'Bằng chứng nhận diện trên từng ảnh chụp kết hợp với đợt thiếu bảo hộ đã được máy chủ xác nhận.',
  'ppe.header.status.paused': 'Tạm dừng xử lý AI',
  'ppe.header.status.live': 'Đang giám sát trực tiếp',
  'ppe.header.status.replay': 'Chế độ phát lại',
  'ppe.header.status.standby': 'Nguồn phát chờ',

  'ppe.pausedBanner.title': 'Tác vụ AI đang tạm dừng theo lệnh vận hành',
  'ppe.pausedBanner.summary':
    'Suy luận AI và phân tích camera đang tạm dừng; cấu hình khu vực và vùng quan sát vẫn hoạt động.',
  'ppe.pausedBanner.detailsToggle': 'Chi tiết vận hành',
  'ppe.pausedBanner.description':
    'Toàn bộ suy luận mô hình AI, phân tích luồng camera và thao tác triển khai nguồn demo đang tạm dừng theo chỉ thị của người vận hành. Cấu hình Khu vực (Zone) và vùng quan sát của camera vẫn hoạt động và có thể lưu.',

  'ppe.sessionExpired.title': 'Phiên làm việc đang chờ hoặc đã hết hạn',
  'ppe.sessionExpired.description':
    'Phiên giám sát PPE đang chờ hoặc đã hết hạn. Vui lòng đăng nhập lại ứng dụng để giám sát nguồn camera.',

  'ppe.layout.monitoringScope': 'Phạm vi giám sát',
  'ppe.layout.configuration': 'Cấu hình',
  'ppe.check.notesSummary': 'Phạm vi quan sát & lưu ý thử nghiệm',

  'ppe.scope.siteLabel': 'Công trường',
  'ppe.scope.loadedCount': '({loaded}/{total} đã tải)',
  'ppe.scope.loadingSites': 'Đang tải công trường…',
  'ppe.scope.retryingSites': 'Đang thử tải lại công trường…',
  'ppe.scope.retrySites': 'Thử tải lại công trường',
  'ppe.scope.retryingMoreSites': 'Đang thử tải thêm công trường…',
  'ppe.scope.retryMoreSites': 'Thử tải thêm công trường',
  'ppe.scope.loadingMoreSites': 'Đang tải thêm công trường…',
  'ppe.scope.loadMoreSites': 'Tải thêm công trường',

  'ppe.scope.cameraLabel': 'Camera',
  'ppe.scope.loadingCameras': 'Đang tải camera…',
  'ppe.scope.refreshingCameras': 'Đang làm mới camera…',
  'ppe.scope.retryingCameras': 'Đang thử tải lại camera…',
  'ppe.scope.retryCameras': 'Thử tải lại camera',
  'ppe.scope.retryingMoreCameras': 'Đang thử tải thêm camera…',
  'ppe.scope.retryMoreCameras': 'Thử tải thêm camera',
  'ppe.scope.loadingMoreCameras': 'Đang tải thêm camera…',
  'ppe.scope.loadMoreCameras': 'Tải thêm camera',
  'ppe.scope.noCameraMonitoringAccess':
    'Tài khoản này không có quyền giám sát camera tại công trường này.',

  'ppe.admin.configureByZone': 'Cấu hình PPE theo Khu vực',
  'ppe.admin.registerCamera': 'Đăng ký camera',
  'ppe.admin.manageCamera': 'Quản lý camera',
  'ppe.admin.registrationSuccess':
    'Đã đăng ký siêu dữ liệu camera. Tình trạng kết nối video được kiểm tra riêng khi giám sát.',
  'ppe.admin.dismissStatusAria': 'Đóng thông báo trạng thái',
  'ppe.admin.dismiss': 'Đóng',

  'ppe.viewMode.groupAria': 'Chế độ hiển thị giám sát',
  'ppe.viewMode.single': 'Xem đơn tiêu điểm',
  'ppe.viewMode.wall': 'Lưới 4 nguồn',
  'ppe.cadence.paused': 'Giám sát AI đang tạm dừng',
  'ppe.cadence.wall': 'Giám sát lưới: Tối đa 4 nguồn',
  'ppe.cadence.single': 'Chu kỳ giám sát: 500ms (tiêu điểm)',
  'ppe.cadence.pollingWallTitle': 'Đang lấy mẫu (1s chế độ lưới / 500ms tiêu điểm)',
  'ppe.cadence.pollingSingleTitle': 'Đang lấy mẫu (500ms)',

  'ppe.empty.noSites': 'Không có công trường được cấp quyền để giám sát.',
  'ppe.empty.noCamerasLoadedYet':
    'Chưa tải được camera thuộc công trường này. Vẫn còn trang dữ liệu camera tiếp theo.',
  'ppe.empty.noCamerasInScope': 'Không có camera nào trong phạm vi công trường này.',

  'ppe.overview.heading': 'Tổng quan camera · {count} camera đã tải',
  'ppe.overview.clickHint': 'Nhấn vào thẻ nguồn để chọn tiêu điểm',
  'ppe.overview.selectedTitle': 'Camera đang chọn',
  'ppe.overview.selectTitle': 'Chọn camera',
  'ppe.overview.selectedAria': 'Đang chọn',

  'ppe.wall.heading': 'Giám sát lưới 4 nguồn',
  'ppe.wall.subtitle': '(Tối đa 4 nguồn được cấp quyền · Nhấn vào ô để chọn tiêu điểm)',
  'ppe.wall.switchToSingle': 'Chế độ xem đơn tiêu điểm',
  'ppe.wall.context.focusedBadge': 'Tiêu điểm',
  'ppe.wall.context.siteLabel': 'Công trường',
  'ppe.wall.context.cameraLabel': 'Camera',
  'ppe.wall.context.zonesLabel': 'Khu vực',
  'ppe.wall.context.loadingZones': 'Đang tải khu vực…',
  'ppe.wall.context.noZonesLinked': 'Chưa gắn khu vực',
  'ppe.wall.context.unresolvedZones': '{count} vùng chưa xác định khu vực',
  'ppe.wall.context.zonesUnavailable': 'Không tải được khu vực (tạm thời không khả dụng)',
  'ppe.wall.context.zonesAccessDenied': 'Không tải được khu vực (không có quyền truy cập)',
  'ppe.wall.context.partialLoadError':
    'Đã tải một phần ({loaded}/{total}) · Không thể tải thêm khu vực',
  'ppe.wall.context.loadMoreZones': 'Tải thêm khu vực',
  'ppe.wall.context.loadingMoreZones': 'Đang tải thêm khu vực…',
  'ppe.wall.context.retryZones': 'Tải lại khu vực',

  'ppe.viewport.pausedTitle': 'Đã tạm dừng xem trước camera',
  'ppe.viewport.pausedDesc':
    'Các luồng AI và video đang tạm dừng. Bạn vẫn có thể quản lý yêu cầu PPE theo Khu vực và vùng quan sát của camera đã lưu.',
  'ppe.viewport.applyingTitle': 'Đang áp dụng vùng quan sát demo...',
  'ppe.viewport.applyingDesc': 'Đang chờ ảnh chụp camera mới sau khi cấu hình lại vùng quan sát.',

  'ppe.viewport.rawConnectingTitle': 'Đang kết nối luồng trực tiếp (LIVE) gốc...',
  'ppe.viewport.rawConnectingDesc': 'Luồng NDJSON liên tục đã xác thực.',
  'ppe.viewport.rawStalledTitle': 'Luồng trực tiếp gốc bị nghẽn',
  'ppe.viewport.rawStalledDesc': 'Không nhận được khung hình mới quá 2 giây (TTL media 2 giây).',
  'ppe.viewport.reconnectStream': 'Kết nối lại luồng',
  'ppe.viewport.rawAccessDeniedTitle': 'Từ chối quyền truy cập camera',
  'ppe.viewport.rawUnavailableTitle': 'Luồng trực tiếp gốc không khả dụng',
  'ppe.viewport.rawError401':
    'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại để xem camera này.',
  'ppe.viewport.rawError403': 'Bạn không có quyền xem camera này.',
  'ppe.viewport.rawError429':
    'Quá nhiều yêu cầu. Luồng sẽ tự động kết nối lại sau thời gian chờ của máy chủ.',
  'ppe.viewport.rawError503':
    'Nguồn camera đang ngoại tuyến. Vui lòng kiểm tra kết nối hoặc thử lại.',
  'ppe.viewport.rawErrorDefault': 'Không có luồng video gốc đang hoạt động cho camera đã chọn.',
  'ppe.viewport.retryStream': 'Thử lại luồng',
  'ppe.viewport.switchToAiEvidence': 'Chuyển sang bằng chứng AI',

  'ppe.viewport.recordedLoadingTitle': 'Đang tải video ghi sẵn MP4...',
  'ppe.viewport.recordedLoadingDesc': 'Luồng video đã xác thực (giới hạn ≤2MB).',
  'ppe.viewport.recordedAccessDeniedTitle': 'Từ chối quyền truy cập video ghi sẵn',
  'ppe.viewport.recordedUnavailableTitle': 'Video ghi sẵn không khả dụng',
  'ppe.viewport.recordedError401':
    'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại để xem video ghi sẵn này.',
  'ppe.viewport.recordedError403': 'Bạn không có quyền xem video ghi sẵn này.',
  'ppe.viewport.recordedErrorDefault': 'Không có video ghi sẵn đang hoạt động cho camera đã chọn.',
  'ppe.viewport.retryVideo': 'Thử tải lại video',

  'ppe.viewport.snapshotConnectingTitle': 'Đang kết nối ảnh chụp camera (500ms)...',
  'ppe.viewport.snapshotConnectingDesc':
    'Đã xác minh phạm vi công trường và camera được cấp quyền.',
  'ppe.viewport.snapshotUnavailableTitle': 'Ảnh chụp camera không khả dụng',
  'ppe.viewport.snapshotErrorDefault':
    'Không có ảnh chụp camera đang hoạt động cho camera đã chọn.',
  'ppe.viewport.snapshotCooldown429': 'Tự động thử lại sau thời gian chờ của máy chủ.',
  'ppe.viewport.retrySnapshot': 'Thử tải lại ảnh chụp',

  'ppe.badge.rawTitleLive': 'LUỒNG TRỰC TIẾP GỐC · Video chưa qua phân tích AI',
  'ppe.badge.rawTitleStalled': 'LUỒNG TRỰC TIẾP GỐC · Bị nghẽn (TTL 2s)',
  'ppe.badge.rawTitleUnavailable': 'LUỒNG TRỰC TIẾP GỐC · Không khả dụng',
  'ppe.badge.recordedTitleReady': 'VIDEO GHI SẴN GỐC · Phát độc lập · Không đồng bộ với AI',
  'ppe.badge.recordedTitleLoading': 'VIDEO GHI SẴN GỐC · Đang tải',
  'ppe.badge.recordedTitleUnavailable': 'VIDEO GHI SẴN GỐC · Không khả dụng',
  'ppe.badge.aiPaused': 'TẠM DỪNG XỬ LÝ AI',
  'ppe.badge.aiLiveSnapshot': 'ẢNH CHỤP TRỰC TIẾP MF05 (500ms)',
  'ppe.badge.aiReplaySnapshot': 'ẢNH CHỤP PHÁT LẠI MF05 (500ms)',
  'ppe.badge.aiSnapshotUnavailable': 'ẢNH CHỤP MF05 KHÔNG KHẢ DỤNG',
  'ppe.badge.rawPrefix': 'LUỒNG TRỰC TIẾP GỐC',
  'ppe.badge.rawStateLive': 'Video chưa phân tích',
  'ppe.badge.rawStateStalled': 'Bị nghẽn (TTL 2s)',
  'ppe.badge.rawStateConnecting': 'Đang kết nối',
  'ppe.badge.stateUnavailable': 'Không khả dụng',
  'ppe.badge.recordedPrefix': 'VIDEO GHI SẴN GỐC',
  'ppe.badge.recordedStateReady': 'Phát độc lập (Không đồng bộ với AI)',
  'ppe.badge.recordedStateLoading': 'Đang tải',
  'ppe.badge.resultMissing': 'THIẾU BẢO HỘ (PPE)',
  'ppe.badge.resultVerifying': 'ĐANG KIỂM TRA PPE',
  'ppe.badge.resultCompliant': 'GHI NHẬN ĐỦ PPE CƠ BẢN',
  'ppe.badge.resultUnknown': 'PPE CHƯA XÁC ĐỊNH',
  'ppe.badge.resultNoTargets': 'KHÔNG CÓ ĐỐI TƯỢNG',

  'ppe.viewport.emptyFrameReplay':
    'Ảnh chụp phát lại đang hoạt động · Không phát hiện người trong khung hình',
  'ppe.viewport.emptyFrameLive':
    'Ảnh chụp trực tiếp đang hoạt động · Không phát hiện người trong khung hình',
  'ppe.viewport.sourceBadge': 'NGUỒN: {source}',

  'ppe.toolbar.videoModeGroupAria': 'Chế độ hiển thị video',
  'ppe.toolbar.liveRawBtn': 'Video trực tiếp (Gốc)',
  'ppe.toolbar.aiEvidenceBtn': 'Bằng chứng AI (Khung nhận diện)',
  'ppe.toolbar.recordedModeGroupAria': 'Chế độ hiển thị video ghi sẵn',
  'ppe.toolbar.recordedRawBtn': 'Video ghi sẵn (Gốc)',
  'ppe.toolbar.replayAiOnly': 'PHÁT LẠI (REPLAY) · Chỉ hiển thị bằng chứng AI',
  'ppe.toolbar.captionPaused': 'Đã tạm dừng giám sát AI & phát luồng',
  'ppe.toolbar.captionLiveRaw':
    'Luồng gốc độc lập (tối đa 8 khung hình/giây) · Lấy mẫu ảnh chụp AI: 500ms',
  'ppe.toolbar.captionRecordedRaw':
    'MP4 ghi sẵn gốc · Phát độc lập từ nguồn (không đồng bộ với AI)',
  'ppe.toolbar.captionAiPolling': 'Lấy mẫu ảnh chụp AI: 500ms',
  'ppe.toolbar.switchToWallAria': 'Chuyển sang chế độ lưới 4 nguồn',

  'ppe.card.headerTitle': 'NHẬN DIỆN AI',
  'ppe.card.rawUnanalyzedBadge': 'LUỒNG GỐC CHƯA PHÂN TÍCH',
  'ppe.card.recordedUnanalyzedBadge': 'VIDEO GHI SẴN · KHÔNG ĐỒNG BỘ AI',
  'ppe.card.noDetectionBadge': 'NO-DETECTION',
  'ppe.card.evidenceUnavailableBadge': 'KHÔNG CÓ BẰNG CHỨNG AI',
  'ppe.card.pausedEmptyTitle': 'Đã tạm dừng kiểm tra AI — không có bằng chứng hiện tại',
  'ppe.card.pausedEmptyDesc':
    'Phân tích luồng camera và kiểm tra ảnh chụp PPE đang tạm dừng. Không có nhận diện trực tiếp nào đang được đánh giá.',

  'ppe.card.fieldIdentity': 'Danh tính',
  'ppe.card.identitySnapshotUnavailable': 'Ảnh chụp AI không khả dụng',
  'ppe.card.identityUnknown': 'Chưa xác định — không định danh công nhân',
  'ppe.card.identityNoPerson': 'Không phát hiện người',
  'ppe.card.fieldTrackId': 'Mã theo vết (Track ID)',
  'ppe.card.fieldCamera': 'Camera',
  'ppe.card.fieldWorkArea': 'Khu vực làm việc',
  'ppe.card.fieldDetected': 'Thời điểm ghi nhận',
  'ppe.card.fieldConfidence': 'Độ tin cậy nhận diện',

  'ppe.check.heading': 'KIỂM TRA BẢO HỘ (PPE)',
  'ppe.check.experimentalBadge': 'THỬ NGHIỆM (5 HẠNG MỤC)',
  'ppe.check.coreNote':
    'Quan sát cơ bản: Mũ bảo hộ & Áo phản quang. Các hạng mục mở rộng được đánh giá khi có dữ liệu báo cáo.',
  'ppe.check.experimentalNote':
    '5 quan sát AI thử nghiệm (Mũ bảo hộ, Áo phản quang, Găng tay, Giày bảo hộ, Kính bảo hộ): hạng mục chưa đủ bằng chứng giữ trạng thái Chưa xác định. Không có phát hiện không đồng nghĩa với chứng nhận an toàn.',
  'ppe.check.unavailableTitle': 'Ảnh chụp bằng chứng AI không khả dụng',
  'ppe.check.unavailableRawDesc':
    'Đang hiển thị luồng camera gốc chưa qua phân tích. Kiểm tra ảnh chụp định kỳ đang ngoại tuyến hoặc chưa nhận được dữ liệu.',
  'ppe.check.unavailableDefaultDesc':
    'Chưa nhận được ảnh chụp bằng chứng AI đang hoạt động cho camera này.',
  'ppe.check.noTrackedIndividuals': 'Không có cá nhân nào được theo vết trong ảnh chụp hiện tại',

  'ppe.item.HARD_HAT': 'Mũ bảo hộ',
  'ppe.item.SAFETY_VEST': 'Áo phản quang',
  'ppe.item.GLOVES': 'Găng tay',
  'ppe.item.BOOTS': 'Giày bảo hộ',
  'ppe.item.GOGGLES': 'Kính bảo hộ',

  'ppe.status.CONFIRMED_MISSING': 'Thiếu · đã xác nhận',
  'ppe.status.PENDING_MISSING': 'Thiếu · đang kiểm tra',
  'ppe.status.PRESENT': 'Đã nhận diện',
  'ppe.status.NOT_REPORTED': 'Không báo cáo',
  'ppe.status.UNKNOWN': 'Chưa xác định',

  'ppe.episodeWarning.title': 'Đợt thiếu PPE đã xác nhận đang mở: Thiếu · đã xác nhận',
  'ppe.episodeWarning.currentSnapshot': 'Ảnh chụp hiện tại: {status}',
  'ppe.episodeWarning.descUnknown':
    'Chưa xác định nghĩa là ảnh chụp hiện tại chưa đủ bằng chứng quan sát và không xóa đợt thiếu bảo hộ đã xác nhận.',
  'ppe.episodeWarning.descNotReported':
    'Không báo cáo nghĩa là ảnh chụp hiện tại không có dữ liệu hạng mục này và không xóa đợt thiếu bảo hộ đã xác nhận.',
  'ppe.episodeWarning.descPresent':
    'Đợt thiếu bảo hộ trước đó vẫn giữ trạng thái xác nhận cho đến khi máy chủ xác minh đã khắc phục ổn định.',
  'ppe.episodeWarning.descDefault': 'Đợt thiếu bảo hộ trước đó vẫn đang được xác nhận.',

  'ppe.card.rawObjectsCountLink': '{count} vật thể bộ dò thô trong ngăn chẩn đoán ↓',
  'ppe.card.viewDiagnosticsLink': 'Xem chẩn đoán bộ dò trong ngăn bên dưới ↓',

  'ppe.result.label': 'KẾT QUẢ',
  'ppe.result.missingDetected': 'PHÁT HIỆN THIẾU BẢO HỘ (PPE)',
  'ppe.result.coreAndReportedDetected': 'GHI NHẬN PPE CƠ BẢN VÀ HẠNG MỤC BÁO CÁO',
  'ppe.result.helmetAndVestDetected': 'GHI NHẬN MŨ BẢO HỘ VÀ ÁO PHẢN QUANG',
  'ppe.result.evidenceUnavailable': 'BẰNG CHỨNG AI KHÔNG KHẢ DỤNG',
  'ppe.result.noObservations': 'KHÔNG CÓ QUAN SÁT',
  'ppe.result.scanningSnapshot': 'ĐANG QUÉT ẢNH CHỤP',
  'ppe.result.descRawUnavailable':
    'Đang hiển thị luồng camera gốc chưa qua phân tích. Kiểm tra ảnh chụp AI hiện không khả dụng.',
  'ppe.result.descSnapshotOffline': 'Ảnh chụp camera hiện không khả dụng hoặc đang ngoại tuyến.',
  'ppe.result.descCompliantExpanded':
    'Đã ghi nhận mũ bảo hộ, áo phản quang và các hạng mục PPE mở rộng có trong báo cáo.',
  'ppe.result.descCompliantCoreOnly':
    'Các hạng mục mở rộng (găng tay, giày, kính bảo hộ) chưa được đánh giá.',
  'ppe.result.descMissing': 'Ghi nhận thiếu trang bị bảo hộ (PPE) trong ảnh chụp.',
  'ppe.result.descZeroDetectionsReplay':
    'Đang hiển thị luồng phát lại video ghi sẵn từ Camera Preview API. Không có phát hiện không đồng nghĩa với chứng nhận đủ điều kiện an toàn.',
  'ppe.result.descZeroDetectionsLive':
    'Đang truyền ảnh chụp trực tiếp từ Camera Preview API. Không có phát hiện không đồng nghĩa với chứng nhận đủ điều kiện an toàn.',
  'ppe.result.descStreamingReplay':
    'Đang hiển thị luồng phát lại video ghi sẵn từ Camera Preview API.',
  'ppe.result.descStreamingLive': 'Đang truyền ảnh chụp trực tiếp từ Camera Preview API.',

  'ppe.action.reviewAlert': 'Xác minh cảnh báo',

  'ppe.diagnostics.title': 'Chẩn đoán kỹ thuật',
  'ppe.diagnostics.subtitle': 'Kết quả nhận diện thử nghiệm và công cụ demo.',
  'ppe.diagnostics.collapseBtn': 'Thu gọn chẩn đoán ↑',
  'ppe.diagnostics.expandBtn': 'Mở rộng chẩn đoán ↓',
  'ppe.diagnostics.experimentalObjectsTitle': 'Vật thể thử nghiệm (bộ dò thô)',
  'ppe.diagnostics.objectDetectedBadge': 'Có vật thể được nhận diện',
  'ppe.diagnostics.noObjectInFrame': 'Không phát hiện vật thể trong khung hình này',
  'ppe.diagnostics.boxesOn': 'Hiện khung nhận diện',
  'ppe.diagnostics.boxesOff': 'Ẩn khung nhận diện',
  'ppe.diagnostics.raw15ClassDisclaimer':
    'Quan sát thô 15 lớp từ bộ dò. Chỉ nhận diện sự xuất hiện của vật thể, KHÔNG xác nhận công nhân đang đeo đúng quy cách, không chứng nhận dây đai/móc treo đã neo an toàn hay khẩu trang đạt chuẩn, và không phải cảnh báo lưu trữ. Không có phát hiện không đồng nghĩa với chứng nhận an toàn.',
  'ppe.diagnostics.presetHeading': 'Bộ lọc trọng tâm hiển thị',
  'ppe.diagnostics.presetSubnote': 'Bộ lọc hiển thị tạm thời (không lưu máy chủ)',
  'ppe.diagnostics.presetGroupAria': 'Các chế độ trọng tâm hiển thị',
  'ppe.diagnostics.presetDisclaimer':
    'Chỉ lọc phạm vi hiển thị trên màn hình. Không làm thay đổi quy định PPE bắt buộc của khu vực và không chứng nhận tuân thủ an toàn.',
  'ppe.diagnostics.objectOnlyTag': 'chỉ-vật-thể',
  'ppe.diagnostics.negativeObservationsHeading': 'Quan sát thiếu bảo hộ (bộ dò thô)',

  'ppe.observations.pausedHeading': 'Đã tạm dừng quan sát AI',
  'ppe.observations.replayHeading': 'Đang hiển thị quan sát AI phát lại',
  'ppe.observations.liveHeading': 'Đang hiển thị quan sát AI trực tiếp',
  'ppe.observations.pausedDesc':
    'Giám sát AI đang tạm dừng. Bạn vẫn có thể quản lý cấu hình Khu vực và camera; không thu thập thêm quan sát hay bằng chứng mới.',
  'ppe.observations.replayDesc':
    'Các nhận diện PPE kỹ thuật được hiển thị từ luồng phát lại video ghi sẵn phía trên. Các dòng mẫu được ẩn trong khi phát luồng. Cảnh báo an toàn lưu trữ bền vững do Backend xử lý; vui lòng xem và xác minh bản ghi lưu trữ tại mục Cảnh báo an toàn.',
  'ppe.observations.liveDesc':
    'Các nhận diện PPE kỹ thuật được hiển thị trực tiếp trên luồng camera phía trên. Các dòng mẫu được ẩn trong khi giám sát trực tiếp. Cảnh báo an toàn lưu trữ bền vững do Backend xử lý; vui lòng xem và xác minh bản ghi lưu trữ tại mục Cảnh báo an toàn.',
  'ppe.observations.viewInSafetyAlerts': 'Xem trong Cảnh báo an toàn →',

  'ppe.table.heading': 'Quan sát PPE từ ảnh chụp',
  'ppe.table.subtitle':
    'Các quan sát kỹ thuật từ nguồn ảnh chụp camera. Cảnh báo an toàn chính thức được quản lý tại mục Cảnh báo an toàn.',
  'ppe.table.filteredByTrack': ' (Đang lọc theo Track #{id})',
  'ppe.table.colTime': 'Thời gian',
  'ppe.table.colWorker': 'Mã theo vết / Công nhân',
  'ppe.table.colCamera': 'Camera',
  'ppe.table.colWorkArea': 'Khu vực làm việc',
  'ppe.table.colIssue': 'Vấn đề ghi nhận',
  'ppe.table.colConfidence': 'Độ tin cậy',
  'ppe.table.colStatus': 'Trạng thái',
  'ppe.table.colAction': 'Thao tác',
  'ppe.table.empty': 'Không có sự kiện PPE nào khớp với tiêu chí đã chọn.',

  'ppe.reviewModal.title': 'Xem xét quan sát thiếu PPE',
  'ppe.reviewModal.description':
    'Kiểm tra thông tin quan sát kỹ thuật trong phạm vi hiện tại trước khi chuyển sang Cảnh báo an toàn.',
  'ppe.reviewModal.subjectLabel': 'Đối tượng theo vết:',
  'ppe.reviewModal.cameraLabel': 'Camera:',
  'ppe.reviewModal.workAreaLabel': 'Khu vực làm việc:',
  'ppe.reviewModal.issueLabel': 'Vấn đề ghi nhận:',
  'ppe.reviewModal.timeLabel': 'Thời gian:',
  'ppe.reviewModal.disclaimer':
    'Quan sát kỹ thuật từ AI chỉ là bằng chứng tham khảo. Quyết định xác minh tuân thủ an toàn cuối cùng thuộc về Cán bộ an toàn có thẩm quyền.',
  'ppe.reviewModal.dismissBtn': 'Đóng xem trước',
  'ppe.reviewModal.continueBtn': 'Xác minh trong Cảnh báo an toàn',

  'mf06.detail.title': 'Đánh giá đã lưu',
  'mf06.detail.disclaimerTitle': 'Đánh giá kỹ thuật lịch sử · Không phải quyền ra vào',
  'mf06.detail.disclaimerBody':
    'Bản ghi này thể hiện kết quả đánh giá kỹ thuật lịch sử tại thời điểm ghi nhận; không cấp phép, không đại diện và không xác nhận danh tính công nhân hiện tại, quyền ra vào khu vực hay trạng thái cảnh báo.',
  'mf06.detail.loading': 'Đang tải chi tiết đánh giá...',
  'mf06.detail.error.401':
    'Phiên làm việc đã hết hạn hoặc chưa được xác thực. Vui lòng đăng nhập lại.',
  'mf06.detail.error.403': 'Bạn không có quyền xem đánh giá này.',
  'mf06.detail.error.404': 'Không tìm thấy bản ghi đánh giá hoặc dữ liệu không khả dụng.',
  'mf06.detail.error.503': 'Dịch vụ đánh giá tạm thời không khả dụng (503).',
  'mf06.detail.error.default': 'Không thể tải chi tiết đánh giá. Vui lòng thử lại.',
  'mf06.detail.retry': 'Thử lại',
  'mf06.detail.validationMismatch':
    'Bản ghi đánh giá không khớp với ngữ cảnh yêu cầu ban đầu ({reason}).',
  'mf06.detail.outcome.ALLOWED': 'Được phép',
  'mf06.detail.outcome.DENIED': 'Từ chối',
  'mf06.detail.outcome.UNAVAILABLE': 'Chưa có kết quả',
  'mf06.detail.reason.AUTHORIZED': 'Đủ điều kiện theo quy định',
  'mf06.detail.reason.POLICY_NONE': 'Chính sách cho phép',
  'mf06.detail.reason.UNAUTHORIZED': 'Không được phép',
  'mf06.detail.reason.POLICY_PROHIBITED': 'Bị cấm theo chính sách',
  'mf06.detail.reason.INVALID_BINDING': 'Liên kết ngữ cảnh không hợp lệ',
  'mf06.detail.reason.IDENTITY_UNAVAILABLE': 'Chưa xác định được danh tính',
  'mf06.detail.reason.MEDIA_UNAVAILABLE': 'Không có dữ liệu hình ảnh',
  'mf06.detail.reason.PROFILE_REVOKED': 'Hồ sơ đã thu hồi',
  'mf06.detail.reason.AUTHORITY_UNAVAILABLE': 'Chưa có dữ liệu thẩm quyền',
  'mf06.detail.reason.SERVICE_DISABLED': 'Dịch vụ đang tắt',
  'mf06.detail.reason.ABORTED': 'Đã hủy xử lý',
  'mf06.detail.purpose.INITIAL_OBSERVATION_ASSESSMENT': 'Quan sát ban đầu',
  'mf06.detail.purpose.RETROSPECTIVE_REVIEW': 'Rà soát hồi cứu',
  'mf06.detail.field.captured': 'Thời điểm ghi hình:',
  'mf06.detail.field.assessed': 'Thời điểm đánh giá:',
  'mf06.detail.field.assessmentId': 'Mã đánh giá:',
  'mf06.detail.field.requestId': 'Mã yêu cầu:',
  'mf06.detail.field.eventId': 'Mã sự kiện:',
  'mf06.detail.field.cameraId': 'Mã camera:',
  'mf06.detail.field.zoneId': 'Mã khu vực:',
  'mf06.detail.field.provenance': 'Nguồn xác lập:',

  'mf06.history.error.403': 'Bạn không có quyền xem đánh giá của công trường này.',
  'mf06.history.error.404': 'Không tìm thấy công trường hoặc tài nguyên đánh giá.',
  'mf06.history.error.default': 'Không thể tải lịch sử đánh giá. Vui lòng thử lại.',
  'mf06.history.noSite': 'Chọn một công trường để xem lịch sử đánh giá khu vực.',
  'mf06.history.sectionAria': 'Lịch sử đánh giá khu vực hạn chế',
  'mf06.history.heading': 'Lịch sử đánh giá khu vực hạn chế MF06',
  'mf06.history.total': 'Tổng số: {total}',
  'mf06.history.disclaimer':
    'Các bản ghi lịch sử phản ánh quan sát kỹ thuật từ camera tại thời điểm ghi hình; không cấu thành quyền ra vào đang hiệu lực, danh tính công nhân đã xác nhận hay cảnh báo an toàn.',
  'mf06.history.loading': 'Đang tải lịch sử đánh giá...',
  'mf06.history.emptyTitle': 'Chưa có lịch sử đánh giá được lưu.',
  'mf06.history.emptyDesc': 'Chưa có bản ghi đánh giá khu vực nào cho công trường này.',
  'mf06.history.viewAssessment': 'Xem đánh giá',
  'mf06.history.fieldCamera': 'Camera:',
  'mf06.history.fieldZone': 'Khu vực:',
  'mf06.history.technicalReferences': 'Thông tin kỹ thuật',
  'mf06.history.nextPageError': 'Không thể tải thêm bản ghi đánh giá.',
  'mf06.history.retryNextPage': 'Thử tải lại trang tiếp theo',
  'mf06.history.loadingMore': 'Đang tải thêm 20...',
  'mf06.history.loadMore': 'Tải thêm (20)',
  'mf06.case.moduleLabel': 'MF06',
  'mf06.case.reasonLabel': 'Lý do:',
  'mf06.case.fieldPurpose': 'Mục đích:',
  'mf06.case.fieldEvaluator': 'Bộ đánh giá:',
  'mf06.case.evidenceLabel': 'Ảnh bằng chứng:',
  'mf06.case.evidenceOpenRecord': 'Ảnh trong hồ sơ (nếu có)',
  'mf06.case.identityTeamLabel': 'Người / Tổ đội:',
  'mf06.case.identityNotProjected': 'Không có dữ liệu công khai về người/tổ đội',
  'mf06.case.currentCameraLabel': 'Camera (danh mục hiện tại)',

  'mf06.panel.sectionAria': 'Đánh giá và yêu cầu khu vực hạn chế',
  'mf06.panel.heading': 'Đánh giá khu vực hạn chế MF06',
  'mf06.panel.tablistAria': 'Chế độ xem đánh giá',
  'mf06.panel.tabAssessments': 'Đánh giá',
  'mf06.panel.tabRequests': 'Yêu cầu',

  'mf06.requests.jobStatus.NOT_QUEUED': 'Chưa vào hàng đợi',
  'mf06.requests.jobStatus.PENDING': 'Đang chờ',
  'mf06.requests.jobStatus.CLAIMED': 'Đã nhận xử lý (bản ghi)',
  'mf06.requests.jobStatus.SUCCEEDED': 'Hoàn tất',
  'mf06.requests.jobStatus.FAILED': 'Thất bại',
  'mf06.requests.jobStatus.CANCELLED': 'Đã hủy',
  'mf06.requests.error.403': 'Bạn không có quyền xem yêu cầu của công trường này.',
  'mf06.requests.error.404': 'Không tìm thấy công trường hoặc tài nguyên yêu cầu đánh giá.',
  'mf06.requests.error.503': 'Dịch vụ trạng thái yêu cầu tạm thời không khả dụng (503).',
  'mf06.requests.error.default': 'Không thể tải danh sách yêu cầu đánh giá. Vui lòng thử lại.',
  'mf06.requests.noSite': 'Chọn một công trường để xem các yêu cầu đánh giá.',
  'mf06.requests.bannerPausedTitle': 'Giám sát AI đang tạm dừng · Trạng thái yêu cầu kỹ thuật',
  'mf06.requests.bannerActiveTitle': 'Trạng thái yêu cầu kỹ thuật · Chỉ siêu dữ liệu',
  'mf06.requests.bannerPausedBody':
    'Luồng đánh giá AI hiện đang tạm dừng: không thực hiện đánh giá AI mới và không đưa yêu cầu mới vào hàng đợi. Các yêu cầu hiển thị phản ánh trạng thái đã ghi nhận trước đó; trạng thái CLAIMED đã lưu là bản ghi lịch sử, không phải tiến trình xử lý đang chạy hay quyền của công nhân. Quan sát kỹ thuật không cấp quyền ra vào hay xác nhận danh tính công nhân.',
  'mf06.requests.bannerActiveBody':
    'Các yêu cầu hiển thị chỉ phản ánh siêu dữ liệu hàng đợi và đánh giá kỹ thuật; không tự động cấp quyền hay suy diễn danh tính. Trạng thái CLAIMED đã lưu là bản ghi lịch sử, không phải tiến trình xử lý đang chạy hay quyền của công nhân. Quan sát kỹ thuật không cấp quyền ra vào hay xác nhận danh tính công nhân.',
  'mf06.requests.refreshing': 'Đang làm mới...',
  'mf06.requests.refresh': 'Làm mới',
  'mf06.requests.loading': 'Đang tải yêu cầu đánh giá...',
  'mf06.requests.emptyTitle': 'Chưa có yêu cầu đánh giá được lưu.',
  'mf06.requests.emptyDesc':
    'Chưa có yêu cầu đánh giá khu vực nào được ghi nhận cho công trường này.',
  'mf06.requests.deadlinePassed': 'Đã quá hạn xử lý',
  'mf06.requests.attempts': 'Số lần thử: {count}',
  'mf06.requests.fieldRequested': 'Thời điểm yêu cầu:',
  'mf06.requests.fieldDeadline': 'Hạn xử lý:',
  'mf06.requests.deadlineNone': 'Không có',
  'mf06.requests.nextPageError': 'Không thể tải thêm yêu cầu đánh giá.',

  'dialog.closeAria': 'Đóng hộp thoại',

  'zoneSetup.dialog.title': 'Cấu hình PPE Khu vực',
  'zoneSetup.dialog.description':
    'Thiết lập yêu cầu bảo hộ và vùng quan sát camera cho {siteName}.',
  'zoneSetup.dialog.zonesDescription': 'Thiết lập yêu cầu bảo hộ cho các khu vực tại {siteName}.',
  'zoneSetup.dialog.discardTitle': 'Hủy các thay đổi Khu vực chưa lưu?',
  'zoneSetup.dialog.discardDescription':
    'Các thông tin trường Khu vực và thay đổi tên chưa lưu sẽ bị mất.',
  'zoneSetup.dialog.keepEditing': 'Tiếp tục chỉnh sửa',
  'zoneSetup.dialog.discardChanges': 'Hủy thay đổi',

  'zoneSetup.title': 'Cấu hình PPE theo Khu vực',
  'zoneSetup.subtitlePrefix':
    'Thiết lập trang bị bảo hộ (PPE) bắt buộc cho các khu vực nguy hiểm tại',
  'zoneSetup.subtitleSuffix': '.',
  'zoneSetup.closeAria': 'Đóng',

  'zoneSetup.field.codeLabel': 'Mã khu vực',
  'zoneSetup.field.codePlaceholder': 'VD: ZONE-HAZ-01',
  'zoneSetup.field.nameLabel': 'Tên khu vực',
  'zoneSetup.field.namePlaceholder': 'VD: Khu vực giàn giáo',
  'zoneSetup.field.ppeLegend': 'Chọn PPE bắt buộc',

  'zoneSetup.ppe.HARD_HAT': 'Mũ bảo hộ',
  'zoneSetup.ppe.SAFETY_VEST': 'Áo phản quang',
  'zoneSetup.ppe.GLOVES': 'Găng tay',
  'zoneSetup.ppe.BOOTS': 'Giày bảo hộ',
  'zoneSetup.ppe.GOGGLES': 'Kính bảo hộ',
  'zoneSetup.ppe.HARNESS': 'Dây an toàn',
  'zoneSetup.ppe.MASK': 'Khẩu trang',
  'zoneSetup.ppe.HOOK': 'Móc dây cứu sinh',
  'zoneSetup.ppe.coreTag': '(Cơ bản)',
  'zoneSetup.ppe.experimentalTag': '(Thử nghiệm)',
  'zoneSetup.ppe.experimentalNote': 'Năng lực kỹ thuật · thử nghiệm',
  'zoneSetup.ppe.notAvailableNote': 'Chưa hỗ trợ làm yêu cầu bắt buộc của khu vực',

  'zoneSetup.action.cancel': 'Hủy',
  'zoneSetup.action.clearForm': 'Xóa nháp',
  'zoneSetup.action.saving': 'Đang lưu...',
  'zoneSetup.action.saveZonePpe': 'Lưu PPE Khu vực',

  'zoneSetup.validation.codeRequired': 'Mã khu vực là bắt buộc.',
  'zoneSetup.validation.codeControlChars': 'Mã khu vực không được chứa ký tự điều khiển.',
  'zoneSetup.validation.codeMaxLength': 'Mã khu vực không được vượt quá 64 ký tự.',
  'zoneSetup.validation.nameRequired': 'Tên khu vực là bắt buộc.',
  'zoneSetup.validation.nameControlChars': 'Tên khu vực không được chứa ký tự điều khiển.',
  'zoneSetup.validation.nameMaxLength': 'Tên khu vực không được vượt quá 255 ký tự.',
  'zoneSetup.validation.ppeRequired': 'Phải chọn ít nhất một hạng mục PPE.',

  'zoneSetup.error.401':
    'Phiên làm việc đã hết hạn hoặc chưa được xác thực. Vui lòng đăng nhập lại.',
  'zoneSetup.error.403': 'Bạn không có quyền thực hiện thao tác này.',
  'zoneSetup.create.error.wrongScope':
    'Khu vực được tạo với phạm vi công trường không khớp. Vui lòng làm mới.',
  'zoneSetup.create.error.409': 'Mã khu vực này đã tồn tại trong công trường.',
  'zoneSetup.create.error.default':
    'Không thể tạo khu vực. Vui lòng kiểm tra thông tin nhập và kết nối mạng.',
  'zoneSetup.create.success':
    'Đã tạo khu vực "{code}" thành công. Hãy gắn khu vực này với vùng quan sát của camera khi sẵn sàng.',

  'zoneSetup.rename.validation.controlChars':
    'Tên khu vực không được chứa ký tự điều khiển hoặc mã đại diện không hợp lệ.',
  'zoneSetup.rename.validation.required': 'Tên khu vực là bắt buộc.',
  'zoneSetup.rename.validation.maxLength': 'Tên khu vực không được vượt quá 255 ký tự.',
  'zoneSetup.rename.error.wrongScope':
    'Khu vực được cập nhật với phạm vi hoặc mã khu vực không khớp.',
  'zoneSetup.rename.error.409':
    'Không thể cập nhật khu vực này lúc này. Vui lòng tải lại danh sách khu vực và thử lại.',
  'zoneSetup.rename.error.default':
    'Không thể đổi tên khu vực. Vui lòng kiểm tra kết nối mạng và thử lại.',
  'zoneSetup.rename.success': 'Đã cập nhật tên khu vực thành "{name}".',

  'zoneSetup.list.heading': 'Các khu vực đã cấu hình cho công trường này',
  'zoneSetup.list.showingCount': 'Hiển thị {shown} / {total} khu vực',
  'zoneSetup.list.countOne': '{count} khu vực',
  'zoneSetup.list.countOther': '{count} khu vực',
  'zoneSetup.list.loading': 'Đang tải danh sách khu vực đã cấu hình...',
  'zoneSetup.list.initialError': 'Không thể tải danh sách khu vực đã cấu hình cho công trường này.',
  'zoneSetup.list.retrying': 'Đang thử lại...',
  'zoneSetup.list.retryInitial': 'Thử tải lại khu vực',
  'zoneSetup.list.authRevokedError':
    'Không thể tải danh sách khu vực đã cấu hình cho công trường này. Quyền truy cập bị từ chối hoặc phiên đã hết hạn.',
  'zoneSetup.list.nextPageError':
    'Không thể tải thêm khu vực. Vui lòng kiểm tra kết nối mạng và thử lại.',
  'zoneSetup.list.retryNextPage': 'Thử tải thêm khu vực',
  'zoneSetup.list.empty': 'Chưa có khu vực nào được cấu hình cho công trường này.',
  'zoneSetup.list.emptyReadOnly':
    'Chưa có khu vực nào được cấu hình cho công trường này. Chỉ huy công trường (Site Manager) được phân công cần tạo khu vực trước khi liên kết vùng quan sát camera.',
  'zoneSetup.list.loadingMore': 'Đang tải thêm khu vực...',
  'zoneSetup.list.loadMore': 'Tải thêm khu vực',
  'zoneSetup.readOnly.notice':
    'Danh mục khu vực ở chế độ chỉ đọc đối với vai trò của bạn. Chỉ Chỉ huy công trường (Site Manager) được phân công mới có quyền tạo hoặc đổi tên khu vực cho công trường này.',

  'zoneSetup.rename.headingPrefix': 'Đang đổi tên khu vực:',
  'zoneSetup.rename.policyLockedBadge': 'Đã khóa chính sách · Có thể đổi tên',
  'zoneSetup.rename.newNameLabel': 'Tên khu vực mới',
  'zoneSetup.rename.cancelBtn': 'Hủy đổi tên',
  'zoneSetup.rename.savingBtn': 'Đang lưu tên...',
  'zoneSetup.rename.saveBtn': 'Lưu tên',
  'zoneSetup.rename.triggerBtn': 'Đổi tên {code}',

  'zoneSetup.regionLink.emptyHint':
    'Hãy cấu hình và lưu ít nhất một khu vực ở trên để bật liên kết Vùng quan sát của camera.',
  'zoneSetup.regionLink.emptyReadOnlyHint':
    'Chỉ huy công trường (Site Manager) được phân công cần tạo và lưu ít nhất một khu vực ở trên để bật liên kết Vùng quan sát của camera.',
  'zoneSetup.regionLink.emptyTaskHint':
    'Tạo và lưu chính sách khu vực ở bước 1 trước khi gắn vùng quan sát.',

  'regionSetup.sectionAria': 'Liên kết Khu vực với Vùng quan sát Camera',
  'regionSetup.title': 'Liên kết Khu vực với Vùng quan sát Camera',
  'regionSetup.subtitle': 'Vẽ và gắn đa giác vùng quan sát của camera vào khu vực đã chọn.',
  'regionSetup.closeAria': 'Đóng',
  'regionSetup.field.selectZone': 'Chọn Khu vực',
  'regionSetup.field.selectCamera': 'Chọn Camera',
  'regionSetup.camera.countSummary':
    '{active} đang hoạt động (đã tải {loaded}/{total} tại công trường)',
  'regionSetup.camera.loading': 'Đang tải camera…',
  'regionSetup.camera.retrying': 'Đang thử tải lại camera…',
  'regionSetup.camera.retryInitial': 'Thử tải lại camera',
  'regionSetup.camera.retryingMore': 'Đang thử tải thêm camera…',
  'regionSetup.camera.retryNextPage': 'Thử tải thêm camera',
  'regionSetup.camera.loadingMore': 'Đang tải thêm camera…',
  'regionSetup.camera.loadMore': 'Tải thêm camera',
  'regionSetup.error.401':
    'Phiên làm việc đã hết hạn hoặc chưa được xác thực. Vui lòng đăng nhập lại.',
  'regionSetup.camera.error.403': 'Bạn không có quyền xem các camera này.',
  'regionSetup.region.error.403': 'Bạn không có quyền xem các vùng quan sát này.',
  'regionSetup.camera.error.404': 'Không tìm thấy tài nguyên camera.',
  'regionSetup.region.error.404': 'Không tìm thấy tài nguyên vùng quan sát.',
  'regionSetup.camera.error.default': 'Không thể tải danh sách camera. Vui lòng thử lại.',
  'regionSetup.region.error.default': 'Không thể tải danh sách vùng quan sát. Vui lòng thử lại.',
  'regionSetup.action.drawingActive': 'Đang vẽ vùng quan sát',
  'regionSetup.action.startDrawing': 'Bắt đầu vẽ vùng quan sát',
  'regionSetup.action.startDrawingHint':
    'Nhấn Bắt đầu vẽ vùng quan sát trên khung hình camera để xác định phạm vi quan sát',
  'regionSetup.previewWarning.aiPaused':
    'Tác vụ AI đang tạm dừng. Các vùng quan sát đã lưu vẫn khả dụng; thao tác vẽ mới cần ảnh chụp camera hiện thời được cấp quyền.',
  'regionSetup.previewWarning.unavailable':
    'Ảnh chụp xem trước camera không khả dụng. Cần có luồng trực tiếp hoặc phát lại để vẽ vùng quan sát.',
  'regionSetup.previewWarning.externalIdMismatch':
    'Mã định danh ngoài của ảnh xem trước không khớp với camera đã chọn.',
  'regionSetup.previewWarning.connecting': 'Đang kết nối xem trước camera...',
  'regionSetup.drawer.undoPoint': 'Hoàn tác điểm',
  'regionSetup.drawer.resetDrawing': 'Đặt lại bản vẽ',
  'regionSetup.drawer.deletePoint': 'Xóa điểm',
  'regionSetup.drawer.zoomIn': 'Phóng to',
  'regionSetup.drawer.zoomOut': 'Thu nhỏ',
  'regionSetup.drawer.resetView': 'Đặt lại khung nhìn',
  'regionSetup.drawer.panMode': 'Kéo khung nhìn',
  'regionSetup.drawer.coordXLabel': 'Tọa độ X (0–1)',
  'regionSetup.drawer.coordYLabel': 'Tọa độ Y (0–1)',
  'regionSetup.drawer.addPoint': 'Thêm điểm',
  'regionSetup.drawer.vertexAria': 'Đỉnh {index} ({x}, {y})',
  'regionSetup.drawer.editingNotice': 'Đang sửa vùng quan sát {id} (v{version})',
  'regionSetup.drawer.cancelDrawing': 'Hủy vẽ',
  'regionSetup.drawer.discardPrompt': 'Hủy các thay đổi hình học vùng quan sát chưa lưu?',
  'regionSetup.drawer.keepEditing': 'Tiếp tục chỉnh sửa',
  'regionSetup.drawer.confirmDiscard': 'Hủy thay đổi',
  'regionSetup.drawer.pointsCount': 'Số điểm: {count} / 32',
  'regionSetup.drawer.stalePixelsNotice':
    'Ảnh chụp đã quá hạn hiển thị · các điểm nháp vẫn được giữ nguyên',
  'regionSetup.drawer.canvasAria': 'Khung vẽ vùng quan sát camera',
  'regionSetup.drawer.shortcutsLabel': 'Phím tắt:',
  'regionSetup.drawer.shortcutUndo': 'Hoàn tác',
  'regionSetup.drawer.shortcutCancel': 'Hủy vẽ',
  'regionSetup.drawer.saving': 'Đang lưu...',
  'regionSetup.drawer.saveRegion': 'Lưu vùng quan sát',
  'regionSetup.validation.minPoints': 'Đa giác phải có ít nhất 3 điểm.',
  'regionSetup.validation.maxPoints': 'Đa giác không được vượt quá 32 điểm.',
  'regionSetup.validation.duplicateVertices': 'Đa giác có các đỉnh trùng tọa độ.',
  'regionSetup.validation.zeroArea': 'Diện tích đa giác không được bằng 0 hoặc suy biến.',
  'regionSetup.validation.selfIntersect': 'Các cạnh đa giác không được tự cắt nhau hoặc chồng lấp.',
  'regionSetup.validation.maxPointsClick': 'Tối đa 32 điểm cho mỗi đa giác vùng quan sát.',
  'regionSetup.validation.outOfBounds': 'Tọa độ vừa chọn nằm ngoài khung hình camera.',
  'regionSetup.validation.duplicateVertexClick':
    'Đã tồn tại một đỉnh có cùng tọa độ trong đa giác này.',
  'regionSetup.validation.alreadySaved': 'Bản nháp đa giác này đã được lưu trước đó.',
  'regionSetup.error.cancelled': 'Đã hủy thao tác.',
  'regionSetup.error.cameraChangedOrInactive':
    'Siêu dữ liệu camera đã thay đổi hoặc camera ngừng hoạt động. Đã hủy thao tác.',
  'regionSetup.error.wrongScope':
    'Vùng quan sát được tạo với phạm vi camera hoặc khu vực không khớp. Vui lòng làm mới.',
  'regionSetup.error.403': 'Bạn không có quyền thực hiện thao tác này.',
  'regionSetup.error.409':
    'Xung đột phiên bản cấu hình. Cấu hình camera đã được người vận hành khác cập nhật. Vui lòng kiểm tra và lưu lại.',
  'regionSetup.error.409Edit':
    'Xung đột phiên bản cấu hình. Cấu hình camera đã được người vận hành khác cập nhật. Bản nháp chưa lưu vẫn được giữ nguyên; vui lòng xem lại cấu hình camera hiện tại và mở lại vùng quan sát này để chỉnh sửa từ phiên bản mới nhất.',
  'regionSetup.error.saveDefault':
    'Không thể lưu vùng quan sát. Vui lòng kiểm tra dữ liệu và thử lại.',
  'regionSetup.feedback.saved':
    'Đã lưu vùng quan sát "{id}" (v{version}). Hãy chọn vùng này cho tiến trình AI và áp dụng/khởi động lại trước khi sử dụng trong giám sát.',
  'regionSetup.list.heading': 'Các vùng quan sát hiện có của Camera & Khu vực này',
  'regionSetup.list.countSummary': '{linked} đã liên kết (đã tải {loaded}/{total} trên camera)',
  'regionSetup.list.loading': 'Đang tải vùng quan sát…',
  'regionSetup.list.retrying': 'Đang thử tải lại vùng quan sát…',
  'regionSetup.list.retryInitial': 'Thử tải lại vùng quan sát',
  'regionSetup.list.emptyHasMore':
    'Chưa tải được vùng quan sát nào liên kết với khu vực này. Tải thêm vùng quan sát của camera có thể có vùng phù hợp.',
  'regionSetup.list.empty':
    'Chưa có vùng quan sát nào được liên kết với khu vực này trên camera đã chọn.',
  'regionSetup.list.noCameraSelected':
    'Vui lòng chọn một camera đang hoạt động để xem các vùng quan sát.',
  'regionSetup.list.versionStatus': 'Phiên bản {version} · {status}',
  'regionSetup.list.statusActive': 'Đang hoạt động',
  'regionSetup.list.statusInactive': 'Ngừng hoạt động',
  'regionSetup.list.editGeometry': 'Sửa hình học',
  'regionSetup.list.retryingMore': 'Đang thử tải thêm vùng quan sát…',
  'regionSetup.list.retryNextPage': 'Thử tải thêm vùng quan sát',
  'regionSetup.list.loadingMore': 'Đang tải thêm vùng quan sát…',
  'regionSetup.list.loadMore': 'Tải thêm vùng quan sát',
  'regionSetup.reference.heading': 'Ảnh tham chiếu cấu hình vùng quan sát',
  'regionSetup.reference.purposeNote':
    'Lấy khung hình camera tĩnh chỉ phục vụ vẽ vùng quan sát. Không chạy suy luận AI hay giám sát tuân thủ trực tiếp.',
  'regionSetup.reference.getBtn': 'Lấy ảnh cấu hình',
  'regionSetup.reference.loadingBtn': 'Đang tải ảnh cấu hình…',
  'regionSetup.reference.reviewNewBtn': 'Xem xét ảnh tham chiếu mới',
  'regionSetup.reference.loadingCandidateBtn': 'Đang tải ảnh tham chiếu mới…',
  'regionSetup.reference.capturedAt': 'Chụp lúc: {time}',
  'regionSetup.reference.expiresAt': 'Hết hạn: {time}',
  'regionSetup.reference.revisionBadge': 'Cấu hình v{version}',
  'regionSetup.reference.expiredBadge': 'Đã hết hạn',
  'regionSetup.reference.noneLoadedHint':
    'Hãy lấy ảnh cấu hình cho camera đang hoạt động đã chọn trước khi vẽ hoặc sửa vùng quan sát.',
  'regionSetup.reference.expiredHint':
    'Ảnh tham chiếu cấu hình đã hết hạn. Hãy lấy ảnh cấu hình mới để tiếp tục.',
  'regionSetup.reference.revisionChangedHint':
    'Cấu hình camera đã thay đổi (hiện là v{version}). Hãy lấy ảnh cấu hình mới để tiếp tục.',
  'regionSetup.reference.candidateHeading': 'Xem xét ảnh tham chiếu ứng viên mới',
  'regionSetup.reference.candidateDescription':
    'Kiểm tra vị trí các điểm nháp hiện tại trên khung hình tham chiếu mới (v{version}) trước khi thay thế ảnh tham chiếu đang dùng.',
  'regionSetup.reference.candidateCanvasAria': 'Khung xem trước ảnh tham chiếu ứng viên',
  'regionSetup.reference.candidateExpiredNotice':
    'Ảnh tham chiếu ứng viên đã hết hạn. Hãy tải ảnh tham chiếu khác để xem xét.',
  'regionSetup.reference.useNewBtn': 'Sử dụng ảnh tham chiếu mới',
  'regionSetup.reference.cancelReviewBtn': 'Giữ ảnh tham chiếu hiện tại',
  'regionSetup.reference.error.401':
    'Phiên làm việc đã hết hạn hoặc chưa được xác thực. Vui lòng đăng nhập lại để tải ảnh cấu hình.',
  'regionSetup.reference.error.403': 'Bạn không có quyền yêu cầu ảnh cấu hình camera.',
  'regionSetup.reference.error.404': 'Không tìm thấy nguồn ảnh cấu hình camera cho phạm vi này.',
  'regionSetup.reference.error.409':
    'Cấu hình camera đã thay đổi trong lúc tải ảnh tham chiếu. Vui lòng yêu cầu lại ảnh mới.',
  'regionSetup.reference.error.429':
    'Quá nhiều yêu cầu tải ảnh cấu hình. Vui lòng chờ trước khi thử lại.',
  'regionSetup.reference.error.503':
    'Nguồn ảnh cấu hình camera hiện không khả dụng. Hãy kiểm tra tiến trình thu hình và thử lại.',
  'regionSetup.reference.error.timeout':
    'Yêu cầu tải ảnh cấu hình đã quá thời gian chờ. Vui lòng thử lại.',
  'regionSetup.reference.error.default': 'Không thể tải ảnh cấu hình camera. Vui lòng thử lại.',
  'regionSetup.error.referenceExpired':
    'Ảnh tham chiếu cấu hình đã hết hạn. Vui lòng xem xét và xác nhận ảnh tham chiếu mới trước khi lưu.',

  'liveOverview.title': 'Tổng quan Giám sát An toàn',
  'liveOverview.subtitle':
    'Trang tổng quan điều hướng và cấu hình — trang này không tải luồng trực tiếp đa camera đồng thời, không nạp tiến trình mô hình AI và không tổng hợp số lượng sự cố. Tình trạng kết nối camera cùng bằng chứng quan sát kỹ thuật chỉ được kiểm tra tại trang camera được chọn; dữ liệu xem trước không suy đoán danh tính công nhân hay thẩm quyền ra vào.',
  'liveOverview.pausedBanner.title': 'Giám sát AI & Phân tích Camera đang tạm dừng',
  'liveOverview.pausedBanner.description':
    'Toàn bộ suy luận mô hình AI và phân tích luồng camera hiện đang tạm dừng theo cấu hình vận hành. Các cấu hình khu vực/vùng quan sát đã lưu và bản ghi cảnh báo an toàn vẫn có thể truy cập qua các mục bên dưới.',
  'liveOverview.ppe.title': 'Giám sát Trang bị Bảo hộ',
  'liveOverview.ppe.description':
    'Xem quan sát PPE theo từng camera và ảnh chụp hiện có. Cấu hình camera, vùng quan sát và PPE tại Thiết lập camera.',
  'liveOverview.ppe.action': 'Vào Giám sát Trang bị Bảo hộ',
  'liveOverview.zones.title': 'Giám sát Khu vực Hạn chế',
  'liveOverview.zones.description':
    'Xem xét quan sát ra vào khu vực và các đánh giá đã lưu. Cấu hình vùng quan sát tại Thiết lập camera.',
  'liveOverview.zones.action': 'Vào Giám sát Khu vực Hạn chế',
  'liveOverview.incidents.title': 'Cảnh báo An toàn',
  'liveOverview.incidents.description':
    'Tra cứu danh sách cảnh báo an toàn đã lưu trữ từ Backend API, kiểm tra ảnh bằng chứng đã lưu và thực hiện quy trình cán bộ xác minh có kiểm toán.',
  'liveOverview.incidents.action': 'Vào Cảnh báo An toàn',

  'cameraSetup.discardPrompt': 'Hủy các thay đổi camera chưa lưu?',
  'cameraSetup.field.code': 'Mã camera',
  'cameraSetup.field.name': 'Tên camera',
  'cameraSetup.field.externalId': 'Mã nguồn (Source ID)',
  'cameraSetup.register.dialogDescription':
    'Đăng ký siêu dữ liệu camera cho công trường này. Tình trạng kết nối video được kiểm tra riêng khi giám sát.',
  'cameraSetup.register.authRequired':
    'Cần phiên Quản lý công trường được phân công tại công trường đã chọn để đăng ký camera.',
  'cameraSetup.register.introPrefix': 'Đăng ký siêu dữ liệu camera cho',
  'cameraSetup.register.introSuffix': 'Thao tác này không khởi chạy thu hình video hay xử lý AI.',
  'cameraSetup.register.sourceHelp':
    'Sử dụng mã định danh nguồn đã được cấp phát. Không nhập URL RTSP, mật khẩu hoặc token.',
  'cameraSetup.register.submitting': 'Đang đăng ký…',
  'cameraSetup.register.validation.code':
    'Mã camera phải có từ 1–64 ký tự và không chứa ký tự điều khiển.',
  'cameraSetup.register.validation.name':
    'Tên camera phải có từ 1–255 ký tự và không chứa ký tự điều khiển.',
  'cameraSetup.register.validation.externalId':
    'Nhập Mã nguồn (Source ID) định danh đã cấp (1–128 ký tự), không nhập URL camera hoặc thông tin xác thực.',
  'cameraSetup.register.validation.dtoCode': 'Vui lòng kiểm tra mã camera và thử lại.',
  'cameraSetup.register.validation.dtoName': 'Vui lòng kiểm tra tên camera và thử lại.',
  'cameraSetup.register.validation.dtoExternalId': 'Vui lòng kiểm tra mã nguồn và thử lại.',
  'cameraSetup.register.error.401':
    'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại để đăng ký camera.',
  'cameraSetup.register.error.403': 'Bạn không còn quyền đăng ký camera.',
  'cameraSetup.register.error.404':
    'Công trường này không khả dụng. Vui lòng làm mới danh sách công trường trước khi tiếp tục.',
  'cameraSetup.register.error.400': 'Vui lòng kiểm tra các trường thông tin camera và thử lại.',
  'cameraSetup.register.error.409':
    'Mã camera hoặc Mã nguồn đã được đăng ký. Vui lòng kiểm tra danh sách camera trước khi thử lại.',
  'cameraSetup.register.error.429': 'Quá nhiều yêu cầu. Vui lòng chờ trước khi thử lại.',
  'cameraSetup.register.error.default':
    'Không thể xác nhận kết quả đăng ký. Vui lòng kiểm tra danh sách camera trước khi gửi lại yêu cầu.',
  'cameraSetup.manage.dialogDescription':
    'Xem chi tiết camera, cập nhật tên hiển thị và quản lý trạng thái kích hoạt.',
  'cameraSetup.manage.statusActive': 'Đang hoạt động (ACTIVE)',
  'cameraSetup.manage.statusInactive': 'Ngừng hoạt động (INACTIVE)',
  'cameraSetup.manage.metadataNote':
    'Chỉ quản lý trạng thái siêu dữ liệu. Không thay đổi nguồn điện thiết bị vật lý, cấu hình nguồn phát hay luồng xử lý video AI.',
  'cameraSetup.manage.conflictNotice':
    'Siêu dữ liệu đã thay đổi trên máy chủ. Vui lòng tải lại siêu dữ liệu camera mới nhất để tiếp tục.',
  'cameraSetup.manage.refreshing': 'Đang làm mới…',
  'cameraSetup.manage.refreshCamera': 'Làm mới camera',
  'cameraSetup.manage.activationHeading': 'Trạng thái kích hoạt',
  'cameraSetup.manage.deactivationNote':
    'Ngừng kích hoạt sẽ tắt quyền giám sát camera này và tăng phiên bản cấu hình.',
  'cameraSetup.manage.activationNote':
    'Kích hoạt sẽ khôi phục điều kiện đưa vào giám sát. Tình trạng luồng video và AI được kiểm tra riêng.',
  'cameraSetup.manage.deactivateBtn': 'Ngừng kích hoạt camera',
  'cameraSetup.manage.activateBtn': 'Kích hoạt camera',
  'cameraSetup.manage.confirmDeactivatePrompt':
    'Xác nhận ngừng kích hoạt? Thao tác này sẽ tăng phiên bản cấu hình của camera và các vùng quan sát đang hoạt động. Giám sát sẽ ngừng hoạt động.',
  'cameraSetup.manage.confirmActivatePrompt':
    'Xác nhận kích hoạt? Thao tác này sẽ tăng phiên bản cấu hình của camera và các vùng quan sát đang hoạt động.',
  'cameraSetup.manage.updatingStatus': 'Đang cập nhật…',
  'cameraSetup.manage.confirmDeactivateBtn': 'Xác nhận ngừng kích hoạt',
  'cameraSetup.manage.confirmActivateBtn': 'Xác nhận kích hoạt',
  'cameraSetup.manage.savingName': 'Đang lưu tên…',
  'cameraSetup.manage.feedback.renamed': 'Đã cập nhật tên camera.',
  'cameraSetup.manage.feedback.refreshed': 'Đã làm mới siêu dữ liệu camera.',
  'cameraSetup.manage.feedback.activated':
    'Đã kích hoạt camera. Phiên bản cấu hình tăng lên v{version}.',
  'cameraSetup.manage.feedback.deactivated':
    'Đã ngừng kích hoạt camera. Phiên bản cấu hình tăng lên v{version}.',
  'cameraSetup.manage.error.401':
    'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại để quản lý camera này.',
  'cameraSetup.manage.error.403': 'Bạn không còn quyền quản lý camera này.',
  'cameraSetup.manage.error.404':
    'Camera hoặc công trường này không khả dụng. Vui lòng làm mới trước khi tiếp tục.',
  'cameraSetup.manage.error.400': 'Vui lòng kiểm tra tên camera và thử lại.',
  'cameraSetup.manage.error.409':
    'Xung đột siêu dữ liệu camera. Vui lòng làm mới siêu dữ liệu camera trước khi thử lại.',
  'cameraSetup.manage.error.429': 'Quá nhiều yêu cầu. Vui lòng chờ trước khi thử lại.',
  'cameraSetup.manage.error.default':
    'Không thể hoàn tất thao tác trên camera. Vui lòng làm mới siêu dữ liệu camera và thử lại.',

  'safety.evidence.error.429': 'Quá nhiều yêu cầu. Vui lòng chờ trước khi thử lại.',
  'safety.evidence.error.network':
    'Không thể kết nối tới dịch vụ bằng chứng. Hãy kiểm tra kết nối và thử lại.',
  'safety.evidence.error.timeout': 'Quá thời gian tải bằng chứng. Vui lòng thử lại.',
  'safety.evidence.error.cancelled': 'Đã hủy tải bằng chứng.',
  'safety.evidence.error.invalidResponse':
    'Dịch vụ bằng chứng trả về hình ảnh không hợp lệ. Vui lòng thử lại.',
  'safety.evidence.frameCaptionBase':
    'Khung hình đầy đủ không đánh dấu đối tượng cụ thể và có thể hiển thị nhiều người. Mã theo dõi không phải là danh tính công nhân.',
  'safety.evidence.frameCaptionIdentityReview':
    'Chọn một người trong mục xác minh danh tính bên dưới để kiểm tra khung giới hạn đối tượng.',
  'safety.evidence.frameCaptionSourceObservations':
    'Hãy đối chiếu đối tượng cảnh báo với các quan sát nguồn.',
  'safety.evidence.unreadableImageMessage': 'Không thể hiển thị ảnh bằng chứng. Hãy thử tải lại.',
  'safety.evidence.loadingImage': 'Đang tải ảnh…',
  'safety.evidence.retryImage': 'Thử tải lại ảnh',

  'safety.alerts.loginFailed401':
    'Đăng nhập không thành công. Hãy kiểm tra thông tin đăng nhập và thử lại.',
  'safety.alerts.accessRestricted.title': 'Truy cập bị hạn chế',
  'safety.alerts.accessRestricted.description':
    'Cần vai trò Quản trị viên toàn hệ thống hoặc Cán bộ an toàn tại công trường để xem xét cảnh báo an toàn.',
  'safety.alerts.sessionExpired.description':
    'Phiên làm việc của ứng dụng đang chờ hoặc không còn hợp lệ. Vui lòng đăng nhập vào ứng dụng để tiếp tục.',
  'safety.alerts.retrySites': 'Thử tải lại công trường',
  'safety.alerts.retryDetail': 'Thử tải lại chi tiết',
  'safety.alerts.recordingReviewDecision': 'Đang ghi nhận quyết định xem xét…',
  'safety.alerts.zoneAuthUnavailableInline':
    'Không thể xác minh quyền ra vào; danh tính chưa xác định không đồng nghĩa với xâm nhập trái phép, việc xem xét thủ công hồi cứu không cấp quyền ra vào trực tiếp.',
  'safety.alerts.zoneAuthUnavailableTitle': 'Không thể xác minh quyền ra vào',
  'safety.alerts.zoneAuthUnavailableBody':
    'Danh tính chưa xác định không đồng nghĩa với xâm nhập trái phép, việc xem xét thủ công hồi cứu không cấp quyền ra vào trực tiếp.',

  'safety.subtype.PPE_HARD_HAT_MISSING': 'Thiếu mũ bảo hộ',
  'safety.subtype.PPE_SAFETY_VEST_MISSING': 'Thiếu áo phản quang',
  'safety.subtype.PPE_GLOVES_MISSING': 'Thiếu găng tay',
  'safety.subtype.PPE_BOOTS_MISSING': 'Thiếu giày bảo hộ',
  'safety.subtype.PPE_GOGGLES_MISSING': 'Thiếu kính bảo hộ',
  'safety.subtype.ZONE_ENTRY_VIOLATION': 'Vi phạm vào khu vực',
  'safety.subtype.ZONE_ENTRY_UNAUTHORIZED': 'Vào khu vực khi chưa được cấp phép',
  'safety.subtype.ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE': 'Không thể xác minh quyền vào khu vực',
  'safety.subtype.RESTRICTED_ZONE_INTRUSION': 'Xâm nhập vùng hạn chế',

  'cameraMonitoring.switcherAria': 'Chế độ xem giám sát camera',
  'cameraMonitoring.codeMf05': 'MF05',
  'cameraMonitoring.codeMf06': 'MF06',

  'ppe.rawCanvas.ariaLabel': 'Luồng video trực tiếp gốc từ camera chưa qua phân tích',

  'ppe.previewCanvas.regionPrefix': 'Khu vực',
  'ppe.previewCanvas.experimentalObjectSummary': 'Vật thể thử nghiệm: {className} ({confidence}%).',
  'ppe.previewCanvas.currentFrameObservationsAria': 'Các quan sát trong khung hình hiện tại',
  'ppe.previewCanvas.frameDetailsAria': 'Chi tiết quan sát trong khung hình',
  'ppe.previewCanvas.frameObservationsCount': 'Khung hình ({count} quan sát)',
  'ppe.previewCanvas.regionParen': '(Khu vực: {regionId})',
  'ppe.previewCanvas.boxPx': 'Tọa độ khung (px): {box}',

  'ppe.wall.tileAriaFocused': 'Camera {camera} (đang chọn tiêu điểm)',
  'ppe.wall.tileAriaAvailable': 'Camera {camera} (khả dụng)',
  'ppe.wall.awaitingSnapshot': 'Đang chờ ảnh chụp camera mới...',
  'ppe.wall.connectingSnapshot': 'Đang kết nối (ảnh chụp {cadence})...',
  'ppe.wall.snapshotUnavailable': 'Ảnh chụp không khả dụng',
  'ppe.wall.noActiveSnapshot': 'Không có ảnh chụp camera đang hoạt động.',
  'ppe.wall.noPersonDetectionsDisclaimer':
    'Không phát hiện người · Không có phát hiện không đồng nghĩa với chứng nhận an toàn',
  'ppe.wall.cadenceLabel': 'Chu kỳ: {cadence}',
  'ppe.wall.personDetectionsCount': '{count} phát hiện người',
  'ppe.wall.noPersonDetections': 'Không phát hiện người',
  'ppe.wall.rawObjectsCount': '{count} vật thể thô',
  'ppe.wall.emptyTitle': 'Chưa có camera khả dụng cho công trường này',
  'ppe.wall.emptyDesc':
    'Vui lòng chọn công trường khác hoặc liên hệ quản trị viên để cấp quyền camera.',
  'ppe.wall.unassignedSlotTitle': 'Kênh {slot} · Chưa chỉ định',
  'ppe.wall.unassignedSlotDesc':
    'Chưa có nguồn camera được phân quyền. Hệ thống không tạo nguồn mô phỏng.',
  'ppe.wall.enlargeCameraBtn': 'Phóng to camera',
  'ppe.common.details': 'Chi tiết',
  'ppe.common.evidence': 'Bằng chứng',
  'ppe.toolbar.evidenceDetailsBtn': 'Bằng chứng & Chi tiết',
  'ppe.toolbar.backToGridBtn': 'Quay lại lưới',
  'ppe.fullscreen.enterBtn': 'Toàn màn hình',
  'ppe.fullscreen.exitBtn': 'Thoát toàn màn hình',
  'ppe.fullscreen.errorBlocked':
    'Trình duyệt từ chối chế độ toàn màn hình. Đang giữ chế độ khung nhìn phóng to.',
  'ppe.fullscreen.errorUnsupported':
    'Trình duyệt hiện tại không hỗ trợ API Toàn màn hình. Đang giữ khung nhìn phóng to.',
  'ppe.fullscreen.errorFailed':
    'Không thể bật chế độ toàn màn hình của trình duyệt. Đang giữ khung nhìn phóng to.',

  'mf05Demo.mutationError.400':
    'Yêu cầu vùng không hợp lệ hoặc tham số cấu hình sai định dạng (400).',
  'mf05Demo.mutationError.401':
    'Phiên xác thực đã hết hạn hoặc thông tin đăng nhập không hợp lệ (401).',
  'mf05Demo.mutationError.403':
    'Từ chối quyền truy cập: Cần vai trò Quản trị viên (Admin) để áp dụng vùng đã lưu (403).',
  'mf05Demo.mutationError.409':
    'Xung đột cấu hình: Vùng hoặc phiên bản cấu hình đã bị thay đổi bởi thao tác khác (409).',
  'mf05Demo.mutationError.503':
    'Dịch vụ không khả dụng: Máy chủ tiếp nhận hoặc tiến trình xử lý luồng tạm thời gián đoạn (503).',
  'mf05Demo.mutationError.httpStatus': 'Không thể áp dụng cấu hình vùng (HTTP {status}).',
  'mf05Demo.mutationError.default': 'Không thể áp dụng cấu hình vùng do lỗi kết nối hoặc máy chủ.',
  'mf05Demo.accessErrorTitle': 'Lỗi truy cập điều khiển chẩn đoán ({status})',
  'mf05Demo.accessErrorDesc':
    'Từ chối quyền truy cập: Điều khiển vùng chẩn đoán yêu cầu quyền quản trị viên phù hợp.',
  'mf05Demo.loading': 'Đang tải điều khiển vùng chẩn đoán MF05...',
  'mf05Demo.candidatesSummaryApplying':
    'Ứng viên / bằng chứng MF05 (đang áp dụng — chưa thể kết luận an toàn)',
  'mf05Demo.candidatesSummaryCount': 'Ứng viên / bằng chứng MF05 ({count})',
  'mf05Demo.applyingBadge': 'đang áp dụng — chưa thể kết luận an toàn',
  'mf05Demo.heading': 'Điều khiển vùng chẩn đoán MF05',
  'mf05Demo.badgeLocalDiagnostic': 'Chỉ chẩn đoán cục bộ',
  'mf05Demo.stateApplying': 'Đang áp dụng...',
  'mf05Demo.stateActiveApplied': 'Đang hoạt động & Đã áp dụng',
  'mf05Demo.statePendingApply': 'Chờ áp dụng',
  'mf05Demo.savedConfigLabel': 'Cấu hình đã lưu',
  'mf05Demo.savedRevValue': 'Phiên bản lưu: {version}',
  'mf05Demo.loadedConfigLabel': 'Cấu hình đã nạp',
  'mf05Demo.loadedRevValue': 'Phiên bản nạp: {version}',
  'mf05Demo.none': 'Chưa có',
  'mf05Demo.loadedGeometryLabel': 'Hình học đã nạp',
  'mf05Demo.loadedGeomValue': 'Hình học nạp: {version}',
  'mf05Demo.activeLoadedRegionLabel': 'Vùng đang nạp hoạt động',
  'mf05Demo.activeSavedRegionLabel': 'Vùng đã lưu đang hoạt động (1 vùng mỗi camera)',
  'mf05Demo.savedRegionSummary': '{id} (v{version} · {points} điểm)',
  'mf05Demo.noSavedRegions': 'Chưa có vùng quan sát đã lưu cho camera này',
  'mf05Demo.applySavedRegionBtn': 'Áp dụng vùng đã lưu',
  'mf05Demo.adminPermissionRequired':
    'Cần quyền Quản trị viên (Admin) để áp dụng thay đổi vùng quan sát.',
  'mf05Demo.failedToApplyTitle': 'Không thể áp dụng vùng quan sát',
  'mf05Demo.candidatesHeading':
    'Đầu vào ứng viên MF05 cho MF08, KHÔNG phải Cảnh báo an toàn đã lưu',
  'mf05Demo.candidatesCount': 'Số lượng: {count}',
  'mf05Demo.candidatesDisclaimer':
    'Các ứng viên đã xác nhận theo thời gian và lọc theo chính sách máy chủ. (0 ứng viên => chưa có ứng viên xác nhận, KHÔNG đồng nghĩa chứng nhận an toàn).',
  'mf05Demo.noConfirmedCandidate':
    'chưa có ứng viên xác nhận (KHÔNG đồng nghĩa chứng nhận an toàn)',
  'mf05Demo.fieldSubtype': 'Phân loại:',
  'mf05Demo.fieldTrack': 'Mã theo vết:',
  'mf05Demo.fieldGeom': 'Hình học:',
  'mf05Demo.latestEvidenceHeading': 'Ảnh bằng chứng thực tế mới nhất',
  'mf05Demo.downloadEvidenceBtn': 'Tải ảnh bằng chứng',
  'mf05Demo.noEvidenceImage': 'Chưa có ảnh bằng chứng',
  'mf05Demo.evidenceIdentityUnavailable': 'Không xác định được định danh bằng chứng',
  'mf05Demo.latestEvidenceAlt': 'Ứng viên bằng chứng MF05 mới nhất',
  'mf05Demo.evidenceBoxOverlayAria': 'lớp phủ khung giới hạn bằng chứng',
  'mf05Demo.fieldEvent': 'Sự kiện:',
  'mf05Demo.fieldDimensions': 'Kích thước:',
  'mf05Demo.targetTrack': 'Track: {id}',
  'mf05Demo.targetRegionVersion': 'Vùng: {regionId} (v{version})',

  'zonePaging.sites.loading': 'Đang tải công trường…',
  'zonePaging.cameras.loading': 'Đang tải camera…',
  'zonePaging.regions.loading': 'Đang tải vùng quan sát…',
  'zonePaging.sites.loadedCount': 'Đã tải {loaded} / {total} công trường',
  'zonePaging.cameras.loadedCount': 'Đã tải {loaded} / {total} camera',
  'zonePaging.regions.loadedCount': 'Đã tải {loaded} / {total} vùng quan sát',
  'zonePaging.sites.errorInitial': 'Không thể tải công trường. Vui lòng thử lại.',
  'zonePaging.cameras.errorInitial': 'Không thể tải camera. Vui lòng thử lại.',
  'zonePaging.regions.errorInitial': 'Không thể tải vùng quan sát. Vui lòng thử lại.',
  'zonePaging.sites.errorMore': 'Không thể tải thêm công trường. Vui lòng thử lại.',
  'zonePaging.cameras.errorMore': 'Không thể tải thêm camera. Vui lòng thử lại.',
  'zonePaging.regions.errorMore': 'Không thể tải thêm vùng quan sát. Vui lòng thử lại.',
  'zonePaging.sites.retryInitial': 'Thử tải lại công trường',
  'zonePaging.cameras.retryInitial': 'Thử tải lại camera',
  'zonePaging.regions.retryInitial': 'Thử tải lại vùng quan sát',
  'zonePaging.sites.retryMore': 'Thử tải thêm công trường',
  'zonePaging.cameras.retryMore': 'Thử tải thêm camera',
  'zonePaging.regions.retryMore': 'Thử tải thêm vùng quan sát',
  'zonePaging.sites.loadingMore': 'Đang tải thêm công trường…',
  'zonePaging.cameras.loadingMore': 'Đang tải thêm camera…',
  'zonePaging.regions.loadingMore': 'Đang tải thêm vùng quan sát…',
  'zonePaging.sites.loadMore': 'Tải thêm công trường',
  'zonePaging.cameras.loadMore': 'Tải thêm camera',
  'zonePaging.regions.loadMore': 'Tải thêm vùng quan sát',

  'restrictedZone.status.cannotSavePolygonNotLive':
    'Không thể lưu đa giác: ảnh chụp camera không phải trực tiếp hoặc không khớp.',
  'restrictedZone.status.cannotSaveDraftNotLive':
    'Không thể lưu bản nháp: ảnh chụp camera không phải trực tiếp hoặc không khớp.',
  'restrictedZone.event.authBackendRequired': 'Cần đánh giá từ Backend',
  'restrictedZone.event.resultTechnicalEntry': 'Quan sát đi vào vùng kỹ thuật',
  'restrictedZone.event.resultScanningSnapshot': 'Đang quét ảnh chụp',
  'restrictedZone.error.previewSessionExpired': 'Phiên xem trước camera đã hết hạn',
  'restrictedZone.error.sessionNoLongerValid':
    'Phiên làm việc không còn hợp lệ. Vui lòng đăng nhập lại.',
  'restrictedZone.sessionExpired.description':
    'Phiên khu vực hạn chế đang chờ hoặc đã hết hạn. Vui lòng đăng nhập vào ứng dụng để cấu hình vùng quan sát của camera.',
  'restrictedZone.accessRestricted.title': 'Cấu hình Khu vực bị hạn chế',
  'restrictedZone.accessRestricted.description':
    'Cần vai trò Quản trị viên toàn hệ thống (Admin) hoặc Cán bộ an toàn tại công trường được phân công để xem khu vực hạn chế.',
  'restrictedZone.session.safetyOfficerActive': 'Phiên Cán bộ an toàn đang hoạt động (Chỉ đọc)',
  'restrictedZone.session.safetyOfficerDesc':
    'Đã xác minh vai trò Cán bộ an toàn. Giám sát ảnh chụp camera đang hoạt động ở chế độ chỉ đọc.',
  'restrictedZone.regionSelect.labelTitle':
    'Chọn đa giác vùng quan sát chuẩn để chỉnh sửa hình học và đồng bộ với máy chủ',
  'restrictedZone.regionSelect.label': 'Vùng quan sát (Chỉnh sửa hình học)',
  'restrictedZone.regionSelect.editTargetTitle':
    'Chỉ chọn đối tượng chỉnh sửa. Phát hiện xâm nhập AI trực tiếp hiển thị các sự kiện vùng camera ghi nhận mà không lọc.',
  'restrictedZone.regionSelect.editTarget': 'Đối tượng sửa',
  'restrictedZone.regionSelect.selectTitle':
    'Đa giác vùng quan sát chuẩn để chỉnh sửa và đồng bộ máy chủ. Luồng nhận diện AI trực tiếp phản ánh các khu vực camera ghi nhận.',
  'restrictedZone.scope.zoneScopeLabel': 'Phạm vi khu vực',
  'restrictedZone.scope.readOnlyTitle':
    'Nhận diện AI trực tiếp phản ánh các khu vực camera ghi nhận; chỉnh sửa hình học dành cho Quản lý công trường được phân công',
  'restrictedZone.scope.readOnlyValue': 'Khu vực hạn chế (Chỉ đọc)',
  'restrictedZone.scope.safetyOfficerBadge': 'Cán bộ an toàn (Chỉ đọc)',
  'restrictedZone.viewport.connectingTitle': 'Đang kết nối ảnh chụp camera...',
  'restrictedZone.viewport.noCameraSelected': 'Chưa chọn camera hoặc không có camera để xem trước',
  'restrictedZone.badge.liveSnapshot1s': 'ẢNH CHỤP TRỰC TIẾP MF06 (1s)',
  'restrictedZone.badge.replaySnapshot1s': 'ẢNH CHỤP PHÁT LẠI MF06 (1s)',
  'restrictedZone.badge.snapshotUnavailable': 'ẢNH CHỤP MF06 KHÔNG KHẢ DỤNG',
  'restrictedZone.badge.cameraOffline': 'CAMERA MF06 NGOẠI TUYẾN',
  'restrictedZone.badge.zoneEntry': 'ĐI VÀO VÙNG',
  'restrictedZone.badge.scanning': 'ĐANG QUÉT',
  'restrictedZone.controls.safetyOfficerReadOnlyBadge': 'CÁN BỘ AN TOÀN (CHỈ ĐỌC)',
  'restrictedZone.controls.editDisabledNotLive':
    'Cần có ảnh chụp camera trực tiếp trước khi chỉnh sửa hình học vùng hạn chế',
  'restrictedZone.controls.editDisabledMismatch':
    'Chọn camera Backend tương ứng trước khi chỉnh sửa khung xem trước này',
  'restrictedZone.controls.resetBtn': 'ĐẶT LẠI',
  'restrictedZone.viewport.emptyFrameReplay':
    'Ảnh chụp phát lại đang hoạt động · Không có quan sát người từ AI trong ảnh chụp này; không kết luận về an toàn hay thẩm quyền',
  'restrictedZone.viewport.emptyFrameLive':
    'Ảnh chụp trực tiếp đang hoạt động · Không có quan sát người từ AI trong ảnh chụp này; không kết luận về an toàn hay thẩm quyền',
  'restrictedZone.headerOverlay.liveSnapshotTime': 'ẢNH CHỤP TRỰC TIẾP (1s) - {time}',
  'restrictedZone.headerOverlay.replaySnapshotTime': 'ẢNH CHỤP PHÁT LẠI (1s) - {time}',
  'restrictedZone.headerOverlay.snapshotUnavailable': 'ẢNH CHỤP KHÔNG KHẢ DỤNG',
  'restrictedZone.headerOverlay.offline': 'NGOẠI TUYẾN',
  'restrictedZone.errorBanner.cameraSnapshotPrefix': 'Ảnh chụp camera: {error}',
  'restrictedZone.toolbar.liveSnapshot1s': 'Ảnh chụp camera trực tiếp (1s)',
  'restrictedZone.toolbar.replaySnapshot1s': 'Ảnh chụp camera phát lại (1s)',
  'restrictedZone.toolbar.cameraOffline': 'Camera ngoại tuyến',
  'restrictedZone.observations.replayHeading': 'Đang hiển thị quan sát vùng phát lại',
  'restrictedZone.observations.replayDesc':
    'Các nhận diện kỹ thuật đi vào vùng được hiển thị từ luồng phát lại video ghi sẵn phía trên. Các dòng mẫu được ẩn trong khi phát luồng. Cảnh báo an toàn lưu trữ bền vững do Backend xử lý; vui lòng xem và xác minh bản ghi lưu trữ tại mục Cảnh báo an toàn.',
  'restrictedZone.table.subtitle':
    'Các quan sát từ nguồn ảnh chụp camera. Cảnh báo an toàn trực tiếp được quản lý tại mục Cảnh báo an toàn.',
  'restrictedZone.reviewModal.previewBadge': 'Xem trước quan sát kỹ thuật',
};

const PPE_SENTINEL_KEY: PpeTranslationKey = 'ppe.header.title';

export function registerPpeCatalog(): void {
  if (hasRegisteredFeatureKey(PPE_SENTINEL_KEY)) {
    return;
  }
  registerFeatureCatalog({
    en: PPE_EN_CATALOG,
    vi: PPE_VI_CATALOG,
  });
}

registerPpeCatalog();
