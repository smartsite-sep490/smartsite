import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { colors } from '../../theme/colors';

interface IconProps {
  size?: number;
  color?: string;
}

/**
 * SmartSite Hexagonal Logo with skyscraper/tower silhouettes
 */
export function SmartSiteLogo({ size = 38 }: { size?: number }) {
  const innerScale = size / 38;
  return (
    <View style={[styles.logoContainer, { width: size, height: size }]}>
      <View style={[styles.hexagonShape, { width: size, height: size, borderRadius: size * 0.22 }]}>
        <View style={styles.logoBarsContainer}>
          {/* Left building */}
          <View
            style={[
              styles.logoBuilding,
              {
                width: 4 * innerScale,
                height: 14 * innerScale,
                backgroundColor: '#FFFFFF',
              },
            ]}
          />
          {/* Middle tallest building */}
          <View
            style={[
              styles.logoBuilding,
              {
                width: 4 * innerScale,
                height: 22 * innerScale,
                backgroundColor: '#FFFFFF',
              },
            ]}
          />
          {/* Right building */}
          <View
            style={[
              styles.logoBuilding,
              {
                width: 4 * innerScale,
                height: 16 * innerScale,
                backgroundColor: '#FFFFFF',
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * Notification Bell with optional unread indicator
 */
export function IconBell({ size = 24, hasUnread = true, color = colors.textPrimary }: IconProps & { hasUnread?: boolean }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Bell body */}
      <View
        style={{
          width: size * 0.65,
          height: size * 0.6,
          borderWidth: 2,
          borderColor: color,
          borderTopLeftRadius: size * 0.35,
          borderTopRightRadius: size * 0.35,
          borderBottomLeftRadius: 2,
          borderBottomRightRadius: 2,
        }}
      />
      {/* Bell bottom rim */}
      <View
        style={{
          width: size * 0.85,
          height: 2,
          backgroundColor: color,
          marginTop: -1,
          borderRadius: 1,
        }}
      />
      {/* Bell clapper */}
      <View
        style={{
          width: size * 0.25,
          height: 3,
          backgroundColor: color,
          borderBottomLeftRadius: 3,
          borderBottomRightRadius: 3,
        }}
      />
      {hasUnread && (
        <View
          style={{
            position: 'absolute',
            top: 1,
            right: 1,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: colors.primary,
            borderWidth: 1.5,
            borderColor: colors.surface,
          }}
        />
      )}
    </View>
  );
}

/**
 * Bottom Nav: Home
 */
export function IconHome({ size = 24, color = colors.textTertiary }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Roof */}
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: size * 0.42,
          borderRightWidth: size * 0.42,
          borderBottomWidth: size * 0.35,
          borderStyle: 'solid',
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: color,
        }}
      />
      {/* Base */}
      <View
        style={{
          width: size * 0.6,
          height: size * 0.42,
          borderLeftWidth: 2,
          borderRightWidth: 2,
          borderBottomWidth: 2,
          borderColor: color,
          borderBottomLeftRadius: 2,
          borderBottomRightRadius: 2,
          alignItems: 'center',
          justifyContent: 'flex-end',
        }}
      >
        {/* Door */}
        <View
          style={{
            width: size * 0.22,
            height: size * 0.22,
            backgroundColor: color,
            borderTopLeftRadius: 2,
            borderTopRightRadius: 2,
          }}
        />
      </View>
    </View>
  );
}

/**
 * Bottom Nav: Calendar
 */
export function IconCalendar({ size = 24, color = colors.textTertiary }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Rings */}
      <View style={{ flexDirection: 'row', width: size * 0.55, justifyContent: 'space-between', marginBottom: -2, zIndex: 1 }}>
        <View style={{ width: 2, height: 4, backgroundColor: color, borderRadius: 1 }} />
        <View style={{ width: 2, height: 4, backgroundColor: color, borderRadius: 1 }} />
      </View>
      {/* Calendar body */}
      <View
        style={{
          width: size * 0.76,
          height: size * 0.7,
          borderWidth: 2,
          borderColor: color,
          borderRadius: 4,
          paddingTop: 3,
        }}
      >
        <View style={{ height: 2, backgroundColor: color, width: '100%' }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 3 }}>
          <View style={{ width: 2.5, height: 2.5, borderRadius: 1.5, backgroundColor: color }} />
          <View style={{ width: 2.5, height: 2.5, borderRadius: 1.5, backgroundColor: color }} />
          <View style={{ width: 2.5, height: 2.5, borderRadius: 1.5, backgroundColor: color }} />
        </View>
      </View>
    </View>
  );
}

/**
 * Bottom Nav: Clock / Attendance
 */
