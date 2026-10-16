import { IsISO8601, IsUUID, Matches } from 'class-validator';

/** Retained-main public DTOs. Actor and journal command IDs are server-only. */
class PermissionIntervalCommand {
  @IsUUID() requestId!: string;
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i)
  validFrom!: string;
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i)
  validUntil!: string;
}
export class GrantContractorZoneCommand extends PermissionIntervalCommand {
  @IsUUID() siteContractorId!: string;
  @IsUUID() zoneId!: string;
}
export class GrantWorkerZoneCommand extends PermissionIntervalCommand {
  @IsUUID() workerAssignmentId!: string;
  @IsUUID() contractorZonePermissionId!: string;
}
