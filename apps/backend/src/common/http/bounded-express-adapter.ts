import { ExpressAdapter } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import type { Server } from 'node:http';

/** HTTP drain only. Deadline disconnection is not graceful command/DB acceptance. */
export class BoundedExpressAdapter extends ExpressAdapter {
  private readonly drainLogger = new Logger(BoundedExpressAdapter.name);
  private deadline: NodeJS.Timeout | undefined;
  private closing: Promise<void> | undefined;
  private draining = false;
  private exceeded = false;

  // Leave 3s of the 30s process target for final Nest/database teardown.
  // This bounds HTTP waiting; total shutdown still needs runtime qualification.
  constructor(readonly drainTimeoutMs = 27_000) {
    super();
    if (!Number.isSafeInteger(drainTimeoutMs) || drainTimeoutMs < 1 || drainTimeoutMs > 30_000) {
      throw new RangeError('HTTP drain timeout must be between 1 and 30000 milliseconds');
    }
  }

  get isDraining(): boolean {
    return this.draining;
  }

  get drainDeadlineExceeded(): boolean {
    return this.exceeded;
  }

  override beforeClose(): void {
    super.beforeClose();
    if (this.draining) return;
    this.draining = true;
    this.deadline = setTimeout(() => {
      this.exceeded = true;
      this.drainLogger.warn(
        'HTTP drain deadline exceeded; disconnecting remaining HTTP connections',
      );
      const server = this.getHttpServer() as Server | undefined;
      server?.closeAllConnections();
    }, this.drainTimeoutMs);
    this.deadline.unref();
  }

  override close(): Promise<void> {
    this.beforeClose();
    this.closing ??= Promise.resolve(super.close())
      .then(() => undefined)
      .finally(() => {
        clearTimeout(this.deadline);
        this.deadline = undefined;
      });
    return this.closing;
  }
}
