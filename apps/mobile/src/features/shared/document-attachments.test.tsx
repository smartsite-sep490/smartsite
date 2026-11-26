import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { convertFormDataAsync } from 'expo/src/winter/fetch/convertFormData';
import { SingleDocumentAttachment } from './uploads';
import { translate as t } from '../../i18n';
const native = vi.hoisted(() => ({
  deleted: [] as string[],
  camera: vi.fn(),
  gallery: vi.fn(),
  document: vi.fn(),
  cameraPermission: vi.fn(),
}));
vi.mock('expo-image-picker', () => ({
  CameraType: { front: 'front', back: 'back' },
  requestCameraPermissionsAsync: native.cameraPermission,
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  launchCameraAsync: native.camera,
  launchImageLibraryAsync: native.gallery,
}));
vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: {
    manipulate: () => ({
      resize: () => {},
      renderAsync: async () => ({ saveAsync: async () => ({ uri: 'cache://document.jpg' }) }),
    }),
  },
  SaveFormat: { JPEG: 'jpeg' },
}));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: native.document }));
vi.mock('expo-sharing', () => ({}));
vi.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'cache://' } },
  File: class {
    exists = true;
    size = 500000;
    constructor(public uri: string) {}
    async bytes() {
      return new TextEncoder().encode('SYNTHETIC DOCUMENT');
    }
    delete() {
      native.deleted.push(this.uri);
    }
  },
}));
let root: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks();
  native.deleted.length = 0;
  native.cameraPermission.mockResolvedValue({ granted: true });
  native.camera.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'cache://camera.jpg', width: 4000, height: 3000 }],
  });
  native.gallery.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'photos://existing', width: 2000, height: 1500 }],
  });
  native.document.mockResolvedValue({
    canceled: false,
    assets: [
      { uri: 'cache://selected.png', name: 'synthetic.png', mimeType: 'image/png', size: 500000 },
    ],
  });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
const button = (label: string) =>
  root.root.findAll(
    (n) => String(n.type) === 'Pressable' && n.props.accessibilityLabel === label,
  )[0]!;

it.each(['camera', 'gallery', 'file', 'pdf'] as const)(
  'uploads %s from the attachment picker using the shared client and the real Expo encoder',
  async (source) => {
    class NativeForm {
      parts: [string, unknown][] = [];
      append(name: string, value: unknown) {
        this.parts.push([name, value]);
      }
      entries() {
        return this.parts[Symbol.iterator]();
      }
    }
    vi.stubGlobal('FormData', NativeForm);
    let encoded = '';
    const request = vi.fn(async (_url: string, init: RequestInit) => {
      const { body } = await convertFormDataAsync(init.body as FormData, 'test-boundary');
      encoded = new TextDecoder().decode(body);
      return Response.json({ id: 'draft' });
    });
    vi.stubGlobal('fetch', request);
    if (source === 'pdf')
      native.document.mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: 'cache://synthetic.pdf',
            name: 'synthetic.pdf',
            mimeType: 'application/pdf',
            size: 500000,
          },
        ],
      });
    const client = new SmartSiteManagementClient('https://api.example.test');
    const changed = vi.fn();
    await act(async () => {
      root = create(<SingleDocumentAttachment label="Document" onChange={changed} />);
    });
    await act(async () => {
      button(t('onboarding.attachFile') + ': Document').props.onPress();
    });
    await act(async () => {
      const label =
        source === 'camera'
          ? t('uploads.takePhoto')
          : source === 'gallery'
            ? t('onboarding.choosePhoto')
            : t('uploads.chooseAttachment');
      button(label + ': Document').props.onPress();
    });
    expect(changed).toHaveBeenCalledTimes(1);
    const file = changed.mock.calls[0]![0];
    await client.saveWorkerOnboardingDraft(
      'synthetic-token',
      'site',
      'contractor',
      'draft',
      {
        expectedVersion: 0,
        displayName: 'Synthetic',
        username: '',
        email: '',
        safetyCardRequired: null,
        documents: { HEALTH_CERTIFICATE: {} },
      },
      { HEALTH_CERTIFICATE: file },
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toContain(
      '/contractors/contractor/worker-onboarding-drafts/draft',
    );
    expect(encoded).toContain('SYNTHETIC DOCUMENT');
    expect(encoded).toContain(
      source === 'pdf' ? 'application/pdf' : source === 'file' ? 'image/png' : 'image/jpeg',
    );
    expect(encoded).not.toContain('cache://');
    expect(typeof file.bytes).toBe('function');
    expect(Object.keys(file).sort()).toEqual(['name', 'type', 'uri']);
  },
);
it('offers image sources only for citizen ID and explains permission denial before selection', async () => {
  const changed = vi.fn();
  native.cameraPermission.mockResolvedValueOnce({ granted: false });
  await act(async () => {
    root = create(<SingleDocumentAttachment label="Front" identity onChange={changed} />);
  });
  expect(button(t('onboarding.choosePhoto') + ': Front')).toBeTruthy();
  expect(button(t('uploads.chooseAttachment') + ': Front')).toBeUndefined();
  await act(async () => {
    button(t('uploads.takePhoto') + ': Front').props.onPress();
  });
  expect(changed).not.toHaveBeenCalled();
  expect(JSON.stringify(root.toJSON())).toContain(t('uploads.cameraPermission'));
  await act(async () => {
    button(t('onboarding.choosePhoto') + ': Front').props.onPress();
  });
  expect(native.gallery).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenCalledWith({
    uri: 'cache://document.jpg',
    name: 'document-gallery.jpg',
    type: 'image/jpeg',
  });
  expect(native.document).not.toHaveBeenCalled();
});
