import { useCallback, useEffect, useRef, useState } from 'react';
import {
  browserCameraUplinkClient,
  BrowserCameraUplinkError,
  type BrowserCameraUplinkClient,
} from '@smartsite/api-client';
import {
  BROWSER_CAMERA_UPLINK_DEFAULT_INTERVAL_MS,
  BROWSER_CAMERA_UPLINK_DEFAULT_MAX_FRAME_BYTES,
  BROWSER_CAMERA_UPLINK_DEFAULT_MAX_HEIGHT,
  BROWSER_CAMERA_UPLINK_DEFAULT_MAX_WIDTH,
  BROWSER_CAMERA_UPLINK_MIN_INTERVAL_MS,
  type BrowserCameraUplinkStartResponse,
  type BrowserCameraUplinkStopReason,
} from '@smartsite/contracts/browser-camera-uplink';
import {
  acquireBrowserCameraStream,
  BrowserCameraCaptureError,
  encodeVideoFrameToJpeg,
  enumerateBrowserVideoDevices,
  releaseBrowserCameraStream,
  type BrowserCameraDevice,
  type EncodedBrowserFrame,
} from './browserCameraCapture';

export type BrowserCameraUplinkPhase =
  'idle' | 'starting' | 'uploading' | 'stopping' | 'stopped' | 'lease-held' | 'error' | 'revoked';

export type BrowserCameraUplinkIssue =
  | 'UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'DEVICE_BUSY'
  | 'TRACK_ENDED'
  | 'LEASE_HELD'
  | 'LEASE_EXPIRED'
  | 'FRAME_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'UPLOAD_FAILED'
  | null;

export type BrowserCameraFrameEncoder = (
  video: HTMLVideoElement,
  limits: { maxWidth: number; maxHeight: number; maxBytes: number },
) => Promise<EncodedBrowserFrame>;

export interface UseBrowserCameraUplinkOptions {
  apiUrl: string;
  token: string;
  siteId: string;
  cameraId: string;
  supported: boolean;
  canWrite: boolean;
  cameraInactive: boolean;
  onRevoked: () => void;
  client?: BrowserCameraUplinkClient;
  frameEncoder?: BrowserCameraFrameEncoder;
}

export interface BrowserCameraUplinkController {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  phase: BrowserCameraUplinkPhase;
  issue: BrowserCameraUplinkIssue;
  devices: BrowserCameraDevice[];
  selectedDeviceId: string;
  selectDeviceId: (deviceId: string) => void;
  framesUploaded: number;
  framesDropped: number;
  lastAcceptedAt: string | null;
  intervalMs: number;
  start: () => Promise<void>;
  stop: (reason?: BrowserCameraUplinkStopReason, keepalive?: boolean) => Promise<void>;
}

const defaultFrameEncoder: BrowserCameraFrameEncoder = (video, limits) =>
  encodeVideoFrameToJpeg(video, limits);

