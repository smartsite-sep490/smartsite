import { afterEach, describe, expect, it, vi } from 'vitest';
import { GateCameraSession } from './gateCameraSession';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  const track = Object.assign(new EventTarget(), {
    stop: vi.fn(),
    getSettings: () => ({ deviceId: 'camera-1' }),
  });
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  const video = { srcObject: null, play: vi.fn().mockResolvedValue(undefined) };
  const ready = vi.fn();
  const failed = vi.fn();
  const mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue(stream),
    enumerateDevices: vi.fn().mockResolvedValue([]),
  };
  vi.stubGlobal('navigator', { mediaDevices });
  const camera = new GateCameraSession({
    video: () => video as unknown as HTMLVideoElement,
    ready,
    failed,
  });
  return { camera, stream, track, video, ready, failed, mediaDevices };
}

afterEach(() => vi.unstubAllGlobals());

describe('Gate Desk camera ownership', () => {
  it('stops an acquisition that completes after the desk closes', async () => {
    const f = fixture();
    const acquisition = deferred<MediaStream>();
    f.mediaDevices.getUserMedia.mockReturnValue(acquisition.promise);
    const started = f.camera.start('');
    f.camera.stop();
    acquisition.resolve(f.stream);
    await started;
    expect(f.track.stop).toHaveBeenCalledOnce();
    expect(f.video.srcObject).toBeNull();
    expect(f.ready).not.toHaveBeenCalled();
  });

  it('keeps the replacement feed when an older camera request finishes late', async () => {
    const f = fixture();
    const old = deferred<MediaStream>();
    const oldTrack = { stop: vi.fn() };
    const oldStream = { getTracks: () => [oldTrack] } as unknown as MediaStream;
    f.mediaDevices.getUserMedia.mockReturnValueOnce(old.promise);
    const pending = f.camera.start('old-device');
    await f.camera.start('new-device');
    old.resolve(oldStream);
    await pending;
    expect(oldTrack.stop).toHaveBeenCalledOnce();
    expect(f.video.srcObject).toBe(f.stream);
    expect(f.ready).toHaveBeenCalledOnce();
    expect(f.track.stop).not.toHaveBeenCalled();
    f.camera.stop();
  });

  it('releases the camera and reports failure if playback fails', async () => {
    const f = fixture();
    f.video.play.mockRejectedValue(new Error('synthetic playback failure'));
    await f.camera.start('');
    expect(f.track.stop).toHaveBeenCalledOnce();
    expect(f.video.srcObject).toBeNull();
    expect(f.failed).toHaveBeenCalledOnce();
    expect(f.ready).not.toHaveBeenCalled();
  });

  it('keeps scanning available when only device enumeration fails', async () => {
    const f = fixture();
    f.mediaDevices.enumerateDevices.mockRejectedValue(new Error('synthetic listing failure'));
    await f.camera.start('');
    expect(f.ready).toHaveBeenCalledWith([], 'camera-1');
    expect(f.failed).not.toHaveBeenCalled();
    f.camera.stop();
  });

  it('reports a disconnected camera and releases the preview', async () => {
    const f = fixture();
    await f.camera.start('');
    f.track.dispatchEvent(new Event('ended'));
    expect(f.failed).toHaveBeenCalledOnce();
    expect(f.video.srcObject).toBeNull();
    expect(f.track.stop).toHaveBeenCalledOnce();
  });

  it('shows a recovery message when camera APIs are unavailable', async () => {
    const f = fixture();
    vi.stubGlobal('navigator', {});
    await f.camera.start('');
    expect(f.failed).toHaveBeenCalledWith(expect.stringContaining('HTTPS'));
    expect(f.ready).not.toHaveBeenCalled();
  });

  it('does not reactivate a closed capture while device enumeration finishes', async () => {
    const f = fixture();
    const devices = deferred<MediaDeviceInfo[]>();
    f.mediaDevices.enumerateDevices.mockReturnValue(devices.promise);
    const started = f.camera.start('');
    await vi.waitFor(() => expect(f.mediaDevices.enumerateDevices).toHaveBeenCalledOnce());
    f.camera.stop();
    devices.resolve([]);
    await started;
    expect(f.ready).not.toHaveBeenCalled();
    expect(f.video.srcObject).toBeNull();
    expect(f.track.stop).toHaveBeenCalledOnce();
  });

  it('shows permission guidance without marking an unavailable camera ready', async () => {
    const f = fixture();
    f.mediaDevices.getUserMedia.mockRejectedValue(
      Object.assign(new Error('synthetic permission denial'), { name: 'NotAllowedError' }),
    );
    await f.camera.start('');
    expect(f.failed).toHaveBeenCalledWith(expect.stringContaining('quyền camera'));
    expect(f.ready).not.toHaveBeenCalled();
    expect(f.video.srcObject).toBeNull();
  });
});
