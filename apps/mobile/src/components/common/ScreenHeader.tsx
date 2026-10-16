import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { colors } from '../../theme/colors';
import { SmartSiteLogo, IconBell, IconChevronLeft } from './Icons';
import { WorkerAvatar } from './WorkerAvatar';

interface ScreenHeaderProps {
  mode?: 'root' | 'detail';
  title?: string;
  tagline?: string;
  showLogoIcon?: boolean;
  showTagline?: boolean;
  showAvatar?: boolean;
  avatarRole?: 'worker' | 'contractor';
  onBack?: () => void;
  onNotificationPress?: () => void;
  onAvatarPress?: () => void;
  hasUnreadNotifications?: boolean;
}

export function ScreenHeader({
  mode = 'root',
  tagline,
  showLogoIcon = false,
  showTagline = false,
  showAvatar = false,
  avatarRole = 'contractor',
  onBack,
  onNotificationPress,
  onAvatarPress,
  hasUnreadNotifications = true,
}: ScreenHeaderProps) {
  if (mode === 'detail') {
    return (
      <View style={styles.detailContainer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Quay lại"
          hitSlop={12}
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}
        >
          <IconChevronLeft size={24} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.detailCenter}>
          <Text style={styles.detailBrand}>
            Smart<Text style={styles.brandOrange}>Site</Text>
          </Text>
        </View>
        <View style={{ width: 24 }} />
      </View>
    );
  }

  return (
    <View style={styles.rootContainer}>
      <View style={styles.brandGroup}>
        {showLogoIcon ? <SmartSiteLogo size={32} /> : null}
        <View style={styles.textGroup}>
          <Text style={styles.brandName}>
            Smart<Text style={styles.brandOrange}>Site</Text>
          </Text>
          {showTagline && tagline ? <Text style={styles.tagline}>{tagline}</Text> : null}
        </View>
      </View>

      <View style={styles.rightGroup}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Thông báo"
          hitSlop={10}
          onPress={onNotificationPress}
          style={({ pressed }) => [styles.bellButton, pressed && { opacity: 0.7 }]}
        >
          <IconBell size={24} hasUnread={hasUnreadNotifications} color="#0F1E36" />
        </Pressable>

        {showAvatar ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Hồ sơ"
            hitSlop={6}
            onPress={onAvatarPress}
            style={({ pressed }) => [styles.avatarButton, pressed && { opacity: 0.8 }]}
          >
            <WorkerAvatar size={38} role={avatarRole} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  textGroup: {
    justifyContent: 'center',
  },
  brandName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.5,
  },
  brandOrange: {
    color: '#F05A28',
  },
  tagline: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '400',
    marginTop: 1,
  },
  rightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bellButton: {
    padding: 6,
    borderRadius: 8,
  },
  avatarButton: {
    padding: 2,
  },
  detailContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    padding: 4,
  },
  detailCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailBrand: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.4,
  },
});
