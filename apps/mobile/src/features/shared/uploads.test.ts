import { beforeEach, describe, expect, it, vi } from 'vitest';

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
