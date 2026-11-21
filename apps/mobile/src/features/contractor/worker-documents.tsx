import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type {
  NativeUploadFile,
  WorkerComplianceResponse,
  WorkerDocumentKind,
  WorkerDocumentResponse,
} from '@smartsite/api-client';
import { useTranslation, uiLocale } from '../../i18n';
import { colors } from '../../theme/colors';
import { WorkerAvatar } from '../../components/common/WorkerAvatar';
import {
  IconAlert,
  IconChevronRight,
  IconDocument,
  IconShield,
  IconUser,
} from '../../components/common/Icons';
import { useWorkspace } from '../workspace/workspace-context';
import { useCommand } from '../shared/data';
import { Button, ErrorNotice, Hint, QueryState } from '../shared/ui';
import { Attachments, EvidenceButton } from '../shared/uploads';
import { RequestSheet } from '../shared/request-sheet';
import { WorkerCertificateSubmission, SubmittedExpiryEditor } from './worker-document-forms';

export const documentKinds: readonly WorkerDocumentKind[] = [
  'SAFETY_CARD',
  'HEALTH_CERTIFICATE',
  'PERSONAL_INSURANCE',
];
type Selection =
  | { type: 'profile' }
  | { type: 'identity'; side: 'FRONT' | 'BACK' }
  | { type: 'certificate'; kind: WorkerDocumentKind; upload: boolean };

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
  canSubmitDocuments = false,
}: {
  workerId: string;
  canUpload?: boolean;
  canSubmitDocuments?: boolean;
}) {
  const { t } = useTranslation();
  const { client, token, scope, queryKey } = useWorkspace();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [identityFiles, setIdentityFiles] = useState<NativeUploadFile[]>([]);
  const [formBusy, setFormBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState(false);
  const command = useCommand();
  const profile = useQuery({
    queryKey: [...queryKey, 'worker-documents', workerId],
    queryFn: () => client.workerCompliance(token, scope.siteId, workerId),
  });
  const canSubmit = canUpload || canSubmitDocuments;
  const open = (value: Selection) => {
    setSelected(value);
    setIdentityFiles([]);
    setSaved(false);
    setHistory(false);
    command.reset();
  };
  const title =
    selected?.type === 'certificate'
      ? t(`documents.${selected.kind}`)
      : selected?.type === 'identity'
        ? t(`documents.${selected.side}`)
        : t('workforce.workerProfile');
  const documents =
    selected?.type === 'certificate'
      ? currentDocuments(profile.data?.documents ?? [], selected.kind)
      : [];
  const upload = selected?.type === 'certificate' && selected.upload;
  const identity =
    selected?.type === 'identity'
      ? profile.data?.identityImages.find((i) => i.side === selected.side)
      : undefined;
  return (
    <View style={styles.screen}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>{t('documentUi.eyebrow')}</Text>
        <Text style={styles.hint}>{t('documentUi.subtitle')}</Text>
      </View>
      <QueryState query={profile}>
        {(data) => {
          const approved = documentKinds.filter((kind) =>
            data.documents.some((d) => d.kind === kind && d.status === 'APPROVED'),
          ).length;
          return (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('workforce.workerProfile')}
                onPress={() => open({ type: 'profile' })}
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
                    {t('documentUi.completion', { count: approved, total: documentKinds.length })}
                  </Text>
                  <Text style={styles.hint}>
                    {t(
                      data.needsSupplement
                        ? 'documents.needsSupplement'
                        : data.status === 'EXPIRED'
                          ? 'documents.EXPIRED'
                          : 'documentUi.reviewHint',
                    )}
                  </Text>
                </View>
                <DocumentStatus status={data.status} />
              </View>
              <Text style={styles.sectionTitle}>{t('documents.identityHeading')}</Text>
              <View style={styles.list}>
                {(['FRONT', 'BACK'] as const).map((side) => {
                  const image = data.identityImages.find((i) => i.side === side);
                  return (
                    <Pressable
                      key={side}
                      accessibilityRole="button"
                      accessibilityLabel={t(`documents.${side}`)}
                      onPress={() => open({ type: 'identity', side })}
                      style={styles.row}
                    >
                      <View style={styles.icon}>
                        <IconUser size={19} color={colors.primary} />
                      </View>
                      <View style={styles.grow}>
                        <Text style={styles.rowTitle}>{t(`documents.${side}`)}</Text>
                        <Text style={styles.hint}>
                          {t(image ? 'documentUi.fileReady' : 'documents.noFile')}
                        </Text>
                      </View>
                      <IconChevronRight size={18} color={colors.textMuted} />
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.sectionTitle}>{t('documents.certificatesHeading')}</Text>
              <View style={styles.list}>
                {documentKinds.map((kind) => {
                  const items = currentDocuments(data.documents, kind),
                    pending = items.find((d) => d.status === 'PENDING'),
                    current = items.find((d) => d.status === 'APPROVED') ?? items[0];
                  const expired =
                    data.status === 'EXPIRED' &&
                    current?.expiresOn &&
                    current.expiresOn < new Date().toISOString().slice(0, 10);
                  return (
                    <Pressable
                      key={kind}
                      accessibilityRole="button"
                      accessibilityLabel={t(`documents.${kind}`)}
                      onPress={() => open({ type: 'certificate', kind, upload: false })}
                      style={styles.certificate}
                    >
                      <View style={styles.rowHeader}>
                        <View style={styles.icon}>
                          <IconShield size={19} color={colors.primary} />
                        </View>
                        <View style={styles.grow}>
                          <Text style={styles.rowTitle}>{t(`documents.${kind}`)}</Text>
                        </View>
                        <IconChevronRight size={18} color={colors.textMuted} />
                      </View>
                      <View style={styles.certificateMeta}>
                        <DocumentStatus
                          status={
                            pending
                              ? 'PENDING'
                              : expired
                                ? 'EXPIRED'
                                : (current?.status ?? 'MISSING')
                          }
                        />
                        <Text style={[styles.hint, styles.flexText]}>
                          {current?.expiresOn
                            ? t('documentUi.validUntil', { date: documentDate(current.expiresOn) })
                            : t('documentUi.openDetails')}
                        </Text>
                      </View>
                      {pending && current?.status === 'APPROVED' && (
                        <Text style={styles.hint}>{t('documentUi.renewalPending')}</Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
              {data.expiringKinds.length > 0 && (
                <View style={styles.notice}>
                  <IconAlert size={17} color="#A16C21" />
                  <Text style={styles.noticeText}>{t('documents.expiring')}</Text>
                </View>
              )}
            </>
          );
        }}
      </QueryState>
      {selected && profile.data && (
        <RequestSheet
          visible
          variant="compact"
          title={title}
          subtitle={profile.data.displayName}
          busy={command.isPending || formBusy}
          onClose={() => setSelected(null)}
          footer={
            <View style={styles.footer}>
              <ErrorNotice error={command.error} />
              {selected.type === 'certificate' && !upload && canSubmit && (
                <Button
                  label={t(documents.length ? 'documentUi.submitNew' : 'documents.upload')}
                  disabled={profile.isError}
                  onPress={() => {
                    setSaved(false);
                    setSelected({ ...selected, upload: true });
                  }}
                />
              )}
              {selected.type === 'identity' && !identity && canUpload && (
                <Button
                  label={t('documents.upload')}
                  disabled={command.isPending || profile.isError || !identityFiles[0]}
                  onPress={() => {
                    const file = identityFiles[0];
                    if (!file || selected.type !== 'identity') return;
                    const side = selected.side;
                    command.mutate(async () => {
                      await client.uploadWorkerIdentityImage(
                        token,
                        scope.siteId,
                        workerId,
                        side,
                        file,
                      );
                      setIdentityFiles([]);
                      await profile.refetch();
                      setSaved(true);
                    });
                  }}
                />
              )}
              {upload && (
                <Button
                  secondary
                  label={t('common.back')}
                  disabled={formBusy}
                  onPress={() =>
                    selected.type === 'certificate' && setSelected({ ...selected, upload: false })
                  }
                />
              )}
            </View>
          }
        >
          {saved && (
            <Text accessibilityLiveRegion="polite" style={styles.saved}>
              {t('documentUi.submitted')}
            </Text>
          )}
          {profile.isError && <ErrorNotice error={profile.error} />}
          {selected.type === 'profile' && <ProfileDetails data={profile.data} />}
          {selected.type === 'identity' && (
            <>
              {identity ? (
                <>
                  <Text style={styles.filename}>{identity.originalName}</Text>
                  <EvidenceButton
                    label={t('documents.view')}
                    mediaType={identity.mediaType}
                    load={() =>
                      client.workerIdentityImageFile(token, scope.siteId, workerId, identity.id)
                    }
                  />
                  {identity.identityCheck?.status === 'MISMATCH' && (
                    <Text style={styles.noticeText}>{t('documents.identityMismatch')}</Text>
                  )}
                  {canUpload && (
                    <Button
                      secondary
                      label={t('documents.ocr')}
                      disabled={command.isPending || profile.isError}
                      onPress={() =>
                        command.mutate(() =>
                          client.retryWorkerIdentityOcr(token, scope.siteId, workerId, identity.id),
                        )
                      }
                    />
                  )}
                </>
              ) : canUpload && profile.data.contractorId ? (
                <>
                  <Text style={styles.hint}>{t('documentUi.identityHint')}</Text>
                  <Attachments
                    files={identityFiles}
                    maxFiles={1}
                    allowPdf={false}
                    disabled={command.isPending || profile.isError}
                    onChange={setIdentityFiles}
                    validateFile={async (file) => {
                      const result = await client.checkDocumentImageQuality(
                        token,
                        scope.siteId,
                        profile.data!.contractorId!,
                        file,
                      );
                      if (result.status !== 'ACCEPTED')
                        throw new Error(t(`documents.${result.reason}`));
                    }}
                  />
                </>
              ) : (
                <Hint>{t('documents.noFile')}</Hint>
              )}
            </>
          )}
          {selected.type === 'certificate' &&
            (upload ? (
              <WorkerCertificateSubmission
                key={selected.kind}
                workerId={workerId}
                kind={selected.kind}
                requireDate={canSubmitDocuments}
                disabled={profile.isError}
                onBusyChange={setFormBusy}
                onSubmitted={() => {
                  setSelected({ ...selected, upload: false });
                  setSaved(true);
                  void profile.refetch();
                }}
              />
            ) : (
              <>
                {!documents.length && (
                  <View style={styles.empty}>
                    <IconDocument size={30} color={colors.textMuted} />
                    <Text style={styles.rowTitle}>{t('documents.noFile')}</Text>
                    <Text style={styles.hint}>
                      {t(canSubmit ? 'documentUi.emptyUpload' : 'documentUi.emptyReadOnly')}
                    </Text>
                  </View>
                )}
                {documents.map((doc) => (
                  <CertificateDetails
                    key={`${doc.id}:${doc.version}`}
                    doc={doc}
                    workerId={workerId}
                    canEdit={canSubmit && !profile.isError}
                  />
                ))}
                {profile.data.documents.some(
                  (d) => d.kind === selected.kind && d.status === 'SUPERSEDED',
                ) && (
                  <>
                    <Button
                      secondary
                      label={t(history ? 'documentUi.hideHistory' : 'documentUi.history')}
                      onPress={() => setHistory(!history)}
                    />
                    {history &&
                      profile.data.documents
                        .filter((d) => d.kind === selected.kind && d.status === 'SUPERSEDED')
                        .map((doc) => (
                          <CertificateDetails
                            key={doc.id}
                            doc={doc}
                            workerId={workerId}
                            canEdit={false}
                          />
                        ))}
                  </>
                )}
              </>
            ))}
        </RequestSheet>
      )}
    </View>
  );
}
function ProfileDetails({ data }: { data: WorkerComplianceResponse }) {
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
function CertificateDetails({
  doc,
  workerId,
  canEdit,
}: {
  doc: WorkerDocumentResponse;
  workerId: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const { client, token, scope } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const command = useCommand();
  return (
    <View style={styles.document}>
      <DocumentStatus status={doc.status} />
      <Text style={styles.filename}>{doc.originalName}</Text>
      <View style={styles.dates}>
        <View style={styles.grow}>
          <Text style={styles.hint}>{t('documents.issuedOn')}</Text>
          <Text style={styles.value}>{documentDate(doc.issuedOn ?? doc.submittedIssuedOn)}</Text>
        </View>
        <View style={styles.grow}>
          <Text style={styles.hint}>{t('documents.expiresOn')}</Text>
          <Text style={styles.value}>{documentDate(doc.expiresOn ?? doc.submittedExpiresOn)}</Text>
        </View>
      </View>
      {doc.reviewNote && (
        <View style={styles.review}>
          <Text style={styles.label}>{t('documentUi.reviewNote')}</Text>
          <Text style={styles.hint}>{doc.reviewNote}</Text>
        </View>
      )}
      {doc.identityCheck?.status === 'MISMATCH' && (
        <Text style={styles.noticeText}>{t('documents.identityMismatch')}</Text>
      )}
      <EvidenceButton
        label={t('documents.view')}
        mediaType={doc.mediaType}
        load={() => client.workerDocumentFile(token, scope.siteId, workerId, doc.id)}
      />
      {doc.status === 'PENDING' && canEdit && (
        <>
          <Button
            secondary
            label={t('documentUi.editDeclaredDate')}
            onPress={() => setEditing(!editing)}
          />
          {editing && (
            <SubmittedExpiryEditor
              doc={doc}
              disabled={command.isPending}
              save={(value) =>
                command.mutate(async () => {
                  await client.updateWorkerDocumentExpiry(token, scope.siteId, workerId, doc.id, {
                    expectedVersion: doc.version,
                    ...(doc.kind === 'HEALTH_CERTIFICATE'
                      ? { submittedIssuedOn: value }
                      : { submittedExpiresOn: value }),
                  });
                  setEditing(false);
                })
              }
            />
          )}
          <ErrorNotice error={command.error} />
        </>
      )}
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
