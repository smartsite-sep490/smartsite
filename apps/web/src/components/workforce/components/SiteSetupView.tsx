import { localizedError, localizeMessage, userErrorMessage } from '../../../i18n/messages';
import { uiLocale } from '../../../i18n';
import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import { SiteZoneSetup } from './SiteZoneSetup';
import { ContractorZoneSetup } from './ContractorZoneSetup';
import { ManagerContractorDetails } from '../../dashboard/ManagerContractorDetails';
import { ContractorParticipationDirectory } from './ContractorParticipationDirectory';
import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@smartsite/api-client';
import { useManagementClient, useAuth, useCurrentUser } from '../../../features/auth/auth-session';
import {
  IconBuilding,
  IconBuilding2,
  IconPlus,
  IconCheckCircle2,
  IconAlertCircle,
  IconLoader,
  IconRefreshCw,
  IconShield,
  IconUser,
  IconKey,
  IconSearch,
  IconX,
  IconChevronRight,
  IconUsers,
} from '../../icons';
import { SmartSelect, Toast, ToastContainer, useToast } from '../../ui';
import { participationDates } from './participation-dates';
import {
  addSiteManagerAssignment,
  getAssignableRepresentatives,
  getAssignableSiteManagers,
  getContractorRepresentativeUserIds,
  getSiteManagers,
  getReadySiteManagers,
} from '../utils/site-setup-helpers';
import { SiteOperationsSetupView } from './SiteOperationsSetupView';
import { loadAllPages } from '../load-all-pages';

interface SiteSetupViewProps {
  apiUrl: string;
}

