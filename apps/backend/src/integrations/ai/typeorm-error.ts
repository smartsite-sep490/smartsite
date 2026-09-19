import { QueryFailedError } from 'typeorm';

interface PostgresDriverError {
  code?: string;
  constraint?: string;
}

/** Only the observation event primary-key violation represents an event retry. */
export function isEventIdConflict(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }

  const driver = error.driverError as PostgresDriverError | undefined;
  return driver?.code === '23505' && driver.constraint === 'pk_ai_observation_event_event_id';
}
