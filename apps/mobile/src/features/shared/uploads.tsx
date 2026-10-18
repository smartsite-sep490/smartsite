import { useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { NativeUploadFile } from '@smartsite/api-client';
import { Body, Button, Card, ErrorNotice, Hint } from './ui';
import { useTranslation } from '../../i18n';

function removeCached(file: NativeUploadFile) {
  try {
    const prefix = Paths?.cache?.uri?.replace(/\/+$/, '') + '/';
    if (Paths?.cache?.uri && file.uri.startsWith(prefix)) {
      const cached = new File(file.uri);
      if (cached.exists) cached.delete();
    }
  } catch {
    /* Cache cleanup must not change a completed upload. */
  }
}

export async function capturePhoto(
  front = false,
  document = false,
): Promise<NativeUploadFile | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted)
    throw new Error('Cần quyền camera để chụp ảnh. Bạn có thể cấp quyền trong cài đặt thiết bị.');
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: document ? 1 : 0.7,
    cameraType: front ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
  });
  if (result.canceled || !result.assets[0]) return null;
  const original = new File(result.assets[0].uri);
  try {
    const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
    const context = ImageManipulator.manipulate(original.uri);
    context.resize({ width: Math.min(document ? 1920 : 1280, result.assets[0].width) });
    const image = await context.renderAsync();
    const saved = await image.saveAsync({
      format: SaveFormat.JPEG,
      compress: document ? 0.85 : 0.75,
    });
    const transformed = new File(saved.uri);
    if (transformed.size > (document ? 5 : 1) * 1024 * 1024) {
      transformed.delete();
      throw new Error(
        document
          ? 'Ảnh vượt 5 MB. Vui lòng chụp lại.'
          : 'Ảnh vượt 1 MB. Vui lòng chụp lại với khung hình gọn hơn.',
      );
    }
    return { uri: saved.uri, name: 'photo.jpg', type: 'image/jpeg' };
  } finally {
    if (original.exists) original.delete();
  }
}
export function Attachments({
  files,
  onChange,
  jpegOnly = false,
  maxFiles = 3,
  validateFile,
  allowPdf = true,
}: {
  files: NativeUploadFile[];
  onChange: (files: NativeUploadFile[]) => void;
  jpegOnly?: boolean;
  maxFiles?: number;
  validateFile?: (file: NativeUploadFile) => Promise<void>;
  allowPdf?: boolean;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null),
    [pending, setPending] = useState(false);
  const managed = !!validateFile;
  const owned = useRef(new Map<string, NativeUploadFile>());
  const previous = useRef(files);
  useEffect(() => {
    if (managed)
      for (const file of previous.current)
        if (!files.some((next) => next.uri === file.uri)) removeCached(file);
    previous.current = files;
  }, [files, managed]);
  useEffect(() => {
    const tracked = owned.current;
    return () => {
      if (managed) for (const file of tracked.values()) removeCached(file);
    };
  }, [managed]);
  const accept = async (file: NativeUploadFile) => {
    if (managed) owned.current.set(file.uri, file);
    try {
      await validateFile?.(file);
      onChange([...files, file]);
    } catch (e) {
      if (managed) removeCached(file);
      throw e;
    }
  };
  const add = async (source: 'camera' | 'gallery' | 'file') => {
    setPending(true);
    setError(null);
    try {
      if (source === 'camera') {
        const file = await capturePhoto(false, !!validateFile);
        if (file) await accept(file);
      } else if (source === 'gallery') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) throw new Error('Cần quyền thư viện ảnh để chọn ảnh giấy tờ.');
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 1,
        });
        const asset = !result.canceled ? result.assets[0] : undefined;
        if (asset) {
          const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
          const context = ImageManipulator.manipulate(asset.uri);
          context.resize({ width: Math.min(1920, asset.width) });
          const image = await context.renderAsync();
          const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
          const file = { uri: saved.uri, name: 'document-gallery.jpg', type: 'image/jpeg' };
          if (new File(saved.uri).size > 5 * 1024 * 1024) {
            removeCached(file);
            throw new Error('Mỗi ảnh tối đa 5 MB.');
          }
          await accept(file);
        }
      } else {
        const result = await DocumentPicker.getDocumentAsync({
          type: jpegOnly
            ? 'image/jpeg'
            : ['image/jpeg', 'image/png', ...(allowPdf ? ['application/pdf'] : [])],
          copyToCacheDirectory: true,
        });
        const asset = !result.canceled ? result.assets[0] : undefined;
        if (asset) {
          const size = asset.size ?? new File(asset.uri).size;
          if (size > (jpegOnly ? 1024 * 1024 : 5 * 1024 * 1024))
            throw new Error(jpegOnly ? 'Ảnh JPEG tối đa 1 MB.' : 'Mỗi tệp tối đa 5 MB.');
          const mime =
            asset.mimeType ??
            (asset.name.toLowerCase().endsWith('.pdf')
              ? 'application/pdf'
              : asset.name.toLowerCase().endsWith('.png')
                ? 'image/png'
                : 'image/jpeg');
          const file = { uri: asset.uri, name: asset.name, type: mime };
          await accept(file);
        }
      }
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  return (
    <View style={{ gap: 10 }}>
      <Hint>
        {jpegOnly
          ? 'Ảnh JPEG tối đa 1 MB.'
          : 'JPEG, PNG hoặc PDF. Mỗi tệp tối đa 5 MB; tổng tối đa 20 MB.'}
      </Hint>
      {files.map((file, index) => (
        <Card key={`${file.uri}:${index}`}>
          <Body>{file.name}</Body>
          {file.type.startsWith('image/') && (
            <Image
              source={{ uri: file.uri }}
              style={{ height: 140, borderRadius: 10 }}
              resizeMode="contain"
            />
          )}
          <Button
            secondary
            label={`Gỡ ${file.name}`}
            onPress={() => onChange(files.filter((_, i) => i !== index))}
          />
        </Card>
      ))}
      <ErrorNotice error={error} />
      <Button
        secondary
        label={validateFile ? t('documents.camera') : 'Chụp ảnh'}
        disabled={pending || files.length >= maxFiles}
        onPress={() => void add('camera')}
      />
      {validateFile && (
        <Button
          secondary
          label={t('documents.gallery')}
          disabled={pending || files.length >= maxFiles}
          onPress={() => void add('gallery')}
        />
      )}
      <Button
        secondary
        label="Chọn tệp đính kèm"
        disabled={pending || files.length >= maxFiles}
        onPress={() => void add('file')}
      />
    </View>
  );
}
export function EvidenceButton({
  load,
  mediaType,
  label = 'Xem bằng chứng',
}: {
  load: () => Promise<Blob>;
  mediaType: string;
  label?: string;
}) {
  const [uri, setUri] = useState(''),
    [error, setError] = useState<unknown>(null),
    [pending, setPending] = useState(false);
  const open = async () => {
    setPending(true);
    setError(null);
    try {
      const blob = await load();
      if (mediaType.startsWith('image/')) {
        const reader = new FileReader();
        setUri(
          await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          }),
        );
      } else {
        if (!(await Sharing.isAvailableAsync()))
          throw new Error('Thiết bị chưa hỗ trợ mở tệp PDF.');
        const file = new File(Paths.cache, `smartsite-evidence-${Date.now()}.pdf`);
        try {
          file.create();
          const reader = new FileReader();
          const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = reject;
            reader.readAsArrayBuffer(blob);
          });
          file.write(new Uint8Array(buffer));
          await Sharing.shareAsync(file.uri, { mimeType: mediaType });
        } finally {
          if (file.exists) file.delete();
        }
      }
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <Button secondary label={label} disabled={pending} onPress={() => void open()} />
      <ErrorNotice error={error} />
      {uri && (
        <>
          <Image source={{ uri }} style={{ height: 260 }} resizeMode="contain" />
          <Button secondary label="Đóng ảnh" onPress={() => setUri('')} />
        </>
      )}
    </View>
  );
}
