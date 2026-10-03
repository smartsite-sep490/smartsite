import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { describe, expect, it } from 'vitest';
import { GatePermissionEditor } from './WorkerGatePermissionsView';

describe('worker gate permissions', () => {
  it('offers the three real Gate Desk gates and checks only a currently allowed gate', () => {
    const queryClient = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <GatePermissionEditor
          client={new SmartSiteManagementClient('https://api.example.test')}
          token="synthetic-token"
          siteId="site-1"
          onSaved={() => undefined}
          snapshot={{
            workerId: 'worker-1',
            items: [
              {
                id: 'permission-1',
                gateId: 'gate-north-01',
                validFrom: '2020-01-01T00:00:00Z',
                validUntil: null,
              },
              {
                id: 'permission-2',
                gateId: 'gate-west-02',
                validFrom: '2020-01-01T00:00:00Z',
                validUntil: '2021-01-01T00:00:00Z',
              },
            ],
          }}
        />
      </QueryClientProvider>,
    );
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain('Gate 1');
    expect(html).toContain('Gate 2');
    expect(html).toContain('Gate 3');
    expect(html).toContain('Không chọn cửa nào');
    expect(html).not.toContain('Restricted Zone');
    queryClient.clear();
  });
});
