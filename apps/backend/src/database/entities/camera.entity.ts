import { Column, CreateDateColumn, Entity, ForeignKey, PrimaryColumn, Unique } from 'typeorm';
import { CameraStatus } from './enums.js';
import { SiteEntity } from './site.entity.js';

@Entity({ name: 'camera' })
@Unique('uq_camera_external_id', ['externalId'])
@Unique('uq_camera_site_code', ['siteId', 'code'])
export class CameraEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid', primaryKeyConstraintName: 'pk_camera_id' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_camera_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ name: 'external_id', type: 'varchar', length: 128 })
  externalId!: string;

  @Column({ name: 'code', type: 'varchar', length: 64 })
  code!: string;

  @Column({ name: 'name', type: 'varchar', length: 255 })
  name!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: CameraStatus,
    enumName: 'camera_status',
    default: CameraStatus.ACTIVE,
  })
  status!: CameraStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
