import { useEffect, useMemo, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import Svg, { Path } from 'react-native-svg';
import { useWorkspace } from './workspace-context';
import { Body, Button, Choice, ErrorNotice, Hint } from '../shared/ui';
import { useTranslation } from '../../i18n';

function QrGraphic({ code }: { code: string }) {
  const { size, path } = useMemo(() => {
    const { modules } = QRCode.create(code, { errorCorrectionLevel: 'M' });
    let path = '';
    for (let y = 0; y < modules.size; y++)
      for (let x = 0; x < modules.size; x++)
        if (modules.get(y, x)) path += `M${x + 4} ${y + 4}h1v1h-1z`;
    return { size: modules.size + 8, path };
  }, [code]);
  return (
    <View accessibilityLabel="QR dự phòng do máy chủ cấp" style={{ alignItems: 'center' }}>
      <Svg width={240} height={240} viewBox={`0 0 ${size} ${size}`}>
        <Path d={`M0 0h${size}v${size}H0z`} fill="white" />
        <Path d={path} fill="black" />
      </Svg>
    </View>
  );
}

export function WorkerQrPanel() {
  const { t } = useTranslation();
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  return (
    <View style={{ gap: 12, width: '100%' }}>
      <Hint>{t('qr.hint')}</Hint>
      <Choice
        label={t('qr.passage')}
        value={direction}
        options={[
          { value: 'IN', label: t('qr.directionIn') },
          { value: 'OUT', label: t('qr.directionOut') },
        ]}
        onChange={(value) => setDirection(value as 'IN' | 'OUT')}
      />
      <WorkerQrPass key={direction} direction={direction} />
    </View>
  );
}

function WorkerQrPass({ direction }: { direction: 'IN' | 'OUT' }) {
  const { t } = useTranslation();
  const { client, token, scope, queryKey } = useWorkspace();
  const [now, setNow] = useState(Date.now);
  const pass = useQuery({
    queryKey: [...queryKey, 'worker-qr', direction],
    queryFn: ({ signal }) => client.issueWorkerQr(token, scope.siteId, { direction }, { signal }),
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const subscription = AppState.addEventListener('change', () => setNow(Date.now()));
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  const data = pass.data;
  const remaining = data?.expiresAt
    ? Math.max(0, Math.ceil((Date.parse(data.expiresAt) - now) / 1000))
    : 0;
  const current = data && !pass.isFetching && !pass.isError;
  return (
    <View style={{ gap: 12 }}>
      {pass.isFetching && <Hint>{t('qr.gettingQr')}</Hint>}
      <ErrorNotice error={pass.error} />
      {current &&
        (remaining > 0 ? (
          <>
            <QrGraphic code={data.token} />
            <Body>
              <Text style={{ fontSize: 22, fontWeight: '800' }}>
                {t('qr.accessCode', { code: data.token })}
              </Text>
            </Body>
            <Hint>{t('qr.manualEntryHint')}</Hint>
            <Body>
              {t('qr.validRemaining', {
                time: `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`,
              })}
            </Body>
            <Hint>{t('qr.refreshHint')}</Hint>
          </>
        ) : (
          <Body>{t('qr.expired')}</Body>
        ))}
      <Button
        label={pass.isFetching ? t('qr.gettingQr') : t('qr.refresh')}
        disabled={pass.isFetching}
        onPress={() => {
          setNow(Date.now());
          void pass.refetch();
        }}
      />
    </View>
  );
}
