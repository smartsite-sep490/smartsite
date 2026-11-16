import { ZONE_ENTRY_STORAGE_NAMES } from './zone-entry-storage-profile-v1.js';

/** Both generations deny legacy writes, including a partially upgraded journal. */
export const PRE_NAMING_AUTHORITY_RELATIONS = Object.keys(ZONE_ENTRY_STORAGE_NAMES).filter(
  (name) => !name.startsWith('mf06_assessment') && name !== 'mf06_authority_artifact',
);

export const AUTHORITY_RELATIONS_WITH_HISTORY = PRE_NAMING_AUTHORITY_RELATIONS.flatMap((name) => [
  name,
  ZONE_ENTRY_STORAGE_NAMES[name as keyof typeof ZONE_ENTRY_STORAGE_NAMES],
]);
