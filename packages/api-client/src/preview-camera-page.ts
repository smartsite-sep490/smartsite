import type { CameraResponse, Page } from '@smartsite/contracts/management';

/** Validate the read-only preview projection before it reaches a scoped selector. */
export function parsePreviewCameraPage(
  value: unknown,
  siteId: string,
  limit: number,
): Page<CameraResponse> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!value || typeof value !== 'object') throw new Error('Invalid preview camera page');
  const page = value as Page<CameraResponse>;
  if (
    !Array.isArray(page.items) ||
    page.items.length > limit ||
    !Number.isSafeInteger(page.total) ||
    page.total < page.items.length ||
    page.total < 0
  ) {
    throw new Error('Invalid preview camera page');
  }
  const seen = new Set<string>();
  for (const camera of page.items) {
    if (
      !camera ||
      typeof camera !== 'object' ||
      typeof camera.id !== 'string' ||
      !uuid.test(camera.id) ||
      typeof camera.siteId !== 'string' ||
      camera.siteId.toLowerCase() !== siteId.toLowerCase() ||
      !['ACTIVE', 'INACTIVE'].includes(camera.status) ||
      !Number.isSafeInteger(camera.configurationVersion) ||
      camera.configurationVersion < 1 ||
      typeof camera.code !== 'string' ||
      typeof camera.name !== 'string' ||
      typeof camera.externalId !== 'string' ||
      !camera.externalId ||
      typeof camera.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(camera.createdAt)) ||
      seen.has(camera.id.toLowerCase())
    )
      throw new Error('Invalid scoped preview camera');
    seen.add(camera.id.toLowerCase());
  }
  return page;
}
