import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  ApiError,
} from '@smartsite/api-client';
import { useAuth, useCurrentUser } from '../../features/auth/auth-session';
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
} from '../icons';
import { SmartSelect } from '../ui';
import {
  addSiteManagerAssignment,
  getAssignableRepresentatives,
  getAssignableSiteManagers,
  getContractorRepresentativeUserIds,
  getSiteManagers,
  getReadySiteManagers,
} from './site-setup-helpers';
import { loadAllPages } from './load-all-pages';

interface SiteSetupViewProps {
  apiUrl: string;
}

export function SiteSetupView({ apiUrl }: SiteSetupViewProps) {
  const { accessToken } = useAuth();
  const { data: currentUser } = useCurrentUser(apiUrl);
  const queryClient = useQueryClient();
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);

  const isAdmin = currentUser?.roleAssignments.some((r) => r.role === 'ADMIN' && r.siteId === null) ?? false;

  // Navigation & Selection state
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'contractors' | 'representatives'>('contractors');
  const [siteSearchQuery, setSiteSearchQuery] = useState('');
  const [contractorSearchQuery, setContractorSearchQuery] = useState('');

  // Modal open states
  const [showCreateSiteModal, setShowCreateSiteModal] = useState(false);
  const [showCreateContractorModal, setShowCreateContractorModal] = useState(false);
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

  // Contractor Form State
  const [contractorCode, setContractorCode] = useState('');
  const [contractorName, setContractorName] = useState('');
  const [contractorError, setContractorError] = useState<string | null>(null);
  const [contractorSuccessMsg, setContractorSuccessMsg] = useState<string | null>(null);

  // Representative Form State
  const [repUsername, setRepUsername] = useState('');
  const [repDisplayName, setRepDisplayName] = useState('');
  const [repPassword, setRepPassword] = useState('');
  const [showRepPassword, setShowRepPassword] = useState(false);
  const [repContractorId, setRepContractorId] = useState('');
  const [repError, setRepError] = useState<string | null>(null);
  const [repSuccessMsg, setRepSuccessMsg] = useState<string | null>(null);
  const [existingRepId, setExistingRepId] = useState('');
  const [assignRepError, setAssignRepError] = useState<string | null>(null);
  const [managerError, setManagerError] = useState<string | null>(null);
  const [managerSuccessMsg, setManagerSuccessMsg] = useState<string | null>(null);
  const [managerUsername, setManagerUsername] = useState('');
  const [managerDisplayName, setManagerDisplayName] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [showManagerPassword, setShowManagerPassword] = useState(false);
  const [createManagerError, setCreateManagerError] = useState<string | null>(null);

  // ── Queries ─────────────────────────────────────────────────────────────────
  const sitesQuery = useQuery({
    queryKey: ['site-setup', apiUrl, currentUser?.id, 'sites'],
    queryFn: ({ signal }) => loadAllPages((options) => client.listSites(accessToken!, options), signal),
    enabled: Boolean(accessToken && isAdmin),
  });

  const sites = useMemo(() => sitesQuery.data?.items ?? [], [sitesQuery.data]);
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

  const contractorsQuery = useQuery({
    queryKey: [...setupKey, 'contractors', activeSiteId],
    queryFn: ({ signal }) => loadAllPages((options) => client.listContractors(accessToken!, activeSiteId!, options), signal),
    enabled: Boolean(accessToken && activeSiteId),
  });

  const contractors = useMemo(() => contractorsQuery.data?.items ?? [], [contractorsQuery.data]);

  const usersQuery = useQuery({
    queryKey: [...setupKey, 'users'],
    queryFn: ({ signal }) => loadAllPages((options) => client.listUsers(accessToken!, options), signal),
    enabled: Boolean(accessToken && isAdmin),
  });

  const representativeAssignmentsQuery = useQuery({
    queryKey: [...setupKey, 'contractor-representative-assignments', activeSiteId],
    queryFn: ({ signal }) => loadAllPages((options) => client.listContractorRepresentativeAssignments(accessToken!, activeSiteId!, options), signal),
    enabled: Boolean(accessToken && isAdmin && activeSiteId),
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
    () => (activeSiteId ? getSiteManagers(allUsers, activeSiteId) : []),
    [allUsers, activeSiteId],
  );

  const readySiteManagers = activeSiteId ? getReadySiteManagers(allUsers, activeSiteId) : [];
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
    mutationFn: (input: { code: string; name: string }) =>
      client.createSite(accessToken!, input),
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
        setSiteError(err.message);
      } else {
        setSiteError('Failed to create site. Please check input parameters.');
      }
    },
  });

  const createContractorMutation = useMutation({
    mutationFn: (input: { code: string; name: string }) =>
      client.createContractor(accessToken!, activeSiteId!, input),
    onSuccess: (newContractor) => {
      setContractorError(null);
      setContractorSuccessMsg(`Contractor "${newContractor.name}" (${newContractor.code}) created successfully.`);
      setContractorCode('');
      setContractorName('');
      setShowCreateContractorModal(false);
      queryClient.invalidateQueries({ queryKey: [...setupKey, 'contractors', activeSiteId] });
      setTimeout(() => setContractorSuccessMsg(null), 5000);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setContractorError(err.message);
      } else {
        setContractorError('Failed to create contractor. Please check inputs.');
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
      const user = await client.createUser(accessToken!, {
        username: input.username,
        displayName: input.displayName,
        temporaryPassword: input.temporaryPassword,
        roleAssignments: [
          { role: 'CONTRACTOR_REPRESENTATIVE', siteId: activeSiteId! },
        ],
      });
      await client.assignContractorRepresentative(accessToken!, activeSiteId!, input.contractorId, {
        userId: user.id,
      });
      return user;
    },
    onSuccess: (user) => {
      setRepError(null);
      setRepSuccessMsg(
        `Representative account "${user.username}" created and assigned successfully.`,
      );
      setRepUsername('');
      setRepDisplayName('');
      setRepPassword('');
      setRepContractorId('');
      setShowCreateRepModal(false);
      queryClient.invalidateQueries({ queryKey: [...setupKey, 'users'] });
      queryClient.invalidateQueries({
        queryKey: [...setupKey, 'contractor-representative-assignments', activeSiteId],
      });
      queryClient.invalidateQueries({ queryKey: [...setupKey, 'contractors', activeSiteId] });
      setTimeout(() => setRepSuccessMsg(null), 5000);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setRepError(err.message);
      } else {
        setRepError('Could not create the representative account. Verify password policy and inputs.');
      }
    },
  });

  const assignExistingRepresentativeMutation = useMutation({
    mutationFn: async (input: { contractorId: string; userId: string }) => {
      if (!activeSiteId) throw new Error('An active site must be selected.');
      return client.assignContractorRepresentative(accessToken!, activeSiteId, input.contractorId, {
        userId: input.userId,
      });
    },
    onSuccess: () => {
      const representative = siteRepresentatives.find((user) => user.id === existingRepId);
      setAssignRepError(null);
      setRepSuccessMsg(
        `Representative account "${representative?.username ?? 'selected account'}" assigned successfully.`,
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
        setAssignRepError(err.message);
      } else {
        setAssignRepError('Could not assign the representative account. Verify the account and contractor scope.');
      }
    },
  });

  const assignSiteManagerMutation = useMutation({
    mutationFn: async (input: { siteId: string; userId: string }) => {
      const user = allUsers.find((candidate) => candidate.id === input.userId);
      if (!user) throw new Error('The selected account could not be found. Refresh the page and try again.');

      return client.replaceUserRoleAssignments(
        accessToken!,
        input.userId,
        addSiteManagerAssignment(user.roleAssignments, input.siteId),
      );
    },
    onSuccess: (user) => {
      setManagerError(null);
      setManagerSuccessMsg(`Site Manager account "${user.username}" assigned successfully.`);
      setSelectedManagerId('');
      setShowAssignManagerModal(false);
      queryClient.invalidateQueries({ queryKey: [...setupKey, 'users'] });
      setTimeout(() => setManagerSuccessMsg(null), 5000);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setManagerError(err.message);
      } else if (err instanceof Error) {
        setManagerError(err.message);
      } else {
        setManagerError('Could not assign the Site Manager account. Refresh the page and try again.');
      }
    },
  });

  const createSiteManagerMutation = useMutation({
    mutationFn: async (input: {
      username: string;
      displayName: string;
      temporaryPassword: string;
    }) => {
      if (!activeSiteId) throw new Error('An active site must be selected.');

      return client.createUser(accessToken!, {
        username: input.username,
        displayName: input.displayName,
        temporaryPassword: input.temporaryPassword,
        roleAssignments: [{ role: 'SITE_MANAGER', siteId: activeSiteId }],
      });
    },
    onSuccess: (user) => {
      setCreateManagerError(null);
      setManagerSuccessMsg(`Site Manager account "${user.username}" created for this site. They must sign in and change their temporary password before visitor registration and approval are available.`);
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
        setCreateManagerError(err.message);
      } else {
        setCreateManagerError('Could not create the Site Manager account. Verify the inputs and password policy.');
      }
    },
  });

  // ── Access Guard ────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto mt-20 p-8 rounded-2xl bg-white border border-rose-200 text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
          <IconShield className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900">Access Restricted</h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          Site &amp; Contractor Setup is reserved for System Administrators. Your current role does not grant permission to configure site infrastructure.
        </p>
      </div>
    );
  }

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleCreateSiteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSiteError(null);
    if (!siteName.trim()) {
      setSiteError('Site name is required.');
      return;
    }
    const code = siteCode.trim()
      ? siteCode.trim().toUpperCase()
      : siteName.trim().toUpperCase().replace(/[^A-Z0-9]/g, '-') + '-' + Math.floor(1000 + Math.random() * 9000);

    createSiteMutation.mutate({ code, name: siteName.trim() });
  };

  const handleCreateContractorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setContractorError(null);
    if (!activeSiteId) {
      setContractorError('Please select an active site first.');
      return;
    }
    if (!contractorCode.trim()) {
      setContractorError('Contractor code is required.');
      return;
    }
    if (!contractorName.trim()) {
      setContractorError('Contractor name is required.');
      return;
    }

    createContractorMutation.mutate({
      code: contractorCode.trim().toUpperCase(),
      name: contractorName.trim(),
    });
  };

  const handleCreateRepSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setRepError(null);
    const contractorId = repContractorId || preselectedContractorId || contractors[0]?.id;
    if (!activeSiteId || !contractorId) {
      setRepError('An active contractor must be selected.');
      return;
    }
    if (!repUsername.trim()) {
      setRepError('Username is required.');
      return;
    }
    if (!repDisplayName.trim()) {
      setRepError('Display name is required.');
      return;
    }
    if (!repPassword) {
      setRepError('Temporary password is required.');
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
    setRepContractorId(contractorId);
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
      setAssignRepError('An active contractor must be selected.');
      return;
    }
    if (!existingRepId) {
      setAssignRepError('Please select an existing representative account.');
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
      setManagerError('Please select an active site first.');
      return;
    }
    if (!selectedManagerId) {
      setManagerError('Please select an existing account.');
      return;
    }

    assignSiteManagerMutation.mutate({ siteId: activeSiteId, userId: selectedManagerId });
  };

  const handleCreateSiteManagerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCreateManagerError(null);
    if (!activeSiteId) {
      setCreateManagerError('Please select an active site first.');
      return;
    }
    if (!managerUsername.trim()) {
      setCreateManagerError('Username is required.');
      return;
    }
    if (!managerDisplayName.trim()) {
      setCreateManagerError('Display name is required.');
      return;
    }
    if (!managerPassword) {
      setCreateManagerError('Temporary password is required.');
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

      {/* 1. Header & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#071A2B] text-white flex items-center justify-center shadow-xs shrink-0">
            <IconBuilding className="w-5 h-5 text-[#F66B17]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Administration
              </span>
              <span className="text-slate-300">•</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Workspace Setup
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[#071A2B]">
              Site &amp; Contractor Setup
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              sitesQuery.refetch();
              if (activeSiteId) contractorsQuery.refetch();
              usersQuery.refetch();
              representativeAssignmentsQuery.refetch();
            }}
            disabled={sitesQuery.isFetching || contractorsQuery.isFetching}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
            title="Refresh sites and contractors data"
          >
            <IconRefreshCw className={`w-3.5 h-3.5 text-slate-500 ${sitesQuery.isFetching ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSiteError(null);
              setSiteName('');
              setSiteCode('');
              setShowCreateSiteModal(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#071A2B] text-white text-xs font-bold hover:bg-[#0E2841] transition-all cursor-pointer shadow-xs active:scale-[0.98]"
          >
            <IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />
            <span>New Site</span>
          </button>
        </div>
      </div>

      {/* Success Notification Banners */}
      {(sitesQuery.isError || usersQuery.isError || contractorsQuery.isError || representativeAssignmentsQuery.isError) && (
        <div role="alert" className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
          Could not load complete site setup data. Use Refresh to try again. Manager readiness cannot be confirmed until accounts load successfully.
        </div>
      )}
      {contractorSuccessMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5 font-medium">
            <IconCheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{contractorSuccessMsg}</span>
          </div>
          <button type="button" onClick={() => setContractorSuccessMsg(null)} className="text-emerald-600 hover:text-emerald-900 cursor-pointer">
            <IconX className="w-4 h-4" />
          </button>
        </div>
      )}

      {repSuccessMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5 font-medium">
            <IconCheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{repSuccessMsg}</span>
          </div>
          <button type="button" onClick={() => setRepSuccessMsg(null)} className="text-emerald-600 hover:text-emerald-900 cursor-pointer">
            <IconX className="w-4 h-4" />
          </button>
        </div>
      )}

      {managerSuccessMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5 font-medium">
            <IconCheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{managerSuccessMsg}</span>
          </div>
          <button type="button" onClick={() => setManagerSuccessMsg(null)} className="text-emerald-600 hover:text-emerald-900 cursor-pointer">
            <IconX className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. Top Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Sites</span>
            <p className="text-2xl font-black tracking-tight text-[#071A2B]">{sites.length}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600">
            <IconBuilding className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Contractors on Site</span>
            <p className="text-2xl font-black tracking-tight text-[#071A2B]">
              {contractorsQuery.isLoading ? '...' : contractors.length}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600">
            <IconBuilding2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Representatives</span>
            <p className="text-2xl font-black tracking-tight text-[#071A2B]">
              {usersQuery.isLoading ? '...' : siteRepresentatives.length}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600">
            <IconUsers className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* 3. Main Master-Detail Hub */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">

        {/* Left Column: Sites Navigator (4 cols) */}
        <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col">
          <div className="p-3.5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">Sites</h2>
              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-700">
                {sites.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSiteError(null);
                setSiteName('');
                setSiteCode('');
                setShowCreateSiteModal(true);
              }}
              className="text-[11px] font-bold text-[#F66B17] hover:text-[#d4550b] flex items-center gap-1 cursor-pointer"
            >
              <IconPlus className="w-3 h-3" />
              <span>Add</span>
            </button>
          </div>

          {/* Search input for sites */}
          <div className="p-2.5 border-b border-slate-100">
            <div className="relative">
              <IconSearch className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={siteSearchQuery}
                onChange={(e) => setSiteSearchQuery(e.target.value)}
                placeholder="Search site name or code..."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:bg-white transition-colors"
              />
              {siteSearchQuery && (
                <button
                  type="button"
                  onClick={() => setSiteSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <IconX className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Sites List */}
          <div className="p-2 space-y-1 max-h-[520px] overflow-y-auto">
            {sitesQuery.isLoading ? (
              <div className="py-12 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
                <IconLoader className="w-5 h-5 animate-spin text-slate-500" />
                <span>Loading sites...</span>
              </div>
            ) : filteredSites.length === 0 ? (
              <div className="py-10 px-4 text-center text-xs text-slate-500 space-y-2">
                <p>No sites match your filter.</p>
                {siteSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setSiteSearchQuery('')}
                    className="text-xs font-bold text-[#F66B17] hover:underline"
                  >
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              filteredSites.map((site) => {
                const isSelected = site.id === activeSiteId;
                return (
                  <button
                    key={site.id}
                    type="button"
                    onClick={() => {
                      setSelectedSiteId(site.id);
                      setContractorError(null);
                      setContractorSuccessMsg(null);
                    }}
                    className={`w-full text-left p-3 rounded-xl border transition-all duration-150 flex items-center justify-between cursor-pointer group ${
                      isSelected
                        ? 'bg-[#071A2B] border-[#071A2B] text-white shadow-xs'
                        : 'bg-white border-transparent hover:border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded tracking-wider uppercase ${
                            isSelected
                              ? 'bg-white/15 text-white border border-white/20'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                        >
                          {site.code}
                        </span>
                        <h3 className={`text-xs font-bold truncate ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                          {site.name}
                        </h3>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isSelected ? (
                        <div className="w-2 h-2 rounded-full bg-[#F66B17]" />
                      ) : (
                        <IconChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors" />
                      )}
                    </div>
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
              <h3 className="text-sm font-bold text-slate-900">No Site Selected</h3>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                Select a site from the left navigation or click &quot;New Site&quot; to create one.
              </p>
            </div>
          ) : (
            <>
              {/* Site Header Banner */}
              <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-4">
                <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-4 items-center pb-4 border-b border-slate-100">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-[#071A2B] text-white flex items-center justify-center shrink-0">
                        <IconBuilding2 className="w-4 h-4 text-[#F66B17]" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200 tracking-wider">
                            {selectedSite.code}
                          </span>
                          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-600">
                            Active site
                          </span>
                        </div>
                        <h2 className="text-base font-bold text-slate-900 truncate">
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
                          managersLoaded && readySiteManagers.length > 0 ? 'bg-white text-emerald-600' : 'bg-white text-amber-600'
                        }`}
                      >
                        <IconShield className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 leading-tight">
                        <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Site Manager</div>
                        {!managersLoaded ? (
                          <div className="text-xs font-bold text-amber-700">{usersQuery.isError ? 'Account data unavailable' : 'Loading accounts...'}</div>
                        ) : siteManagers.length > 0 ? (
                          <div className="text-xs font-bold text-slate-800 truncate">
                            {siteManagers.map((manager) => `${manager.displayName || `@${manager.username}`} (${!manager.isActive ? 'Disabled' : manager.mustChangePassword ? 'Password change required' : 'Ready to approve'})`).join(', ')}
                          </div>
                        ) : (
                          <div className="text-xs font-bold text-amber-700">Not assigned yet</div>
                        )}
                      </div>
                      <span
                        className={`ml-1 w-2 h-2 rounded-full shrink-0 ${
                          managersLoaded && readySiteManagers.length > 0 ? 'bg-emerald-500' : 'bg-amber-500'
                        }`}
                        aria-hidden="true"
                      />
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex flex-wrap items-center justify-start xl:justify-end gap-2">
                      <button
                        type="button"
                        disabled={!managersLoaded}
                        onClick={openAssignSiteManagerModal}
                        className="inline-flex items-center gap-1.5 min-h-10 px-3.5 rounded-xl border border-orange-200 bg-orange-50 text-xs font-bold text-[#C6530E] hover:bg-orange-100 hover:border-orange-300 transition-colors cursor-pointer active:scale-[0.98]"
                      >
                        <IconShield className="w-3.5 h-3.5" />
                        <span>{siteManagers.length === 0 ? 'Assign Site Manager' : 'Manage Site Managers'}</span>
                      </button>

                    <button
                      type="button"
                      onClick={() => {
                        setContractorError(null);
                        setContractorCode('');
                        setContractorName('');
                        setShowCreateContractorModal(true);
                      }}
                      className="inline-flex items-center gap-1.5 min-h-10 px-3.5 rounded-xl bg-[#071A2B] text-white text-xs font-bold hover:bg-[#0E2841] transition-all cursor-pointer shadow-xs active:scale-[0.98]"
                    >
                      <IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />
                      <span>Add Contractor</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openRepModalForContractor('')}
                      disabled={contractors.length === 0}
                      className="inline-flex items-center gap-1.5 min-h-10 px-3.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
                      title={contractors.length === 0 ? 'Create a contractor first' : 'Create contractor representative login'}
                    >
                      <IconUser className="w-3.5 h-3.5 text-slate-600" />
                      <span>Create Representative</span>
                    </button>
                  </div>
                </div>

                {/* Sub-Tabs: Contractors vs Representatives */}
                <div className="flex items-center justify-between pt-0.5">
                  <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100/80 border border-slate-200/60">
                    <button
                      type="button"
                      onClick={() => setActiveTab('contractors')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        activeTab === 'contractors'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <IconBuilding2 className="w-3.5 h-3.5 text-[#F66B17]" />
                      <span>Contractors ({contractors.length})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('representatives')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        activeTab === 'representatives'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <IconUsers className="w-3.5 h-3.5 text-blue-600" />
                      <span>Representatives ({siteRepresentatives.length})</span>
                    </button>
                  </div>

                  {/* Filter / Search within tab */}
                  {activeTab === 'contractors' && contractors.length > 3 && (
                    <div className="w-48 relative hidden sm:block">
                      <IconSearch className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={contractorSearchQuery}
                        onChange={(e) => setContractorSearchQuery(e.target.value)}
                        placeholder="Filter contractors..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1 text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:bg-white transition-colors"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* TAB 1: Contractors List Table */}
              {activeTab === 'contractors' && (
                <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
                  {contractorsQuery.isLoading ? (
                    <div className="py-16 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
                      <IconLoader className="w-5 h-5 animate-spin text-slate-500" />
                      <span>Loading contractors...</span>
                    </div>
                  ) : contractors.length === 0 ? (
                    <div className="p-5 sm:p-7 bg-gradient-to-br from-white to-slate-50/80">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4 max-w-2xl">
                        <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                          <IconBuilding2 className="w-6 h-6" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-bold text-slate-900">No Subcontractors Registered</h3>
                            <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-amber-700 bg-amber-100/80 px-2 py-1 rounded-md">
                              Setup required
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 max-w-xl mt-1 leading-relaxed">
                            Register a contractor for this site before adding representatives or assigning worker schedules.
                          </p>
                        </div>
                      <button
                        type="button"
                        onClick={() => {
                          setContractorError(null);
                          setContractorCode('');
                          setContractorName('');
                          setShowCreateContractorModal(true);
                        }}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#071A2B] text-white text-xs font-bold hover:bg-[#0E2841] transition-all cursor-pointer shadow-xs shrink-0 active:scale-[0.98]"
                      >
                        <IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />
                        <span>Register First Contractor</span>
                      </button>
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50/60 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                            <th className="py-3 px-4">Contractor Info</th>
                            <th className="py-3 px-4">Code</th>
                            <th className="py-3 px-4">Representatives</th>
                            <th className="py-3 px-4">Created</th>
                            <th className="py-3 px-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredContractors.map((contractor) => {
                            const linkedRepresentativeIds = getContractorRepresentativeUserIds(
                              representativeAssignments,
                              contractor.id,
                            );
                            const linkedRepresentatives = siteRepresentatives.filter((representative) =>
                              linkedRepresentativeIds.includes(representative.id),
                            );
                            return (
                              <tr key={contractor.id} className="hover:bg-slate-50/70 transition-colors">
                                <td className="py-3.5 px-4">
                                  <div className="font-bold text-slate-900">{contractor.name}</div>
                                </td>
                                <td className="py-3.5 px-4">
                                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-800 uppercase">
                                    {contractor.code}
                                  </span>
                                </td>
                                <td className="py-3.5 px-4">
                                  {representativeAssignmentsQuery.isLoading ? (
                                    <span className="text-[11px] text-slate-400">Loading...</span>
                                  ) : linkedRepresentativeIds.length > 0 ? (
                                    <div className="space-y-0.5">
                                      {linkedRepresentatives.length > 0 ? linkedRepresentatives.map((representative) => (
                                        <div key={representative.id}>
                                          <div className="font-bold text-slate-900">{representative.displayName}</div>
                                          <div className="font-mono text-[10px] text-slate-400">@{representative.username}</div>
                                        </div>
                                      )) : (
                                        <span className="text-[11px] font-semibold text-emerald-700">Assigned</span>
                                      )}
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => openAssignExistingRepModal(contractor.id)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 hover:border-slate-300 transition-colors cursor-pointer"
                                    >
                                      <IconPlus className="w-3 h-3 text-[#F66B17]" />
                                      <span>Assign Existing Rep</span>
                                    </button>
                                  )}
                                </td>
                                <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                                  {new Date(contractor.createdAt).toLocaleDateString('vi-VN')}
                                </td>
                                <td className="py-3.5 px-4 text-right">
                                  {representativeAssignmentsQuery.isLoading ? null : linkedRepresentativeIds.length > 0 ? (
                                    <span className="text-[11px] font-semibold text-emerald-700">Assigned</span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => openAssignExistingRepModal(contractor.id)}
                                      className="text-xs font-bold text-[#F66B17] hover:text-[#d4550b] cursor-pointer"
                                    >
                                      + Assign Existing Rep
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: Representatives Directory */}
              {activeTab === 'representatives' && (
                <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
                  {usersQuery.isLoading ? (
                    <div className="py-16 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
                      <IconLoader className="w-5 h-5 animate-spin text-slate-500" />
                      <span>Loading representative accounts...</span>
                    </div>
                  ) : siteRepresentatives.length === 0 ? (
                    <div className="py-14 px-4 text-center space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 mx-auto flex items-center justify-center text-blue-600">
                        <IconUsers className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">No Representatives Found</h3>
                        <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                          No contractor representative accounts are linked to this site yet.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openRepModalForContractor('')}
                        disabled={contractors.length === 0}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#071A2B] text-white text-xs font-bold hover:bg-[#0E2841] transition-all cursor-pointer shadow-xs disabled:opacity-50"
                      >
                        <IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />
                        <span>Create Representative</span>
                      </button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50/60 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                            <th className="py-3 px-4">Representative</th>
                            <th className="py-3 px-4">Username</th>
                            <th className="py-3 px-4">Contractor</th>
                            <th className="py-3 px-4">Role Scope</th>
                            <th className="py-3 px-4">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {siteRepresentatives.map((rep) => {
                            const linkedContractors = representativeAssignments
                              .filter((assignment) => assignment.userId === rep.id)
                              .map((assignment) => contractors.find((contractor) => contractor.id === assignment.contractorId))
                              .filter((contractor): contractor is (typeof contractors)[number] => Boolean(contractor));
                            return (
                            <tr key={rep.id} className="hover:bg-slate-50/70 transition-colors">
                              <td className="py-3.5 px-4">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs uppercase">
                                    {rep.displayName.charAt(0) || 'R'}
                                  </div>
                                  <div>
                                    <div className="font-bold text-slate-900">{rep.displayName}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3.5 px-4 font-mono font-medium text-slate-700">
                                @{rep.username}
                              </td>
                              <td className="py-3.5 px-4">
                                {linkedContractors.length > 0 ? (
                                  <div className="space-y-0.5">
                                    {linkedContractors.map((contractor) => (
                                      <div key={contractor.id}>
                                        <div className="font-bold text-slate-900">{contractor.name}</div>
                                        <div className="font-mono text-[10px] text-slate-400">{contractor.code}</div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-amber-700 font-semibold">Not linked</span>
                                )}
                              </td>
                              <td className="py-3.5 px-4">
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-700">
                                  CONTRACTOR_REPRESENTATIVE
                                </span>
                              </td>
                              <td className="py-3.5 px-4">
                                <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  rep.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600'
                                }`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${rep.isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                                  {rep.isActive ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
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
                  <h3 className="text-sm font-bold text-slate-900">Assign Site Manager</h3>
                  <p className="text-[11px] text-slate-500">Assign an existing account to {selectedSite?.name}</p>
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
                  <span>{managerError}</span>
                </div>
              )}

              {siteManagers.length > 0 ? (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs leading-relaxed">
                  Assigned Site Managers: {' '}
                  <span className="font-bold">
                    {siteManagers.map((manager) => `${manager.displayName || `@${manager.username}`} (${!manager.isActive ? 'Disabled' : manager.mustChangePassword ? 'Password change required' : 'Ready to approve'})`).join(', ')}
                  </span>
                </div>
              ) : null}
              {assignableSiteManagers.length > 0 ? (
                <SmartSelect
                  id="site-manager-select"
                  label="Site Manager Account"
                  fieldRequired
                  placeholder="Select an existing Site Manager"
                  value={selectedManagerId}
                  onChange={setSelectedManagerId}
                  searchable
                  searchPlaceholder="Search account..."
                  options={assignableSiteManagers.map((manager) => ({
                    value: manager.id,
                    label: manager.displayName,
                    badge: `@${manager.username}`,
                  }))}
                />
              ) : (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs leading-relaxed">
                  No active account with the <span className="font-bold">SITE_MANAGER</span> role is available for this site.
                </div>
              )}

                <button
                  type="button"
                  onClick={openCreateSiteManagerModal}
                  className="w-full px-3 py-2.5 rounded-xl border border-dashed border-[#F66B17]/50 bg-orange-50/50 text-xs font-bold text-[#C6530E] hover:bg-orange-50 transition-colors cursor-pointer"
                >
                  + Create New Site Manager
                </button>

              <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 text-blue-800 text-xs leading-relaxed">
                Existing role assignments for this account will be preserved. The Site Manager role will be added only for this site.
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAssignManagerModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={
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
                  <span>{assignSiteManagerMutation.isPending ? 'Assigning...' : 'Assign Site Manager'}</span>
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
                  <h3 className="text-sm font-bold text-slate-900">Create Site Manager</h3>
                  <p className="text-[11px] text-slate-500">Create a Site Manager account for {selectedSite?.name}</p>
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
                  <span>{createManagerError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label htmlFor="site-manager-username-input" className="block text-xs font-bold text-slate-700">
                    Username <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="site-manager-username-input"
                    type="text"
                    required
                    placeholder="e.g. manager.site-a"
                    value={managerUsername}
                    onChange={(e) => setManagerUsername(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="site-manager-displayname-input" className="block text-xs font-bold text-slate-700">
                    Display Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="site-manager-displayname-input"
                    type="text"
                    required
                    placeholder="e.g. Nguyen Van A"
                    value={managerDisplayName}
                    onChange={(e) => setManagerDisplayName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="site-manager-password-input" className="block text-xs font-bold text-slate-700">
                  Temporary Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    id="site-manager-password-input"
                    type={showManagerPassword ? 'text' : 'password'}
                    required
                    placeholder="Must meet policy: min 8 chars, Aa1@"
                    value={managerPassword}
                    onChange={(e) => setManagerPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 pr-16 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowManagerPassword(!showManagerPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showManagerPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 text-blue-800 text-xs leading-relaxed">
                This account will be created with the <span className="font-bold">SITE_MANAGER</span> role for this site.
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateManagerModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
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
                  <span>{createSiteManagerMutation.isPending ? 'Creating...' : 'Create Site Manager'}</span>
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
                  <h3 className="text-sm font-bold text-slate-900">Create New Site</h3>
                  <p className="text-[11px] text-slate-500">Add a new project site to the organization</p>
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
                  <span>{siteError}</span>
                </div>
              )}

              <div className="space-y-1">
                <label htmlFor="site-name-input" className="block text-xs font-bold text-slate-700">
                  Site Name <span className="text-rose-500">*</span>
                </label>
                <input
                  id="site-name-input"
                  type="text"
                  required
                  placeholder="e.g. Landmark 81 Tower Phase 2"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="site-code-input" className="block text-xs font-bold text-slate-700">
                  Site Code <span className="text-slate-400 font-normal">(Optional, auto-generated if blank)</span>
                </label>
                <input
                  id="site-code-input"
                  type="text"
                  placeholder="e.g. LM81-P2"
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
                  Cancel
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
                  <span>{createSiteMutation.isPending ? 'Creating...' : 'Create Site'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL 4: Create Contractor Modal ─────────────────────────────────── */}
      {showCreateContractorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071A2B]/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#071A2B] text-white flex items-center justify-center">
                  <IconBuilding2 className="w-4 h-4 text-[#F66B17]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Register Contractor</h3>
                  <p className="text-[11px] text-slate-500">Adding to {selectedSite?.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateContractorModal(false)}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateContractorSubmit} className="space-y-4">
              {contractorError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs">
                  <IconAlertCircle className="w-4 h-4 shrink-0" />
                  <span>{contractorError}</span>
                </div>
              )}

              <div className="space-y-1">
                <label htmlFor="contractor-code-input" className="block text-xs font-bold text-slate-700">
                  Contractor Code <span className="text-rose-500">*</span>
                </label>
                <input
                  id="contractor-code-input"
                  type="text"
                  required
                  placeholder="e.g. CTR-PAINT or VINACONEX-CIVIL"
                  value={contractorCode}
                  onChange={(e) => setContractorCode(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-mono uppercase text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="contractor-name-input" className="block text-xs font-bold text-slate-700">
                  Contractor Name <span className="text-rose-500">*</span>
                </label>
                <input
                  id="contractor-name-input"
                  type="text"
                  required
                  placeholder="e.g. Painting Contractor Ltd."
                  value={contractorName}
                  onChange={(e) => setContractorName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateContractorModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={createContractorMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#071A2B] text-white text-xs font-bold hover:bg-[#0E2841] transition-all cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {createContractorMutation.isPending ? (
                    <IconLoader className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />
                  )}
                  <span>{createContractorMutation.isPending ? 'Registering...' : 'Register Contractor'}</span>
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
                  <h3 className="text-sm font-bold text-slate-900">Assign Existing Representative</h3>
                  <p className="text-[11px] text-slate-500">
                    Link an existing representative account to a contractor on {selectedSite?.name}
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
                  <span>{assignRepError}</span>
                </div>
              )}

              <SmartSelect
                id="existing-rep-contractor-select"
                label="Target Contractor"
                fieldRequired
                value={assignRepContractorId}
                onChange={(value) => {
                  setAssignRepContractorId(value);
                  setExistingRepId('');
                }}
                options={contractors.map((contractor) => ({
                  value: contractor.id,
                  label: contractor.name,
                  badge: contractor.code,
                }))}
              />

              {assignableRepresentatives.length > 0 ? (
                <SmartSelect
                  id="existing-representative-select"
                  label="Representative Account"
                  fieldRequired
                  placeholder="Select an existing representative"
                  value={existingRepId}
                  onChange={setExistingRepId}
                  searchable
                  searchPlaceholder="Search representative..."
                  options={assignableRepresentatives.map((representative) => ({
                    value: representative.id,
                    label: representative.displayName,
                    badge: `@${representative.username}`,
                  }))}
                />
              ) : (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs leading-relaxed">
                  No eligible active representative account is available for this contractor. Create one with
                  <span className="font-bold"> Create Representative</span> first, or choose another contractor.
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAssignRepModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={assignExistingRepresentativeMutation.isPending || assignableRepresentatives.length === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#071A2B] text-white text-xs font-bold hover:bg-[#0E2841] transition-all cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {assignExistingRepresentativeMutation.isPending ? (
                    <IconLoader className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <IconUsers className="w-3.5 h-3.5 text-[#F66B17]" />
                  )}
                  <span>{assignExistingRepresentativeMutation.isPending ? 'Assigning...' : 'Assign Representative'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL 6: Create Representative Modal ────────────────────────────── */}
      {showCreateRepModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071A2B]/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#071A2B] text-white flex items-center justify-center">
                  <IconUser className="w-4 h-4 text-[#F66B17]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Create Contractor Representative</h3>
                  <p className="text-[11px] text-slate-500">Provision login and link to contractor on {selectedSite?.name}</p>
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

            <form onSubmit={handleCreateRepSubmit} className="space-y-4">
              {repError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs">
                  <IconAlertCircle className="w-4 h-4 shrink-0" />
                  <span>{repError}</span>
                </div>
              )}

              {/* Contractor Select */}
              <div className="space-y-1">
                <SmartSelect
                  id="rep-contractor-select"
                  label="Target Contractor"
                  fieldRequired
                  value={repContractorId || preselectedContractorId || contractors[0]?.id || ''}
                  onChange={setRepContractorId}
                  options={contractors.map((c) => ({
                    value: c.id,
                    label: c.name,
                    badge: c.code,
                  }))}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label htmlFor="rep-username-input" className="block text-xs font-bold text-slate-700">
                    Username <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="rep-username-input"
                    type="text"
                    required
                    placeholder="e.g. rep.vinaconex"
                    value={repUsername}
                    onChange={(e) => setRepUsername(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="rep-displayname-input" className="block text-xs font-bold text-slate-700">
                    Display Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="rep-displayname-input"
                    type="text"
                    required
                    placeholder="e.g. Nguyen Van A"
                    value={repDisplayName}
                    onChange={(e) => setRepDisplayName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="rep-password-input" className="block text-xs font-bold text-slate-700">
                  Temporary Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    id="rep-password-input"
                    type={showRepPassword ? 'text' : 'password'}
                    required
                    placeholder="Must meet policy: min 8 chars, Aa1@"
                    value={repPassword}
                    onChange={(e) => setRepPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 pr-16 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRepPassword(!showRepPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showRepPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-1">
                  <IconKey className="w-3 h-3" />
                  User will be prompted to update this password upon initial login.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateRepModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
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
                    {createRepresentativeMutation.isPending ? 'Provisioning...' : 'Create & Assign Account'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
