// @vitest-environment jsdom
import React, { createRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SmartNativeSelect } from './SmartNativeSelect';
import { Dialog } from './Dialog';

afterEach(cleanup);

function selectValue(label: string): HTMLElement {
  const element = Array.from(document.querySelectorAll<HTMLElement>('[data-select-value]')).find(
    (node) => node.dataset.value === label,
  );
  if (!element) throw new Error('Missing displayed selection: ' + label);
  return element;
}

it('uses the shared menu and preserves controlled change events and form values', async () => {
  const change = vi.fn();
  function Form() {
    const [value, setValue] = useState('active');
    return (
      <form aria-label="Filters">
        <label htmlFor="status">Status</label>
        <SmartNativeSelect
          id="status"
          name="status"
          value={value}
          onChange={(event) => {
            change(event.target.value);
            setValue(event.target.value);
          }}
        >
          <option value="active">Active teams</option>
          <option value="archived">Archived teams</option>
        </SmartNativeSelect>
      </form>
    );
  }
  render(<Form />);
  await userEvent.setup().click(selectValue('Active teams'));
  await userEvent
    .setup()
    .click(screen.getByRole('option', { name: 'Archived teams', hidden: false }));
  expect(change).toHaveBeenCalledExactlyOnceWith('archived');
  expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('status')).toBe('archived');
  expect(screen.getByLabelText('Status').getAttribute('aria-expanded')).toBe('false');
});

it('keeps required validation, labels and imperative focus on the real form control', () => {
  const ref = createRef<HTMLSelectElement>();
  render(
    <form>
      <label htmlFor="site">Site</label>
      <SmartNativeSelect ref={ref} id="site" name="site" required defaultValue="">
        <option value="">Choose site</option>
        <option value="one">Site One</option>
      </SmartNativeSelect>
    </form>,
  );
  expect(ref.current).toBe(screen.getByLabelText('Site'));
  expect(ref.current?.checkValidity()).toBe(false);
  ref.current?.focus();
  expect(document.activeElement).toBe(ref.current);
  fireEvent.change(ref.current!, { target: { value: 'one' } });
  expect(ref.current?.checkValidity()).toBe(true);
  expect(selectValue('Site One')).toBeTruthy();
});

it('opens from the keyboard, skips disabled options, selects and restores focus', async () => {
  render(
    <label>
      Shift
      <SmartNativeSelect defaultValue="one">
        <option value="one">Morning</option>
        <option value="locked" disabled>
          Locked
        </option>
        <option value="two">Evening</option>
      </SmartNativeSelect>
    </label>,
  );
  const user = userEvent.setup();
  const select = screen.getByRole('combobox', { name: /Shift/ });
  select.focus();
  await user.keyboard('{ArrowDown}');
  await waitFor(() => expect(document.activeElement?.textContent).toContain('Morning'));
  await user.keyboard('{ArrowDown}{Enter}');
  expect((select as HTMLSelectElement).value).toBe('two');
  await waitFor(() => expect(document.activeElement).toBe(select));
});

it('preserves uncontrolled defaults and resets with its owning form', async () => {
  render(
    <form aria-label="Settings">
      <SmartNativeSelect name="mode" defaultValue="two">
        <option value="one">One</option>
        <option value="two">Two</option>
      </SmartNativeSelect>
    </form>,
  );
  const select = screen.getByRole('combobox');
  fireEvent.change(select, { target: { value: 'one' } });
  expect(selectValue('One')).toBeTruthy();
  (screen.getByRole('form') as HTMLFormElement).reset();
  await waitFor(() => expect(selectValue('Two')).toBeTruthy());
  expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('mode')).toBe('two');
});

it('keeps the native selection visible when async uncontrolled options are inserted, reordered or removed', () => {
  const form = (choices: string[]) => (
    <form aria-label="Gate selection">
      <SmartNativeSelect name="gate">
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </SmartNativeSelect>
    </form>
  );
  const { rerender } = render(form([]));
  rerender(form(['One', 'Two']));
  expect(selectValue('One')).toBeTruthy();
  rerender(form(['Zero', 'Two', 'One']));
  const nativeValue = new FormData(screen.getByRole('form') as HTMLFormElement).get('gate');
  expect(nativeValue).toBe('One');
  expect(selectValue(String(nativeValue))).toBeTruthy();
  rerender(form(['Zero', 'Two']));
  expect(
    selectValue(String(new FormData(screen.getByRole('form') as HTMLFormElement).get('gate'))),
  ).toBeTruthy();
});

