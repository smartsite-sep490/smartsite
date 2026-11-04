import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { CameraPreviewService } from '../src/modules/cameras/camera-preview.service.js';
const site = '11111111-1111-4111-8111-111111111111',
  camera = '22222222-2222-4222-8222-222222222222';
function fixture() {
  const state = {
    revoked: false,
    inactive: false,
    otherSite: false,
    calls: 0,
    badMime: false,
    badSha: false,
    tooLarge: false,
    revokeAfterRead: false,
    cameraReads: 0,
  };
  let onCameraRead: (read: number) => Promise<void> = async () => {};
  let onAuthorize = () => {};
  const bytes = Buffer.from('1234ftypisom-fixture');
  const service = new CameraPreviewService(
    {
      get: (k: string) =>
        k === 'SMARTSITE_AI_PREVIEW_SOURCES'
          ? { replay: 'http://127.0.0.1:8001' }
          : 'service-fixture',
    } as never,
    {
      authenticate: async () => {
        onAuthorize();
        if (state.revoked) throw new UnauthorizedException();
        return {
          user: {
            isActive: true,
            mustChangePassword: false,
            roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: state.otherSite ? camera : site }],
          },
        };
      },
    } as never,
    {
      get: async () => {
        await onCameraRead(++state.cameraReads);
        return {
          id: camera,
          siteId: site,
          externalId: 'replay',
          status: state.inactive ? 'INACTIVE' : 'ACTIVE',
        };
      },
    } as never,
    async (url, opts) => {
      state.calls++;
      assert.equal(new URL(String(url)).pathname, '/v1/realtime/recorded-video');
      assert.equal(new Headers(opts?.headers).get('Authorization'), 'Bearer service-fixture');
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(state.tooLarge ? new Uint8Array(2000001) : bytes);
            if (state.revokeAfterRead) state.revoked = true;
            c.close();
          },
        }),
        {
          headers: {
            'content-type': state.badMime ? 'text/html' : 'video/mp4',
            'x-camera-external-id': 'replay',
            'x-source-sha256': state.badSha
              ? '0'.repeat(64)
              : createHash('sha256').update(bytes).digest('hex'),
          },
        },
      );
    },
  );
  const read = () => {
    const fn = (
      service as unknown as {
        recordedVideo?: (
          t: string,
          s: string,
          c: string,
        ) => Promise<{ bytes: Buffer; externalId: string; sha256: string }>;
      }
    ).recordedVideo;
    assert.equal(typeof fn, 'function', 'Scoped recorded-video delivery is missing');
    return fn!.call(service, 'user-fixture', site, camera);
  };
  return {
    state,
    read,
    bytes,
    onCameraRead(value: typeof onCameraRead) {
      onCameraRead = value;
    },
    onAuthorize(value: typeof onAuthorize) {
      onAuthorize = value;
    },
  };
}
const status = (n: number) => (e: unknown) => (e as { getStatus(): number }).getStatus() === n;
for (const change of ['logout', 'role'] as const) {
  test(`recorded video refuses ${change} during final Camera read`, async () => {
    const f = fixture();
    f.onCameraRead(async (read) => {
      if (read !== 2) return;
      if (change === 'logout') f.state.revoked = true;
      else f.state.otherSite = true;
    });
    await assert.rejects(f.read(), status(change === 'logout' ? 401 : 403));
    assert.equal(f.state.calls, 1);
    assert.equal(f.state.cameraReads, 2);
  });
}
test('recorded video still refuses Camera deactivation during post-download authorization', async () => {
  const f = fixture();
  let checks = 0;
  f.onAuthorize(() => {
    if (++checks === 2) f.state.inactive = true;
  });
  await assert.rejects(f.read(), status(503));
});

test('recorded video relays exact bytes and only server allowlisted source', async () => {
  const f = fixture();
  const v = await f.read();
  assert.deepEqual(v.bytes, f.bytes);
  assert.equal(v.externalId, 'replay');
  assert.equal(f.state.calls, 1);
});
test('recorded video rejects revoked or cross-Site access before source fetch', async () => {
  for (const k of ['revoked', 'otherSite'] as const) {
    const f = fixture();
    f.state[k] = true;
    await assert.rejects(f.read(), status(k === 'revoked' ? 401 : 403));
    assert.equal(f.state.calls, 0);
  }
});
test('recorded video reauthorizes after download and denies late logout', async () => {
  const f = fixture();
  f.state.revokeAfterRead = true;
  await assert.rejects(f.read(), status(401));
});
test('recorded video refuses inactive camera, wrong MIME, oversized or corrupt source hash', async () => {
  for (const k of ['inactive', 'badMime', 'tooLarge', 'badSha'] as const) {
    const f = fixture();
    f.state[k] = true;
    await assert.rejects(f.read(), status(503));
  }
});
