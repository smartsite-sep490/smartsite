import { ApiProperty } from '@nestjs/swagger';
import { RegionResponseDto } from './management-response.dto.js';
import { RegionGeometryConfirmationResponseDto } from './region-geometry-confirmation-response.dto.js';

/** Documentation only: the shared canonical parser validates the unknown HTTP body. */
export class UpdateReferenceRegionCommandDto {
  @ApiProperty({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  expectedConfigurationVersion!: number;
  @ApiProperty({ format: 'uuid' }) referenceId!: string;
  @ApiProperty({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }) viewRevision!: number;
  @ApiProperty({ enum: [true] }) confirmReferenceView!: true;
  @ApiProperty({
    type: 'object',
    additionalProperties: false,
    required: ['coordinates'],
    properties: {
      coordinates: {
        type: 'array',
        minItems: 3,
        maxItems: 64,
        items: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  })
  polygon!: unknown;
}

export class CreateReferenceRegionCommandDto extends UpdateReferenceRegionCommandDto {
  @ApiProperty({ format: 'uuid' }) zoneId!: string;
}

class ReferenceRegionResponseDto extends RegionResponseDto {
  @ApiProperty({ type: RegionGeometryConfirmationResponseDto, required: true })
  declare geometryConfirmation: RegionGeometryConfirmationResponseDto;
}

export class ReferenceRegionMutationResponseDto {
  @ApiProperty({ type: ReferenceRegionResponseDto }) region!: ReferenceRegionResponseDto;
  @ApiProperty() configurationVersion!: number;
}
