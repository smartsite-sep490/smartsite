import { translate as tr } from '../../i18n';
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ImageBackground,
  Alert,
  Dimensions,
} from 'react-native';
import { colors } from '../../theme/colors';
import { SmartSiteLogo, IconUser, IconLock, IconEye } from '../../components/common/Icons';
import constructionHeroImage from '../../assets/construction_login_hero.jpg';
import { ErrorNotice } from '../../features/shared/ui';
import { useTranslation, setLanguage, uiLanguage } from '../../i18n';

const { height: screenHeight } = Dimensions.get('window');
const HERO_HEIGHT = Math.max(340, Math.round(screenHeight * 0.42));

interface LoginScreenProps {
  onLogin: (username: string, password: string) => void;
  pending?: boolean;
  error?: unknown;
}

export function LoginScreen({ onLogin, pending, error }: LoginScreenProps) {
  const { t } = useTranslation();
  const currentLang = uiLanguage();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = () => {
    onLogin(username.trim(), password);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        {/* Top Hero Construction Photo Section */}
        <ImageBackground
          source={constructionHeroImage}
          style={styles.heroSection}
          resizeMode="cover"
        >
          <View style={styles.heroOverlay}>
            <View style={styles.brandRow}>
              <SmartSiteLogo size={38} />
              <Text style={styles.heroBrandName}>
                Smart<Text style={styles.heroBrandOrange}>Site</Text>
              </Text>
            </View>
          </View>
        </ImageBackground>

        {/* Bottom Rounded Form Card */}
        <View style={styles.sheetCard}>
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
          <ErrorNotice error={error} />

          {/* Input: Username */}
          <View style={styles.inputWrapper}>
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
            />
          </View>

          {/* Input: Password */}
          <View style={styles.inputWrapper}>
            <IconLock size={20} color="#94A3B8" />
            <TextInput
              style={styles.input}
              placeholder={t('auth.password')}
              placeholderTextColor="#94A3B8"
              value={password}
              accessibilityLabel={tr('auth.password')}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            <Pressable hitSlop={12} onPress={() => setShowPassword(!showPassword)}>
              <IconEye size={20} color="#94A3B8" />
            </Pressable>
          </View>

          {/* Forgot Password Link */}
          <Pressable
            style={styles.forgotBtn}
            onPress={() => Alert.alert(t('profile.changePassword'), tr('auth.passwordResetHint'))}
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    flexGrow: 1,
    minHeight: screenHeight,
    backgroundColor: '#FFFFFF',
  },
  heroSection: {
    width: '100%',
    height: HERO_HEIGHT,
  },
  heroOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'android' ? 36 : 52,
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
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    marginTop: -32,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
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
    height: 54,
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
