import { translate as tr } from '../../i18n';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  NativeUploadFile,
  WorkerDocumentKind,
  WorkerDocumentIdentityCheck,
  WorkerDocumentResponse,
  WorkerDocumentDateCheck,
} from '@smartsite/api-client';
import { healthCertificateExpiry, isWorkerDocumentDate } from '@smartsite/api-client';
import { useWorkspace } from '../workspace/workspace-context';
import { useCommand, validDates } from '../shared/data';
import { Body, Button, Card, ErrorNotice, Hint, QueryState, Field } from '../shared/ui';
import { Attachments, EvidenceButton } from '../shared/uploads';
import { useTranslation } from '../../i18n';

export const documentKinds: readonly WorkerDocumentKind[] = [
  'SAFETY_CARD',
  'HEALTH_CERTIFICATE',
  'PERSONAL_INSURANCE',
];

function IdentityNotice({
  check,
  reference,
}: {
  check?: WorkerDocumentIdentityCheck;
  reference: string | null;
}) {
  const { t } = useTranslation();
  if (check?.status === 'MATCH') return <Hint>{t('documents.identityMatch')}</Hint>;
  if (check?.status !== 'MISMATCH') return null;
  return (
    <View
      accessibilityRole="alert"
      style={{
        gap: 5,
        padding: 12,
        backgroundColor: '#FFFBEB',
        borderColor: '#F59E0B',
        borderWidth: 1,
        borderRadius: 8,
      }}
    >
      <Body>{t('documents.identityMismatch')}</Body>
      <Hint>
        {t('documents.identityValues', {
          expected: reference ?? '—',
          detected: check.detectedNationalIds.join(', '),
        })}
      </Hint>
    </View>
  );
}

