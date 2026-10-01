import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { WorkerEnrollmentView } from './WorkerEnrollmentView';

describe('account-first enrollment', () => {
  it('requires selection of an existing account and never offers free-form worker creation', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <WorkerEnrollmentView
          apiUrl="https://api.example.test"
          siteId="site-1"
          sessionScope="synthetic-session"
        />
      </QueryClientProvider>,
    );
    expect(html).toContain('face-account-search');
    expect(html).toContain('Chọn account đã có trên hệ thống');
    expect(html).not.toContain('worker-select');
    expect(html).not.toContain('Tạo &amp; chọn');
    expect(html).not.toContain('name="externalId"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>/);
    queryClient.clear();
  });
});
