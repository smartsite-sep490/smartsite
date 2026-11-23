import { translate as tr } from '../../i18n';
import React, { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ImageBackground,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../../theme/colors';
import { SmartSiteLogo, IconUser, IconLock, IconEye } from '../../components/common/Icons';
import constructionHeroImage from '../../assets/construction_login_hero.jpg';
import { ErrorNotice } from '../../features/shared/ui';
import { useTranslation, setLanguage, uiLanguage } from '../../i18n';
import { PasswordRecoverySheet } from '../../features/auth/password-recovery-sheet';

interface LoginScreenProps {
  onLogin: (username: string, password: string) => void;
  pending?: boolean;
  error?: unknown;
  expired?: boolean;
  notice?: string | null;
}

export function LoginScreen({ onLogin, pending, error, expired, notice }: LoginScreenProps) {
  const { t } = useTranslation();
  const currentLang = uiLanguage();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const passwordInput = useRef<ComponentRef<typeof TextInput>>(null);
  const activeField = useRef<'username' | 'password' | null>(null);
  const keyboardVisible = useRef(false);
  const formTop = useRef<number | null>(null);
  const fieldTops = useRef<{ username: number | null; password: number | null }>({
    username: null,
    password: null,
  });
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const revealFocusedField = useCallback(() => {
    if (!keyboardVisible.current) return;
    const field = activeField.current;
    const top = field ? fieldTops.current[field] : null;
    if (top !== null && formTop.current !== null)
      scroll.current?.scrollTo({ y: Math.max(0, formTop.current + top - 16), animated: true });
  }, []);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      keyboardVisible.current = true;
      setKeyboardOpen(true);
      revealFocusedField();
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardVisible.current = false;
      setKeyboardOpen(false);
    });
    const willShow =
      Platform.OS === 'ios'
        ? Keyboard.addListener('keyboardWillShow', () => {
            keyboardVisible.current = true;
            setKeyboardOpen(true);
          })
        : undefined;
    const willHide =
      Platform.OS === 'ios'
        ? Keyboard.addListener('keyboardWillHide', () => {
            keyboardVisible.current = false;
            setKeyboardOpen(false);
          })
        : undefined;
    return () => {
      show.remove();
      hide.remove();
      willShow?.remove();
      willHide?.remove();
    };
  }, [revealFocusedField]);
  // Capture the base size once; Android can resize the window for the keyboard.
  const [stableScreenHeight] = useState(() =>
    Math.max(Dimensions.get('screen').height, Dimensions.get('window').height),
  );
  // Sheet card occupies ~3/5 of mobile screen height; hero section occupies remaining ~2/5
  const heroHeight = keyboardOpen
    ? 96
    : Math.max(220, Math.round(stableScreenHeight * 0.4) + 32 - insets.top);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  const handleLogin = () => {
    if (pending || !username.trim() || !password) return;
    onLogin(username.trim(), password);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="light" />
      <ScrollView
        ref={scroll}
        style={styles.scroller}
        onLayout={revealFocusedField}
        onContentSizeChange={revealFocusedField}
        automaticallyAdjustKeyboardInsets={false}
        contentContainerStyle={styles.scrollContent}
        bounces={false}
        overScrollMode="never"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
      >
        {/* Top Hero Construction Photo Section (Bleeds into top corners and behind status bar) */}
        <ImageBackground
          source={constructionHeroImage}
          style={[styles.heroSection, { height: heroHeight + insets.top }]}
          resizeMode="cover"
        >
          <View style={[styles.heroOverlay, { paddingTop: Math.max(insets.top + 14, 46) }]}>
            <View style={styles.brandRow}>
              <SmartSiteLogo size={38} />
              <Text style={styles.heroBrandName}>
                Smart<Text style={styles.heroBrandOrange}>Site</Text>
              </Text>
            </View>
          </View>
        </ImageBackground>

        {/* Bottom Rounded Form Card */}
        <View
          style={[styles.sheetCard, { paddingBottom: Math.max(insets.bottom + 24, 40) }]}
          onLayout={(event) => {
            formTop.current = event.nativeEvent.layout.y;
            revealFocusedField();
          }}
        >
          {/* Language Switcher */}
          <View style={styles.langRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tiếng Việt"
              hitSlop={8}
              onPress={() => void setLanguage('vi')}
            >
              <Text style={[styles.langText, currentLang === 'vi' && styles.langActive]}>VI</Text>
            </Pressable>
            <Text style={styles.langDivider}>|</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="English"
              hitSlop={8}
              onPress={() => void setLanguage('en')}
            >
              <Text style={[styles.langText, currentLang === 'en' && styles.langActive]}>EN</Text>
            </Pressable>
          </View>

          {/* Heading */}
          <Text style={styles.heading}>{t('auth.login')}</Text>

          {/* Notices / Session Expired */}
          {expired && (
            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>{t('auth.sessionExpired')}</Text>
            </View>
          )}
          {notice && (
            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          )}

          <ErrorNotice error={error} context="login" />

          {/* Input: Username */}
          <View
            style={styles.inputWrapper}
            onLayout={(event) => {
              fieldTops.current.username = event.nativeEvent.layout.y;
              revealFocusedField();
            }}
          >
            <IconUser size={20} color="#94A3B8" />
            <TextInput
              style={styles.input}
              placeholder={t('auth.username')}
              placeholderTextColor="#94A3B8"
              value={username}
              accessibilityLabel={tr('workforce.username')}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!pending}
              autoComplete="username"
              returnKeyType="next"
              submitBehavior="submit"
              onFocus={() => {
                activeField.current = 'username';
                revealFocusedField();
              }}
              onSubmitEditing={() => passwordInput.current?.focus()}
            />
          </View>

          {/* Input: Password */}
          <View
            style={styles.inputWrapper}
            onLayout={(event) => {
              fieldTops.current.password = event.nativeEvent.layout.y;
              revealFocusedField();
            }}
          >
            <IconLock size={20} color="#94A3B8" />
            <TextInput
              ref={passwordInput}
              style={styles.input}
              placeholder={t('auth.password')}
              placeholderTextColor="#94A3B8"
              value={password}
              accessibilityLabel={tr('auth.password')}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!pending}
              autoComplete="current-password"
              returnKeyType="go"
              onFocus={() => {
                activeField.current = 'password';
                revealFocusedField();
              }}
              onSubmitEditing={handleLogin}
            />
            <Pressable hitSlop={12} onPress={() => setShowPassword(!showPassword)}>
              <IconEye size={20} color="#94A3B8" />
            </Pressable>
          </View>

          {/* Forgot Password Link */}
          <Pressable
            style={styles.forgotBtn}
            accessibilityRole="button"
            accessibilityLabel={t('auth.forgotPassword')}
            onPress={() => setRecoveryOpen(true)}
          >
            <Text style={styles.forgotText}>{tr('auth.forgotPassword')}</Text>
          </Pressable>

          {/* Submit Button */}
          <Pressable
            style={({ pressed }) => [styles.loginBtn, pressed && { opacity: 0.88 }]}
            onPress={handleLogin}
            disabled={pending || !username.trim() || !password}
            accessibilityRole="button"
            accessibilityLabel={tr('auth.signIn')}
          >
            <Text style={styles.loginBtnText}>
              {pending ? t('auth.signingIn') : t('auth.signIn')}
            </Text>
          </Pressable>

          {/* Footer Note */}
          <Text style={styles.footerNote}>{tr('auth.accountsIssuedByManagement')}</Text>
        </View>
      </ScrollView>
      {recoveryOpen && <PasswordRecoverySheet onClose={() => setRecoveryOpen(false)} />}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  scrollContent: {
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
  },
  scroller: { flex: 1 },
  heroSection: {
    width: '100%',
  },
  heroOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    paddingHorizontal: 24,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroBrandName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  heroBrandOrange: {
    color: colors.primary,
  },
  sheetCard: {
    flexGrow: 1,
    flexShrink: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    marginTop: -32,
    paddingHorizontal: 24,
    paddingTop: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
  },
  noticeBox: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
  },
  noticeText: {
    fontSize: 13,
    color: '#1E40AF',
    lineHeight: 18,
  },
  langRow: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 16,
  },
  langText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
  },
  langActive: {
    color: colors.primary,
    fontWeight: '800',
  },
  langDivider: {
    color: '#CBD5E1',
    marginHorizontal: 8,
    fontSize: 12,
  },
  heading: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.5,
    marginBottom: 20,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 54,
    marginBottom: 14,
    gap: 12,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#0F1E36',
    height: '100%',
  },
  forgotBtn: {
    alignSelf: 'flex-end',
    marginBottom: 24,
    marginTop: 4,
  },
  forgotText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  loginBtn: {
    backgroundColor: colors.primary,
    minHeight: 54,
    padding: 14,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 20,
  },
  loginBtnText: {
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 24,
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '700',
  },
  footerNote: {
    textAlign: 'center',
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 'auto',
    marginBottom: 10,
  },
});
