import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import {
  SmartSiteManagementClient,
  type SafetyIdentificationRequest,
  type SafetyIdentificationStatus,
} from '@smartsite/api-client';
import { SafetyIdentificationWorkspace } from './SafetyIdentificationWorkspace';
import i18n from '../../i18n';
import {
  EPISODE_1_DETAIL,
  MANAGER_A_ID,
  MANAGER_OVERVIEW_SITE_A,
  SITES_FIXTURE,
  WORKERS_SITE_A,
  WORKSPACE_EN,
  escapeRegExp,
  makeRequest,
} from './safetyIdentificationTestFixtures';

function resizeObserverStub() {
  return {
    observe(): void {},
    unobserve(): void {},
    disconnect(): void {},
  };
}

export function stubWorkspaceGlobals(): void {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    vi.stubGlobal('ResizeObserver', resizeObserverStub);
  }
  // Block any unmocked HTTP assumptions: all calls must go through mocked SmartSiteManagementClient methods.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('Unmocked global fetch is forbidden in C02 unit tests'))),
  );
}

export function installClientSpies() {
  const proto = SmartSiteManagementClient.prototype;
  return {
    listSites: vi
      .spyOn(proto, 'listSites')
      .mockResolvedValue({ items: SITES_FIXTURE, total: SITES_FIXTURE.length }),
    getAssignee: vi
      .spyOn(proto, 'getSafetyIdentificationAssignee')
      .mockResolvedValue({ assignee: { id: MANAGER_A_ID, displayName: 'Tran Minh Quan' } }),
    listRequests: vi
      .spyOn(proto, 'listSafetyIdentificationRequests')
      .mockResolvedValue({ items: [], total: 0 }),
    getRequest: vi
      .spyOn(proto, 'getSafetyIdentificationRequest')
      .mockImplementation(async (_token: string, siteId: string, id: string) =>
        makeRequest({ id, siteId }),
      ),
    listHistory: vi
      .spyOn(proto, 'listSafetyIdentificationHistory')
      .mockResolvedValue({ items: [], total: 0 }),
    createRequest: vi.spyOn(proto, 'createSafetyIdentificationRequest'),
    changeRequest: vi.spyOn(proto, 'changeSafetyIdentificationRequest'),
    listWorkers: vi
      .spyOn(proto, 'listWorkers')
      .mockResolvedValue({ items: WORKERS_SITE_A, total: WORKERS_SITE_A.length }),
    managerOverview: vi.spyOn(proto, 'managerOverview').mockResolvedValue(MANAGER_OVERVIEW_SITE_A),
    listSafetyEpisodes: vi
      .spyOn(proto, 'listSafetyEpisodes')
      .mockResolvedValue({ items: [EPISODE_1_DETAIL], total: 1 }),
    getSafetyEpisode: vi.spyOn(proto, 'getSafetyEpisode').mockResolvedValue(EPISODE_1_DETAIL),
    listSafetyContractors: vi
      .spyOn(proto, 'listSafetyContractors')
      .mockResolvedValue({ items: [], total: 0 }),
    createIncident: vi.spyOn(proto, 'createIncident'),
    incidentCommand: vi.spyOn(proto, 'incidentCommand'),
    decideObservationIdentity: vi.spyOn(proto, 'decideObservationIdentity'),
    readTrackedEpisodeMedia: vi.spyOn(proto, 'readTrackedEpisodeMedia'),
    getSafetyAlertEvidence: vi.spyOn(proto, 'getSafetyAlertEvidence'),
    getCameraConfigurationImage: vi.spyOn(proto, 'getCameraConfigurationImage'),
  };
}

export type ClientSpies = ReturnType<typeof installClientSpies>;

export function setupWorkspaceTestLifecycle(): { getSpies: () => ClientSpies } {
  let activeSpies: ClientSpies | null = null;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    stubWorkspaceGlobals();
    activeSpies = installClientSpies();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    activeSpies = null;
  });

  return {
    getSpies(): ClientSpies {
      if (!activeSpies) {
        throw new Error('Workspace client spies accessed outside an active test');
      }
      return activeSpies;
    },
  };
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderWorkspaceOptions {
  queryClient?: QueryClient;
  initialPath?: string;
}

