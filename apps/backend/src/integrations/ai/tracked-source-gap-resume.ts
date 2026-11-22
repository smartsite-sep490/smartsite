import { Logger, type OnModuleDestroy } from '@nestjs/common';
import type { CameraSourceService } from '../../modules/cameras/camera-source.service.js';
import type { TrackedFrameKey } from './tracked-frame-admission.js';

/** Bounded per-process recovery. Uncertain outcomes require operator reconciliation. */
export class TrackedSourceGapResume implements OnModuleDestroy {
  private readonly logger = new Logger(TrackedSourceGapResume.name);
  private readonly starts = new Map<string, number>();
  private readonly attempted = new Set<string>();
  private readonly active = new Map<string, Promise<void>>();
  private stopping = false;

  constructor(
    private readonly sources: Pick<CameraSourceService, 'resumeAfterSourceGap'>,
    private readonly recheck: (key: Readonly<TrackedFrameKey>) => Promise<boolean>,
    cameraIds: readonly string[],
    private readonly maxStarts: number,
  ) {
    if (
      !cameraIds.length ||
      new Set(cameraIds).size !== cameraIds.length ||
      !Number.isSafeInteger(maxStarts) ||
      maxStarts < 1 ||
      maxStarts > 3
    )
      throw new Error('Invalid automatic camera recovery policy');
    for (const cameraId of cameraIds) this.starts.set(cameraId, 0);
  }

  /** false leaves a new generation's signal pending while a prior operation drains. */
  notify(input: Readonly<TrackedFrameKey>): boolean {
    const key = Object.freeze({ ...input });
    const count = this.starts.get(key.cameraId);
    if (this.stopping || count === undefined) return true;
    const identity = `${key.cameraId}/${key.generationId}/${key.streamSessionId}`;
    if (this.attempted.has(identity)) return true;
    if (this.active.has(key.cameraId)) return false;
    if (count >= this.maxStarts) {
      this.logger.warn({ event: 'CAMERA_RECOVERY_BUDGET_EXHAUSTED', cameraId: key.cameraId });
      return true;
    }
    this.starts.set(key.cameraId, count + 1);
    this.attempted.add(identity);
    const operation = Promise.resolve()
      .then(async () => {
        if (this.stopping || !(await this.recheck(key)) || this.stopping) return;
        try {
          await this.sources.resumeAfterSourceGap(
            key,
            async () => !this.stopping && (await this.recheck(key)) && !this.stopping,
          );
          this.logger.log({ event: 'CAMERA_SOURCE_GAP_RESUMED', cameraId: key.cameraId });
        } catch {
          this.logger.warn({ event: 'CAMERA_RECOVERY_REQUIRES_ATTENTION', cameraId: key.cameraId });
        }
      })
      .catch(() => {
        this.logger.warn({ event: 'CAMERA_RECOVERY_RECHECK_UNAVAILABLE', cameraId: key.cameraId });
      })
      .finally(() => {
        this.active.delete(key.cameraId);
      });
    this.active.set(key.cameraId, operation);
    return true;
  }

  async onModuleDestroy() {
    this.stopping = true;
    await Promise.allSettled(this.active.values());
  }
}
