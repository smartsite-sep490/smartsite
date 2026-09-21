import { createHash, timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../../config/environment.js';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService<BackendEnvironment, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      rawHeaders?: string[];
    }>();

    if (Array.isArray(request.rawHeaders)) {
      let authHeaderCount = 0;
      for (let i = 0; i < request.rawHeaders.length; i += 2) {
        if (request.rawHeaders[i]?.toLowerCase() === 'authorization') {
          authHeaderCount++;
          if (authHeaderCount > 1) {
            throw new UnauthorizedException();
          }
        }
      }
    }

    const authHeader = request.headers['authorization'];
    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException();
    }

    const match = /^Bearer ([^\s]+)$/.exec(authHeader);
    const tokenPart = match?.[1];
    if (!tokenPart) {
      throw new UnauthorizedException();
    }
    const expectedToken = this.configService.getOrThrow('SMARTSITE_AI_SERVICE_TOKEN', {
      infer: true,
    });

    const expectedDigest = digest(expectedToken);
    const providedDigest = digest(tokenPart);

    if (!timingSafeEqual(expectedDigest, providedDigest)) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
