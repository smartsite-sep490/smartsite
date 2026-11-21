import type {
  CameraSourceKind,
  CameraSourceDraft,
  SourceHost,
  SourceTestResult,
  SourceActivationResult,
  SourceConfigurationResumeCommand,
  SourceConfigurationResumeResult,
} from '@smartsite/contracts';
export type {
  CameraSourceKind,
  CameraSourceDraft,
  SourceHost,
  SourceTestResult,
} from '@smartsite/contracts';
export class SourceSetupError extends Error {
  constructor(readonly status: number) {
    super('Camera source operation failed');
  }
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SourceSetupError(502);
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 128): string => {
  if (typeof value !== 'string' || !value.length || value.length > max)
    throw new SourceSetupError(502);
  return value;
};
const items = (value: unknown) => {
  if (!Array.isArray(value) || value.length > 128) throw new SourceSetupError(502);
  return value.map((v) => {
    const r = record(v);
    return { id: text(r.id), label: text(r.label, 255) };
  });
};
export function parseSourceHosts(value: unknown): SourceHost[] {
  const body = record(value);
  if (!Array.isArray(body.hosts) || body.hosts.length > 16) throw new SourceSetupError(502);
  const hosts = body.hosts.map((row) => {
    const h = record(row),
      id = text(h.id),
      label = text(h.label);
    if (typeof h.available !== 'boolean') throw new SourceSetupError(502);
    if (!h.available) return { id, label, available: false };
    const c = record(h.capabilities);
    if (
      c.schemaVersion !== '1.0.0' ||
      c.hostId !== id ||
      !Array.isArray(c.sourceKinds) ||
      c.sourceKinds.length > 3 ||
      !c.sourceKinds.every((k) => ['WEBCAM', 'RTSP', 'VIDEO'].includes(k)) ||
      typeof c.browserCameraSupported !== 'boolean' ||
      typeof c.applySupported !== 'boolean'
    )
      throw new SourceSetupError(502);
    return {
      id,
      label,
      available: true,
      capabilities: {
        sourceKinds: c.sourceKinds as CameraSourceKind[],
        webcams: items(c.webcams),
        videos: items(c.videos),
        browserCameraSupported: c.browserCameraSupported,
        applySupported: c.applySupported,
        configurationResumeSupported: c.configurationResumeSupported === true,
        sourceRevision:
          Number.isSafeInteger(c.sourceRevision) && Number(c.sourceRevision) >= 0
            ? Number(c.sourceRevision)
            : 0,
      },
    };
  });
  if (new Set(hosts.map((h) => h.id)).size !== hosts.length) throw new SourceSetupError(502);
  return hosts;
}
export function parseSourceTest(value: unknown): SourceTestResult {
  const r = record(value),
    frame = record(r.frame);
  if (
    r.schemaVersion !== '1.0.0' ||
    r.state !== 'TESTED' ||
    !['LIVE', 'REPLAY'].includes(String(r.sourceKind)) ||
    !Number.isInteger(frame.width) ||
    !Number.isInteger(frame.height) ||
    Number(frame.width) < 1 ||
    Number(frame.height) < 1 ||
    Number(frame.width) * Number(frame.height) > 8000000 ||
    !Number.isFinite(Date.parse(String(r.expiresAt))) ||
    !Number.isFinite(Date.parse(String(frame.capturedAt))) ||
    typeof frame.imageDataUrl !== 'string' ||
    !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(frame.imageDataUrl) ||
    frame.imageDataUrl.length > 350000
  )
    throw new SourceSetupError(502);
  return {
    state: 'TESTED',
    receiptId: text(r.receiptId),
    expiresAt: String(r.expiresAt),
    sourceKind: r.sourceKind as 'LIVE' | 'REPLAY',
    frame: {
      width: Number(frame.width),
      height: Number(frame.height),
      capturedAt: String(frame.capturedAt),
      imageDataUrl: frame.imageDataUrl,
    },
  };
}
async function request(
  apiUrl: string,
  token: string,
  path: string,
  signal: AbortSignal,
  body?:
    | CameraSourceDraft
    | SourceConfigurationResumeCommand
    | { commandId: string; receiptId: string; expectedRevision: number },
) {
  const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/api/v1${path}`, {
    method: body ? 'POST' : 'GET',
    signal,
    cache: 'no-store',
    credentials: 'include',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new SourceSetupError(response.status);
  }
  if (response.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    void response.body?.cancel().catch(() => {});
    throw new SourceSetupError(502);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new SourceSetupError(502);
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    while (true) {
      const row = await reader.read();
      if (row.done) break;
      count += row.value.length;
      if (count > 400000) throw new SourceSetupError(502);
      chunks.push(row.value);
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  const all = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(all)) as unknown;
  } catch {
    throw new SourceSetupError(502);
  }
}
export interface CameraSourceClient {
  resume?(
    apiUrl: string,
    token: string,
    siteId: string,
    cameraId: string,
    hostId: string,
    command: SourceConfigurationResumeCommand,
    signal: AbortSignal,
  ): Promise<SourceConfigurationResumeResult>;
  apply?(
    apiUrl: string,
    token: string,
    siteId: string,
    cameraId: string,
    hostId: string,
    command: { commandId: string; receiptId: string; expectedRevision: number },
    signal: AbortSignal,
  ): Promise<SourceActivationResult>;
  hosts(
    apiUrl: string,
    token: string,
    siteId: string,
    cameraId: string,
    signal: AbortSignal,
  ): Promise<SourceHost[]>;
  probe(
    apiUrl: string,
    token: string,
    siteId: string,
    cameraId: string,
    hostId: string,
    draft: CameraSourceDraft,
    signal: AbortSignal,
  ): Promise<SourceTestResult>;
}
export const cameraSourceClient: CameraSourceClient = {
  resume: async (api, token, site, camera, host, command, signal) => {
    const r = record(
      await request(
        api,
        token,
        `/sites/${encodeURIComponent(site)}/cameras/${encodeURIComponent(camera)}/source-hosts/${encodeURIComponent(host)}/resume`,
        signal,
        command,
      ),
    );
    if (
      r.state !== 'STARTED' ||
      r.commandId !== command.commandId ||
      r.sourceRevision !== command.expectedRevision ||
      r.configurationVersion !== command.expectedConfigurationVersion ||
      !Number.isSafeInteger(r.viewRevision) ||
      Number(r.viewRevision) < 1 ||
      typeof r.bundleSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(r.bundleSha256) ||
      typeof r.currentGenerationId !== 'string' ||
      !/^([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(
        r.currentGenerationId,
      )
    )
      throw new SourceSetupError(502);
    return {
      state: 'STARTED',
      commandId: command.commandId,
      sourceRevision: command.expectedRevision,
      currentGenerationId: r.currentGenerationId,
      configurationVersion: command.expectedConfigurationVersion,
      viewRevision: Number(r.viewRevision),
      bundleSha256: r.bundleSha256,
    };
  },
  apply: async (api, token, site, camera, host, command, signal) => {
    const r = record(
      await request(
        api,
        token,
        `/sites/${encodeURIComponent(site)}/cameras/${encodeURIComponent(camera)}/source-hosts/${encodeURIComponent(host)}/apply`,
        signal,
        command,
      ),
    );
    if (
      r.state !== 'RUNNING' ||
      r.commandId !== command.commandId ||
      r.sourceKind !== 'LIVE' ||
      r.sourceRevision !== command.expectedRevision + 1
    )
      throw new SourceSetupError(502);
    return {
      state: 'RUNNING',
      commandId: command.commandId,
      sourceKind: 'LIVE',
      sourceRevision: Number(r.sourceRevision),
      currentGenerationId: text(r.currentGenerationId),
    };
  },
  hosts: async (api, token, site, camera, signal) =>
    parseSourceHosts(
      await request(
        api,
        token,
        `/sites/${encodeURIComponent(site)}/cameras/${encodeURIComponent(camera)}/source-hosts`,
        signal,
      ),
    ),
  probe: async (api, token, site, camera, host, draft, signal) =>
    parseSourceTest(
      await request(
        api,
        token,
        `/sites/${encodeURIComponent(site)}/cameras/${encodeURIComponent(camera)}/source-hosts/${encodeURIComponent(host)}/probe`,
        signal,
        draft,
      ),
    ),
};
