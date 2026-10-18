import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** Explicit dedicated-test tools only; never infer an operational database/container. */
export function recoveryPostgresTools(directory?: string, containerId?: string) {
  if (directory) {
    assert(isAbsolute(directory));
    const executable = (name: string) =>
      join(directory, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
    assert.match(
      execFileSync(executable('pg_dump'), ['--version'], { encoding: 'utf8', windowsHide: true }),
      /PostgreSQL/,
    );
    return (tool: 'pg_dump' | 'pg_restore', args: string[], env: NodeJS.ProcessEnv) => {
      execFileSync(executable(tool), args, { env, windowsHide: true, timeout: 10_000 });
    };
  }
  assert.match(containerId ?? '', /^[a-f0-9]{64}$/);
  const inspect = () =>
    JSON.parse(
      execFileSync('docker', ['inspect', containerId!, '--format', '{{json .}}'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10_000,
      }),
    );
  const identity = inspect();
  assert.equal(identity.Id, containerId);
  assert.equal(identity.Config.Labels['com.docker.compose.service'], 'postgres-test');
  assert.match(identity.Config.Labels['com.docker.compose.project'], /^smartsite-[a-z0-9-]+$/);
  assert.match(identity.Config.Image, /^postgres:18(?:[.-]|$)/);
  assert.deepEqual(identity.HostConfig.PortBindings['5432/tcp'], [
    { HostIp: '127.0.0.1', HostPort: '5433' },
  ]);
  for (const setting of [
    'POSTGRES_USER=smartsite_test',
    'POSTGRES_DB=smartsite_test',
    'POSTGRES_PASSWORD=smartsite_test_only',
  ])
    assert(identity.Config.Env.includes(setting));
  return (tool: 'pg_dump' | 'pg_restore', args: string[], env: NodeJS.ProcessEnv) => {
    assert.equal(inspect().State.Running, true);
    assert.equal(env.PGPASSWORD, 'smartsite_test_only');
    assert.deepEqual(args.slice(0, 8), [
      '-h',
      '127.0.0.1',
      '-p',
      '5433',
      '-U',
      'smartsite_test',
      '-d',
      'smartsite_test',
    ]);
    assert.match(args[args.indexOf('--schema') + 1]!, /^isolated_test_[a-f0-9]{32}$/);
    const command = args.slice();
    command[3] = '5432';
    const fileIndex = tool === 'pg_dump' ? command.indexOf('--file') : command.length - 1;
    const file = command[tool === 'pg_dump' ? fileIndex + 1 : fileIndex]!;
    assert(isAbsolute(file));
    if (tool === 'pg_dump') {
      assert(fileIndex >= 8);
      command.splice(fileIndex, 2);
    } else command.splice(fileIndex, 1);
    const output = execFileSync(
      'docker',
      ['exec', '-i', '-e', 'PGPASSWORD=smartsite_test_only', containerId!, tool, ...command],
      {
        input: tool === 'pg_restore' ? readFileSync(file) : undefined,
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    if (tool === 'pg_dump') writeFileSync(file, output);
  };
}
