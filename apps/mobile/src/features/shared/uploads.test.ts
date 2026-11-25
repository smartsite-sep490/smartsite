import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convertFormDataAsync } from 'expo/src/winter/fetch/convertFormData';

const camera = vi.hoisted(() => ({
  permission: vi.fn(),
  capture: vi.fn(),
  save: vi.fn(),
  resize: vi.fn(),
  deleted: [] as string[],
  size: 500_000,
}));
vi.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: camera.permission,
  launchCameraAsync: camera.capture,
  CameraType: { front: 'front', back: 'back' },
}));
vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: {
    manipulate: () => ({
      resize: camera.resize,
      renderAsync: async () => ({ saveAsync: camera.save }),
    }),
  },
  SaveFormat: { JPEG: 'jpeg' },
}));
vi.mock('expo-file-system', () => ({
  File: class {
    constructor(public uri: string) {}
    exists = true;
    get size() {
      return camera.size;
    }
    async bytes() {
      return new Uint8Array([83, 89, 78, 84, 72, 69, 84, 73, 67]);
    }
    delete() {
      camera.deleted.push(this.uri);
    }
  },
  Paths: {},
}));
vi.mock('expo-document-picker', () => ({}));
vi.mock('expo-sharing', () => ({}));

import { capturePhoto } from './uploads';

beforeEach(() => {
  vi.clearAllMocks();
  camera.deleted.length = 0;
  camera.size = 500_000;
  camera.permission.mockResolvedValue({ granted: true });
  camera.capture.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'cache://raw.jpg', width: 4000, height: 3000 }],
  });
  camera.save.mockResolvedValue({ uri: 'cache://resized.jpg' });
});

describe('camera photo preparation', () => {
  it('encodes a camera document using the installed Expo multipart encoder', async () => {
    const file = await capturePhoto(false, true);
    const form = {
      entries: () => [['file', file]][Symbol.iterator](),
    } as unknown as FormData;
    const result = await convertFormDataAsync(form, 'synthetic-boundary');
    const body = new TextDecoder().decode(result.body);
    expect(body).toContain('name="file"; filename="photo.jpg"');
    expect(body).toContain('content-type: image/jpeg');
    expect(body).toContain('SYNTHETIC');
    expect(body).not.toContain('cache://');
  });
  it('returns a bounded JPEG and removes the original camera capture', async () => {
    await expect(capturePhoto(true)).resolves.toEqual({
      uri: 'cache://resized.jpg',
      name: 'photo.jpg',
      type: 'image/jpeg',
    });
    expect(camera.capture).toHaveBeenCalledWith(expect.objectContaining({ cameraType: 'front' }));
    expect(camera.resize).toHaveBeenCalledWith({ width: 1280 });
    expect(camera.deleted).toEqual(['cache://raw.jpg']);
  });
  it('rejects oversized images and cleans both generated files', async () => {
    camera.size = 2_000_000;
    await expect(capturePhoto()).rejects.toThrow('1 MB');
    expect(camera.deleted).toEqual(['cache://resized.jpg', 'cache://raw.jpg']);
  });
  it('cleans the original capture if conversion fails', async () => {
    camera.save.mockRejectedValue(new Error('image conversion failed'));
    await expect(capturePhoto()).rejects.toThrow('image conversion failed');
    expect(camera.deleted).toEqual(['cache://raw.jpg']);
  });
  it('does not launch the camera without permission or process a cancelled capture', async () => {
    camera.permission.mockResolvedValueOnce({ granted: false });
    await expect(capturePhoto()).rejects.toThrow('camera');
    expect(camera.capture).not.toHaveBeenCalled();
    camera.capture.mockResolvedValueOnce({ canceled: true });
    await expect(capturePhoto()).resolves.toBeNull();
    expect(camera.save).not.toHaveBeenCalled();
    expect(camera.deleted).toEqual([]);
  });
});
