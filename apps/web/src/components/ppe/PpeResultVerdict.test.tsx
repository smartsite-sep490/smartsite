// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { PpeResultVerdict, type PpeResultVerdictProps } from './PpeResultVerdict';

const baseProps: PpeResultVerdictProps = {
  ppeResultState: 'UNKNOWN',
  hasExpandedReported: false,
  hasPreview: true,
  activeStatus: 'LIVE',
  detectionsCount: 1,
  effectiveStreamViewMode: 'ai-analyzed',
  isLive: true,
  activeSourceKind: 'LIVE',
};

describe('PpeResultVerdict stateless parity', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('renders CONFIRMED_MISSING with red border/text classes and missing description when live snapshot is active', () => {
    render(
      <PpeResultVerdict {...baseProps} ppeResultState="CONFIRMED_MISSING" detectionsCount={1} />,
    );

    const verdict = screen.getByTestId('ppe-result-verdict');
    expect(verdict.className).toContain('border-red-500 bg-red-50/50');
    expect(screen.getByText('RESULT')).not.toBeNull();
    expect(screen.getByText('MISSING PPE DETECTED')).not.toBeNull();
    expect(screen.getByText('Missing PPE observed in snapshot.')).not.toBeNull();
  });

  it('renders COMPLIANT core-only vs expanded reported copy and emerald styling', () => {
    const { rerender } = render(
      <PpeResultVerdict {...baseProps} ppeResultState="COMPLIANT" hasExpandedReported={false} />,
    );

    const verdict = screen.getByTestId('ppe-result-verdict');
    expect(verdict.className).toContain('border-emerald-500 bg-emerald-50/40');
    expect(screen.getByText('HELMET AND VEST DETECTED')).not.toBeNull();
    expect(
      screen.getByText('Expanded items (gloves, boots, goggles) are not assessed.'),
    ).not.toBeNull();

    rerender(
      <PpeResultVerdict {...baseProps} ppeResultState="COMPLIANT" hasExpandedReported={true} />,
    );

    expect(screen.getByText('CORE AND REPORTED PPE DETECTED')).not.toBeNull();
    expect(
      screen.getByText('Helmet, safety vest, and reported expanded PPE items detected.'),
    ).not.toBeNull();
  });

  it('distinguishes unavailable AI snapshot in live-raw mode vs ai-analyzed/recorded-raw offline fallback', () => {
    const { rerender } = render(
      <PpeResultVerdict
        {...baseProps}
        ppeResultState="NO_TARGETS"
        hasPreview={false}
        activeStatus="UNAVAILABLE"
        detectionsCount={0}
        effectiveStreamViewMode="live-raw"
        isLive={false}
        activeSourceKind={null}
      />,
    );

    const verdict = screen.getByTestId('ppe-result-verdict');
    expect(verdict.className).toContain('border-slate-300 bg-slate-50/80');
    expect(screen.getByText('AI EVIDENCE UNAVAILABLE')).not.toBeNull();
    expect(
      screen.getByText(
        'Displaying unanalyzed raw camera feed. AI snapshot inspection is currently unavailable.',
      ),
    ).not.toBeNull();

    rerender(
      <PpeResultVerdict
        {...baseProps}
        ppeResultState="NO_TARGETS"
        hasPreview={false}
        activeStatus="UNAVAILABLE"
        detectionsCount={0}
        effectiveStreamViewMode="ai-analyzed"
        isLive={false}
        activeSourceKind={null}
      />,
    );

    expect(screen.getByText('AI EVIDENCE UNAVAILABLE')).not.toBeNull();
    expect(screen.getByText('Camera snapshot is unavailable or offline.')).not.toBeNull();
  });

  it('preserves exact condition precedence when activeStatus is UNAVAILABLE or hasPreview is false alongside CONFIRMED_MISSING or COMPLIANT', () => {
    const { rerender } = render(
      <PpeResultVerdict
        {...baseProps}
        ppeResultState="CONFIRMED_MISSING"
        hasPreview={true}
        activeStatus="UNAVAILABLE"
        effectiveStreamViewMode="live-raw"
        isLive={false}
      />,
    );

    // Heading checks CONFIRMED_MISSING first, while description checks !hasPreview || UNAVAILABLE first
    expect(screen.getByText('MISSING PPE DETECTED')).not.toBeNull();
    expect(
      screen.getByText(
        'Displaying unanalyzed raw camera feed. AI snapshot inspection is currently unavailable.',
      ),
    ).not.toBeNull();

    rerender(
      <PpeResultVerdict
        {...baseProps}
        ppeResultState="COMPLIANT"
        hasExpandedReported={false}
        hasPreview={false}
        activeStatus="LIVE"
        effectiveStreamViewMode="ai-analyzed"
        isLive={true}
      />,
    );

    expect(screen.getByText('HELMET AND VEST DETECTED')).not.toBeNull();
    expect(screen.getByText('Camera snapshot is unavailable or offline.')).not.toBeNull();
  });

  it('renders NO OBSERVATIONS with distinct live, replay (via status or sourceKind), and offline descriptions', () => {
    const { rerender } = render(
      <PpeResultVerdict
        {...baseProps}
        ppeResultState="NO_TARGETS"
        detectionsCount={0}
        activeStatus="LIVE"
        activeSourceKind="LIVE"
        isLive={true}
      />,
    );

    expect(screen.getByText('NO OBSERVATIONS')).not.toBeNull();
    expect(
      screen.getByText(
        'Streaming live snapshot from Camera Preview API. Zero detections do not certify safety clearance.',
      ),
    ).not.toBeNull();

    // Replay via activeStatus === 'REPLAY'
    rerender(
      <PpeResultVerdict
        {...baseProps}
        ppeResultState="NO_TARGETS"
        detectionsCount={0}
        activeStatus="REPLAY"
        activeSourceKind="LIVE"
        isLive={true}
      />,
    );

    expect(screen.getByText('NO OBSERVATIONS')).not.toBeNull();
    expect(
      screen.getByText(
        'Rendering recorded video replay stream from Camera Preview API. Zero detections do not certify safety clearance.',
      ),
    ).not.toBeNull();

    // Replay via activeSourceKind === 'REPLAY' while activeStatus is 'LIVE'
    rerender(
      <PpeResultVerdict
        {...baseProps}
        ppeResultState="NO_TARGETS"
        detectionsCount={0}
        activeStatus="LIVE"
        activeSourceKind="REPLAY"
        isLive={true}
      />,
    );

    expect(
      screen.getByText(
        'Rendering recorded video replay stream from Camera Preview API. Zero detections do not certify safety clearance.',
      ),
    ).not.toBeNull();

    // Not live (e.g. applying or non-live status with preview present)
    rerender(
      <PpeResultVerdict
        {...baseProps}
        ppeResultState="NO_TARGETS"
        detectionsCount={0}
        activeStatus="CONNECTING"
        activeSourceKind="LIVE"
        isLive={false}
      />,
    );

    expect(screen.getByText('NO OBSERVATIONS')).not.toBeNull();
    expect(screen.getByText('Camera snapshot is unavailable or offline.')).not.toBeNull();
  });

  it('renders SCANNING SNAPSHOT for UNKNOWN and PENDING_CONFIRMATION across live, replay, and offline states, and supports Vietnamese i18n', async () => {
    const { rerender } = render(
      <PpeResultVerdict
        {...baseProps}
        ppeResultState="PENDING_CONFIRMATION"
        detectionsCount={2}
        activeStatus="LIVE"
        activeSourceKind="LIVE"
        isLive={true}
      />,
    );

    expect(screen.getByText('SCANNING SNAPSHOT')).not.toBeNull();
    expect(screen.getByText('Streaming live snapshot from Camera Preview API.')).not.toBeNull();

    rerender(
      <PpeResultVerdict
        {...baseProps}
        ppeResultState="UNKNOWN"
        detectionsCount={1}
        activeStatus="LIVE"
        activeSourceKind="REPLAY"
        isLive={true}
      />,
    );

    expect(screen.getByText('SCANNING SNAPSHOT')).not.toBeNull();
    expect(
      screen.getByText('Rendering recorded video replay stream from Camera Preview API.'),
    ).not.toBeNull();

    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    expect(screen.getByText('KẾT QUẢ')).not.toBeNull();
    expect(screen.getByText('ĐANG QUÉT ẢNH CHỤP')).not.toBeNull();
    expect(
      screen.getByText('Đang hiển thị luồng phát lại video ghi sẵn từ Camera Preview API.'),
    ).not.toBeNull();
  });
});
