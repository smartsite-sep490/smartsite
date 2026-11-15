import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Platform } from 'react-native';
import { translate as t } from '../../i18n';
import { CalendarDateField } from './calendar-date-field';
import { DateTimeField } from './date-time-field';
import { RequestSheet } from './request-sheet';
import { PICKER_ROW_HEIGHT, ScrollDateTimePicker } from './scroll-date-time-picker';
import { Button } from './ui';

let root: ReactTestRenderer;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  (Platform as unknown as { OS: string }).OS = 'android';
});
async function mount(element: React.ReactElement) {
  await act(async () => {
    root = create(element);
  });
}
async function click(label: string) {
  const button = root.root.findAll(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label,
  )[0]!;
  expect(button).toBeDefined();
  await act(async () => button.props.onPress());
}
async function scroll(part: string, index: number) {
  const wheel = root.root.findAll(
    (node) =>
      String(node.type) === 'ScrollView' &&
      node.props.accessibilityLabel === t(`datePicker.${part}`),
  )[0]!;
  await act(async () =>
    wheel.props.onScroll({ nativeEvent: { contentOffset: { y: index * PICKER_ROW_HEIGHT } } }),
  );
}

it.each([
  [2026, 28],
  [2028, 29],
])(
  'clamps January 31 when scrolling to February in %i and commits only on Done',
  async (year, day) => {
    const confirm = vi.fn();
    await mount(
      <ScrollDateTimePicker
        value={new Date(`${year}-01-31T03:04:05.006Z`)}
        mode="date"
        utc
        onConfirm={confirm}
        onCancel={vi.fn()}
      />,
    );
    await scroll('month', 1);
    expect(confirm).not.toHaveBeenCalled();
    expect(root.root.findAll((node) => String(node.type) === 'DateTimePicker')).toHaveLength(0);
    await click(t('common.done'));
    expect(confirm).toHaveBeenCalledWith(new Date(`${year}-02-${day}T03:04:05.006Z`));
  },
);

it('cancels a calendar draft and preserves the saved value when reopened', async () => {
  const change = vi.fn();
  await mount(<CalendarDateField label="Date" value="2026-11-15" onChange={change} />);
  await click(t('common.chooseDate', { label: 'Date' }));
  await scroll('day', 19);
  await click(t('common.cancel'));
  expect(change).not.toHaveBeenCalled();
  await click(t('common.chooseDate', { label: 'Date' }));
  await click(t('common.done'));
  expect(change).toHaveBeenCalledWith('2026-11-15');
});

it('changes a calendar date without converting it through the device timezone', async () => {
  const change = vi.fn();
  await mount(<CalendarDateField label="Date" value="2026-11-15" onChange={change} />);
  await click(t('common.chooseDate', { label: 'Date' }));
  await scroll('day', 19);
  await click(t('common.done'));
  expect(change).toHaveBeenCalledWith('2026-11-20');
});

it('changes local hours and minutes while preserving the timestamp date and seconds', async () => {
  const change = vi.fn();
  const original = new Date(2026, 10, 15, 8, 0, 5, 6);
  await mount(
    <DateTimeField compact label="Start" value={original.toISOString()} onChange={change} />,
  );
  await click(t('common.chooseTime', { label: 'Start' }));
  await scroll('hour', 17);
  await scroll('minute', 30);
  expect(change).not.toHaveBeenCalled();
  await click(t('common.done'));
  expect(change).toHaveBeenCalledWith(new Date(2026, 10, 15, 17, 30, 5, 6).toISOString());
});

it('blocks the request footer until a date draft is confirmed or cancelled', async () => {
  await mount(
    <RequestSheet
      visible
      title="Request"
      onClose={vi.fn()}
      footer={<Button label="Send" onPress={vi.fn()} />}
    >
      <CalendarDateField label="Date" value="2026-11-15" onChange={vi.fn()} />
    </RequestSheet>,
  );
  await click(t('common.chooseDate', { label: 'Date' }));
  expect(JSON.stringify(root.toJSON())).toContain(t('datePicker.finishFirst'));
  const footer = root.root.findAllByType(Button).find((node) => node.props.label === 'Send')!;
  expect(footer.parent?.props.pointerEvents).toBe('none');
  await click(t('common.done'));
  expect(footer.parent?.props.pointerEvents).toBe('auto');
  expect(JSON.stringify(root.toJSON())).not.toContain(t('datePicker.finishFirst'));
});

it('renders a readable iOS spinner and keeps its calendar draft until Done', async () => {
  (Platform as unknown as { OS: string }).OS = 'ios';
  const confirm = vi.fn();
  await mount(
    <ScrollDateTimePicker
      value={new Date('2026-11-15T03:04:05.006Z')}
      mode="date"
      utc
      onConfirm={confirm}
      onCancel={vi.fn()}
    />,
  );
  const picker = root.root.findAll((node) => String(node.type) === 'DateTimePicker')[0]!;
  expect(picker.props.display).toBe('spinner');
  expect(picker.props.themeVariant).toBe('light');
  expect(picker.props.textColor).toBe('#0F172A');
  expect(picker.props.timeZoneName).toBe('UTC');
  await act(async () => picker.props.onChange({ type: 'set' }, new Date('2026-11-18T00:00:00Z')));
  expect(confirm).not.toHaveBeenCalled();
  expect(JSON.stringify(root.toJSON())).toContain(
    t('datePicker.selectedValue', {
      value: new Date('2026-11-18T00:00:00Z').toLocaleDateString('vi-VN', {
        timeZone: 'UTC',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
    }),
  );
  await click(t('common.done'));
  expect(confirm).toHaveBeenCalledWith(new Date('2026-11-18T03:04:05.006Z'));
});

it('confirms iOS time changes without changing the date or the timestamp seconds', async () => {
  (Platform as unknown as { OS: string }).OS = 'ios';
  const original = new Date(2026, 10, 15, 8, 0, 5, 6);
  const change = vi.fn();
  await mount(
    <DateTimeField compact label="Start" value={original.toISOString()} onChange={change} />,
  );
  await click(t('common.chooseTime', { label: 'Start' }));
  const picker = root.root.findAll((node) => String(node.type) === 'DateTimePicker')[0]!;
  await act(async () => picker.props.onChange({ type: 'set' }, new Date(2026, 10, 15, 17, 30)));
  expect(change).not.toHaveBeenCalled();
  await click(t('common.done'));
  expect(change).toHaveBeenCalledWith(new Date(2026, 10, 15, 17, 30, 5, 6).toISOString());
});
