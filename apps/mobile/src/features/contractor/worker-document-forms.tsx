import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import {
  healthCertificateExpiry,
  isWorkerDocumentDate,
  type NativeUploadFile,
  type WorkerDocumentKind,
  type WorkerDocumentResponse,
  type WorkerDocumentDateCheck,
} from '@smartsite/api-client';
import { useTranslation } from '../../i18n';
import { IconCheck, IconAlert, IconDocument } from '../../components/common/Icons';
import { useWorkspace } from '../workspace/workspace-context';
import { useCommand, validDates } from '../shared/data';
import { Body, Button, ErrorNotice, Hint } from '../shared/ui';
import { CalendarDateField } from '../shared/calendar-date-field';
import { Attachments } from '../shared/uploads';
function DocumentDateNotice({ check }: { check: WorkerDocumentDateCheck }) {
  const { t } = useTranslation();
  const label = {
    MATCH: 'documents.dateMatch',
    MISMATCH: 'documents.dateMismatch',
    UNAVAILABLE: 'documents.dateUnavailable',
    NO_REFERENCE: 'documents.dateNoReference',
  }[check.status];
  const isMatch = check.status === 'MATCH';
  const date = (value: string | null) =>
    value?.split('-').reverse().join('/') ?? t('documents.notDetermined');
  return (
    <View
      style={[
        docStyles.noticeBox,
        {
          backgroundColor: isMatch ? '#EDFAF2' : '#FFFBEB',
          borderColor: isMatch ? '#A7F3D0' : '#FDE68A',
        },
      ]}
    >
      <View style={docStyles.noticeHeaderRow}>
        {isMatch ? (
          <IconCheck size={16} color="#059669" />
        ) : (
          <IconAlert size={16} color="#D97706" />
        )}
        <Body>{t(label)}</Body>
      </View>
      <Hint>
        {t('documents.dateDeclared')}: {date(check.submittedDate)} · {t('documents.dateDetected')}:{' '}
        {date(check.detectedDate)}
      </Hint>
    </View>
  );
}

