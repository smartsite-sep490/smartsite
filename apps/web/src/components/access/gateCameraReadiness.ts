/** Browser usability guard only; AI remains responsible for detecting a face. */
export function cameraPixelReadiness(rgba: ArrayLike<number>): 'READY' | 'DARK' | 'BLANK' {
  let sum = 0,
    squares = 0,
    count = 0;
  for (let index = 0; index + 2 < rgba.length; index += 4) {
    const gray =
      0.299 * (rgba[index] ?? 0) + 0.587 * (rgba[index + 1] ?? 0) + 0.114 * (rgba[index + 2] ?? 0);
    sum += gray;
    squares += gray * gray;
    count += 1;
  }
  if (!count || sum / count < 35) return 'DARK';
  if (squares / count - (sum / count) ** 2 < 18) return 'BLANK';
  return 'READY';
}

export function inspectGateCamera(video: HTMLVideoElement): string | null {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight)
    return 'Đang đợi hình ảnh từ camera…';
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 36;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return 'Không đọc được camera. Hãy khởi động lại camera.';
  context.drawImage(
    video,
    video.videoWidth / 4,
    video.videoHeight / 4,
    video.videoWidth / 2,
    video.videoHeight / 2,
    0,
    0,
    48,
    36,
  );
  const result = cameraPixelReadiness(context.getImageData(0, 0, 48, 36).data);
  if (result === 'DARK')
    return 'Camera đang quá tối hoặc bị che. Mở nắp camera, tăng ánh sáng hoặc chọn camera khác. Chưa quét.';
  if (result === 'BLANK')
    return 'Camera đang trả hình trống. Kiểm tra camera và đưa mặt vào khung. Chưa quét.';
  return null;
}
