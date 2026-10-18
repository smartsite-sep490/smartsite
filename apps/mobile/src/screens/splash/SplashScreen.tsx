import { translate as tr, useTranslation } from '../../i18n';
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Image,
  Dimensions,
  StatusBar,
  Pressable,
} from 'react-native';

const { width } = Dimensions.get('window');

import smartsiteAppIcon from '../../assets/smartsite-app-icon-white.png';

interface SplashScreenProps {
  onFinish: () => void;
}

export function SplashScreen({ onFinish }: SplashScreenProps) {
  useTranslation();
  // Animation drivers using useState to satisfy React 19 render-ref rules
  const [logoScale] = useState(() => new Animated.Value(0.5));
  const [logoOpacity] = useState(() => new Animated.Value(0));
  const [glowScale] = useState(() => new Animated.Value(0.8));
  const [glowOpacity] = useState(() => new Animated.Value(0));
  const [textOpacity] = useState(() => new Animated.Value(0));
  const [textTranslateY] = useState(() => new Animated.Value(20));
  const [progressAnim] = useState(() => new Animated.Value(0));
  const [screenFade] = useState(() => new Animated.Value(1));

  const exitSplash = React.useCallback(() => {
    Animated.timing(screenFade, {
      toValue: 0,
      duration: 400,
      useNativeDriver: true,
    }).start(() => {
      onFinish();
    });
  }, [screenFade, onFinish]);

  useEffect(() => {
    // 1. Initial entry sequence
    Animated.parallel([
      // Logo bounce in
      Animated.spring(logoScale, {
        toValue: 1,
        friction: 6,
        tension: 40,
        useNativeDriver: true,
      }),
      // Logo fade in
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      // Glow fade in
      Animated.timing(glowOpacity, {
        toValue: 0.35,
        duration: 900,
        useNativeDriver: true,
      }),
    ]).start();

    // 2. Continuous ambient glow pulsing
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowScale, {
          toValue: 1.15,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(glowScale, {
          toValue: 0.9,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    ).start();

    // 3. Text slide up and fade in after delay
    const textTimer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(textTranslateY, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
      ]).start();
    }, 400);

    // 4. Progress bar filling
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 1800,
      useNativeDriver: false,
    }).start();

    // 5. Automatic transition to login after 2400ms
    const finishTimer = setTimeout(() => {
      exitSplash();
    }, 2400);

    return () => {
      clearTimeout(textTimer);
      clearTimeout(finishTimer);
    };
  }, [
    exitSplash,
    glowOpacity,
    glowScale,
    logoOpacity,
    logoScale,
    progressAnim,
    textOpacity,
    textTranslateY,
  ]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, width * 0.48],
  });

  return (
    <Pressable style={styles.touchArea} onPress={exitSplash}>
      <Animated.View style={[styles.container, { opacity: screenFade }]}>
        <StatusBar barStyle="light-content" backgroundColor="#041D2E" />

        {/* Ambient Glowing Aura */}
        <Animated.View
          style={[
            styles.glowAura,
            {
              opacity: glowOpacity,
              transform: [{ scale: glowScale }],
            },
          ]}
        />

        {/* Center Logo Group */}
        <View style={styles.centerBox}>
          {/* Animated App Icon */}
          <Animated.View
            style={[
              styles.logoWrapper,
              {
                opacity: logoOpacity,
                transform: [{ scale: logoScale }],
              },
            ]}
          >
            <View style={styles.logoCard}>
              <Image source={smartsiteAppIcon} style={styles.logoImage} resizeMode="contain" />
            </View>
          </Animated.View>

          {/* Animated Brand Typography */}
          <Animated.View
            style={[
              styles.textGroup,
              {
                opacity: textOpacity,
                transform: [{ translateY: textTranslateY }],
              },
            ]}
          >
            <Text style={styles.brandName}>
              Smart<Text style={styles.brandOrange}>Site</Text>
            </Text>
            <Text style={styles.tagline}>{tr('splash.platformTitle')}</Text>
            <Text style={styles.subtext}>{tr('header.tagline')}</Text>
          </Animated.View>
        </View>

        {/* Bottom Loading Progress Bar */}
        <View style={styles.bottomSection}>
          <View style={styles.progressBarTrack}>
            <Animated.View style={[styles.progressBarFill, { width: progressWidth }]} />
          </View>
          <Text style={styles.loadingText}>{tr('splash.preparing')}</Text>
          <Text style={styles.versionText}>SmartSite v0.1.0 · 2026</Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touchArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: '#041D2E', // SmartSite Operations Deep Navy from web
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 50,
  },
  glowAura: {
    position: 'absolute',
    top: '32%',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#F66B17',
    opacity: 0.25,
    filter: 'blur(40px)', // web fallback, ignored gracefully on native
  },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  logoCard: {
    width: 104,
    height: 104,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F66B17',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  logoImage: {
    width: 84,
    height: 84,
  },
  textGroup: {
    alignItems: 'center',
  },
  brandName: {
    fontSize: 36,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.6,
    marginBottom: 8,
  },
  brandOrange: {
    color: '#F66B17',
  },
  tagline: {
    fontSize: 11,
    fontWeight: '800',
    color: '#F66B17',
    letterSpacing: 1.5,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtext: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '400',
    textAlign: 'center',
  },
  bottomSection: {
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 24,
  },
  progressBarTrack: {
    width: width * 0.48,
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#F66B17',
    borderRadius: 2,
  },
  loadingText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
    marginBottom: 6,
  },
  versionText: {
    fontSize: 11,
    color: 'rgba(148, 163, 184, 0.6)',
    fontWeight: '400',
  },
});
