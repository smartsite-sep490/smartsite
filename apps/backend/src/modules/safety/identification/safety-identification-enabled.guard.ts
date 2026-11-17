import { Injectable, type CanActivate } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../../../config/environment.js';
import { missing } from '../../../common/configuration/commands.js';

/** Source integration alone must not expose routes against an unmigrated website schema. */
@Injectable()
export class SafetyIdentificationEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService<BackendEnvironment, true>) {}

  canActivate(): boolean {
    if (this.config.get('SAFETY_IDENTIFICATION_ENABLED', { infer: true }) !== true) missing();
    return true;
  }
}
