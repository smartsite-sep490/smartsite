import { Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { TrackedFrameAdmission } from './tracked-frame-admission.js';
import { expireTrackedPending } from './tracked-pending-expiry.js';

interface TrackedRecoveryOptions {
  cameraIds: readonly string[];
  intervalMs: number;
  maxFramesPerCamera: number;
}

/** Prototype lifecycle provider. Registration requires an explicit trusted camera policy. */
export class TrackedFrameRecovery implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TrackedFrameRecovery.name);
  private readonly options: TrackedRecoveryOptions;
  private active?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private stopping = false;

  constructor(
    private readonly source: DataSource,
    private readonly admission: TrackedFrameAdmission,
    options: TrackedRecoveryOptions,
  ) {
    const { cameraIds, intervalMs, maxFramesPerCamera } = options;
    if (
      !cameraIds.length ||
      cameraIds.some((id) => !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) ||
      !Number.isSafeInteger(intervalMs) ||
      intervalMs < 1 ||
      intervalMs > 2_147_483_647 ||
      !Number.isSafeInteger(maxFramesPerCamera) ||
      maxFramesPerCamera < 1
    )
      throw new Error('Invalid tracked recovery options');
    this.options = { cameraIds: [...new Set(cameraIds)], intervalMs, maxFramesPerCamera };
  }

  onApplicationBootstrap() {
    if (!this.active && !this.timer && !this.stopping) this.run();
  }

  async onModuleDestroy() {
    this.stopping = true;
    clearTimeout(this.timer);
    await this.active;
  }

  private run() {
    this.active = this.sweep().finally(() => {
      this.active = undefined;
      if (!this.stopping) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.run();
        }, this.options.intervalMs);
        this.timer.unref();
      }
    });
  }

  private async sweep() {
    const { cameraIds, maxFramesPerCamera } = this.options;
    for (const cameraId of cameraIds) {
      if (this.stopping) break;
      try {
        await expireTrackedPending(this.source, [cameraId], maxFramesPerCamera);
        if (!this.stopping)
          await this.admission.recoverCurrent(this.source, cameraId, maxFramesPerCamera);
      } catch {
        this.logger.warn('Tracked frame recovery failed for a configured camera');
      }
    }
  }
}
