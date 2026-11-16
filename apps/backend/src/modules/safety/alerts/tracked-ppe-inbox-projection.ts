import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { TrackedPpeEpisodeProjection } from './tracked-ppe-episode-projection.js';

type FrameInput = Parameters<TrackedPpeEpisodeProjection['projectFrame']>[1];
type EpisodeProjection = Awaited<ReturnType<TrackedPpeEpisodeProjection['projectFrame']>>[number];
export interface TrackedPpeInboxProjectionResult extends EpisodeProjection {
  recipientOutcome: 'PROJECTED' | 'NO_ELIGIBLE_RECIPIENT' | 'UNCHANGED';
  insertedRecipients: number;
}

function unavailable(): never {
  throw new Error('TRACKED_PPE_INBOX_UNAVAILABLE');
}

/** Unregistered transaction composition, not a notifier or external delivery acknowledgement.
 * Keep legacy eligible recipients; current-scope inbox reads remain authoritative.
 */
export class TrackedPpeInboxProjection {
  private readonly maxRecipients: number;
  private readonly episodes: TrackedPpeEpisodeProjection;
  constructor(db: DataSource, policy: { maxRecipients: number }) {
    if (
      !policy ||
      !Number.isSafeInteger(policy.maxRecipients) ||
      policy.maxRecipients < 1 ||
      policy.maxRecipients > 4096
    )
      unavailable();
    this.maxRecipients = policy.maxRecipients;
    this.episodes = new TrackedPpeEpisodeProjection(db);
  }

  async projectFrame(
    manager: EntityManager,
    input: FrameInput,
  ): Promise<TrackedPpeInboxProjectionResult[]> {
    // Episode projection validates transaction ownership, original sealed scope and material revision.
    const scope = { ...input };
    const episodes = await this.episodes.projectFrame(manager, scope);
    if (!episodes.some((e) => e.materialChange))
      return episodes.map((e) => ({ ...e, recipientOutcome: 'UNCHANGED', insertedRecipients: 0 }));

    // Stable order and shared locks keep each selected role/account eligible until commit.
    // Never truncate a fanout: max+1 rejects this transaction before any recipient insert.
    const rows = await manager.query<Array<{ id: string }>>(
      `SELECT u.id FROM app_user u JOIN user_role_assignment r ON r.user_id=u.id
       WHERE u.is_active AND NOT u.must_change_password AND r.site_id=$1 AND r.role='SAFETY_OFFICER'
       ORDER BY u.id,r.id LIMIT $2 FOR SHARE OF u,r`,
      [scope.siteId, this.maxRecipients + 1],
    );
    if (rows.length > this.maxRecipients) unavailable();
    const recipients = [...new Set(rows.map((r) => r.id))];
    const results: TrackedPpeInboxProjectionResult[] = [];
    for (const episode of episodes) {
      if (!episode.materialChange) {
        results.push({ ...episode, recipientOutcome: 'UNCHANGED', insertedRecipients: 0 });
        continue;
      }
      let insertedRecipients = 0;
      for (const recipient of recipients) {
        const inserted = await manager.query<Array<{ id: string }>>(
          `INSERT INTO safety_episode_recipient(id,episode_id,site_id,recipient_user_id)
           VALUES($1,$2,$3,$4) ON CONFLICT (recipient_user_id,episode_id) DO NOTHING RETURNING id`,
          [randomUUID(), episode.episodeId, scope.siteId, recipient],
        );
        insertedRecipients += inserted.length;
        if (!inserted.length) {
          const updated = await manager.query<Array<{ id: string }>>(
            `WITH updated AS (UPDATE safety_episode_recipient SET updated_at=clock_timestamp()
             WHERE episode_id=$1 AND site_id=$2 AND recipient_user_id=$3 RETURNING id)
             SELECT id FROM updated`,
            [episode.episodeId, scope.siteId, recipient],
          );
          if (updated.length !== 1) unavailable();
        }
      }
      results.push({
        ...episode,
        recipientOutcome: recipients.length ? 'PROJECTED' : 'NO_ELIGIBLE_RECIPIENT',
        insertedRecipients,
      });
    }
    return results;
  }
}
