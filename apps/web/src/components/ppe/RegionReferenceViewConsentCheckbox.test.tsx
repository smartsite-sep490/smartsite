// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeUiLanguage } from '../../i18n/runtime';
import { RegionReferenceViewConsentCheckbox } from './RegionReferenceViewConsentCheckbox';

describe('RegionReferenceViewConsentCheckbox', () => {
  beforeEach(() => {
    void changeUiLanguage('en');
  });

  afterEach(() => {
    cleanup();
    void changeUiLanguage('en');
  });

  it('renders unchecked when checked=false and never auto-checks on mount', () => {
    const onCheckedChange = vi.fn();
    render(
      <RegionReferenceViewConsentCheckbox
        checked={false}
        disabled={false}
        onCheckedChange={onCheckedChange}
      />,
    );

    const checkbox = screen.getByRole('checkbox', {
      name: 'I checked that the drawn region matches this reference image',
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(false);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('calls onCheckedChange with toggled boolean when user clicks checkbox or associated label', () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(
      <RegionReferenceViewConsentCheckbox
        checked={false}
        disabled={false}
        onCheckedChange={onCheckedChange}
      />,
    );

    const checkbox = screen.getByRole('checkbox', {
      name: 'I checked that the drawn region matches this reference image',
    }) as HTMLInputElement;

    fireEvent.click(checkbox);
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);

    rerender(
      <RegionReferenceViewConsentCheckbox
        checked={true}
        disabled={false}
        onCheckedChange={onCheckedChange}
      />,
    );
    expect(checkbox.checked).toBe(true);

    const label = screen.getByTestId('region-reference-view-consent');
    fireEvent.click(label);
    expect(onCheckedChange).toHaveBeenCalledTimes(2);
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
  });

  it('disables checkbox input and applies disabled styling when disabled=true', () => {
    const onCheckedChange = vi.fn();
    render(
      <RegionReferenceViewConsentCheckbox
        checked={false}
        disabled={true}
        onCheckedChange={onCheckedChange}
      />,
    );

    const checkbox = screen.getByRole('checkbox', {
      name: 'I checked that the drawn region matches this reference image',
    }) as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);

    const label = screen.getByTestId('region-reference-view-consent');
    expect(label.className).toContain('cursor-not-allowed');
  });

  it('renders localized label in English and Vietnamese via Main runtime i18n', () => {
    const { rerender } = render(
      <RegionReferenceViewConsentCheckbox
        checked={false}
        disabled={false}
        onCheckedChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText('I checked that the drawn region matches this reference image'),
    ).toBeTruthy();

    act(() => {
      void changeUiLanguage('vi');
    });

    rerender(
      <RegionReferenceViewConsentCheckbox
        checked={false}
        disabled={false}
        onCheckedChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText('Tôi đã kiểm tra vùng vừa vẽ khớp với ảnh tham chiếu này'),
    ).toBeTruthy();
  });
});
