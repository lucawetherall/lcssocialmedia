// dashboard/scheduler.js
// Scheduling logic for auto-posting

const DAY_MAP = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/**
 * Find the next N available posting slots.
 * @param {number} count - Number of slots needed
 * @param {object} options
 * @param {string[]} options.recurringDays - e.g. ['monday', 'thursday']
 * @param {string} options.recurringTime - e.g. '09:00'
 * @param {string[]} options.existingScheduledDates - ISO dates already scheduled
 * @returns {string[]} Array of UTC datetime strings like '2026-03-26 09:00:00'
 */
export function getNextAvailableSlots(count, { recurringDays, recurringTime, existingScheduledDates }) {
  const targetDayNumbers = recurringDays.map(d => DAY_MAP[d.toLowerCase()]).filter(n => n !== undefined);
  const [hours, minutes] = recurringTime.split(':').map(Number);
  const existingSet = new Set(existingScheduledDates.map(d => d.slice(0, 16)));

  const slots = [];
  const cursor = new Date();
  cursor.setUTCHours(hours, minutes, 0, 0);

  // Start from tomorrow to avoid scheduling in the past
  cursor.setUTCDate(cursor.getUTCDate() + 1);

  // Search up to 90 days ahead
  const maxDate = new Date(cursor);
  maxDate.setUTCDate(maxDate.getUTCDate() + 90);

  while (slots.length < count && cursor < maxDate) {
    if (targetDayNumbers.includes(cursor.getUTCDay())) {
      const isoStr = cursor.toISOString().replace('T', ' ').slice(0, 19);
      const compareStr = isoStr.slice(0, 16);
      if (!existingSet.has(compareStr)) {
        slots.push(isoStr);
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return slots;
}
