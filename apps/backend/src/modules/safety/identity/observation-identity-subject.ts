import type {
  ObservationPersonBoundingBox,
  ObservationSubjectSelection,
  ZoneEntrySubjectSelection,
} from './observation-identity.types.js';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function personBox(value: unknown): ObservationPersonBoundingBox | undefined {
  const box = record(value);
  if (!box || box.coordinateSpace !== 'NORMALIZED_0_1') return undefined;
  const keys = ['x1', 'y1', 'x2', 'y2', 'coordinateSpace'];
  if (Object.keys(box).some((key) => !keys.includes(key))) return undefined;
  const { x1, y1, x2, y2 } = box;
  if (
    typeof x1 !== 'number' ||
    !Number.isFinite(x1) ||
    x1 < 0 ||
    x1 > 1 ||
    typeof y1 !== 'number' ||
    !Number.isFinite(y1) ||
    y1 < 0 ||
    y1 > 1 ||
    typeof x2 !== 'number' ||
    !Number.isFinite(x2) ||
    x2 < 0 ||
    x2 > 1 ||
    typeof y2 !== 'number' ||
    !Number.isFinite(y2) ||
    y2 < 0 ||
    y2 > 1 ||
    x1 >= x2 ||
    y1 >= y2
  )
    return undefined;
  return { x1, y1, x2, y2, coordinateSpace: 'NORMALIZED_0_1' };
}

/** Selects only an original PERSON observation; eligibility does not prove Worker identity. */
export function selectObservationSubject(
  rawPayload: unknown,
  personObservationIndex: number,
): ObservationSubjectSelection {
  const blocked = (
    unavailableReason: Extract<
      ObservationSubjectSelection,
      { eligible: false }
    >['unavailableReason'],
    trackId?: number,
  ): ObservationSubjectSelection => ({
    eligible: false,
    personObservationIndex,
    ...(trackId === undefined ? {} : { trackId }),
    unavailableReason,
  });
  if (
    !Number.isInteger(personObservationIndex) ||
    personObservationIndex < 0 ||
    personObservationIndex > 255
  )
    return blocked('INVALID_SUBJECT_INDEX');
  const observations = record(rawPayload)?.observations;
  if (!Array.isArray(observations) || observations.length > 256)
    return blocked('OBSERVATIONS_UNAVAILABLE');
  if (personObservationIndex >= observations.length) return blocked('SUBJECT_NOT_FOUND');
  const subject = record(observations[personObservationIndex]);
  if (subject?.type !== 'PERSON') return blocked('NOT_PERSON');
  const trackId = subject.trackId;
  if (typeof trackId !== 'number' || !Number.isSafeInteger(trackId) || trackId < 0)
    return blocked('INVALID_TRACK_ID');
  const matches = observations.filter((value: unknown) => {
    const candidate = record(value);
    return candidate?.type === 'PERSON' && candidate.trackId === trackId;
  });
  if (matches.length !== 1) return blocked('AMBIGUOUS_PERSON_TRACK', trackId);
  const boundingBox = personBox(subject.boundingBox);
  if (!boundingBox) return blocked('PERSON_BOX_UNAVAILABLE', trackId);
  return { eligible: true, personObservationIndex, trackId, personBoundingBox: boundingBox };
}

/**
 * Derives one exact Zone/PERSON binding from original observation indices.
 * Caller still owns canonical event validation, hash/provenance, ingestion scope
 * and geometry eligibility. This does not resolve a Worker, read permissions,
 * choose between duplicate PERSONs or deduplicate repeated Zone entries.
 */
export function selectZoneEntrySubject(
  rawPayload: unknown,
  zoneObservationIndex: number,
): ZoneEntrySubjectSelection {
  const blocked = (
    unavailableReason: Extract<
      ZoneEntrySubjectSelection,
      { zoneEligible: false }
    >['unavailableReason'],
  ): ZoneEntrySubjectSelection => ({
    zoneEligible: false,
    zoneObservationIndex,
    unavailableReason,
  });
  if (
    !Number.isInteger(zoneObservationIndex) ||
    zoneObservationIndex < 0 ||
    zoneObservationIndex > 255
  )
    return blocked('INVALID_ZONE_INDEX');
  const observations = record(rawPayload)?.observations;
  if (!Array.isArray(observations) || observations.length > 256)
    return blocked('OBSERVATIONS_UNAVAILABLE');
  if (zoneObservationIndex >= observations.length) return blocked('ZONE_ENTRY_NOT_FOUND');
  const zone = record(observations[zoneObservationIndex]);
  if (zone?.type !== 'ZONE_ENTRY') return blocked('NOT_ZONE_ENTRY');
  const { trackId, regionId, geometryVersion } = zone;
  if (
    typeof trackId !== 'number' ||
    !Number.isSafeInteger(trackId) ||
    trackId < 0 ||
    typeof regionId !== 'string' ||
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      regionId,
    ) ||
    typeof geometryVersion !== 'number' ||
    !Number.isSafeInteger(geometryVersion) ||
    geometryVersion < 1
  )
    return blocked('ZONE_ENTRY_INVALID');
  const anchor = {
    zoneEligible: true as const,
    zoneObservationIndex,
    trackId,
    regionId,
    geometryVersion,
  };
  const matchingIndices: number[] = [];
  for (const [index, value] of observations.entries()) {
    const candidate = record(value);
    if (candidate?.type === 'PERSON' && candidate.trackId === trackId) matchingIndices.push(index);
  }
  if (matchingIndices.length === 0)
    return { ...anchor, subjectBindingStatus: 'PERSON_NOT_FOUND', personObservationIndex: null };
  if (matchingIndices.length > 1)
    return {
      ...anchor,
      subjectBindingStatus: 'AMBIGUOUS_PERSON_TRACK',
      personObservationIndex: null,
    };
  const personObservationIndex = matchingIndices[0]!;
  const selected = selectObservationSubject(rawPayload, personObservationIndex);
  if (!selected.eligible) {
    if (selected.unavailableReason !== 'PERSON_BOX_UNAVAILABLE')
      return blocked('ZONE_ENTRY_INVALID');
    return { ...anchor, subjectBindingStatus: 'PERSON_BOX_UNAVAILABLE', personObservationIndex };
  }
  return {
    ...anchor,
    subjectBindingStatus: 'BOUND',
    personObservationIndex,
    personBoundingBox: selected.personBoundingBox,
  };
}
