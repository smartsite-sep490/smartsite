/** Explicit reviewed opt-ins; no profile enables runtime workflows or runs migrations. */
export const TRACKED_MIGRATION_PROFILES = [
  'tracked-v16',
  'tracked-v16-identification',
  'tracked-v16-identification-ppe',
  'tracked-v17-identification-ppe',
] as const;

export function includesIdentificationProfile(profile: string | undefined): boolean {
  return profile === 'tracked-v16-identification' || includesCameraPpeProfile(profile);
}

export function includesCameraPpeProfile(profile: string | undefined): boolean {
  return (
    profile === 'tracked-v16-identification-ppe' || profile === 'tracked-v17-identification-ppe'
  );
}
