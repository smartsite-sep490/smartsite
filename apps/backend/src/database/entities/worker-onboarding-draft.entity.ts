import { Check, Column, Entity, ForeignKey, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { UploadWorkerDocumentCommand, WorkerDocumentKind } from '@smartsite/contracts';
import type { StoredObject } from '../../integrations/storage/storage.service.js';
import { ContractorEntity } from './contractor.entity.js';
import { SiteEntity } from './site.entity.js';
import { WorkerEntity } from './worker.entity.js';

export type IntakeAttachment = UploadWorkerDocumentCommand & {
  originalName?: string;
  file?: StoredObject;
};

@Entity({ name: 'worker_onboarding_draft' })
@Index('idx_worker_intake_scope', ['siteId', 'contractorId', 'updatedAt', 'id'])
@Check('chk_worker_intake_language', "language IN ('vi', 'en')")
@Check('chk_worker_intake_version', 'version>=1')
export class WorkerOnboardingDraftEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_worker_intake_site', onDelete: 'RESTRICT' })
  siteId!: string;
  @Column({ name: 'contractor_id', type: 'uuid' })
  @ForeignKey(() => ContractorEntity, { name: 'fk_worker_intake_contractor', onDelete: 'RESTRICT' })
  contractorId!: string;
  @Column({ name: 'worker_id', type: 'uuid', nullable: true })
  @ForeignKey(() => WorkerEntity, { name: 'fk_worker_intake_worker', onDelete: 'RESTRICT' })
  workerId!: string | null;
  @Column({ name: 'display_name', type: 'varchar', length: 255 }) displayName!: string;
  @Column({ type: 'varchar', length: 64 }) username!: string;
  @Column({ type: 'varchar', length: 254 }) email!: string;
  @Column({ type: 'varchar', length: 2 }) language!: 'vi' | 'en';
  @Column({ name: 'safety_card_required', type: 'boolean', nullable: true })
  safetyCardRequired!: boolean | null;
  @Column({ type: 'jsonb' })
  documents!: Partial<Record<WorkerDocumentKind, IntakeAttachment>>;
  @Column({ type: 'integer' }) version!: number;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
