# Đối chiếu ERD cũ với schema SmartSite hiện tại

Ngày: 2026-10-13. Nhánh: `feat/contractor-teams-20261008`. Commit nguồn: `a80ada67487ae1d4367f3dd621355191f4b16777`.

Bản đầu vào là DBML “MF07-only revision, 2026-10-06” gồm 48 bảng, giữ nhiều định nghĩa logic từ ERD gốc. Bản mới là [smartsite-current.dbml](smartsite-current.dbml), dùng tên và cấu trúc vật lý từ code/migration hiện tại. Không sửa code ứng dụng, migration hay database nghiệp vụ.

## Kết quả đối chiếu

- 65 bảng nghiệp vụ/hỗ trợ, 699 cột, 219 khóa ngoại, 141 CHECK, 6 PostgreSQL enum và 6 trigger.
- 64 bảng có entity TypeORM. `attendance_schedule_conflict` chỉ được khai báo trong migration MF03 và được đưa vào ERD đầy đủ.
- Bảng `migrations` là lịch sử chạy migration nội bộ TypeORM, được loại khỏi sơ đồ nghiệp vụ.
- TypeORM không phát hiện schema drift trên các entity đã đăng ký; không có migration còn chờ trên database kiểm thử.
- Số bảng thay đổi không chỉ là thêm mới: bản cũ có tên logic, bảng thiết kế chưa được tạo và cấu trúc khác ngay cả ở các bảng cùng tên.

## Các thay đổi chính

- Tài khoản dùng `app_user.username`, `is_active`, `must_change_password`; không phải mô hình email/status của ERD cũ.
- Contractor tham gia Site theo `contractor_site_participation` với khoảng hiệu lực. Quyền đại diện nằm ở cả `contractor_representative_grant` và `contractor_representative_assignment`; quyền tại Site còn phụ thuộc `user_role_assignment`.
- Bổ sung đội (`contractor_team`), lịch sử thành viên (`contractor_team_membership`) và quyền Zone của đội (`team_zone_permission`).
- Luồng tra cứu nhà thầu → Site → Zone → đội/người làm trong ngày dựa trên participation, quyền Zone, membership và `worker_schedule`/`shift`; không có bảng tổng hợp riêng tên “contractor working day”.
- Bổ sung ngày công, yêu cầu OT, đối soát/chỉnh công và các bảng chấm công đang tồn tại. `timesheet` có schema vật lý; sự tồn tại của bảng không chứng minh đầy đủ mọi quy trình payroll.
- MF07 có thêm `schedule_assignment_batch`; `shift` có các cột cấu hình break/archive hiện tại; notification đã mở rộng ngoài CHANGE/SWAP.
- AI lưu sự kiện `raw_payload` và các bảng quyết định danh tính của Backend; không dựng lại các bảng detection/identity candidate chưa tồn tại.
- PPE yêu cầu nằm trong `zone.required_ppe` dạng `text[]`; không có bảng `zone_ppe_requirement` riêng.
- Dùng đúng kiểu vật lý: các cột varchar có CHECK vẫn là varchar, không chuyển thành enum giả. Mảng/JSON và tham chiếu đa hình không được tự gán FK.
- Cập nhật quan hệ và lịch sử MF08 theo schema thật; bỏ ghi chú cũ về vai trò xử lý nếu không còn phản ánh code.

## Tên logic cũ và đối tượng vật lý liên quan

Đây là ánh xạ để so sánh phạm vi nghiệp vụ, **không phải đề xuất đổi tên bằng migration**. Cột, trạng thái và quan hệ có thể khác.

| ERD cũ | Schema hiện tại |
|---|---|
| `role_grant` | `user_role_assignment` |
| `site_contractor` | `contractor_site_participation` |
| `contractor_representative` | `contractor_representative_assignment` |
| `worker_assignment` | `worker_site_zone_assignment` |
| `evidence_reference` | `safety_evidence` |
| `visit` | `visitor_visit` |
| `access_credential` | `qr_credential` |
| `observation_region` | `camera_observation_region` |
| `identity_decision` | `observation_identity_decision` |
| `zone_entry_evaluation` | `zone_entry_decision` |
| `alert_observation` | `alert_detection_mapping` |

