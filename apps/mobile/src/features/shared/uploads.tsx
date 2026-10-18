import { useState } from 'react';
import { Image, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { NativeUploadFile } from '@smartsite/api-client';
import { Body, Button, Card, ErrorNotice, Hint } from './ui';

export async function capturePhoto(front = false): Promise<NativeUploadFile | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted)
    throw new Error('Cần quyền camera để chụp ảnh. Bạn có thể cấp quyền trong cài đặt thiết bị.');
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.7,
    cameraType: front ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
  });
  if (result.canceled || !result.assets[0]) return null;
  const original = new File(result.assets[0].uri);
  try {
    const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
    const context = ImageManipulator.manipulate(original.uri);
    context.resize({ width: 1280 });
    const image = await context.renderAsync();
    const saved = await image.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.75,
    });
    const transformed = new File(saved.uri);
    if (transformed.size > 1024 * 1024) {
      transformed.delete();
      throw new Error('Ảnh vượt 1 MB. Vui lòng chụp lại với khung hình gọn hơn.');
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
}: {
  files: NativeUploadFile[];
  onChange: (files: NativeUploadFile[]) => void;
  jpegOnly?: boolean;
  maxFiles?: number;
}) {
  const [error, setError] = useState<unknown>(null),
    [pending, setPending] = useState(false);
  const add = async (source: 'camera' | 'file') => {
    setPending(true);
    setError(null);
    try {
      if (source === 'camera') {
        const file = await capturePhoto();
        if (file) onChange([...files, file]);
      } else {
        const result = await DocumentPicker.getDocumentAsync({
          type: jpegOnly ? 'image/jpeg' : ['image/jpeg', 'image/png', 'application/pdf'],
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
          onChange([...files, file]);
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
        label="Chụp ảnh"
        disabled={pending || files.length >= maxFiles}
        onPress={() => void add('camera')}
      />
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
