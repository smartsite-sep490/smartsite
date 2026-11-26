import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type {
  WorkerComplianceResponse,
  WorkerDocumentKind,
  WorkerDocumentResponse,
} from '@smartsite/api-client';
import { useTranslation, uiLocale } from '../../i18n';
import { colors } from '../../theme/colors';
import { WorkerAvatar } from '../../components/common/WorkerAvatar';
import { IconChevronRight, IconShield, IconUser } from '../../components/common/Icons';
import { useWorkspace } from '../workspace/workspace-context';
import { ownWorkerComplianceOptions } from '../workspace/own-worker-compliance';
import { Button, ErrorNotice, Hint, QueryState } from '../shared/ui';
import { EvidenceButton } from '../shared/uploads';
import { RequestSheet } from '../shared/request-sheet';
import { WorkerDocumentBundleForm } from './worker-document-bundle-form';
import { useCommand } from '../shared/data';

export const documentKinds: readonly WorkerDocumentKind[] = [
  'SAFETY_CARD',
  'HEALTH_CERTIFICATE',
  'PERSONAL_INSURANCE',
];
type Selection =
  | { type: 'profile' }
  | { type: 'identity'; side: 'FRONT' | 'BACK' }
  | { type: 'certificate'; kind: WorkerDocumentKind }
  | { type: 'bundle'; kind?: WorkerDocumentKind };

