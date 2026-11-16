import type { EntityManager } from 'typeorm';
import type {
  StorageService,
  StoredObject,
} from '../../../integrations/storage/storage.service.js';

type InventoryObject = Pick<StoredObject, 'storageKey' | 'storageProvider'>;
const candidateKey =
  /^(?:c02-evidence-(?:[0-9]{13}-)?)?[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.jpg$/;

export async function inspectC02EvidenceInventory(
  manager: EntityManager,
  provider: InventoryObject['storageProvider'],
  storageKeys: readonly string[],
  now = Date.now(),
) {
  if (!['LOCAL', 'R2'].includes(provider) || storageKeys.length > 200 || !Number.isFinite(now))
    throw new Error('Invalid C02 inventory batch');
  const keys = [...new Set(storageKeys.filter((key) => candidateKey.test(key)))];
  if (!keys.length) return [];
  const receipts = await manager.query<{ key: string; expires: string | null }[]>(
    `SELECT item->'object'->>'storageKey' AS key, item->>'expiresAt' AS expires
     FROM safety_identification_action a
     JOIN safety_identification_request r ON (r.id,r.site_id,r.requested_by)=
       (a.request_id,a.site_id,a.actor_user_id)
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(a.payload->'publishedEvidence')='array'
       THEN a.payload->'publishedEvidence' ELSE '[]'::jsonb END
     ) item
     WHERE a.kind='CREATE' AND a.request_version=1
       AND item->'object'->>'storageProvider'=$1
       AND item->'object'->>'storageKey'=ANY($2::text[])`,
    [provider, keys],
  );
  const state = new Map<string, 'REFERENCED_ACTIVE' | 'REFERENCED_EXPIRED'>();
  for (const { key, expires } of receipts) {
    const time = expires === null ? NaN : Date.parse(expires);
    // Invalid or conflicting receipts must never make an object eligible for expiry cleanup.
    if (!Number.isFinite(time) || time > now) state.set(key, 'REFERENCED_ACTIVE');
    else if (!state.has(key)) state.set(key, 'REFERENCED_EXPIRED');
  }
  return keys.flatMap((storageKey) => {
    const status =
      state.get(storageKey) ?? (storageKey.startsWith('c02-evidence-') ? 'UNREFERENCED_C02' : null);
    return status ? [{ storageKey, status }] : [];
  });
}

export async function* scanC02EvidenceInventory(
  manager: EntityManager,
  storage: StorageService,
  provider: InventoryObject['storageProvider'],
  signal?: AbortSignal,
) {
  const now = Date.now();
  for await (const keys of storage.listEvidenceJpegKeyBatches(provider, signal)) {
    signal?.throwIfAborted();
    const matches = await inspectC02EvidenceInventory(manager, provider, keys, now);
    signal?.throwIfAborted();
    if (matches.length) yield matches;
  }
}

/** Deletes only keys proven expired by immutable receipts. Generated publication keys are never reused. */
export async function* removeExpiredC02Evidence(
  manager: EntityManager,
  storage: StorageService,
  provider: InventoryObject['storageProvider'],
  signal?: AbortSignal,
) {
  for await (const batch of scanC02EvidenceInventory(manager, storage, provider, signal)) {
    for (const item of batch) {
      if (item.status !== 'REFERENCED_EXPIRED') continue;
      signal?.throwIfAborted();
      const [current] = await inspectC02EvidenceInventory(manager, provider, [item.storageKey]);
      if (current?.status !== 'REFERENCED_EXPIRED') continue;
      signal?.throwIfAborted();
      await storage.removeChecked({ storageProvider: provider, storageKey: item.storageKey });
      yield item.storageKey;
    }
  }
}

/** Both publisher and orphan sweep must check staging age while holding this transaction lock. */
export async function lockC02EvidenceStaging(
  manager: EntityManager,
  { storageProvider, storageKey }: InventoryObject,
) {
  const timestamp = /^c02-evidence-([0-9]{13})-/.exec(storageKey)?.[1];
  if (!timestamp || !candidateKey.test(storageKey)) return null;
  await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    'c02-evidence:' + storageProvider + ':' + storageKey,
  ]);
  const [row] = await manager.query<{ stale: boolean }[]>(
    'SELECT floor(extract(epoch FROM clock_timestamp()) * 1000) >= $1::bigint + 86400000 AS stale',
    [timestamp],
  );
  if (!row) throw new Error('C02 staging clock unavailable');
  return row.stale;
}

export async function* removeOrphanedC02Evidence(
  manager: EntityManager,
  storage: StorageService,
  provider: InventoryObject['storageProvider'],
) {
  for await (const batch of scanC02EvidenceInventory(manager, storage, provider)) {
    for (const item of batch) {
      if (item.status !== 'UNREFERENCED_C02') continue;
      const ref = { storageProvider: provider, storageKey: item.storageKey };
      const removed = await manager.transaction('READ COMMITTED', async (transaction) => {
        if ((await lockC02EvidenceStaging(transaction, ref)) !== true) return false;
        const [current] = await inspectC02EvidenceInventory(transaction, provider, [
          item.storageKey,
        ]);
        if (current?.status !== 'UNREFERENCED_C02') return false;
        await storage.removeChecked(ref);
        return true;
      });
      if (removed) yield item.storageKey;
    }
  }
}