export function WorkerDocuments({
  workerId,
  canUpload = false,
  canSubmitDocuments = false,
}: {
  workerId: string;
  canUpload?: boolean;
  canSubmitDocuments?: boolean;
}) {
  const { t } = useTranslation();
  const { client, token, scope, queryKey } = useWorkspace();
  const canUploadCertificates = canUpload || canSubmitDocuments;
  const profile = useQuery({
    queryKey: [...queryKey, 'worker-documents', workerId],
    queryFn: () => client.workerCompliance(token, scope.siteId, workerId),
  });
  const command = useCommand();
  const [identityDrafts, setIdentityDrafts] = useState<
    Partial<Record<'FRONT' | 'BACK', NativeUploadFile[]>>
  >({});

  return (
    <View style={docStyles.container}>
      {/* Header Info */}
      <View style={docStyles.headerBlock}>
        <Text style={docStyles.screenTitle}>{t('documents.title')}</Text>
        <Hint>{t(canSubmitDocuments ? 'documents.renewalHint' : 'documents.hint')}</Hint>
      </View>

      <QueryState query={profile}>
        {(data) => {
          const isReviewed = data.submissionStatus === 'REVIEWED';
          const isPending = data.submissionStatus === 'PENDING_REVIEW';
          const initials =
            data.displayName
              .split(' ')
              .map((p) => p[0])
              .filter(Boolean)
              .slice(-2)
              .join('')
              .toUpperCase() || 'W';

          return (
            <>
              {/* Worker Profile Overview Card */}
              <Card>
                <View style={docStyles.workerHeroRow}>
                  <View style={docStyles.avatarCircle}>
                    <Text style={docStyles.avatarText}>{initials}</Text>
                  </View>
                  <View style={docStyles.workerHeroText}>
                    <Text style={docStyles.workerName}>{data.displayName}</Text>
                    <Text style={docStyles.workerCode}>{data.externalId}</Text>
                  </View>
                  <View
                    style={[
                      docStyles.statusPill,
                      {
                        backgroundColor: isReviewed ? '#ECFDF5' : isPending ? '#FFFBEB' : '#F8FAFC',
                        borderColor: isReviewed ? '#A7F3D0' : isPending ? '#FDE68A' : '#E2E8F0',
                      },
                    ]}
                  >
                    <View
                      style={[
                        docStyles.statusDot,
                        {
                          backgroundColor: isReviewed
                            ? '#10B981'
                            : isPending
                              ? '#F59E0B'
                              : '#64748B',
                        },
                      ]}
                    />
                    <Text
                      style={[
                        docStyles.statusText,
                        { color: isReviewed ? '#047857' : isPending ? '#92400E' : '#475569' },
                      ]}
                    >
                      {t(`documents.${data.submissionStatus}`)}
                    </Text>
                  </View>
                </View>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {data.status === 'EXPIRED' && (
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: '700',
                        color: '#B91C1C',
                        backgroundColor: '#FEF2F2',
                        borderColor: '#FCA5A5',
                        borderWidth: 1,
                        borderRadius: 8,
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                      }}
                    >
                      {t('documents.EXPIRED')}
                    </Text>
                  )}
                  {data.needsSupplement && (
                    <View
                      style={{
                        backgroundColor: '#FEF2F2',
                        borderColor: '#FCA5A5',
                        borderWidth: 1,
                        borderRadius: 8,
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                      }}
                    >
                      <Text style={{ color: '#B91C1C', fontSize: 12, fontWeight: '700' }}>
                        {t('documents.needsSupplement')}
                      </Text>
                    </View>
                  )}
                </View>
                {/* Details Grid */}
                <View style={docStyles.metaGrid}>
                  <View style={docStyles.metaItem}>
                    <Text style={docStyles.metaLabel}>{t('documents.nationalId')}</Text>
                    <Text style={docStyles.metaValue}>{data.nationalId ?? '—'}</Text>
                  </View>
                  <View style={docStyles.metaItem}>
                    <Text style={docStyles.metaLabel}>{t('documents.phoneNumber')}</Text>
                    <Text style={docStyles.metaValue}>{data.phoneNumber ?? '—'}</Text>
                  </View>
                  <View style={docStyles.metaItemFull}>
                    <Text style={docStyles.metaLabel}>
                      {t('documents.gender')} · {t('documents.address')}
                    </Text>
                    <Text style={docStyles.metaValue}>
                      {data.gender ? t(`documents.${data.gender}`) : '—'} · {data.address ?? '—'}
                    </Text>
                  </View>
                </View>

                {data.expiringKinds.length > 0 && (
                  <View style={docStyles.expiringBanner}>
                    <Text style={docStyles.expiringText}>⚠️ {t('documents.expiring')}</Text>
                  </View>
                )}
              </Card>

              {/* Identity Images (Front & Back) */}
              <View style={docStyles.sectionHeader}>
                <Text style={docStyles.sectionTitle}>{tr('documents.identityHeading')}</Text>
              </View>

              {(['FRONT', 'BACK'] as const).map((side) => {
                const image = data.identityImages.find((i) => i.side === side);
                return (
                  <Card key={side}>
                    <View style={docStyles.cardHeaderRow}>
                      <Text style={docStyles.cardTitle}>{t(`documents.${side}`)}</Text>
                      {image ? (
                        <View style={docStyles.acceptedBadge}>
                          <Text style={docStyles.acceptedText}>
                            ✓ {t('documents.qualityAccepted')}
                          </Text>
                        </View>
                      ) : (
                        <View style={docStyles.emptyBadge}>
                          <Text style={docStyles.emptyText}>{t('documents.noFile')}</Text>
                        </View>
                      )}
                    </View>

                    {image ? (
                      <View style={{ gap: 10, marginTop: 4 }}>
                        <EvidenceButton
                          label={t('documents.view')}
                          mediaType={image.mediaType}
                          load={() =>
                            client.workerIdentityImageFile(token, scope.siteId, workerId, image.id)
                          }
                        />
                        <IdentityNotice check={image.identityCheck} reference={data.nationalId} />
                        {canUpload && (
                          <Button
                            secondary
                            disabled={command.isPending}
                            label={t('documents.ocr')}
                            onPress={() =>
                              command.mutate(() =>
                                client.retryWorkerIdentityOcr(
                                  token,
                                  scope.siteId,
                                  workerId,
                                  image.id,
                                ),
                              )
                            }
                          />
                        )}
                      </View>
                    ) : canUpload && data.contractorId ? (
                      <View style={{ gap: 10, marginTop: 4 }}>
                        <Attachments
                          files={identityDrafts[side] ?? []}
                          maxFiles={1}
                          allowPdf={false}
                          validateFile={async (file) => {
                            const result = await client.checkDocumentImageQuality(
                              token,
                              scope.siteId,
                              data.contractorId!,
                              file,
                            );
                            if (result.status !== 'ACCEPTED')
                              throw new Error(t(`documents.${result.reason}`));
                          }}
                          onChange={(files) =>
                            setIdentityDrafts((previous) => ({ ...previous, [side]: files }))
                          }
                        />
                        <Button
                          label={t('documents.upload')}
                          disabled={command.isPending || !identityDrafts[side]?.[0]}
                          onPress={() =>
                            command.mutate(async () => {
                              await client.uploadWorkerIdentityImage(
                                token,
                                scope.siteId,
                                workerId,
                                side,
                                identityDrafts[side]![0]!,
                              );
                              setIdentityDrafts((previous) => ({ ...previous, [side]: [] }));
                            })
                          }
                        />
                      </View>
                    ) : (
                      <Hint>{t('documents.noFile')}</Hint>
                    )}
                  </Card>
                );
              })}

              {/* 3 Safety & Health Certificates */}
              <View style={docStyles.sectionHeader}>
                <Text style={docStyles.sectionTitle}>{tr('documents.certificatesHeading')}</Text>
              </View>

              {documentKinds.map((kind) => {
                const documents = data.documents.filter((d) => d.kind === kind);
                return (
                  <Card key={kind}>
                    <View style={docStyles.cardHeaderRow}>
                      <Text style={docStyles.cardTitle}>{t(`documents.${kind}`)}</Text>
                      {!documents.length && (
                        <View style={docStyles.emptyBadge}>
                          <Text style={docStyles.emptyText}>{t('documents.noFile')}</Text>
                        </View>
                      )}
                    </View>

                    {documents.map((doc) => {
                      const isApproved = doc.status === 'APPROVED';
                      const isPendingDoc = doc.status === 'PENDING';
                      return (
                        <View key={doc.id} style={docStyles.docRow}>
                          <View style={docStyles.docStatusRow}>
                            <Text style={docStyles.docFilename} numberOfLines={2}>
                              {doc.originalName}
                            </Text>
                            <View
                              style={[
                                docStyles.docStatusPill,
                                {
                                  backgroundColor: isApproved
                                    ? '#ECFDF5'
                                    : isPendingDoc
                                      ? '#FFFBEB'
                                      : '#FEF2F2',
                                  borderColor: isApproved
                                    ? '#A7F3D0'
                                    : isPendingDoc
                                      ? '#FDE68A'
                                      : '#FECACA',
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  docStyles.docStatusText,
                                  {
                                    color: isApproved
                                      ? '#065F46'
                                      : isPendingDoc
                                        ? '#92400E'
                                        : '#991B1B',
                                  },
                                ]}
                              >
                                {t(`documents.${doc.status}`)}
                              </Text>
                            </View>
                          </View>

                          {/* Dates row */}
                          <View style={docStyles.dateBox}>
                            <Text style={docStyles.dateText}>
                              📅 {t('documents.issuedOn')}: {doc.issuedOn ?? '—'}
                            </Text>
                            <Text style={docStyles.dateText}>
                              ⏳ {t('documents.expiresOn')}: {doc.expiresOn ?? '—'}
                            </Text>
                          </View>

                          {doc.reviewNote && (
                            <View style={docStyles.noteBox}>
                              <Text style={docStyles.noteText}>💬 {doc.reviewNote}</Text>
                            </View>
                          )}

                          {doc.submittedExpiresOn &&
                            (kind !== 'HEALTH_CERTIFICATE' || doc.submittedIssuedOn) && (
                              <View style={docStyles.submittedPill}>
                                <Text style={docStyles.submittedPillText}>
                                  ⏱ {t('documents.submittedExpiryLabel')}: {doc.submittedExpiresOn}
                                </Text>
                              </View>
                            )}

                          <IdentityNotice check={doc.identityCheck} reference={data.nationalId} />

                          {doc.status === 'PENDING' && (
                            <View style={docStyles.pendingSection}>
                              {canUploadCertificates && (
                                <SubmittedExpiryEditor
                                  key={`${doc.id}:${doc.version}`}
                                  doc={doc}
                                  disabled={command.isPending}
                                  save={(value) =>
                                    command.mutate(async () => {
                                      if (value) validDates(value, value);
                                      await client.updateWorkerDocumentExpiry(
                                        token,
                                        scope.siteId,
                                        workerId,
                                        doc.id,
                                        {
                                          expectedVersion: doc.version,
                                          ...(kind === 'HEALTH_CERTIFICATE'
                                            ? { submittedIssuedOn: value }
                                            : { submittedExpiresOn: value }),
                                        },
                                      );
                                    })
                                  }
                                />
                              )}

                              <View style={docStyles.ocrBox}>
                                <Text style={docStyles.ocrText}>
                                  🔍 {t('documents.ocrIssued')}:{' '}
                                  {doc.ocr.issuedOn ?? t('documents.notDetermined')}
                                  {kind !== 'HEALTH_CERTIFICATE' && (
                                    <>
                                      {' '}
                                      · {t('documents.ocrExpires')}:{' '}
                                      {doc.ocr.expiresOn ?? t('documents.notDetermined')}
                                    </>
                                  )}
                                </Text>
                                <Text style={docStyles.ocrHintText}>
                                  {t(
                                    kind === 'HEALTH_CERTIFICATE'
                                      ? 'documents.healthExpiryRule'
                                      : 'documents.ocrHint',
                                  )}{' '}
                                  {kind === 'HEALTH_CERTIFICATE'
                                    ? (healthCertificateExpiry(
                                        doc.submittedIssuedOn ?? doc.ocr.issuedOn,
                                      ) ?? t('documents.notDetermined'))
                                    : ''}
                                </Text>
                              </View>
                            </View>
                          )}

                          <EvidenceButton
                            label={t('documents.view')}
                            mediaType={doc.mediaType}
                            load={() =>
                              client.workerDocumentFile(token, scope.siteId, workerId, doc.id)
                            }
                          />
                        </View>
                      );
                    })}

                    {canUploadCertificates && (canSubmitDocuments || data.contractorId) && (
                      <WorkerCertificateSubmission
                        workerId={workerId}
                        kind={kind}
                        requireDate={canSubmitDocuments}
                        disabled={command.isPending}
                      />
                    )}
                  </Card>
                );
              })}
            </>
          );
        }}
      </QueryState>
      <ErrorNotice error={command.error} />
    </View>
  );
}

