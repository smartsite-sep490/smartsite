// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoginResponse, RoleAssignmentResponse } from '@smartsite/api-client';
import { SafetyEpisodeWorkspace } from '../safety-episodes/SafetyEpisodeWorkspace';
import i18n from '../../i18n';

type Session = Pick<LoginResponse, 'accessToken' | 'user'>;

interface MockIdentificationProps {
  apiUrl: string;
  session: Session;
  initialSiteId?: string;
  initialEpisodeId?: string;
  originRecipientId?: string;
  originFrameKey?: string;
  originCameraId?: string;
  onClearOrigin?: () => void;
  onSignOut?: () => void;
}

interface MockInboxProps {
  apiUrl: string;
  session: Session;
  scope: string;
  sites: string[];
  onSignOut?: () => void;
}

const identificationSpy = vi.hoisted(() => vi.fn());
const inboxSpy = vi.hoisted(() => vi.fn());

vi.mock('./SafetyIdentificationWorkspace', () => ({
  SafetyIdentificationWorkspace: function MockSafetyIdentificationWorkspace(
    props: MockIdentificationProps,
  ) {
    identificationSpy(props);
    const [draft, setDraft] = useState('');
    return (
      <section aria-label="Mock C02 Workspace">
        <p>C02 user: {props.session.user.id}</p>
        <input
          aria-label="Mock C02 draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </section>
    );
  },
}));

vi.mock('../safety-episodes/SafetyEpisodeInbox', () => ({
  SafetyEpisodeInbox: (props: MockInboxProps) => {
    inboxSpy(props);
    return <div>Mock Episode Inbox</div>;
  },
}));

const siteA = '11111111-1111-4111-8111-111111111111';
const siteB = '22222222-2222-4222-8222-222222222222';
const episodeA = '33333333-3333-4333-8333-333333333333';

function makeSession(
  roleAssignments: RoleAssignmentResponse[],
  overrides?: {
    accessToken?: string;
    userId?: string;
    isActive?: boolean;
    mustChangePassword?: boolean;
  },
): Session {
  return {
    accessToken: overrides?.accessToken ?? 'synthetic-token-1',
    user: {
      id: overrides?.userId ?? 'user-1',
      username: overrides?.userId ?? 'user-1',
      displayName: 'Operator',
      roleAssignments,
      isActive: overrides?.isActive ?? true,
      mustChangePassword: overrides?.mustChangePassword ?? false,
    },
  };
}

function renderWorkspace(session: Session | null, initialEntry = '/incidents') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SafetyEpisodeWorkspace apiUrl="http://api.test" session={session}>
        <div>Legacy incident workflow</div>
      </SafetyEpisodeWorkspace>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('vi');
});

afterEach(() => {
  cleanup();
});

