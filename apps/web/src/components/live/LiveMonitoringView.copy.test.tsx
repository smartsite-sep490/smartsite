// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { LiveMonitoringView } from './LiveMonitoringView';

function getCardDescription(headingName: string): string {
  const heading = screen.getByRole('heading', { level: 2, name: headingName });
  return heading.parentElement?.querySelector('p')?.textContent ?? '';
}

describe('LiveMonitoringView Monitoring vs Camera Setup Copy', () => {
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

  it('directs camera and region authoring to Camera setup / Thiết lập camera in EN and VI without telling users to configure polygon geometry inside Restricted Zones, while preserving ppe/zones/incidents navigation callbacks', async () => {
    const onNavigate = vi.fn();
    render(<LiveMonitoringView onNavigate={onNavigate} />);

    const ppeDescEn = getCardDescription('PPE Monitoring');
    const zonesDescEn = getCardDescription('Restricted Zones');

    expect(ppeDescEn).toMatch(/Camera setup/i);
    expect(zonesDescEn).toMatch(/Camera setup/i);
    expect(ppeDescEn).not.toMatch(/link camera observation regions/i);
    expect(zonesDescEn).not.toMatch(
      /restricted zone workspace to configure|configure polygon region geometry per camera and review/i,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open PPE Monitoring' }));
    expect(onNavigate).toHaveBeenLastCalledWith('ppe');
    fireEvent.click(screen.getByRole('button', { name: 'Open Restricted Zones' }));
    expect(onNavigate).toHaveBeenLastCalledWith('zones');
    fireEvent.click(screen.getByRole('button', { name: 'Open Safety Alerts' }));
    expect(onNavigate).toHaveBeenLastCalledWith('incidents');
    expect(onNavigate).toHaveBeenCalledTimes(3);

    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    const ppeDescVi = getCardDescription('Giám sát Trang bị Bảo hộ');
    const zonesDescVi = getCardDescription('Giám sát Khu vực Hạn chế');

    expect(ppeDescVi).toMatch(/Thiết lập camera/i);
    expect(zonesDescVi).toMatch(/Thiết lập camera/i);
    expect(ppeDescVi).not.toMatch(/liên kết vùng quan sát/i);
    expect(zonesDescVi).not.toMatch(
      /không gian khu vực hạn chế để cấu hình|cấu hình đa giác vùng quan sát theo từng camera,\s*xem/i,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Vào Giám sát Trang bị Bảo hộ' }));
    expect(onNavigate).toHaveBeenLastCalledWith('ppe');
    fireEvent.click(screen.getByRole('button', { name: 'Vào Giám sát Khu vực Hạn chế' }));
    expect(onNavigate).toHaveBeenLastCalledWith('zones');
    fireEvent.click(screen.getByRole('button', { name: 'Vào Cảnh báo An toàn' }));
    expect(onNavigate).toHaveBeenLastCalledWith('incidents');
    expect(onNavigate).toHaveBeenCalledTimes(6);
  });

  it('preserves the AI-paused banner and navigation callbacks across EN and VI when VITE_AI_WORK_PAUSED=true', async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    const onNavigate = vi.fn();
    render(<LiveMonitoringView onNavigate={onNavigate} />);

    expect(screen.getByTestId('live-overview-ai-paused-banner')).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'AI Monitoring & Camera Analysis Paused' }),
    ).toBeTruthy();

    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    expect(screen.getByTestId('live-overview-ai-paused-banner')).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Giám sát AI & Phân tích Camera đang tạm dừng',
      }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Vào Giám sát Trang bị Bảo hộ' }));
    expect(onNavigate).toHaveBeenLastCalledWith('ppe');
    fireEvent.click(screen.getByRole('button', { name: 'Vào Giám sát Khu vực Hạn chế' }));
    expect(onNavigate).toHaveBeenLastCalledWith('zones');
    fireEvent.click(screen.getByRole('button', { name: 'Vào Cảnh báo An toàn' }));
    expect(onNavigate).toHaveBeenLastCalledWith('incidents');
  });
});
