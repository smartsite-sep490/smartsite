// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import i18n from '../../i18n';
import { LiveMonitoringView } from './LiveMonitoringView';

beforeEach(async () => {
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
  await i18n.changeLanguage('en');
  vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview');
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await i18n.changeLanguage('en');
});

it('offers a direct setup action only when its parent supplies the existing setup capability', () => {
  const onNavigate = vi.fn();
  const { rerender } = render(<LiveMonitoringView onNavigate={onNavigate} />);
  expect(screen.queryByRole('button', { name: 'Camera setup' })).toBeNull();
  rerender(<LiveMonitoringView onNavigate={onNavigate} canOpenCameraSetup />);
  fireEvent.click(screen.getByRole('button', { name: 'Camera setup' }));
  expect(onNavigate).toHaveBeenCalledWith('camera-setup');
  expect(SmartSiteManagementClient.prototype.getCameraPreview).not.toHaveBeenCalled();
});

it('keeps the setup action localized and usable while AI is paused without loading pixels', async () => {
  const onNavigate = vi.fn();
  const { container } = render(<LiveMonitoringView onNavigate={onNavigate} canOpenCameraSetup />);
  expect(screen.getByTestId('live-overview-ai-paused-banner')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Camera setup' })).toBeTruthy();
  await act(async () => {
    await i18n.changeLanguage('vi');
  });
  fireEvent.click(screen.getByRole('button', { name: 'Thiết lập camera' }));
  expect(onNavigate).toHaveBeenCalledWith('camera-setup');
  expect(screen.queryByRole('button', { name: 'Camera setup' })).toBeNull();
  expect(container.querySelector('video,canvas,img')).toBeNull();
  expect(SmartSiteManagementClient.prototype.getCameraPreview).not.toHaveBeenCalled();
});

it('removes the setup entry immediately when capability is revoked and preserves monitoring navigation', () => {
  const onNavigate = vi.fn();
  const { rerender } = render(<LiveMonitoringView onNavigate={onNavigate} canOpenCameraSetup />);
  expect(screen.getByRole('button', { name: 'Camera setup' })).toBeTruthy();
  rerender(<LiveMonitoringView onNavigate={onNavigate} canOpenCameraSetup={false} />);
  expect(screen.queryByRole('button', { name: 'Camera setup' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open PPE Monitoring' }));
  expect(onNavigate).toHaveBeenLastCalledWith('ppe');
  expect(SmartSiteManagementClient.prototype.getCameraPreview).not.toHaveBeenCalled();
});