describe('SafetyEpisodeWorkspace C02 navigation and isolation', () => {
  it('allows an assigned Site Manager to open C02 without granting Officer episode inbox permission', async () => {
    const manager = makeSession([{ role: 'SITE_MANAGER', siteId: siteA }], {
      userId: 'manager-a',
    });

    renderWorkspace(manager, `/incidents?siteId=${siteA}`);

    expect(screen.getByText('Legacy incident workflow')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Hồ sơ theo người' })).toBeNull();

    const c02Link = screen.getByRole('link', { name: 'Yêu cầu xác minh' });
    expect(c02Link.getAttribute('href')).toBe(`/incidents?tab=identification&siteId=${siteA}`);

    fireEvent.click(c02Link);

    await screen.findByLabelText('Mock C02 draft');
    expect(screen.queryByText('Legacy incident workflow')).toBeNull();
    expect(inboxSpy).not.toHaveBeenCalled();
    expect(identificationSpy).toHaveBeenCalled();
    expect(identificationSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      apiUrl: 'http://api.test',
      initialSiteId: siteA,
      session: manager,
    });

    cleanup();
    vi.clearAllMocks();

    renderWorkspace(manager, `/incidents?tab=episodes&siteId=${siteA}`);
    expect(screen.getByRole('alert').textContent).toContain(
      'Hộp thư này dành cho cán bộ an toàn được phân công.',
    );
    expect(inboxSpy).not.toHaveBeenCalled();
    expect(identificationSpy).not.toHaveBeenCalled();
  });

  it('blocks denied roles, unscoped admins, inactive accounts, and password-reset sessions from mounting C02', () => {
    const deniedSessions: Session[] = [
      makeSession([{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: siteA }]),
      makeSession([{ role: 'WORKER', siteId: siteA }]),
      makeSession([{ role: 'SECURITY_OFFICER', siteId: siteA }]),
      makeSession([{ role: 'ADMIN', siteId: null }]),
      makeSession([{ role: 'SITE_MANAGER', siteId: null }]),
      makeSession([{ role: 'SITE_MANAGER', siteId: siteA }], { isActive: false }),
      makeSession([{ role: 'SAFETY_OFFICER', siteId: siteA }], { mustChangePassword: true }),
    ];

    for (const denied of deniedSessions) {
      renderWorkspace(denied, `/incidents?siteId=${siteA}`);
      expect(screen.getByText('Legacy incident workflow')).toBeTruthy();
      expect(screen.queryByRole('link', { name: 'Yêu cầu xác minh' })).toBeNull();
      expect(identificationSpy).not.toHaveBeenCalled();
      cleanup();

      renderWorkspace(denied, `/incidents?tab=identification&siteId=${siteA}`);
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.queryByLabelText('Mock C02 draft')).toBeNull();
      expect(identificationSpy).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('remounts and clears C02 state on token, user, or role changes and unmounts on logout or revocation', async () => {
    const initialPath = `/incidents?tab=identification&siteId=${siteA}&episodeId=${episodeA}`;
    const managerTokenA = makeSession([{ role: 'SITE_MANAGER', siteId: siteA }], {
      accessToken: 'token-A',
      userId: 'manager-1',
    });

    const view = render(
      <MemoryRouter initialEntries={[initialPath]}>
        <SafetyEpisodeWorkspace apiUrl="http://api.test" session={managerTokenA}>
          <div>Legacy incident workflow</div>
        </SafetyEpisodeWorkspace>
      </MemoryRouter>,
    );

    const firstDraft = (await screen.findByLabelText('Mock C02 draft')) as HTMLInputElement;
    expect(identificationSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      initialSiteId: siteA,
      initialEpisodeId: episodeA,
    });
    fireEvent.change(firstDraft, { target: { value: 'Draft under token A' } });
    expect(firstDraft.value).toBe('Draft under token A');

    const managerTokenB = makeSession([{ role: 'SITE_MANAGER', siteId: siteA }], {
      accessToken: 'token-B',
      userId: 'manager-1',
    });
    view.rerender(
      <MemoryRouter initialEntries={[initialPath]}>
        <SafetyEpisodeWorkspace apiUrl="http://api.test" session={managerTokenB}>
          <div>Legacy incident workflow</div>
        </SafetyEpisodeWorkspace>
      </MemoryRouter>,
    );

    const afterTokenChange = (await screen.findByLabelText('Mock C02 draft')) as HTMLInputElement;
    expect(afterTokenChange.value).toBe('');
    fireEvent.change(afterTokenChange, { target: { value: 'Draft before role change' } });
    expect(afterTokenChange.value).toBe('Draft before role change');

    const rotatedRoles = makeSession([{ role: 'SAFETY_OFFICER', siteId: siteB }], {
      accessToken: 'token-B',
      userId: 'manager-1',
    });
    view.rerender(
      <MemoryRouter initialEntries={[initialPath]}>
        <SafetyEpisodeWorkspace apiUrl="http://api.test" session={rotatedRoles}>
          <div>Legacy incident workflow</div>
        </SafetyEpisodeWorkspace>
      </MemoryRouter>,
    );

    const afterRoleChange = (await screen.findByLabelText('Mock C02 draft')) as HTMLInputElement;
    expect(afterRoleChange.value).toBe('');
    fireEvent.change(afterRoleChange, { target: { value: 'Draft before logout' } });

    view.rerender(
      <MemoryRouter initialEntries={[initialPath]}>
        <SafetyEpisodeWorkspace apiUrl="http://api.test" session={null}>
          <div>Legacy incident workflow</div>
        </SafetyEpisodeWorkspace>
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText('Mock C02 draft')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();

    const restoredOfficer = makeSession([{ role: 'SAFETY_OFFICER', siteId: siteA }], {
      accessToken: 'token-C',
      userId: 'officer-2',
    });
    view.rerender(
      <MemoryRouter initialEntries={[initialPath]}>
        <SafetyEpisodeWorkspace apiUrl="http://api.test" session={restoredOfficer}>
          <div>Legacy incident workflow</div>
        </SafetyEpisodeWorkspace>
      </MemoryRouter>,
    );

    const restoredDraft = (await screen.findByLabelText('Mock C02 draft')) as HTMLInputElement;
    expect(restoredDraft.value).toBe('');
    expect(screen.getByText('C02 user: officer-2')).toBeTruthy();

    const revokedToRep = makeSession([{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: siteA }], {
      accessToken: 'token-C',
      userId: 'officer-2',
    });
    view.rerender(
      <MemoryRouter initialEntries={[initialPath]}>
        <SafetyEpisodeWorkspace apiUrl="http://api.test" session={revokedToRep}>
          <div>Legacy incident workflow</div>
        </SafetyEpisodeWorkspace>
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText('Mock C02 draft')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('preserves legacy incident children, Officer episode inbox toggle, and EN/VI navigation links', async () => {
    const officer = makeSession([{ role: 'SAFETY_OFFICER', siteId: siteA }], {
      userId: 'officer-1',
    });

    renderWorkspace(officer, `/incidents?siteId=${siteA}&alertId=alert-99`);

    expect(screen.getByText('Legacy incident workflow')).toBeTruthy();

    const episodeLink = screen.getByRole('link', { name: 'Hồ sơ theo người' });
    expect(episodeLink.getAttribute('href')).toContain(`siteId=${siteA}`);
    expect(episodeLink.getAttribute('href')).toContain('tab=episodes');
    expect(episodeLink.getAttribute('href')).not.toContain('alertId=');

    const identificationLink = screen.getByRole('link', { name: 'Yêu cầu xác minh' });
    expect(identificationLink.getAttribute('href')).toBe(
      `/incidents?tab=identification&siteId=${siteA}`,
    );

    fireEvent.click(episodeLink);
    expect(await screen.findByText('Mock Episode Inbox')).toBeTruthy();
    expect(screen.queryByText('Legacy incident workflow')).toBeNull();
    expect(inboxSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      sites: [siteA],
    });

    fireEvent.click(screen.getByRole('link', { name: 'Yêu cầu xác minh' }));
    await screen.findByLabelText('Mock C02 draft');
    expect(screen.queryByText('Mock Episode Inbox')).toBeNull();

    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(screen.getByText('Coordinate identification for safety cases.')).toBeTruthy();

    fireEvent.click(screen.getByRole('link', { name: 'Safety workflow' }));
    expect(await screen.findByText('Legacy incident workflow')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Identification requests' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Person episodes' })).toBeTruthy();
  });

  it('routes the C02 top-bar Back link to the originating Officer episode with cameraId and frameKey, while sanitizing untrusted query params and protecting Site Manager scope', async () => {
    const recipientId = '55555555-5555-4555-8555-555555555555';
    const cameraId = '44444444-4444-4444-8444-444444444444';
    const officer = makeSession([{ role: 'SAFETY_OFFICER', siteId: siteA }], {
      userId: 'officer-1',
    });

    renderWorkspace(
      officer,
      `/incidents?${new URLSearchParams({
        tab: 'identification',
        siteId: siteA,
        episodeId: episodeA,
        originRecipientId: recipientId,
        frameKey: 'event:frame-1',
        cameraId,
      })}`,
    );

    await screen.findByLabelText('Mock C02 draft');
    expect(identificationSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      initialSiteId: siteA,
      initialEpisodeId: episodeA,
      originRecipientId: recipientId,
      originFrameKey: 'event:frame-1',
      originCameraId: cameraId,
    });

    const backLink = screen.getByRole('link', { name: 'Quay lại hồ sơ người' });
    expect(
      Object.fromEntries(
        new URL(backLink.getAttribute('href')!, 'http://example.test').searchParams,
      ),
    ).toEqual({
      tab: 'episodes',
      siteId: siteA,
      recipientId,
      frameKey: 'event:frame-1',
      cameraId,
    });
    fireEvent.click(backLink);
    expect(await screen.findByText('Mock Episode Inbox')).toBeTruthy();
    cleanup();
    vi.clearAllMocks();

    // Switching active site inside C02 updates URL siteId and clears stale episodeId + origin params.
    const dualSiteOfficer = makeSession(
      [
        { role: 'SAFETY_OFFICER', siteId: siteA },
        { role: 'SAFETY_OFFICER', siteId: siteB },
      ],
      { userId: 'officer-dual' },
    );
    renderWorkspace(
      dualSiteOfficer,
      `/incidents?${new URLSearchParams({
        tab: 'identification',
        siteId: siteA,
        episodeId: episodeA,
        originRecipientId: recipientId,
        frameKey: 'event:frame-1',
        cameraId,
      })}`,
    );
    await screen.findByLabelText('Mock C02 draft');
    const latestProps = identificationSpy.mock.calls.at(-1)?.[0] as {
      onActiveSiteChange?: (nextSiteId: string) => void;
    };
    expect(typeof latestProps.onActiveSiteChange).toBe('function');
    await act(async () => {
      latestProps.onActiveSiteChange?.(siteB);
    });
    expect(identificationSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      initialSiteId: siteB,
      initialEpisodeId: undefined,
      originRecipientId: undefined,
      originFrameKey: undefined,
      originCameraId: undefined,
    });
    const switchedBack = screen.getByRole('link', { name: 'Xử lý an toàn' });
    expect(switchedBack.getAttribute('href')).toBe(`/incidents?siteId=${siteB}`);
    cleanup();
    vi.clearAllMocks();

    // Untrusted return parameters must be stripped and never construct protocol-relative or external URLs.
    renderWorkspace(
      officer,
      `/incidents?${new URLSearchParams({
        tab: 'identification',
        siteId: siteA,
        episodeId: episodeA,
        originRecipientId: '//evil.example/hijack',
        frameKey: 'javascript:alert(1)',
        cameraId: 'https://evil.example',
      })}`,
    );
    await screen.findByLabelText('Mock C02 draft');
    expect(identificationSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      initialSiteId: siteA,
      initialEpisodeId: episodeA,
      originRecipientId: undefined,
      originFrameKey: undefined,
      originCameraId: undefined,
    });
    const safeFallbackBack = screen.getByRole('link', { name: 'Xử lý an toàn' });
    expect(safeFallbackBack.getAttribute('href')).toBe(`/incidents?siteId=${siteA}`);
    cleanup();
    vi.clearAllMocks();

    // Site Manager without Officer episode permission must never be routed to tab=episodes via crafted originRecipientId.
    const manager = makeSession([{ role: 'SITE_MANAGER', siteId: siteA }], {
      userId: 'manager-a',
    });
    renderWorkspace(
      manager,
      `/incidents?${new URLSearchParams({
        tab: 'identification',
        siteId: siteA,
        episodeId: episodeA,
        originRecipientId: recipientId,
        frameKey: 'event:frame-1',
        cameraId,
      })}`,
    );
    await screen.findByLabelText('Mock C02 draft');
    const managerBack = screen.getByRole('link', { name: 'Xử lý an toàn' });
    expect(managerBack.getAttribute('href')).toBe(`/incidents?siteId=${siteA}`);
  });
});
