import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type {
  NativeUploadFile,
  WorkerDocumentKind,
  WorkerDocumentIdentityCheck,
  WorkerDocumentResponse,
} from '@smartsite/api-client';
import { healthCertificateExpiry } from '@smartsite/api-client';
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
}: {
  workerId: string;
  canUpload?: boolean;
}) {
  const { t } = useTranslation();
  const { client, token, scope, queryKey } = useWorkspace();
  const profile = useQuery({
    queryKey: [...queryKey, 'worker-documents', workerId],
    queryFn: () => client.workerCompliance(token, scope.siteId, workerId),
  });
  const command = useCommand();
  const [drafts, setDrafts] = useState<Partial<Record<WorkerDocumentKind, NativeUploadFile[]>>>({});
  const [expiries, setExpiries] = useState<Partial<Record<WorkerDocumentKind, string>>>({});
  const [identityDrafts, setIdentityDrafts] = useState<
    Partial<Record<'FRONT' | 'BACK', NativeUploadFile[]>>
  >({});

  return (
    <View style={docStyles.container}>
      {/* Header Info */}
      <View style={docStyles.headerBlock}>
        <Text style={docStyles.screenTitle}>{t('documents.title')}</Text>
        <Hint>{t('documents.hint')}</Hint>
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
                <Text style={docStyles.sectionTitle}>Căn cước công dân (CCCD)</Text>
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
                <Text style={docStyles.sectionTitle}>Chứng chỉ & Giấy tờ an toàn</Text>
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
                            <Text style={docStyles.docFilename} numberOfLines={1}>
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
                              {canUpload && (
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

                    {canUpload && data.contractorId && (
                      <View style={docStyles.uploadSection}>
                        <Text style={docStyles.uploadHeading}>{t('documents.upload')}</Text>
                        <Field
                          label={`${t(`documents.${kind}`)} - ${t(kind === 'HEALTH_CERTIFICATE' ? 'documents.submittedIssuedOn' : 'documents.submittedExpiresOn')} (YYYY-MM-DD)`}
                          placeholder="YYYY-MM-DD"
                          maxLength={10}
                          editable={!command.isPending}
                          value={expiries[kind] ?? ''}
                          onChangeText={(value) =>
                            setExpiries((previous) => ({ ...previous, [kind]: value }))
                          }
                        />
                        <Hint>
                          {t(
                            kind === 'HEALTH_CERTIFICATE'
                              ? 'documents.healthExpiryRule'
                              : 'documents.submittedExpiryHint',
                          )}{' '}
                          {kind === 'HEALTH_CERTIFICATE'
                            ? (healthCertificateExpiry(expiries[kind]) ?? '')
                            : ''}
                        </Hint>
                        <Attachments
                          files={drafts[kind] ?? []}
                          maxFiles={1}
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
                            setDrafts((previous) => ({ ...previous, [kind]: files }))
                          }
                        />
                        <Button
                          label={t('documents.upload')}
                          disabled={command.isPending || !drafts[kind]?.[0]}
                          onPress={() =>
                            command.mutate(async () => {
                              const expiry = expiries[kind];
                              if (expiry) validDates(expiry, expiry);
                              await client.uploadWorkerDocument(
                                token,
                                scope.siteId,
                                workerId,
                                kind,
                                drafts[kind]![0]!,
                                expiry
                                  ? kind === 'HEALTH_CERTIFICATE'
                                    ? { submittedIssuedOn: expiry }
                                    : { submittedExpiresOn: expiry }
                                  : {},
                              );
                              setDrafts((previous) => ({ ...previous, [kind]: [] }));
                              setExpiries((previous) => ({ ...previous, [kind]: '' }));
                            })
                          }
                        />
                      </View>
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
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#F66B17',
  },
  workerHeroText: {
    flex: 1,
    gap: 2,
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
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 10,
  },
  metaItem: {
    width: '48%',
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 2,
  },
  metaItemFull: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 2,
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: '#64748B',
  },
  metaValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E293B',
  },
  expiringBanner: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#FFFBEB',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  expiringText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
  },
  sectionHeader: {
    marginTop: 8,
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#475569',
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
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  acceptedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  acceptedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  emptyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
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
  },
  docFilename: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  docStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  docStatusText: {
    fontSize: 11,
    fontWeight: '800',
  },
  dateBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 8,
    gap: 4,
  },
  dateText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  noteBox: {
    backgroundColor: '#FFF7ED',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFEDD5',
    padding: 8,
  },
  noteText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#9A3412',
  },
  submittedPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFEDD5',
  },
  submittedPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#C2410C',
  },
  pendingSection: {
    gap: 8,
    paddingTop: 4,
  },
  expiryEditorBox: {
    gap: 8,
    padding: 10,
    backgroundColor: '#FFFDF9',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  ocrBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 8,
    gap: 3,
  },
  ocrText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  ocrHintText: {
    fontSize: 10,
    color: '#64748B',
  },
  uploadSection: {
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  uploadHeading: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    color: '#475569',
  },
  matchBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#ECFDF5',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  matchText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  mismatchBox: {
    gap: 4,
    padding: 10,
    backgroundColor: '#FFFBEB',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 8,
  },
  mismatchTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#92400E',
  },
  mismatchText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
  },
  mismatchAdvisory: {
    fontSize: 10,
    color: '#78350F',
    lineHeight: 14,
  },
});
