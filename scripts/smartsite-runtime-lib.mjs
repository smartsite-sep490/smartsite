import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function buildWindowsProcessInspectionScript(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error('process ID must be a positive safe integer');
  }
  return [
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue;`,
    "if ($null -eq $p) { Write-Output ''; exit 0 };",
    "[ordered]@{ createdAt = $p.CreationDate.ToUniversalTime().ToString('o');",
    'executablePath = [string]$p.ExecutablePath;',
    'commandLine = [string]$p.CommandLine } | ConvertTo-Json -Compress',
  ].join(' ');
}

const COMMANDS = new Set(['start', 'status', 'stop']);
const SOURCES = new Set(['mp4', 'laptop', 'tapo']);
const CONFIG_KEYS = new Set([
  'schemaVersion',
  'dataRoot',
  'aiRepo',
  'pythonPath',
  'demoConfigurationPath',
  'modelSpecPath',
  'evidenceRoot',
  'sourceManifests',
  'tapoCredentialPath',
  'backendServiceCredentialPath',
  'backendUrl',
  'webUrl',
  'aiUrl',
]);
const REQUIRED_PATH_KEYS = [
  'dataRoot',
  'aiRepo',
  'pythonPath',
  'demoConfigurationPath',
  'modelSpecPath',
  'evidenceRoot',
  'tapoCredentialPath',
  'backendServiceCredentialPath',
];
const CHILD_ENVIRONMENT_KEYS = new Set([
  'APPDATA',
  'CUDA_PATH',
  'FORCE_COLOR',
  'HOME',
  'LOCALAPPDATA',
  'NO_COLOR',
  'PATH',
  'PATHEXT',
  'PROGRAMDATA',
  'PYTHONIOENCODING',
  'PYTHONUTF8',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'VIRTUAL_ENV',
  'WINDIR',
]);

function requireValue(arguments_, index, option) {
  const value = arguments_[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function parseRuntimeArguments(arguments_) {
  const normalizedArguments = arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
  const [command, ...options] = normalizedArguments;
  if (!COMMANDS.has(command)) {
    throw new Error('command must be one of start, status, stop');
  }

  const parsed = {
    command,
    source: undefined,
    configPath: undefined,
    build: false,
  };

  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === '--source') {
      parsed.source = requireValue(options, index, option);
      index += 1;
    } else if (option === '--config') {
      parsed.configPath = requireValue(options, index, option);
      index += 1;
    } else if (option === '--build') {
      parsed.build = true;
    } else {
      throw new Error(`unsupported option: ${option}`);
    }
  }

  if (parsed.source !== undefined && !SOURCES.has(parsed.source)) {
    throw new Error('source must be one of mp4, laptop, tapo');
  }
  if (command === 'start' && parsed.source === undefined) {
    throw new Error('start requires --source with one of mp4, laptop, tapo');
  }
  if (command !== 'start' && parsed.source !== undefined) {
    throw new Error('--source is valid only with start');
  }
  if (command !== 'start' && parsed.build) {
    throw new Error('--build is valid only with start');
  }

  return parsed;
}

export function redactSensitiveText(value) {
  return String(value)
    .replace(/\brtsps?:\/\/[^\s/@]+(?::[^\s/@]*)?@/giu, (match) => {
      const scheme = match.toLocaleLowerCase('en-US').startsWith('rtsps:') ? 'rtsps' : 'rtsp';
      return `${scheme}://<redacted>@`;
    })
    .replace(/(\bAuthorization\s*:\s*Bearer\s+)[^\s]+/giu, '$1<redacted>')
    .replace(/((?:token|password|secret|api[_-]?key)\s*[:=]\s*)[^\s]+/giu, '$1<redacted>');
}

export function selectChildEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key, value]) =>
        typeof value === 'string' &&
        (CHILD_ENVIRONMENT_KEYS.has(key) || key.startsWith('CUDA_') || key.startsWith('NVIDIA_')),
    ),
  );
}

export function splitAiEnvironments(combined, sourceProfile, sourceManifest) {
  const worker = { ...combined };
  const api = { ...combined };
  // Only the durable worker owns event delivery and retained evidence.
  // An empty override prevents an AI .env file from restoring the ingestion URL.
  // Keep the service token for preview authentication.
  api.SMARTSITE_AI_BACKEND_INGESTION_URL = '';
  if (sourceProfile !== 'mp4') {
    delete api.SMARTSITE_AI_REALTIME_SOURCE;
    const reference = sourceManifest.cameras?.[0]?.source;
    if (reference?.kind === 'env' && typeof reference.name === 'string') {
      delete api[reference.name];
    }
  }
  return { api, worker };
}

export function buildHiddenLaunchOptions({ cwd, env, stdoutFd, stderrFd }) {
  return {
    cwd,
    env,
    shell: false,
    windowsHide: true,
    detached: true,
    stdio: ['ignore', stdoutFd, stderrFd],
  };
}

export function processIdentityMatches(expected, current) {
  return Boolean(
    expected &&
    current &&
    typeof expected.createdAt === 'string' &&
    expected.createdAt === current.createdAt &&
    /^[0-9a-f]{64}$/u.test(expected.commandSha256) &&
    expected.commandSha256 === current.commandSha256,
  );
}

