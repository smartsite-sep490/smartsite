/** Explicit reviewed opt-ins; no profile enables runtime workflows or runs migrations. */
export const TRACKED_MIGRATION_PROFILES = [
  'tracked-v16',
  'tracked-v16-identification',
  'tracked-v16-identification-ppe',
] as const;

export function includesIdentificationProfile(profile: string | undefined): boolean {
  return profile === 'tracked-v16-identification' || profile === 'tracked-v16-identification-ppe';
}
