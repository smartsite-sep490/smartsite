import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { CameraEntity } from './camera.entity.js';
import { ZoneEntity } from './zone.entity.js';

@Entity({ name: 'camera_observation_region' })
@Check('chk_region_coordinate_space', "coordinate_space = 'NORMALIZED_0_1'")
@Check('chk_region_version', 'version >= 1')
@Index('idx_region_camera_active', ['cameraId', 'isActive'])
export class CameraObservationRegionEntity {
  @PrimaryColumn({
    name: 'id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_camera_observation_region_id',
  })
  id!: string;

  @Column({ name: 'camera_id', type: 'uuid' })
  @ForeignKey(() => CameraEntity, { name: 'fk_region_camera', onDelete: 'RESTRICT' })
  cameraId!: string;

  @Column({ name: 'zone_id', type: 'uuid' })
  @ForeignKey(() => ZoneEntity, { name: 'fk_region_zone', onDelete: 'RESTRICT' })
  zoneId!: string;

  @Column({ name: 'polygon', type: 'jsonb' })
  polygon!: unknown;

  @Column({ name: 'coordinate_space', type: 'varchar', length: 32, default: 'NORMALIZED_0_1' })
  coordinateSpace!: string;

  @Column({ name: 'version', type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
