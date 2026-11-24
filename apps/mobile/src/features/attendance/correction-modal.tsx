import { useState } from 'react';
import { View, Text } from 'react-native';
import type { AttendanceSessionResponse, AttendanceOverviewResponse } from '@smartsite/api-client';
import { useTranslation, translate as tr } from '../../i18n';
import { useWorkspace } from '../workspace/workspace-context';
import { instant, required, useCommand, useRequestId } from '../shared/data';
import { Button, ErrorNotice, Field } from '../shared/ui';
import { DateTimeField } from '../shared/date-time-field';
import { RequestSheet } from '../shared/request-sheet';
import { attendanceFullTime } from './attendance-day-view';
import { useRequestFeedback } from '../shared/request-feedback';
import { colors } from '../../theme/colors';

export function CorrectionModal({
  session,
  missing,
  disabled = false,
  timezone,
  visible,
  onClose,
  onSubmitted,
}: {
  session?: AttendanceSessionResponse;
  missing?: NonNullable<AttendanceOverviewResponse['missingSchedules']>[number];
  disabled?: boolean;
  timezone: string;
  visible: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const { t } = useTranslation();
  const { scope, client, token } = useWorkspace();
  const [from, setFrom] = useState(
      session?.effectiveInAt ?? session?.rawInAt ?? missing?.startsAt ?? '',
    ),
    [to, setTo] = useState(session?.effectiveOutAt ?? session?.rawOutAt ?? missing?.endsAt ?? ''),
    [reason, setReason] = useState('');
  const command = useCommand(),
    requestId = useRequestId();
  const reportSubmitted = useRequestFeedback();

  return (
    <RequestSheet
      visible={visible}
      onClose={onClose}
      busy={command.isPending}
      title={t(missing ? 'attendance.requestMissing' : 'attendance.requestSessionCorrection')}
      subtitle={t(missing ? 'attendance.missingHint' : 'attendance.correctionHint')}
      footer={
        <View style={{ marginTop: 16 }}>
          <ErrorNotice error={command.error} />
          <Button
            label={tr('attendance.submitToManager')}
            disabled={disabled || command.isPending || !from || !to || !reason.trim()}
            onPress={() =>
              command.mutate(async () => {
                if (disabled) return;
                const proposedInAt = instant(from),
                  proposedOutAt = instant(to);
                if (proposedOutAt <= proposedInAt) throw new Error(tr('validation.exitAfterEntry'));
                const input = {
                  expectedSessionVersion: session?.version ?? 1,
                  proposedInAt,
                  proposedOutAt,
                  reason: required(reason, tr('validation.reasonLabel')),
                };
                const payload = {
                  ...input,
                  requestId: requestId(input),
                };
                if (missing)
                  await client.requestMissingAttendance(
                    token,
                    scope.siteId,
                    missing.scheduleId,
                    payload,
                  );
                else if (session)
                  await client.requestAttendanceCorrection(
                    token,
                    scope.siteId,
                    session.id,
                    payload,
                  );
                else return;
                reportSubmitted();
                onSubmitted?.();
                onClose();
              })
            }
          />
        </View>
      }
    >
      {session && (
        <View style={styles.correctionOriginal}>
          <Text style={styles.quickTitle}>{t('attendanceUi.originalTimes')}</Text>
          <Text style={styles.quickHint}>
            {t('attendance.checkIn')}: {attendanceFullTime(session.rawInAt, timezone)}
          </Text>
          <Text style={styles.quickHint}>
            {t('attendance.checkOut')}: {attendanceFullTime(session.rawOutAt, timezone)}
          </Text>
        </View>
      )}
      <DateTimeField compact label={tr('attendance.proposedIn')} value={from} onChange={setFrom} />
      <DateTimeField compact label={tr('attendance.proposedOut')} value={to} onChange={setTo} />
      <Field
        label={tr('attendance.correctionReason')}
        multiline
        value={reason}
        onChangeText={setReason}
      />
    </RequestSheet>
  );
}

const styles = {
  correctionOriginal: {
    padding: 14,
    gap: 8,
    borderRadius: 14,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickTitle: { fontSize: 14, fontWeight: '700' as const, color: colors.textPrimary },
  quickHint: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
};