export function SiteSetupView({ apiUrl }: SiteSetupViewProps) {
  useTranslation();

  const { accessToken } = useAuth();
  const { data: currentUser } = useCurrentUser(apiUrl);
  const queryClient = useQueryClient();
  const client = useManagementClient(apiUrl);

  const isAdmin =
    currentUser?.roleAssignments.some((r) => r.role === 'ADMIN' && r.siteId === null) ?? false;

  const hasManagerRole =
    currentUser?.roleAssignments.some((r) => r.role === 'SITE_MANAGER' && r.siteId !== null) ??
    false;
  const canSetup = isAdmin || hasManagerRole;

  // Navigation & Selection state
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [detailContractor, setDetailContractor] = useState<{
    siteId: string;
    contractorId: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<
    'contractors' | 'representatives' | 'zones' | 'zone-assignments'
  >('contractors');
  const [siteSearchQuery, setSiteSearchQuery] = useState('');
  const [contractorSearchQuery, setContractorSearchQuery] = useState('');
  const { toast, showToast, hideToast } = useToast();

  // Modal open states
  const [showCreateSiteModal, setShowCreateSiteModal] = useState(false);
  const [showCreateRepModal, setShowCreateRepModal] = useState(false);
  const [showAssignRepModal, setShowAssignRepModal] = useState(false);
  const [showAssignManagerModal, setShowAssignManagerModal] = useState(false);
  const [showCreateManagerModal, setShowCreateManagerModal] = useState(false);
  const [preselectedContractorId, setPreselectedContractorId] = useState<string>('');
  const [assignRepContractorId, setAssignRepContractorId] = useState('');
  const [selectedManagerId, setSelectedManagerId] = useState('');

  // Site Form State
  const [siteName, setSiteName] = useState('');
  const [siteCode, setSiteCode] = useState('');
  const [siteError, setSiteError] = useState<string | null>(null);

  // Representative Form State
  const [repUsername, setRepUsername] = useState('');
  const [repDisplayName, setRepDisplayName] = useState('');
  const [repPassword, setRepPassword] = useState('');
  const [showRepPassword, setShowRepPassword] = useState(false);
  const [repContractorId, setRepContractorId] = useState('');
  const [repNewContractorName, setRepNewContractorName] = useState('');
  const [repStartDate, setRepStartDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [repEndDate, setRepEndDate] = useState('');
  const [editProfile, setEditProfile] = useState<{
    kind: 'contractor' | 'representative';
    id: string;
    name: string;
    expectedName: string;
  } | null>(null);
  const [repError, setRepError] = useState<string | null>(null);
  const [repSuccessMsg, setRepSuccessMsg] = useState<string | null>(null);
  const [existingRepId, setExistingRepId] = useState('');
  const [assignRepError, setAssignRepError] = useState<string | null>(null);
  const [managerError, setManagerError] = useState<string | null>(null);
  const [revokeManagerId, setRevokeManagerId] = useState<string | null>(null);
  const [managerSuccessMsg, setManagerSuccessMsg] = useState<string | null>(null);
  const [managerUsername, setManagerUsername] = useState('');
  const [managerDisplayName, setManagerDisplayName] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [showManagerPassword, setShowManagerPassword] = useState(false);
  const [createManagerError, setCreateManagerError] = useState<string | null>(null);

  // ── Queries ─────────────────────────────────────────────────────────────────
  const sitesQuery = useQuery({
    queryKey: ['site-setup', apiUrl, currentUser?.id, 'sites'],
    queryFn: ({ signal }) =>
      loadAllPages((options) => client.listSites(accessToken!, options), signal),
    enabled: Boolean(accessToken && canSetup),
  });

  const sites = useMemo(
    () =>
      (sitesQuery.data?.items ?? []).filter(
        (site) =>
          isAdmin ||
          currentUser?.roleAssignments.some(
            (r) => r.role === 'SITE_MANAGER' && r.siteId === site.id,
          ),
      ),
    [sitesQuery.data, isAdmin, currentUser],
  );
  const setupKey = ['site-setup', apiUrl, currentUser?.id];

  // Auto-select first site if none selected
  const selectedSite = useMemo(() => {
    if (selectedSiteId) {
      const found = sites.find((s) => s.id === selectedSiteId);
      if (found) return found;
    }
    return sites[0] ?? null;
  }, [sites, selectedSiteId]);

  const activeSiteId = selectedSite?.id ?? null;
  const isManager =
    currentUser?.roleAssignments.some(
      (r) => r.role === 'SITE_MANAGER' && r.siteId === activeSiteId,
    ) ?? false;

  const contractorsQuery = useQuery({
    queryKey: [...setupKey, 'contractors', activeSiteId],
    queryFn: ({ signal }) =>
      loadAllPages(
        (options) => client.listContractors(accessToken!, activeSiteId!, options),
        signal,
      ),
    enabled: Boolean(accessToken && isManager && activeSiteId),
  });

  const contractors = useMemo(() => contractorsQuery.data?.items ?? [], [contractorsQuery.data]);

  const usersQuery = useQuery({
    queryKey: [...setupKey, 'users', isAdmin ? null : activeSiteId],
    queryFn: ({ signal }) =>
      loadAllPages(
        (options) =>
          isAdmin
            ? client.listUsers(accessToken!, options)
            : client.listSiteRepresentatives(accessToken!, activeSiteId!, options),
        signal,
      ),
    enabled: Boolean(accessToken && (isAdmin || (isManager && activeSiteId))),
  });

  const representativeAssignmentsQuery = useQuery({
    queryKey: [...setupKey, 'contractor-representative-assignments', activeSiteId],
    queryFn: ({ signal }) =>
      loadAllPages(
        (options) =>
          client.listContractorRepresentativeAssignments(accessToken!, activeSiteId!, options),
        signal,
      ),
    enabled: Boolean(accessToken && isManager && activeSiteId),
  });

  const allUsers = useMemo(() => usersQuery.data?.items ?? [], [usersQuery.data]);
  const representativeAssignments = useMemo(
    () => representativeAssignmentsQuery.data?.items ?? [],
    [representativeAssignmentsQuery.data],
  );

  // Filter representatives belonging to this site
  const siteRepresentatives = useMemo(() => {
    if (!activeSiteId) return [];
    return allUsers.filter((u) =>
      u.roleAssignments.some(
        (r) => r.role === 'CONTRACTOR_REPRESENTATIVE' && r.siteId === activeSiteId,
      ),
    );
  }, [allUsers, activeSiteId]);

  const siteManagers = useMemo(
    () =>
      activeSiteId
        ? getSiteManagers(isAdmin ? allUsers : currentUser ? [currentUser] : [], activeSiteId)
        : [],
    [allUsers, activeSiteId, isAdmin, currentUser],
  );

  const readySiteManagers = activeSiteId
    ? getReadySiteManagers(isAdmin ? allUsers : currentUser ? [currentUser] : [], activeSiteId)
    : [];
  const managersLoaded = usersQuery.isSuccess;

  const assignableSiteManagers = useMemo(
    () => (activeSiteId ? getAssignableSiteManagers(allUsers, activeSiteId) : []),
    [allUsers, activeSiteId],
  );

  const assignableRepresentatives = useMemo(
    () =>
      getAssignableRepresentatives(
        siteRepresentatives,
        representativeAssignments,
        assignRepContractorId,
      ),
    [siteRepresentatives, representativeAssignments, assignRepContractorId],
  );

  // Filtered sites for search
  const filteredSites = useMemo(() => {
    if (!siteSearchQuery.trim()) return sites;
    const q = siteSearchQuery.toLowerCase();
    return sites.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q),
    );
  }, [sites, siteSearchQuery]);

  // Filtered contractors for search
  const filteredContractors = useMemo(() => {
    if (!contractorSearchQuery.trim()) return contractors;
    const q = contractorSearchQuery.toLowerCase();
    return contractors.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [contractors, contractorSearchQuery]);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const createSiteMutation = useMutation({
    mutationFn: (input: { code: string; name: string }) => client.createSite(accessToken!, input),
    onSuccess: (newSite) => {
      setSiteError(null);
      setSiteName('');
      setSiteCode('');
      setShowCreateSiteModal(false);
      queryClient.invalidateQueries({ queryKey: [...setupKey, 'sites'] });
      setSelectedSiteId(newSite.id);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setSiteError(userErrorMessage(err));
      } else {
        setSiteError(tr('site_setup_view.failed_to_create_site_please_check_input_parameters'));
      }
    },
  });

  const createRepresentativeMutation = useMutation({
    mutationFn: async (input: {
      username: string;
      displayName: string;
      temporaryPassword: string;
      contractorId: string;
    }) => {
      if (input.contractorId === '__new__')
        return client.createContractorRepresentative(accessToken!, activeSiteId!, {
          username: input.username,
          displayName: input.displayName,
          temporaryPassword: input.temporaryPassword,
          contractorName: repNewContractorName.trim(),
          ...participationDates(repStartDate, repEndDate),
        });
      return client.createSiteRepresentative(accessToken!, activeSiteId!, input.contractorId, {
        username: input.username,
        displayName: input.displayName,
        temporaryPassword: input.temporaryPassword,
      });
    },
    onSuccess: (user) => {
      setRepError(null);
      setRepSuccessMsg(tr('messages.9de22f131041', { value1: user.username }));
      setRepUsername('');
      setRepDisplayName('');
      setRepPassword('');
      setRepContractorId('');
      setShowCreateRepModal(false);
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes(activeSiteId!),
      });
      queryClient.invalidateQueries({ queryKey: [...setupKey, 'users'] });
      queryClient.invalidateQueries({
        queryKey: [...setupKey, 'contractor-representative-assignments', activeSiteId],
      });
      queryClient.invalidateQueries({ queryKey: [...setupKey, 'contractors', activeSiteId] });
      setTimeout(() => setRepSuccessMsg(null), 5000);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setRepError(userErrorMessage(err));
      } else {
        setRepError(
          tr(
            'site_setup_view.could_not_create_the_representative_account_verify_password_policy_and_inputs',
          ),
        );
      }
    },
  });

  const renameProfile = useMutation({
    mutationFn: (profile: NonNullable<typeof editProfile>) =>
      profile.kind === 'contractor'
        ? client.renameContractor(accessToken!, activeSiteId!, profile.id, {
            name: profile.name.trim(),
            expectedName: profile.expectedName,
          })
        : client.renameSiteRepresentative(accessToken!, activeSiteId!, profile.id, {
            name: profile.name.trim(),
            expectedName: profile.expectedName,
          }),
    onSuccess: () => {
      setEditProfile(null);
      showToast(tr('contractor_profile.updated_successfully'));
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes(activeSiteId!),
      });
    },
  });

  const assignExistingRepresentativeMutation = useMutation({
    mutationFn: async (input: { contractorId: string; userId: string }) => {
      if (!activeSiteId) throw new Error(tr('site_setup_view.an_active_site_must_be_selected'));
      return client.assignContractorRepresentative(accessToken!, activeSiteId, input.contractorId, {
        userId: input.userId,
      });
    },
    onSuccess: () => {
      const representative = siteRepresentatives.find((user) => user.id === existingRepId);
      setAssignRepError(null);
      setRepSuccessMsg(
        tr('messages.b88c8ce7f3f0', {
          value1: representative?.username ?? tr('common.selected_account'),
        }),
      );
      setExistingRepId('');
      setAssignRepContractorId('');
      setShowAssignRepModal(false);
      queryClient.invalidateQueries({
        queryKey: [...setupKey, 'contractor-representative-assignments', activeSiteId],
      });
      setTimeout(() => setRepSuccessMsg(null), 5000);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setAssignRepError(userErrorMessage(err));
      } else {
        setAssignRepError(
          tr(
            'site_setup_view.could_not_assign_the_representative_account_verify_the_account_and_contractor_scop',
          ),
        );
      }
    },
  });

  const assignSiteManagerMutation = useMutation({
    mutationFn: async (input: { siteId: string; userId: string }) => {
      const user = allUsers.find((candidate) => candidate.id === input.userId);
      if (!user)
        throw new Error(
          tr(
            'site_setup_view.the_selected_account_could_not_be_found_refresh_the_page_and_try_again',
          ),
        );

      return client.replaceUserRoleAssignments(
        accessToken!,
        input.userId,
        addSiteManagerAssignment(user.roleAssignments, input.siteId),
      );
    },
    onSuccess: (user) => {
      setManagerError(null);
      setManagerSuccessMsg(tr('messages.2c107fddb236', { value1: user.username }));
      setSelectedManagerId('');
      setShowAssignManagerModal(false);
      queryClient.invalidateQueries({ queryKey: [...setupKey, 'users'] });
      setTimeout(() => setManagerSuccessMsg(null), 5000);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setManagerError(userErrorMessage(err));
      } else if (err instanceof Error) {
        setManagerError(userErrorMessage(err));
      } else {
        setManagerError(
          tr(
            'site_setup_view.could_not_assign_the_site_manager_account_refresh_the_page_and_try_again',
          ),
        );
      }
    },
  });

  const revokeSiteManagerMutation = useMutation({
    mutationFn: ({ userId, siteId }: { userId: string; siteId: string }) =>
      client.revokeSiteManager(accessToken!, userId, siteId),
    onSuccess: async () => {
      setRevokeManagerId(null);
      setShowAssignManagerModal(false);
      setManagerSuccessMsg(tr('site_setup_view.manager_revoked'));
      showToast(tr('site_setup_view.manager_revoked'));
      await queryClient.invalidateQueries({ queryKey: [...setupKey, 'users'] });
      setTimeout(() => setManagerSuccessMsg(null), 5000);
    },
    onError: (error) => setManagerError(userErrorMessage(error)),
  });

  const createSiteManagerMutation = useMutation({
    mutationFn: async (input: {
      username: string;
      displayName: string;
      temporaryPassword: string;
    }) => {
      if (!activeSiteId) throw new Error(tr('site_setup_view.an_active_site_must_be_selected'));

      return client.createUser(accessToken!, {
        username: input.username,
        displayName: input.displayName,
        temporaryPassword: input.temporaryPassword,
        roleAssignments: [{ role: 'SITE_MANAGER', siteId: activeSiteId }],
      });
    },
    onSuccess: (user) => {
      setCreateManagerError(null);
      setManagerSuccessMsg(tr('messages.35eb7f0050a0', { value1: user.username }));
      setManagerUsername('');
      setManagerDisplayName('');
      setManagerPassword('');
      setShowCreateManagerModal(false);
      setShowAssignManagerModal(false);
      queryClient.invalidateQueries({ queryKey: [...setupKey, 'users'] });
      setTimeout(() => setManagerSuccessMsg(null), 5000);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setCreateManagerError(userErrorMessage(err));
      } else {
        setCreateManagerError(
          tr(
            'site_setup_view.could_not_create_the_site_manager_account_verify_the_inputs_and_password_policy',
          ),
        );
      }
    },
  });

  // ── Access Guard ────────────────────────────────────────────────────────────
  if (!canSetup) {
    return (
      <div className="max-w-md mx-auto mt-20 p-8 rounded-2xl bg-white border border-rose-200 text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
          <IconShield className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900">{tr('common.access_restricted')}</h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          {tr(
            'site_setup_view.site_setup_requires_an_administrator_or_an_assigned_site_manager_your_current_role',
          )}
        </p>
      </div>
    );
  }

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleCreateSiteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSiteError(null);
    if (!siteName.trim()) {
      setSiteError(tr('site_setup_view.site_name_is_required'));
      return;
    }
    const code = siteCode.trim()
      ? siteCode.trim().toUpperCase()
      : siteName
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '-') +
        '-' +
        Math.floor(1000 + Math.random() * 9000);

    createSiteMutation.mutate({ code, name: siteName.trim() });
  };

  const handleCreateRepSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setRepError(null);
    const contractorId = repContractorId || preselectedContractorId || contractors[0]?.id;
    if (!activeSiteId || !contractorId) {
      setRepError(tr('site_setup_view.an_active_contractor_must_be_selected'));
      return;
    }
    if (
      contractorId === '__new__' &&
      (!repNewContractorName.trim() || !repStartDate || (repEndDate && repEndDate < repStartDate))
    ) {
      setRepError(tr('contractor_profile.check_fields'));
      return;
    }
    if (!repUsername.trim()) {
      setRepError(tr('common.username_is_required'));
      return;
    }
    if (!repDisplayName.trim()) {
      setRepError(tr('site_setup_view.display_name_is_required'));
      return;
    }
    if (!repPassword) {
      setRepError(tr('site_setup_view.temporary_password_is_required'));
      return;
    }

    createRepresentativeMutation.mutate({
      username: repUsername.trim(),
      displayName: repDisplayName.trim(),
      temporaryPassword: repPassword,
      contractorId,
    });
  };

  const openRepModalForContractor = (contractorId: string) => {
    setPreselectedContractorId(contractorId);
    setRepContractorId(contractorId || '__new__');
    setRepNewContractorName('');
    setRepStartDate(new Date().toLocaleDateString('en-CA'));
    setRepEndDate('');
    setRepError(null);
    setShowCreateRepModal(true);
  };

  const openAssignExistingRepModal = (contractorId: string) => {
    setAssignRepContractorId(contractorId);
    setExistingRepId('');
    setAssignRepError(null);
    setShowAssignRepModal(true);
  };

  const handleAssignExistingRepSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAssignRepError(null);
    if (!assignRepContractorId) {
      setAssignRepError(tr('site_setup_view.an_active_contractor_must_be_selected'));
      return;
    }
    if (!existingRepId) {
      setAssignRepError(tr('site_setup_view.please_select_an_existing_representative_account'));
      return;
    }

    assignExistingRepresentativeMutation.mutate({
      contractorId: assignRepContractorId,
      userId: existingRepId,
    });
  };

  const openAssignSiteManagerModal = () => {
    setSelectedManagerId('');
    setManagerError(null);
    setRevokeManagerId(null);
    setShowAssignManagerModal(true);
  };

  const openCreateSiteManagerModal = () => {
    setManagerUsername('');
    setManagerDisplayName('');
    setManagerPassword('');
    setShowManagerPassword(false);
    setCreateManagerError(null);
    setShowAssignManagerModal(false);
    setShowCreateManagerModal(true);
  };

  const handleAssignSiteManagerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setManagerError(null);
    if (!activeSiteId) {
      setManagerError(tr('site_setup_view.please_select_an_active_site_first'));
      return;
    }
    if (!selectedManagerId) {
      setManagerError(tr('site_setup_view.please_select_an_existing_account'));
      return;
    }

    assignSiteManagerMutation.mutate({ siteId: activeSiteId, userId: selectedManagerId });
  };

  const handleCreateSiteManagerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCreateManagerError(null);
    if (!activeSiteId) {
      setCreateManagerError(tr('site_setup_view.please_select_an_active_site_first'));
      return;
    }
    if (!managerUsername.trim()) {
      setCreateManagerError(tr('common.username_is_required'));
      return;
    }
    if (!managerDisplayName.trim()) {
      setCreateManagerError(tr('site_setup_view.display_name_is_required'));
      return;
    }
    if (!managerPassword) {
      setCreateManagerError(tr('site_setup_view.temporary_password_is_required'));
      return;
    }

    createSiteManagerMutation.mutate({
      username: managerUsername.trim(),
      displayName: managerDisplayName.trim(),
      temporaryPassword: managerPassword,
    });
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {isManager && detailContractor && detailContractor.siteId === activeSiteId && (
        <ManagerContractorDetails
          key={`${detailContractor.siteId}-${detailContractor.contractorId}`}
          apiUrl={apiUrl}
          siteId={detailContractor.siteId}
          contractorId={detailContractor.contractorId}
          onClose={() => setDetailContractor(null)}
        />
      )}
      {/* 1. Header & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                {isAdmin ? tr('common.administration') : tr('integrated_ui.site_operations')}
              </span>
              <span className="text-slate-300">•</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                {isAdmin ? tr('common.workspace_setup') : tr('siteOps.titleManage')}
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[#041D2E]">
              {isAdmin ? tr('common.site_setup') : tr('site_setup_view.contractor_zone_setup')}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              sitesQuery.refetch();
              if (isManager && activeSiteId) contractorsQuery.refetch();
              usersQuery.refetch();
              if (isManager && activeSiteId) representativeAssignmentsQuery.refetch();
            }}
            disabled={sitesQuery.isFetching || contractorsQuery.isFetching}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
            title={tr('site_setup_view.refresh_sites_and_contractors_data')}
          >
            <IconRefreshCw
              className={`w-3.5 h-3.5 text-slate-500 ${sitesQuery.isFetching ? 'animate-spin' : ''}`}
            />
            <span>{tr('common.refresh')}</span>
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setSiteError(null);
                setSiteName('');
                setSiteCode('');
                setShowCreateSiteModal(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#041D2E] text-white text-xs font-bold hover:bg-[#072A42] transition-all cursor-pointer shadow-xs active:scale-[0.98]"
            >
              <IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />
              <span>{tr('common.new_site')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Success Notification Banners & Participation Directory */}
      {isManager && (
        <SiteOperationsSetupView
          apiUrl={apiUrl}
          participationOnly
          siteId={activeSiteId ?? undefined}
        />
      )}
      {isAdmin && <ContractorParticipationDirectory apiUrl={apiUrl} />}
      {(sitesQuery.isError ||
        usersQuery.isError ||
        contractorsQuery.isError ||
        representativeAssignmentsQuery.isError) && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs"
        >
          {tr(
            'site_setup_view.could_not_load_complete_site_setup_data_use_refresh_to_try_again_manager_readiness',
          )}
        </div>
      )}
      {repSuccessMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5 font-medium">
            <IconCheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{localizeMessage(repSuccessMsg)}</span>
          </div>
          <button
            type="button"
            onClick={() => setRepSuccessMsg(null)}
            className="text-emerald-600 hover:text-emerald-900 cursor-pointer"
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>
      )}

      {managerSuccessMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5 font-medium">
            <IconCheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{localizeMessage(managerSuccessMsg)}</span>
          </div>
          <button
            type="button"
            onClick={() => setManagerSuccessMsg(null)}
            className="text-emerald-600 hover:text-emerald-900 cursor-pointer"
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. Top Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {/* Total Sites */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-2xs hover:shadow-xs transition-shadow flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {tr('common.total_sites')}
            </span>
            <p className="text-2xl font-black tracking-tight text-[#041D2E]">{sites.length}</p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-orange-50 border border-orange-200/60 flex items-center justify-center text-[#F66B17] shrink-0">
            <IconBuilding className="w-4.5 h-4.5" />
          </div>
        </div>

        {/* Contractors / Managers */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-2xs hover:shadow-xs transition-shadow flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {isAdmin ? tr('common.site_managers') : tr('common.contractors_on_site')}
            </span>
            <p className="text-2xl font-black tracking-tight text-[#041D2E]">
              {isAdmin ? (
                usersQuery.isPending ? (
                  <span className="text-slate-300 text-lg">—</span>
                ) : (
                  siteManagers.length
                )
              ) : contractorsQuery.isPending ? (
                <span className="text-slate-300 text-lg">—</span>
              ) : (
                contractors.length
              )}
            </p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-orange-50 border border-orange-200/60 flex items-center justify-center text-[#F66B17] shrink-0">
            <IconBuilding2 className="w-4.5 h-4.5" />
          </div>
        </div>

        {/* Representatives / Manager Status */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-2xs hover:shadow-xs transition-shadow flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {isAdmin ? tr('common.manager_status') : tr('common.representatives')}
            </span>
            <p className="text-2xl font-black tracking-tight text-[#041D2E]">
              {usersQuery.isPending ? (
                <span className="text-slate-300 text-lg">—</span>
              ) : isAdmin ? (
                usersQuery.isError ? (
                  <span className="text-rose-500 text-sm font-bold">
                    {tr('common.unavailable')}
                  </span>
                ) : readySiteManagers.length ? (
                  <span className="text-emerald-600 text-sm font-bold">{tr('common.ready')}</span>
                ) : (
                  <span className="text-amber-600 text-sm font-bold">{tr('common.not_ready')}</span>
                )
              ) : (
                siteRepresentatives.length
              )}
            </p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-200/60 flex items-center justify-center text-blue-600 shrink-0">
            <IconUsers className="w-4.5 h-4.5" />
          </div>
        </div>
      </div>

      {/* 3. Main Master-Detail Hub */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Sites Navigator (4 cols) */}
        <div className="lg:col-span-4 rounded-2xl border border-slate-200/90 bg-white shadow-xs overflow-hidden flex flex-col">
          {/* Nav header */}
          <div className="p-3.5 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold tracking-wider text-slate-800 uppercase">
                {tr('common.sites')}
              </h2>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-700">
                {sites.length}
              </span>
            </div>
          </div>

          {/* Search input */}
          <div className="p-2.5 border-b border-slate-100 bg-white">
            <div className="relative">
              <IconSearch className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={siteSearchQuery}
                onChange={(e) => setSiteSearchQuery(e.target.value)}
                placeholder={tr('site_setup_view.search_site_name_or_code')}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:bg-white transition-colors"
              />
              {siteSearchQuery && (
                <button
                  type="button"
                  onClick={() => setSiteSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                >
                  <IconX className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Sites list on white background */}
          <div className="bg-white flex-1 p-2 space-y-1 max-h-[520px] overflow-y-auto custom-scrollbar">
            {sitesQuery.isLoading ? (
              <div className="py-10 space-y-2 px-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton h-10 rounded-xl" />
                ))}
              </div>
            ) : filteredSites.length === 0 ? (
              <div className="py-10 px-4 text-center space-y-2">
                <p className="text-xs text-slate-500">
                  {tr('site_setup_view.no_sites_match_your_filter')}
                </p>
                {siteSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setSiteSearchQuery('')}
                    className="text-xs font-bold text-[#F66B17] hover:underline cursor-pointer"
                  >
                    {tr('common.clear_search')}
                  </button>
                )}
              </div>
            ) : (
              filteredSites.map((site) => {
                const isSelected = site.id === activeSiteId;
                const initials = site.name.substring(0, 2).toUpperCase();
                return (
                  <button
                    key={site.id}
                    type="button"
                    onClick={() => {
                      setSelectedSiteId(site.id);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150 flex items-center gap-3 cursor-pointer group ${
                      isSelected
                        ? 'bg-[#041D2E] text-white shadow-xs'
                        : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    {/* Avatar initial badge */}
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0 ${
                        isSelected ? 'bg-[#F66B17] text-white' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {initials}
                    </div>

                    <div className="min-w-0 flex-1">
                      <h3
                        className={`text-xs font-bold truncate ${
                          isSelected ? 'text-white' : 'text-slate-900'
                        }`}
                      >
                        {site.name}
                      </h3>
                      <span
                        className={`text-[9px] font-mono tracking-wider ${
                          isSelected ? 'text-white/50' : 'text-slate-400'
                        }`}
                      >
                        {site.code}
                      </span>
                    </div>

                    {isSelected ? (
                      <div className="w-1.5 h-1.5 rounded-full bg-[#F66B17] shrink-0" />
                    ) : (
                      <IconChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Site Hub & Operations (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          {!selectedSite ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3 shadow-xs">
              <div className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-100 mx-auto flex items-center justify-center text-slate-400">
                <IconBuilding2 className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">{tr('common.no_site_selected')}</h3>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                {tr(
                  'site_setup_view.select_a_site_from_the_left_navigation_or_click_quot_new_site_quot_to_create_one',
                )}
              </p>
            </div>
          ) : (
            <>
              {/* Site Header Banner */}
              <div className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 shadow-xs space-y-4">
                <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-4 items-center pb-4 border-b border-slate-100">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#041D2E] text-white flex items-center justify-center shrink-0 shadow-xs">
                        <IconBuilding2 className="w-5 h-5 text-[#F66B17]" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200 tracking-wider">
                            {selectedSite.code}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-emerald-600">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            {tr('common.active_site_c51689')}
                          </span>
                        </div>
                        <h2 className="text-lg font-extrabold text-[#041D2E] truncate tracking-tight">
                          {selectedSite.name}
                        </h2>
                      </div>
                    </div>

                    <div
                      className={`mt-3 inline-flex max-w-full items-center gap-2.5 rounded-xl border px-3 py-2 ${
                        managersLoaded && readySiteManagers.length > 0
                          ? 'border-emerald-100 bg-emerald-50/70'
                          : 'border-amber-100 bg-amber-50/70'
                      }`}
                    >
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                          managersLoaded && readySiteManagers.length > 0
                            ? 'bg-white text-emerald-600'
                            : 'bg-white text-amber-600'
                        }`}
                      >
                        <IconShield className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 leading-tight">
                        <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">
                          {tr('common.site_manager')}
                        </div>
                        {!managersLoaded ? (
                          <div className="text-xs font-bold text-amber-700">
                            {usersQuery.isError
                              ? tr('common.account_data_unavailable')
                              : tr('common.loading_accounts')}
                          </div>
                        ) : siteManagers.length > 0 ? (
                          <div className="text-xs font-bold text-slate-800 truncate">
                            {siteManagers
                              .map(
                                (manager) =>
                                  `${manager.displayName || `@${manager.username}`} (${!manager.isActive ? tr('common.disabled') : manager.mustChangePassword ? tr('common.password_change_required') : tr('common.ready_to_approve')})`,
                              )
                              .join(', ')}
                          </div>
                        ) : (
                          <div className="text-xs font-bold text-amber-700">
                            {tr('common.not_assigned_yet')}
                          </div>
                        )}
                      </div>
                      <span
                        className={`ml-1 w-2 h-2 rounded-full shrink-0 ${
                          managersLoaded && readySiteManagers.length > 0
                            ? 'bg-emerald-500'
                            : 'bg-amber-500'
                        }`}
                        aria-hidden="true"
                      />
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex flex-wrap items-center justify-start xl:justify-end gap-2">
                    {isAdmin && (
                      <button
                        type="button"
                        disabled={!managersLoaded}
                        onClick={openAssignSiteManagerModal}
                        className="inline-flex items-center gap-1.5 min-h-10 px-3.5 rounded-xl border border-orange-200 bg-orange-50 text-xs font-bold text-[#C6530E] hover:bg-orange-100 hover:border-orange-300 transition-colors cursor-pointer active:scale-[0.98]"
                      >
                        <IconShield className="w-3.5 h-3.5" />
                        <span>
                          {siteManagers.length === 0
                            ? tr('common.assign_site_manager')
                            : tr('common.manage_site_managers')}
                        </span>
                      </button>
                    )}

                    {isManager && (
                      <button
                        type="button"
                        onClick={() => openRepModalForContractor('')}
                        className="inline-flex items-center gap-1.5 min-h-10 px-3.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        title={tr('site_setup_view.create_contractor_representative_login')}
                      >
                        <IconUser className="w-3.5 h-3.5 text-slate-600" />
                        <span>{tr('common.create_representative')}</span>
                      </button>
                    )}
                    {isManager && (
                      <>
                        <button
                          type="button"
                          onClick={() => setActiveTab('zones')}
                          className="inline-flex items-center gap-1.5 min-h-10 px-3.5 rounded-xl border border-orange-200 bg-orange-50 text-xs font-bold text-[#C6530E]"
                        >
                          <IconPlus className="w-3.5 h-3.5" />
                          {tr('common.new_zone')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab('zone-assignments')}
                          className="inline-flex items-center gap-1.5 min-h-10 px-3.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800"
                        >
                          <IconShield className="w-3.5 h-3.5" />
                          {tr('common.assign_zone')}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isManager && (
                  <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
                    {/* Pill-island tab track */}
                    <div className="flex flex-wrap items-center gap-1 rounded-full bg-slate-100 p-1 border border-slate-200/50">
                      <button
                        type="button"
                        onClick={() => setActiveTab('contractors')}
                        className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all duration-200 cursor-pointer ${
                          activeTab === 'contractors'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <IconBuilding2 className="w-3.5 h-3.5 text-[#F66B17]" />
                        <span>
                          {tr('common.contractors_value', { value1: contractors.length })}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveTab('representatives')}
                        className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all duration-200 cursor-pointer ${
                          activeTab === 'representatives'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <IconUsers className="w-3.5 h-3.5 text-blue-600" />
                        <span>
                          {tr('common.representatives_value', {
                            value1: siteRepresentatives.length,
                          })}
                        </span>
                      </button>

                      {(['zones', 'zone-assignments'] as const).map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          aria-pressed={activeTab === tab}
                          onClick={() => setActiveTab(tab)}
                          className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all duration-200 cursor-pointer ${
                            activeTab === tab
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          <IconShield className="w-3.5 h-3.5 text-[#F66B17]" />
                          <span>
                            {tab === 'zones'
                              ? tr('common.zones')
                              : tr('common.contractor_zone_assignments')}
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* Inline contractor search */}
                    {activeTab === 'contractors' && contractors.length > 3 && (
                      <div className="w-44 relative hidden sm:block">
                        <IconSearch className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={contractorSearchQuery}
                          onChange={(e) => setContractorSearchQuery(e.target.value)}
                          placeholder={tr('common.filter_contractors')}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1 text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:bg-white transition-all duration-200"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {isManager && activeSiteId && accessToken && currentUser && activeTab === 'zones' && (
                <SiteZoneSetup
                  key={activeSiteId}
                  apiUrl={apiUrl}
                  token={accessToken}
                  siteId={activeSiteId}
                  userId={currentUser.id}
                />
              )}
              {isManager &&
                activeSiteId &&
                accessToken &&
                currentUser &&
                activeTab === 'zone-assignments' && (
                  <ContractorZoneSetup
                    key={activeSiteId}
                    apiUrl={apiUrl}
                    token={accessToken}
                    siteId={activeSiteId}
                    userId={currentUser.id}
                  />
                )}

              {/* TAB 1: Contractors List Table */}
              {isManager && activeTab === 'contractors' && (
                <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
                  {contractorsQuery.isLoading ? (
                    <div className="py-16 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
                      <IconLoader className="w-5 h-5 animate-spin text-slate-500" />
                      <span>{tr('common.loading_contractors_8c3d92')}</span>
                    </div>
                  ) : contractors.length === 0 ? (
                    <div className="p-5 sm:p-7 bg-slate-50/50">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4 max-w-2xl">
                        <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                          <IconBuilding2 className="w-6 h-6" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-bold text-slate-900">
                              {tr('common.no_subcontractors_registered')}
                            </h3>
                            <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-amber-700 bg-amber-100/80 px-2 py-1 rounded-md">
                              {tr('common.setup_required')}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 max-w-xl mt-1 leading-relaxed">
                            {tr(
                              'site_setup_view.register_a_contractor_for_this_site_before_adding_representatives_or_assigning_wor',
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 space-y-2.5">
                      {/* Card-row list — replaces the flat table */}
                      {filteredContractors.map((contractor) => {
                        const linkedRepresentativeIds = getContractorRepresentativeUserIds(
                          representativeAssignments,
                          contractor.id,
                        );
                        const linkedRepresentatives = siteRepresentatives.filter((representative) =>
                          linkedRepresentativeIds.includes(representative.id),
                        );
                        const hasReps = linkedRepresentativeIds.length > 0;
                        return (
                          <div
                            key={contractor.id}
                            className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs hover:shadow-xs hover:border-slate-300 transition-all"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              {/* Left: contractor info */}
                              <div className="flex items-center gap-3 min-w-0">
                                {/* Avatar initial */}
                                <div className="w-9 h-9 rounded-xl bg-[#041D2E] text-white flex items-center justify-center text-[11px] font-black shrink-0">
                                  {contractor.name.substring(0, 2).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-bold text-slate-900 truncate">
                                    {contractor.name}
                                  </p>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    {/* Created date */}
                                    <span className="text-[10px] text-slate-400">
                                      {new Date(contractor.createdAt).toLocaleDateString(
                                        uiLocale(),
                                      )}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Right: rep info + actions */}
                              <div className="flex items-center gap-3 flex-wrap shrink-0">
                                {/* Representatives */}
                                {representativeAssignmentsQuery.isLoading ? (
                                  <div className="skeleton h-5 w-20 rounded" />
                                ) : hasReps ? (
                                  <div className="text-right">
                                    {linkedRepresentatives.length > 0
                                      ? linkedRepresentatives.map((rep) => (
                                          <div key={rep.id} className="text-right">
                                            <p className="text-xs font-semibold text-slate-800">
                                              {rep.displayName}
                                            </p>
                                            <p className="text-[10px] font-mono text-slate-400">
                                              @{rep.username}
                                            </p>
                                          </div>
                                        ))
                                      : null}
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                      {tr('common.assigned')}
                                    </span>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => openAssignExistingRepModal(contractor.id)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#F66B17]/30 text-[#F66B17] text-[11px] font-semibold hover:bg-orange-50 hover:border-[#F66B17]/60 transition-all duration-200 cursor-pointer"
                                  >
                                    <IconPlus className="w-3 h-3" />
                                    <span>{tr('common.assign_existing_rep')}</span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  className="rounded-lg border px-3 py-2 text-xs font-semibold"
                                  onClick={() => {
                                    renameProfile.reset();
                                    setEditProfile({
                                      kind: 'contractor',
                                      id: contractor.id,
                                      name: contractor.name,
                                      expectedName: contractor.name,
                                    });
                                  }}
                                >
                                  {tr('contractor_profile.edit_contractor')}
                                </button>
                                {/* View Details */}
                                {isManager && (
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#041D2E] text-white text-[11px] font-bold hover:bg-[#072A42] transition-all duration-200 cursor-pointer active:scale-[0.97]"
                                    onClick={() =>
                                      setDetailContractor({
                                        siteId: activeSiteId!,
                                        contractorId: contractor.id,
                                      })
                                    }
                                  >
                                    <span>{tr('common.view_details_90789c')}</span>
                                    <IconChevronRight className="w-3 h-3 text-[#F66B17]" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: Representatives Directory */}
              {isManager && activeTab === 'representatives' && (
                <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
                  {usersQuery.isLoading ? (
                    <div className="py-16 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
                      <IconLoader className="w-5 h-5 animate-spin text-slate-500" />
                      <span>{tr('common.loading_representative_accounts')}</span>
                    </div>
                  ) : siteRepresentatives.length === 0 ? (
                    <div className="py-14 px-4 text-center space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 mx-auto flex items-center justify-center text-blue-600">
                        <IconUsers className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">
                          {tr('common.no_representatives_found')}
                        </h3>
                        <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                          {tr(
                            'site_setup_view.no_contractor_representative_accounts_are_linked_to_this_site_yet',
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openRepModalForContractor('')}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#041D2E] text-white text-xs font-bold hover:bg-[#072A42] transition-all cursor-pointer shadow-xs disabled:opacity-50"
                      >
                        <IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />
                        <span>{tr('common.create_representative')}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="p-4 space-y-2.5">
                      {/* Card-row list — replaces flat table */}
                      {siteRepresentatives.map((rep) => {
                        const linkedContractors = representativeAssignments
                          .filter((assignment) => assignment.userId === rep.id)
                          .map((assignment) =>
                            contractors.find(
                              (contractor) => contractor.id === assignment.contractorId,
                            ),
                          )
                          .filter((contractor): contractor is (typeof contractors)[number] =>
                            Boolean(contractor),
                          );
                        return (
                          <div
                            key={rep.id}
                            className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs hover:shadow-xs hover:border-slate-300 transition-all"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              {/* Left: Rep info */}
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-700 ring-1 ring-blue-200/50 flex items-center justify-center text-xs font-black shrink-0 uppercase">
                                  {rep.displayName.charAt(0) || 'R'}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-sm font-bold text-slate-900 truncate">
                                      {rep.displayName}
                                    </p>
                                    <span className="font-mono text-xs text-slate-400">
                                      @{rep.username}
                                    </span>
                                  </div>
                                  {/* Linked contractors */}
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    {linkedContractors.length > 0 ? (
                                      linkedContractors.map((c) => (
                                        <span
                                          key={c.id}
                                          className="inline-flex items-center gap-1 font-mono text-[9px] font-bold bg-slate-100 border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md"
                                        >
                                          <span>{c.name}</span>
                                        </span>
                                      ))
                                    ) : (
                                      <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/60">
                                        {tr('common.not_linked')}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Right: Role & Status */}
                              <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
                                <button
                                  type="button"
                                  className="rounded-lg border px-3 py-2 text-xs font-semibold"
                                  onClick={() => {
                                    renameProfile.reset();
                                    setEditProfile({
                                      kind: 'representative',
                                      id: rep.id,
                                      name: rep.displayName,
                                      expectedName: rep.displayName,
                                    });
                                  }}
                                >
                                  {tr('contractor_profile.edit_representative')}
                                </button>
                                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700">
                                  {tr('common.contractor_representative')}
                                </span>
                                <span
                                  className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full ${
                                    rep.isActive
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                      : 'bg-slate-100 text-slate-600 border border-slate-200'
                                  }`}
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${rep.isActive ? 'bg-emerald-500' : 'bg-slate-400'}`}
                                  />
                                  {rep.isActive
                                    ? tr('common.active')
                                    : tr('common.inactive_ac7c94')}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── MODAL 1: Assign Site Manager Modal ───────────────────────────────── */}
      {showAssignManagerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071A2B]/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#071A2B] text-white flex items-center justify-center">
                  <IconShield className="w-4 h-4 text-[#F66B17]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {tr('common.assign_site_manager')}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {tr('site_setup_view.assign_an_existing_account_to_value', {
                      value1: selectedSite?.name,
                    })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAssignManagerModal(false)}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAssignSiteManagerSubmit} className="space-y-4">
              {managerError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs">
                  <IconAlertCircle className="w-4 h-4 shrink-0" />
                  <span>{localizedError(managerError ?? undefined)}</span>
                </div>
              )}

              {siteManagers.length > 0 ? (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs leading-relaxed">
                  {tr('common.assigned_site_managers')}{' '}
                  <span className="font-bold">
                    {siteManagers
                      .map(
                        (manager) =>
                          `${manager.displayName || `@${manager.username}`} (${!manager.isActive ? tr('common.disabled') : manager.mustChangePassword ? tr('common.password_change_required') : tr('common.ready_to_approve')})`,
                      )
                      .join(', ')}
                  </span>
                  {siteManagers.map((manager) => (
                    <div key={manager.id} className="mt-3">
                      {revokeManagerId === manager.id ? (
                        <div className="space-y-2">
                          <p>
                            {tr('site_setup_view.revoke_manager_confirm', {
                              name: manager.displayName || manager.username,
                              site: selectedSite?.name,
                            })}
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="rounded-lg bg-rose-700 px-3 py-2 font-bold text-white disabled:opacity-50"
                              disabled={revokeSiteManagerMutation.isPending}
                              onClick={() =>
                                activeSiteId &&
                                revokeSiteManagerMutation.mutate({
                                  userId: manager.id,
                                  siteId: activeSiteId,
                                })
                              }
                            >
                              {tr('site_setup_view.confirm_revoke')}
                            </button>
                            <button
                              type="button"
                              className="rounded-lg border border-amber-300 px-3 py-2 font-bold"
                              disabled={revokeSiteManagerMutation.isPending}
                              onClick={() => setRevokeManagerId(null)}
                            >
                              {tr('common.cancel')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="rounded-lg border border-rose-300 bg-white px-3 py-2 font-bold text-rose-700 hover:bg-rose-50"
                          onClick={() => setRevokeManagerId(manager.id)}
                        >
                          {tr('site_setup_view.revoke_manager')}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
              {assignableSiteManagers.length > 0 ? (
                <SmartSelect
                  id="site-manager-select"
                  label={tr('common.site_manager_account')}
                  fieldRequired
                  placeholder={tr('site_setup_view.select_an_existing_site_manager')}
                  value={selectedManagerId}
                  onChange={setSelectedManagerId}
                  searchable
                  searchPlaceholder={tr('common.search_account')}
                  options={assignableSiteManagers.map((manager) => ({
                    value: manager.id,
                    label: manager.displayName,
                    badge: `@${manager.username}`,
                  }))}
                />
              ) : (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs leading-relaxed">
                  {tr('site_setup_view.no_active_account_with_the')}{' '}
                  <span className="font-bold">{tr('common.site_manager_ada41a')}</span>{' '}
                  {tr('site_setup_view.role_is_available_for_this_site')}
                </div>
              )}

              <button
                type="button"
                onClick={openCreateSiteManagerModal}
                disabled={siteManagers.length > 0}
                className="w-full px-3 py-2.5 rounded-xl border border-dashed border-[#F66B17]/50 bg-orange-50/50 text-xs font-bold text-[#C6530E] hover:bg-orange-50 transition-colors cursor-pointer"
              >
                {tr('site_setup_view.create_new_site_manager')}
              </button>

              <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 text-blue-800 text-xs leading-relaxed">
                {tr(
                  'site_setup_view.existing_role_assignments_for_this_account_will_be_preserved_the_site_manager_role',
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAssignManagerModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  {tr('common.cancel')}
                </button>

                <button
                  type="submit"
                  disabled={
                    siteManagers.length > 0 ||
                    assignSiteManagerMutation.isPending ||
                    assignableSiteManagers.length === 0 ||
                    !selectedManagerId
                  }
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#071A2B] text-white text-xs font-bold hover:bg-[#0E2841] transition-all cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {assignSiteManagerMutation.isPending ? (
                    <IconLoader className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <IconShield className="w-3.5 h-3.5 text-[#F66B17]" />
                  )}
                  <span>
                    {assignSiteManagerMutation.isPending
                      ? tr('common.assigning_085b87')
                      : tr('common.assign_site_manager')}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL 2: Create Site Manager Modal ──────────────────────────────── */}
      {showCreateManagerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071A2B]/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#071A2B] text-white flex items-center justify-center">
                  <IconShield className="w-4 h-4 text-[#F66B17]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {tr('common.create_site_manager')}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {tr('site_setup_view.create_a_site_manager_account_for_value', {
                      value1: selectedSite?.name,
                    })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateManagerModal(false)}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSiteManagerSubmit} className="space-y-4">
              {createManagerError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs">
                  <IconAlertCircle className="w-4 h-4 shrink-0" />
                  <span>{localizedError(createManagerError ?? undefined)}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label
                    htmlFor="site-manager-username-input"
                    className="block text-xs font-bold text-slate-700"
                  >
                    {tr('common.username')} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="site-manager-username-input"
                    type="text"
                    required
                    placeholder={tr('common.e_g_manager_site_a')}
                    value={managerUsername}
                    onChange={(e) => setManagerUsername(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="site-manager-displayname-input"
                    className="block text-xs font-bold text-slate-700"
                  >
                    {tr('common.display_name_18d67c')} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="site-manager-displayname-input"
                    type="text"
                    required
                    placeholder={tr('site_setup_view.e_g_nguyen_van_a')}
                    value={managerDisplayName}
                    onChange={(e) => setManagerDisplayName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="site-manager-password-input"
                  className="block text-xs font-bold text-slate-700"
                >
                  {tr('common.temporary_password')} <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    id="site-manager-password-input"
                    type={showManagerPassword ? 'text' : 'password'}
                    required
                    placeholder={tr('site_setup_view.must_meet_policy_min_8_chars_aa1')}
                    value={managerPassword}
                    onChange={(e) => setManagerPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 pr-16 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowManagerPassword(!showManagerPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showManagerPassword ? tr('common.hide') : tr('common.show')}
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 text-blue-800 text-xs leading-relaxed">
                {tr('site_setup_view.this_account_will_be_created_with_the')}{' '}
                <span className="font-bold">{tr('common.site_manager_ada41a')}</span>{' '}
                {tr('site_setup_view.role_for_this_site')}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateManagerModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  {tr('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={createSiteManagerMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#071A2B] text-white text-xs font-bold hover:bg-[#0E2841] transition-all cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {createSiteManagerMutation.isPending ? (
                    <IconLoader className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <IconShield className="w-3.5 h-3.5 text-[#F66B17]" />
                  )}
                  <span>
                    {createSiteManagerMutation.isPending
                      ? tr('common.creating_def709')
                      : tr('common.create_site_manager')}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL 3: Create Site Modal ───────────────────────────────────────── */}
      {showCreateSiteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071A2B]/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#071A2B] text-white flex items-center justify-center">
                  <IconBuilding className="w-4 h-4 text-[#F66B17]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {tr('common.create_new_site')}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {tr('site_setup_view.add_a_new_project_site_to_the_organization')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateSiteModal(false)}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSiteSubmit} className="space-y-4">
              {siteError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs">
                  <IconAlertCircle className="w-4 h-4 shrink-0" />
                  <span>{localizedError(siteError ?? undefined)}</span>
                </div>
              )}

              <div className="space-y-1">
                <label htmlFor="site-name-input" className="block text-xs font-bold text-slate-700">
                  {tr('common.site_name')} <span className="text-rose-500">*</span>
                </label>
                <input
                  id="site-name-input"
                  type="text"
                  required
                  placeholder={tr('site_setup_view.e_g_landmark_81_tower_phase_2')}
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="site-code-input" className="block text-xs font-bold text-slate-700">
                  {tr('common.site_code')}{' '}
                  <span className="text-slate-400 font-normal">
                    {tr('site_setup_view.optional_auto_generated_if_blank')}
                  </span>
                </label>
                <input
                  id="site-code-input"
                  type="text"
                  placeholder={tr('common.e_g_lm81_p2')}
                  value={siteCode}
                  onChange={(e) => setSiteCode(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-mono text-slate-900 placeholder:text-slate-400 uppercase outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateSiteModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  {tr('common.cancel')}
                </button>

                <button
                  type="submit"
                  disabled={createSiteMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#071A2B] text-white text-xs font-bold hover:bg-[#0E2841] transition-all cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {createSiteMutation.isPending ? (
                    <IconLoader className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />
                  )}
                  <span>
                    {createSiteMutation.isPending
                      ? tr('common.creating_def709')
                      : tr('common.create_site')}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL 5: Assign Existing Representative Modal ───────────────────── */}
      {showAssignRepModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071A2B]/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#071A2B] text-white flex items-center justify-center">
                  <IconUsers className="w-4 h-4 text-[#F66B17]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {tr('common.assign_existing_representative')}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {tr(
                      'site_setup_view.link_an_existing_representative_account_to_a_contractor_on_value',
                      { value1: selectedSite?.name },
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAssignRepModal(false)}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAssignExistingRepSubmit} className="space-y-4">
              {assignRepError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs">
                  <IconAlertCircle className="w-4 h-4 shrink-0" />
                  <span>{localizedError(assignRepError ?? undefined)}</span>
                </div>
              )}

              <SmartSelect
                id="existing-rep-contractor-select"
                label={tr('common.target_contractor')}
                fieldRequired
                value={assignRepContractorId}
                onChange={(value) => {
                  setAssignRepContractorId(value);
                  setExistingRepId('');
                }}
                options={contractors.map((contractor) => ({
                  value: contractor.id,
                  label: contractor.name,
                }))}
              />

              {assignableRepresentatives.length > 0 ? (
                <SmartSelect
                  id="existing-representative-select"
                  label={tr('common.representative_account')}
                  fieldRequired
                  placeholder={tr('site_setup_view.select_an_existing_representative')}
                  value={existingRepId}
                  onChange={setExistingRepId}
                  searchable
                  searchPlaceholder={tr('common.search_representative')}
                  options={assignableRepresentatives.map((representative) => ({
                    value: representative.id,
                    label: representative.displayName,
                    badge: `@${representative.username}`,
                  }))}
                />
              ) : (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs leading-relaxed">
                  {tr(
                    'site_setup_view.no_eligible_active_representative_account_is_available_for_this_contractor_create',
                  )}
                  <span className="font-bold">{tr('common.create_representative')}</span>{' '}
                  {tr('site_setup_view.first_or_choose_another_contractor')}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAssignRepModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  {tr('common.cancel')}
                </button>

                <button
                  type="submit"
                  disabled={
                    assignExistingRepresentativeMutation.isPending ||
                    assignableRepresentatives.length === 0
                  }
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#071A2B] text-white text-xs font-bold hover:bg-[#0E2841] transition-all cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {assignExistingRepresentativeMutation.isPending ? (
                    <IconLoader className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <IconUsers className="w-3.5 h-3.5 text-[#F66B17]" />
                  )}
                  <span>
                    {assignExistingRepresentativeMutation.isPending
                      ? tr('common.assigning_085b87')
                      : tr('common.assign_representative')}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL 6: Create Representative Modal ────────────────────────────── */}
      {editProfile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !renameProfile.isPending) setEditProfile(null);
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-profile-title"
            className="w-full max-w-lg rounded-2xl bg-white p-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              renameProfile.mutate(editProfile);
            }}
          >
            <h3 id="edit-profile-title" className="font-bold">
              {tr(
                editProfile.kind === 'contractor'
                  ? 'contractor_profile.edit_contractor'
                  : 'contractor_profile.edit_representative',
              )}
            </h3>
            <label className="grid gap-2 text-sm">
              {tr(
                editProfile.kind === 'contractor'
                  ? 'contractor_profile.contractor_name'
                  : 'common.display_name_18d67c',
              )}
              <input
                autoFocus
                required
                maxLength={255}
                className="rounded-lg border p-2"
                value={editProfile.name}
                onChange={(event) => setEditProfile({ ...editProfile, name: event.target.value })}
              />
            </label>
            {renameProfile.error && (
              <p role="alert" className="text-sm text-red-700">
                {userErrorMessage(renameProfile.error)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={renameProfile.isPending}
                className="rounded-lg border px-4 py-2"
                onClick={() => setEditProfile(null)}
              >
                {tr('common.cancel')}
              </button>
              <button
                disabled={renameProfile.isPending || !editProfile.name.trim()}
                className="rounded-lg bg-[#041D2E] px-4 py-2 text-white"
              >
                {tr('contractor_profile.save')}
              </button>
            </div>
          </form>
        </div>
      )}
      {showCreateRepModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071A2B]/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#071A2B] text-white flex items-center justify-center">
                  <IconUser className="w-4 h-4 text-[#F66B17]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {tr('common.create_contractor_representative')}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {tr('site_setup_view.provision_login_and_link_to_contractor_on_value', {
                      value1: selectedSite?.name,
                    })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateRepModal(false)}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleCreateRepSubmit}
              className="space-y-4 max-h-[75vh] overflow-y-auto"
            >
              {repError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs">
                  <IconAlertCircle className="w-4 h-4 shrink-0" />
                  <span>{localizedError(repError ?? undefined)}</span>
                </div>
              )}

              {/* Contractor Select */}
              <div className="space-y-1">
                <SmartSelect
                  id="rep-contractor-select"
                  label={tr('common.target_contractor')}
                  fieldRequired
                  value={repContractorId || preselectedContractorId || contractors[0]?.id || ''}
                  onChange={setRepContractorId}
                  options={[
                    { value: '__new__', label: tr('contractor_profile.new_contractor') },
                    ...contractors.map((c) => ({
                      value: c.id,
                      label: c.name,
                    })),
                  ]}
                />
              </div>

              {repContractorId === '__new__' && (
                <fieldset
                  disabled={createRepresentativeMutation.isPending}
                  className="rounded-xl border bg-slate-50 p-3 space-y-3"
                >
                  <legend className="text-xs font-bold">
                    {tr('contractor_profile.new_contractor')}
                  </legend>
                  <label className="grid gap-1 text-xs font-semibold">
                    {tr('contractor_profile.contractor_name')}
                    <input
                      required
                      maxLength={255}
                      className="rounded-lg border bg-white p-2"
                      value={repNewContractorName}
                      onChange={(event) => setRepNewContractorName(event.target.value)}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="grid gap-1 text-xs font-semibold">
                      {tr('contractor_profile.start_date')}
                      <input
                        required
                        type="date"
                        max={new Date().toLocaleDateString('en-CA')}
                        className="rounded-lg border bg-white p-2"
                        value={repStartDate}
                        onChange={(event) => setRepStartDate(event.target.value)}
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold">
                      {tr('contractor_profile.end_date')}
                      <input
                        type="date"
                        min={repStartDate}
                        className="rounded-lg border bg-white p-2"
                        value={repEndDate}
                        onChange={(event) => setRepEndDate(event.target.value)}
                      />
                    </label>
                  </div>
                  <p className="text-xs text-slate-600">
                    {tr('contractor_profile.active_interval')}
                  </p>
                </fieldset>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label
                    htmlFor="rep-username-input"
                    className="block text-xs font-bold text-slate-700"
                  >
                    {tr('common.username')} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="rep-username-input"
                    type="text"
                    required
                    placeholder={tr('common.e_g_rep_vinaconex')}
                    value={repUsername}
                    onChange={(e) => setRepUsername(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="rep-displayname-input"
                    className="block text-xs font-bold text-slate-700"
                  >
                    {tr('common.display_name_18d67c')} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="rep-displayname-input"
                    type="text"
                    required
                    placeholder={tr('site_setup_view.e_g_nguyen_van_a')}
                    value={repDisplayName}
                    onChange={(e) => setRepDisplayName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="rep-password-input"
                  className="block text-xs font-bold text-slate-700"
                >
                  {tr('common.temporary_password')} <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    id="rep-password-input"
                    type={showRepPassword ? 'text' : 'password'}
                    required
                    placeholder={tr('site_setup_view.must_meet_policy_min_8_chars_aa1')}
                    value={repPassword}
                    onChange={(e) => setRepPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 pr-16 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRepPassword(!showRepPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showRepPassword ? tr('common.hide') : tr('common.show')}
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-1">
                  <IconKey className="w-3 h-3" />
                  {tr(
                    'site_setup_view.user_will_be_prompted_to_update_this_password_upon_initial_login',
                  )}
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateRepModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  {tr('common.cancel')}
                </button>

                <button
                  type="submit"
                  disabled={createRepresentativeMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#071A2B] text-white text-xs font-bold hover:bg-[#0E2841] transition-all cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {createRepresentativeMutation.isPending ? (
                    <IconLoader className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <IconUser className="w-3.5 h-3.5 text-[#F66B17]" />
                  )}
                  <span>
                    {createRepresentativeMutation.isPending
                      ? tr('common.provisioning')
                      : tr('site_setup_view.create_assign_account')}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <ToastContainer>
          <Toast message={toast.message} type={toast.type} onClose={hideToast} />
        </ToastContainer>
      )}
    </div>
  );
}
