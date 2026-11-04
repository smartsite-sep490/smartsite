/** Current site-entry assignment receipt; old V1/V2 hashes remain frozen.
 * No gate authorization is inferred; this removes the retired response field only.
 */
export const SITE_ENTRY_ASSIGNMENT_AUTHORITY_PROFILE = 'SITE_ENTRY_ASSIGNMENT_RECEIPT_V1';
export const SITE_ENTRY_ASSIGNMENT_RESPONSE_BODY = `
        SELECT jsonb_build_object('id',id,'workerId',worker_id,'siteId',site_id,'siteContractorId',site_contractor_id,
          'zoneIds',zone_ids,'status',status,'version',version,'validFrom',valid_from,'validUntil',valid_until,
          'requestedByUserId',requested_by_user_id,'safetyReviewedByUserId',safety_reviewed_by_user_id,
          'siteManagerDecidedByUserId',site_manager_decided_by_user_id,'reviewedAt',reviewed_at,'reviewNote',review_note,'createdAt',created_at)
          FROM worker_site_zone_assignment WHERE id=source
      `;
export const SITE_ENTRY_ASSIGNMENT_RESPONSE_SHA256 = [
  'affd09e2b8b07bb773a1635b43da3d59127dee5e3d80e2c3b51a8eb9f4631642',
  '9b4206779f0cb07c2aed79f68c2cc67efca2248f632b03a7faccbf1aa902b841',
] as const;
