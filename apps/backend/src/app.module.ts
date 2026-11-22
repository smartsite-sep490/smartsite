import { Module, type ExecutionContext } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { validateEnvironment, type BackendEnvironment } from './config/environment.js';
import { runtimeEnvironmentOptions } from './config/runtime-environment.js';
import { HttpExceptionFilter } from './common/http/http-exception.filter.js';
import { createLoggerParams } from './observability/logger.js';
import { TrackedFrameRuntimeModule } from './integrations/ai/tracked-frame-runtime.module.js';
import { TrackedFrameEvidenceController } from './integrations/ai/tracked-frame-evidence.controller.js';
import {
  TrackedFrameResultController,
  TrackedRawPartController,
} from './integrations/ai/tracked-frame-result.controller.js';
import { AiIntegrationModule } from './integrations/ai/ai-integration.module.js';
import { AiIngestionController } from './integrations/ai/ai-ingestion.controller.js';
import { AiConfigurationController } from './integrations/ai/ai-configuration.controller.js';
import { HealthModule } from './modules/health/health.module.js';
import { SitesModule } from './modules/sites/sites.module.js';
import { CamerasModule } from './modules/cameras/cameras.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { GatesModule } from './modules/gates/gates.module.js';
import { WorkforceModule } from './modules/workforce/workforce.module.js';

function isAiEndpoint(context: ExecutionContext): boolean {
  return (
    context.getClass() === AiIngestionController ||
    context.getClass() === AiConfigurationController ||
    context.getClass() === TrackedFrameResultController ||
    context.getClass() === TrackedRawPartController ||
    context.getClass() === TrackedFrameEvidenceController
  );
}

function configuredRuntimeImports() {
  let trackedPolicy: BackendEnvironment['AI_TRACKED_FRAME_RUNTIME_POLICY'];
  const config = ConfigModule.forRoot({
    isGlobal: true,
    ...runtimeEnvironmentOptions(),
    validate: (input) => {
      const environment = validateEnvironment(input);
      trackedPolicy = environment.AI_TRACKED_FRAME_RUNTIME_ENABLED
        ? environment.AI_TRACKED_FRAME_RUNTIME_POLICY
        : undefined;
      return environment;
    },
    skipProcessEnv: true,
  });
  return [config, config.then(() => TrackedFrameRuntimeModule.register(trackedPolicy))];
}
@Module({
  imports: [
    ...configuredRuntimeImports(),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<BackendEnvironment, true>) => createLoggerParams(config),
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<BackendEnvironment, true>) => [
        {
          // One bucket per route/IP. AI uses its own budget, never an additional lower HTTP limit.
          ttl: (context: ExecutionContext) =>
            config.get(isAiEndpoint(context) ? 'AI_RATE_LIMIT_TTL_MS' : 'HTTP_RATE_LIMIT_TTL_MS', {
              infer: true,
            }),
          limit: (context: ExecutionContext) =>
            config.get(isAiEndpoint(context) ? 'AI_RATE_LIMIT_LIMIT' : 'HTTP_RATE_LIMIT_LIMIT', {
              infer: true,
            }),
        },
      ],
    }),
    HealthModule,
    SitesModule,
    GatesModule,
    CamerasModule,
    AuthModule,
    UsersModule,
    WorkforceModule,
    AiIntegrationModule,
  ],
  providers: [
    HttpExceptionFilter,
    { provide: APP_FILTER, useExisting: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
