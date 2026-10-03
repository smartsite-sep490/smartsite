import type {
  ObservationPersonBoundingBox,
  ObservationSubjectSelection,
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
