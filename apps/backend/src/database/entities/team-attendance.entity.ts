import { Check, Column, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { WorkerScheduleEntity } from './worker-schedule.entity.js';
import { ContractorTeamEntity, ContractorTeamMembershipEntity } from './contractor-team.entity.js';
import { ZoneEntity } from './zone.entity.js';
import { UserEntity } from './user.entity.js';

@Entity({ name: 'team_attendance' })
@Index('idx_team_attendance_team', ['teamId'])
@Check('ck_team_attendance_status', "status IN ('PRESENT','ABSENT')")
@Check('ck_team_attendance_version', 'version > 0')
export class TeamAttendanceEntity {
  @PrimaryColumn({
    name: 'schedule_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_team_attendance',
  })
  @ForeignKey(() => WorkerScheduleEntity, {
    name: 'fk_team_attendance_schedule',
    onDelete: 'RESTRICT',
  })
  scheduleId!: string;
  @Column({ name: 'team_id', type: 'uuid' })
  @ForeignKey(() => ContractorTeamEntity, { name: 'fk_team_attendance_team', onDelete: 'RESTRICT' })
  teamId!: string;
  @Column({ name: 'membership_id', type: 'uuid' })
  @ForeignKey(() => ContractorTeamMembershipEntity, {
    name: 'fk_team_attendance_membership',
    onDelete: 'RESTRICT',
  })
  membershipId!: string;
  @Column({ name: 'zone_id', type: 'uuid' })
  @ForeignKey(() => ZoneEntity, { name: 'fk_team_attendance_zone', onDelete: 'RESTRICT' })
  zoneId!: string;
  @Column({ type: 'varchar', length: 16 }) status!: 'PRESENT' | 'ABSENT';
  @Column({ type: 'integer', default: 1 }) version!: number;
  @Column({ name: 'updated_by', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_team_attendance_actor', onDelete: 'RESTRICT' })
  updatedBy!: string;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
