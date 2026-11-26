import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(import.meta.dirname, '..');
const GIT_SHA = 'a'.repeat(40);
const BUILD_ID = '12345678-1234-4123-8123-1234567890ab';
const CANDIDATE = `smartsite-backend-main-${GIT_SHA.slice(0, 7)}-${BUILD_ID.slice(0, 8)}`;

function resolveBashExecutable() {
  if (process.platform === 'win32') {
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
    if (existsSync(gitBash)) return gitBash;
  }
  return 'bash';
}

const toPosixPath = (value) => value.replaceAll('\\', '/');

async function runReleaseScript(shimDir, action, extraEnv = {}) {
  const bash = resolveBashExecutable();
  const wrapper = [
    'command -v cygpath >/dev/null 2>&1 && SHIM="$(cygpath -u "$1")" || SHIM="$1"',
    'export PATH="$SHIM:$PATH"',
    'shift',
    'exec bash infra/cloud-run-release.sh "$@" </dev/null',
  ].join('\n');

  try {
    const { stdout, stderr } = await execFileAsync(
      bash,
      ['-c', wrapper, '_', toPosixPath(shimDir), action],
      {
        cwd: REPO_ROOT,
        timeout: 15_000,
        env: {
          ...process.env,
          PROJECT_ID: 'synthetic-project',
          REGION: 'asia-southeast1',
          SERVICE: 'smartsite-backend',
          GIT_SHA,
          BUILD_ID,
          IMAGE_TAG: 'asia-southeast1-docker.pkg.dev/synthetic-project/repo/image:tag',
          ...extraEnv,
        },
      },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: typeof error.code === 'number' ? error.code : 1,
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? ''),
    };
  }
}

