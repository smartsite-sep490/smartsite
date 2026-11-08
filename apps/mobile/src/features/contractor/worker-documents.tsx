import { translate as tr } from '../../i18n';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import { Body, Button, ErrorNotice, Hint, QueryState, Field } from '../shared/ui';
import { Attachments, EvidenceButton } from '../shared/uploads';
import { WorkerAvatar } from '../../components/common/WorkerAvatar';
import {
  IconDocument,
  IconShield,
  IconUser,
  IconMapPin,
  IconCheck,
  IconAlert,
  IconClock,
  IconCalendar,
  IconChevronDown,
  IconChevronUp,
} from '../../components/common/Icons';
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
    <View accessibilityRole="alert" style={docStyles.mismatchBox}>
      <View style={docStyles.noticeHeaderRow}>
        <IconAlert size={16} color="#B45309" />
        <Body>{t('documents.identityMismatch')}</Body>
      </View>
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

  // Collapsible state: Collapsed by default for a sleek, non-wrapping mobile UI
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [expandedIdentity, setExpandedIdentity] = useState<Record<string, boolean>>({
    FRONT: false,
    BACK: false,
  });
  const [expandedCerts, setExpandedCerts] = useState<Record<WorkerDocumentKind, boolean>>({
    SAFETY_CARD: true,
    HEALTH_CERTIFICATE: false,
    PERSONAL_INSURANCE: false,
  });

  return (
    <View style={docStyles.container}>
      {/* 1. Header Info Banner */}
      <View style={docStyles.headerBannerCard}>
        <View style={docStyles.headerIconCircle}>
          <IconShield size={20} color="#EA580C" />
        </View>
        <View style={docStyles.headerTextCol}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={docStyles.screenTitle}>
            {t('documents.title')}
          </Text>
          <Text numberOfLines={2} ellipsizeMode="tail" style={docStyles.screenSubtitle}>
            {t(canSubmitDocuments ? 'documents.renewalHint' : 'documents.hint')}
          </Text>
        </View>
      </View>

      <QueryState query={profile}>
        {(data) => {
          const isReviewed = data.submissionStatus === 'REVIEWED';
          const isPending = data.submissionStatus === 'PENDING_REVIEW';

          return (
            <>
              {/* 2. Worker Profile Overview Card (Collapsible) */}
              <View style={docStyles.overviewCard}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('workforce.workerProfile')}
                  onPress={() => setOverviewExpanded((prev) => !prev)}
                  style={docStyles.workerHeroRow}
                >
                  <View style={docStyles.avatarRingWrapper}>
                    <WorkerAvatar size={44} role="worker" />
                  </View>

                  <View style={docStyles.workerHeroText}>
                    <Text style={docStyles.workerName} numberOfLines={1} ellipsizeMode="tail">
                      {data.displayName}
                    </Text>
                    <View style={docStyles.workerMetaPills}>
                      <View style={docStyles.codeBadge}>
                        <Text style={docStyles.workerCode} numberOfLines={1}>
                          {data.externalId}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={docStyles.heroRightCol}>
                    <View
                      style={[
                        docStyles.compactBadge,
                        {
                          backgroundColor: isReviewed
                            ? '#EDFAF2'
                            : isPending
                              ? '#FFFBEB'
                              : '#FEF2F2',
                          borderColor: isReviewed
                            ? '#A7F3D0'
                            : isPending
                              ? '#FDE68A'
                              : '#FECACA',
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
                                : '#EF4444',
                          },
                        ]}
                      />
                      <Text
                        numberOfLines={1}
                        style={[
                          docStyles.compactBadgeText,
                          {
                            color: isReviewed
                              ? '#065F46'
                              : isPending
                                ? '#92400E'
                                : '#991B1B',
                          },
                        ]}
                      >
                        {isReviewed
                          ? t('profile.validStatus')
                          : isPending
                            ? t('documents.PENDING')
                            : t('profile.expiredStatus')}
                      </Text>
                    </View>

                    <View style={docStyles.chevronCircle}>
                      {overviewExpanded ? (
                        <IconChevronUp size={14} color="#64748B" />
                      ) : (
                        <IconChevronDown size={14} color="#64748B" />
                      )}
                    </View>
                  </View>
                </Pressable>

                {/* Collapsible Overview Body */}
                <View style={!overviewExpanded && { display: 'none' }}>
                  {/* Status warning badges */}
                  {(data.status === 'EXPIRED' || data.needsSupplement) && (
                    <View style={docStyles.alertChipsRow}>
                      {data.status === 'EXPIRED' && (
                        <View style={docStyles.expiredTag}>
                          <IconAlert size={14} color="#B91C1C" />
                          <Text style={docStyles.expiredTagText}>{t('documents.EXPIRED')}</Text>
                        </View>
                      )}
                      {data.needsSupplement && (
                        <View style={docStyles.supplementTag}>
                          <IconAlert size={14} color="#B45309" />
                          <Text style={docStyles.supplementTagText}>
                            {t('documents.needsSupplement')}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Details Grid: 4 Modern Info Tiles */}
                  <View style={docStyles.metaGrid}>
                    <View style={docStyles.metaTile}>
                      <View style={docStyles.metaTileHeader}>
                        <IconShield size={13} color="#EA580C" />
                        <Text style={docStyles.metaLabel}>{t('documents.nationalId')}</Text>
                      </View>
                      <Text style={docStyles.metaValue}>{data.nationalId ?? '—'}</Text>
                    </View>

                    <View style={docStyles.metaTile}>
                      <View style={docStyles.metaTileHeader}>
                        <IconUser size={13} color="#2563EB" />
                        <Text style={docStyles.metaLabel}>{t('documents.phoneNumber')}</Text>
                      </View>
                      <Text style={docStyles.metaValue}>{data.phoneNumber ?? '—'}</Text>
                    </View>

                    <View style={docStyles.metaTile}>
                      <View style={docStyles.metaTileHeader}>
                        <IconUser size={13} color="#059669" />
                        <Text style={docStyles.metaLabel}>{t('documents.gender')}</Text>
                      </View>
                      <Text style={docStyles.metaValue}>
                        {data.gender ? t(`documents.${data.gender}`) : '—'}
                      </Text>
                    </View>

                    <View style={docStyles.metaTileFull}>
                      <View style={docStyles.metaTileHeader}>
                        <IconMapPin size={13} color="#D97706" />
                        <Text style={docStyles.metaLabel}>{t('documents.address')}</Text>
                      </View>
                      <Text style={docStyles.metaValue} numberOfLines={2}>
                        {data.address ?? '—'}
                      </Text>
                    </View>
                  </View>

                  {data.expiringKinds.length > 0 && (
                    <View style={docStyles.expiringBanner}>
                      <IconAlert size={16} color="#B45309" />
                      <Text style={docStyles.expiringText}>{t('documents.expiring')}</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* 3. Identity Images (Front & Back - Collapsible Accordion) */}
              <View style={docStyles.sectionHeaderRow}>
                <View style={docStyles.sectionHeaderLeft}>
                  <View style={docStyles.sectionIconBox}>
                    <IconDocument size={16} color="#EA580C" />
                  </View>
                  <Text style={docStyles.sectionTitle}>{tr('documents.identityHeading')}</Text>
                </View>
                <View style={docStyles.sectionCountBadge}>
                  <Text style={docStyles.sectionCountText}>{data.identityImages.length}/2</Text>
                </View>
              </View>

              {(['FRONT', 'BACK'] as const).map((side, idx) => {
                const image = data.identityImages.find((i) => i.side === side);
                const isSideExpanded = !!expandedIdentity[side];

                return (
                  <View key={side} style={docStyles.itemCard}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t(`documents.${side}`)}
                      onPress={() =>
                        setExpandedIdentity((prev) => ({ ...prev, [side]: !prev[side] }))
                      }
                      style={docStyles.cardHeaderRow}
                    >
                      <View style={docStyles.cardTitleGroup}>
                        <View style={docStyles.cardIndexBadge}>
                          <Text style={docStyles.cardIndexText}>{idx + 1}</Text>
                        </View>
                        <Text style={docStyles.cardTitle} numberOfLines={1} ellipsizeMode="tail">
                          {t(`documents.${side}`)}
                        </Text>
                      </View>

                      <View style={docStyles.headerActionsRight}>
                        <View
                          style={[
                            docStyles.compactBadge,
                            {
                              backgroundColor: image ? '#EDFAF2' : '#F1F5F9',
                              borderColor: image ? '#A7F3D0' : '#E2E8F0',
                            },
                          ]}
                        >
                          <View
                            style={[
                              docStyles.statusDot,
                              { backgroundColor: image ? '#10B981' : '#94A3B8' },
                            ]}
                          />
                          <Text
                            numberOfLines={1}
                            style={[
                              docStyles.compactBadgeText,
                              { color: image ? '#065F46' : '#64748B' },
                            ]}
                          >
                            {image ? t('documents.qualityAccepted') : t('documents.noFile')}
                          </Text>
                        </View>

                        <View style={docStyles.chevronCircle}>
                          {isSideExpanded ? (
                            <IconChevronUp size={14} color="#64748B" />
                          ) : (
                            <IconChevronDown size={14} color="#64748B" />
                          )}
                        </View>
                      </View>
                    </Pressable>

                    {/* Detailed Body (Expanded view) */}
                    <View style={!isSideExpanded && { display: 'none' }}>
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
                    </View>
                  </View>
                );
              })}

              {/* 4. 3 Safety & Health Certificates (Collapsible Accordion) */}
              <View style={docStyles.sectionHeaderRow}>
                <View style={docStyles.sectionHeaderLeft}>
                  <View style={docStyles.sectionIconBox}>
                    <IconShield size={16} color="#EA580C" />
                  </View>
                  <Text style={docStyles.sectionTitle}>{tr('documents.certificatesHeading')}</Text>
                </View>
                <View style={docStyles.sectionCountBadge}>
                  <Text style={docStyles.sectionCountText}>
                    {data.documents.filter((d) => d.status === 'APPROVED').length}/3
                  </Text>
                </View>
              </View>

              {documentKinds.map((kind) => {
                const documents = data.documents.filter((d) => d.kind === kind);
                // Only display the relevant current version (APPROVED, or current PENDING renewal), hiding historical superseded versions
                const displayDoc =
                  documents.find((d) => d.status === 'APPROVED') ??
                  documents.find((d) => d.status === 'PENDING') ??
                  documents.find((d) => d.status !== 'SUPERSEDED') ??
                  null;

                const isCertExpanded = !!expandedCerts[kind];
                const kindIconColor =
                  kind === 'SAFETY_CARD'
                    ? '#EA580C'
                    : kind === 'HEALTH_CERTIFICATE'
                      ? '#0D9488'
                      : '#2563EB';
                const kindIconBg =
                  kind === 'SAFETY_CARD'
                    ? '#FFF7ED'
                    : kind === 'HEALTH_CERTIFICATE'
                      ? '#F0FDFA'
                      : '#EFF6FF';

                const statusColor = !displayDoc
                  ? '#64748B'
                  : displayDoc.status === 'APPROVED'
                    ? '#065F46'
                    : displayDoc.status === 'PENDING'
                      ? '#92400E'
                      : '#991B1B';

                const statusBg = !displayDoc
                  ? '#F1F5F9'
                  : displayDoc.status === 'APPROVED'
                    ? '#EDFAF2'
                    : displayDoc.status === 'PENDING'
                      ? '#FFFBEB'
                      : '#FEF2F2';

                const statusBorder = !displayDoc
                  ? '#E2E8F0'
                  : displayDoc.status === 'APPROVED'
                    ? '#A7F3D0'
                    : displayDoc.status === 'PENDING'
                      ? '#FDE68A'
                      : '#FECACA';

                return (
                  <View key={kind} style={docStyles.itemCard}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t(`documents.${kind}`)}
                      onPress={() =>
                        setExpandedCerts((prev) => ({ ...prev, [kind]: !prev[kind] }))
                      }
                      style={docStyles.cardHeaderRow}
                    >
                      <View style={docStyles.cardTitleGroup}>
                        <View style={[docStyles.cardKindIconBox, { backgroundColor: kindIconBg }]}>
                          {kind === 'SAFETY_CARD' ? (
                            <IconShield size={16} color={kindIconColor} />
                          ) : kind === 'HEALTH_CERTIFICATE' ? (
                            <IconUser size={16} color={kindIconColor} />
                          ) : (
                            <IconDocument size={16} color={kindIconColor} />
                          )}
                        </View>
                        <Text style={docStyles.cardTitle} numberOfLines={1} ellipsizeMode="tail">
                          {t(`documents.${kind}`)}
                        </Text>
                      </View>

                      <View style={docStyles.headerActionsRight}>
                        <View
                          style={[
                            docStyles.compactBadge,
                            { backgroundColor: statusBg, borderColor: statusBorder },
                          ]}
                        >
                          <View
                            style={[
                              docStyles.statusDot,
                              {
                                backgroundColor: !displayDoc
                                  ? '#94A3B8'
                                  : displayDoc.status === 'APPROVED'
                                    ? '#10B981'
                                    : displayDoc.status === 'PENDING'
                                      ? '#F59E0B'
                                      : '#EF4444',
                              },
                            ]}
                          />
                          <Text
                            numberOfLines={1}
                            style={[docStyles.compactBadgeText, { color: statusColor }]}
                          >
                            {!displayDoc
                              ? t('documents.noFile')
                              : displayDoc.status === 'APPROVED'
                                ? t('documents.APPROVED')
                                : displayDoc.status === 'PENDING'
                                  ? t('documents.PENDING')
                                  : t(`documents.${displayDoc.status}`)}
                          </Text>
                        </View>

                        <View style={docStyles.chevronCircle}>
                          {isCertExpanded ? (
                            <IconChevronUp size={14} color="#64748B" />
                          ) : (
                            <IconChevronDown size={14} color="#64748B" />
                          )}
                        </View>
                      </View>
                    </Pressable>

                    {/* Detailed Body (Expanded view - only showing the active/approved document) */}
                    <View style={!isCertExpanded && { display: 'none' }}>
                      {displayDoc && (
                        <View key={displayDoc.id} style={docStyles.docRow}>
                          <View style={docStyles.docStatusRow}>
                            <View style={docStyles.docFilenameWrapper}>
                              <IconDocument size={15} color="#EA580C" />
                              <Text
                                style={docStyles.docFilename}
                                numberOfLines={1}
                                ellipsizeMode="middle"
                              >
                                {displayDoc.originalName}
                              </Text>
                            </View>
                            <View
                              style={[
                                docStyles.docStatusPill,
                                {
                                  backgroundColor:
                                    displayDoc.status === 'APPROVED'
                                      ? '#EDFAF2'
                                      : displayDoc.status === 'PENDING'
                                        ? '#FFFBEB'
                                        : '#FEF2F2',
                                  borderColor:
                                    displayDoc.status === 'APPROVED'
                                      ? '#A7F3D0'
                                      : displayDoc.status === 'PENDING'
                                        ? '#FDE68A'
                                        : '#FECACA',
                                },
                              ]}
                            >
                              <View
                                style={[
                                  docStyles.statusDot,
                                  {
                                    backgroundColor:
                                      displayDoc.status === 'APPROVED'
                                        ? '#10B981'
                                        : displayDoc.status === 'PENDING'
                                          ? '#F59E0B'
                                          : '#EF4444',
                                  },
                                ]}
                              />
                              <Text
                                numberOfLines={1}
                                style={[
                                  docStyles.docStatusText,
                                  {
                                    color:
                                      displayDoc.status === 'APPROVED'
                                        ? '#065F46'
                                        : displayDoc.status === 'PENDING'
                                          ? '#92400E'
                                          : '#991B1B',
                                  },
                                ]}
                              >
                                {t(`documents.${displayDoc.status}`)}
                              </Text>
                            </View>
                          </View>

                          {/* Dates Row */}
                          <View style={docStyles.dateBox}>
                            <View style={docStyles.dateCol}>
                              <View style={docStyles.dateColHeader}>
                                <IconCalendar size={13} color="#64748B" />
                                <Text style={docStyles.dateLabel}>{t('documents.issuedOn')}</Text>
                              </View>
                              <Text numberOfLines={1} style={docStyles.dateValue}>
                                {displayDoc.issuedOn ?? '—'}
                              </Text>
                            </View>

                            <View style={docStyles.dateDivider} />

                            <View style={docStyles.dateCol}>
                              <View style={docStyles.dateColHeader}>
                                <IconClock size={13} color="#EA580C" />
                                <Text style={docStyles.dateLabel}>{t('documents.expiresOn')}</Text>
                              </View>
                              <Text
                                numberOfLines={1}
                                style={[docStyles.dateValue, { color: '#0F172A', fontWeight: '800' }]}
                              >
                                {displayDoc.expiresOn ?? '—'}
                              </Text>
                            </View>
                          </View>

                          {displayDoc.reviewNote && (
                            <View style={docStyles.noteBox}>
                              <Text style={docStyles.noteText}>💬 {displayDoc.reviewNote}</Text>
                            </View>
                          )}

                          {displayDoc.submittedExpiresOn &&
                            (kind !== 'HEALTH_CERTIFICATE' || displayDoc.submittedIssuedOn) && (
                              <View style={docStyles.submittedPill}>
                                <IconClock size={13} color="#C2410C" />
                                <Text numberOfLines={1} style={docStyles.submittedPillText}>
                                  {t('documents.submittedExpiryLabel')}: {displayDoc.submittedExpiresOn}
                                </Text>
                              </View>
                            )}

                          <IdentityNotice check={displayDoc.identityCheck} reference={data.nationalId} />

                          {displayDoc.status === 'PENDING' && (
                            <View style={docStyles.pendingSection}>
                              {canUploadCertificates && (
                                <SubmittedExpiryEditor
                                  key={`${displayDoc.id}:${displayDoc.version}`}
                                  doc={displayDoc}
                                  disabled={command.isPending}
                                  save={(value) =>
                                    command.mutate(async () => {
                                      if (value) validDates(value, value);
                                      await client.updateWorkerDocumentExpiry(
                                        token,
                                        scope.siteId,
                                        workerId,
                                        displayDoc.id,
                                        {
                                          expectedVersion: displayDoc.version,
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
                                  {displayDoc.ocr.issuedOn ?? t('documents.notDetermined')}
                                  {kind !== 'HEALTH_CERTIFICATE' && (
                                    <>
                                      {' '}
                                      · {t('documents.ocrExpires')}:{' '}
                                      {displayDoc.ocr.expiresOn ?? t('documents.notDetermined')}
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
                                        displayDoc.submittedIssuedOn ?? displayDoc.ocr.issuedOn,
                                      ) ?? t('documents.notDetermined'))
                                    : ''}
                                </Text>
                              </View>
                            </View>
                          )}

                          <EvidenceButton
                            label={t('documents.view')}
                            mediaType={displayDoc.mediaType}
                            load={() =>
                              client.workerDocumentFile(token, scope.siteId, workerId, displayDoc.id)
                            }
                          />
                        </View>
                      )}

                      {canUploadCertificates && (canSubmitDocuments || data.contractorId) && (
                        <WorkerCertificateSubmission
                          workerId={workerId}
                          kind={kind}
                          requireDate={canSubmitDocuments}
                          disabled={command.isPending}
                        />
                      )}
                    </View>
                  </View>
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
      <View style={docStyles.uploadHeaderRow}>
        <View style={docStyles.uploadHeaderIconBox}>
          <IconDocument size={14} color="#EA580C" />
        </View>
        <Text style={docStyles.uploadHeading}>{t('documents.upload')}</Text>
      </View>
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
    gap: 12,
    paddingBottom: 28,
  },
  headerBannerCard: {
    backgroundColor: '#FFF7ED',
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#FED7AA',
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  headerIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#FFEDD5',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  screenTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  screenSubtitle: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
  },
  overviewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  workerHeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarRingWrapper: {
    flexShrink: 0,
  },
  workerHeroText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  workerName: {
    fontSize: 15.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  workerMetaPills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  codeBadge: {
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 7,
    paddingVertical: 1.5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FFEDD5',
    alignSelf: 'flex-start',
  },
  workerCode: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
    color: '#EA580C',
  },
  heroRightCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  chevronCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  alertChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  expiredTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  expiredTagText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B91C1C',
  },
  supplementTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  supplementTagText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
    marginTop: 4,
  },
  metaTile: {
    flexGrow: 1,
    flexBasis: 130,
    minWidth: 120,
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 2,
  },
  metaTileFull: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 2,
  },
  metaTileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: '#64748B',
  },
  metaValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  expiringBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginTop: 6,
  },
  expiringText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#92400E',
    flex: 1,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 1,
    paddingHorizontal: 2,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionIconBox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#0F172A',
  },
  sectionCountBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 7,
    paddingVertical: 1.5,
    borderRadius: 6,
  },
  sectionCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  itemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 5,
    elevation: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  cardIndexBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardIndexText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#EA580C',
  },
  cardKindIconBox: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    flex: 1,
  },
  headerActionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  compactBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 8,
    borderWidth: 1,
    flexShrink: 0,
  },
  compactBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
    lineHeight: 15,
  },
  docRow: {
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
  },
  docStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  docFilenameWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  docFilename: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    flex: 1,
  },
  docStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    borderWidth: 1,
    flexShrink: 0,
  },
  docStatusText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  dateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 8,
  },
  dateCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  dateColHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dateLabel: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#64748B',
  },
  dateValue: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#334155',
  },
  dateDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 8,
  },
  noteBox: {
    backgroundColor: '#FFF7ED',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FED7AA',
    padding: 8,
  },
  noteText: {
    fontSize: 12.5,
    fontStyle: 'italic',
    color: '#9A3412',
  },
  submittedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#FFEDD5',
  },
  submittedPillText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#C2410C',
  },
  pendingSection: {
    gap: 8,
    paddingTop: 2,
  },
  expiryEditorBox: {
    gap: 6,
    padding: 10,
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
    padding: 8,
    gap: 2,
  },
  ocrText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#1E293B',
  },
  ocrHintText: {
    fontSize: 11.5,
    color: '#64748B',
  },
  uploadSection: {
    gap: 8,
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  uploadHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  uploadHeaderIconBox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadHeading: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    color: '#0F172A',
  },
  noticeBox: {
    padding: 10,
    gap: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  noticeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mismatchBox: {
    gap: 4,
    padding: 10,
    backgroundColor: '#FFFBEB',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 8,
  },
});
