import { Column, CreateDateColumn, Entity, ForeignKey, PrimaryColumn } from 'typeorm';
import { SiteEntity } from './site.entity.js';
import { UserEntity } from './user.entity.js';
@Entity({ name: 'audit_log' })
export class AccessAuditEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_audit_log_id' }) id!: string;
  @Column({ name: 'actor_account_id', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_audit_actor', onDelete: 'RESTRICT' })
  actorAccountId!: string | null;
  @Column({ name: 'site_id', type: 'uuid', nullable: true })
  @ForeignKey(() => SiteEntity, { name: 'fk_audit_site', onDelete: 'RESTRICT' })
  siteId!: string | null;
  @Column({ type: 'varchar', length: 100 }) action!: string;
  @Column({ name: 'entity_type', type: 'varchar', length: 100 }) entityType!: string;
  @Column({ name: 'entity_id', type: 'uuid' }) entityId!: string;
  @Column({ type: 'text', nullable: true }) reason!: string | null;
  @Column({ type: 'jsonb', nullable: true }) changes!: Record<string, unknown> | null;
  @Column({ name: 'occurred_at', type: 'timestamptz' }) occurredAt!: Date;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
