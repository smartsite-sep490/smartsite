import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { defer, finalize } from 'rxjs';
import { PublicHttpException } from './public-http-exception.js';

/** Explicit local software shutdown: drain subscribed controller work before closing Vite/Nest. */
export function createSoftwareRuntimeDrain() {
  let accepting = true;
  let active = 0;
  const waiting = new Set<{ resolve: () => void; timer: ReturnType<typeof setTimeout> }>();
  const completed = () => {
    active--;
    if (active === 0)
      for (const waiter of waiting) {
        clearTimeout(waiter.timer);
        waiting.delete(waiter);
        waiter.resolve();
      }
  };
  const interceptor: NestInterceptor = {
    intercept(context: ExecutionContext, next: CallHandler) {
      return defer(() => {
        if (!accepting)
          throw new PublicHttpException(503, {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Software runtime is stopping',
          });
        active++;
        let workDone = false;
        let responseDone = true;
        let released = false;
        type ResponseLifecycle = {
          writableFinished?: boolean;
          destroyed?: boolean;
          once: (event: string, listener: () => void) => unknown;
          removeListener: (event: string, listener: () => void) => unknown;
        };
        const response =
          typeof context.getType === 'function' && context.getType() === 'http'
            ? context.switchToHttp().getResponse<ResponseLifecycle>()
            : undefined;
        const removeListeners = () => {
          response?.removeListener('finish', responseEnded);
          response?.removeListener('close', responseEnded);
        };
        const release = () => {
          if (!released && workDone && responseDone) {
            released = true;
            removeListeners();
            completed();
          }
        };
        function responseEnded() {
          responseDone = true;
          removeListeners();
          release();
        }
        if (response) {
          responseDone = response.writableFinished === true || response.destroyed === true;
          if (!responseDone) {
            response.once('finish', responseEnded);
            response.once('close', responseEnded);
          }
        }
        return defer(() => next.handle()).pipe(
          finalize(() => {
            workDone = true;
            release();
          }),
        );
      });
    },
  };
  return {
    interceptor,
    state: () => ({ accepting, active }),
    stopAndWait(timeoutMs: number): Promise<void> {
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
        throw new RangeError('Drain timeout must be a positive bounded integer');
      accepting = false;
      if (active === 0) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const waiter = {
          resolve,
          timer: setTimeout(() => {
            waiting.delete(waiter);
            reject(new Error('Software controller drain deadline exceeded'));
          }, timeoutMs),
        };
        waiting.add(waiter);
      });
    },
  };
}
