import { useCallback, useState, type PropsWithChildren, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { InlinePickerContext } from './inline-picker-context';

/** Shared mobile request layout: scroll the fields while keeping submission reachable. */
export function RequestSheet({
  visible,
  title,
  subtitle,
  onClose,
  busy = false,
  footer,
  children,
  icon,
  variant = 'default',
}: PropsWithChildren<{
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  busy?: boolean;
  footer: ReactNode;
  icon?: ReactNode;
  variant?: 'default' | 'form';
}>) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [openPickers, setOpenPickers] = useState(0);
  const reportPicker = useCallback(
    (open: boolean) => setOpenPickers((count) => Math.max(0, count + (open ? 1 : -1))),
    [],
  );
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={styles.backdrop}
          onPress={close}
          disabled={busy}
          accessibilityLabel={t('common.cancel')}
        />
        <View style={[styles.sheet, variant === 'form' && styles.formSheet]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            {icon && <View style={styles.headerIcon}>{icon}</View>}
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
              {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              disabled={busy}
              onPress={close}
              style={styles.close}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
          <ScrollView
            nestedScrollEnabled
            style={styles.scroll}
            contentContainerStyle={[styles.body, variant === 'form' && styles.formBody]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            bounces={false}
            showsVerticalScrollIndicator={false}
          >
            <InlinePickerContext.Provider value={reportPicker}>
              {children}
            </InlinePickerContext.Provider>
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            {openPickers > 0 && <Text style={styles.subtitle}>{t('datePicker.finishFirst')}</Text>}
            <View
              pointerEvents={openPickers > 0 ? 'none' : 'auto'}
              accessibilityElementsHidden={openPickers > 0}
              importantForAccessibility={openPickers > 0 ? 'no-hide-descendants' : 'auto'}
              style={openPickers > 0 && { opacity: 0.45 }}
            >
              {footer}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.5)' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    maxHeight: '92%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
    flexShrink: 1,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
  },
  formSheet: { backgroundColor: colors.background },
  formBody: { padding: 16, gap: 14 },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  heading: { flex: 1 },
  title: { fontSize: 21, lineHeight: 28, fontWeight: '800', color: colors.textPrimary },
  subtitle: { fontSize: 13, lineHeight: 20, color: colors.textSecondary, marginTop: 6 },
  close: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { fontSize: 27, color: colors.textSecondary },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { padding: 20, gap: 16 },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: colors.surface,
    gap: 4,
  },
});
