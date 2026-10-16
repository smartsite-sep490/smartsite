#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  buildAiEnvironment,
  buildComposeEnvironment,
  buildHiddenLaunchOptions,
  buildTapoRtspUrl,
  buildWindowsProcessInspectionScript,
  decideStart,
  loadRuntimeConfig,
  parseCredentialDocument,
  parseRuntimeArguments,
  processIdentityMatches,
  redactSensitiveText,
  selectChildEnvironment,
  splitAiEnvironments,
  validateRuntimeInputs,
} from './smartsite-runtime-lib.mjs';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');

function runtimePaths(config) {
  const controlRoot = path.join(config.dataRoot, 'control');
  return {
    controlRoot,
    logsRoot: path.join(controlRoot, 'logs'),
    statePath: path.join(controlRoot, 'state.json'),
    regionConfigurationPath: path.join(controlRoot, 'region-configuration.json'),
    classMapPath: path.join(controlRoot, 'yolo11s-class-map.json'),
  };
}

async function readJson(filePath, label) {
  let document;
  try {
    document = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${label}: ${error.message}`, { cause: error });
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return document;
}

async function readState(statePath) {
  try {
    return await readJson(statePath, 'runtime state');
  } catch (error) {
    if (error.cause?.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function commandFingerprint(executablePath, commandLine) {
  return createHash('sha256')
    .update(`${executablePath ?? ''}\0${commandLine ?? ''}`)
    .digest('hex');
}

async function inspectProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !isProcessAlive(pid)) {
    return undefined;
  }
  if (process.platform === 'win32') {
    const script = buildWindowsProcessInspectionScript(pid);
    const { stdout } = await runProgram(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 10_000 },
    );
    if (!stdout.trim()) {
      return undefined;
    }
    const inspected = JSON.parse(stdout);
    return {
      createdAt: inspected.createdAt,
      commandSha256: commandFingerprint(inspected.executablePath, inspected.commandLine),
    };
  }
  try {
    const { stdout } = await runProgram(
      'ps',
      ['-p', String(pid), '-o', 'lstart=', '-o', 'command='],
      { timeout: 10_000 },
    );
    const [createdAt, ...commandParts] = stdout.trim().split(/\s{2,}/u);
    if (!createdAt || commandParts.length === 0) {
      return undefined;
    }
    return {
      createdAt,
      commandSha256: commandFingerprint('', commandParts.join('  ')),
    };
  } catch {
    return undefined;
  }
}

async function trackedProcessIsAlive(processState) {
  if (!processState || !isProcessAlive(processState.pid)) {
    return false;
  }
  return processIdentityMatches(
    processState.identity,
    await inspectProcessIdentity(processState.pid),
  );
}

async function runProgram(command, arguments_, options = {}) {
  try {
    return await execFileAsync(command, arguments_, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      timeout: options.timeout ?? 300_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    const output = redactSensitiveText(
      [error.stdout, error.stderr, error.message].filter(Boolean).join('\n'),
    );
    throw new Error(`${command} failed: ${output}`, { cause: error });
  }
}

function composeArguments(command, { build = false } = {}) {
  const base = [
    'compose',
    '-f',
    path.join(repositoryRoot, 'infra', 'compose.yaml'),
    '-f',
    path.join(repositoryRoot, 'infra', 'compose.evidence.yaml'),
  ];
  if (command === 'up') {
    return [
      ...base,
      'up',
      '-d',
      ...(build ? ['--build'] : []),
      'postgres',
      'backend',
      'web',
      '--wait',
      '--wait-timeout',
      '180',
    ];
  }
  return [...base, 'down'];
}

async function waitForHttp(url, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      lastStatus = `HTTP ${response.status}`;
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastStatus = error.name;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`health check timed out for ${url} (${lastStatus})`);
}

async function fetchRegionConfiguration(backendUrl, cameraId, serviceToken) {
  const url = `${backendUrl.replace(/\/$/u, '')}/api/v1/integrations/ai/cameras/${encodeURIComponent(cameraId)}/configuration`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${serviceToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Backend camera configuration returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Backend camera configuration response is invalid');
  }
  return payload;
}

async function loadServiceToken(config) {
  const document = await readFile(config.backendServiceCredentialPath, 'utf8');
  return parseCredentialDocument(document, ['Token']).Token;
}

async function sourceEnvironment(config, source, manifest) {
  if (source !== 'tapo') {
    return {};
  }
  const reference = manifest.cameras?.[0]?.source;
  if (reference?.kind !== 'env') {
    throw new Error('Tapo manifest must reference its source through an environment name');
  }
  const credentials = parseCredentialDocument(await readFile(config.tapoCredentialPath, 'utf8'), [
    'Username',
    'Password',
    'Host',
    'Stream',
  ]);
  return { [reference.name]: buildTapoRtspUrl(credentials) };
}

async function terminateFreshlySpawnedProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !isProcessAlive(pid)) {
    return;
  }
  if (process.platform === 'win32') {
    await runProgram('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { timeout: 15_000 });
    return;
  }
  process.kill(-pid, 'SIGKILL');
}

async function launchHiddenProcess({
  name,
  command,
  arguments_,
  cwd,
  env,
  logsRoot,
  discardOutput = false,
}) {
  const stdoutPath = path.join(logsRoot, `${name}.log`);
  const stderrPath = path.join(logsRoot, `${name}.error.log`);
  const stdout = discardOutput ? undefined : await open(stdoutPath, 'a');
  const stderr = discardOutput ? undefined : await open(stderrPath, 'a');
  let child;
  try {
    child = spawn(
      command,
      arguments_,
      buildHiddenLaunchOptions({
        cwd,
        env,
        stdoutFd: stdout?.fd ?? 'ignore',
        stderrFd: stderr?.fd ?? 'ignore',
      }),
    );
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    const identity = await inspectProcessIdentity(child.pid);
    if (!identity) {
      throw new Error(`${name} exited before its process identity could be recorded`);
    }
    child.unref();
    return {
      pid: child.pid,
      identity,
      ...(discardOutput ? {} : { stdoutPath, stderrPath }),
      output: discardOutput ? 'discarded-for-credential-safety' : 'redirected',
    };
  } catch (error) {
    await terminateFreshlySpawnedProcess(child?.pid);
    throw error;
  } finally {
    await Promise.all([stdout?.close(), stderr?.close()]);
  }
}

async function terminateProcess(processState) {
  const pid = processState?.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0 || !isProcessAlive(pid)) {
    return { terminated: false, reason: 'not-running' };
  }
  if (!(await trackedProcessIsAlive(processState))) {
    return { terminated: false, reason: 'identity-mismatch' };
  }
  if (process.platform === 'win32') {
    try {
      await runProgram('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { timeout: 15_000 });
    } catch (error) {
      if (isProcessAlive(pid)) {
        throw error;
      }
    }
    return { terminated: true };
  }
  process.kill(-pid, 'SIGTERM');
  return { terminated: true };
}

async function start(config, source, build) {
  const paths = runtimePaths(config);
  await Promise.all([
    mkdir(paths.controlRoot, { recursive: true }),
    mkdir(paths.logsRoot, { recursive: true }),
    mkdir(config.evidenceRoot, { recursive: true }),
  ]);

  const existingState = await readState(paths.statePath);
  const liveTrackedPids = new Set();
  for (const processState of Object.values(existingState?.processes ?? {})) {
    if (await trackedProcessIsAlive(processState)) {
      liveTrackedPids.add(processState.pid);
    }
  }
  const decision = decideStart(existingState, source, (pid) => liveTrackedPids.has(pid));
  if (decision.action === 'already-running') {
    return { status: 'already-running', source, statePath: paths.statePath };
  }
  if (decision.action === 'replace-stale-state') {
    await rm(paths.statePath, { force: true });
  }

  const [serviceToken, demoConfiguration, modelSpec, sourceManifest] = await Promise.all([
    loadServiceToken(config),
    readJson(config.demoConfigurationPath, 'demo configuration'),
    readJson(config.modelSpecPath, 'model spec'),
    readJson(config.sourceManifests[source], `${source} source manifest`),
  ]);
  validateRuntimeInputs(config, demoConfiguration, sourceManifest);
  const backendUrl = config.backendUrl ?? 'http://127.0.0.1:3000';
  const webUrl = config.webUrl ?? 'http://127.0.0.1:5173';
  const aiUrl = config.aiUrl ?? 'http://127.0.0.1:8000';
  const composeEnvironment = buildComposeEnvironment({
    baseEnv: process.env,
    backendUrl,
    evidenceRoot: config.evidenceRoot,
    cameraId: demoConfiguration.cameraId,
    serviceToken,
  });

  const reuseApi = decision.action === 'restart-source';
  const processes = reuseApi ? { aiApi: existingState.processes.aiApi } : {};
  let composeStarted = false;
  const makeState = (stage) => ({
    schemaVersion: '1',
    instanceId: reuseApi ? existingState.instanceId : randomUUID(),
    source,
    stage,
    startedAt: reuseApi ? existingState.startedAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    repositoryRoot,
    processes,
    endpoints: { backendUrl, webUrl, aiUrl },
  });

  try {
    // Compose may create containers before its readiness check fails.
    composeStarted = true;
    await runProgram('docker', composeArguments('up', { build }), {
      cwd: repositoryRoot,
      env: composeEnvironment,
    });
    await Promise.all([waitForHttp(`${backendUrl}/api/v1/health/ready`), waitForHttp(webUrl)]);

    const regionConfiguration = await fetchRegionConfiguration(
      backendUrl,
      demoConfiguration.cameraId,
      serviceToken,
    );
    await Promise.all([
      writeJsonAtomically(paths.regionConfigurationPath, regionConfiguration),
      writeJsonAtomically(paths.classMapPath, modelSpec.classMap),
    ]);
    const combinedAiEnvironment = buildAiEnvironment({
      baseEnv: {
        ...selectChildEnvironment(process.env),
        ...(await sourceEnvironment(config, source, sourceManifest)),
      },
      serviceToken,
      backendUrl,
      aiRepo: config.aiRepo,
      modelSpec,
      demoConfiguration,
      sourceManifest,
      classMapPath: paths.classMapPath,
      regionConfigurationPath: paths.regionConfigurationPath,
    });
    const aiEnvironment = splitAiEnvironments(combinedAiEnvironment, source, sourceManifest);

    if (!reuseApi) {
      processes.aiApi = await launchHiddenProcess({
        name: 'ai-api',
        command: config.pythonPath,
        arguments_: ['-m', 'smartsite_ai.main'],
        cwd: config.aiRepo,
        env: aiEnvironment.api,
        logsRoot: paths.logsRoot,
        // Uvicorn WebSocket access logs include the URL's local credential.
        discardOutput: true,
      });
      await writeJsonAtomically(paths.statePath, makeState('starting-ai-api'));
    }
    await waitForHttp(`${aiUrl}/health/ready`);
    processes.aiSource = await launchHiddenProcess({
      name: 'ai-source',
      command: config.pythonPath,
      arguments_: [
        '-m',
        'smartsite_ai.tools.run_camera_runtime',
        '--manifest',
        config.sourceManifests[source],
      ],
      cwd: config.aiRepo,
      env: aiEnvironment.worker,
      logsRoot: paths.logsRoot,
      discardOutput: source === 'tapo',
    });
    const state = makeState('running');
    await writeJsonAtomically(paths.statePath, state);
    return {
      status: reuseApi ? 'source-restarted' : 'started',
      source,
      endpoints: state.endpoints,
      processes: Object.fromEntries(
        Object.entries(processes).map(([name, processState]) => [name, { pid: processState.pid }]),
      ),
      statePath: paths.statePath,
    };
  } catch (error) {
    const cleanup = await Promise.allSettled([
      terminateProcess(processes.aiSource),
      reuseApi
        ? Promise.resolve({ terminated: false, reason: 'reused' })
        : terminateProcess(processes.aiApi),
      !reuseApi && composeStarted
        ? runProgram('docker', composeArguments('down'), {
            cwd: repositoryRoot,
            env: composeEnvironment,
          })
        : Promise.resolve(),
    ]);
    const cleanupFailure = cleanup.find((result) => result.status === 'rejected');
    if (cleanupFailure) {
      await writeJsonAtomically(paths.statePath, makeState('cleanup-required'));
      throw new Error(
        `${error.message}; cleanup also failed: ${redactSensitiveText(cleanupFailure.reason?.message ?? cleanupFailure.reason)}`,
        { cause: error },
      );
    }
    if (!reuseApi) {
      await rm(paths.statePath, { force: true });
    }
    throw error;
  }
}

async function status(config) {
  const paths = runtimePaths(config);
  const state = await readState(paths.statePath);
  const endpoints = state?.endpoints ?? {
    backendUrl: config.backendUrl ?? 'http://127.0.0.1:3000',
    webUrl: config.webUrl ?? 'http://127.0.0.1:5173',
    aiUrl: config.aiUrl ?? 'http://127.0.0.1:8000',
  };
  const probe = async (url) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      return { reachable: response.ok, status: response.status };
    } catch {
      return { reachable: false };
    }
  };
  const processStatus = {};
  for (const [name, value] of Object.entries(state?.processes ?? {})) {
    processStatus[name] = { pid: value.pid, running: await trackedProcessIsAlive(value) };
  }
  return {
    status: state ? 'known' : 'not-started-by-controller',
    source: state?.source,
    processes: processStatus,
    health: {
      backend: await probe(`${endpoints.backendUrl}/api/v1/health/ready`),
      web: await probe(endpoints.webUrl),
      aiApi: await probe(`${endpoints.aiUrl}/health/ready`),
    },
    note: 'AI API readiness confirms the API lifecycle only. Model and source open when a realtime client connects.',
    statePath: paths.statePath,
  };
}

async function stop(config) {
  const paths = runtimePaths(config);
  const state = await readState(paths.statePath);
  const stopped = [];
  const skipped = [];
  for (const name of ['aiSource', 'aiApi']) {
    const processState = state?.processes?.[name];
    const pid = processState?.pid;
    if (Number.isSafeInteger(pid) && pid > 0) {
      const outcome = await terminateProcess(processState);
      if (outcome.terminated) {
        stopped.push({ name, pid });
      } else {
        skipped.push({ name, pid, reason: outcome.reason });
      }
    }
  }
  await runProgram('docker', composeArguments('down'), {
    cwd: repositoryRoot,
    env: { ...process.env, EVIDENCE_LOCAL_HOST_ROOT: config.evidenceRoot },
  });
  await rm(paths.statePath, { force: true });
  return { status: 'stopped', stopped, skipped, dataPreserved: true };
}

async function main() {
  const arguments_ = parseRuntimeArguments(process.argv.slice(2));
  const configPath = arguments_.configPath ?? process.env.SMARTSITE_RUNTIME_CONFIG;
  if (!configPath) {
    throw new Error('provide --config or SMARTSITE_RUNTIME_CONFIG');
  }
  const config = await loadRuntimeConfig(path.resolve(configPath));
  let result;
  if (arguments_.command === 'start') {
    result = await start(config, arguments_.source, arguments_.build);
  } else if (arguments_.command === 'status') {
    result = await status(config);
  } else {
    result = await stop(config);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${redactSensitiveText(error.message)}\n`);
  process.exitCode = 1;
});
