import { LEAVE_NOTICE_HOURS, type LeaveNoticeType } from '@smartsite/api-client';
import { useTranslation } from '../../i18n';
import { Choice, Hint } from '../shared/ui';

export function LeaveNoticeFields({
  value,
  onChange,
}: {
  value: LeaveNoticeType;
  onChange: (value: LeaveNoticeType) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Choice
        label={t('leavePolicy.noticeType')}
        value={value}
        onChange={(next) => onChange(next as LeaveNoticeType)}
        options={[
          { value: 'PLANNED', label: t('leavePolicy.planned') },
          { value: 'EMERGENCY', label: t('leavePolicy.emergency') },
        ]}
      />
      <Hint>{t('leavePolicy.noticeHint', { hours: LEAVE_NOTICE_HOURS })}</Hint>
      {value === 'EMERGENCY' && <Hint>{t('leavePolicy.emergencyHint')}</Hint>}
    </>
  );
}
