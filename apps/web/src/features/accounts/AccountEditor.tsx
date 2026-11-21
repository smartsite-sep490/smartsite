import { translate as tr } from '../../i18n';
import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  SmartSiteManagementClient,
  type AccountResponse,
  type SiteResponse,
} from '@smartsite/api-client';
import type { ProvisionableRoleAssignment } from '@smartsite/contracts';
import {
  ACCOUNT_ROLES,
  accountControl,
  accountErrorKey,
  validAssignments,
  validTemporaryPassword,
} from './account-utils';
import { IconAlertTriangle } from '../../components/icons';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';

export type AccountEditorAction =
  { mode: 'create' } | { mode: 'roles' | 'password' | 'status'; account: AccountResponse };

interface Props {
  action: AccountEditorAction;
  client: SmartSiteManagementClient;
  token: string;
  actorId: string;
  sites: SiteResponse[];
  sitesReady: boolean;
  onClose: () => void;
  onSaved: (selfSessionRevoked: boolean) => void;
}

export function AccountEditor({
  action,
  client,
  token,
  actorId,
  sites,
  sitesReady,
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const account = action.mode === 'create' ? undefined : action.account;
  const editingRoles = action.mode === 'create' || action.mode === 'roles';
  const editingPassword = action.mode === 'create' || action.mode === 'password';
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<ProvisionableRoleAssignment[]>(
    () =>
      account?.roleAssignments.map(({ role, siteId }) => ({ role, siteId })) ?? [
        { role: 'SITE_MANAGER', siteId: sites[0]?.id ?? '' },
      ],
  );
  const selfSessionRevoked =
    account?.id === actorId && (action.mode === 'roles' || action.mode === 'password');
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: async () => {
      if (action.mode === 'create')
        return client.createUser(token, {
          username: username.trim().toLowerCase(),
          displayName: displayName.trim(),
          temporaryPassword: password,
          roleAssignments: assignments,
        });
      if (action.mode === 'roles')
        return client.replaceUserRoleAssignments(token, action.account.id, assignments);
      if (action.mode === 'password')
        return client.resetUserPassword(token, action.account.id, password);
      return client.setUserActive(token, action.account.id, !action.account.isActive);
    },
    onSuccess: () => {
      setPassword('');
      onSaved(selfSessionRevoked);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    if (
      action.mode === 'create' &&
      (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username.trim().toLowerCase()) ||
        !displayName.trim() ||
        /[\p{Cc}\p{Cs}]/u.test(displayName))
    ) {
      setValidation('accounts.invalidIdentity');
      return;
    }
    if (editingRoles && !validAssignments(assignments)) {
      setValidation('accounts.invalidRoles');
      return;
    }
    if (editingPassword && !validTemporaryPassword(password)) {
      setValidation('accounts.passwordHint');
      return;
    }
    setValidation(null);
    mutation.mutate();
  }

  const title = t(
    `accounts.${action.mode === 'status' ? (account?.isActive ? 'disableTitle' : 'enableTitle') : `${action.mode}Title`}`,
  );

  return (
    <Dialog
      open
      title={title}
      maxWidth="xl"
      description={account ? `${account.displayName} · ${account.username}` : undefined}
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
    >
      <form onSubmit={submit}>
        <fieldset disabled={mutation.isPending} className="space-y-4">
          {/* Create Mode: Username & Display Name */}
          {action.mode === 'create' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 text-xs font-bold text-slate-700">
                <label htmlFor="account-username" className="block">
                  {t('accounts.username')}
                </label>
                <input
                  id="account-username"
                  aria-describedby="account-username-hint"
                  className={accountControl}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="off"
                  required
                  minLength={3}
                  maxLength={64}
                  placeholder={tr('integrated_ui.vd_nguyen_van_a')}
                />
                <p
                  id="account-username-hint"
                  className="block text-[11px] font-normal text-slate-500"
                >
                  {t('accounts.usernameHint')}
                </p>
              </div>
              <div className="space-y-1.5 text-xs font-bold text-slate-700">
                <label htmlFor="account-display-name" className="block">
                  {t('accounts.displayName')}
                </label>
                <input
                  id="account-display-name"
                  className={accountControl}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                  maxLength={255}
                  placeholder={t('accounts.namePlaceholder')}
                />
              </div>
            </div>
          )}

          {/* Password Editor */}
          {editingPassword && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
              <label className="block space-y-1.5 text-xs font-bold text-slate-700">
                <span>{t('accounts.temporaryPassword')}</span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className={accountControl}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  aria-describedby="account-password-hint"
                  placeholder={t('accounts.passwordPlaceholder')}
                />
              </label>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showPassword}
                    className="rounded text-[#F66B17] focus:ring-orange-400"
                    onChange={(event) => setShowPassword(event.target.checked)}
                  />
                  <span>{t('accounts.showPassword')}</span>
                </label>
                <p id="account-password-hint" className="text-[11px] text-slate-500">
                  {t('accounts.passwordHint')}
                </p>
              </div>
              <p className="text-xs text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200/80">
                {t('accounts.temporaryHint')}
              </p>
            </div>
          )}

          {/* Roles Editor */}
          {editingRoles && (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                    {t('accounts.roles')}
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">{t('accounts.scopeHint')}</p>
                </div>
                <Button
                  variant="outline"
                  type="button"
                  className="min-h-10"
                  onClick={() =>
                    setAssignments((rows) => [
                      ...rows,
                      { role: 'WORKER', siteId: sites[0]?.id ?? '' },
                    ])
                  }
                >
                  {t('accounts.addRole')}
                </Button>
              </div>

              <div className="space-y-2.5">
                {assignments.map((assignment, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-1 items-end gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 md:grid-cols-[1fr_1fr_auto]"
                  >
                    <label className="space-y-1 text-xs font-bold text-slate-700">
                      <span>{t('accounts.roleNumber', { number: index + 1 })}</span>
                      <select
                        aria-label={t('accounts.roleNumber', { number: index + 1 })}
                        className={accountControl}
                        value={assignment.role}
                        disabled={assignment.role === 'CONTRACTOR_REPRESENTATIVE'}
                        onChange={(event) => {
                          const role = event.target.value as ProvisionableRoleAssignment['role'];
                          setAssignments((rows) =>
                            rows.map((row, i) =>
                              i === index
                                ? {
                                    role,
                                    siteId:
                                      role === 'ADMIN' ? null : (row.siteId ?? sites[0]?.id ?? ''),
                                  }
                                : row,
                            ),
                          );
                        }}
                      >
                        {ACCOUNT_ROLES.filter(
                          (role) =>
                            role !== 'CONTRACTOR_REPRESENTATIVE' || assignment.role === role,
                        ).map((role) => (
                          <option key={role} value={role}>
                            {t(`accounts.role.${role}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-xs font-bold text-slate-700">
                      <span>{t('accounts.siteNumber', { number: index + 1 })}</span>
                      <select
                        aria-label={t('accounts.siteNumber', { number: index + 1 })}
                        className={accountControl}
                        disabled={
                          assignment.role === 'ADMIN' ||
                          assignment.role === 'CONTRACTOR_REPRESENTATIVE' ||
                          !sitesReady
                        }
                        required={assignment.role !== 'ADMIN'}
                        value={assignment.siteId ?? ''}
                        onChange={(event) =>
                          setAssignments((rows) =>
                            rows.map((row, i) =>
                              i === index ? { ...row, siteId: event.target.value } : row,
                            ),
                          )
                        }
                      >
                        <option value="">
                          {t(
                            assignment.role === 'ADMIN' ? 'accounts.global' : 'accounts.selectSite',
                          )}
                        </option>
                        {assignment.siteId &&
                          !sites.some((site) => site.id === assignment.siteId) && (
                            <option value={assignment.siteId}>
                              {t('accounts.unavailableSite', { id: assignment.siteId })}
                            </option>
                          )}
                        {sites.map((site) => (
                          <option key={site.id} value={site.id}>
                            {site.name} ({site.code})
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {(assignment.role === 'SAFETY_OFFICER' ||
                        assignment.role === 'SECURITY_OFFICER') && (
                        <Button
                          variant="outline"
                          type="button"
                          className="min-h-10"
                          aria-label={t('accounts.addSiteForRole', { number: index + 1 })}
                          onClick={() =>
                            setAssignments((rows) => [
                              ...rows,
                              { role: assignment.role, siteId: '' },
                            ])
                          }
                        >
                          {t('accounts.addSite')}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        type="button"
                        className="min-h-10"
                        disabled={assignments.length === 1}
                        aria-label={t('accounts.removeRoleNumber', { number: index + 1 })}
                        onClick={() => setAssignments((rows) => rows.filter((_, i) => i !== index))}
                      >
                        {t('accounts.removeRole')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-xs text-slate-600">{t('accounts.representativeHint')}</p>
              {action.mode === 'roles' && (
                <p className="text-xs text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                  {t('accounts.rolesHint')}
                </p>
              )}
            </div>
          )}

          {/* Mode-specific context hints */}
          {action.mode === 'password' && (
            <p className="text-xs text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
              {t('accounts.resetHint')}
            </p>
          )}
          {action.mode === 'status' && (
            <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200">
              {t(account?.isActive ? 'accounts.disableHint' : 'accounts.enableHint')}
            </p>
          )}
          {selfSessionRevoked && (
            <p className="text-xs font-semibold text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
              {t('accounts.selfSessionHint')}
            </p>
          )}

          {/* Validation / Mutation Error Alert */}
          {(validation || mutation.isError) && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-bold text-rose-800"
            >
              <IconAlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{t(validation ?? accountErrorKey(mutation.error))}</span>
            </div>
          )}

          {/* Modal Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 pt-4">
            <Button
              variant="outline"
              type="button"
              className="min-h-10"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              {t('accounts.cancel')}
            </Button>
            <Button
              variant={action.mode === 'status' && account?.isActive ? 'destructive' : 'primary'}
              isLoading={mutation.isPending}
              type="submit"
              className="min-h-10"
              disabled={mutation.isPending || (editingRoles && !sitesReady)}
            >
              <span>{t(mutation.isPending ? 'accounts.saving' : 'accounts.confirm')}</span>
            </Button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
