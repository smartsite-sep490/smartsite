import { ApiProperty } from '@nestjs/swagger';
import type { RegionGeometryConfirmationStatus } from '@smartsite/contracts/camera-region-geometry-confirmation';

export class RegionGeometryConfirmationResponseDto {
  @ApiProperty({ enum: ['UNCONFIRMED', 'MANUALLY_CONFIRMED', 'NEEDS_REVALIDATION'] })
  status!: RegionGeometryConfirmationStatus;
  @ApiProperty({ format: 'uuid', nullable: true }) referenceId!: string | null;
  @ApiProperty({ nullable: true, minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  viewRevision!: number | null;
  @ApiProperty({ format: 'uuid', nullable: true }) confirmedByUserId!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true }) confirmedAt!: string | null;
}
