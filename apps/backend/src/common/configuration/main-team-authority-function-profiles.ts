import { MAIN_AUTHORITY_FUNCTION_PROFILES } from './main-authority-function-profiles.js';

/** Exact V2 bodies plus unchanged V1 helper functions. */
export const MAIN_AUTHORITY_V2_FUNCTION_PROFILES = MAIN_AUTHORITY_FUNCTION_PROFILES.map(
  (profile) =>
    profile.name === 'mf06_authority_baseline_capture'
      ? {
          ...profile,
          body_sha256: [
            '84a33b02335cdfc0a017f61c256659fbf59925ebbb88f0703d2e6f6e09e1d745',
            'e8fc1add110ddb246bee496f4439afe5fe3568bc0f0f2a81235e6cf6aebb0777',
          ],
        }
      : profile.name === 'mf06_capture_main_authority'
        ? {
            ...profile,
            body_sha256: [
              'ba5755f77648c96662a1926522af75b52218248b5920ddda36d1351d73512064',
              '70224523070309e90ab796d43d7fa432812a54d70863c75ed7586db8c390b913',
            ],
          }
        : profile,
);
