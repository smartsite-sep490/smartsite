import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';

const RequestFeedback = createContext<() => void>(() => {});
export const useRequestFeedback = () => useContext(RequestFeedback);
export function RequestFeedbackProvider({
  children,
  onViewRequests,
}: PropsWithChildren<{ onViewRequests: () => void }>) {
  const { t } = useTranslation();
  const [sentAt, setSentAt] = useState(0);
  useEffect(() => {
    if (!sentAt) return;
    const timer = setTimeout(() => setSentAt(0), 6500);
    return () => clearTimeout(timer);
  }, [sentAt]);
  return (
    <RequestFeedback.Provider value={() => setSentAt(Date.now())}>
      <View style={{ flex: 1 }}>
        {children}
        {!!sentAt && (
          <View accessibilityLiveRegion="polite" style={styles.notice}>
            <Text style={styles.title}>{t('workerRequests.sentSuccess')}</Text>
            <Text style={styles.hint}>{t('workerRequests.sentHint')}</Text>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('workerRequests.viewSent')}
                onPress={() => {
                  setSentAt(0);
                  onViewRequests();
                }}
                style={styles.action}
              >
                <Text style={styles.link}>{t('workerRequests.viewSent')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
                onPress={() => setSentAt(0)}
                style={styles.action}
              >
                <Text style={styles.hint}>{t('common.close')}</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </RequestFeedback.Provider>
  );
}
const styles = StyleSheet.create({
  notice: {
    position: 'absolute',
    top: 58,
    left: 16,
    right: 16,
    zIndex: 30,
    borderRadius: 16,
    padding: 16,
    gap: 6,
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: colors.successText,
  },
  title: { fontSize: 14, fontWeight: '700', color: colors.successText },
  hint: { fontSize: 12, lineHeight: 19, color: colors.textSecondary },
  actions: { flexDirection: 'row', justifyContent: 'space-between' },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  link: { fontSize: 13, fontWeight: '700', color: colors.successText },
});
