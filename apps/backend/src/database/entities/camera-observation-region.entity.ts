import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'camera_observation_region' })
@Index('idx_region_camera_active', ['cameraId', 'isActive'])
export class CameraObservationRegionEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  id!: string;

  @Column({ name: 'camera_id', type: 'uuid' })
  cameraId!: string;

  @Column({ name: 'zone_id', type: 'uuid' })
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