`contractor_representative` không ánh xạ một-một: còn có bảng grant riêng. `evidence_reference` và `identity_decision` cũng chỉ là đối chiếu chức năng, không tương đương toàn bộ mô hình cũ.

## Bảng hiện tại chưa có đối tượng tương ứng trong ERD cũ

- `attendance_anomaly`
- `attendance_correction_request`
- `attendance_day`
- `attendance_pair`
- `attendance_schedule_conflict`
- `auth_session`
- `contractor_representative_grant`
- `contractor_team`
- `contractor_team_membership`
- `face_enrollment_session`
- `gate_access_log`
- `incident_worker`
- `observation_identity_resolution`
- `overtime_request`
- `qr_fallback_session`
- `safety_alert_review`
- `safety_workflow_audit`
- `schedule_assignment_batch`
- `team_zone_permission`
- `timesheet`
- `visitor_gate_event`
- `worker_gate_permission`
- `zone_access_grant`

## Bảng thiết kế cũ không có bảng vật lý tương ứng

- `certificate`
- `safety_officer_zone_assignment`
- `zone_ppe_requirement`
- `person_observation`
- `identity_candidate`
- `ppe_observation`

Các bảng này được bỏ khỏi ERD vật lý. Điều đó không tự đồng nghĩa nghiệp vụ tương ứng không tồn tại: một số dữ liệu được lưu ở mảng, JSON hoặc các bảng workflow khác.

## Chi tiết cột khác nhau

So sánh sau ánh xạ bảng ở trên. “Chỉ trong ERD cũ” nghĩa là không có cột cùng tên ở bảng vật lý được đối chiếu; không khẳng định dữ liệu bị mất hoặc cần xóa. Bản DBML mới ghi đầy đủ default và mọi CHECK/FK/index; phần dưới tập trung tên cột, kiểu và nullability.

### app_user

- Chỉ trong schema hiện tại: `is_active`, `must_change_password`, `username`.
- Chỉ trong ERD cũ: `email`, `status`.
- `display_name`: kiểu `varchar(150)` → `varchar(255)`.

### contractor

- Chỉ trong schema hiện tại: `is_active`.
- Chỉ trong ERD cũ: `contact_phone`, `status`, `updated_at`.
- `code`: kiểu `varchar(50)` → `varchar(64)`.
- `name`: kiểu `varchar(200)` → `varchar(255)`.

### contractor_representative → contractor_representative_assignment

- Chỉ trong schema hiện tại: `id`, `site_id`, `user_id`.
- Chỉ trong ERD cũ: `account_id`, `is_active`.

### site

- Chỉ trong ERD cũ: `kind`, `address`, `timezone`, `status`, `updated_at`.
- `code`: kiểu `varchar(50)` → `varchar(64)`.
- `name`: kiểu `varchar(150)` → `varchar(255)`.

### site_contractor → contractor_site_participation

- Chỉ trong schema hiện tại: `valid_until`, `is_active`.
- Chỉ trong ERD cũ: `valid_to`, `status`, `updated_at`.

### worker

- Chỉ trong schema hiện tại: `site_id`, `is_active`, `user_id`, `external_id`, `display_name`.
- Chỉ trong ERD cũ: `account_id`, `employee_code`, `full_name`, `phone`, `status`, `updated_at`.
- `contractor_id`: NOT NULL → NULL.

### role_grant → user_role_assignment

- Chỉ trong schema hiện tại: `user_id`.
- Chỉ trong ERD cũ: `account_id`, `site_contractor_id`, `worker_id`, `valid_from`, `valid_to`, `revoked_at`, `granted_by`.
- `role`: kiểu `role_code` → `varchar(32)`.

### evidence_reference → safety_evidence

- Chỉ trong schema hiện tại: `size`, `storage_provider`.
- Chỉ trong ERD cũ: `captured_at`, `retention_until`.
- `site_id`: NULL → NOT NULL.
- `storage_key`: kiểu `varchar(500)` → `varchar(512)`.
- `media_type`: kiểu `varchar(100)` → `varchar(32)`.
- `uploaded_by`: NULL → NOT NULL.