function DocumentStatus({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone =
    status === 'APPROVED' || status === 'VALID' || status === 'ACTIVE'
      ? styles.good
      : status === 'REJECTED' || status === 'EXPIRED'
        ? styles.bad
        : status === 'PENDING' || status === 'PENDING_REVIEW'
          ? styles.pending
          : styles.neutral;
  return (
    <View style={[styles.badge, tone]}>
      <Text style={[styles.badgeText, tone]}>{t(`documents.${status}`)}</Text>
    </View>
  );
}
function documentDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(uiLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}
/** A pending renewal stays visible alongside the approved original. */
export function currentDocuments(documents: WorkerDocumentResponse[], kind: WorkerDocumentKind) {
  return documents
    .filter((d) => d.kind === kind && d.status !== 'SUPERSEDED')
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || b.id.localeCompare(a.id));
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
  const [selected, setSelected] = useState<Selection | null>(null);
  const [editingDocuments, setEditingDocuments] = useState(false);
  const [sent, setSent] = useState(false);
  const analyze = useCommand();
  const send = useCommand();
  const profile = useQuery(
    scope.role === 'worker'
      ? ownWorkerComplianceOptions(client, token, scope.siteId, queryKey)
      : {
          queryKey: [...queryKey, 'worker-documents', workerId],
          queryFn: ({ signal }) =>
            client.workerCompliance(token, scope.siteId, workerId, { signal }),
        },
  );
  const data = profile.data;
  const selectedDocuments =
    selected?.type === 'certificate' ? currentDocuments(data?.documents ?? [], selected.kind) : [];
  const image =
    selected?.type === 'identity'
      ? data?.identityImages.find((item) => item.side === selected.side)
      : undefined;
  const title =
    selected?.type === 'certificate'
      ? t('documents.' + selected.kind)
      : selected?.type === 'identity'
        ? t('documents.' + selected.side)
        : selected?.type === 'bundle'
          ? t('onboarding.editDocuments')
          : t('workforce.workerProfile');
  return (
    <View style={styles.screen}>
      <QueryState query={profile}>
        {(data) => {
          if (!data) return <Hint>{t('profile.noWorkerProfile')}</Hint>;
          const requiredKinds = documentKinds.filter(
            (kind) => kind !== 'SAFETY_CARD' || data.safetyCardRequired !== false,
          );
          const approved = requiredKinds.filter((kind) => !data.missingKinds.includes(kind)).length;
          const drafts = data.documents.filter((doc) => doc.status === 'DRAFT');
          const canSend = data.canSubmit === true;
          return (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('workforce.workerProfile')}
                onPress={() => setSelected({ type: 'profile' })}
                style={styles.profileCard}
              >
                <WorkerAvatar size={44} role="worker" />
                <View style={styles.grow}>
                  <Text style={styles.name}>{data.displayName}</Text>
                  <Text style={styles.hint}>{data.externalId}</Text>
                </View>
                <IconChevronRight size={18} color={colors.textMuted} />
              </Pressable>
              <View style={styles.summary}>
                <View style={styles.grow}>
                  <Text style={styles.sectionTitle}>
                    {t('documentUi.completion', { count: approved, total: requiredKinds.length })}
                  </Text>
                  <Text style={styles.hint}>
                    {t(
                      data.needsSupplement ? 'documents.needsSupplement' : 'documentUi.reviewHint',
                    )}
                  </Text>
                </View>
                <DocumentStatus status={data.status} />
              </View>
              {canUpload && (
                <>
                  <Button
                    secondary
                    label={t('onboarding.editDocuments')}
                    onPress={() => setSelected({ type: 'bundle' })}
                  />
                  {!!drafts.length && (
                    <>
                      <Button
                        secondary
                        label={t(analyze.isPending ? 'onboarding.working' : 'onboarding.analyze')}
                        disabled={analyze.isPending || send.isPending}
                        onPress={() =>
                          analyze.mutate(async () => {
                            const results = await Promise.allSettled(
                              drafts.map((doc) =>
                                client.analyzeWorkerDocument(token, scope.siteId, workerId, doc.id),
                              ),
                            );
                            const failed = results.find((result) => result.status === 'rejected');
                            if (failed) throw failed.reason;
                          })
                        }
                      />
                      <ErrorNotice error={analyze.error} />
                      <Button
                        label={t(send.isPending ? 'onboarding.working' : 'onboarding.send')}
                        disabled={!canSend || send.isPending || analyze.isPending}
                        onPress={() =>
                          send.mutate(async () => {
                            setSent(false);
                            const { items } = await client.sendWorkerDocumentsBatch(
                              token,
                              scope.siteId,
                              scope.contractorId,
                              [{ id: workerId, version: data.version ?? 0 }],
                            );
                            const result = items.find((item) => item.id === workerId);
                            if (result?.status !== 'SUCCEEDED')
                              throw new Error(
                                result?.error?.message ?? t('common.unexpectedError'),
                              );
                            setSent(true);
                          })
                        }
                      />
                      {!canSend && <Hint>{t('onboarding.missingDocuments')}</Hint>}
                      <ErrorNotice error={send.error} />
                    </>
                  )}
                  {sent && <Hint>{t('onboarding.sentToSafety')}</Hint>}
                </>
              )}
              <Text style={styles.sectionTitle}>{t('documents.identityHeading')}</Text>
              <View style={styles.list}>
                {(['FRONT', 'BACK'] as const).map((side) => (
                  <Pressable
                    key={side}
                    accessibilityRole="button"
                    accessibilityLabel={t('documents.' + side)}
                    onPress={() => setSelected({ type: 'identity', side })}
                    style={styles.row}
                  >
                    <IconUser size={19} color={colors.primary} />
                    <Text style={styles.rowTitle}>{t('documents.' + side)}</Text>
                    <IconChevronRight size={18} color={colors.textMuted} />
                  </Pressable>
                ))}
              </View>
              <Text style={styles.sectionTitle}>{t('documents.certificatesHeading')}</Text>
              <View style={styles.list}>
                {documentKinds.map((kind) => {
                  const exempt = kind === 'SAFETY_CARD' && data.safetyCardRequired === false;
                  const items = currentDocuments(data.documents, kind);
                  const doc =
                    items.find((item) => item.status === 'DRAFT') ??
                    items.find((item) => item.status === 'PENDING') ??
                    items[0];
                  const effectiveExpiry = data.missingKinds.includes(kind)
                    ? undefined
                    : items.find((item) => item.status === 'APPROVED')?.expiresOn;
                  const expiresOn = doc?.expiresOn ?? effectiveExpiry;
                  return (
                    <View key={kind} style={styles.certificate}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('documents.' + kind)}
                        onPress={() => setSelected({ type: 'certificate', kind })}
                        style={styles.rowHeader}
                      >
                        <IconShield size={19} color={colors.primary} />
                        <View style={styles.grow}>
                          <Text style={styles.rowTitle}>{t('documents.' + kind)}</Text>
                          {expiresOn && (
                            <Text style={styles.hint}>
                              {t(
                                doc?.expiresOn
                                  ? 'documentUi.validUntil'
                                  : 'documentUi.approvedValidUntil',
                                { date: documentDate(expiresOn) },
                              )}
                            </Text>
                          )}
                          {exempt && <DocumentStatus status="notRequired" />}
                          {(doc || !exempt) && <DocumentStatus status={doc?.status ?? 'MISSING'} />}
                        </View>
                        <IconChevronRight size={16} color={colors.textMuted} />
                      </Pressable>
                      {doc?.reviewNote && <Text style={styles.noticeText}>{doc.reviewNote}</Text>}
                      {canUpload && doc?.aiAnalysis && <AiResult doc={doc} />}
                      {canUpload && !exempt && (
                        <Button
                          secondary
                          label={t(doc ? 'onboarding.replaceFile' : 'onboarding.attachFile')}
                          onPress={() => setSelected({ type: 'bundle', kind })}
                        />
                      )}
                    </View>
                  );
                })}
              </View>
            </>
          );
        }}
      </QueryState>
      {selected && data && (
        <RequestSheet
          visible
          footer={null}
          busy={editingDocuments}
          variant={selected.type === 'bundle' ? 'form' : 'compact'}
          title={title}
          subtitle={data.displayName}
          onClose={() => setSelected(null)}
        >
          {selected.type === 'profile' && <ProfileDetails data={data} />}
          {selected.type === 'bundle' && canUpload && (
            <WorkerDocumentBundleForm
              key={data.workerId}
              profile={data}
              kind={selected.kind}
              onBusyChange={setEditingDocuments}
              onSaved={() => {
                setEditingDocuments(false);
                setSent(false);
                setSelected(null);
                void profile.refetch();
              }}
            />
          )}
          {selected.type === 'identity' &&
            (image ? (
              <>
                <Text style={styles.filename}>{image.originalName}</Text>
                <EvidenceButton
                  label={t('documents.view')}
                  mediaType={image.mediaType}
                  load={() =>
                    client.workerIdentityImageFile(token, scope.siteId, workerId, image.id)
                  }
                />
              </>
            ) : (
              <Hint>{t('documents.noFile')}</Hint>
            ))}
          {selected.type === 'certificate' && (
            <>
              {selectedDocuments.map((doc) => (
                <CertificateDetails key={doc.id} doc={doc} workerId={workerId} />
              ))}
              {!selectedDocuments.length && (
                <Hint>
                  {t(
                    selected.kind === 'SAFETY_CARD' && data.safetyCardRequired === false
                      ? 'documents.notRequired'
                      : 'documents.noFile',
                  )}
                </Hint>
              )}
              {data.documents
                .filter((doc) => doc.kind === selected.kind && doc.status === 'SUPERSEDED')
                .map((doc) => (
                  <CertificateDetails key={doc.id} doc={doc} workerId={workerId} />
                ))}
            </>
          )}
        </RequestSheet>
      )}
    </View>
  );
}