it('keeps disabled controls and options unavailable, and excludes disabled fields from submission', async () => {
  render(
    <form aria-label="Settings">
      <SmartNativeSelect name="mode" disabled>
        <option value="one">One</option>
        <option value="two">Two</option>
      </SmartNativeSelect>
    </form>,
  );
  await userEvent.setup().click(selectValue('One'));
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(new FormData(screen.getByRole('form') as HTMLFormElement).has('mode')).toBe(false);
});

it('respects a disabled owning fieldset even though the menu is portaled', async () => {
  const change = vi.fn();
  render(
    <fieldset disabled>
      <label>
        Locked scope
        <SmartNativeSelect onChange={change}>
          <option value="one">One</option>
          <option value="two">Two</option>
        </SmartNativeSelect>
      </label>
    </fieldset>,
  );
  await userEvent.setup().click(selectValue('One'));
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(change).not.toHaveBeenCalled();
});

it('opens inside an implicit label and leaves focus on a field clicked outside the menu', async () => {
  render(
    <>
      <label>
        Status
        <SmartNativeSelect defaultValue="one">
          <option value="one">One</option>
          <option value="two">Two</option>
        </SmartNativeSelect>
      </label>
      <input aria-label="Notes" />
    </>,
  );
  const user = userEvent.setup();
  await user.click(selectValue('One'));
  expect(screen.getByRole('listbox')).toBeTruthy();
  await user.click(screen.getByLabelText('Notes'));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  expect(document.activeElement).toBe(screen.getByLabelText('Notes'));
});

it('closes only the dropdown on Escape inside a dialog and restores the field focus', async () => {
  const close = vi.fn();
  render(
    <Dialog open onClose={close} title="Assignment">
      <label>
        Shift
        <SmartNativeSelect>
          <option value="day">Day</option>
          <option value="night">Night</option>
        </SmartNativeSelect>
      </label>
    </Dialog>,
  );
  const user = userEvent.setup();
  await user.click(selectValue('Day'));
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  expect(close).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Shift' }));
});

it('continues forward and backward through the form when tabbing out of an open menu', async () => {
  render(
    <>
      <input aria-label="Before" />
      <label>
        Status
        <SmartNativeSelect>
          <option value="one">One</option>
          <option value="two">Two</option>
        </SmartNativeSelect>
      </label>
      <input aria-label="After" />
    </>,
  );
  const user = userEvent.setup();
  await user.click(selectValue('One'));
  await user.tab();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('After')));
  expect(screen.queryByRole('listbox')).toBeNull();
  await user.click(selectValue('One'));
  await user.tab({ shift: true });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Before')));
});

it('updates dynamic options and searches long lists without submitting the form', async () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const choices = Array.from({ length: 12 }, (_, i) => (
    <option key={i} value={i}>
      Camera {i}
    </option>
  ));
  const { rerender } = render(
    <form onSubmit={submit}>
      <SmartNativeSelect value="0" onChange={() => {}}>
        {choices}
      </SmartNativeSelect>
    </form>,
  );
  await userEvent.setup().click(selectValue('Camera 0'));
  await userEvent.setup().type(screen.getByRole('textbox'), 'Camera 11');
  expect(
    screen
      .getAllByRole('option', { hidden: false })
      .filter((option) => option.tagName === 'BUTTON'),
  ).toHaveLength(1);
  await userEvent.setup().keyboard('{Escape}');
  expect(submit).not.toHaveBeenCalled();
  rerender(
    <SmartNativeSelect value="new" onChange={() => {}}>
      <option value="new">New camera</option>
    </SmartNativeSelect>,
  );
  expect(selectValue('New camera')).toBeTruthy();
});
