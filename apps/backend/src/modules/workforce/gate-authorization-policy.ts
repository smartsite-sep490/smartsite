import type {
  FaceProfileStatus,
  GateAuthorizationOutcome,
  WorkerSiteZoneAssignmentStatus,
} from '@smartsite/contracts';

export interface GateAuthorizationSubject {
  workerActive: boolean;
  contractorActive: boolean;
  contractorParticipatesAtSite: boolean;
  faceProfileStatus: FaceProfileStatus;
  assignment?: {
    status: WorkerSiteZoneAssignmentStatus;
    siteId: string;
    gateId?: string | null;
    validFrom: Date;
    validUntil: Date | null;
  };
  authorizationDataAvailable: boolean;
  siteId: string;
  gateId?: string;
  evaluatedAt: Date;
}

export interface GateAuthorizationDecision {
  authorization: GateAuthorizationOutcome;
  reasonCode:
    | 'WORKER_INACTIVE'
    | 'CONTRACTOR_INACTIVE'
    | 'CONTRACTOR_SITE_PARTICIPATION_INVALID'
    | 'FACE_PROFILE_REVOKED'
    | 'FACE_PROFILE_REENROLL_REQUIRED'
    | 'AUTHORIZATION_DATA_UNAVAILABLE'
    | 'ASSIGNMENT_MISSING'
    | 'ASSIGNMENT_NOT_APPROVED'
    | 'SITE_MISMATCH'
    | 'GATE_MISMATCH'
    | 'ASSIGNMENT_EXPIRED'
    | 'VALID_ASSIGNMENT'
    | 'EXIT_RECORD_ONLY';
}

/** Backend authorization after a face adapter has supplied only technical evidence. */
export function authorizeGateEntry(subject: GateAuthorizationSubject): GateAuthorizationDecision {
  if (!subject.authorizationDataAvailable)
    return { authorization: 'MANUAL_REVIEW', reasonCode: 'AUTHORIZATION_DATA_UNAVAILABLE' };
  if (!subject.workerActive) return { authorization: 'DENIED', reasonCode: 'WORKER_INACTIVE' };
  if (!subject.contractorActive)
    return { authorization: 'DENIED', reasonCode: 'CONTRACTOR_INACTIVE' };
  if (!subject.contractorParticipatesAtSite)
    return { authorization: 'DENIED', reasonCode: 'CONTRACTOR_SITE_PARTICIPATION_INVALID' };
  if (subject.faceProfileStatus === 'REVOKED')
    return { authorization: 'DENIED', reasonCode: 'FACE_PROFILE_REVOKED' };
  if (subject.faceProfileStatus === 'NEEDS_REENROLL')
    return { authorization: 'DENIED', reasonCode: 'FACE_PROFILE_REENROLL_REQUIRED' };
  if (!subject.assignment) return { authorization: 'DENIED', reasonCode: 'ASSIGNMENT_MISSING' };
  if (subject.assignment.status !== 'APPROVED')
    return { authorization: 'DENIED', reasonCode: 'ASSIGNMENT_NOT_APPROVED' };
  if (subject.assignment.siteId !== subject.siteId)
    return { authorization: 'DENIED', reasonCode: 'SITE_MISMATCH' };
  if (subject.assignment.gateId && subject.assignment.gateId !== subject.gateId)
    return { authorization: 'DENIED', reasonCode: 'GATE_MISMATCH' };
  if (
    subject.assignment.validFrom.getTime() > subject.evaluatedAt.getTime() ||
    (subject.assignment.validUntil !== null &&
      subject.assignment.validUntil.getTime() <= subject.evaluatedAt.getTime())
  )
    return { authorization: 'DENIED', reasonCode: 'ASSIGNMENT_EXPIRED' };
  return { authorization: 'ALLOWED', reasonCode: 'VALID_ASSIGNMENT' };
}
