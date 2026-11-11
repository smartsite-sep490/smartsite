import { translate as tr } from '../../i18n';
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
import { localizeMessage } from '../../i18n/messages';
import { useCompactLayout } from './mobile-layout';
import { IconChevronDown, IconChevronUp, IconChevronLeft } from '../../components/common/Icons';
import { colors } from '../../theme/colors';

export const palette = {
  navy: '#0F1E36',
  orange: '#F66B17',
  muted: '#64748B',
  line: '#E2E8F0',
  bg: '#F8FAFC',
};

export function errorMessage(error: unknown, context?: 'login') {
  if (error instanceof ApiError) {
    if (error.status === 403) return translate('auth.permissionDenied');
    if (error.status === 401)
      return translate(context === 'login' ? 'auth.invalidCredentials' : 'auth.sessionExpired');
    if (error.status === 409) return translate('auth.conflictError');
    if (error.code === 'network' || error.code === 'timeout') return translate('auth.networkError');
  }
  return error instanceof Error
    ? localizeMessage(error.message)
    : translate('common.unexpectedError');
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
  const compact = useCompactLayout();
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
        compact && compactStyles.button,
        (disabled || pressed) && { opacity: 0.55 },
      ]}
    >
      <Text style={[styles.buttonText, secondary && { color: palette.navy }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const compact = useCompactLayout();
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
          compact && compactStyles.input,
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
  const compact = useCompactLayout();
  const [search, setSearch] = useState('');
  const visibleOptions = compact
    ? options.filter((option) =>
        option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
      )
    : options;
  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Button
        secondary
        label={selectedLabel ? `${selectedLabel} ▾` : tr('common.selectDropdown')}
        disabled={disabled}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <View style={styles.options}>
          {compact && options.length > 8 && (
            <Field
              label={t('contractorUi.searchOptions')}
              value={search}
              onChangeText={setSearch}
            />
          )}
          <ScrollView nestedScrollEnabled style={compact ? { maxHeight: 264 } : undefined}>
            {visibleOptions.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: value === option.value }}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                  setSearch('');
                }}
                style={styles.option}
              >
                <Text style={styles.text}>
                  {value === option.value ? '● ' : '○ '}
                  {option.label}
                </Text>
              </Pressable>
            ))}
            {!visibleOptions.length && <Hint>{t('common.noOptions')}</Hint>}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

export function Card({ children }: PropsWithChildren) {
  const compact = useCompactLayout();
  return <View style={[styles.card, compact && compactStyles.card]}>{children}</View>;
}

export function Disclosure({
  title,
  children,
  initiallyOpen = false,
  collapsible = true,
}: PropsWithChildren<{ title: string; initiallyOpen?: boolean; collapsible?: boolean }>) {
  const [open, setOpen] = useState(initiallyOpen);
  const [visited, setVisited] = useState(initiallyOpen);
  if (!collapsible) return <>{children}</>;
  return (
    <View style={compactStyles.disclosure}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          setVisited(true);
          setOpen(!open);
        }}
        style={({ pressed }) => [compactStyles.disclosureHeading, pressed && { opacity: 0.65 }]}
      >
        <Text style={compactStyles.disclosureTitle}>{title}</Text>
        {open ? <IconChevronUp size={19} /> : <IconChevronDown size={19} />}
      </Pressable>
      {visited && (
        <View
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
          style={[compactStyles.disclosureBody, !open && { display: 'none' }]}
        >
          {children}
        </View>
      )}
    </View>
  );
}