export function ProfileDetails({ data }: { data: WorkerComplianceResponse }) {
  const { t } = useTranslation();
  return (
    <View style={styles.details}>
      {[
        [t('documents.nationalId'), data.nationalId],
        [t('documents.phoneNumber'), data.phoneNumber],
        [t('documents.gender'), data.gender ? t(`documents.${data.gender}`) : null],
        [t('documents.address'), data.address],
      ].map(([label, value]) => (
        <View key={label} style={styles.info}>
          <Text style={styles.hint}>{label}</Text>
          <Text selectable style={styles.value}>
            {value ?? '—'}
          </Text>
        </View>
      ))}
    </View>
  );
}
function CertificateDetails({ doc, workerId }: { doc: WorkerDocumentResponse; workerId: string }) {
  const { t } = useTranslation();
  const { client, token, scope } = useWorkspace();
  return (
    <View style={styles.document}>
      <DocumentStatus status={doc.status} />
      <Text style={styles.filename}>{doc.originalName}</Text>
      <Text style={styles.hint}>
        {t('documents.issuedOn')}: {documentDate(doc.issuedOn)}
      </Text>
      <Text style={styles.hint}>
        {t('documents.expiresOn')}: {documentDate(doc.expiresOn)}
      </Text>
      {doc.submittedIssuedOn && (
        <Text style={styles.hint}>
          {t(
            doc.kind === 'HEALTH_CERTIFICATE'
              ? 'documents.declaredIssuedOn'
              : doc.kind === 'PERSONAL_INSURANCE'
                ? 'documents.coverageStartsOn'
                : 'documents.cardIssuedOn',
          )}
          : {documentDate(doc.submittedIssuedOn)}
        </Text>
      )}
      {doc.submittedExpiresOn && (
        <Text style={styles.hint}>
          {t('documents.declaredExpiresOn')}: {documentDate(doc.submittedExpiresOn)}
        </Text>
      )}
      {doc.reviewNote && (
        <View style={styles.review}>
          <Text style={styles.label}>{t('documentUi.reviewNote')}</Text>
          <Text style={styles.hint}>{doc.reviewNote}</Text>
        </View>
      )}
      {doc.aiAnalysis && <AiResult doc={doc} />}
      <EvidenceButton
        label={t('documents.view')}
        mediaType={doc.mediaType}
        load={() => client.workerDocumentFile(token, scope.siteId, workerId, doc.id)}
      />
    </View>
  );
}

