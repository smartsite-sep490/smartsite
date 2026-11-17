// @vitest-environment jsdom
import React, { createRef } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from './Button';

function parseHexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = Number.parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relativeLuminance(parseHexToRgb(fgHex));
  const l2 = relativeLuminance(parseHexToRgb(bgHex));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Button primary contrast hardening and caller compatibility (FE-F01)', () => {
  afterEach(() => {
    cleanup();
  });

  it('ensures primary small white text meets >= 4.5:1 WCAG AA contrast on both normal and hover backgrounds', () => {
    render(
      <div>
        <Button variant="primary" size="sm">
          Confirm
        </Button>
        <Button variant="primary" size="md">
          Save Policy
        </Button>
      </div>,
    );

    for (const label of ['Confirm', 'Save Policy']) {
      const btn = screen.getByRole('button', { name: label });
      expect(btn.className).toContain('text-white');

      const normalMatch = btn.className.match(/(?:^|\s)bg-\[(#[0-9A-Fa-f]{6})\](?:\s|$)/);
      const hoverMatch = btn.className.match(/(?:^|\s)hover:bg-\[(#[0-9A-Fa-f]{6})\](?:\s|$)/);

      expect(normalMatch?.[1]).toBeTruthy();
      expect(hoverMatch?.[1]).toBeTruthy();

      const normalContrast = contrastRatio('#FFFFFF', normalMatch![1]!);
      const hoverContrast = contrastRatio('#FFFFFF', hoverMatch![1]!);

      expect(normalContrast).toBeGreaterThanOrEqual(4.5);
      expect(hoverContrast).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('preserves existing button variants, default type="button", ref forwarding, and loading/disabled behavior', () => {
    const ref = createRef<HTMLButtonElement>();
    const { rerender } = render(
      <Button ref={ref} variant="default">
        Default Action
      </Button>,
    );

    const btn = screen.getByRole('button', { name: 'Default Action' });
    expect(ref.current).toBe(btn);
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.className).toContain('bg-[#071A2B]');

    rerender(
      <Button ref={ref} variant="outline" isLoading>
        Saving
      </Button>,
    );
    expect((screen.getByRole('button', { name: 'Saving' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
