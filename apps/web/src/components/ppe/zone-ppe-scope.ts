import type { QueryClient } from '@tanstack/react-query';

const tokenNonces = new WeakMap<QueryClient, { token: string; nonce: number }>();
let nextTokenNonce = 1;

export function getOpaqueTokenNonce(client: QueryClient, token: string): number {
  if (!token) {
    tokenNonces.delete(client);
    return 0;
  }
  const previous = tokenNonces.get(client);
  if (previous?.token === token) return previous.nonce;
  const nonce = nextTokenNonce++;
  tokenNonces.set(client, { token, nonce });
  return nonce;
}

/** Credential identity is opaque; raw tokens never become React or query keys. */
export function getZonePpeScopeKey(client: QueryClient, props: {
  apiUrl: string; sessionScope: string; credentialId: number; siteId: string; token: string;
}): string {
  return JSON.stringify([
    props.apiUrl, props.sessionScope, props.credentialId, props.siteId,
    getOpaqueTokenNonce(client, props.token),
  ]);
}
