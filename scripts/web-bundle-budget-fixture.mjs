import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_PREFIX = 'smartsite-bundle-budget-';

export async function withTempBundleFixture(files, manifest, fn) {
  const baseTmp = path.resolve(os.tmpdir());
  const tempDir = fs.mkdtempSync(path.join(baseTmp, TMP_PREFIX));
  try {
    for (const [relPath, sizeOrContent] of Object.entries(files)) {
      const targetPath = path.resolve(tempDir, relPath);
      const relToTemp = path.relative(tempDir, targetPath);
      assert.ok(
        relToTemp && !relToTemp.startsWith('..') && !path.isAbsolute(relToTemp),
        `Fixture file escaped temp dir: ${relPath}`,
      );
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const content =
        typeof sizeOrContent === 'number'
          ? Buffer.alloc(sizeOrContent, 0x61)
          : Buffer.from(String(sizeOrContent), 'utf8');
      fs.writeFileSync(targetPath, content);
    }
    const manifestPath = path.join(tempDir, 'manifest.json');
    const rawManifest = typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2);
    fs.writeFileSync(manifestPath, rawManifest, 'utf8');
    return await fn(manifestPath, tempDir);
  } finally {
    const resolvedTemp = path.resolve(tempDir);
    if (
      resolvedTemp !== baseTmp &&
      resolvedTemp.startsWith(`${baseTmp}${path.sep}`) &&
      path.basename(resolvedTemp).startsWith(TMP_PREFIX)
    ) {
      fs.rmSync(resolvedTemp, { recursive: true, force: true });
    }
  }
}