async function createShims(t, options = {}) {
  const tempBase = await realpath(tmpdir());
  const root = await mkdtemp(join(tempBase, 'cloud-run-release-test-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const shimDir = join(root, 'shim bin');
  const pythonDir = join(root, 'gcloud python', 'bin');
  await mkdir(shimDir, { recursive: true });
  await mkdir(pythonDir, { recursive: true });

  const pythonLog = join(root, 'python-calls.log');
  const curlLog = join(root, 'curl-calls.log');
  const nodeExe = toPosixPath(process.execPath);

  const pyShimScript = join(root, 'py-shim.cjs');
  await writeFile(
    pyShimScript,
    `const fs = require('node:fs');
const [logFile, ...args] = process.argv.slice(2);
const code = args[1] || '';
if (code.includes('reviewedManifestSha256')) {
  fs.appendFileSync(logFile, JSON.stringify({ args, stdin: null }) + '\\n');
  console.log('${'2'.repeat(64)}');
} else if (code.includes('MF06_CUTOVER_MANIFEST_SHA256')) {
  const stdin = fs.readFileSync(0, 'utf8');
  fs.appendFileSync(logFile, JSON.stringify({ args, stdin }) + '\\n');
  const parsed = JSON.parse(stdin);
  const env = parsed.spec.template.spec.containers[0].env || [];
  console.log((env.find((entry) => entry.name === 'MF06_CUTOVER_MANIFEST_SHA256') || {}).value || '');
} else if (code.includes('["status"]["traffic"]')) {
  const stdin = fs.readFileSync(0, 'utf8');
  fs.appendFileSync(logFile, JSON.stringify({ args, stdin }) + '\\n');
  const rows = JSON.parse(stdin).status.traffic;
  const candidate = args[2];
  const hit = rows.find((row) => row.tag === 'main-candidate' && row.revisionName === candidate);
  if (!hit) process.exit(1);
  console.log(hit.url);
} else {
  process.exit(1);
}
`,
    'utf8',
  );

  const pythonBin = join(pythonDir, 'py-exec');
  await writeFile(
    pythonBin,
    `#!/bin/sh
exec "${nodeExe}" "${toPosixPath(pyShimScript)}" "${toPosixPath(pythonLog)}" "$@"
`,
    'utf8',
  );
  await chmod(pythonBin, 0o755);

  const barePython3 = join(shimDir, 'python3');
  await writeFile(
    barePython3,
    `#!/bin/sh
echo 'bare python3 on PATH must not be invoked' >&2
exit 127
`,
    'utf8',
  );
  await chmod(barePython3, 0o755);

  const reportedPython = options.pythonLocation ?? toPosixPath(pythonBin);
  const gcloudBin = join(shimDir, 'gcloud');
  await writeFile(
    gcloudBin,
    `#!/bin/sh
case "$*" in
  *"info --format=value(basic.python_location)"*)
    printf '%s\\n' '${reportedPython}'
    ;;
  *"run services describe"*"--format=json(status.traffic)"*)
    printf '%s\\n' '{"status":{"traffic":[{"tag":"main-candidate","revisionName":"${CANDIDATE}","url":"https://candidate.example.invalid"}]}}'
    ;;
  *"run services describe"*"--format=json"*)
    printf '%s\\n' '{"spec":{"template":{"spec":{"containers":[{"env":[{"name":"MF06_CUTOVER_MANIFEST_SHA256","value":"${'1'.repeat(64)}"}]}]}}}}'
    ;;
  *"builds describe"*)
    printf '%s\\n' 'trigger-123'
    ;;
  *"builds list"*)
    printf '%s\\n' '${BUILD_ID}'
    ;;
  *"run services update-traffic"*)
    # Fail cleanly after verifying curl received the resolved candidate URL so host /workspace is not touched.
    echo 'stop before host /workspace write' >&2
    exit 42
    ;;
  *)
    echo "unexpected gcloud args: $*" >&2
    exit 99
    ;;
esac
`,
    'utf8',
  );
  await chmod(gcloudBin, 0o755);

  const curlBin = join(shimDir, 'curl');
  await writeFile(
    curlBin,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${toPosixPath(curlLog)}"
exit 0
`,
    'utf8',
  );
  await chmod(curlBin, 0o755);

  return { root, shimDir, pythonDir, pythonBin, pythonLog, curlLog };
}

test('prepare uses gcloud python_location (quoted) for both JSON parsers instead of bare python3', async (t) => {
  const fx = await createShims(t);
  const res = await runReleaseScript(fx.shimDir, 'prepare');
  assert.equal(res.code, 1, res.stderr);
  assert.match(res.stderr, /reviewed authority release changed/i);
  assert.equal(res.stderr.includes('bare python3 on PATH must not be invoked'), false);

  const calls = (await readFile(fx.pythonLog, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(calls.length, 2);
  assert.ok(calls[0].args[1].includes('MF06_CUTOVER_MANIFEST_SHA256'));
  assert.ok(calls[1].args[1].includes('/workspace/.mf06-release-info.json'));
});

test('promote uses gcloud python_location (quoted) for candidate URL JSON parser instead of bare python3', async (t) => {
  const fx = await createShims(t);
  const res = await runReleaseScript(fx.shimDir, 'promote');
  assert.equal(res.code, 42, res.stderr);
  assert.equal(res.stderr.includes('bare python3 on PATH must not be invoked'), false);

  const calls = (await readFile(fx.pythonLog, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args[1].includes('["status"]["traffic"]'));
  assert.equal(calls[0].args[2], CANDIDATE);

  const curlArgs = await readFile(fx.curlLog, 'utf8');
  assert.match(curlArgs, /https:\/\/candidate\.example\.invalid\/api\/v1\/health\/ready/);
});

test('fails closed when gcloud info python_location is missing, directory, or non-executable', async (t) => {
  const fx = await createShims(t);
  const nonExecutable = join(fx.root, 'not-executable.txt');
  await writeFile(nonExecutable, 'plain non-executable payload\n', 'utf8');
  await chmod(nonExecutable, 0o644);

  for (const invalidTarget of ['', join(fx.root, 'does-not-exist'), fx.root, nonExecutable]) {
    const caseFx = await createShims(t, { pythonLocation: toPosixPath(invalidTarget) });
    for (const action of ['prepare', 'promote']) {
      const res = await runReleaseScript(caseFx.shimDir, action);
      assert.equal(res.code, 1, `expected failure for "${invalidTarget}" on ${action}`);
      assert.match(res.stderr, /Missing executable Python from gcloud info/);
    }
  }
});
