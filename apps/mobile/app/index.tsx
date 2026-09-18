import { getBackendHealth } from '@smartsite/api-client';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

export default function ConnectionScreen() {
  const health = useQuery({
    queryKey: ['backend-health', apiUrl],
    queryFn: ({ signal }) => getBackendHealth(apiUrl ?? '', { signal, timeoutMs: 8_000 }),
    enabled: Boolean(apiUrl),
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>SMARTSITE / MOBILE</Text>
        <Text accessibilityRole="header" style={styles.title}>
          Connection check
        </Text>
        <Text style={styles.description}>
          Check that this device can reach the SmartSite backend.
        </Text>

        <View style={styles.panel} accessibilityLiveRegion="polite">
          <Text style={styles.label}>BACKEND API</Text>
          <Text selectable style={styles.address}>
            {apiUrl || 'No API address configured'}
          </Text>

          {!apiUrl ? (
            <>
              <Text style={styles.status}>Set your API address</Text>
              <Text style={styles.detail}>
                Set EXPO_PUBLIC_API_URL in apps/mobile/.env.local to an address this device can
                reach, then reload the app.
              </Text>
            </>
          ) : health.isFetching ? (
            <View style={styles.loading}>
              <ActivityIndicator accessibilityLabel="Checking backend connection" color="#235D4C" />
              <Text style={styles.detail}>Checking connection…</Text>
            </View>
          ) : health.isError ? (
            <>
              <Text style={[styles.status, styles.error]}>Could not connect</Text>
              <Text style={styles.detail}>{health.error.message}</Text>
              <Text style={styles.hint}>
                Confirm the backend is running and the API address is reachable from this device.
              </Text>
            </>
          ) : health.isSuccess ? (
            <>
              <Text style={[styles.status, styles.success]}>Backend is online</Text>
              <Text style={styles.detail}>{health.data.service}</Text>
            </>
          ) : (
            <Text style={styles.detail}>Waiting for a network connection…</Text>
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
                {health.isFetching ? 'Checking…' : health.isError ? 'Try again' : 'Check again'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.footnote}>
          Foundation preview. This screen checks API availability only.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F5F1' },
  content: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 48,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  eyebrow: {
    color: '#526158',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 24,
  },
  title: {
    color: '#16271F',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.8,
    marginBottom: 12,
  },
  description: { color: '#526158', fontSize: 17, lineHeight: 26, marginBottom: 32 },
  panel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D5DDD6',
    borderWidth: 1,
    borderRadius: 12,
    padding: 24,
  },
  label: { color: '#526158', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8 },
  address: { color: '#37473D', fontSize: 14, lineHeight: 22, marginBottom: 28 },
  status: { color: '#16271F', fontSize: 21, fontWeight: '600', marginBottom: 8 },
  success: { color: '#235D4C' },
  error: { color: '#9D3529' },
  detail: { color: '#37473D', fontSize: 16, lineHeight: 24 },
  hint: { color: '#526158', fontSize: 14, lineHeight: 22, marginTop: 12 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  button: {
    alignItems: 'center',
    backgroundColor: '#235D4C',
    borderRadius: 8,
    minHeight: 48,
    justifyContent: 'center',
    padding: 12,
    marginTop: 24,
  },
  buttonDimmed: { opacity: 0.6 },
  buttonLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  footnote: { color: '#526158', fontSize: 13, lineHeight: 20, marginTop: 24 },
});
