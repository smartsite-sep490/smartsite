import { Column, CreateDateColumn, Entity, PrimaryColumn, Unique } from 'typeorm';

@Entity({ name: 'site' })
@Unique('uq_site_code', ['code'])
export class SiteEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid', primaryKeyConstraintName: 'pk_site_id' })
  id!: string;

  @Column({ name: 'code', type: 'varchar', length: 64 })
  code!: string;

  @Column({ name: 'name', type: 'varchar', length: 255 })
  name!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
