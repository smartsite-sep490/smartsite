import type { DataSource } from 'typeorm';
import { GateEntity, CameraEntity, CameraStatus } from '../../src/database/entities/index.js';

export const testGateId = 'a1000000-0000-4000-8000-000000000001';
export const sourceForGate = (gateId: string) => gateId.replace(/^a/, 'c');
export async function seedGateFixture(source: DataSource, siteId: string, other = false) {
  for (let index = 1; index <= 3; index++) {
    const gateId = `a${other ? '2' : '1'}000000-0000-4000-8000-00000000000${index}`;
    await source
      .getRepository(GateEntity)
      .save({ id: gateId, siteId, code: `G${index}`, name: `Gate ${index}`, status: 'ACTIVE' });
    const id = sourceForGate(gateId);
    await source.getRepository(CameraEntity).save({
      id,
      siteId,
      type: 'GATE',
      gateId,
      code: `GATE-${index}`,
      name: `Gate camera ${index}`,
      externalId: `gate-webcam-${id}`,
      status: CameraStatus.ACTIVE,
      configurationVersion: 1,
    });
  }
}
export async function cleanupGateFixture(source: DataSource, siteIds: string[]) {
  await source.query("DELETE FROM camera WHERE site_id=ANY($1) AND type='GATE'", [siteIds]);
  await source.query('DELETE FROM gate WHERE site_id=ANY($1)', [siteIds]);
}
