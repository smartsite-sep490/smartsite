/** Transport receipt only; it does not admit a tracked frame or establish identity. */
export interface AiFrameEvidenceReceipt {
  schemaVersion: '1.0.0';
  kind: 'EVIDENCE_STORED';
  eventId: string;
  payloadHash: string;
  bindingHash: string;
  sha256: string;
}
