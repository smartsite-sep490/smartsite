import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { BackendEnvironment } from '../../config/environment.js';

const ACCESS_TOKEN_SECONDS = 15 * 60;
export const REFRESH_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const JWT_ISSUER = 'smartsite-backend';
const JWT_AUDIENCE = 'smartsite-clients';
const REFRESH_TOKEN_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i;

interface AccessClaims {
  sub: string;
  sid: string;
  typ: 'access';
  iat: number;
  exp: number;
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

@Injectable()
export class AuthTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<BackendEnvironment, true>,
  ) {}

  async issueAccessToken(userId: string, sessionId: string) {
    const issuedAtSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = issuedAtSeconds + ACCESS_TOKEN_SECONDS;
    const accessToken = await this.jwt.signAsync(
      {
        sub: userId,
        sid: sessionId,
        typ: 'access',
        iat: issuedAtSeconds,
        exp: expiresAtSeconds,
      } satisfies AccessClaims,
      {
        algorithm: 'HS256',
        audience: JWT_AUDIENCE,
        issuer: JWT_ISSUER,
        secret: this.config.get('AUTH_JWT_SECRET', { infer: true }),
      },
    );
    return { accessToken, expiresAt: new Date(expiresAtSeconds * 1000) };
  }

  async verifyAccessToken(token: string) {
    try {
      const claims = await this.jwt.verifyAsync<AccessClaims>(token, {
        algorithms: ['HS256'],
        audience: JWT_AUDIENCE,
        issuer: JWT_ISSUER,
        secret: this.config.get('AUTH_JWT_SECRET', { infer: true }),
      });
      if (
        claims.typ !== 'access' ||
        typeof claims.sub !== 'string' ||
        typeof claims.sid !== 'string' ||
        !Number.isSafeInteger(claims.iat) ||
        !Number.isSafeInteger(claims.exp)
      )
        throw new UnauthorizedException();
      return {
        userId: claims.sub,
        sessionId: claims.sid,
        issuedAt: new Date(claims.iat * 1000),
        expiresAt: new Date(claims.exp * 1000),
      };
    } catch {
      throw new UnauthorizedException();
    }
  }

  issueRefreshToken(sessionId: string) {
    const secret = randomBytes(32).toString('base64url');
    return {
      refreshToken: `${sessionId}.${secret}`,
      secretHash: hashSecret(secret),
    };
  }

  parseRefreshToken(token: string) {
    const match = REFRESH_TOKEN_PATTERN.exec(token);
    if (!match?.[1] || !match[2]) throw new UnauthorizedException();
    return { sessionId: match[1].toLowerCase(), secretHash: hashSecret(match[2]) };
  }
}
