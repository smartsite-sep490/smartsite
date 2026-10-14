/** Browser usability guard only; AI remains responsible for detecting a face. */
import { translate as tr } from '../../../i18n';
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
    return tr('gate_camera_readiness.ang_oi_hinh_anh_tu_camera');
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 36;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return tr('gate_camera_readiness.khong_oc_uoc_camera_hay_khoi_ong_lai_camera');
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
    return tr(
      'gate_camera_readiness.camera_ang_qua_toi_hoac_bi_che_mo_nap_camera_tang_anh_sang_hoac_chon_camera_khac_c',
    );
  if (result === 'BLANK')
    return tr(
      'gate_camera_readiness.camera_ang_tra_hinh_trong_kiem_tra_camera_va_ua_mat_vao_khung_chua_quet',
    );
  return null;
}
