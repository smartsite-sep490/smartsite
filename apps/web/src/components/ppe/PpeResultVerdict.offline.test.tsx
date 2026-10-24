// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import i18n from '../../i18n';
import { PpeResultVerdict } from './PpeResultVerdict';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(cleanup);

it.each(['UNKNOWN', 'PENDING_CONFIRMATION'] as const)(
  'keeps %s observations distinct from offline streaming without claiming missing or compliant',
  (ppeResultState) => {
    render(
      <PpeResultVerdict
        ppeResultState={ppeResultState}
        hasExpandedReported={false}
        hasPreview
        activeStatus="CONNECTING"
        detectionsCount={1}
        effectiveStreamViewMode="ai-analyzed"
        isLive={false}
        activeSourceKind="REPLAY"
      />,
    );
    expect(screen.getByText('SCANNING SNAPSHOT')).toBeDefined();
    expect(screen.getByText('Camera snapshot is unavailable or offline.')).toBeDefined();
    expect(screen.queryByText('MISSING PPE DETECTED')).toBeNull();
    expect(screen.queryByText('HELMET AND VEST DETECTED')).toBeNull();
    expect(
      screen.queryByText('Rendering recorded video replay stream from Camera Preview API.'),
    ).toBeNull();
  },
);
