import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type {
  AttendanceDayResponse,
  AttendanceOverviewResponse,
  AttendanceSessionResponse,
} from '@smartsite/api-client';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { useWorkspace } from '../workspace/workspace-context';
import { Button, ErrorNotice, Field } from '../shared/ui';
import { RequestSheet } from '../shared/request-sheet';
import { required, useCommand } from '../shared/data';
import { attendanceFullTime } from './attendance-day-view';

export type AttendanceReviewTarget =
  | { kind: 'correction'; value: AttendanceOverviewResponse['corrections'][number] }
  | { kind: 'duplicate'; value: AttendanceSessionResponse }
  | { kind: 'day'; value: AttendanceDayResponse };

export function AttendanceReviewSheet({
  target,
  timezone,
  onClose,
  onSaved,
}: {
  target: AttendanceReviewTarget;
  timezone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { client, scope, token } = useWorkspace();
  const [note, setNote] = useState('');
  const command = useCommand();
  const title = t(
    target.kind === 'correction'
      ? 'attendanceReview.reviewCorrection'
      : target.kind === 'duplicate'
        ? 'attendanceReview.ignoreDuplicate'
        : 'attendanceReview.acknowledge',
  );
  const save = (approve = true) =>
    command.mutate(async () => {
      if (target.kind === 'correction') {
        await client.reviewAttendanceCorrection(token, scope.siteId, target.value.id, {
          approve,
          ...(note.trim() ? { reviewNote: note.trim() } : {}),
        });
      } else if (target.kind === 'duplicate') {
        await client.ignoreDuplicateAttendance(token, scope.siteId, target.value.id, {
          expectedSessionVersion: target.value.version,
          reason: required(note, t('attendanceReview.reason')),
        });
      } else {
        await client.confirmAttendanceDay(token, scope.siteId, target.value.id, {
          expectedVersion: target.value.version,
          reviewNote: required(note, t('attendanceReview.reason')),
        });
      }
      onSaved();
      onClose();
    });
  return (
    <RequestSheet
      visible
      variant="compact"
      title={title}
      onClose={onClose}
      busy={command.isPending}
      footer={
        <View style={styles.actions}>
          <ErrorNotice error={command.error} />
          <Button
            label={t(target.kind === 'correction' ? 'attendanceReview.approve' : 'common.confirm')}
            disabled={command.isPending || (target.kind !== 'correction' && !note.trim())}
            onPress={() => save(true)}
          />
          {target.kind === 'correction' && (
            <Button
              secondary
              label={t('attendanceReview.reject')}
              disabled={command.isPending || !note.trim()}
              onPress={() => save(false)}
            />
          )}
        </View>
      }
    >
      <Text style={styles.name}>{target.value.workerName}</Text>
      <Text style={styles.hint}>
        {t(
          target.kind === 'correction'
            ? 'attendanceReview.correctionHint'
            : target.kind === 'duplicate'
              ? 'attendanceReview.duplicateHint'
              : 'attendanceReview.acknowledgeHint',
        )}
      </Text>
      {target.kind === 'correction' && (
        <View style={styles.summary}>
          <Text style={styles.caption}>{t('attendanceDetail.proposedTimes')}</Text>
          <Text style={styles.value}>
            {attendanceFullTime(target.value.proposedInAt, timezone)} →{' '}
            {attendanceFullTime(target.value.proposedOutAt, timezone)}
          </Text>
          <Text style={styles.caption}>{t('attendance.correctionReason')}</Text>
          <Text style={styles.value}>{target.value.reason}</Text>
        </View>
      )}
      {target.kind === 'duplicate' && (
        <View style={styles.summary}>
          <Text style={styles.value}>
            {attendanceFullTime(target.value.rawInAt ?? target.value.effectiveInAt, timezone)}
          </Text>
        </View>
      )}
      <Field
        multiline
        label={t(
          target.kind === 'correction' ? 'attendanceReview.note' : 'attendanceReview.reason',
        )}
        value={note}
        onChangeText={setNote}
        editable={!command.isPending}
      />
      {target.kind === 'correction' && (
        <Text style={styles.hint}>{t('attendanceReview.rejectionNote')}</Text>
      )}
    </RequestSheet>
  );
}
const styles = StyleSheet.create({
  actions: { gap: 8 },
  name: { fontSize: 17, lineHeight: 25, fontWeight: '700', color: colors.textPrimary },
  hint: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
  summary: { borderRadius: 14, padding: 14, backgroundColor: colors.surfaceSubtle, gap: 8 },
  caption: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
  value: { fontSize: 14, lineHeight: 22, color: colors.textPrimary },
});
