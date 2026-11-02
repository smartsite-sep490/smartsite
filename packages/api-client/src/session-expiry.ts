// Browser-only in-memory bindings. Credentials never enter events, storage or
// query keys. Capture scopes before starting a request, including when the same
// token string is reused by a later provider/session.
const activeScopes = new Map<string, Set<string>>();

export function registerSessionCredential(token: string, scope: string): void {
  const scopes = activeScopes.get(token) ?? new Set<string>();
  scopes.add(scope);
  activeScopes.set(token, scopes);
}

export function unregisterSessionCredential(token: string, scope: string): void {
  const scopes = activeScopes.get(token);
  scopes?.delete(scope);
  if (scopes?.size === 0) activeScopes.delete(token);
}

export function captureSessionScopes(token?: string): readonly string[] {
  return token ? [...(activeScopes.get(token) ?? [])] : [];
}

export function dispatchSessionExpired(scopes: readonly string[]): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('smartsite:session-expired', { detail: { sessionScopes: scopes } }),
  );
}
