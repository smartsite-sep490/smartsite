import { createHash, timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();

    const authHeader = request.headers['authorization'];
    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException();
    }

    const trimmed = authHeader.trim();
    if (!trimmed.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }

    const tokenPart = trimmed.slice(7).trim();
    if (!tokenPart || tokenPart.includes(' ')) {
      throw new UnauthorizedException();
    }

    const expectedToken = this.configService.getOrThrow<string>('SMARTSITE_AI_SERVICE_TOKEN');

    const expectedDigest = digest(expectedToken);
    const providedDigest = digest(tokenPart);

    if (!timingSafeEqual(expectedDigest, providedDigest)) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
