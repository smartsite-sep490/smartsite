// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setSharedRuntimeLocale } from '../../i18n/locale-context';
import { PpeResultVerdict, type PpeResultVerdictProps } from './PpeResultVerdict';

function buildProps(overrides: Partial<PpeResultVerdictProps> = {}): PpeResultVerdictProps {
  return {
    ppeResultState: 'UNKNOWN',
    hasExpandedReported: false,
    hasPreview: true,
    activeStatus: 'LIVE',
    detectionsCount: 1,
    effectiveStreamViewMode: 'ai-analyzed',
    isLive: true,
    activeSourceKind: 'LIVE',
    ...overrides,
  };
}

describe('PpeResultVerdict', () => {
  beforeEach(() => {
    setSharedRuntimeLocale('en');
  });

  afterEach(() => {
    cleanup();
    setSharedRuntimeLocale('en');
  });

  it('keeps header, styling, and description neutral when frame is UNAVAILABLE or not live even if stale COMPLIANT or CONFIRMED_MISSING state is passed', () => {
    const { rerender } = render(
      <PpeResultVerdict
        {...buildProps({
          ppeResultState: 'COMPLIANT',
          hasExpandedReported: false,
          hasPreview: true,
          activeStatus: 'UNAVAILABLE',
          isLive: false,
          effectiveStreamViewMode: 'ai-analyzed',
        })}
      />,
    );

    const verdict = screen.getByTestId('ppe-result-verdict');
    expect(verdict.getAttribute('role')).toBe('status');
    expect(verdict.getAttribute('aria-live')).toBe('polite');
    expect(verdict.className).toContain('border-slate-300');
    expect(verdict.className).not.toContain('border-emerald-500');
    expect(verdict.className).not.toContain('border-red-500');

    expect(screen.getByText('AI EVIDENCE UNAVAILABLE')).toBeTruthy();
    expect(screen.getByText('Camera snapshot is unavailable or offline.')).toBeTruthy();
    expect(screen.queryByText('HELMET AND VEST DETECTED')).toBeNull();
    expect(screen.queryByText('CORE AND REPORTED PPE DETECTED')).toBeNull();
    expect(screen.queryByText('MISSING PPE DETECTED')).toBeNull();

    // Unavailable in live-raw mode with stale CONFIRMED_MISSING state
    rerender(
      <PpeResultVerdict
        {...buildProps({
          ppeResultState: 'CONFIRMED_MISSING',
          hasExpandedReported: true,
          hasPreview: false,
          activeStatus: 'UNAVAILABLE',
          isLive: false,
          effectiveStreamViewMode: 'live-raw',
        })}
      />,
    );

    expect(verdict.className).toContain('border-slate-300');
    expect(verdict.className).not.toContain('border-red-500');
    expect(screen.getByText('AI EVIDENCE UNAVAILABLE')).toBeTruthy();
    expect(
      screen.getByText(
        'Displaying unanalyzed raw camera feed. AI snapshot inspection is currently unavailable.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('MISSING PPE DETECTED')).toBeNull();

    // Non-live transition (e.g. applying region configuration) with stale COMPLIANT state in Vietnamese
    act(() => {
      setSharedRuntimeLocale('vi');
    });

    rerender(
      <PpeResultVerdict
        {...buildProps({
          ppeResultState: 'COMPLIANT',
          hasExpandedReported: true,
          hasPreview: true,
          activeStatus: 'LIVE',
          isLive: false,
          effectiveStreamViewMode: 'ai-analyzed',
        })}
      />,
    );

    expect(verdict.className).toContain('border-slate-300');
    expect(screen.getByText('BẰNG CHỨNG AI KHÔNG KHẢ DỤNG')).toBeTruthy();
    expect(
      screen.getByText('Ảnh chụp camera hiện không khả dụng hoặc đang ngoại tuyến.'),
    ).toBeTruthy();
    expect(screen.queryByText('GHI NHẬN PPE CƠ BẢN VÀ HẠNG MỤC BÁO CÁO')).toBeNull();
  });

  it('never claims NO OBSERVATIONS, SCANNING SNAPSHOT, or COMPLIANT while activeStatus is CONNECTING with 0 or more detections', () => {
    const { rerender } = render(
      <PpeResultVerdict
        {...buildProps({
          ppeResultState: 'NO_TARGETS',
          hasPreview: true,
          activeStatus: 'CONNECTING',
          detectionsCount: 0,
          isLive: false,
          effectiveStreamViewMode: 'ai-analyzed',
        })}
      />,
    );

    const verdict = screen.getByTestId('ppe-result-verdict');
    expect(verdict.getAttribute('role')).toBe('status');
    expect(verdict.getAttribute('aria-live')).toBe('polite');
    expect(verdict.className).toContain('border-slate-300');
    expect(screen.getByText('AI EVIDENCE UNAVAILABLE')).toBeTruthy();
    expect(screen.getByText('Camera snapshot is unavailable or offline.')).toBeTruthy();
    expect(screen.queryByText('NO OBSERVATIONS')).toBeNull();
    expect(screen.queryByText('SCANNING SNAPSHOT')).toBeNull();

    // Connecting with non-zero detections or stale COMPLIANT still reports unavailable evidence
    rerender(
      <PpeResultVerdict
        {...buildProps({
          ppeResultState: 'COMPLIANT',
          hasPreview: false,
          activeStatus: 'CONNECTING',
          detectionsCount: 2,
          isLive: false,
          effectiveStreamViewMode: 'ai-analyzed',
        })}
      />,
    );

    expect(screen.getByText('AI EVIDENCE UNAVAILABLE')).toBeTruthy();
    expect(screen.getByText('Camera snapshot is unavailable or offline.')).toBeTruthy();
    expect(screen.queryByText('HELMET AND VEST DETECTED')).toBeNull();
    expect(screen.queryByText('SCANNING SNAPSHOT')).toBeNull();
  });

  it('renders fresh explicit CONFIRMED_MISSING and COMPLIANT verdicts with matching header and description in EN and VI', () => {
    const { rerender } = render(
      <PpeResultVerdict
        {...buildProps({
          ppeResultState: 'CONFIRMED_MISSING',
          hasExpandedReported: false,
          hasPreview: true,
          activeStatus: 'LIVE',
          isLive: true,
          detectionsCount: 1,
        })}
      />,
    );

    const verdict = screen.getByTestId('ppe-result-verdict');
    expect(verdict.className).toContain('border-red-500');
    expect(screen.getByText('MISSING PPE DETECTED')).toBeTruthy();
    expect(screen.getByText('Missing PPE observed in snapshot.')).toBeTruthy();

    // Fresh COMPLIANT (core items only)
    rerender(
      <PpeResultVerdict
        {...buildProps({
          ppeResultState: 'COMPLIANT',
          hasExpandedReported: false,
          hasPreview: true,
          activeStatus: 'LIVE',
          isLive: true,
          detectionsCount: 1,
        })}
      />,
    );

    expect(verdict.className).toContain('border-emerald-500');
    expect(screen.getByText('HELMET AND VEST DETECTED')).toBeTruthy();
    expect(
      screen.getByText('Expanded items (gloves, boots, goggles) are not assessed.'),
    ).toBeTruthy();

    // Fresh COMPLIANT (core + expanded reported items)
    rerender(
      <PpeResultVerdict
        {...buildProps({
          ppeResultState: 'COMPLIANT',
          hasExpandedReported: true,
          hasPreview: true,
          activeStatus: 'REPLAY',
          activeSourceKind: 'REPLAY',
          isLive: true,
          detectionsCount: 2,
        })}
      />,
    );

    expect(verdict.className).toContain('border-emerald-500');
    expect(screen.getByText('CORE AND REPORTED PPE DETECTED')).toBeTruthy();
    expect(
      screen.getByText('Helmet, safety vest, and reported expanded PPE items detected.'),
    ).toBeTruthy();

    // Switch to Vietnamese and verify fresh CONFIRMED_MISSING & COMPLIANT
    act(() => {
      setSharedRuntimeLocale('vi');
    });

    rerender(
      <PpeResultVerdict
        {...buildProps({
          ppeResultState: 'CONFIRMED_MISSING',
          hasPreview: true,
          activeStatus: 'REPLAY',
          activeSourceKind: 'REPLAY',
          isLive: true,
          detectionsCount: 1,
        })}
      />,
    );

    expect(screen.getByText('PHÁT HIỆN THIẾU BẢO HỘ (PPE)')).toBeTruthy();
    expect(screen.getByText('Ghi nhận thiếu trang bị bảo hộ (PPE) trong ảnh chụp.')).toBeTruthy();
  });

  it('renders fresh NO_TARGETS, PENDING_CONFIRMATION, and UNKNOWN verdicts for zero detections and active detections across LIVE and REPLAY streams', () => {
    const { rerender } = render(
      <PpeResultVerdict
        {...buildProps({
          ppeResultState: 'NO_TARGETS',
          hasPreview: true,
          activeStatus: 'LIVE',
          activeSourceKind: 'LIVE',
          isLive: true,
          detectionsCount: 0,
        })}
      />,
    );

    expect(screen.getByText('NO OBSERVATIONS')).toBeTruthy();
    expect(
      screen.getByText(
        'Streaming live snapshot from Camera Preview API. Zero detections do not certify safety clearance.',
      ),
    ).toBeTruthy();

    rerender(
      <PpeResultVerdict
        {...buildProps({
          ppeResultState: 'NO_TARGETS',
          hasPreview: true,
          activeStatus: 'REPLAY',
          activeSourceKind: 'REPLAY',
          isLive: true,
          detectionsCount: 0,
        })}
      />,
    );

    expect(screen.getByText('NO OBSERVATIONS')).toBeTruthy();
    expect(
      screen.getByText(
        'Rendering recorded video replay stream from Camera Preview API. Zero detections do not certify safety clearance.',
      ),
    ).toBeTruthy();

    rerender(
      <PpeResultVerdict
        {...buildProps({
          ppeResultState: 'PENDING_CONFIRMATION',
          hasPreview: true,
          activeStatus: 'REPLAY',
          activeSourceKind: 'REPLAY',
          isLive: true,
          detectionsCount: 2,
        })}
      />,
    );

    expect(screen.getByText('SCANNING SNAPSHOT')).toBeTruthy();
    expect(
      screen.getByText('Rendering recorded video replay stream from Camera Preview API.'),
    ).toBeTruthy();

    rerender(
      <PpeResultVerdict
        {...buildProps({
          ppeResultState: 'UNKNOWN',
          hasPreview: true,
          activeStatus: 'LIVE',
          activeSourceKind: 'LIVE',
          isLive: true,
          detectionsCount: 1,
        })}
      />,
    );

    expect(screen.getByText('SCANNING SNAPSHOT')).toBeTruthy();
    expect(screen.getByText('Streaming live snapshot from Camera Preview API.')).toBeTruthy();
  });

  it('renders mode-neutral recorded-video description in EN and VI when effectiveStreamViewMode is recorded-raw and AI frame is unavailable', () => {
    const { rerender } = render(
      <PpeResultVerdict
        {...buildProps({
          ppeResultState: 'COMPLIANT',
          hasExpandedReported: true,
          hasPreview: false,
          activeStatus: 'UNAVAILABLE',
          isLive: false,
          effectiveStreamViewMode: 'recorded-raw',
        })}
      />,
    );

    const verdict = screen.getByTestId('ppe-result-verdict');
    expect(verdict.getAttribute('role')).toBe('status');
    expect(verdict.getAttribute('aria-live')).toBe('polite');
    expect(verdict.className).toContain('border-slate-300');
    expect(verdict.className).not.toContain('border-emerald-500');
    expect(screen.getByText('AI EVIDENCE UNAVAILABLE')).toBeTruthy();
    expect(
      screen.getByText(
        'Selected recorded-video view; no synchronized AI snapshot available for PPE inspection.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Camera snapshot is unavailable or offline.')).toBeNull();
    expect(
      screen.queryByText(
        'Displaying unanalyzed raw camera feed. AI snapshot inspection is currently unavailable.',
      ),
    ).toBeNull();
    expect(screen.queryByText('CORE AND REPORTED PPE DETECTED')).toBeNull();

    act(() => {
      setSharedRuntimeLocale('vi');
    });

    rerender(
      <PpeResultVerdict
        {...buildProps({
          ppeResultState: 'CONFIRMED_MISSING',
          hasExpandedReported: false,
          hasPreview: true,
          activeStatus: 'CONNECTING',
          isLive: false,
          effectiveStreamViewMode: 'recorded-raw',
        })}
      />,
    );

    expect(verdict.className).toContain('border-slate-300');
    expect(verdict.className).not.toContain('border-red-500');
    expect(screen.getByText('BẰNG CHỨNG AI KHÔNG KHẢ DỤNG')).toBeTruthy();
    expect(
      screen.getByText(
        'Đã chọn chế độ xem video ghi sẵn; không có ảnh chụp AI đồng bộ để kiểm tra PPE.',
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText('Ảnh chụp camera hiện không khả dụng hoặc đang ngoại tuyến.'),
    ).toBeNull();
    expect(screen.queryByText('PHÁT HIỆN THIẾU PPE')).toBeNull();
  });
});
