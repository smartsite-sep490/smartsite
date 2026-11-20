export type CameraSourceKind = 'WEBCAM' | 'RTSP' | 'VIDEO';
export type CameraSourceDraft =
  | { kind: 'WEBCAM'; deviceId: string }
  | { kind: 'VIDEO'; assetId: string }
  | { kind: 'RTSP'; endpoint: string; username?: string; password?: string };
export interface SourceHost {
  id: string;
  label: string;
  available: boolean;
  capabilities?: {
    sourceKinds: CameraSourceKind[];
    webcams: { id: string; label: string }[];
    videos: { id: string; label: string }[];
    browserCameraSupported: boolean;
    applySupported: boolean;
    sourceRevision?: number;
  };
}
export interface SourceActivationResult {
  state: 'RUNNING';
  commandId: string;
  sourceRevision: number;
  sourceKind: 'LIVE';
  currentGenerationId: string;
}
export interface SourceTestResult {
  state: 'TESTED';
  receiptId: string;
  expiresAt: string;
  sourceKind: 'LIVE' | 'REPLAY';
  frame: { width: number; height: number; capturedAt: string; imageDataUrl: string };
}
