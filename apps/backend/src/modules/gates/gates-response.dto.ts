import { ApiProperty } from '@nestjs/swagger';
export class PublicGateDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}
export class GateDto extends PublicGateDto {
  @ApiProperty({ format: 'uuid' }) siteId!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: 'ACTIVE' | 'INACTIVE';
}
export class GatePageDto {
  @ApiProperty({ type: [GateDto] }) items!: GateDto[];
  @ApiProperty() total!: number;
}
export class PublicGatePageDto {
  @ApiProperty({ type: [PublicGateDto] }) items!: PublicGateDto[];
}
export class GateSourceDto extends PublicGateDto {
  @ApiProperty({ format: 'uuid' }) gateId!: string;
  @ApiProperty({ format: 'uuid' }) siteId!: string;
}
export class GateSourcePageDto {
  @ApiProperty({ type: [GateSourceDto] }) items!: GateSourceDto[];
}