### worker_assignment → worker_site_zone_assignment

- Chỉ trong schema hiện tại: `site_id`, `zone_ids`, `valid_until`, `requested_by_user_id`, `safety_reviewed_by_user_id`, `site_manager_decided_by_user_id`, `gate_id`.
- Chỉ trong ERD cũ: `valid_to`, `submitted_by`, `reviewed_by`, `updated_at`.
- `site_contractor_id`: NOT NULL → NULL.
- `status`: kiểu `assignment_status` → `varchar(32)`.

### zone

- Chỉ trong schema hiện tại: `type`, `restriction_policy`, `configuration_locked`, `required_ppe`.
- Chỉ trong ERD cũ: `kind`, `is_active`, `policy_version`, `updated_at`.
- `code`: kiểu `varchar(50)` → `varchar(64)`.
- `name`: kiểu `varchar(150)` → `varchar(255)`.

### contractor_zone_permission

- Chỉ trong schema hiện tại: `valid_until`.
- Chỉ trong ERD cũ: `valid_to`.

### worker_zone_permission

- Chỉ trong schema hiện tại: `valid_until`.
- Chỉ trong ERD cũ: `valid_to`.

### face_profile

- Chỉ trong schema hiện tại: `created_by_user_id`, `revoked_by_user_id`, `user_id`, `profile_reference_hash`, `encrypted_template`.
- Chỉ trong ERD cũ: `template_ref`, `captured_by`.
- `model_version`: kiểu `varchar(100)` → `varchar(128)`.
- `consent_version`: kiểu `varchar(50)` → `varchar(64)`.
- `status`: kiểu `face_status` → `varchar(32)`.

### shift

- Chỉ trong schema hiện tại: `archived_at`, `break_starts_at`, `break_ends_at`.

### shift_swap_request

- Chỉ trong schema hiện tại: `expected_team_id`, `expected_requester_membership_id`, `expected_coworker_membership_id`.

### absence_request

- Chỉ trong schema hiện tại: `starts_at`, `ends_at`, `review_note`.

### user_notification

- `request_type`: kiểu `varchar(6)` → `varchar(16)`.

### visitor

- Chỉ trong schema hiện tại: `contact`.
- Chỉ trong ERD cũ: `phone`.
- `full_name`: kiểu `varchar(150)` → `varchar(255)`.
- `organization`: kiểu `varchar(200)` → `varchar(255)`; NULL → NOT NULL.

### visit → visitor_visit

- Chỉ trong schema hiện tại: `group_size`, `valid_until`, `entered_count`, `exited_count`, `decided_by_user_id`, `decided_at`, `access_key_hash`, `visitor_name`, `company`, `contact`, `host_name`, `target_area`, `gate_id`.
- Chỉ trong ERD cũ: `headcount`, `valid_to`, `reviewed_by`, `reviewed_at`.
- `purpose`: kiểu `text` → `varchar(1000)`.
- `status`: kiểu `visit_status` → `varchar(16)`.

### visit_zone

- Chỉ trong schema hiện tại: `valid_until`.
- Chỉ trong ERD cũ: `valid_to`.

### access_credential → qr_credential

- Chỉ trong schema hiện tại: `fallback_session_id`, `consumed_at`, `result`, `request_hash`.
- Chỉ trong ERD cũ: `used_at`.
- `token_hash`: kiểu `varchar(255)` → `varchar(64)`.
- `direction`: kiểu `direction` → `varchar(3)`.

### access_attempt

- Chỉ trong schema hiện tại: `operator_id`, `gate_id`.
- `direction`: kiểu `direction` → `varchar(3)`.
- `method`: kiểu `verification_method` → `varchar(10)`.
- `identity_status`: kiểu `identity_result` → `varchar(32)`.
- `authorization_status`: kiểu `authorization_result` → `varchar(32)`.
- `schedule_status`: kiểu `schedule_result` → `varchar(32)`.
- `status`: kiểu `attempt_status` → `varchar(16)`.

### gate_event

- `direction`: kiểu `direction` → `varchar(3)`.

### attendance_event