export function useBrowserCameraUplink({
  apiUrl,
  token,
  siteId,
  cameraId,
  supported,
  canWrite,
  cameraInactive,
  onRevoked,
  client = browserCameraUplinkClient,
  frameEncoder = defaultFrameEncoder,
}: UseBrowserCameraUplinkOptions): BrowserCameraUplinkController {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const attachedVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackEndedListenerRef = useRef<(() => void) | null>(null);
  const leaseRef = useRef<BrowserCameraUplinkStartResponse | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const startingRef = useRef(false);
  const sequenceRef = useRef(0);
  const inFlightRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingStopRef = useRef<Promise<void> | null>(null);
  const eligibleRef = useRef(supported && canWrite && !cameraInactive);
  const scopeResetNeededRef = useRef(false);

  const [phase, setPhase] = useState<BrowserCameraUplinkPhase>('idle');
  const [issue, setIssue] = useState<BrowserCameraUplinkIssue>(null);
  const [devices, setDevices] = useState<BrowserCameraDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [framesUploaded, setFramesUploaded] = useState(0);
  const [framesDropped, setFramesDropped] = useState(0);
  const [lastAcceptedAt, setLastAcceptedAt] = useState<string | null>(null);
  const [intervalMs, setIntervalMs] = useState(BROWSER_CAMERA_UPLINK_DEFAULT_INTERVAL_MS);

  const clearTimerAndAbort = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
  }, []);

  const releaseLocalMedia = useCallback(() => {
    const currentStream = streamRef.current;
    const endedCb = trackEndedListenerRef.current;
    if (currentStream && endedCb) {
      for (const track of currentStream.getVideoTracks()) {
        track.removeEventListener('ended', endedCb);
      }
    }
    trackEndedListenerRef.current = null;
    streamRef.current = null;
    const targetVideo = videoRef.current ?? attachedVideoRef.current;
    attachedVideoRef.current = null;
    releaseBrowserCameraStream(currentStream, targetVideo);
  }, []);

  const stopLeaseBestEffort = useCallback(
    async (leaseId: string, reason: BrowserCameraUplinkStopReason, keepalive: boolean) => {
      const stopPromise = client
        .stop(apiUrl, token, siteId, cameraId, { leaseId, reason }, { keepalive })
        .then(
          () => undefined,
          () => undefined, // Teardown is best-effort; backend lease TTL bounds orphaned state.
        )
        .finally(() => {
          if (pendingStopRef.current === stopPromise) {
            pendingStopRef.current = null;
          }
        });
      if (!keepalive) {
        pendingStopRef.current = stopPromise;
      }
      await stopPromise;
    },
    [apiUrl, cameraId, client, siteId, token],
  );

  const teardownAndNotifyStop = useCallback(
    async (
      reason: BrowserCameraUplinkStopReason,
      keepalive: boolean,
      nextPhase?: BrowserCameraUplinkPhase,
      nextIssue?: BrowserCameraUplinkIssue,
    ) => {
      const generation = ++generationRef.current;
      startingRef.current = false;
      clearTimerAndAbort();
      releaseLocalMedia();

      const activeLease = leaseRef.current;
      leaseRef.current = null;
      sequenceRef.current = 0;

      const deferStoppedPhase = Boolean(nextPhase === 'stopped' && !keepalive && activeLease);
      if (nextPhase && !deferStoppedPhase) {
        setPhase(nextPhase);
        setIssue(nextIssue ?? null);
      }

      if (activeLease) {
        await stopLeaseBestEffort(activeLease.leaseId, reason, keepalive);
      }

      if (deferStoppedPhase && generation === generationRef.current) {
        setPhase(nextPhase!);
        setIssue(nextIssue ?? null);
      }
    },
    [clearTimerAndAbort, releaseLocalMedia, stopLeaseBestEffort],
  );

  const stop = useCallback(
    async (reason: BrowserCameraUplinkStopReason = 'USER_STOPPED', keepalive = false) => {
      const hadMediaOrLease = leaseRef.current !== null || streamRef.current !== null;
      const wasStarting = startingRef.current;
      if (!hadMediaOrLease && !wasStarting) {
        setPhase('idle');
        setIssue(null);
        return;
      }
      if (!keepalive && hadMediaOrLease) {
        setPhase('stopping');
      }
      const nextPhase: BrowserCameraUplinkPhase = hadMediaOrLease ? 'stopped' : 'idle';
      await teardownAndNotifyStop(reason, keepalive, nextPhase, null);
    },
    [teardownAndNotifyStop],
  );

  const pushSingleFrame = useCallback(
    async (generation: number, lease: BrowserCameraUplinkStartResponse) => {
      if (
        generation !== generationRef.current ||
        leaseRef.current?.leaseId !== lease.leaseId ||
        !eligibleRef.current
      ) {
        return;
      }
      if (inFlightRef.current) {
        setFramesDropped((count) => count + 1);
        return;
      }
      const video = videoRef.current;
      if (!video) return;

      inFlightRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        if (!canvasRef.current && typeof document !== 'undefined') {
          canvasRef.current = document.createElement('canvas');
        }
        const encoded =
          frameEncoder === defaultFrameEncoder
            ? await encodeVideoFrameToJpeg(video, {
                maxWidth: lease.maxWidth,
                maxHeight: lease.maxHeight,
                maxBytes: lease.maxFrameBytes,
                canvas: canvasRef.current ?? undefined,
              })
            : await frameEncoder(video, {
                maxWidth: lease.maxWidth,
                maxHeight: lease.maxHeight,
                maxBytes: lease.maxFrameBytes,
              });
        if (
          generation !== generationRef.current ||
          controller.signal.aborted ||
          !eligibleRef.current
        ) {
          return;
        }

        const nextSeq = sequenceRef.current + 1;
        sequenceRef.current = nextSeq;
        const receipt = await client.uploadFrame(
          apiUrl,
          token,
          siteId,
          cameraId,
          {
            leaseId: lease.leaseId,
            sequence: nextSeq,
            capturedAt: new Date().toISOString(),
            width: encoded.width,
            height: encoded.height,
            jpegBytes: encoded.jpegBytes,
          },
          controller.signal,
        );
        if (
          generation !== generationRef.current ||
          controller.signal.aborted ||
          !eligibleRef.current
        ) {
          return;
        }
        setFramesUploaded(receipt.sequence);
        setLastAcceptedAt(receipt.acceptedAt);
        setIssue((current) =>
          current === 'RATE_LIMITED' || current === 'FRAME_TOO_LARGE' || current === 'UPLOAD_FAILED'
            ? null
            : current,
        );
      } catch (err) {
        if (generation !== generationRef.current || controller.signal.aborted) return;
        if (err instanceof BrowserCameraCaptureError) {
          if (err.code === 'VIDEO_NOT_READY') {
            return;
          }
          if (err.code === 'FRAME_TOO_LARGE') {
            setIssue('FRAME_TOO_LARGE');
            return;
          }
          setIssue('UPLOAD_FAILED');
          return;
        }
        if (err instanceof BrowserCameraUplinkError) {
          if (err.status === 401 || err.status === 403) {
            generationRef.current += 1;
            startingRef.current = false;
            clearTimerAndAbort();
            releaseLocalMedia();
            leaseRef.current = null;
            setPhase('revoked');
            setIssue(null);
            onRevoked();
            return;
          }
          if (err.status === 409 || err.code === 'LEASE_HELD') {
            await teardownAndNotifyStop('CLIENT_ERROR', false, 'lease-held', 'LEASE_HELD');
            return;
          }
          if (err.code === 'LEASE_EXPIRED' || err.code === 'LEASE_NOT_FOUND') {
            await teardownAndNotifyStop('CLIENT_ERROR', false, 'error', 'LEASE_EXPIRED');
            return;
          }
          if (err.code === 'RATE_LIMITED' || err.status === 429) {
            setIssue('RATE_LIMITED');
            return;
          }
        }
        setIssue('UPLOAD_FAILED');
      } finally {
        if (abortRef.current === controller) {
          inFlightRef.current = false;
          abortRef.current = null;
        }
      }
    },
    [
      apiUrl,
      cameraId,
      clearTimerAndAbort,
      client,
      frameEncoder,
      onRevoked,
      releaseLocalMedia,
      siteId,
      teardownAndNotifyStop,
      token,
    ],
  );

  const start = useCallback(async () => {
    if (!supported || !canWrite || cameraInactive) return;

    // Claim generation ownership synchronously before awaiting stop or media acquisition.
    const generation = ++generationRef.current;
    startingRef.current = true;
    clearTimerAndAbort();
    releaseLocalMedia();
    const previousLease = leaseRef.current;
    leaseRef.current = null;
    sequenceRef.current = 0;

    setPhase('starting');
    setIssue(null);
    setFramesUploaded(0);
    setFramesDropped(0);
    setLastAcceptedAt(null);

    if (previousLease) {
      await stopLeaseBestEffort(previousLease.leaseId, 'SOURCE_SWITCHED', false);
    } else if (pendingStopRef.current) {
      await pendingStopRef.current;
    }

    if (generation !== generationRef.current || !eligibleRef.current) {
      if (generation === generationRef.current) {
        startingRef.current = false;
        setPhase('idle');
      }
      return;
    }

    try {
      const stream = await acquireBrowserCameraStream({
        deviceId: selectedDeviceId || undefined,
        maxWidth: BROWSER_CAMERA_UPLINK_DEFAULT_MAX_WIDTH,
        maxHeight: BROWSER_CAMERA_UPLINK_DEFAULT_MAX_HEIGHT,
      });
      if (generation !== generationRef.current || !eligibleRef.current) {
        releaseBrowserCameraStream(stream);
        if (generation === generationRef.current) {
          startingRef.current = false;
          setPhase('idle');
        }
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        attachedVideoRef.current = video;
        await video.play();
      }
      if (generation !== generationRef.current || !eligibleRef.current) {
        if (streamRef.current === stream) {
          releaseLocalMedia();
        } else {
          releaseBrowserCameraStream(stream);
        }
        if (generation === generationRef.current) {
          startingRef.current = false;
          setPhase('idle');
        }
        return;
      }

      const enumerated = await enumerateBrowserVideoDevices();
      if (generation !== generationRef.current || !eligibleRef.current) {
        if (streamRef.current === stream) {
          releaseLocalMedia();
        } else {
          releaseBrowserCameraStream(stream);
        }
        if (generation === generationRef.current) {
          startingRef.current = false;
          setPhase('idle');
        }
        return;
      }
      setDevices(enumerated);
      const activeTrack = stream.getVideoTracks()[0];
      const activeDeviceId = activeTrack?.getSettings?.().deviceId ?? selectedDeviceId;
      if (activeDeviceId) {
        setSelectedDeviceId(activeDeviceId);
      }
      const matchedLabel =
        enumerated.find((item) => item.deviceId === activeDeviceId)?.label ?? undefined;

      if (!sessionIdRef.current) {
        sessionIdRef.current =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `browser-uplink-${Date.now()}`;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      const started = await client.start(
        apiUrl,
        token,
        siteId,
        cameraId,
        {
          clientSessionId: sessionIdRef.current,
          ...(matchedLabel ? { deviceLabel: matchedLabel } : {}),
          targetIntervalMs: BROWSER_CAMERA_UPLINK_DEFAULT_INTERVAL_MS,
        },
        controller.signal,
      );
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      if (
        generation !== generationRef.current ||
        controller.signal.aborted ||
        !eligibleRef.current
      ) {
        if (streamRef.current === stream) {
          releaseLocalMedia();
        } else {
          releaseBrowserCameraStream(stream);
        }
        if (generation === generationRef.current) {
          startingRef.current = false;
          setPhase('idle');
        }
        void stopLeaseBestEffort(started.leaseId, 'SOURCE_SWITCHED', true);
        return;
      }

      const handleTrackEnded = () => {
        if (generation !== generationRef.current) return;
        void teardownAndNotifyStop('TRACK_ENDED', true, 'error', 'TRACK_ENDED');
      };
      trackEndedListenerRef.current = handleTrackEnded;
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', handleTrackEnded);
      }

      leaseRef.current = started;
      sequenceRef.current = 0;
      startingRef.current = false;
      const effectiveInterval = Math.max(
        BROWSER_CAMERA_UPLINK_MIN_INTERVAL_MS,
        started.recommendedIntervalMs || BROWSER_CAMERA_UPLINK_DEFAULT_INTERVAL_MS,
      );
      setIntervalMs(effectiveInterval);
      setPhase('uploading');
      setIssue(null);

      // Push first frame immediately, then maintain bounded cadence with 1-in-flight backpressure.
      void pushSingleFrame(generation, started);
      timerRef.current = setInterval(() => {
        void pushSingleFrame(generation, started);
      }, effectiveInterval);
    } catch (err) {
      if (abortRef.current && generation === generationRef.current) {
        abortRef.current = null;
      }
      if (generation !== generationRef.current) return;
      startingRef.current = false;
      clearTimerAndAbort();
      releaseLocalMedia();
      leaseRef.current = null;

      if (err instanceof BrowserCameraCaptureError) {
        setPhase('error');
        setIssue(
          err.code === 'UNSUPPORTED' ||
            err.code === 'PERMISSION_DENIED' ||
            err.code === 'NOT_FOUND' ||
            err.code === 'DEVICE_BUSY'
            ? err.code
            : 'UPLOAD_FAILED',
        );
        return;
      }

      if (err instanceof BrowserCameraUplinkError) {
        if (err.status === 401 || err.status === 403) {
          setPhase('revoked');
          setIssue(null);
          onRevoked();
          return;
        }
        if (err.status === 409 || err.code === 'LEASE_HELD') {
          setPhase('lease-held');
          setIssue('LEASE_HELD');
          return;
        }
        if (err.code === 'RATE_LIMITED' || err.status === 429) {
          setPhase('error');
          setIssue('RATE_LIMITED');
          return;
        }
      }

      setPhase('error');
      setIssue('UPLOAD_FAILED');
    }
  }, [
    apiUrl,
    cameraId,
    cameraInactive,
    canWrite,
    clearTimerAndAbort,
    client,
    onRevoked,
    pushSingleFrame,
    releaseLocalMedia,
    selectedDeviceId,
    siteId,
    stopLeaseBestEffort,
    supported,
    teardownAndNotifyStop,
    token,
  ]);

  // Immediately stop capture, timer, and lease if capability, write access, or camera active state drops mid-stream.
  useEffect(() => {
    const eligible = supported && canWrite && !cameraInactive;
    eligibleRef.current = eligible;
    if (eligible) return;
    const isActive =
      leaseRef.current !== null ||
      streamRef.current !== null ||
      startingRef.current ||
      phase === 'starting' ||
      phase === 'uploading';
    if (!isActive) return;
    const reason: BrowserCameraUplinkStopReason = !canWrite ? 'AUTH_REVOKED' : 'SOURCE_SWITCHED';
    void teardownAndNotifyStop(reason, false, 'stopped', null);
  }, [supported, canWrite, cameraInactive, phase, teardownAndNotifyStop]);

  // Reliable unload cleanup using Fetch keepalive:true + Authorization header (sendBeacon cannot carry Bearer auth).
  useEffect(() => {
    const onPageHide = () => {
      if (!leaseRef.current && !streamRef.current && !startingRef.current) return;
      void teardownAndNotifyStop('PAGE_HIDDEN', true);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [teardownAndNotifyStop]);

  // Guaranteed stream + lease teardown on unmount or scope change.
  useEffect(() => {
    if (scopeResetNeededRef.current) {
      scopeResetNeededRef.current = false;
      void Promise.resolve().then(() => {
        setPhase((current) =>
          current === 'starting' || current === 'uploading' || current === 'stopping'
            ? 'stopped'
            : current,
        );
        setIssue(null);
      });
    }
    const videoEl = videoRef.current;
    return () => {
      const wasActive =
        leaseRef.current !== null || streamRef.current !== null || startingRef.current;
      generationRef.current += 1;
      startingRef.current = false;
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      abortRef.current?.abort();
      abortRef.current = null;
      inFlightRef.current = false;

      const currentStream = streamRef.current;
      const endedCb = trackEndedListenerRef.current;
      if (currentStream && endedCb) {
        for (const track of currentStream.getVideoTracks()) {
          track.removeEventListener('ended', endedCb);
        }
      }
      trackEndedListenerRef.current = null;
      streamRef.current = null;
      const targetVideo = attachedVideoRef.current ?? videoEl;
      attachedVideoRef.current = null;
      releaseBrowserCameraStream(currentStream, targetVideo);

      const activeLease = leaseRef.current;
      leaseRef.current = null;
      if (wasActive) {
        scopeResetNeededRef.current = true;
      }
      if (activeLease) {
        void client
          .stop(
            apiUrl,
            token,
            siteId,
            cameraId,
            { leaseId: activeLease.leaseId, reason: 'SOURCE_SWITCHED' },
            { keepalive: true },
          )
          .catch(() => {});
      }
    };
  }, [apiUrl, cameraId, client, siteId, token]);

  const selectDeviceId = useCallback(
    (nextId: string) => {
      setSelectedDeviceId(nextId);
      if (leaseRef.current || streamRef.current || startingRef.current) {
        void stop('SOURCE_SWITCHED', false);
      }
    },
    [stop],
  );

  return {
    videoRef,
    phase,
    issue,
    devices,
    selectedDeviceId,
    selectDeviceId,
    framesUploaded,
    framesDropped,
    lastAcceptedAt,
    intervalMs,
    start,
    stop,
  };
}

export const BROWSER_CAMERA_UPLINK_DEFAULT_BOUNDS = {
  maxWidth: BROWSER_CAMERA_UPLINK_DEFAULT_MAX_WIDTH,
  maxHeight: BROWSER_CAMERA_UPLINK_DEFAULT_MAX_HEIGHT,
  maxBytes: BROWSER_CAMERA_UPLINK_DEFAULT_MAX_FRAME_BYTES,
  intervalMs: BROWSER_CAMERA_UPLINK_DEFAULT_INTERVAL_MS,
} as const;
