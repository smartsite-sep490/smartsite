import type { Mf06AssessmentResponse } from '@smartsite/api-client';
import { useLocale } from '../../i18n/ppe-locale';

export function Mf06FrameDelivery({
  delivery,
}: {
  delivery: Mf06AssessmentResponse['frameDelivery'];
}) {
  const { t } = useLocale();
  if (!delivery) return null;
  return (
    <p className={`text-xs ${delivery.status === 'PARTIAL' ? 'text-amber-800' : 'text-zinc-600'}`}>
      {t(delivery.status === 'PARTIAL' ? 'mf06.delivery.partial' : 'mf06.delivery.complete', {
        received: delivery.receivedParts,
        total: delivery.partCount,
      })}
    </p>
  );
}
