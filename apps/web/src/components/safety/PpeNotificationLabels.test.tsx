// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient, type SafetyEpisode } from '@smartsite/api-client';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import { formatNotificationDisplayMessage } from '../../features/notifications/notification-utils';
import { EpisodeEvidence } from '../safety-episodes/EpisodeEvidence';
import { ConfirmedAlerts } from './SafetyWorkflowUi';

const THREE_REMAINING_FAMILIES = [
  {
    subtype: 'PPE_GLOVES_MISSING' as const,
    en: 'Possible missing gloves',
    vi: 'Dấu hiệu thiếu găng tay',
  },
  {
    subtype: 'PPE_BOOTS_MISSING' as const,
    en: 'Possible missing safety boots',
    vi: 'Dấu hiệu thiếu giày bảo hộ',
  },
  {
    subtype: 'PPE_GOGGLES_MISSING' as const,
    en: 'Possible missing safety goggles',
    vi: 'Dấu hiệu thiếu kính bảo hộ',
  },
];

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAMERA_ID = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';

function makeEpisode(): SafetyEpisode {
  return {
    id: 'episode-1',
    siteId: SITE_ID,
    cameraId: CAMERA_ID,
    zoneId: null,
    status: 'OPEN',
    contentRevision: 1,
    firstDetectedAt: '2026-11-24T10:00:00Z',
    lastDetectedAt: '2026-11-24T10:05:00Z',
    subject: {
      eventId: EVENT_ID,
      personObservationIndex: 0,
      trackId: 7,
      candidateWorkerId: null,
      identityState: 'UNKNOWN',
    },
    findings: THREE_REMAINING_FAMILIES.map((family, idx) => ({
      alertId: `44444444-4444-4444-8444-44444444440${idx + 1}`,
      alertType: 'PPE_VIOLATION',
      candidateSubtype: family.subtype,
      status: 'OPEN',
      detectionCount: 1,
      firstDetectedAt: '2026-11-24T10:00:00Z',
      lastDetectedAt: '2026-11-24T10:05:00Z',
      revision: 1,
      evidenceRefs: [],
    })),
  } as unknown as SafetyEpisode;
}

describe('Five-family PPE notification and alert subtype labels (Gloves, Boots, Goggles)', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    window.localStorage.clear();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('renders specific EN and VI evidence-oriented labels in SafetyWorkflow ConfirmedAlerts and EpisodeEvidence without generic fallback or raw keys', async () => {
    const client = new SmartSiteManagementClient('http://api.invalid');
    vi.spyOn(client, 'listSafetyAlerts').mockResolvedValue({
      items: THREE_REMAINING_FAMILIES.map((family, idx) => ({
        id: `55555555-5555-4555-8555-55555555550${idx + 1}`,
        siteId: SITE_ID,
        zoneId: null,
        candidateWorkerId: null,
        alertType: 'PPE_VIOLATION' as const,
        candidateSubtype: family.subtype,
        status: 'CONFIRMED' as const,
        firstDetectedAt: '2026-11-24T10:00:00Z',
        lastDetectedAt: '2026-11-24T10:05:00Z',
        detectionCount: 1,
        revision: 1,
        createdAt: '2026-11-24T10:00:00Z',
        updatedAt: '2026-11-24T10:05:00Z',
      })),
      total: THREE_REMAINING_FAMILIES.length,
    });

    const workflowProps = {
      client,
      apiUrl: 'http://api.invalid',
      token: 'synthetic-token',
      scope: 'officer-scope',
      siteId: SITE_ID,
      user: {
        id: 'officer-1',
        username: 'officer',
        displayName: 'Safety Officer',
        isActive: true,
        mustChangePassword: false,
        roleAssignments: [{ role: 'SAFETY_OFFICER' as const, siteId: SITE_ID }],
      },
    };

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ConfirmedAlerts p={workflowProps} />
        <EpisodeEvidence
          episode={makeEpisode()}
          client={client}
          token="synthetic-token"
          scope="officer-scope"
          apiUrl="http://api.invalid"
        />
      </QueryClientProvider>,
    );

    await screen.findAllByRole('checkbox');

    // English assertions across both rendered consumers and notification message formatter
    for (const family of THREE_REMAINING_FAMILIES) {
      expect(screen.getAllByText(new RegExp(family.en, 'i')).length).toBeGreaterThanOrEqual(2);
      expect(container.textContent).not.toContain(family.subtype);

      const formattedEn = formatNotificationDisplayMessage({
        event: 'PPE_ALERT_CREATED',
        message: 'Review the PPE observation.',
        workDate: undefined,
        safetyAlert: {
          cameraId: CAMERA_ID,
          cameraName: 'CAM-1',
          zoneId: null,
          zoneName: 'Zone A',
          candidateSubtype: family.subtype,
        },
      });
      expect(formattedEn).toContain(family.en);
      expect(formattedEn).not.toContain(family.subtype);
    }

    // Vietnamese assertions after language switch
    await i18n.changeLanguage('vi');
    await waitFor(() => {
      for (const family of THREE_REMAINING_FAMILIES) {
        expect(screen.getAllByText(new RegExp(family.vi, 'i')).length).toBeGreaterThanOrEqual(2);
      }
    });
    for (const family of THREE_REMAINING_FAMILIES) {
      expect(container.textContent).not.toContain(family.subtype);

      const formattedVi = formatNotificationDisplayMessage({
        event: 'PPE_ALERT_CREATED',
        message: 'Review the PPE observation.',
        workDate: undefined,
        safetyAlert: {
          cameraId: CAMERA_ID,
          cameraName: 'CAM-1',
          zoneId: null,
          zoneName: 'Khu A',
          candidateSubtype: family.subtype,
        },
      });
      expect(formattedVi).toContain(family.vi);
      expect(formattedVi).not.toContain(family.subtype);
    }

    // Unsupported families MUST NOT have missing-alert translation keys
    expect(i18n.exists('ppeNotifications.PPE_MASK_MISSING')).toBe(false);
    expect(i18n.exists('ppeNotifications.PPE_HARNESS_MISSING')).toBe(false);
    expect(i18n.exists('ppeNotifications.PPE_HOOK_MISSING')).toBe(false);
  });
});
