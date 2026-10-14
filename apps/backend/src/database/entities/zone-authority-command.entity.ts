import { Check, Column, CreateDateColumn, Entity, ForeignKey, PrimaryColumn } from 'typeorm';
import { UserEntity } from './user.entity.js';

@Entity({ name: 'zone_authority_command' })
@Check(
  'chk_authority_command_operation',
  'char_length(operation) BETWEEN 1 AND 64 AND operation=btrim(operation)',
)
@Check(
  'chk_authority_command_actor',
  "(actor_kind='USER' AND actor_user_id IS NOT NULL AND service_subject IS NULL) OR (actor_kind='SERVICE' AND actor_user_id IS NULL AND service_subject IS NOT NULL AND char_length(service_subject) BETWEEN 1 AND 64 AND service_subject=btrim(service_subject))",
)
@Check('chk_authority_command_hash', "request_hash ~ '^[0-9a-f]{64}$'")
@Check('chk_authority_command_time', 'isfinite(recorded_at)')
export class ZoneAuthorityCommandEntity {
  @PrimaryColumn({
    name: 'command_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_zone_authority_command',
  })
  commandId!: string;

  @Column({ type: 'varchar', length: 64 })
  operation!: string;

  @Column({ name: 'actor_kind', type: 'varchar', length: 8 })
  actorKind!: 'USER' | 'SERVICE';

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_authority_command_actor', onDelete: 'RESTRICT' })
  actorUserId!: string | null;

  @Column({ name: 'service_subject', type: 'varchar', length: 64, nullable: true })
  serviceSubject!: string | null;

  /** DB recording time, never proof of transaction commit or camera synchronization. */
  @CreateDateColumn({
    name: 'recorded_at',
    type: 'timestamptz',
    default: () => 'statement_timestamp()',
  })
  recordedAt!: Date;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;
}
