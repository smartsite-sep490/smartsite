import { DataSource, QueryFailedError, type EntityManager } from 'typeorm';
import { PublicHttpException } from '../../common/http/public-http-exception.js';

/** Retry the complete transaction after PostgreSQL has rolled it back, never one statement. */
export async function withZoneAuthorityTransaction<T>(
  source: Pick<DataSource, 'transaction'>,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await source.transaction('SERIALIZABLE', work);
    } catch (error) {
      const code =
        error instanceof QueryFailedError
          ? (error.driverError as { code?: string }).code
          : undefined;
      if (code !== '40001' && code !== '40P01') throw error;
      if (attempt === 3)
        throw new PublicHttpException(503, {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Authority command could not be committed; retry later',
        });
    }
  }
  throw new Error('Unreachable authority retry state');
}
