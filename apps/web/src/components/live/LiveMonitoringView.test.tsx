// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { LiveMonitoringView } from './LiveMonitoringView';

describe('LiveMonitoringView - Truthful Minimalist Monitoring Entry', () => {
  afterEach(() => {
    cleanup();
  });

  it('1. Rejects fake live data, fake names, fake gloves, ungrounded claims, and MF badges', () => {
    const onNavigate = vi.fn();
    render(<LiveMonitoringView onNavigate={onNavigate} />);

    // Must NOT contain fake worker names
    expect(screen.queryByText(/Nguyen Van A/i)).toBeNull();
    expect(screen.queryByText(/Tran Van B/i)).toBeNull();
    expect(screen.queryByText(/Le Van C/i)).toBeNull();

    // Must NOT contain fake glove detections (only helmet and vest are supported)
    expect(screen.queryByText(/Missing Gloves/i)).toBeNull();
    expect(screen.queryByText(/GLOVES/i)).toBeNull();

    // Must NOT contain fake authorization verdicts in live preview
    expect(screen.queryByText(/Not Authorized/i)).toBeNull();

    // Must NOT display fake camera live feeds with hardcoded timestamps or multi-camera capacity claims
    expect(screen.queryByText(/LIVE - 10:42/i)).toBeNull();
    expect(
      screen.queryByText(/displaying real-time safety detections across all cameras/i),
    ).toBeNull();
    expect(screen.queryByText(/Combined feed of PPE and Zone events across the site/i)).toBeNull();

    // Must NOT display internal flow badges (MF04, MF05, MF06)
    expect(screen.queryByText(/\bMF0[456]\b/i)).toBeNull();
  });

  it('2. Explains truthful system boundaries: no combined stream, model scope, and no identity inference', () => {
    const onNavigate = vi.fn();
    render(<LiveMonitoringView onNavigate={onNavigate} />);

    // Clearly states no combined live feed is integrated
    expect(
      screen.getAllByText(/Chưa tích hợp luồng trực tiếp|No combined live/i).length,
    ).toBeGreaterThan(0);

    // Clearly states active model scope: Hard Hat and Safety Vest only
    expect(
      screen.getAllByText(/Mũ bảo hộ & Áo phản quang|Hard Hat & Safety Vest/i).length,
    ).toBeGreaterThan(0);

    // Explicitly states no worker identity or authorization is inferred from preview
    expect(
      screen.getAllByText(
        /không suy đoán danh tính công nhân hoặc thẩm quyền|does not infer worker identity/i,
      ).length,
    ).toBeGreaterThan(0);
  });

  it('3. Provides working onNavigate buttons to PPE, Zones, and Safety Alerts', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<LiveMonitoringView onNavigate={onNavigate} />);

    // Navigation button for PPE Monitoring ('ppe')
    const ppeBtn = screen.getByRole('button', { name: /Vào Giám sát Trang bị Bảo hộ/i });
    await user.click(ppeBtn);
    expect(onNavigate).toHaveBeenCalledWith('ppe');

    // Navigation button for Restricted Zones ('zones')
    const zoneBtn = screen.getByRole('button', { name: /Vào Giám sát Khu vực Hạn chế/i });
    await user.click(zoneBtn);
    expect(onNavigate).toHaveBeenCalledWith('zones');

    // Navigation button for Safety Alerts ('incidents')
    const alertsBtn = screen.getByRole('button', { name: /Vào Cảnh báo An toàn/i });
    await user.click(alertsBtn);
    expect(onNavigate).toHaveBeenCalledWith('incidents');

    expect(onNavigate).toHaveBeenCalledTimes(3);
  });
});
