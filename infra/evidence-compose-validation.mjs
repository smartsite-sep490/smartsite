import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Validate the normalized Compose model, never a runtime container or real media. */
export function assertPrivateEvidenceConfig(config, root, { falseIsOmitted = false } = {}) {
  const mount = config.services.backend.volumes.find(
    (volume) => volume.target === '/var/lib/smartsite/evidence',
  );
  assert.equal(mount.type, 'bind');
  assert.equal(resolve(mount.source), resolve(root));
  assert.equal(mount.read_only, true);
  // Only a creation-enabled control can establish old bool/omitempty encoding.
  // New OptOut encoding omits true instead, so absence is rejected by default.
  const createHostPath = mount.bind.create_host_path;
  assert.ok(createHostPath === false || (falseIsOmitted === true && createHostPath === undefined));
  assert.equal(config.services.backend.environment.EVIDENCE_LOCAL_ROOT, mount.target);
  assert.equal(
    config.services.web.volumes?.some((volume) => volume.target === mount.target) ?? false,
    false,
  );
}
