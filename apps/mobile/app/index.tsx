import React, { useState } from 'react';
import { SmartSiteMobileApp } from '../src/SmartSiteMobileApp';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getBackendHealth } from '@smartsite/api-client';
import { useQuery } from '@tanstack/react-query';

const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

function ConnectionDiagnostics({ onClose }: { onClose: () => void }) {
  const health = useQuery({
    queryKey: ['backend-health', apiUrl],
    queryFn: ({ signal }) => getBackendHealth(apiUrl ?? '', { signal, timeoutMs: 8_000 }),
    enabled: Boolean(apiUrl),
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.diagHeader}>
          <Text style={styles.eyebrow}>SMARTSITE / MOBILE</Text>
          <Pressable onPress={onClose} style={styles.closeDiagBtn}>
            <Text style={styles.closeDiagText}>← Quay lại ứng dụng</Text>
          </Pressable>
        </View>

        <Text accessibilityRole="header" style={styles.title}>
          Kiểm tra kết nối Backend
        </Text>
        <Text style={styles.description}>
          Kiểm tra kết nối mạng giữa thiết bị di động và máy chủ SmartSite API.
        </Text>

        <View style={styles.panel} accessibilityLiveRegion="polite">
          <Text style={styles.label}>BACKEND API</Text>
          <Text selectable style={styles.address}>
            {apiUrl || 'Chưa cấu hình địa chỉ API'}
          </Text>

          {!apiUrl ? (
            <>
              <Text style={styles.status}>Cần cấu hình EXPO_PUBLIC_API_URL</Text>
              <Text style={styles.detail}>
                Thiết lập EXPO_PUBLIC_API_URL trong apps/mobile/.env.local để kết nối backend.
              </Text>
            </>
          ) : health.isFetching ? (
            <View style={styles.loading}>
              <ActivityIndicator accessibilityLabel="Đang kiểm tra kết nối" color="#F05A28" />
              <Text style={styles.detail}>Đang kiểm tra kết nối…</Text>
            </View>
          ) : health.isError ? (
            <>
              <Text style={[styles.status, styles.error]}>Không thể kết nối</Text>
              <Text style={styles.detail}>{health.error.message}</Text>
              <Text style={styles.hint}>
                Xác nhận backend đang chạy và địa chỉ API có thể truy cập được từ thiết bị này.
              </Text>
            </>
          ) : health.isSuccess ? (
            <>
              <Text style={[styles.status, styles.success]}>Backend đang hoạt động</Text>
              <Text style={styles.detail}>{health.data.service}</Text>
            </>
          ) : (
            <Text style={styles.detail}>Đang chờ kết nối mạng…</Text>
          )}

          {apiUrl ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: health.isFetching }}
              disabled={health.isFetching}
              onPress={() => void health.refetch()}
              style={({ pressed }) => [
                styles.button,
                (pressed || health.isFetching) && styles.buttonDimmed,
              ]}
            >
              <Text style={styles.buttonLabel}>
                {health.isFetching ? 'Đang kiểm tra…' : health.isError ? 'Thử lại' : 'Kiểm tra lại'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function MobileRootScreen() {
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  if (showDiagnostics) {
    return <ConnectionDiagnostics onClose={() => setShowDiagnostics(false)} />;
  }

  return <SmartSiteMobileApp />;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8F9FB' },
  content: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 32,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  diagHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  closeDiagBtn: {
    padding: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  closeDiagText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F05A28',
  },
  eyebrow: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  title: {
    color: '#0F1E36',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.6,
    marginBottom: 10,
  },
  description: { color: '#64748B', fontSize: 15, lineHeight: 22, marginBottom: 24 },
  panel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 16,
    padding: 22,
  },
  label: { color: '#64748B', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8 },
  address: { color: '#0F1E36', fontSize: 14, lineHeight: 22, marginBottom: 20 },
  status: { color: '#0F1E36', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  success: { color: '#059669' },
  error: { color: '#DC2626' },
  detail: { color: '#334155', fontSize: 14, lineHeight: 22 },
  hint: { color: '#64748B', fontSize: 13, lineHeight: 20, marginTop: 10 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  button: {
    alignItems: 'center',
    backgroundColor: '#F05A28',
    borderRadius: 12,
    minHeight: 46,
    justifyContent: 'center',
    padding: 12,
    marginTop: 22,
  },
  buttonDimmed: { opacity: 0.6 },
  buttonLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