- `kind`: kiểu `attendance_event_kind` → `varchar(16)`.
- `method`: kiểu `verification_method` → `varchar(10)`.

### attendance_session

- Chỉ trong schema hiện tại: `day_id`, `ignored_by`, `ignored_at`, `ignore_reason`.
- `status`: kiểu `attendance_status` → `varchar(16)`.

### attendance_correction

- Chỉ trong ERD cũ: `evidence_id`.
- `status`: kiểu `review_status` → `varchar(16)`.

### camera

- Chỉ trong schema hiện tại: `configuration_version`, `external_id`.
- Chỉ trong ERD cũ: `stream_ref`, `last_seen_at`, `updated_at`.
- `code`: kiểu `varchar(50)` → `varchar(64)`.
- `name`: kiểu `varchar(100)` → `varchar(255)`.

### observation_region → camera_observation_region

- Chỉ trong schema hiện tại: `version`, `coordinate_space`.
- Chỉ trong ERD cũ: `code`, `config_version`.

### ai_observation_event

- Chỉ trong schema hiện tại: `event_id`, `resolved_camera_id`, `stream_session_id`, `captured_at`, `received_at`, `raw_payload`, `processing_status`, `payload_hash`, `camera_external_id`, `processing_note`.
- Chỉ trong ERD cũ: `id`, `camera_id`, `observed_at`, `producer_event_key`, `tracking_session_key`, `model_version`, `evidence_id`, `payload`.

### identity_decision → observation_identity_decision

- Chỉ trong schema hiện tại: `resolution_id`, `site_id`, `actor_user_id`, `revision`, `expected_revision`, `evidence_index`, `recorded_at`, `command_hash`, `action`, `evidence_sha256`, `reason`, `scope`, `verification_method`.
- Chỉ trong ERD cũ: `person_observation_id`, `candidate_id`, `status`, `source`, `confidence`, `reason_code`, `decided_by`, `decided_at`, `supersedes_decision_id`, `created_at`.

### zone_entry_evaluation → zone_entry_decision

- Chỉ trong schema hiện tại: `event_id`, `site_id`, `worker_id`, `track_id`, `candidate_worker_id`, `status`.
- Chỉ trong ERD cũ: `person_observation_id`, `identity_decision_id`, `worker_assignment_id`, `worker_zone_permission_id`, `result`, `assignment_version`, `zone_policy_version`.
- `reason_code`: kiểu `varchar(100)` → `varchar(64)`.

### incident

- Chỉ trong schema hiện tại: `contractor_id`, `responsibility_confirmed_by`, `responsibility_confirmed_at`, `responsibility_reason`.
- Chỉ trong ERD cũ: `evidence_id`.
- `severity`: kiểu `alert_severity` → `varchar(16)`.
- `status`: kiểu `incident_status` → `varchar(16)`.

### safety_alert

- Chỉ trong schema hiện tại: `identity_similarity_score`, `identity_quality_score`, `alert_type`, `first_detected_at`, `last_detected_at`, `detection_count`, `revision`, `candidate_subtype`, `grouping_key`, `candidate_worker_id`.
- Chỉ trong ERD cũ: `kind`, `severity`, `summary`, `detected_at`, `reviewed_by`, `reviewed_at`, `review_note`, `version`.

### alert_observation → alert_detection_mapping

- Chỉ trong schema hiện tại: `event_id`.
- Chỉ trong ERD cũ: `person_observation_id`, `zone_entry_evaluation_id`.

### safety_task

- `kind`: kiểu `safety_task_kind` → `varchar(32)`.
- `status`: kiểu `safety_task_status` → `varchar(16)`.

### corrective_action

- Chỉ trong schema hiện tại: `superseded_at`, `superseded_by`, `superseded_reason`.
- `status`: kiểu `action_status` → `varchar(16)`.

### corrective_action_submission

- `status`: kiểu `review_status` → `varchar(16)`.

## Ràng buộc PostgreSQL cần giữ khi chỉnh sơ đồ

DBML không biểu diễn trực tiếp predicate của partial index hoặc thực thi trigger. Các partial index được ghi trong note với SQL nguyên văn; chúng **không được đánh dấu unique toàn bảng**. SQL trigger và function nằm ở cuối file DBML dưới dạng comment. Xuất SQL từ sơ đồ không thay thế migration.

