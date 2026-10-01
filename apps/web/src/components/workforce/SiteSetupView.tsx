import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient, ApiError } from '@smartsite/api-client';
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
} from '../icons';
import { SmartInput } from '../ui/SmartFormControls';

interface SiteSetupViewProps {
  apiUrl: string;
}

export function SiteSetupView({ apiUrl }: SiteSetupViewProps) {
  const { accessToken } = useAuth();
  const { data: currentUser } = useCurrentUser(apiUrl);
  const queryClient = useQueryClient();
  const client = new SmartSiteManagementClient(apiUrl);

  const roles = currentUser?.roleAssignments?.map((r) => r.role) || [];
  const isAdmin = roles.includes('ADMIN');

  // Modal state
  const [showCreateSiteModal, setShowCreateSiteModal] = useState(false);

  // Selected site for contractor management
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);

  // Site Form State
  const [siteName, setSiteName] = useState('');
  const [siteError, setSiteError] = useState<string | null>(null);

  // Contractor Form State
  const [contractorCode, setContractorCode] = useState('');
  const [contractorName, setContractorName] = useState('');
  const [contractorError, setContractorError] = useState<string | null>(null);
  const [contractorSuccessMsg, setContractorSuccessMsg] = useState<string | null>(null);

  // ── Queries ─────────────────────────────────────────────────────────────────
  const sitesQuery = useQuery({
    queryKey: ['sites'],
    queryFn: () => client.listSites(accessToken!),
    enabled: Boolean(accessToken && isAdmin),
  });

  const sites = sitesQuery.data?.items ?? [];
  const selectedSite = sites.find((s) => s.id === selectedSiteId) ?? sites[0] ?? null;
  const activeSiteId = selectedSite?.id ?? null;

  const contractorsQuery = useQuery({
    queryKey: ['contractors', activeSiteId],
    queryFn: () => client.listContractors(accessToken!, activeSiteId!),
    enabled: Boolean(accessToken && activeSiteId),
  });

  const contractors = contractorsQuery.data?.items ?? [];

  // ── Mutations ───────────────────────────────────────────────────────────────
  const createSiteMutation = useMutation({
    mutationFn: (input: { code: string; name: string }) =>
      client.createSite(accessToken!, input),
    onSuccess: (newSite) => {
      setSiteError(null);
      setSiteName('');
      setShowCreateSiteModal(false);
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      setSelectedSiteId(newSite.id);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setSiteError(err.message);
      } else {
        setSiteError('Failed to create site. Please try again.');
      }
    },
  });

  const createContractorMutation = useMutation({
    mutationFn: (input: { code: string; name: string }) =>
      client.createContractor(accessToken!, activeSiteId!, input),
    onSuccess: (newContractor) => {
      setContractorError(null);
      setContractorSuccessMsg(`Contractor "${newContractor.name}" (${newContractor.code}) added.`);
      setContractorCode('');
      setContractorName('');
      queryClient.invalidateQueries({ queryKey: ['contractors', activeSiteId] });
    },
    onError: (err: unknown) => {
      setContractorSuccessMsg(null);
      if (err instanceof ApiError) {
        setContractorError(err.message);
      } else {
        setContractorError('Failed to create contractor. Please check inputs.');
      }
    },
  });

  // ── Access Guard ────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-20 p-8 rounded-[1.25rem] bg-red-50 border border-red-200 text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-[1.25rem] bg-red-100 text-red-600 mx-auto flex items-center justify-center">
          <IconShield className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-red-900">Access Restricted</h2>
        <p className="text-sm text-red-700 leading-relaxed">
          Site &amp; Contractor setup is restricted to System Administrators. Your role does not grant permission to manage site configurations.
        </p>
      </div>
    );
  }

  const handleCreateSiteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSiteError(null);

    if (!siteName.trim()) {
      setSiteError('Site name is required.');
      return;
    }

    const generatedCode = siteName.trim().toUpperCase().replace(/[^A-Z0-9]/g, '-') + '-' + Math.floor(1000 + Math.random() * 9000);

    createSiteMutation.mutate({
      code: generatedCode,
      name: siteName.trim(),
    });
  };

  const handleCreateContractorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setContractorError(null);
    setContractorSuccessMsg(null);

    if (!activeSiteId) {
      setContractorError('Please select or create a site first.');
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
      code: contractorCode.trim(),
      name: contractorName.trim(),
    });
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-3 duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]">

      {/* 1. Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#DCE6EF]/70">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 w-8 h-8 rounded-lg bg-[#071A2B] flex items-center justify-center shrink-0">
            <IconShield className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#94A3B8]">
              SYSTEM ADMINISTRATION
            </span>
            <h1 className="text-xl font-black tracking-tight text-[#071A2B] leading-none">
              Site &amp; Contractor Setup
            </h1>
            <p className="text-xs text-[#607A96] mt-1 leading-relaxed">
              Provision sites and manage contractor entities across projects.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            sitesQuery.refetch();
            if (activeSiteId) contractorsQuery.refetch();
          }}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl border border-[#DCE6EF] bg-white text-xs font-bold text-[#607A96] hover:border-[#071A2B] hover:text-[#071A2B] hover:bg-[#F9FAFC] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] shadow-xs cursor-pointer shrink-0"
        >
          <IconRefreshCw className={`w-3.5 h-3.5 ${sitesQuery.isFetching ? 'animate-spin' : ''}`} />
          Refresh Data
        </button>
      </div>

      {/* 2. Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Metric 1 */}
        <div className="bg-white border border-[#E8EEF4] rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#F5F8FB] border border-[#DCE6EF] flex items-center justify-center shrink-0">
            <IconBuilding className="w-4 h-4 text-[#607A96]" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">Total Sites</p>
            <p className="text-lg font-black text-[#071A2B] leading-tight">{sites.length}</p>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="bg-white border border-[#E8EEF4] rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#F5F8FB] border border-[#DCE6EF] flex items-center justify-center shrink-0">
            <IconBuilding2 className="w-4 h-4 text-[#607A96]" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">Total Contractors</p>
            <p className="text-lg font-black text-[#071A2B] leading-tight">
              {contractorsQuery.isLoading ? '...' : contractors.length}
            </p>
          </div>
        </div>

        {/* Metric 3 */}
        <div className="bg-white border border-[#E8EEF4] rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#F5F8FB] border border-[#DCE6EF] flex items-center justify-center shrink-0">
            <IconCheckCircle2 className="w-4 h-4 text-[#F66B17]" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">Active Selected Site</p>
            <p className="text-sm font-black text-[#071A2B] truncate leading-tight">
              {selectedSite ? `${selectedSite.name} (${selectedSite.code})` : 'None'}
            </p>
          </div>
        </div>
      </div>

      {/* 3. Main Master-Detail Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">

        {/* LEFT COLUMN: Site List (~32% -> col-span-4) */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-[#E8EEF4] p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#F0F4F8]">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#071A2B]">Sites</h2>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#F5F8FB] text-[#607A96]">
                {sites.length}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                setSiteError(null);
                setSiteName('');
                setShowCreateSiteModal(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#071A2B] text-white text-xs font-bold hover:bg-[#071A2B]/90 transition-colors duration-200 cursor-pointer"
            >
              <IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />
              <span>Create Site</span>
            </button>
          </div>

          {/* Site rows */}
          {sitesQuery.isLoading ? (
            <div className="py-8 text-center text-xs text-[#94A3B8] flex items-center justify-center gap-2">
              <IconLoader className="w-4 h-4 animate-spin" />
              <span>Loading sites...</span>
            </div>
          ) : sites.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#94A3B8] bg-[#F9FAFC] rounded-lg border border-dashed border-[#DCE6EF]">
              No sites found. Click &quot;Create Site&quot; to add one.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[540px] overflow-y-auto pr-1">
              {sites.map((site) => {
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
                    className={`w-full text-left p-3 rounded-lg border transition-all duration-200 flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? 'border-l-4 border-l-[#F66B17] border-t-[#DCE6EF] border-r-[#DCE6EF] border-b-[#DCE6EF] bg-[#F5F8FB] text-[#071A2B] font-semibold'
                        : 'border-[#F0F4F8] bg-white hover:bg-[#F9FAFC] text-[#607A96]'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                          isSelected ? 'bg-[#071A2B] text-white' : 'bg-[#F5F8FB] text-[#607A96] border border-[#E8EEF4]'
                        }`}>
                          {site.code}
                        </span>
                        <span className={`text-xs font-bold truncate ${isSelected ? 'text-[#071A2B]' : 'text-[#334155]'}`}>
                          {site.name}
                        </span>
                      </div>
                    </div>

                    {isSelected && (
                      <span className="w-2 h-2 rounded-full bg-[#F66B17] shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Contractor Management (~68% -> col-span-8) */}
        <div className="lg:col-span-8 space-y-4">
          {!selectedSite ? (
            <div className="bg-white rounded-xl border border-[#E8EEF4] p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-[#F5F8FB] border border-[#DCE6EF] mx-auto flex items-center justify-center">
                <IconBuilding2 className="w-6 h-6 text-[#94A3B8]" />
              </div>
              <h3 className="text-sm font-bold text-[#071A2B]">No Site Selected</h3>
              <p className="text-xs text-[#607A96] max-w-xs mx-auto">
                Select a site from the left column to view and add sub-contractors.
              </p>
            </div>
          ) : (
            <>
              {/* Selected site info bar */}
              <div className="bg-[#F8FAFC] rounded-xl border border-[#E8EEF4] px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[#071A2B] text-white">
                    {selectedSite.code}
                  </span>
                  <span className="text-xs font-bold text-[#071A2B]">{selectedSite.name}</span>
                </div>
                <span className="text-[10px] font-mono text-[#94A3B8] hidden sm:inline">ID: {selectedSite.id}</span>
              </div>

              {/* Create Contractor Form */}
              <div className="bg-white rounded-xl border border-[#E8EEF4] p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-[#F0F4F8]">
                <span className="text-[10px] font-mono text-[#94A3B8]">Site Code: {selectedSite.code}</span>
                </div>

                <form onSubmit={handleCreateContractorSubmit} className="space-y-3">
                  {contractorError && (
                    <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2 text-red-700 text-xs">
                      <IconAlertCircle className="w-4 h-4 shrink-0" />
                      <span>{contractorError}</span>
                    </div>
                  )}
                  {contractorSuccessMsg && (
                    <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-emerald-700 text-xs">
                      <IconCheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{contractorSuccessMsg}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <SmartInput
                      id="contractor-code"
                      label="Contractor Code"
                      fieldRequired
                      placeholder="e.g. CONTRACTOR-PAINT"
                      value={contractorCode}
                      onChange={(e) => setContractorCode(e.target.value)}
                    />
                    <SmartInput
                      id="contractor-name"
                      label="Contractor Name"
                      fieldRequired
                      placeholder="e.g. Painting Contractor"
                      value={contractorName}
                      onChange={(e) => setContractorName(e.target.value)}
                    />
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={createContractorMutation.isPending}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#071A2B] text-white text-xs font-bold hover:bg-[#071A2B]/90 transition-colors duration-200 cursor-pointer disabled:opacity-50"
                    >
                      {createContractorMutation.isPending ? (
                        <IconLoader className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <IconPlus className="w-3.5 h-3.5 text-[#F66B17]" />
                      )}
                      <span>{createContractorMutation.isPending ? 'Creating...' : 'Create Contractor'}</span>
                    </button>
                  </div>
                </form>
              </div>

              {/* Registered Contractors Table */}
              <div className="bg-white rounded-xl border border-[#E8EEF4] p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-[#F0F4F8]">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#071A2B]">
                    Contractors List ({contractors.length})
                  </h3>
                  {contractorsQuery.isFetching && <IconLoader className="w-3.5 h-3.5 text-[#94A3B8] animate-spin" />}
                </div>

                {contractorsQuery.isLoading ? (
                  <div className="py-8 text-center text-xs text-[#94A3B8] flex items-center justify-center gap-2">
                    <IconLoader className="w-4 h-4 animate-spin" />
                    <span>Loading contractors...</span>
                  </div>
                ) : contractors.length === 0 ? (
                  <div className="py-8 text-center text-xs text-[#94A3B8] bg-[#F9FAFC] rounded-lg border border-dashed border-[#DCE6EF]">
                </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-[#F0F4F8]">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#F0F4F8] bg-[#F9FAFC] text-[#94A3B8] font-bold uppercase tracking-wider text-[9px]">
                          <th className="py-2.5 px-3">Code</th>
                          <th className="py-2.5 px-3">Contractor Name</th>
                          <th className="py-2.5 px-3 hidden sm:table-cell">ID</th>
                          <th className="py-2.5 px-3">Created</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F0F4F8]">
                        {contractors.map((c) => (
                          <tr key={c.id} className="hover:bg-[#F9FAFC] transition-colors duration-150">
                            <td className="py-2.5 px-3">
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#F5F8FB] border border-[#E8EEF4] text-[#071A2B]">
                                {c.code}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-bold text-[#071A2B]">{c.name}</td>
                            <td className="py-2.5 px-3 font-mono text-[10px] text-[#94A3B8] truncate max-w-[140px] hidden sm:table-cell">
                              {c.id}
                            </td>
                            <td className="py-2.5 px-3 text-[#607A96] text-[11px]">
                              {new Date(c.createdAt).toLocaleDateString('vi-VN')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

      </div>

      {/* 4. Create Site Modal */}
      {showCreateSiteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071A2B]/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl border border-[#E8EEF4] shadow-2xl max-w-md w-full p-5 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-[#F0F4F8]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#071A2B] flex items-center justify-center shrink-0">
                  <IconBuilding className="w-3.5 h-3.5 text-white" />
                </div>
                <h3 className="text-sm font-bold text-[#071A2B]">Create New Site</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateSiteModal(false)}
                className="text-xs font-bold text-[#94A3B8] hover:text-[#071A2B] p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSiteSubmit} className="space-y-3.5">
              {siteError && (
                <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2 text-red-700 text-xs">
                  <IconAlertCircle className="w-4 h-4 shrink-0" />
                  <span>{siteError}</span>
                </div>
              )}

              <SmartInput
                id="site-name"
                label="Site Name"
                fieldRequired
                placeholder="e.g. Demo Construction Site 2"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
              />

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#F0F4F8]">
                <button
                  type="button"
                  onClick={() => setShowCreateSiteModal(false)}
                  className="px-4 py-2 rounded-lg border border-[#DCE6EF] bg-white text-xs font-bold text-[#607A96] hover:bg-[#F9FAFC] transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={createSiteMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#071A2B] text-white text-xs font-bold hover:bg-[#071A2B]/90 transition-colors duration-200 cursor-pointer disabled:opacity-50"
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

    </div>
  );
}