export function parseCredentialDocument(document, requiredKeys) {
  const credentials = {};
  for (const rawLine of String(document).split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const match = /^([^:=]+?)\s*[:=]\s*(.*)$/u.exec(line);
    if (!match || !match[2]) {
      throw new Error('credential file contains an invalid or empty entry');
    }
    const key = match[1].trim();
    if (Object.hasOwn(credentials, key)) {
      throw new Error(`credential file contains duplicate ${key}`);
    }
    credentials[key] = match[2];
  }
  for (const key of requiredKeys) {
    if (typeof credentials[key] !== 'string' || credentials[key].trim() === '') {
      throw new Error(`credential file is missing ${key}`);
    }
  }
  return credentials;
}

export function buildTapoRtspUrl(credentials) {
  const { Username, Password, Host, Stream } = credentials;
  if (!/^[A-Za-z0-9.-]+$/u.test(Host)) {
    throw new Error('Tapo host is invalid');
  }
  if (!/^[A-Za-z0-9_-]+$/u.test(Stream)) {
    throw new Error('Tapo stream is invalid');
  }
  return `rtsp://${encodeURIComponent(Username)}:${encodeURIComponent(Password)}@${Host}:554/${Stream}`;
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

export function buildComposeEnvironment({
  baseEnv,
  backendUrl,
  evidenceRoot,
  cameraId,
  serviceToken,
}) {
  return {
    ...baseEnv,
    SMARTSITE_WEB_API_URL: requiredString(backendUrl, 'Backend URL'),
    EVIDENCE_LOCAL_HOST_ROOT: requiredString(evidenceRoot, 'evidence root'),
    AI_CONFIGURATION_CAMERA_IDS: requiredString(cameraId, 'camera ID'),
    SMARTSITE_AI_SERVICE_TOKEN: requiredString(serviceToken, 'Backend service token'),
  };
}

export function buildAiEnvironment({
  baseEnv,
  serviceToken,
  backendUrl,
  aiRepo,
  modelSpec,
  demoConfiguration,
  sourceManifest,
  classMapPath,
  regionConfigurationPath,
}) {
  assertPlainObject(modelSpec, 'model spec');
  assertPlainObject(demoConfiguration, 'demo configuration');
  assertPlainObject(sourceManifest, 'source manifest');
  if (!Array.isArray(sourceManifest.cameras) || sourceManifest.cameras.length === 0) {
    throw new Error('source manifest must contain at least one camera');
  }
  const sourceReference = sourceManifest.cameras[0]?.source;
  assertPlainObject(sourceReference, 'source manifest camera source');
  let source;
  if (sourceReference.kind === 'path') {
    source = requiredString(sourceReference.path, 'camera source path');
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(source)) {
      throw new Error('credentialed camera sources must use an environment reference');
    }
  } else if (sourceReference.kind === 'env') {
    const environmentName = requiredString(sourceReference.name, 'camera source environment name');
    source = requiredString(baseEnv[environmentName], 'camera source environment value');
  } else {
    throw new Error('camera source kind must be path or env');
  }

  const normalizedAiRepo = requiredString(aiRepo, 'AI repository path').replace(/[\\/]$/u, '');
  return {
    ...baseEnv,
    PYTHONPATH: `${normalizedAiRepo}/src`,
    SMARTSITE_AI_ENVIRONMENT: 'development',
    SMARTSITE_AI_HOST: '127.0.0.1',
    SMARTSITE_AI_PORT: '8000',
    SMARTSITE_AI_BACKEND_INGESTION_URL: requiredString(backendUrl, 'Backend URL'),
    SMARTSITE_AI_BACKEND_SERVICE_TOKEN: requiredString(serviceToken, 'Backend service token'),
    SMARTSITE_AI_REALTIME_MODEL_PATH: requiredString(modelSpec.artifactPath, 'model artifact path'),
    SMARTSITE_AI_REALTIME_SOURCE: source,
    SMARTSITE_AI_REALTIME_DEVICE: requiredString(modelSpec.device, 'model device'),
    SMARTSITE_AI_REALTIME_CONFIDENCE: String(modelSpec.confidenceThreshold),
    SMARTSITE_AI_REALTIME_CAMERA_EXTERNAL_ID: requiredString(
      demoConfiguration.cameraExternalId,
      'camera external ID',
    ),
    SMARTSITE_AI_REALTIME_CLASS_MAP_PATH: requiredString(classMapPath, 'class map path'),
    SMARTSITE_AI_REALTIME_REGION_CONFIGURATION_PATH: requiredString(
      regionConfigurationPath,
      'region configuration path',
    ),
    SMARTSITE_AI_REALTIME_PPE_REGION_ID: requiredString(
      demoConfiguration.ppeRegionId,
      'PPE region ID',
    ),
    SMARTSITE_AI_REALTIME_MODEL_ARTIFACT_ID: requiredString(
      modelSpec.artifactId,
      'model artifact ID',
    ),
    SMARTSITE_AI_REALTIME_MODEL_VERSION: requiredString(modelSpec.version, 'model version'),
    SMARTSITE_AI_REALTIME_MODEL_FAMILY: requiredString(modelSpec.modelFamily, 'model family'),
    SMARTSITE_AI_REALTIME_MODEL_SHA256: requiredString(modelSpec.sha256, 'model SHA-256'),
    SMARTSITE_AI_REALTIME_MODEL_SOURCE_URL: requiredString(modelSpec.sourceUrl, 'model source URL'),
    SMARTSITE_AI_REALTIME_MODEL_LICENSE: requiredString(modelSpec.license, 'model license'),
  };
}

