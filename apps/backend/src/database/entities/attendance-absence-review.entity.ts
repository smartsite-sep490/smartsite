import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { AttendanceDayEntity } from './attendance-day.entity.js';
import { UserEntity } from './user.entity.js';
import { ContractorTeamEntity, ContractorTeamMembershipEntity } from './contractor-team.entity.js';
import { ZoneEntity } from './zone.entity.js';

@Entity({ name: 'attendance_absence_review' })
@Unique('uq_absence_review_snapshot', ['dayId', 'teamAttendanceVersion'])
@Check('ck_absence_review_version', 'expected_day_version > 0 AND team_attendance_version > 0')
@Check('ck_absence_review_reason', 'char_length(trim(reason)) BETWEEN 5 AND 1000')
export class AttendanceAbsenceReviewEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'day_id', type: 'uuid' })
  @ForeignKey(() => AttendanceDayEntity, { name: 'fk_absence_review_day', onDelete: 'RESTRICT' })
  dayId!: string;
  @Column({ name: 'expected_day_version', type: 'integer' }) expectedDayVersion!: number;
  @Column({ name: 'team_attendance_version', type: 'integer' }) teamAttendanceVersion!: number;
  @Column({ name: 'team_id', type: 'uuid' })
  @ForeignKey(() => ContractorTeamEntity, { name: 'fk_absence_review_team', onDelete: 'RESTRICT' })
  teamId!: string;
  @Column({ name: 'membership_id', type: 'uuid' })
  @ForeignKey(() => ContractorTeamMembershipEntity, {
    name: 'fk_absence_review_membership',
    onDelete: 'RESTRICT',
  })
  membershipId!: string;
  @Column({ name: 'zone_id', type: 'uuid' })
  @ForeignKey(() => ZoneEntity, { name: 'fk_absence_review_zone', onDelete: 'RESTRICT' })
  zoneId!: string;
  @Column({ type: 'text' }) reason!: string;
  @Column({ name: 'reviewed_by', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_absence_review_actor', onDelete: 'RESTRICT' })
  reviewedBy!: string;
  @CreateDateColumn({ name: 'reviewed_at', type: 'timestamptz' }) reviewedAt!: Date;
}
