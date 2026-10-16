import React from 'react';
import { View, StyleSheet } from 'react-native';

interface WorkerAvatarProps {
  size?: number;
  role?: 'worker' | 'contractor';
}

export function WorkerAvatar({ size = 52, role = 'worker' }: WorkerAvatarProps) {
  const helmetColor = role === 'worker' ? '#F59E0B' : '#FFFFFF'; // Workers wear yellow hardhat, Contractor/Supervisors wear white
  const vestColor = role === 'worker' ? '#F05A28' : '#0284C7'; // Workers orange vest, Contractor blue vest

  return (
    <View style={[styles.container, { width: size, height: size, borderRadius: size / 2 }]}>
      {/* Helmet crown */}
      <View
        style={[
          styles.helmet,
          {
            width: size * 0.46,
            height: size * 0.3,
            backgroundColor: helmetColor,
            borderTopLeftRadius: size * 0.25,
            borderTopRightRadius: size * 0.25,
            top: size * 0.12,
          },
        ]}
      />
      {/* Helmet brim */}
      <View
        style={[
          styles.helmetBrim,
          {
            width: size * 0.54,
            height: size * 0.08,
            backgroundColor: helmetColor,
            top: size * 0.35,
          },
        ]}
      />
      {/* Head */}
      <View
        style={[
          styles.face,
          {
            width: size * 0.34,
            height: size * 0.32,
            top: size * 0.36,
          },
        ]}
      />
      {/* Shoulders & Vest */}
      <View
        style={[
          styles.vest,
          {
            width: size * 0.72,
            height: size * 0.36,
            backgroundColor: vestColor,
            top: size * 0.62,
          },
        ]}
      >
        {/* Reflective Stripes */}
        <View style={styles.reflectiveStripes}>
          <View style={[styles.stripe, { backgroundColor: '#E2E8F0' }]} />
          <View style={[styles.stripe, { backgroundColor: '#E2E8F0' }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#EEF2F6',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  helmet: {
    position: 'absolute',
    zIndex: 3,
  },
  helmetBrim: {
    position: 'absolute',
    borderRadius: 2,
    zIndex: 4,
  },
  face: {
    position: 'absolute',
    backgroundColor: '#FBCFE8', // warm skin tone
    borderRadius: 8,
    zIndex: 2,
  },
  vest: {
    position: 'absolute',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  reflectiveStripes: {
    flexDirection: 'row',
    width: '60%',
    justifyContent: 'space-between',
    height: '100%',
  },
  stripe: {
    width: 3,
    height: '100%',
  },
});
