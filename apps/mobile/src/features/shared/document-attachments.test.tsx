import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
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
});
const button = (label: string) =>
  root.root.findAll(
    (n) => String(n.type) === 'Pressable' && n.props.accessibilityLabel === label,
  )[0]!;
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
