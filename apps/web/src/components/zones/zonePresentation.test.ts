import { describe, expect, it } from 'vitest';
import { translateKey } from '../../i18n/locale-context';
import { registerPpeCatalog } from '../../i18n/ppe-catalog';
import { presentZoneLabel, presentZoneMessage } from './zonePresentation';

registerPpeCatalog();
const vietnamese = (key: Parameters<typeof translateKey>[1]) => translateKey('vi', key);
const english = (key: Parameters<typeof translateKey>[1]) => translateKey('en', key);

describe('stored Zone presentation across language changes', () => {
  it.each([
    [
      'Cannot save polygon: camera snapshot is not live or does not match.',
      'Không thể lưu đa giác',
    ],
    ['Cannot save draft: camera snapshot is not live or does not match.', 'Không thể lưu bản nháp'],
    ['Your session is no longer valid. Sign in again.', 'Phiên làm việc không còn hợp lệ'],
  ])('translates retained system feedback without changing its source: %s', (stored, expected) => {
    expect(presentZoneMessage(stored!, vietnamese)).toContain(expected);
    expect(presentZoneMessage(stored!, english)).toBe(stored);
  });

  it.each([
    ['Backend evaluation required', 'Cần đánh giá từ Backend'],
    ['Technical entry', 'Quan sát đi vào vùng kỹ thuật'],
    ['Scanning Snapshot', 'Đang quét ảnh chụp'],
  ])(
    'translates technical row labels without turning them into decisions: %s',
    (stored, expected) => {
      expect(presentZoneLabel(stored!, vietnamese)).toBe(expected);
      expect(presentZoneLabel(stored!, english)).toBe(stored);
    },
  );

  it('does not reinterpret an unrecognized technical value or authored text', () => {
    expect(presentZoneLabel('UNRECOGNIZED_TECHNICAL_VALUE', vietnamese)).toBe(
      'UNRECOGNIZED_TECHNICAL_VALUE',
    );
    expect(presentZoneMessage('Ghi chú của Nguyễn Văn Test', vietnamese)).toBe(
      'Ghi chú của Nguyễn Văn Test',
    );
  });
});