export function WorkerCertificateSubmission({
  workerId,
  kind,
  disabled,
  requireDate = true,
  onBusyChange,
  onSubmitted,
}: {
  workerId: string;
  kind: WorkerDocumentKind;
  disabled: boolean;
  requireDate?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onSubmitted?: () => void;
}) {
  const { t } = useTranslation();
  const { client, token, scope } = useWorkspace();
  const [date, setDate] = useState('');
  const [dateEdited, setDateEdited] = useState(false);
  const [files, setFiles] = useState<NativeUploadFile[]>([]);
  const command = useCommand();
  const health = kind === 'HEALTH_CERTIFICATE';
  const dates = (value: string) =>
    !value ? {} : health ? { submittedIssuedOn: value } : { submittedExpiresOn: value };
  const check = useMutation({
    mutationFn: async ({ file, date }: { file: NativeUploadFile; date: string }) => {
      if (date) validDates(date, date);
      const result = await client.checkWorkerDocumentDates(
        token,
        scope.siteId,
        workerId,
        kind,
        file,
        dates(date),
      );
      if (result.quality.status !== 'ACCEPTED')
        throw new Error(t(`documents.${result.quality.reason}`));
      return result;
    },
    onSuccess: (result, variables) => {
      if (!variables.date) setDate(result.dateCheck.detectedDate ?? '');
    },
  });
  const file = files[0];
  const checked =
    check.isSuccess &&
    (check.variables.date || check.data.dateCheck.detectedDate || '') === date &&
    check.variables.file.uri === file?.uri;
  const valid = !date || isWorkerDocumentDate(date);
  const canSubmit = checked && valid && (!requireDate || isWorkerDocumentDate(date));
  const busy = disabled || command.isPending || check.isPending;
  useEffect(() => {
    onBusyChange?.(command.isPending || check.isPending);
  }, [command.isPending, check.isPending, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  return (
    <View style={docStyles.uploadSection}>
      <View style={docStyles.uploadHeaderRow}>
        <View style={docStyles.uploadHeaderIconBox}>
          <IconDocument size={14} color="#EA580C" />
        </View>
        <Text style={docStyles.uploadHeading}>{t('documents.upload')}</Text>
      </View>
      <Hint>{t('documents.ocrDateHint')}</Hint>
      <CalendarDateField
        label={t(health ? 'documents.declaredIssuedOn' : 'documents.declaredExpiresOn')}
        value={date}
        disabled={busy}
        onChange={(value) => {
          setDate(value);
          setDateEdited(!!value);
        }}
      />
      {health && (
        <Hint>
          {t('documents.healthExpiryRule')}{' '}
          {healthCertificateExpiry(date) ?? t('documents.notDetermined')}
        </Hint>
      )}
      <Attachments
        files={files}
        onChange={setFiles}
        maxFiles={1}
        disabled={busy || !valid}
        validateFile={async (file) => {
          await check.mutateAsync({ file, date: dateEdited ? date : '' });
        }}
      />
      {check.isPending && <Hint>{t('documents.checkingDates')}</Hint>}
      {checked && check.data && (
        <DocumentDateNotice
          check={{
            ...check.data.dateCheck,
            submittedDate: date || null,
            status: date
              ? check.data.dateCheck.detectedDate
                ? date === check.data.dateCheck.detectedDate
                  ? 'MATCH'
                  : 'MISMATCH'
                : 'UNAVAILABLE'
              : 'NO_REFERENCE',
          }}
        />
      )}
      {file && !checked && !check.isPending && <Hint>{t('documents.dateChanged')}</Hint>}
      <ErrorNotice error={check.error ?? command.error} />
      {file && (
        <Button
          secondary
          label={t('documents.dateRecheck')}
          disabled={busy || !valid}
          onPress={() => {
            void check.mutateAsync({ file, date }).catch(() => {});
          }}
        />
      )}
      <Button
        label={t('documents.submitForReview')}
        disabled={busy || !file || !canSubmit}
        onPress={() => {
          if (!file || !canSubmit || busy) return;
          command.mutate(async () => {
            await client.uploadWorkerDocument(
              token,
              scope.siteId,
              workerId,
              kind,
              file,
              dates(date),
            );
            setFiles([]);
            setDate('');
            setDateEdited(false);
            check.reset();
            onSubmitted?.();
          });
        }}
      />
    </View>
  );
}

export function SubmittedExpiryEditor({
  doc,
  disabled,
  save,
}: {
  doc: WorkerDocumentResponse;
  disabled: boolean;
  save: (value: string | null) => void;
}) {
  const { t } = useTranslation();
  const health = doc.kind === 'HEALTH_CERTIFICATE';
  const original = (health ? doc.submittedIssuedOn : doc.submittedExpiresOn) ?? '';
  const [value, setValue] = useState(original);
  return (
    <View style={docStyles.expiryEditorBox}>
      <CalendarDateField
        label={t(health ? 'documents.submittedIssuedOn' : 'documents.submittedExpiresOn')}
        value={value}
        disabled={disabled}
        onChange={setValue}
      />
      <Hint>
        {t(health ? 'documents.healthExpiryRule' : 'documents.submittedExpiryHint')}{' '}
        {health ? (healthCertificateExpiry(value) ?? '') : ''}
      </Hint>
      <Button
        label={t('documents.saveSubmittedExpiry')}
        disabled={disabled || value === original}
        onPress={() => save(value || null)}
      />
    </View>
  );
}

const docStyles = StyleSheet.create({
  noticeBox: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 6 },
  noticeHeaderRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  uploadSection: { gap: 14 },
  uploadHeaderRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  uploadHeaderIconBox: { padding: 8, borderRadius: 10, backgroundColor: '#FFF7ED' },
  uploadHeading: { fontSize: 14, color: '#0F1E36', fontWeight: '700' },
  expiryEditorBox: { gap: 12, padding: 12, backgroundColor: '#F8FAFC', borderRadius: 12 },
});