function samePath(left, right) {
  const normalize = (value) => path.resolve(value).replaceAll('\\', '/').toLocaleLowerCase('en-US');
  return normalize(left) === normalize(right);
}

export function validateRuntimeInputs(config, demoConfiguration, sourceManifest) {
  assertPlainObject(config, 'runtime config');
  assertPlainObject(demoConfiguration, 'demo configuration');
  assertPlainObject(sourceManifest, 'source manifest');
  if (sourceManifest.schemaVersion !== '1') {
    throw new Error('source manifest schemaVersion must be "1"');
  }
  if (
    typeof sourceManifest.modelSpec !== 'string' ||
    !samePath(sourceManifest.modelSpec, config.modelSpecPath)
  ) {
    throw new Error('source manifest modelSpec does not match the runtime model spec');
  }
  if (!Array.isArray(sourceManifest.cameras) || sourceManifest.cameras.length !== 1) {
    throw new Error('controlled demo source manifest must contain exactly one camera');
  }
  const camera = sourceManifest.cameras[0];
  assertPlainObject(camera, 'source manifest camera');
  for (const [manifestKey, demoKey] of [
    ['cameraId', 'cameraId'],
    ['cameraExternalId', 'cameraExternalId'],
    ['ppeRegionId', 'ppeRegionId'],
  ]) {
    if (camera[manifestKey] !== demoConfiguration[demoKey]) {
      throw new Error(`source manifest ${manifestKey} does not match demo configuration`);
    }
  }
  return sourceManifest;
}

export function decideStart(state, source, isProcessAlive) {
  if (state?.stage === 'cleanup-required') {
    throw new Error('runtime cleanup is incomplete; run stop before starting again');
  }
  if (!SOURCES.has(source)) {
    throw new Error('source must be one of mp4, laptop, tapo');
  }
  if (!state) {
    return { action: 'start' };
  }
  const apiPid = state.processes?.aiApi?.pid;
  const sourcePid = state.processes?.aiSource?.pid;
  const apiAlive = Number.isSafeInteger(apiPid) && apiPid > 0 && isProcessAlive(apiPid);
  const sourceAlive = Number.isSafeInteger(sourcePid) && sourcePid > 0 && isProcessAlive(sourcePid);
  if (!apiAlive && !sourceAlive) {
    return { action: 'replace-stale-state' };
  }
  if (!apiAlive && sourceAlive) {
    throw new Error('runtime is partially active; stop it before starting again');
  }
  if (state.source === source && apiAlive && sourceAlive) {
    return { action: 'already-running' };
  }
  if (state.source === source && apiAlive && !sourceAlive) {
    return { action: 'restart-source' };
  }
  throw new Error(`stop the ${state.source} runtime first before starting ${source}`);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function validateRuntimeConfig(config) {
  assertPlainObject(config, 'runtime config');

  const unexpected = Object.keys(config).filter((key) => !CONFIG_KEYS.has(key));
  if (unexpected.length > 0) {
    const secretKey = unexpected.find((key) =>
      /password|secret|token|credential|api.?key/iu.test(key),
    );
    if (secretKey) {
      throw new Error('runtime config must not contain secret values; use a credential file path');
    }
    throw new Error(`runtime config contains unsupported field: ${unexpected[0]}`);
  }
  if (config.schemaVersion !== '1') {
    throw new Error('runtime config schemaVersion must be "1"');
  }
  for (const key of REQUIRED_PATH_KEYS) {
    if (typeof config[key] !== 'string' || config[key].trim() === '') {
      throw new Error(`runtime config ${key} must be a non-empty path`);
    }
  }
  for (const key of ['backendUrl', 'webUrl', 'aiUrl']) {
    if (config[key] !== undefined && !/^https?:\/\/[^\s]+$/u.test(config[key])) {
      throw new Error(`runtime config ${key} must be an HTTP(S) URL`);
    }
  }
  assertPlainObject(config.sourceManifests, 'runtime config sourceManifests');
  const manifestKeys = Object.keys(config.sourceManifests);
  if (
    manifestKeys.length !== SOURCES.size ||
    [...SOURCES].some(
      (source) =>
        typeof config.sourceManifests[source] !== 'string' ||
        config.sourceManifests[source].trim() === '',
    )
  ) {
    throw new Error('runtime config sourceManifests must contain mp4, laptop and tapo paths');
  }
  return config;
}

export async function loadRuntimeConfig(configPath) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read runtime config: ${error.message}`, { cause: error });
  }
  return validateRuntimeConfig(parsed);
}