function DocumentDateNotice({ check }: { check: WorkerDocumentDateCheck }) {
  const { t } = useTranslation();
  const label = {
    MATCH: 'documents.dateMatch',
    MISMATCH: 'documents.dateMismatch',
    UNAVAILABLE: 'documents.dateUnavailable',
    NO_REFERENCE: 'documents.dateNoReference',
  }[check.status];
  const date = (value: string | null) =>
    value?.split('-').reverse().join('/') ?? t('documents.notDetermined');
  return (
    <View
      style={{
        padding: 12,
        gap: 4,
        borderRadius: 8,
        backgroundColor: check.status === 'MATCH' ? '#ECFDF5' : '#FFFBEB',
      }}
    >
      <Body>{t(label)}</Body>
      <Hint>
        {t('documents.dateDeclared')}: {date(check.submittedDate)} · {t('documents.dateDetected')}:{' '}
        {date(check.detectedDate)}
      </Hint>
    </View>
  );
}

function WorkerCertificateSubmission({
  workerId,
  kind,
  disabled,
  requireDate = true,
}: {
  workerId: string;
  kind: WorkerDocumentKind;
  disabled: boolean;
  requireDate?: boolean;
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
  return (
    <View style={docStyles.uploadSection}>
      <Text style={docStyles.uploadHeading}>{t('documents.upload')}</Text>
      <Hint>{t('documents.ocrDateHint')}</Hint>
      <Field
        label={`${t(`documents.${kind}`)} - ${t(health ? 'documents.declaredIssuedOn' : 'documents.declaredExpiresOn')} (YYYY-MM-DD)`}
        placeholder="YYYY-MM-DD"
        value={date}
        maxLength={10}
        editable={!busy}
        onChangeText={(value) => {
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
          });
        }}
      />
    </View>
  );
}

