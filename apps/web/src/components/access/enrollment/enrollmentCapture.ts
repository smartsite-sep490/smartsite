import { translate as tr } from '../../../i18n';
import type { EnrollmentCaptureTarget } from '@smartsite/contracts';

export const CAPTURE_GUIDANCE: Record<EnrollmentCaptureTarget, { title: string; detail: string }> =
  {
    front: {
      get title() {
        return tr('enrollment_capture.buoc_1_3_nhin_thang_vao_camera');
      },
      get detail() {
        return tr(
          'enrollment_capture.at_toan_bo_mat_trong_khung_nhin_thang_giu_au_ngay_ngan_va_ung_yen',
        );
      },
    },
    left: {
      get title() {
        return tr('enrollment_capture.buoc_2_3_quay_nhe_sang_trai_cua_ban');
      },
      get detail() {
        return tr(
          'enrollment_capture.quay_ca_au_tu_tu_sang_trai_khong_chi_liec_mat_giu_mat_trong_khung_roi_ung_yen',
        );
      },
    },
    right: {
      get title() {
        return tr('enrollment_capture.buoc_3_3_quay_nhe_sang_phai_cua_ban');
      },
      get detail() {
        return tr(
          'enrollment_capture.quay_au_ve_giua_roi_nhe_sang_phai_khong_quay_qua_xa_va_giu_yen_khi_may_chup',
        );
      },
    },
  };

export function enrollmentQualityMessage(reason: string): string {
  const messages: Record<string, string> = {
    FACE_QUALITY_ACCEPTED: tr(
      'enrollment_capture.anh_at_yeu_cau_mot_khuon_mat_u_sang_ro_net_trong_khung_va_ung_huong_co_the_sang_bu',
    ),
    FACE_NOT_FOUND: tr(
      'enrollment_capture.chua_thay_khuon_mat_ua_toan_bo_mat_vao_khung_roi_chup_lai',
    ),
    FACE_MULTIPLE_FOUND: tr(
      'enrollment_capture.co_nhieu_khuon_mat_chi_e_nguoi_ang_ky_xuat_hien_trong_khung',
    ),
    FACE_TOO_SMALL: tr('enrollment_capture.mat_qua_nho_hoac_qua_xa_tien_gan_camera_hon'),
    FACE_TOO_CLOSE: tr('enrollment_capture.mat_qua_gan_lui_lai_mot_chut_e_thay_toan_bo_khuon_mat'),
    FACE_CLIPPED: tr('enrollment_capture.khuon_mat_bi_cat_o_mep_anh_ua_toan_bo_mat_vao_khung'),
    FACE_NOT_CENTERED: tr(
      'enrollment_capture.mat_lech_khoi_giua_khung_ieu_chinh_vi_tri_roi_chup_lai',
    ),
    FACE_TOO_DARK: tr('enrollment_capture.anh_thieu_sang_bat_en_hoac_huong_mat_ve_nguon_sang'),
    FACE_TOO_BRIGHT: tr('enrollment_capture.anh_qua_sang_tranh_anh_sang_chieu_truc_tiep_vao_mat'),
    FACE_BLURRY: tr('enrollment_capture.anh_bi_mo_giu_au_ung_yen_va_lau_camera_neu_can'),
    FACE_HEAD_TILTED: tr('enrollment_capture.au_ang_nghieng_giu_au_ngay_ngan_khong_nghieng_vai'),
    FACE_TURN_TOO_FAR: tr(
      'enrollment_capture.ban_quay_au_qua_xa_quay_nhe_hon_e_camera_thay_cac_iem_tren_mat',
    ),
    FACE_POSE_FRONT_REQUIRED: tr(
      'enrollment_capture.anh_chua_nhin_thang_quay_mat_ve_chinh_giua_camera',
    ),
    FACE_POSE_LEFT_REQUIRED: tr(
      'enrollment_capture.anh_chua_ung_goc_trai_quay_nhe_au_sang_trai_cua_ban_roi_chup_lai',
    ),
    FACE_POSE_RIGHT_REQUIRED: tr(
      'enrollment_capture.anh_chua_ung_goc_phai_quay_nhe_au_sang_phai_cua_ban_roi_chup_lai',
    ),
    FACE_NOT_CLEAR: tr(
      'enrollment_capture.camera_chua_thay_mat_u_ro_giu_yen_tranh_che_mat_va_ieu_chinh_anh_sang',
    ),
    FACE_LANDMARKS_UNAVAILABLE: tr(
      'enrollment_capture.chua_xac_inh_ro_cac_iem_tren_mat_bo_vat_che_mat_va_quay_nhe_hon',
    ),
    FACE_IMAGE_INVALID: tr('enrollment_capture.anh_chup_khong_oc_uoc_hay_chup_lai'),
  };
  return (
    messages[reason] ??
    tr('enrollment_capture.anh_chua_u_chat_luong_ieu_chinh_anh_sang_vi_tri_va_giu_yen_roi_chup_lai')
  );
}
