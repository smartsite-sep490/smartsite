// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { ZonePpeSetupPanel } from './ZonePpeSetupPanel';

describe('ZonePpeSetupPanel Canonical 5 requiredPpe with Experimental Labels', () => {
  let queryClient: QueryClient;
  const mockOnClose = vi.fn();

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });

    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
      items: [],
      total: 0,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mockOnClose.mockClear();
  });

  it('renders Hard Hat and Safety Vest as checked Core items by default (baseline profile null)', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeSetupPanel
          canManageZones
          canManageRegions
          apiUrl="http://localhost:3000"
          token="test-token"
          sessionScope="test-scope"
          credentialId={1}
          siteId="site-alpha"
          siteName="Công trường Alpha"
          onClose={mockOnClose}
        />
      </QueryClientProvider>,
    );

    const hardHatCheckbox = screen.getByRole('checkbox', {
      name: /Hard Hat \/ Helmet/i,
    }) as HTMLInputElement;
    const vestCheckbox = screen.getByRole('checkbox', { name: /Safety Vest/i }) as HTMLInputElement;

    expect(hardHatCheckbox).not.toBeNull();
    expect(vestCheckbox).not.toBeNull();

    // Default checked (baseline profile null: ONLY HARD_HAT and SAFETY_VEST)
    expect(hardHatCheckbox.checked).toBe(true);
    expect(vestCheckbox.checked).toBe(true);
  });

  it('provides Gloves, Boots, Goggles as selectable checkboxes with Experimental labels', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeSetupPanel
          canManageZones
          canManageRegions
          apiUrl="http://localhost:3000"
          token="test-token"
          sessionScope="test-scope"
          credentialId={1}
          siteId="site-alpha"
          siteName="Công trường Alpha"
          onClose={mockOnClose}
        />
      </QueryClientProvider>,
    );

    const glovesCheckbox = screen.getByRole('checkbox', { name: /Gloves/i }) as HTMLInputElement;
    const bootsCheckbox = screen.getByRole('checkbox', { name: /Boots/i }) as HTMLInputElement;
    const gogglesCheckbox = screen.getByRole('checkbox', { name: /Goggles/i }) as HTMLInputElement;

    // Checkboxes are active and enabled (not disabled)
    expect(glovesCheckbox.disabled).toBe(false);
    expect(bootsCheckbox.disabled).toBe(false);
    expect(gogglesCheckbox.disabled).toBe(false);

    // Default unchecked
    expect(glovesCheckbox.checked).toBe(false);
    expect(bootsCheckbox.checked).toBe(false);
    expect(gogglesCheckbox.checked).toBe(false);

    // Experimental label verification
    expect(screen.getAllByText('(Experimental)').length).toBe(3);

    // Can toggle to checked
    fireEvent.click(glovesCheckbox);
    expect(glovesCheckbox.checked).toBe(true);

    fireEvent.click(bootsCheckbox);
    expect(bootsCheckbox.checked).toBe(true);

    fireEvent.click(gogglesCheckbox);
    expect(gogglesCheckbox.checked).toBe(true);
  });

  it('keeps Harness, Mask, Hook disabled and marks them unsupported in canonical requiredPpe', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeSetupPanel
          canManageZones
          canManageRegions
          apiUrl="http://localhost:3000"
          token="test-token"
          sessionScope="test-scope"
          credentialId={1}
          siteId="site-alpha"
          siteName="Công trường Alpha"
          onClose={mockOnClose}
        />
      </QueryClientProvider>,
    );

    const harnessCheckbox = screen.getByRole('checkbox', { name: /Harness/i }) as HTMLInputElement;
    const maskCheckbox = screen.getByRole('checkbox', { name: /Mask/i }) as HTMLInputElement;
    const hookCheckbox = screen.getByRole('checkbox', { name: /Hook/i }) as HTMLInputElement;

    // Strictly disabled: must not be added to canonical requiredPpe contract
    expect(harnessCheckbox.disabled).toBe(true);
    expect(maskCheckbox.disabled).toBe(true);
    expect(hookCheckbox.disabled).toBe(true);

    expect(screen.getAllByText('Not available as a zone requirement').length).toBe(3);
  });

  it('validates that at least one PPE item must be selected', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeSetupPanel
          canManageZones
          canManageRegions
          apiUrl="http://localhost:3000"
          token="test-token"
          sessionScope="test-scope"
          credentialId={1}
          siteId="site-alpha"
          siteName="Công trường Alpha"
          onClose={mockOnClose}
        />
      </QueryClientProvider>,
    );

    const hardHatCheckbox = screen.getByRole('checkbox', { name: /Hard Hat \/ Helmet/i });
    const vestCheckbox = screen.getByRole('checkbox', { name: /Safety Vest/i });

    // Uncheck both core items
    fireEvent.click(hardHatCheckbox);
    fireEvent.click(vestCheckbox);

    // Fill zone code and name
    fireEvent.change(screen.getByPlaceholderText(/ZONE-HAZ-01/i), { target: { value: 'ZONE-01' } });
    fireEvent.change(screen.getByPlaceholderText(/Scaffold Work Area/i), {
      target: { value: 'Work Area' },
    });

    // Submit form
    fireEvent.click(screen.getByRole('button', { name: /Save Zone PPE/i }));

    // Validation error banner rendered
    expect(screen.getByText(/At least one PPE item must be selected/i)).not.toBeNull();
  });

  it('submits zone creation with all canonical 5 items when selected', async () => {
    const createZoneSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createZone')
      .mockResolvedValue({
        id: 'zone-1',
        siteId: 'site-alpha',
        code: 'ZONE-CANONICAL-5',
        name: 'High Risk Steel Area',
        type: 'HAZARDOUS',
        restrictionPolicy: 'NONE',
        requiredPpe: ['HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES'],
        configurationLocked: false,
        createdAt: new Date().toISOString(),
      });

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeSetupPanel
          canManageZones
          canManageRegions
          apiUrl="http://localhost:3000"
          token="test-token"
          sessionScope="test-scope"
          credentialId={1}
          siteId="site-alpha"
          siteName="Công trường Alpha"
          onClose={mockOnClose}
        />
      </QueryClientProvider>,
    );

    // Toggle on Gloves, Boots, Goggles
    fireEvent.click(screen.getByRole('checkbox', { name: /Gloves/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Boots/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Goggles/i }));

    // Input code & name
    fireEvent.change(screen.getByPlaceholderText(/ZONE-HAZ-01/i), {
      target: { value: 'ZONE-CANONICAL-5' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Scaffold Work Area/i), {
      target: { value: 'High Risk Steel Area' },
    });

    // Submit form
    fireEvent.click(screen.getByRole('button', { name: /Save Zone PPE/i }));

    await waitFor(() => {
      expect(createZoneSpy).toHaveBeenCalledWith(
        'test-token',
        'site-alpha',
        expect.objectContaining({
          code: 'ZONE-CANONICAL-5',
          name: 'High Risk Steel Area',
          type: 'HAZARDOUS',
          restrictionPolicy: 'NONE',
          requiredPpe: ['HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES'],
        }),
      );
    });

    expect(await screen.findByText(/created successfully/i)).not.toBeNull();
  });
});
