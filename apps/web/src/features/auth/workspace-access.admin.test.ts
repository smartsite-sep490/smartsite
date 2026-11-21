import { describe, expect, it } from 'vitest';
import { workspaceTabs, defaultWorkspace } from './workspace-access';
import { getWorkforceTabs } from '../../components/workforce/utils/workforce-tabs';

describe('administrative workspace boundary', () => {
  it('does not give a mixed Admin/Worker a workforce review tab', () => {
    expect(getWorkforceTabs(['ADMIN', 'WORKER']).showReview).toBe(false);
  });
  it('gives a global administrator only the three management workspaces', () => {
    const roles = [{ role: 'ADMIN' as const, siteId: null }];
    expect(workspaceTabs(roles)).toEqual(['dashboard', 'accounts', 'site-setup']);
    expect(defaultWorkspace(roles)).toBe('dashboard');
  });
  it('retains explicitly assigned operational roles', () => {
    expect(
      workspaceTabs([
        { role: 'ADMIN', siteId: null },
        { role: 'SITE_MANAGER', siteId: 'site-a' },
      ]),
    ).toContain('camera-setup');
    expect(workspaceTabs([{ role: 'ADMIN', siteId: 'site-a' }])).toEqual([]);
  });
});