function AiResult({ doc }: { doc: WorkerDocumentResponse }) {
  const { t } = useTranslation();
  const result = doc.aiAnalysis;
  if (!result) return null;
  if (result.status !== 'COMPLETE') {
    return (
      <Text style={[styles.badge, styles.badgeText, styles.neutral]}>
        {t(
          result.status === 'UNAVAILABLE' ? 'onboarding.analysisUnavailable' : 'onboarding.working',
        )}
      </Text>
    );
  }
  const primaryDateLabel = t(
    doc.kind === 'HEALTH_CERTIFICATE' ? 'documents.declaredIssuedOn' : 'documents.expiresOn',
  );
  const startDateLabel = t(
    doc.kind === 'PERSONAL_INSURANCE' ? 'documents.coverageStartsOn' : 'documents.cardIssuedOn',
  );
  const dateChecks = [
    { check: result.dateCheck, label: primaryDateLabel },
    ...(result.startDateCheck ? [{ check: result.startDateCheck, label: startDateLabel }] : []),
  ];
  const mismatches = dateChecks.filter(({ check }) => check.status === 'MISMATCH');
  const concerns = [
    result.kindMismatch ? t('onboarding.analysisKindMismatch') : '',
    result.validity === 'EXPIRED' ? t('documents.aiExpired') : '',
    result.validity === 'NOT_YET_VALID' ? t('documents.aiNotYetValid') : '',
  ].filter(Boolean);
  const hasAlert = concerns.length > 0 || mismatches.length > 0;
  const unclear =
    !result.detectedKind ||
    result.validity !== 'CURRENT' ||
    dateChecks.some(({ check }) => check.status !== 'MATCH');
  const label = hasAlert
    ? 'onboarding.analysisDiscrepancy'
    : unclear
      ? 'onboarding.analysisNeedsReview'
      : 'onboarding.analysisClear';
  const badge = hasAlert ? styles.bad : unclear ? styles.pending : styles.good;
  return (
    <View style={styles.analysis}>
      <Text style={[styles.badge, styles.badgeText, badge]}>{t(label)}</Text>
      {concerns.map((concern) => (
        <Hint key={concern}>{concern}</Hint>
      ))}
      {mismatches.map(({ check, label: dateLabel }) => (
        <Hint key={dateLabel}>
          {t('onboarding.analysisComparison', {
            label: dateLabel,
            declared: documentDate(check.submittedDate),
            detected: documentDate(check.detectedDate),
          })}
        </Hint>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { gap: 16, paddingBottom: 24 },
  heading: { gap: 6, paddingVertical: 4 },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.4,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
  },
  title: { fontSize: 22, lineHeight: 30, fontWeight: '800', color: colors.textPrimary },
  hint: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
  grow: { flex: 1, minWidth: 0, gap: 3 },
  flexText: { flexShrink: 1 },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  name: { fontSize: 16, lineHeight: 23, fontWeight: '700', color: colors.textPrimary },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
  },
  sectionTitle: { color: colors.textPrimary, fontSize: 13, lineHeight: 20, fontWeight: '700' },
  list: {
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    minHeight: 74,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF3E9',
  },
  rowTitle: { fontSize: 14, lineHeight: 21, fontWeight: '600', color: colors.textPrimary },
  certificate: {
    padding: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  certificateMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  badgeText: { fontSize: 10, lineHeight: 16, fontWeight: '700' },
  good: { color: '#177249', backgroundColor: '#EAF7F0' },
  bad: { color: '#B33939', backgroundColor: '#FDEFEF' },
  pending: { color: '#946322', backgroundColor: '#FFF4DC' },
  neutral: { color: '#64748B', backgroundColor: '#EEF1F5' },
  notice: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FFF7E8',
  },
  noticeText: { flexShrink: 1, color: '#946322', fontSize: 12, lineHeight: 19 },
  footer: { gap: 8 },
  filename: { color: colors.textPrimary, fontWeight: '600', fontSize: 13, lineHeight: 21 },
  details: { gap: 14 },
  analysis: { gap: 6 },
  info: { gap: 5, paddingBottom: 12, borderBottomWidth: 1, borderColor: colors.borderLight },
  value: { fontSize: 14, lineHeight: 22, color: colors.textPrimary, fontWeight: '600' },
  saved: { color: '#177249', fontSize: 13, lineHeight: 20 },
  document: {
    gap: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  dates: { flexDirection: 'row', gap: 14 },
  review: { gap: 5, padding: 12, borderRadius: 10, backgroundColor: colors.surface },
  label: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  empty: { alignItems: 'center', padding: 20, gap: 10 },
});
