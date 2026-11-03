import { resolveEventLocalEpisodeSubject } from '@smartsite/contracts';

/** Only for validated events and Backend-evaluated candidates; never a Worker identity. */
export function resolveAlertObservationSubjects(
  eventId: string,
  observations: readonly { type: string; trackId: number }[],
  candidates: readonly { alertId: string; trackId: number }[],
): Map<string, number | null> {
  const subjectsByTrack = new Map<number, number | null>();
  const subjectsByAlert = new Map<string, number | null>();
  for (const { alertId, trackId } of candidates) {
    if (!subjectsByTrack.has(trackId)) {
      const index = observations.findIndex(
        (item) => item.type === 'PERSON' && item.trackId === trackId,
      );
      const subject = resolveEventLocalEpisodeSubject(eventId, observations, index);
      subjectsByTrack.set(trackId, subject && index <= 255 ? subject.personObservationIndex : null);
    }
    const index = subjectsByTrack.get(trackId)!;
    // A collapsed alert must not pick a person by candidate order.
    subjectsByAlert.set(
      alertId,
      subjectsByAlert.has(alertId) && subjectsByAlert.get(alertId) !== index ? null : index,
    );
  }
  return subjectsByAlert;
}