export function IconClock({ size = 24, color = colors.textTertiary }: IconProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: size * 0.8,
          height: size * 0.8,
          borderRadius: (size * 0.8) / 2,
          borderWidth: 2,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Hour & Minute Hands */}
        <View
          style={{
            position: 'absolute',
            width: 2,
            height: size * 0.26,
            backgroundColor: color,
            top: size * 0.14,
            borderRadius: 1,
          }}
        />
        <View
          style={{
            position: 'absolute',
            height: 2,
            width: size * 0.22,
            backgroundColor: color,
            right: size * 0.16,
            borderRadius: 1,
          }}
        />
      </View>
    </View>
  );
}

/**
 * Bottom Nav: User Profile
 */
export function IconUser({ size = 24, color = colors.textTertiary }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Head */}
      <View
        style={{
          width: size * 0.36,
          height: size * 0.36,
          borderRadius: (size * 0.36) / 2,
          borderWidth: 2,
          borderColor: color,
          marginBottom: 2,
        }}
      />
      {/* Shoulders */}
      <View
        style={{
          width: size * 0.68,
          height: size * 0.32,
          borderWidth: 2,
          borderColor: color,
          borderTopLeftRadius: size * 0.3,
          borderTopRightRadius: size * 0.3,
          borderBottomWidth: 0,
        }}
      />
    </View>
  );
}

/**
 * User Plus Icon (for "Thêm công nhân")
 */
export function IconUserPlus({ size = 20, color = '#FFFFFF' }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Head */}
      <View
        style={{
          width: size * 0.32,
          height: size * 0.32,
          borderRadius: (size * 0.32) / 2,
          borderWidth: 2,
          borderColor: color,
          marginRight: 6,
          marginBottom: 1,
        }}
      />
      {/* Shoulders */}
      <View
        style={{
          width: size * 0.58,
          height: size * 0.28,
          borderWidth: 2,
          borderColor: color,
          borderTopLeftRadius: size * 0.25,
          borderTopRightRadius: size * 0.25,
          borderBottomWidth: 0,
          marginRight: 6,
        }}
      />
      {/* Plus */}
      <View
        style={{
          position: 'absolute',
          top: 2,
          right: 0,
          width: 8,
          height: 8,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ position: 'absolute', width: 7, height: 2, backgroundColor: color, borderRadius: 1 }} />
        <View style={{ position: 'absolute', width: 2, height: 7, backgroundColor: color, borderRadius: 1 }} />
      </View>
    </View>
  );
}

/**
 * QR Code Icon (from image 2 "QR dự phòng")
 */
export function IconQrCode({ size = 20, color = '#FFFFFF' }: IconProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignContent: 'space-between',
        padding: 1,
      }}
    >
      <View
        style={{
          width: size * 0.42,
          height: size * 0.42,
          borderWidth: 2,
          borderColor: color,
          borderRadius: 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: 3, height: 3, backgroundColor: color }} />
      </View>
      <View
        style={{
          width: size * 0.42,
          height: size * 0.42,
          borderWidth: 2,
          borderColor: color,
          borderRadius: 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: 3, height: 3, backgroundColor: color }} />
      </View>
      <View
        style={{
          width: size * 0.42,
          height: size * 0.42,
          borderWidth: 2,
          borderColor: color,
          borderRadius: 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: 3, height: 3, backgroundColor: color }} />
      </View>
      <View
        style={{
          width: size * 0.42,
          height: size * 0.42,
          borderRadius: 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: 5, height: 5, backgroundColor: color }} />
      </View>
    </View>
  );
}

/**
 * Plus icon (from image 2 "+ Gửi yêu cầu")
 */
export function IconPlus({ size = 20, color = colors.textPrimary }: IconProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.8,
        borderColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ position: 'absolute', width: 2, height: size * 0.5, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ position: 'absolute', height: 2, width: size * 0.5, backgroundColor: color, borderRadius: 1 }} />
    </View>
  );
}

/**
 * Chevrons
 */
export function IconChevronLeft({ size = 20, color = colors.textPrimary }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.9, fontWeight: '700', color, lineHeight: size }}>‹</Text>
    </View>
  );
}

export function IconChevronRight({ size = 20, color = colors.textTertiary }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.9, fontWeight: '700', color, lineHeight: size }}>›</Text>
    </View>
  );
}

export function IconChevronDown({ size = 18, color = colors.textMuted }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.8, fontWeight: '700', color, lineHeight: size }}>⌄</Text>
    </View>
  );
}

export function IconChevronUp({ size = 18, color = colors.textMuted }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.8, fontWeight: '700', color, lineHeight: size }}>⌃</Text>
    </View>
  );
}

/**
 * Briefcase Icon (for "Ca hành chính" in image 3)
 */
export function IconBriefcase({ size = 22, color = colors.primary }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Handle */}
      <View
        style={{
          width: size * 0.36,
          height: 3,
          borderTopWidth: 2,
          borderLeftWidth: 2,
          borderRightWidth: 2,
          borderColor: color,
          borderTopLeftRadius: 2,
          borderTopRightRadius: 2,
        }}
      />
      {/* Body */}
      <View
        style={{
          width: size * 0.8,
          height: size * 0.55,
          borderWidth: 2,
          borderColor: color,
          borderRadius: 4,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: '100%', height: 1.5, backgroundColor: color }} />
        <View style={{ width: 4, height: 4, backgroundColor: color, borderRadius: 1, marginTop: -2 }} />
      </View>
    </View>
  );
}

