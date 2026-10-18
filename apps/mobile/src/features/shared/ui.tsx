import { Fragment, useState, type PropsWithChildren } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { ApiError } from '@smartsite/api-client';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation, translate } from '../../i18n';

export const palette = {
  navy: '#0F1E36',
  orange: '#F66B17',
  muted: '#64748B',
  line: '#E2E8F0',
  bg: '#F8FAFC',
};

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 403) return translate('auth.permissionDenied');
    if (error.status === 401) return translate('auth.sessionExpired');
    if (error.status === 409) return translate('auth.conflictError');
    if (error.code === 'network' || error.code === 'timeout') return translate('auth.networkError');
  }
  return error instanceof Error ? error.message : translate('common.unexpectedError');
}

export function Button({
  label,
  onPress,
  disabled,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        (disabled || pressed) && { opacity: 0.55 },
      ]}
    >
      <Text style={[styles.buttonText, secondary && { color: palette.navy }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        placeholderTextColor="#94A3B8"
        {...props}
        style={[
          styles.input,
          props.multiline && { minHeight: 90, textAlignVertical: 'top' },
          props.style,
        ]}
      />
    </View>
  );
}

export function Choice({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Button
        secondary
        label={selectedLabel ? `${selectedLabel} ▾` : 'Chọn… ▾'}
        disabled={disabled}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <View style={styles.options}>
          {options.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: value === option.value }}
              onPress={() => {
                onChange(option.value);
                setOpen(false);
              }}
              style={styles.option}
            >
              <Text style={styles.text}>
                {value === option.value ? '● ' : '○ '}
                {option.label}
              </Text>
            </Pressable>
          ))}
          {!options.length && <Hint>{t('common.noOptions')}</Hint>}
        </View>
      )}
    </View>
  );
}

export function Card({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}

export function Heading({ children }: PropsWithChildren) {
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      {children}
    </Text>
  );
}

export function Hint({ children }: PropsWithChildren) {
  return <Text style={styles.hint}>{children}</Text>;
}

export function Body({ children }: PropsWithChildren) {
  return (
    <Text selectable style={styles.text}>
      {children}
    </Text>
  );
}

export function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <Text accessibilityRole="alert" style={styles.error}>
      {errorMessage(error)}
    </Text>
  ) : null;
}

export function QueryState<T>({
  query,
  children,
}: {
  query: UseQueryResult<T, Error>;
  children: (data: T) => React.ReactNode;
}) {
  const { t } = useTranslation();

  if (query.isPending)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={palette.orange} />
        <Hint>{t('common.loading')}</Hint>
      </View>
    );

  if (query.data === undefined)
    return (
      <Card>
        <ErrorNotice error={query.error} />
        <Button secondary label={t('common.retry')} onPress={() => void query.refetch()} />
      </Card>
    );

  return (
    <>
      {query.isRefetchError && (
        <Card>
          <ErrorNotice error={query.error} />
          <Button secondary label={t('common.retry')} onPress={() => void query.refetch()} />
        </Card>
      )}
      <Fragment key="loaded-data">{children(query.data)}</Fragment>
    </>
  );
}

export function Page({
  title,
  onBack,
  children,
}: PropsWithChildren<{ title: string; onBack?: () => void }>) {
  const { t } = useTranslation();
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
      {onBack && <Button secondary label={t('common.back')} onPress={onBack} />}
      <Heading>{title}</Heading>
      {children}
    </ScrollView>
  );
}

export function Pager({
  offset,
  total,
  size = 20,
  onChange,
}: {
  offset: number;
  total: number;
  size?: number;
  onChange: (offset: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <Button
        secondary
        label={t('common.previous')}
        disabled={offset === 0}
        onPress={() => onChange(Math.max(0, offset - size))}
      />
      <Hint>
        {total ? `${offset + 1}–${Math.min(offset + size, total)} / ${total}` : t('common.noData')}
      </Hint>
      <Button
        secondary
        label={t('common.next')}
        disabled={offset + size >= total}
        onPress={() => onChange(offset + size)}
      />
    </View>
  );
}

export const styles = StyleSheet.create({
  page: { padding: 18, paddingBottom: 40, gap: 14 },
  card: {
    backgroundColor: '#F8F9FB',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    padding: 18,
    gap: 12,
  },
  heading: { fontSize: 24, fontWeight: '800', color: palette.navy, letterSpacing: -0.4 },
  text: { fontSize: 15, lineHeight: 23, color: palette.navy },
  hint: { fontSize: 13, lineHeight: 20, color: palette.muted },
  label: { color: palette.navy, fontSize: 13.5, fontWeight: '700' },
  field: { gap: 6 },
  input: {
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    minHeight: 48,
    color: palette.navy,
    fontSize: 15,
    backgroundColor: '#F8F9FB',
  },
  button: {
    backgroundColor: palette.orange,
    minHeight: 50,
    padding: 14,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: palette.orange,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
  secondary: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D8DEE6',
    borderWidth: 1.5,
    borderRadius: 14,
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: { color: 'white', fontWeight: '700', fontSize: 15 },
  error: { color: '#B91C1C', lineHeight: 22, padding: 8 },
  loading: { padding: 30, alignItems: 'center', gap: 10 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  options: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    marginTop: 4,
  },
  option: { padding: 14, minHeight: 48, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
});
