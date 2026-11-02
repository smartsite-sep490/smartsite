import { describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { computePresets, shiftRange, DateRangeFilter } from './date-range-filter';

describe('DateRangeFilter helpers', () => {
  it('computes correct preset ranges', () => {
    const presets = computePresets();
    expect(presets.today.fromDate).toBe(presets.today.toDate);
    expect(presets.last7.fromDate <= presets.last7.toDate).toBe(true);
    expect(presets.thisWeek.fromDate <= presets.thisWeek.toDate).toBe(true);
    expect(presets.thisMonth.fromDate.endsWith('-01')).toBe(true);
    expect(presets.lastMonth.fromDate.endsWith('-01')).toBe(true);
  });

  it('shifts periods backward and forward accurately', () => {
    const initialRange = { fromDate: '2026-10-01', toDate: '2026-10-31' };
    const prevMonth = shiftRange(initialRange, -1);
    expect(prevMonth.fromDate).toBe('2026-09-01');
    expect(prevMonth.toDate).toBe('2026-09-30');

    const nextMonth = shiftRange(prevMonth, 1);
    expect(nextMonth.fromDate).toBe('2026-10-01');
    expect(nextMonth.toDate).toBe('2026-10-31');

    const dayRange = { fromDate: '2026-10-27', toDate: '2026-10-27' };
    const prevDay = shiftRange(dayRange, -1);
    expect(prevDay.fromDate).toBe('2026-10-26');
    expect(prevDay.toDate).toBe('2026-10-26');
  });

  it('renders horizontal preset pills and calls onChange when a preset is pressed', async () => {
    const onChange = vi.fn();
    let root: ReactTestRenderer;
    await act(async () => {
      root = create(
        <DateRangeFilter
          range={{ fromDate: '2026-10-01', toDate: '2026-10-27' }}
          onChange={onChange}
        />,
      );
    });

    const buttons = root!.root.findAll((n) => String(n.type) === 'Pressable');
    expect(buttons.length).toBeGreaterThan(3);

    // Find the 'Hôm nay' button
    const todayBtn = buttons.find(
      (b) => b.props.accessibilityLabel === 'Hôm nay' || b.props.accessibilityLabel === 'Today',
    );
    expect(todayBtn).toBeDefined();

    await act(async () => {
      todayBtn!.props.onPress();
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const calledRange = onChange.mock.calls[0]![0];
    expect(calledRange.fromDate).toBe(calledRange.toDate);
  });
});
