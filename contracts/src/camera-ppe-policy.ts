import { PPE_ITEMS, type PpeItem } from './ppe-items.js';

/** New-mode configuration only; these shapes do not authorize a policy change. */
export type CameraPpePolicy =
  | { readonly mode: 'EXPLICIT'; readonly requiredPpe: readonly PpeItem[] }
  | { readonly mode: 'DISABLED'; readonly reason: string };

export type RegionPpePolicy = CameraPpePolicy | { readonly mode: 'INHERIT' };

export interface PpePolicyContribution {
  /** Index in the supplied containing bindings; null denotes camera fallback. */
  readonly bindingIndex: number | null;
  readonly mode: RegionPpePolicy['mode'];
  readonly source: 'CAMERA_DEFAULT' | 'REGION';
  readonly requiredPpe: readonly PpeItem[];
}

export interface ResolvedLocationPpePolicy {
  readonly scope: 'CAMERA' | 'REGIONS';
  readonly requiredPpe: readonly PpeItem[];
  readonly contributions: readonly PpePolicyContribution[];
}

function object(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

/** Returns detached, canonically ordered values; invalid/legacy input never means DISABLED. */
export function parseRegionPpePolicy(value: unknown): RegionPpePolicy | null {
  if (!object(value)) return null;
  if (value.mode === 'INHERIT') return exact(value, ['mode']) ? { mode: 'INHERIT' } : null;
  if (value.mode === 'DISABLED') {
    if (!exact(value, ['mode', 'reason']) || typeof value.reason !== 'string') return null;
    const reason = value.reason.trim();
    if (!reason || value.reason.length > 500 || /[\p{Cc}\p{Cs}]/u.test(value.reason)) return null;
    return { mode: 'DISABLED', reason };
  }
  if (value.mode !== 'EXPLICIT' || !exact(value, ['mode', 'requiredPpe'])) return null;
  const items = value.requiredPpe;
  if (
    !Array.isArray(items) ||
    items.length < 1 ||
    items.length > PPE_ITEMS.length ||
    new Set(items).size !== items.length ||
    ![...items].every((item) => PPE_ITEMS.includes(item))
  )
    return null;
  return { mode: 'EXPLICIT', requiredPpe: [...items].sort() };
}

export function parseCameraPpePolicy(value: unknown): CameraPpePolicy | null {
  const policy = parseRegionPpePolicy(value);
  return policy?.mode === 'INHERIT' ? null : policy;
}

function contribution(
  policy: CameraPpePolicy,
  bindingIndex: number | null,
  mode: RegionPpePolicy['mode'],
  source: PpePolicyContribution['source'],
): PpePolicyContribution {
  return {
    bindingIndex,
    mode,
    source,
    requiredPpe: policy.mode === 'EXPLICIT' ? [...policy.requiredPpe] : [],
  };
}

/**
 * Backend supplies all and only bindings whose polygons contain the subject.
 * This does not compute geometry, authenticate scope, prove revisions, emit a
 * finding, or turn unsupported/unobservable PPE into MISSING.
 */
export function resolvePpePolicyAtLocation(
  cameraPolicy: CameraPpePolicy,
  containingPolicies: readonly RegionPpePolicy[],
): ResolvedLocationPpePolicy {
  const camera = parseCameraPpePolicy(cameraPolicy);
  if (!camera || !Array.isArray(containingPolicies) || containingPolicies.length > 64)
    throw new Error('Invalid location PPE policy');
  const contributions: PpePolicyContribution[] = [];
  if (containingPolicies.length === 0) {
    contributions.push(contribution(camera, null, camera.mode, 'CAMERA_DEFAULT'));
  } else {
    // for..of also visits array holes, which must not silently omit a binding.
    for (const [index, input] of containingPolicies.entries()) {
      const policy = parseRegionPpePolicy(input);
      if (!policy) throw new Error('Invalid location PPE policy');
      contributions.push(
        policy.mode === 'INHERIT'
          ? contribution(camera, index, policy.mode, 'CAMERA_DEFAULT')
          : contribution(policy, index, policy.mode, 'REGION'),
      );
    }
  }
  return {
    scope: containingPolicies.length === 0 ? 'CAMERA' : 'REGIONS',
    requiredPpe: [...new Set(contributions.flatMap((value) => value.requiredPpe))].sort(),
    contributions,
  };
}
