/** Exact position in the immutable event observations array, never a Worker identity. */
export interface EventLocalEpisodeSubject {
  kind: 'EVENT_LOCAL';
  eventId: string;
  personObservationIndex: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve only after canonical event validation and Backend camera/Site authorization.
 * Current event schemas provide no trusted track generation, so they cannot establish
 * continuity between events. Duplicate PERSON tracks make PPE association ambiguous.
 */
export function resolveEventLocalEpisodeSubject(
  eventId: string,
  observations: readonly { type: string; trackId: number }[],
  personObservationIndex: number,
): EventLocalEpisodeSubject | null {
  if (
    !UUID.test(eventId) ||
    !Number.isSafeInteger(personObservationIndex) ||
    personObservationIndex < 0
  )
    return null;
  const person = observations[personObservationIndex];
  if (
    !person ||
    person.type !== 'PERSON' ||
    !Number.isSafeInteger(person.trackId) ||
    person.trackId < 0
  )
    return null;
  let matchingPeople = 0;
  for (const observation of observations) {
    if (observation.type === 'PERSON' && observation.trackId === person.trackId) matchingPeople++;
  }
  if (matchingPeople !== 1) return null;
  return { kind: 'EVENT_LOCAL', eventId: eventId.toLowerCase(), personObservationIndex };
}
