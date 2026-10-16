import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, Subject, throwError, type Observable } from 'rxjs';
import { createSoftwareRuntimeDrain } from '../src/common/http/software-runtime-drain.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
const context = {} as ExecutionContext;

test('HTTP response completion is awaited after the controller finishes', async () => {
  const drain = createSoftwareRuntimeDrain(),
    response = new EventEmitter();
  const http = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ExecutionContext;
  const value = lastValueFrom(
    drain.interceptor.intercept(http, { handle: () => of('committed') }) as Observable<string>,
  );
  assert.equal(await value, 'committed');
  assert.equal(drain.state().active, 1);
  let completed = false;
  const waiting = drain.stopAndWait(1000).then(() => {
    completed = true;
  });
  await Promise.resolve();
  assert.equal(completed, false);
  response.emit('finish');
  await waiting;
  assert.equal(drain.state().active, 0);
  assert.equal(response.listenerCount('finish'), 0);
  assert.equal(response.listenerCount('close'), 0);
});
test('client connection close does not finish pending controller work', async () => {
  const drain = createSoftwareRuntimeDrain(),
    response = new EventEmitter(),
    work = new Subject<string>();
  const http = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ExecutionContext;
  const value = lastValueFrom(
    drain.interceptor.intercept(http, { handle: () => work }) as Observable<string>,
  );
  response.emit('close');
  assert.equal(drain.state().active, 1);
  const waiting = drain.stopAndWait(1000);
  work.next('committed');
  work.complete();
  await value;
  await waiting;
  assert.equal(drain.state().active, 0);
});

test('unsubscribed pipelines do not count; subscribed controller work blocks drain', async () => {
  const drain = createSoftwareRuntimeDrain(),
    work = new Subject<string>();
  const pipeline = drain.interceptor.intercept(context, {
    handle: () => work,
  }) as Observable<string>;
  assert.deepEqual(drain.state(), { accepting: true, active: 0 });
  const result = lastValueFrom(pipeline);
  assert.equal(drain.state().active, 1);
  let settled = false;
  const stopping = drain.stopAndWait(1000).then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  work.next('completed');
  work.complete();
  assert.equal(await result, 'completed');
  await stopping;
  assert.deepEqual(drain.state(), { accepting: false, active: 0 });
});
test('draining rejects new work503 without invoking handler', async () => {
  const drain = createSoftwareRuntimeDrain();
  await drain.stopAndWait(1000);
  let invoked = false;
  const pipeline = drain.interceptor.intercept(context, {
    handle: () => {
      invoked = true;
      return of('unsafe');
    },
  }) as Observable<string>;
  await assert.rejects(
    lastValueFrom(pipeline),
    (error: unknown) => error instanceof PublicHttpException && error.getStatus() === 503,
  );
  assert.equal(invoked, false);
  assert.equal(drain.state().active, 0);
});
test('completion and observable failure remove active work', async () => {
  const drain = createSoftwareRuntimeDrain();
  const ok = drain.interceptor.intercept(context, { handle: () => of('ok') }) as Observable<string>;
  assert.equal(await lastValueFrom(ok), 'ok');
  assert.equal(drain.state().active, 0);
  const error = new Error('Synthetic controller failure');
  const failed = drain.interceptor.intercept(context, {
    handle: () => throwError(() => error),
  }) as Observable<string>;
  await assert.rejects(lastValueFrom(failed), error);
  assert.equal(drain.state().active, 0);
});
test('synchronous handler throw also removes active work', async () => {
  const drain = createSoftwareRuntimeDrain(),
    error = new Error('Synthetic synchronous refusal');
  const pipeline = drain.interceptor.intercept(context, {
    handle: () => {
      throw error;
    },
  } as CallHandler) as Observable<string>;
  await assert.rejects(lastValueFrom(pipeline), error);
  assert.equal(drain.state().active, 0);
});
test('explicit observable unsubscribe releases its subscription, not an external transaction guarantee', async () => {
  const drain = createSoftwareRuntimeDrain(),
    work = new Subject<string>();
  const pipeline = drain.interceptor.intercept(context, {
    handle: () => work,
  }) as Observable<string>;
  const subscription = pipeline.subscribe();
  assert.equal(drain.state().active, 1);
  const stopping = drain.stopAndWait(1000);
  subscription.unsubscribe();
  await stopping;
  assert.equal(drain.state().active, 0);
});
test('multiple independent waiters settle when the last active pipeline completes', async () => {
  const drain = createSoftwareRuntimeDrain(),
    first = new Subject<string>(),
    second = new Subject<string>();
  const a = lastValueFrom(
    drain.interceptor.intercept(context, { handle: () => first }) as Observable<string>,
  );
  const b = lastValueFrom(
    drain.interceptor.intercept(context, { handle: () => second }) as Observable<string>,
  );
  let settled = false;
  const waits = Promise.all([drain.stopAndWait(1000), drain.stopAndWait(1000)]).then(() => {
    settled = true;
  });
  first.next('a');
  first.complete();
  await a;
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(drain.state().active, 1);
  second.next('b');
  second.complete();
  await b;
  await waits;
  assert.equal(drain.state().active, 0);
  await drain.stopAndWait(1000);
});
test('deadline refuses an incomplete drain; later completion can satisfy a fresh wait', async () => {
  const drain = createSoftwareRuntimeDrain(),
    work = new Subject<string>();
  const value = lastValueFrom(
    drain.interceptor.intercept(context, { handle: () => work }) as Observable<string>,
  );
  await assert.rejects(drain.stopAndWait(5), /deadline exceeded/);
  assert.deepEqual(drain.state(), { accepting: false, active: 1 });
  const retry = drain.stopAndWait(1000);
  work.next('late');
  work.complete();
  await value;
  await retry;
  assert.equal(drain.state().active, 0);
});
test('invalid timeout bounds fail before changing intake', () => {
  for (const timeout of [0, -1, 0.5, NaN, Infinity, 2_147_483_648]) {
    const drain = createSoftwareRuntimeDrain();
    assert.throws(() => drain.stopAndWait(timeout), RangeError);
    assert.deepEqual(drain.state(), { accepting: true, active: 0 });
  }
});
