import type { RegionResponse } from './management-api.js';

/**
 * Region manual geometry confirmation provenance contract.
 * Separate from camera `viewValidity: 'UNCONFIRMED'` and runtime worker ACK (`LOADED`).
 * `NEEDS_REVALIDATION` reflects a retired viewRevision, not authoring reference TTL expiry.
 */
export type RegionGeometryConfirmationStatus =
  'MANUALLY_CONFIRMED' | 'NEEDS_REVALIDATION' | 'UNCONFIRMED';

export interface UnconfirmedRegionGeometryConfirmation {
  readonly status: 'UNCONFIRMED';
  readonly referenceId: null;
  readonly viewRevision: null;
  readonly confirmedByUserId: null;
  readonly confirmedAt: null;
}

export interface ConfirmedRegionGeometryConfirmation {
  readonly status: 'MANUALLY_CONFIRMED' | 'NEEDS_REVALIDATION';
  readonly referenceId: string;
  readonly viewRevision: number;
  readonly confirmedByUserId: string;
  readonly confirmedAt: string;
}

export type RegionGeometryConfirmation =
  UnconfirmedRegionGeometryConfirmation | ConfirmedRegionGeometryConfirmation;

export type ConfirmedRegionResponse = Readonly<RegionResponse> & {
  readonly geometryConfirmation: RegionGeometryConfirmation;
};

export interface ReferenceRegionMutationResponse {
  readonly region: ConfirmedRegionResponse;
  readonly configurationVersion: number;
}

const confirmationKeys = [
  'status',
  'referenceId',
  'viewRevision',
  'confirmedByUserId',
  'confirmedAt',
] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const isLowercaseUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
function check(condition: unknown): asserts condition {
  if (!condition) throw new Error('Invalid region geometry confirmation');
}

function validateUtcIsoTimestamp(value: unknown): asserts value is string {
  check(typeof value === 'string' && value.length === 24);
  const time = Date.parse(value);
  check(Number.isFinite(time) && new Date(time).toISOString() === value);
}
export function parseRegionGeometryConfirmation(value: unknown): RegionGeometryConfirmation {
  check(isPlainObject(value));
  check(
    Reflect.ownKeys(value).length === confirmationKeys.length &&
      confirmationKeys.every((key) => Object.hasOwn(value, key)),
  );
  if (value.status === 'UNCONFIRMED') {
    check(
      value.referenceId === null &&
        value.viewRevision === null &&
        value.confirmedByUserId === null &&
        value.confirmedAt === null,
    );
    return {
      status: 'UNCONFIRMED',
      referenceId: null,
      viewRevision: null,
      confirmedByUserId: null,
      confirmedAt: null,
    };
  }
  check(value.status === 'MANUALLY_CONFIRMED' || value.status === 'NEEDS_REVALIDATION');
  check(isLowercaseUuid(value.referenceId) && isLowercaseUuid(value.confirmedByUserId));
  check(isPositiveSafeInteger(value.viewRevision));
  validateUtcIsoTimestamp(value.confirmedAt);
  return {
    status: value.status,
    referenceId: value.referenceId,
    viewRevision: value.viewRevision,
    confirmedByUserId: value.confirmedByUserId,
    confirmedAt: value.confirmedAt,
  };
}