| Bảng | Index | Loại | Predicate |
|---|---|---|---|
| `attendance_session` | `uq_attendance_session_legacy_open` | Partial unique | `((check_out_event_id IS NULL) AND (effective_out_at IS NULL) AND (day_id IS NULL))` |
| `attendance_session` | `uq_attendance_session_open` | Partial unique | `((check_out_event_id IS NULL) AND (effective_out_at IS NULL) AND (day_id IS NOT NULL))` |
| `contractor_team` | `uq_team_active_name` | Partial unique | `(is_active = true)` |
| `contractor_team_membership` | `uq_team_worker_active` | Partial unique | `(left_at IS NULL)` |
| `contractor_zone_permission` | `uq_contractor_zone_interval` | Partial unique | `(revoked_at IS NULL)` |
| `corrective_action_submission` | `uq_action_pending_submission` | Partial unique | `((status)::text = 'PENDING'::text)` |
| `face_profile` | `uq_face_profile_worker_active` | Partial unique | `((status)::text = 'ACTIVE'::text)` |
| `safety_alert` | `idx_alert_incident` | Partial index | `(incident_id IS NOT NULL)` |
| `team_zone_permission` | `uq_team_single_zone` | Partial unique | `(revoked_at IS NULL)` |
| `user_notification` | `idx_notification_unread` | Partial index | `(read_at IS NULL)` |
| `user_role_assignment` | `idx_user_role_assignment_site` | Partial index | `(site_id IS NOT NULL)` |
| `user_role_assignment` | `uq_site_single_manager` | Partial unique | `((role)::text = 'SITE_MANAGER'::text)` |
| `user_role_assignment` | `uq_user_role_assignment_global` | Partial unique | `(site_id IS NULL)` |
| `user_role_assignment` | `uq_user_role_assignment_scoped` | Partial unique | `(site_id IS NOT NULL)` |
| `worker` | `idx_worker_contractor` | Partial index | `(contractor_id IS NOT NULL)` |
| `worker` | `uq_worker_site_user` | Partial unique | `(user_id IS NOT NULL)` |
| `worker_schedule` | `uq_worker_schedule_active_worker_shift_date` | Partial unique | `(is_active = true)` |

Trigger hiện tại:

- `contractor_team_membership.team_membership_scope`.
- `corrective_action_submission.immutable_submission`.
- `observation_identity_decision.trg_identity_decision_append_only`.
- `safety_workflow_audit.immutable_workflow_audit`.
- `team_zone_permission.trg_team_zone_scope`.
- `worker_schedule.mf03_one_shift_per_day`.

Riêng `worker_schedule` có trigger kiểm soát một ca hoạt động trong ngày, nên không thể đọc mỗi unique index (Site/Worker/Shift/Date) rồi kết luận cho phép nhiều ca khác nhau. Function còn giữ ngoại lệ update lịch sử đã có; bản DBML bảo toàn SQL thật.

## Kiểm chứng và cách sử dụng

- Build Backend từ source hiện tại thành công.
- Kiểm tra chỉ metadata/schema trên PostgreSQL kiểm thử cục bộ; không xuất dòng dữ liệu nghiệp vụ.
- DBML được parse bằng compiler chính thức `@dbml/core@10.3.1` ở chế độ DBML v2; kiểm tra số bảng/cột/FK, kiểu/null/default, CHECK và index khớp snapshot schema.
- 65 bảng được chia nhóm theo nghiệp vụ để dễ xem; giữ nguyên tên bảng vật lý.
- Mở `smartsite-current.dbml`, copy toàn bộ vào trình chỉnh sửa DBML của dbdiagram.io, thay nội dung sơ đồ cũ. Không chạy nội dung file như migration.
- Không có thay đổi ứng dụng/persistence trong lần cập nhật tài liệu này, nên không chạy lại toàn bộ test ứng dụng chỉ để sửa sơ đồ.

Cú pháp và giới hạn mô hình dùng theo [tài liệu DBML chính thức](https://dbml.dbdiagram.io/docs/).
