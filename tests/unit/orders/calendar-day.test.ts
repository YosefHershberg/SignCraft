import { describe, expect, it } from 'vitest';
import { calendarDayToIso, isoToCalendarDay } from '@/components/orders/order-form-field';

describe('calendarDayToIso', () => {
  it('stores the picked day as noon UTC, whatever the local time of day', () => {
    expect(calendarDayToIso(new Date(2026, 8, 24, 0, 0, 0))).toBe('2026-09-24T12:00:00.000Z');
    expect(calendarDayToIso(new Date(2026, 8, 24, 23, 59, 59))).toBe('2026-09-24T12:00:00.000Z');
  });

  it('keeps the day a picker in any ordinary offset reads back', () => {
    // Noon UTC is the same calendar day from UTC-11 to UTC+11, which is what
    // `toISOString()` on the picker's local-midnight Date would have lost.
    const iso = calendarDayToIso(new Date(2026, 0, 1));
    expect(iso).toBe('2026-01-01T12:00:00.000Z');
    expect(new Date(iso).getUTCHours()).toBe(12);
  });
});

describe('isoToCalendarDay', () => {
  it('round-trips a picked day', () => {
    const day = isoToCalendarDay(calendarDayToIso(new Date(2026, 0, 1)));
    expect(day && [day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2026, 0, 1]);
  });

  it('is undefined for an empty or unparseable value', () => {
    expect(isoToCalendarDay('')).toBeUndefined();
    expect(isoToCalendarDay('not-a-date')).toBeUndefined();
  });
});