export function CompactTabs({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <View style={compactStyles.tabs}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="tab"
          accessibilityLabel={option.label}
          accessibilityState={{ selected: option.value === value }}
          onPress={() => onChange(option.value)}
          style={[compactStyles.tab, option.value === value && compactStyles.selectedTab]}
        >
          <Text
            style={[compactStyles.tabText, option.value === value && compactStyles.selectedTabText]}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
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

export function ErrorNotice({ error, context }: { error: unknown; context?: 'login' }) {
  useTranslation();
  return error ? (
    <Text accessibilityRole="alert" style={styles.error}>
      {errorMessage(error, context)}
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
}: PropsWithChildren<{ title?: string; onBack?: () => void }>) {
  const { t } = useTranslation();
  const compact = useCompactLayout();
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={compact && compactStyles.screen}
      contentContainerStyle={[styles.page, compact && compactStyles.page]}
      showsVerticalScrollIndicator={false}
    >
      {onBack ? (
        <View style={styles.pageHeaderRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={onBack}
            hitSlop={10}
            style={({ pressed }) => [
              styles.smallBackBtn,
              pressed && { opacity: 0.7, backgroundColor: '#E2E8F0' },
            ]}
          >
            <IconChevronLeft size={20} color={palette.navy} />
          </Pressable>
          {title ? (
            <View style={{ flex: 1 }}>
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                ellipsizeMode="tail"
                style={styles.pageHeaderTitle}
              >
                {title}
              </Text>
            </View>
          ) : null}
        </View>
      ) : title ? (
        <Heading>{title}</Heading>
      ) : null}
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
    <View style={styles.pagerRow}>
      <Text style={styles.pagerHint}>
        {total ? `${offset + 1}–${Math.min(offset + size, total)} / ${total}` : t('common.noData')}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.previous')}
        disabled={offset === 0}
        onPress={() => onChange(Math.max(0, offset - size))}
        style={({ pressed }) => [
          styles.pagerBtn,
          offset === 0 && { opacity: 0.4 },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Text style={styles.pagerBtnText}>{t('common.previous')}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.next')}
        disabled={offset + size >= total}
        onPress={() => onChange(offset + size)}
        style={({ pressed }) => [
          styles.pagerBtn,
          offset + size >= total && { opacity: 0.4 },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Text style={styles.pagerBtnText}>{t('common.next')}</Text>
      </Pressable>
    </View>
  );
}

export const styles = StyleSheet.create({
  page: { padding: 18, paddingBottom: 40, gap: 14 },
  pageHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
    paddingVertical: 2,
  },
  smallBackBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  pageHeaderTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: palette.navy,
    letterSpacing: -0.3,
  },
  card: {
    backgroundColor: '#F8F9FB',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    padding: 18,
    gap: 12,
  },
  heading: {
    fontSize: 24,
    fontWeight: '800',
    color: palette.navy,
    letterSpacing: -0.4,
    lineHeight: 32,
    paddingTop: 4,
    paddingBottom: 2,
  },
  text: { fontSize: 15.5, lineHeight: 23, color: palette.navy },
  hint: { fontSize: 14, lineHeight: 21, color: palette.muted },
  label: { color: palette.navy, fontSize: 14.5, fontWeight: '700', lineHeight: 21 },
  field: { gap: 6, minWidth: 0, maxWidth: '100%' },
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
    maxWidth: '100%',
  },
  secondary: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D8DEE6',
    borderWidth: 1.5,
    borderRadius: 14,
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    flexShrink: 1,
  },
  error: { color: '#B91C1C', lineHeight: 22, padding: 8 },
  loading: { padding: 30, alignItems: 'center', gap: 10 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pagerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    flexWrap: 'wrap',
    gap: 8,
  },
  pagerBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 9,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '100%',
  },
  pagerBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F1E36',
    textAlign: 'center',
    lineHeight: 20,
  },
  pagerHint: {
    flexBasis: '100%',
    fontSize: 13.5,
    fontWeight: '600',
    color: '#64748B',
    flexShrink: 1,
    textAlign: 'center',
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

const compactStyles = StyleSheet.create({
  screen: { backgroundColor: colors.background },
  page: { padding: 16, paddingBottom: 28, gap: 14 },
  pageHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 3 },
  eyebrow: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: 5,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  back: {
    minWidth: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    gap: 10,
    borderWidth: 0,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.035,
    shadowRadius: 7,
    elevation: 1,
  },
  button: { minHeight: 44, padding: 11, borderRadius: 12, shadowOpacity: 0, elevation: 0 },
  input: { backgroundColor: colors.surface, minHeight: 44, padding: 12, borderRadius: 12 },
  disclosure: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  disclosureHeading: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  disclosureTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 21,
  },
  disclosureBody: { paddingBottom: 14, gap: 12 },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    padding: 4,
    borderRadius: 14,
    backgroundColor: '#EDEFF3',
  },
  tab: {
    flex: 1,
    minWidth: 75,
    minHeight: 44,
    padding: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
  },
  selectedTab: { backgroundColor: colors.surface },
  tabText: { fontSize: 12, fontWeight: '600', color: colors.textMuted, textAlign: 'center' },
  selectedTabText: { color: colors.primary, fontWeight: '800' },
});
