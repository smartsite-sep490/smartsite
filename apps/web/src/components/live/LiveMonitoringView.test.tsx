// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import i18n from '../../i18n';
import { LiveMonitoringView } from './LiveMonitoringView';

describe('LiveMonitoringView - Truthful Minimalist Monitoring Entry', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllEnvs();
    window.localStorage.clear();
    await i18n.changeLanguage('en');
  });

  it('1. Rejects fake live data, fake worker names/IDs, fabricated verdicts/counts, ungrounded WebSocket or two-PPE-only claims, and MF badges', () => {
    const onNavigate = vi.fn();
    const { container } = render(<LiveMonitoringView onNavigate={onNavigate} />);

    // Must NOT contain fake worker names or event/worker IDs
    expect(screen.queryByText(/Nguyen Van A/i)).toBeNull();
    expect(screen.queryByText(/Tran Van B/i)).toBeNull();
    expect(screen.queryByText(/Le Van C/i)).toBeNull();
    expect(screen.queryByText(/EVT-2049|W-1024/i)).toBeNull();

    // Must NOT contain fake detections, authorization verdicts, or ungrounded two-PPE-only / WebSocket stream claims
    expect(screen.queryByText(/Missing Gloves/i)).toBeNull();
    expect(screen.queryByText(/Not Authorized/i)).toBeNull();
    expect(screen.queryByText(/Hard Hat & Safety Vest/i)).toBeNull();
    expect(screen.queryByText(/Mũ bảo hộ & Áo phản quang/i)).toBeNull();
    expect(screen.queryByText(/WebSocket/i)).toBeNull();

    // Must NOT display fake camera live feeds with hardcoded timestamps or multi-camera capacity claims
    expect(screen.queryByText(/LIVE - 10:42/i)).toBeNull();
    expect(
      screen.queryByText(/displaying real-time safety detections across all cameras/i),
    ).toBeNull();
    expect(screen.queryByText(/Combined feed of PPE and Zone events across the site/i)).toBeNull();

    // Must NOT display internal flow badges (MF04, MF05, MF06) or render live video/canvas/img pixels
    expect(screen.queryByText(/\bMF0[456]\b/i)).toBeNull();
    expect(container.querySelector('video, canvas, img')).toBeNull();
  });

  it('2. Explains truthful navigation/configuration overview boundaries when VITE_AI_WORK_PAUSED=false without promising an active model or camera stream', () => {
    const onNavigate = vi.fn();
    render(<LiveMonitoringView onNavigate={onNavigate} />);

    // Default env (VITE_AI_WORK_PAUSED=false) does not show paused banner and does not claim a model is active
    expect(screen.queryByTestId('live-overview-ai-paused-banner')).toBeNull();

    // Explains this is a navigation and configuration overview with no combined feed, active model runtime, or incident count loaded here
    expect(
      screen.getByText(
        /Navigation and configuration overview only — no combined multi-camera live feed, active model runtime, or incident count is loaded on this page\./i,
      ),
    ).toBeTruthy();

    // Explains runtime evidence lives in the selected camera page and preview observations never infer worker identity or access authorization
    expect(
      screen.getByText(
        /Camera availability and technical observation evidence are evaluated only on the selected camera page; preview observations never infer worker identity or access authorization\./i,
      ),
    ).toBeTruthy();

    // EN mode has zero leftover hardcoded Vietnamese copy
    expect(
      screen.queryByText(
        /Giám sát|Chưa tích hợp|Vào Giám sát|Vào Cảnh báo|Cảnh báo An toàn/i,
      ),
    ).toBeNull();
  });

  it('3. Renders a truthful paused banner when VITE_AI_WORK_PAUSED=true while keeping stored configuration and navigation targets accessible across EN -> VI -> EN', async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<LiveMonitoringView onNavigate={onNavigate} />);

    const banner = screen.getByTestId('live-overview-ai-paused-banner');
    expect(banner).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'AI Monitoring & Camera Analysis Paused',
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /All AI model inference and live camera analysis are currently paused by operator configuration\. Stored zone\/region configurations and persisted safety alert records remain accessible through the workspaces below\./i,
      ),
    ).toBeTruthy();

    // Switch to VI while paused
    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Giám sát AI & Phân tích Camera đang tạm dừng',
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Toàn bộ suy luận mô hình AI và phân tích luồng camera hiện đang tạm dừng theo cấu hình vận hành\. Các cấu hình khu vực\/vùng quan sát đã lưu và bản ghi cảnh báo an toàn vẫn có thể truy cập qua các mục bên dưới\./i,
      ),
    ).toBeTruthy();

    // Switch back to EN while paused
    await act(async () => {
      await i18n.changeLanguage('en');
    });

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'AI Monitoring & Camera Analysis Paused',
      }),
    ).toBeTruthy();

    // Navigation to stored configuration & alert workspaces remains active while AI is paused
    await user.click(screen.getByRole('button', { name: 'Open PPE Monitoring' }));
    expect(onNavigate).toHaveBeenLastCalledWith('ppe');
    await user.click(screen.getByRole('button', { name: 'Open Restricted Zones' }));
    expect(onNavigate).toHaveBeenLastCalledWith('zones');
    await user.click(screen.getByRole('button', { name: 'Open Safety Alerts' }));
    expect(onNavigate).toHaveBeenLastCalledWith('incidents');
    expect(onNavigate).toHaveBeenCalledTimes(3);
  });

  it('4. Re-renders all headings, descriptions, and action buttons via shared single-engine i18n runtime across EN -> VI -> EN while preserving the 3 navigation targets', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<LiveMonitoringView onNavigate={onNavigate} />);

    // Initial EN render: pure English headings, descriptions, and buttons
    expect(
      screen.getByRole('heading', { level: 1, name: 'Safety Monitoring Overview' }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'PPE Monitoring' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Restricted Zones' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Safety Alerts' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Open PPE Monitoring' }));
    expect(onNavigate).toHaveBeenLastCalledWith('ppe');
    await user.click(screen.getByRole('button', { name: 'Open Restricted Zones' }));
    expect(onNavigate).toHaveBeenLastCalledWith('zones');
    await user.click(screen.getByRole('button', { name: 'Open Safety Alerts' }));
    expect(onNavigate).toHaveBeenLastCalledWith('incidents');
    expect(onNavigate).toHaveBeenCalledTimes(3);

    // Switch single-engine runtime to VI
    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    expect(
      screen.getByRole('heading', { level: 1, name: 'Tổng quan Giám sát An toàn' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Giám sát Trang bị Bảo hộ' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Giám sát Khu vực Hạn chế' }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Cảnh báo An toàn' })).toBeTruthy();
    expect(
      screen.getByText(
        /Trang tổng quan điều hướng và cấu hình — trang này không tải luồng trực tiếp đa camera đồng thời, không nạp tiến trình mô hình AI và không tổng hợp số lượng sự cố\./i,
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole('heading', { level: 1, name: 'Safety Monitoring Overview' }),
    ).toBeNull();
    expect(screen.queryByText(/Nguyen Van A|Tran Van B|Le Van C|EVT-2049|W-1024/i)).toBeNull();

    // Navigation callbacks remain functional in VI
    await user.click(screen.getByRole('button', { name: 'Vào Giám sát Trang bị Bảo hộ' }));
    expect(onNavigate).toHaveBeenLastCalledWith('ppe');
    await user.click(screen.getByRole('button', { name: 'Vào Giám sát Khu vực Hạn chế' }));
    expect(onNavigate).toHaveBeenLastCalledWith('zones');
    await user.click(screen.getByRole('button', { name: 'Vào Cảnh báo An toàn' }));
    expect(onNavigate).toHaveBeenLastCalledWith('incidents');
    expect(onNavigate).toHaveBeenCalledTimes(6);

    // Switch back to EN
    await act(async () => {
      await i18n.changeLanguage('en');
    });

    expect(
      screen.getByRole('heading', { level: 1, name: 'Safety Monitoring Overview' }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'PPE Monitoring' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Restricted Zones' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Safety Alerts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open PPE Monitoring' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Restricted Zones' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Safety Alerts' })).toBeTruthy();
    expect(
      screen.queryByRole('heading', { level: 1, name: 'Tổng quan Giám sát An toàn' }),
    ).toBeNull();
  });
});