export function renderWorkspace(
  props: ComponentProps<typeof SafetyIdentificationWorkspace>,
  options?: RenderWorkspaceOptions,
) {
  const queryClient = options?.queryClient ?? createTestQueryClient();
  const initialPath = options?.initialPath ?? '/incidents?tab=identification';
  const buildTree = (nextProps: ComponentProps<typeof SafetyIdentificationWorkspace>) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <SafetyIdentificationWorkspace {...nextProps} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const rendered = render(buildTree(props));
  return {
    ...rendered,
    queryClient,
    rerenderWorkspace: (nextProps: ComponentProps<typeof SafetyIdentificationWorkspace>) =>
      rendered.rerender(buildTree(nextProps)),
  };
}

export async function openRequestRow(request: SafetyIdentificationRequest): Promise<void> {
  const reasonPattern = new RegExp(escapeRegExp(request.reason), 'i');
  await screen.findAllByText(reasonPattern);

  const rowButton = screen
    .queryAllByRole('button')
    .find((button) => button.textContent?.includes(request.reason));

  if (rowButton && rowButton.getAttribute('aria-pressed') !== 'true') {
    fireEvent.click(rowButton);
  }
}

export function selectSiteInWorkspace(targetSiteId: string): void {
  const siteSelect = screen.getByLabelText(WORKSPACE_EN.filters.siteLabel) as HTMLSelectElement;
  fireEvent.change(siteSelect, { target: { value: targetSiteId } });
}

export function selectStatusInWorkspace(status: 'ALL' | SafetyIdentificationStatus): void {
  const statusSelect = screen.getByLabelText(WORKSPACE_EN.filters.statusLabel) as HTMLSelectElement;
  fireEvent.change(statusSelect, { target: { value: status } });
}

export async function submitOfficerReview(
  decision: 'ACCEPT' | 'RETURN',
  reason: string,
): Promise<void> {
  const reviewReasonField = await screen.findByLabelText(WORKSPACE_EN.detail.reviewReasonLabel);
  fireEvent.change(reviewReasonField, { target: { value: reason } });

  const buttonLabel =
    decision === 'ACCEPT' ? WORKSPACE_EN.detail.acceptButton : WORKSPACE_EN.detail.returnButton;
  fireEvent.click(screen.getByRole('button', { name: buttonLabel }));
}

export async function submitOfficerReassign(reason: string): Promise<void> {
  if (!screen.queryByLabelText(WORKSPACE_EN.detail.reassignReasonLabel)) {
    fireEvent.click(
      await screen.findByRole('button', { name: WORKSPACE_EN.detail.reassignToggle }),
    );
  }
  const reassignReasonField = await screen.findByLabelText(WORKSPACE_EN.detail.reassignReasonLabel);
  fireEvent.change(reassignReasonField, { target: { value: reason } });
  await waitFor(() => {
    const confirmBtn = screen.getByRole('button', {
      name: WORKSPACE_EN.detail.reassignSubmit,
    }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
  });
  fireEvent.click(screen.getByRole('button', { name: WORKSPACE_EN.detail.reassignSubmit }));
}

export async function submitOfficerCancel(reason: string): Promise<void> {
  if (!screen.queryByLabelText(WORKSPACE_EN.detail.cancelReasonLabel)) {
    fireEvent.click(await screen.findByRole('button', { name: WORKSPACE_EN.detail.cancelToggle }));
  }
  const cancelReasonField = await screen.findByLabelText(WORKSPACE_EN.detail.cancelReasonLabel);
  fireEvent.change(cancelReasonField, { target: { value: reason } });
  fireEvent.click(screen.getByRole('button', { name: WORKSPACE_EN.detail.cancelSubmit }));
}