function SubmittedExpiryEditor({
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
      <Field
        label={`${t(health ? 'documents.submittedIssuedOn' : 'documents.submittedExpiresOn')} (YYYY-MM-DD)`}
        value={value}
        placeholder="YYYY-MM-DD"
        maxLength={10}
        editable={!disabled}
        onChangeText={setValue}
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
  container: {
    gap: 14,
    paddingBottom: 24,
  },
  headerBlock: {
    gap: 4,
    marginBottom: 4,
  },
  screenTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#041D2E',
    letterSpacing: -0.3,
  },
  workerHeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    flexWrap: 'wrap',
  },
  avatarCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#FFF4EE',
    borderWidth: 1,
    borderColor: '#FFD9C6',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#F66B17',
  },
  workerHeroText: {
    flex: 1,
    gap: 2,
    minWidth: 100,
    flexBasis: 120,
  },
  workerName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  workerCode: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
    color: '#64748B',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    gap: 5,
    maxWidth: '100%',
    flexShrink: 0,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '800',
    flexShrink: 1,
    lineHeight: 18,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 10,
  },
  metaItem: {
    flexBasis: 'auto',
    flexGrow: 1,
    minWidth: 144,
    maxWidth: '100%',
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 3,
  },
  metaItemFull: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 3,
  },
  metaLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: '#475569',
  },
  metaValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  expiringBanner: {
    marginTop: 8,
    padding: 10,
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  expiringText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#92400E',
  },
  sectionHeader: {
    marginTop: 10,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 14.5,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#0F1E36',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  acceptedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  acceptedText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#065F46',
  },
  emptyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  docRow: {
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  docStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  docFilename: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
    minWidth: 120,
    flexBasis: 160,
  },
  docStatusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  docStatusText: {
    fontSize: 13,
    fontWeight: '800',
  },
  dateBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    gap: 4,
  },
  dateText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  noteBox: {
    backgroundColor: '#FFF7ED',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFEDD5',
    padding: 10,
  },
  noteText: {
    fontSize: 14,
    fontStyle: 'italic',
    color: '#9A3412',
  },
  submittedPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFEDD5',
  },
  submittedPillText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#C2410C',
  },
  pendingSection: {
    gap: 8,
    paddingTop: 4,
  },
  expiryEditorBox: {
    gap: 8,
    padding: 12,
    backgroundColor: '#FFFDF9',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  ocrBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    gap: 4,
  },
  ocrText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#1E293B',
  },
  ocrHintText: {
    fontSize: 12.5,
    color: '#475569',
  },
  uploadSection: {
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  uploadHeading: {
    fontSize: 13.5,
    fontWeight: '800',
    textTransform: 'uppercase',
    color: '#0F1E36',
  },
  matchBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#ECFDF5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  matchText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#065F46',
  },
  mismatchBox: {
    gap: 6,
    padding: 12,
    backgroundColor: '#FFFBEB',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 10,
  },
  mismatchTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#92400E',
  },
  mismatchText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#B45309',
  },
  mismatchAdvisory: {
    fontSize: 12.5,
    color: '#78350F',
    lineHeight: 18,
  },
});
