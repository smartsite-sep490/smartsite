import {
  parseCameraPpePolicy,
  parseRegionPpePolicy,
  type CameraPpePolicy,
  type RegionPpePolicy,
} from './camera-ppe-policy.js';

/** Shape only. Backend validates actor/target scope, revision and replay in one transaction. */
export interface PpePolicyChangeCommand<TPolicy extends RegionPpePolicy> {
  readonly commandId: string;
  readonly expectedConfigurationVersion: number;
  readonly policy: TPolicy;
}

export type CameraPpePolicyChangeCommand = PpePolicyChangeCommand<CameraPpePolicy>;
export type RegionPpePolicyChangeCommand = PpePolicyChangeCommand<RegionPpePolicy>;

/** First v2 adoption requires explicit choices for all currently active Regions. */
export interface InitializeCameraPpePolicyCommand extends CameraPpePolicyChangeCommand {
  readonly regionPolicies: readonly {
    readonly regionId: string;
    readonly policy: RegionPpePolicy;
  }[];
}

export function parseInitializeCameraPpePolicyCommand(
  value: unknown,
): InitializeCameraPpePolicyCommand | null {
  if (
    !value ||
    typeof value !== 'object' ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    return null;
  const input = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(input).length !== 4 ||
    !['commandId', 'expectedConfigurationVersion', 'policy', 'regionPolicies'].every((key) =>
      Object.hasOwn(input, key),
    )
  )
    return null;
  const base = parseCameraPpePolicyChangeCommand({
    commandId: input.commandId,
    expectedConfigurationVersion: input.expectedConfigurationVersion,
    policy: input.policy,
  });
  if (!base || !Array.isArray(input.regionPolicies) || input.regionPolicies.length > 64)
    return null;
  const bindings: { regionId: string; policy: RegionPpePolicy }[] = [];
  const ids = new Set<string>();
  for (const binding of input.regionPolicies) {
    if (
      !binding ||
      typeof binding !== 'object' ||
      (Object.getPrototypeOf(binding) !== Object.prototype &&
        Object.getPrototypeOf(binding) !== null) ||
      Reflect.ownKeys(binding).length !== 2 ||
      !Object.hasOwn(binding, 'regionId') ||
      !Object.hasOwn(binding, 'policy') ||
      typeof binding.regionId !== 'string' ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(binding.regionId) ||
      ids.has(binding.regionId)
    )
      return null;
    const policy = parseRegionPpePolicy(binding.policy);
    if (!policy) return null;
    ids.add(binding.regionId);
    bindings.push({ regionId: binding.regionId, policy });
  }
  bindings.sort((a, b) => a.regionId.localeCompare(b.regionId));
  return { ...base, regionPolicies: bindings };
}

const keys = ['commandId', 'expectedConfigurationVersion', 'policy'] as const;

function parse<TPolicy extends RegionPpePolicy>(
  value: unknown,
  parsePolicy: (policy: unknown) => TPolicy | null,
): PpePolicyChangeCommand<TPolicy> | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    return null;
  const input = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(input).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(input, key)) ||
    typeof input.commandId !== 'string' ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(input.commandId) ||
    typeof input.expectedConfigurationVersion !== 'number' ||
    !Number.isSafeInteger(input.expectedConfigurationVersion) ||
    input.expectedConfigurationVersion < 1
  )
    return null;
  const policy = parsePolicy(input.policy);
  return policy
    ? {
        commandId: input.commandId,
        expectedConfigurationVersion: input.expectedConfigurationVersion,
        policy,
      }
    : null;
}

export function parseCameraPpePolicyChangeCommand(
  value: unknown,
): CameraPpePolicyChangeCommand | null {
  return parse(value, parseCameraPpePolicy);
}

export function parseRegionPpePolicyChangeCommand(
  value: unknown,
): RegionPpePolicyChangeCommand | null {
  return parse(value, parseRegionPpePolicy);
}
