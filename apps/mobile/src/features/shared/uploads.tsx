import { translate as tr } from '../../i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Image, Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { NativeUploadFile } from '@smartsite/api-client';
import { Card, ErrorNotice, Hint } from './ui';
import { IconCamera, IconDocument, IconTrash, IconEye } from '../../components/common/Icons';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';

function uploadFile(uri: string, name: string, type: string): NativeUploadFile {
  const source = new File(uri);
  if (!source.exists || source.size <= 0) throw new Error(tr('uploads.fileUnavailable'));
  // Expo 58 fetch encodes bytes(), whereas RN fetch consumes uri. Keep the reader
  // non-enumerable so RN's getParts() and draft fingerprints retain plain metadata.
  return Object.defineProperty({ uri, name, type }, 'bytes', {
    value: () => source.bytes(),
  });
}

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
  if (!permission.granted) throw new Error(tr('uploads.cameraPermission'));
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
      throw new Error(document ? tr('uploads.photoTooLarge') : tr('uploads.evidencePhotoTooLarge'));
    }
    return uploadFile(saved.uri, 'photo.jpg', 'image/jpeg');
  } finally {
    if (original.exists) original.delete();
  }
}

async function pickDocumentPhoto() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error(tr('uploads.libraryPermission'));
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  const asset = !result.canceled ? result.assets[0] : undefined;
  if (!asset) return null;
  const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
  const context = ImageManipulator.manipulate(asset.uri);
  context.resize({ width: Math.min(1920, asset.width) });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  const file = uploadFile(saved.uri, 'document-gallery.jpg', 'image/jpeg');
  if (new File(saved.uri).size > 5 * 1024 * 1024) {
    removeCached(file);
    throw new Error(tr('uploads.imageSizeLimit'));
  }
  return file;
}

async function pickDocumentFile(jpegOnly: boolean) {
  const result = await DocumentPicker.getDocumentAsync({
    type: jpegOnly ? 'image/jpeg' : ['image/jpeg', 'image/png', 'application/pdf'],
    copyToCacheDirectory: true,
  });
  const asset = !result.canceled ? result.assets[0] : undefined;
  if (!asset) return null;
  const size = asset.size ?? new File(asset.uri).size;
  const mime =
    asset.mimeType ??
    (asset.name.toLowerCase().endsWith('.pdf')
      ? 'application/pdf'
      : asset.name.toLowerCase().endsWith('.png')
        ? 'image/png'
        : 'image/jpeg');
  const file = uploadFile(asset.uri, asset.name, mime);
  if (size > (jpegOnly ? 1 : 5) * 1024 * 1024) {
    removeCached(file);
    throw new Error(jpegOnly ? tr('uploads.jpegSizeLimit') : tr('uploads.fileSizeLimit'));
  }
  return file;
}

