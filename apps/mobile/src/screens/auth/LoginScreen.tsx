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
import {
  SmartSiteLogo,
  IconUser,
  IconLock,
  IconEye,
} from '../../components/common/Icons';

import constructionHeroImage from '../../assets/construction_login_hero.jpg';

const { height: screenHeight } = Dimensions.get('window');
const HERO_HEIGHT = Math.max(340, Math.round(screenHeight * 0.42));

interface LoginScreenProps {
  onLogin: (role: 'worker' | 'contractor') => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [language, setLanguage] = useState<'vi' | 'en'>('vi');
  const [username, setUsername] = useState('nguyen.van.an');
  const [password, setPassword] = useState('12345678');
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = () => {
    const cleanUser = username.trim().toLowerCase();
    // Phân quyền theo tài khoản nhập vào (không dùng nút toggle lơ lửng)
    if (
      cleanUser.includes('contractor') ||
      cleanUser.includes('nhathau') ||
      cleanUser.includes('tran.minh') ||
      cleanUser.includes('bao') ||
      cleanUser.includes('admin')
    ) {
      onLogin('contractor');
    } else {
      onLogin('worker');
    }
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
        {/* Top Hero Construction Photo Section (Đã bỏ hết khẩu hiệu rườm rà) */}
        <ImageBackground
          source={constructionHeroImage}
          style={styles.heroSection}
          resizeMode="cover"
        >
          <View style={styles.heroOverlay}>
            {/* Top-left Brand Identity với màu chữ Smart (Trắng) Site (Cam) */}
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
            <Pressable hitSlop={8} onPress={() => setLanguage('vi')}>
              <Text
                style={[styles.langText, language === 'vi' && styles.langActive]}
              >
                VI
              </Text>
            </Pressable>
            <Text style={styles.langDivider}>|</Text>
            <Pressable hitSlop={8} onPress={() => setLanguage('en')}>
              <Text
                style={[styles.langText, language === 'en' && styles.langActive]}
              >
                EN
              </Text>
            </Pressable>
          </View>

          {/* Heading */}
          <Text style={styles.heading}>Đăng nhập</Text>

          {/* Input: Username */}
          <View style={styles.inputWrapper}>
            <IconUser size={20} color="#94A3B8" />
            <TextInput
              style={styles.input}
              placeholder="Tên đăng nhập"
              placeholderTextColor="#94A3B8"
              value={username}
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
              placeholder="Mật khẩu"
              placeholderTextColor="#94A3B8"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            <Pressable
              hitSlop={12}
              onPress={() => setShowPassword(!showPassword)}
            >
              <IconEye size={20} color="#94A3B8" />
            </Pressable>
          </View>

          {/* Forgot Password Link */}
          <Pressable
            style={styles.forgotBtn}
            onPress={() =>
              Alert.alert(
                'Quên mật khẩu',
                'Vui lòng liên hệ ban quản lý công trường để được cấp lại mật khẩu tài khoản.'
              )
            }
          >
            <Text style={styles.forgotText}>Quên mật khẩu?</Text>
          </Pressable>

          {/* Submit Button */}
          <Pressable
            style={({ pressed }) => [
              styles.loginBtn,
              pressed && { opacity: 0.88 },
            ]}
            onPress={handleLogin}
          >
            <Text style={styles.loginBtnText}>Đăng nhập</Text>
          </Pressable>

          {/* Quick Demo Fill Badges (Không làm xáo trộn giao diện chính) */}
          <View style={styles.demoHintsRow}>
            <Text style={styles.demoHintsLabel}>Thử nhanh:</Text>
            <Pressable
              style={styles.demoBadge}
              onPress={() => {
                setUsername('nguyen.van.an');
                setPassword('12345678');
              }}
            >
              <Text style={styles.demoBadgeText}>👷 nguyen.van.an (Worker)</Text>
            </Pressable>
            <Pressable
              style={styles.demoBadge}
              onPress={() => {
                setUsername('tran.minh');
                setPassword('12345678');
              }}
            >
              <Text style={styles.demoBadgeText}>🏢 tran.minh (Contractor)</Text>
            </Pressable>
          </View>

          {/* Footer Note */}
          <Text style={styles.footerNote}>
            Tài khoản do quản lý công trường cấp
          </Text>
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
    backgroundColor: 'rgba(15, 23, 42, 0.45)', // Dark vignette for clarity
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
    marginTop: -28,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  langRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  langText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textMuted,
  },
  langActive: {
    color: colors.primary,
  },
  langDivider: {
    color: colors.textTertiary,
    fontSize: 14,
  },
  heading: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.5,
    marginBottom: 20,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAFCFF',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 52,
    marginBottom: 14,
    gap: 12,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    padding: 0,
  },
  forgotBtn: {
    alignSelf: 'flex-end',
    marginBottom: 24,
    marginTop: 2,
  },
  forgotText: {
    fontSize: 13,
    color: '#2B4C7E',
    fontWeight: '600',
  },
  loginBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 5,
    marginBottom: 20,
  },
  loginBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  demoHintsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  demoHintsLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
  demoBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  demoBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
  footerNote: {
    textAlign: 'center',
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '400',
  },
});
