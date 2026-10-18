import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { colors } from '../../theme/colors';
import { SmartSiteLogo, IconBell, IconChevronLeft } from './Icons';
import { WorkerAvatar } from './WorkerAvatar';
import { useTranslation, setLanguage, uiLanguage } from '../../i18n';

interface ScreenHeaderProps {
  mode?: 'root' | 'detail';
  title?: string;
  tagline?: string;
  siteName?: string;
  scopeLabel?: string;
  showLogoIcon?: boolean;
  showTagline?: boolean;
  showAvatar?: boolean;
  showSiteInfo?: boolean;
  avatarRole?: 'worker' | 'contractor';
  onBack?: () => void;
  onScopeChange?: () => void;
  onNotificationPress?: () => void;
  onAvatarPress?: () => void;
  unreadCount?: number;
}

export function ScreenHeader({
  mode = 'root',
  title,
  tagline,
  siteName,
  scopeLabel,
  showLogoIcon = true,
  showTagline = true,
  showAvatar = false,
  showSiteInfo = false,
  avatarRole = 'worker',
  onBack,
  onScopeChange,
  onNotificationPress,
  onAvatarPress,
  unreadCount = 0,
}: ScreenHeaderProps) {
  const { t } = useTranslation();
  const currentLang = uiLanguage();

  const toggleLanguage = () => {
    void setLanguage(currentLang === 'vi' ? 'en' : 'vi');
  };

  if (mode === 'detail') {
    return (
      <View style={styles.detailContainer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={12}
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}
        >
          <IconChevronLeft size={24} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.detailCenter}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.detailBrand}>
            {title ?? (
              <>
                Smart<Text style={styles.brandOrange}>Site</Text>
              </>
            )}
          </Text>
        </View>
        <View style={styles.detailRight}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('header.language')}
            onPress={toggleLanguage}
            style={styles.langPill}
          >
            <Text style={styles.langPillText}>{currentLang.toUpperCase()}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.rootContainer}>
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('header.switchScopeTooltip')}
          onPress={onScopeChange}
          style={styles.brandGroup}
        >
          {showLogoIcon && <SmartSiteLogo size={28} />}
          <View style={styles.textGroup}>
            <View style={styles.brandTitleRow}>
              <Text style={styles.brandName}>
                Smart<Text style={styles.brandOrange}>Site</Text>
              </Text>
              {onScopeChange && <Text style={styles.scopeArrow}> ▾</Text>}
            </View>
            {showTagline && (
              <Text numberOfLines={1} ellipsizeMode="tail" style={styles.tagline}>
                {tagline ?? t('header.tagline')}
              </Text>
            )}
          </View>
        </Pressable>

        <View style={styles.rightGroup}>
          {/* Language Toggle Pill */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('header.language')}
            onPress={toggleLanguage}
            style={({ pressed }) => [styles.langPill, pressed && { opacity: 0.8 }]}
          >
            <Text style={[styles.langText, currentLang === 'vi' && styles.langActive]}>VI</Text>
            <Text style={styles.langDivider}>|</Text>
            <Text style={[styles.langText, currentLang === 'en' && styles.langActive]}>EN</Text>
          </Pressable>

          {/* Bell Notifications */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('header.notifications')}
            hitSlop={10}
            onPress={onNotificationPress}
            style={({ pressed }) => [styles.bellButton, pressed && { opacity: 0.7 }]}
          >
            <IconBell size={24} hasUnread={unreadCount > 0} color="#0F1E36" />
            {unreadCount > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            )}
          </Pressable>

          {/* Avatar button */}
          {showAvatar && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('header.account')}
              hitSlop={6}
              onPress={onAvatarPress}
              style={({ pressed }) => [styles.avatarButton, pressed && { opacity: 0.8 }]}
            >
              <WorkerAvatar size={36} role={avatarRole} />
            </Pressable>
          )}
        </View>
      </View>

      {showSiteInfo && (siteName || scopeLabel) && (
        <View style={styles.siteInfoBar}>
          <Text numberOfLines={1} style={styles.siteInfoText}>
            {siteName}
            {scopeLabel ? ` · ${scopeLabel}` : ''}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F6',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 46,
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  brandTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textGroup: {
    justifyContent: 'center',
    flexShrink: 1,
    minWidth: 0,
  },
  brandName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.4,
  },
  brandOrange: {
    color: '#F66B17',
  },
  scopeArrow: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '700',
  },
  tagline: {
    fontSize: 10.5,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 1,
  },
  rightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  langPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  langPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F1E36',
  },
  langText: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#94A3B8',
  },
  langActive: {
    fontWeight: '800',
    color: '#F66B17',
  },
  langDivider: {
    fontSize: 10,
    color: '#CBD5E1',
    marginHorizontal: 4,
  },
  bellButton: {
    padding: 6,
    borderRadius: 8,
    position: 'relative',
  },
  unreadBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#EF4444',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  unreadText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '800',
  },
  avatarButton: {
    padding: 2,
  },
  siteInfoBar: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  siteInfoText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  detailContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 52,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F6',
  },
  backButton: {
    padding: 6,
  },
  detailCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
    minWidth: 0,
  },
  detailBrand: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.3,
  },
  detailRight: {
    minWidth: 32,
    alignItems: 'flex-end',
  },
});
