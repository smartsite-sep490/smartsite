// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SafetyEpisodeInboxItem } from '@smartsite/contracts';
import i18n from '../../../i18n';
import { SafetyEpisodeInboxList } from './SafetyEpisodeInboxList';

function item(id: string, revision: number): SafetyEpisodeInboxItem {
  return {
    id,
    seenRevision: 0,
    unread: true,
    firstDeliveredAt: '2026-10-26T01:00:00Z',
    updatedAt: '2026-10-26T01:00:00Z',
    episode: {
      id: `episode-${id}`,
      siteId: 'site-a',
      cameraId: 'camera-a',
      subject: {
        kind: 'EVENT_LOCAL',
        eventId: '10000000-0000-4000-8000-000000000001',
        personObservationIndex: 0,
      },
      configurationBundleId: null,
      firstObservedAt: '2026-10-26T01:00:00Z',
      lastObservedAt: '2026-10-26T01:00:01Z',
      contentRevision: revision,
      collectionState: 'SEALED',
      findingCount: 2,
    },
  };
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(cleanup);

it('reports latest server total even when retained loaded rows exceed it', () => {
  render(
    <SafetyEpisodeInboxList
      items={[item('a', 1), item('b', 1)]}
      total={1}
      unreadCount={1}
      selectedEpisodeId={null}
      onSelectEpisode={vi.fn()}
    />,
  );
  expect(screen.getByTestId('safety-episode-inbox-total-summary').textContent).toBe('Total: 1');
  expect(screen.getAllByRole('button', { name: 'Inspect person episode' })).toHaveLength(2);
});

it('keeps newer revision when stale page repeats the same inbox item later', () => {
  const select = vi.fn(),
    markRead = vi.fn();
  render(
    <SafetyEpisodeInboxList
      items={[item('a', 5), item('a', 3)]}
      total={1}
      unreadCount={1}
      selectedEpisodeId={null}
      onSelectEpisode={select}
      onMarkRead={markRead}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Inspect person episode' }));
  expect(select.mock.calls[0]?.[0].contentRevision).toBe(5);
  fireEvent.click(screen.getByRole('button', { name: 'Mark read (rev #5)' }));
  expect(markRead).toHaveBeenCalledExactlyOnceWith('a', { seenRevision: 5 });
});
