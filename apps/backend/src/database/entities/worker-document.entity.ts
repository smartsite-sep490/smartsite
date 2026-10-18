import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import type {
  DocumentOcrResult,
  WorkerDocumentKind,
  WorkerDocumentStatus,
} from '@smartsite/contracts';
import type { StoredObject } from '../../integrations/storage/storage.service.js';
import { WorkerEntity } from './worker.entity.js';
import { UserEntity } from './user.entity.js';

@Entity({ name: 'worker_compliance_profile' })
@Check('chk_compliance_national_id', "national_id IS NULL OR national_id ~ '^[0-9]{12}$'")
@Check('chk_compliance_phone', "phone_number IS NULL OR phone_number ~ '^\\+?[0-9]{9,15}$'")
@Check('chk_compliance_gender', "gender IS NULL OR gender IN ('MALE','FEMALE','OTHER')")
export class WorkerComplianceProfileEntity {
  @PrimaryColumn({ name: 'worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, { name: 'fk_compliance_worker', onDelete: 'RESTRICT' })
  workerId!: string;
  @Column({ name: 'national_id', type: 'varchar', length: 12, nullable: true })
  nationalId!: string | null;
  @Column({ name: 'phone_number', type: 'varchar', length: 16, nullable: true })
  phoneNumber!: string | null;
  @Column({ type: 'varchar', length: 8, nullable: true }) gender!:
    'MALE' | 'FEMALE' | 'OTHER' | null;
  @Column({ type: 'varchar', length: 1000, nullable: true }) address!: string | null;
  @Column({ name: 'identity_required', type: 'boolean', default: false })
  identityRequired!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity({ name: 'worker_identity_image' })
@Unique('uq_worker_identity_side', ['workerId', 'side'])
@Check('chk_worker_identity_side', "side IN ('FRONT','BACK')")
export class WorkerIdentityImageEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, { name: 'fk_identity_image_worker', onDelete: 'RESTRICT' })
  workerId!: string;
  @Column({ type: 'varchar', length: 5 }) side!: 'FRONT' | 'BACK';
  @Column({ name: 'original_name', type: 'varchar', length: 255 }) originalName!: string;
  @Column({ type: 'jsonb', select: false }) file!: StoredObject;
  @Column({ type: 'jsonb', nullable: true }) ocr!: DocumentOcrResult | null;
  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamptz' }) uploadedAt!: Date;
}

@Entity({ name: 'worker_document' })
@Check('chk_worker_document_version', 'version>=1')
@Index('idx_worker_document_worker', ['workerId', 'uploadedAt'])
@Index('uq_worker_document_approved', ['workerId', 'kind'], {
  unique: true,
  where: "status='APPROVED'",
})
@Index('uq_worker_document_pending', ['workerId', 'kind'], {
  unique: true,
  where: "status='PENDING'",
})
@Check(
  'chk_worker_document_kind',
  "kind IN ('SAFETY_CARD','HEALTH_CERTIFICATE','PERSONAL_INSURANCE')",
)
@Check('chk_worker_document_status', "status IN ('PENDING','APPROVED','REJECTED','SUPERSEDED')")
@Check(
  'chk_worker_document_dates',
  "status<>'APPROVED' OR (issued_on IS NOT NULL AND expires_on IS NOT NULL AND expires_on>=issued_on AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)",
)
export class WorkerDocumentEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, { name: 'fk_worker_document_worker', onDelete: 'RESTRICT' })
  workerId!: string;
  @Column({ type: 'varchar', length: 32 }) kind!: WorkerDocumentKind;
  @Column({ type: 'varchar', length: 16 }) status!: WorkerDocumentStatus;
  @Column({ name: 'original_name', type: 'varchar', length: 255 }) originalName!: string;
  @Column({ type: 'jsonb', select: false }) file!: StoredObject;
  @Column({ type: 'jsonb' }) ocr!: DocumentOcrResult;
  @Column({ name: 'issued_on', type: 'date', nullable: true }) issuedOn!: string | null;
  @Column({ name: 'expires_on', type: 'date', nullable: true }) expiresOn!: string | null;
  @Column({ name: 'submitted_issued_on', type: 'date', nullable: true }) submittedIssuedOn!:
    string | null;
  @Column({ name: 'submitted_expires_on', type: 'date', nullable: true }) submittedExpiresOn!:
    string | null;
  @Column({ name: 'uploaded_by', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_worker_document_uploader', onDelete: 'RESTRICT' })
  uploadedBy!: string;
  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamptz' }) uploadedAt!: Date;
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_worker_document_reviewer', onDelete: 'RESTRICT' })
  reviewedBy!: string | null;
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true }) reviewedAt!: Date | null;
  @Column({ name: 'review_note', type: 'varchar', length: 1000, nullable: true }) reviewNote!:
    string | null;
  @Column({ type: 'int', default: 1 }) version!: number;
}
