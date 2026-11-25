import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { convertFormDataAsync } from 'expo/src/winter/fetch/convertFormData';
import { Attachments } from './uploads';
import { translate as t } from '../../i18n';
const native = vi.hoisted(() => ({
  deleted: [] as string[],
  camera: vi.fn(),
  gallery: vi.fn(),
  document: vi.fn(),
}));
vi.mock('expo-image-picker', () => ({
  CameraType: { front: 'front', back: 'back' },
  requestCameraPermissionsAsync: async () => ({ granted: true }),
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
  'sends %s through the shared client and real Expo encoder before accepting the selection',
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
      return Response.json({ status: 'ACCEPTED', reason: 'IMAGE_ACCEPTED' });
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
      root = create(
        <Attachments
          files={[]}
          onChange={changed}
          validateFile={async (file) => {
            await client.checkDocumentImageQuality('synthetic-token', 'site', 'contractor', file);
          }}
        />,
      );
    });
    await act(async () => {
      button(
        source === 'camera'
          ? t('documents.camera')
          : source === 'gallery'
            ? t('documents.gallery')
            : t('uploads.chooseAttachment'),
      ).props.onPress();
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toContain('/contractors/contractor/document-image-quality');
    expect(encoded).toContain('SYNTHETIC DOCUMENT');
    expect(encoded).toContain(
      source === 'pdf' ? 'application/pdf' : source === 'file' ? 'image/png' : 'image/jpeg',
    );
    expect(encoded).not.toContain('cache://');
    expect(changed).toHaveBeenCalledTimes(1);
    const file = changed.mock.calls[0]![0][0];
    expect(typeof file.bytes).toBe('function');
    expect(Object.keys(file).sort()).toEqual(['name', 'type', 'uri']);
  },
);
it('offers camera and gallery, and rejects a blurry capture before selecting it', async () => {
  const changed = vi.fn();
  const validate = vi
    .fn()
    .mockRejectedValueOnce(new Error('Synthetic blurry document'))
    .mockResolvedValue(undefined);
  await act(async () => {
    root = create(
      <Attachments files={[]} onChange={changed} maxFiles={1} validateFile={validate} />,
    );
  });
  expect(button(t('documents.gallery'))).toBeTruthy();
  await act(async () => {
    button(t('documents.camera')).props.onPress();
  });
  expect(changed).not.toHaveBeenCalled();
  expect(JSON.stringify(root.toJSON())).toContain('Synthetic blurry document');
  expect(native.deleted).toContain('cache://document.jpg');
  await act(async () => {
    button(t('documents.camera')).props.onPress();
  });
  expect(changed).toHaveBeenCalledWith([
    { uri: 'cache://document.jpg', name: 'photo.jpg', type: 'image/jpeg' },
  ]);
});
it('validates gallery and selected files and limits citizen ID selection to images', async () => {
  const validate = vi.fn().mockResolvedValue(undefined);
  const changed = vi.fn();
  await act(async () => {
    root = create(
      <Attachments
        files={[]}
        onChange={changed}
        maxFiles={1}
        allowPdf={false}
        validateFile={validate}
      />,
    );
  });
  await act(async () => {
    button(t('documents.gallery')).props.onPress();
  });
  expect(native.gallery).toHaveBeenCalled();
  expect(validate).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/jpeg' }));
  await act(async () => {
    button('Chọn tệp đính kèm').props.onPress();
  });
  expect(native.document).toHaveBeenCalledWith(
    expect.objectContaining({ type: ['image/jpeg', 'image/png'] }),
  );
  expect(validate).toHaveBeenCalledWith({
    uri: 'cache://selected.png',
    name: 'synthetic.png',
    type: 'image/png',
  });
  expect(changed).toHaveBeenCalledTimes(2);
});
