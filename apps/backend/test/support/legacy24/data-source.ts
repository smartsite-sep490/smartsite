import { DataSource, type EntityMetadata } from 'typeorm';
import { ENTITIES as MAIN_ENTITIES } from '../../../src/database/entities/index.js';
import { ENTITIES as LEGACY_ENTITIES } from './entities/index.js';

type Target = Parameters<DataSource['hasMetadata']>[0];
const knownTargets = new Map<Target, Target>();
const historicalNames: Readonly<Record<string, string>> = {
  ZoneEntryAssessmentRequestEntity: 'Mf06AssessmentRequestEntity',
  ZoneEntryAssessmentJobEntity: 'Mf06AssessmentJobEntity',
  ZoneEntryAssessmentEntity: 'Mf06AssessmentEntity',
  ZoneEntryAuthorityArtifactEntity: 'Mf06AuthorityArtifactEntity',
};
for (const current of MAIN_ENTITIES) {
  const historical = LEGACY_ENTITIES.find(
    (entity) => entity.name === (historicalNames[current.name] ?? current.name),
  );
  if (historical) knownTargets.set(current, historical);
}

/** Test-only identity adapter for existing legacy callers. The registered metadata
 * is the pinned historical catalog, not widened current Main entity decorators.
 * Only exact known Main constructor tokens are mapped; unknown targets fail normally.
 */
export class Legacy24TestDataSource extends DataSource {
  protected override findMetadata(target: Target): EntityMetadata | undefined {
    return super.findMetadata(knownTargets.get(target) ?? target);
  }
}
export { LEGACY_ENTITIES };