/**
 * Swap Icon (for "⇄ Đề nghị đổi ca" in image 3)
 */
export function IconSwap({ size = 20, color = colors.primary }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.9, fontWeight: '700', color, lineHeight: size }}>⇄</Text>
    </View>
  );
}

/**
 * Exclamation / Warning Icon
 */
export function IconAlert({ size = 20, color = colors.warning }: IconProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: size * 0.65 }}>!</Text>
    </View>
  );
}

/**
 * Checkmark Icon
 */
export function IconCheck({ size = 18, color = colors.success }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color, fontWeight: '800', fontSize: size * 0.85 }}>✓</Text>
    </View>
  );
}

/**
 * Lock Icon (for Login screen)
 */
export function IconLock({ size = 20, color = colors.textMuted }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Shackle */}
      <View
        style={{
          width: size * 0.44,
          height: size * 0.35,
          borderTopWidth: 2,
          borderLeftWidth: 2,
          borderRightWidth: 2,
          borderColor: color,
          borderTopLeftRadius: size * 0.22,
          borderTopRightRadius: size * 0.22,
        }}
      />
      {/* Body */}
      <View
        style={{
          width: size * 0.66,
          height: size * 0.45,
          backgroundColor: color,
          borderRadius: 3,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: 3, height: 4, backgroundColor: '#FFFFFF', borderRadius: 1 }} />
      </View>
    </View>
  );
}

/**
 * Eye Icon (for password show/hide)
 */
export function IconEye({ size = 20, color = colors.textMuted }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size * 0.8,
          height: size * 0.45,
          borderRadius: (size * 0.45) / 2,
          borderWidth: 1.8,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: color }} />
      </View>
    </View>
  );
}

/**
 * Teams / Users Icon (for Contractor)
 */
export function IconUsers({ size = 24, color = colors.textTertiary }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Two people silhouettes */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <IconUser size={size * 0.75} color={color} />
        <View style={{ marginLeft: -6, opacity: 0.8 }}>
          <IconUser size={size * 0.65} color={color} />
        </View>
      </View>
    </View>
  );
}

/**
 * Shield Icon (for Safety / Contractor)
 */
export function IconShield({ size = 20, color = colors.primary }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size * 0.7,
          height: size * 0.8,
          borderWidth: 2,
          borderColor: color,
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
          borderBottomLeftRadius: size * 0.35,
          borderBottomRightRadius: size * 0.35,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: 3, height: size * 0.3, backgroundColor: color, borderRadius: 1 }} />
      </View>
    </View>
  );
}

/**
 * Document Icon (for Contractor "Yêu cầu", "Yêu cầu chờ duyệt")
 */
export function IconDocument({ size = 20, color = colors.primary }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size * 0.68,
          height: size * 0.85,
          borderWidth: 1.8,
          borderColor: color,
          borderRadius: 3,
          paddingHorizontal: 2,
          paddingVertical: 3,
          justifyContent: 'space-around',
        }}
      >
        <View style={{ width: '80%', height: 1.5, backgroundColor: color, borderRadius: 1 }} />
        <View style={{ width: '60%', height: 1.5, backgroundColor: color, borderRadius: 1 }} />
        <View style={{ width: '70%', height: 1.5, backgroundColor: color, borderRadius: 1 }} />
      </View>
    </View>
  );
}

/**
 * Search Icon
 */
export function IconSearch({ size = 18, color = colors.textMuted }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.9, color }}>🔍</Text>
    </View>
  );
}

/**
 * Pencil / Edit Icon
 */
export function IconPencil({ size = 18, color = colors.textPrimary }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.9, color }}>✏️</Text>
    </View>
  );
}

/**
 * Pause Icon (for "Tạm ngưng")
 */
export function IconPause({ size = 18, color = colors.danger }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size * 0.8,
          height: size * 0.8,
          borderRadius: (size * 0.8) / 2,
          borderWidth: 1.5,
          borderColor: color,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2.5,
        }}
      >
        <View style={{ width: 2, height: size * 0.35, backgroundColor: color, borderRadius: 1 }} />
        <View style={{ width: 2, height: size * 0.35, backgroundColor: color, borderRadius: 1 }} />
      </View>
    </View>
  );
}

/**
 * Face Scan / Recognition Brackets Icon
 */
export function IconFaceScan({ size = 28, color = colors.primary }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.8, color }}>👤</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  hexagonShape: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 4,
  },
  logoBarsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  logoBuilding: {
    borderTopLeftRadius: 1.5,
    borderTopRightRadius: 1.5,
  },
});
