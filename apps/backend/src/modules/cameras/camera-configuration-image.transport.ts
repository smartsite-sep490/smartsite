import { fetchBoundedJson } from '../../common/http/fetch-bounded-json.js';

/** Purpose-specific JSON budget; no producer/camera lifecycle side effects. */
export function fetchConfigurationImageJson(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit & { signal: AbortSignal },
): Promise<unknown> {
  return fetchBoundedJson(fetcher, url, init, 1_500_000);
}
