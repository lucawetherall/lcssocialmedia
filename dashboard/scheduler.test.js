import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getNextAvailableSlots } from './scheduler.js';

describe('getNextAvailableSlots', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T10:00:00Z')); // Monday
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns next N Mon/Thu slots', () => {
    const slots = getNextAvailableSlots(4, {
      recurringDays: ['monday', 'thursday'],
      recurringTime: '09:00',
      existingScheduledDates: [],
    });
    expect(slots).toHaveLength(4);
    // Next available: Thu Mar 26, Mon Mar 30, Thu Apr 2, Mon Apr 6
    expect(slots[0]).toContain('2026-03-26');
    expect(slots[1]).toContain('2026-03-30');
    expect(slots[2]).toContain('2026-04-02');
    expect(slots[3]).toContain('2026-04-06');
  });

  it('skips slots that already have scheduled posts', () => {
    const slots = getNextAvailableSlots(2, {
      recurringDays: ['monday', 'thursday'],
      recurringTime: '09:00',
      existingScheduledDates: ['2026-03-26 09:00:00'],
    });
    // Thu Mar 26 is taken → Mon Mar 30, Thu Apr 2
    expect(slots[0]).toContain('2026-03-30');
    expect(slots[1]).toContain('2026-04-02');
  });

  it('handles custom days and times', () => {
    const slots = getNextAvailableSlots(1, {
      recurringDays: ['wednesday'],
      recurringTime: '14:00',
      existingScheduledDates: [],
    });
    expect(slots[0]).toContain('2026-03-25');
    expect(slots[0]).toContain('14:00');
  });

  it('returns empty array when no days match', () => {
    const slots = getNextAvailableSlots(1, {
      recurringDays: [],
      recurringTime: '09:00',
      existingScheduledDates: [],
    });
    expect(slots).toEqual([]);
  });

  it('includes correct time in returned slots', () => {
    const slots = getNextAvailableSlots(1, {
      recurringDays: ['thursday'],
      recurringTime: '09:00',
      existingScheduledDates: [],
    });
    expect(slots[0]).toMatch(/09:00:00$/);
  });
});