export function SingleDocumentAttachment({
  label,
  file,
  onChange,
  savedName,
  savedPreview,
  identity = false,
  disabled = false,
  onPickingChange,
}: {
  label: string;
  file?: NativeUploadFile;
  onChange: (file: NativeUploadFile | undefined) => void;
  savedName?: string;
  savedPreview?: ReactNode;
  identity?: boolean;
  disabled?: boolean;
  onPickingChange?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [expanded, setExpanded] = useState(false);
  const current = useRef<NativeUploadFile | undefined>(file);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (current.current) removeCached(current.current);
    };
  }, []);
  useEffect(() => {
    if (current.current && current.current.uri !== file?.uri) removeCached(current.current);
    current.current = file;
  }, [file]);
  const add = async (source: 'gallery' | 'camera' | 'file') => {
    if (pending || disabled) return;
    setPending(true);
    onPickingChange?.(true);
    setError(null);
    try {
      const picked =
        source === 'gallery'
          ? await pickDocumentPhoto()
          : source === 'camera'
            ? await capturePhoto(false, true)
            : await pickDocumentFile(false);
      if (!picked) return;
      if (!mounted.current) {
        removeCached(picked);
        return;
      }
      if (current.current && current.current.uri !== picked.uri) removeCached(current.current);
      current.current = picked;
      onChange(picked);
      setExpanded(false);
    } catch (e) {
      if (mounted.current) setError(e);
    } finally {
      if (mounted.current) setPending(false);
      onPickingChange?.(false);
    }
  };
  const actions = [
    {
      key: 'gallery',
      text: t(
        identity && (file || savedName)
          ? 'onboarding.chooseAnotherPhoto'
          : 'onboarding.choosePhoto',
      ),
    },
    {
      key: 'camera',
      text: t(identity && (file || savedName) ? 'onboarding.retakePhoto' : 'uploads.takePhoto'),
    },
    ...(!identity ? [{ key: 'file' as const, text: t('uploads.chooseAttachment') }] : []),
  ] as const;
  return (
    <View style={uploadStyles.compactAttachment}>
      <View style={uploadStyles.fileItemHeader}>
        <View style={uploadStyles.compactCopy}>
          <Text style={uploadStyles.compactTitle}>{label}</Text>
          <Text numberOfLines={1} style={uploadStyles.compactName}>
            {file?.name || savedName || t('documents.noFile')}
          </Text>
        </View>
        {!identity && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t(file || savedName ? 'onboarding.replaceFile' : 'onboarding.attachFile')}: ${label}`}
            accessibilityState={{ expanded, disabled }}
            disabled={disabled || pending}
            style={uploadStyles.compactButton}
            onPress={() => setExpanded(!expanded)}
          >
            <Text style={uploadStyles.compactAction}>
              {t(file || savedName ? 'onboarding.replaceFile' : 'onboarding.attachFile')}
            </Text>
          </Pressable>
        )}
      </View>
      {file?.type.startsWith('image/') && (
        <Image
          source={{ uri: file.uri }}
          style={uploadStyles.compactImage}
          resizeMode="contain"
          accessibilityLabel={label}
        />
      )}
      {!file && savedPreview}
      {(identity || expanded) && (
        <View style={uploadStyles.compactActions}>
          {actions.map(({ key, text }) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`${text}: ${label}`}
              disabled={disabled || pending}
              style={uploadStyles.compactButton}
              onPress={() => void add(key)}
            >
              <Text style={uploadStyles.compactAction}>{text}</Text>
            </Pressable>
          ))}
          {!!file && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('uploads.removeFile', { name: file.name })}
              disabled={disabled || pending}
              style={uploadStyles.compactButton}
              onPress={() => onChange(undefined)}
            >
              <Text style={uploadStyles.compactAction}>{t('common.cancel')}</Text>
            </Pressable>
          )}
        </View>
      )}
      {pending && <Hint>{t('onboarding.preparingFile')}</Hint>}
      <ErrorNotice error={error} />
    </View>
  );
}

export function Attachments({
  files,
  onChange,
  jpegOnly = false,
  maxFiles = 3,
  disabled = false,
}: {
  files: NativeUploadFile[];
  onChange: (files: NativeUploadFile[]) => void;
  jpegOnly?: boolean;
  maxFiles?: number;
  disabled?: boolean;
}) {
  useTranslation();
  const [error, setError] = useState<unknown>(null),
    [pending, setPending] = useState(false);
  const add = async (source: 'camera' | 'file') => {
    if (disabled || pending) return;
    setPending(true);
    setError(null);
    try {
      const file = source === 'camera' ? await capturePhoto() : await pickDocumentFile(jpegOnly);
      if (file) onChange([...files, file]);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  const cameraLabel = tr('uploads.takePhoto');
  return (
    <View style={{ gap: 10 }}>
      <Hint>{jpegOnly ? tr('uploads.jpegSizeLimit') : tr('uploads.attachmentsHint')}</Hint>
      {files.map((file, index) => (
        <Card key={`${file.uri}:${index}`}>
          <View style={uploadStyles.fileItemHeader}>
            <View style={uploadStyles.fileItemLeft}>
              <IconDocument size={16} color="#EA580C" />
              <Text numberOfLines={2} style={uploadStyles.fileName}>
                {file.name}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('uploads.removeFile', { name: file.name })}
              disabled={disabled || pending}
              onPress={() => onChange(files.filter((_, i) => i !== index))}
              hitSlop={8}
              style={({ pressed }) => [uploadStyles.removeFileBtn, pressed && { opacity: 0.6 }]}
            >
              <IconTrash size={16} color="#DC2626" />
            </Pressable>
          </View>
          {file.type.startsWith('image/') && (
            <Image
              source={{ uri: file.uri }}
              style={uploadStyles.uploadedImagePreview}
              resizeMode="contain"
            />
          )}
        </Card>
      ))}
      <ErrorNotice error={error} />
      {files.length < maxFiles && (
        <View style={uploadStyles.actionsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={cameraLabel}
            disabled={disabled || pending || files.length >= maxFiles}
            onPress={() => void add('camera')}
            style={({ pressed }) => [
              uploadStyles.actionBtn,
              (disabled || pending || files.length >= maxFiles) && uploadStyles.btnDisabled,
              pressed && { opacity: 0.75, transform: [{ scale: 0.98 }] },
            ]}
          >
            <View style={[uploadStyles.iconBox, { backgroundColor: '#FFF7ED' }]}>
              <IconCamera size={18} color="#EA580C" />
            </View>
            <Text numberOfLines={2} style={uploadStyles.actionBtnText}>
              {cameraLabel}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('uploads.chooseAttachment')}
            disabled={disabled || pending || files.length >= maxFiles}
            onPress={() => void add('file')}
            style={({ pressed }) => [
              uploadStyles.actionBtn,
              (disabled || pending || files.length >= maxFiles) && uploadStyles.btnDisabled,
              pressed && { opacity: 0.75, transform: [{ scale: 0.98 }] },
            ]}
          >
            <View style={[uploadStyles.iconBox, { backgroundColor: '#F1F5F9' }]}>
              <IconDocument size={18} color="#475569" />
            </View>
            <Text numberOfLines={2} style={uploadStyles.actionBtnText}>
              {tr('uploads.chooseAttachment')}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
export function EvidenceButton({
  load,
  mediaType,
  label = tr('uploads.viewEvidence'),
}: {
  load: () => Promise<Blob>;
  mediaType: string;
  label?: string;
}) {
  useTranslation();
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
        if (!(await Sharing.isAvailableAsync())) throw new Error(tr('uploads.pdfUnavailable'));
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={pending}
        onPress={() => void open()}
        style={({ pressed }) => [
          uploadStyles.evidenceBtn,
          pending && { opacity: 0.5 },
          pressed && { opacity: 0.75 },
        ]}
      >
        <IconEye size={16} color="#EA580C" />
        <Text style={uploadStyles.evidenceBtnText}>{label}</Text>
      </Pressable>
      <ErrorNotice error={error} />
      {!!uri && (
        <Modal transparent animationType="fade" onRequestClose={() => setUri('')}>
          <View style={uploadStyles.viewer} accessibilityViewIsModal>
            <Image
              source={{ uri }}
              style={uploadStyles.viewerImage}
              resizeMode="contain"
              accessibilityLabel={label}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('uploads.closeImage')}
              onPress={() => setUri('')}
              style={({ pressed }) => [uploadStyles.closeImageBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={uploadStyles.closeImageText}>{tr('uploads.closeImage')}</Text>
            </Pressable>
          </View>
        </Modal>
      )}
    </View>
  );
}

const uploadStyles = StyleSheet.create({
  compactAttachment: { gap: 8 },
  compactCopy: { flex: 1, minWidth: 0, gap: 4 },
  compactTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  compactName: { color: colors.textMuted, fontSize: 12 },
  compactActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  compactButton: {
    minHeight: 44,
    paddingHorizontal: 9,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  compactAction: { color: colors.primaryHover, fontSize: 12, fontWeight: '700' },
  compactImage: { height: 130, borderRadius: 8, backgroundColor: colors.surfaceSubtle },
  fileName: { flex: 1, fontSize: 13, lineHeight: 20, color: '#334155', fontWeight: '600' },
  viewer: {
    flex: 1,
    backgroundColor: '#101826',
    justifyContent: 'center',
    padding: 20,
    paddingVertical: 48,
    gap: 16,
  },
  viewerImage: { flex: 1, width: '100%' },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    color: '#334155',
    textAlign: 'center',
  },
  fileItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  fileItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  removeFileBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadedImagePreview: {
    height: 140,
    borderRadius: 10,
    marginTop: 8,
    backgroundColor: '#F8FAFC',
  },
  evidenceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFF7ED',
    borderWidth: 1.5,
    borderColor: '#FED7AA',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  evidenceBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#EA580C',
  },
  evidencePreviewBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  evidenceImage: {
    height: 240,
    borderRadius: 8,
  },
  closeImageBtn: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  closeImageText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#475569',
  },
});
