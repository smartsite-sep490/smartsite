/** Exact retained-main metadata masks shared by capture preflight and candidate DDL. */
export const MAIN_AUTHORITY_SOURCES = [
  ['USER_ACCOUNT', 'app_user', ['id', 'is_active', 'must_change_password', 'created_at']],
  ['USER_ROLE', 'user_role_assignment', ['id', 'user_id', 'role', 'site_id', 'created_at']],
  ['SITE', 'site', ['id', 'access_policy_version']],
  ['WORKER', 'worker', ['id', 'site_id', 'contractor_id', 'user_id', 'is_active']],
  ['CONTRACTOR', 'contractor', ['id', 'is_active']],
  [
    'REPRESENTATIVE_GRANT',
    'contractor_representative_grant',
    ['id', 'user_id', 'contractor_id', 'created_at'],
  ],
  [
    'REPRESENTATIVE_ASSIGNMENT',
    'contractor_representative_assignment',
    ['id', 'site_id', 'contractor_id', 'user_id', 'created_at'],
  ],
  [
    'PARTICIPATION',
    'contractor_site_participation',
    ['id', 'contractor_id', 'site_id', 'is_active', 'valid_from', 'valid_until'],
  ],
  [
    'ASSIGNMENT',
    'worker_site_zone_assignment',
    [
      'id',
      'worker_id',
      'site_id',
      'site_contractor_id',
      'status',
      'version',
      'valid_from',
      'valid_until',
    ],
  ],
  [
    'CONTRACTOR_PERMISSION',
    'contractor_zone_permission',
    ['id', 'site_contractor_id', 'zone_id', 'valid_from', 'valid_until', 'revoked_at'],
  ],
  [
    'WORKER_PERMISSION',
    'worker_zone_permission',
    [
      'id',
      'worker_assignment_id',
      'contractor_zone_permission_id',
      'valid_from',
      'valid_until',
      'revoked_at',
    ],
  ],
  [
    'ZONE_GRANT',
    'zone_access_grant',
    ['id', 'site_id', 'zone_id', 'worker_id', 'effect', 'valid_from', 'valid_until', 'revoked_at'],
  ],
  [
    'ZONE_POLICY',
    'zone',
    ['id', 'site_id', 'restriction_policy', 'required_ppe', 'configuration_locked'],
  ],
  ['CAMERA', 'camera', ['id', 'site_id', 'external_id', 'status', 'configuration_version']],
  [
    'REGION',
    'camera_observation_region',
    ['id', 'camera_id', 'zone_id', 'polygon', 'coordinate_space', 'version', 'is_active'],
  ],
] as const;
