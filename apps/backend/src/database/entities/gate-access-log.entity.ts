import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { SiteEntity } from './site.entity.js';
import { UserEntity } from './user.entity.js';
import { WorkerEntity } from './worker.entity.js';
import type { GateAccessLogResponse } from '@smartsite/contracts';

@Entity({ name: 'gate_access_log' })
@Index('idx_gate_access_log_site_gate_time', ['siteId', 'gateId', 'createdAt', 'id'])
@Check('chk_gate_access_log_direction', "direction IN ('IN', 'OUT')")
@Check('chk_gate_access_log_method', "method IN ('FACE','QR')")
export class GateAccessLogEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_gate_access_log_site', onDelete: 'RESTRICT' })
  siteId!: string;
  @Column({ name: 'gate_id', type: 'varchar', length: 64 }) gateId!: string;
  @Column({ name: 'operator_user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_gate_access_log_operator', onDelete: 'RESTRICT' })
  operatorUserId!: string;
  @Column({ name: 'worker_id', type: 'uuid', nullable: true })
  @ForeignKey(() => WorkerEntity, { name: 'fk_gate_access_log_worker', onDelete: 'RESTRICT' })
  workerId!: string | null;
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_gate_access_log_user', onDelete: 'RESTRICT' })
  userId!: string | null;
  @Column({ type: 'varchar', length: 3 }) direction!: 'IN' | 'OUT';
  @Column({ type: 'jsonb' }) decision!: GateAccessLogResponse['decision'];
  @Column({ type: 'varchar', length: 8, default: 'FACE' }) method!: 'FACE' | 'QR';
  @Column({ name: 'worker_name', type: 'varchar', length: 255, nullable: true }) workerName!:
    string | null;
  @Column({ name: 'worker_external_id', type: 'varchar', length: 128, nullable: true })
  workerExternalId!: string | null;
  @Column({ name: 'contractor_name', type: 'varchar', length: 255, nullable: true })
  contractorName!: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true }) username!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
