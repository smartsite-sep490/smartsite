import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconChevronDown, IconFilter } from '../../components/common/Icons';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { Button } from './ui';
import { RequestSheet } from './request-sheet';

type Option = { value: string; label: string };
export function RequestListFilters({
  kind,
  status,
  kinds,
  statuses,
  onApply,
  action,
}: {
  kind: string;
  status: string;
  kinds: Option[];
  statuses: Option[];
  onApply: (kind: string, status: string) => void;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draftKind, setDraftKind] = useState(kind);
  const [draftStatus, setDraftStatus] = useState(status);
  const choices = (items: Option[], value: string, onChange: (next: string) => void) => (
    <View style={styles.options}>
      {items.map((item) => (
        <Pressable
          key={item.value}
          accessibilityRole="radio"
          accessibilityLabel={item.label}
          accessibilityState={{ checked: item.value === value }}
          onPress={() => onChange(item.value)}
          style={[styles.option, value === item.value && styles.selected]}
        >
          <Text style={[styles.optionText, value === item.value && styles.selectedText]}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
  return (
    <>
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('requests.filter')}
          accessibilityHint={`${kinds.find((v) => v.value === kind)?.label}, ${statuses.find((v) => v.value === status)?.label}`}
          onPress={() => {
            setDraftKind(kind);
            setDraftStatus(status);
            setOpen(true);
          }}
          style={({ pressed }) => [styles.filter, pressed && { opacity: 0.65 }]}
        >
          <IconFilter size={18} color={colors.textSecondary} />
          <View style={styles.copy}>
            <Text numberOfLines={1} style={styles.value}>
              {kinds.find((v) => v.value === kind)?.label}
            </Text>
            <Text numberOfLines={1} style={styles.hint}>
              {statuses.find((v) => v.value === status)?.label}
            </Text>
          </View>
          <IconChevronDown size={15} color={colors.textMuted} />
        </Pressable>
        {action}
      </View>
      {open && (
        <RequestSheet
          visible
          variant="compact"
          title={t('workerRequests.filters')}
          icon={<IconFilter size={22} color={colors.primary} />}
          onClose={() => setOpen(false)}
          footer={
            <View style={styles.actions}>
              <Button
                label={t('workerRequests.applyFilters')}
                onPress={() => {
                  onApply(draftKind, draftStatus);
                  setOpen(false);
                }}
              />
              <Button
                secondary
                label={t('workerRequests.clearFilters')}
                onPress={() => {
                  setDraftKind(kinds[0]!.value);
                  setDraftStatus(statuses[0]!.value);
                }}
              />
            </View>
          }
        >
          <Text style={styles.label}>{t('requests.kind')}</Text>
          {choices(kinds, draftKind, setDraftKind)}
          <Text style={styles.label}>{t('workerRequests.status')}</Text>
          {choices(statuses, draftStatus, setDraftStatus)}
        </RequestSheet>
      )}
    </>
  );
}
const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  filter: {
    flex: 1,
    minWidth: 0,
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  value: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  hint: { fontSize: 11, color: colors.textMuted },
  actions: { gap: 8 },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '600', lineHeight: 19 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  selected: { borderColor: colors.primaryBorder, backgroundColor: colors.primaryLight },
  optionText: { fontSize: 13, lineHeight: 20, color: colors.textSecondary },
  selectedText: { color: colors.primary, fontWeight: '600' },
});
