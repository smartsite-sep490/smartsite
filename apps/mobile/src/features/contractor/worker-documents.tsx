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
import { Button, Hint, QueryState } from '../shared/ui';
import { EvidenceButton } from '../shared/uploads';
import { RequestSheet } from '../shared/request-sheet';
import { WorkerDocumentBundleForm } from './worker-document-bundle-form';

export const documentKinds: readonly WorkerDocumentKind[] = [
  'SAFETY_CARD',
  'HEALTH_CERTIFICATE',
  'PERSONAL_INSURANCE',
];
type Selection =
  | { type: 'profile' }
  | { type: 'identity'; side: 'FRONT' | 'BACK' }
  | { type: 'certificate'; kind: WorkerDocumentKind }
  | { type: 'bundle' };

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
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
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
  const profile = useQuery({
    queryKey: [...queryKey, 'worker-documents', workerId],
    queryFn: () => client.workerCompliance(token, scope.siteId, workerId),
  });
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
          ? t('documents.bundleTitle')
          : t('workforce.workerProfile');
  return (
    <View style={styles.screen}>
      <QueryState query={profile}>
        {(data) => {
          const requiredKinds = documentKinds.filter(
            (kind) => kind !== 'SAFETY_CARD' || data.safetyCardRequired !== false,
          );
          const approved = requiredKinds.filter((kind) => !data.missingKinds.includes(kind)).length;
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
                <Button
                  label={t('documents.bundleTitle')}
                  onPress={() => setSelected({ type: 'bundle' })}
                />
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
                  const items = currentDocuments(data.documents, kind);
                  const doc =
                    items.find((item) => item.status === 'PENDING') ??
                    items.find((item) => item.status === 'APPROVED') ??
                    items[0];
                  return (
                    <Pressable
                      key={kind}
                      accessibilityRole="button"
                      accessibilityLabel={t('documents.' + kind)}
                      onPress={() => setSelected({ type: 'certificate', kind })}
                      style={styles.certificate}
                    >
                      <View style={styles.rowHeader}>
                        <IconShield size={19} color={colors.primary} />
                        <Text style={[styles.rowTitle, styles.grow]}>
                          {t('documents.' + kind)}
                          {kind === 'SAFETY_CARD' && data.safetyCardRequired === false
                            ? ' (' + t('documents.optional') + ')'
                            : ''}
                        </Text>
                      </View>
                      <DocumentStatus status={doc?.status ?? 'MISSING'} />
                      {doc?.reviewNote && <Text style={styles.noticeText}>{doc.reviewNote}</Text>}
                    </Pressable>
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
              onSubmitted={() => {
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
              {!selectedDocuments.length && <Hint>{t('documents.noFile')}</Hint>}
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
          {t('documents.declaredIssuedOn')}: {documentDate(doc.submittedIssuedOn)}
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
      {doc.identityCheck?.status === 'MISMATCH' && <Hint>{t('documents.identityMismatch')}</Hint>}
      <EvidenceButton
        label={t('documents.view')}
        mediaType={doc.mediaType}
        load={() => client.workerDocumentFile(token, scope.siteId, workerId, doc.id)}
      />
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
