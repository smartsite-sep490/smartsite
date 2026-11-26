import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function assertReadyRevision(revision, expectedName, expectedCommit) {
  if (
    !/^[0-9a-f]{40}$/.test(expectedCommit) ||
    revision?.metadata?.name !== expectedName ||
    revision?.metadata?.labels?.['smartsite-git-sha'] !== expectedCommit ||
    !revision?.status?.conditions?.some(
      (condition) => condition.type === 'Ready' && condition.status === 'True',
    )
  )
    throw new Error('The requested Main revision is not verified Ready');
}

export function assertServingRevision(service, expectedName) {
  const serving = service?.status?.traffic?.filter((entry) => entry.percent > 0);
  if (
    !serving ||
    serving.length !== 1 ||
    serving[0].revisionName !== expectedName ||
    serving[0].percent !== 100
  )
    throw new Error('The requested revision is not serving 100 percent of traffic');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [phase, revision, file, commit] = process.argv.slice(2);
    if (!['revision', 'traffic'].includes(phase) || !revision || !file)
      throw new Error(
        'Usage: verify-cloud-run-release.mjs <revision|traffic> <name> <json> [commit]',
      );
    const bytes = await readFile(file);
    if (bytes.length > 1024 * 1024) throw new Error('Cloud Run status exceeds budget');
    const value = JSON.parse(bytes.toString('utf8'));
    if (phase === 'revision') assertReadyRevision(value, revision, commit);
    else assertServingRevision(value, revision);
    console.log(JSON.stringify({ phase, revision, verified: true }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
