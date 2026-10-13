interface GateCameraCallbacks {
  video: () => HTMLVideoElement | null;
  ready: (devices: MediaDeviceInfo[], deviceId: string) => void;
  failed: (message: string) => void;
}

/** Owns a webcam stream, including acquisitions that finish after a restart. */
export class GateCameraSession {
  private generation = 0;
  private stream: MediaStream | null = null;
  private ended: (() => void) | null = null;

  constructor(private readonly callbacks: GateCameraCallbacks) {}

  stop() {
    this.generation += 1;
    const stream = this.stream;
    this.stream = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        if (this.ended) track.removeEventListener('ended', this.ended);
        track.stop();
      }
      const video = this.callbacks.video();
      if (video?.srcObject === stream) video.srcObject = null;
    }
    this.ended = null;
  }

  async start(deviceId: string) {
    this.stop();
    const generation = this.generation;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('CAMERA_UNSUPPORTED');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }),
        },
        audio: false,
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.ended = () => {
        if (generation !== this.generation) return;
        this.stop();
        this.callbacks.failed('Camera đã ngắt kết nối. Kết nối lại rồi khởi động lại camera.');
      };
      stream.getVideoTracks().forEach((track) => track.addEventListener('ended', this.ended!));
      const video = this.callbacks.video();
      if (!video) throw new Error('CAMERA_VIDEO_UNAVAILABLE');
      video.srcObject = stream;
      await video.play();
      if (generation !== this.generation) return;
      // Device labels are optional; a listing failure must not disable a working feed.
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      if (generation !== this.generation) return;
      this.callbacks.ready(
        devices.filter((device) => device.kind === 'videoinput'),
        stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId,
      );
    } catch (error) {
      if (generation !== this.generation) return;
      this.stop();
      const name = error instanceof Error ? error.name : '';
      this.callbacks.failed(
        error instanceof Error && error.message === 'CAMERA_UNSUPPORTED'
          ? 'Trình duyệt chưa hỗ trợ camera. Mở trang bằng HTTPS hoặc localhost.'
          : name === 'NotAllowedError'
            ? 'Chưa được cấp quyền camera. Cho phép camera trong trình duyệt rồi thử lại.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'Không tìm thấy camera đã chọn. Kết nối camera hoặc chọn camera khác.'
              : 'Không mở được camera. Kiểm tra thiết bị, đóng ứng dụng đang dùng camera rồi thử lại.',
      );
    }
  }
}
