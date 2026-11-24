import { randomUUID } from 'node:crypto';
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

/** One owner must hold the compiled test tree from cleanup through the last test. */
export function acquireTestBuildLock(lockPath) {
  const token = randomUUID();
  let descriptor;
  try {
    descriptor = openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner = 'unknown';
    try {
      owner = JSON.parse(readFileSync(lockPath, 'utf8')).pid;
    } catch {
      /* Owner may still be writing. */
    }
    throw new Error(
      `Backend test output is already reserved (PID ${owner}). Wait for the other test/test:integration run to finish. Lock: ${lockPath}. If that process was terminated, verify it has stopped before removing the stale lock.`,
      { cause: error },
    );
  }
  try {
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token }));
  } finally {
    closeSync(descriptor);
  }
  return () => {
    try {
      if (JSON.parse(readFileSync(lockPath, 'utf8')).token === token) unlinkSync(lockPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  };
}
