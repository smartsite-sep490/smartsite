import { describe, expect, it } from 'vitest';
import { workspaceTabs } from './workspace-access';

describe('camera setup navigation scope', () => {
  it('opens setup only for global Admin or explicitly assigned Site Manager', () => {
    expect(workspaceTabs([{ role: 'ADMIN', siteId: null }])).toContain('camera-setup');
    expect(workspaceTabs([{ role: 'SITE_MANAGER', siteId: 'assigned-site' }])).toContain(
      'camera-setup',
    );
    expect(workspaceTabs([{ role: 'SITE_MANAGER', siteId: null }])).not.toContain('camera-setup');
  });

  it.each(['SAFETY_OFFICER', 'CONTRACTOR_REPRESENTATIVE', 'SECURITY_OFFICER', 'WORKER'] as const)(
    'does not grant setup to %s',
    (role) =>
      expect(workspaceTabs([{ role, siteId: 'assigned-site' }])).not.toContain('camera-setup'),
  );
});
