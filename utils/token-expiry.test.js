import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkTokenExpiry } from './token-expiry.js';

describe('checkTokenExpiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns no warnings when no expiry dates set', () => {
    const warnings = checkTokenExpiry({});
    expect(warnings).toEqual([]);
  });

  it('returns warning when token expires within 7 days', () => {
    const warnings = checkTokenExpiry({
      TOKEN_EXPIRY_LINKEDIN: '2026-03-28',
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('LinkedIn');
    expect(warnings[0]).toContain('5 days');
  });

  it('returns expired message when token is past expiry', () => {
    const warnings = checkTokenExpiry({
      TOKEN_EXPIRY_META: '2026-03-20',
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('EXPIRED');
    expect(warnings[0]).toContain('Meta');
  });

  it('returns no warnings when token has >7 days remaining', () => {
    const warnings = checkTokenExpiry({
      TOKEN_EXPIRY_LINKEDIN: '2026-05-01',
    });
    expect(warnings).toEqual([]);
  });

  it('handles multiple tokens with mixed states', () => {
    const warnings = checkTokenExpiry({
      TOKEN_EXPIRY_LINKEDIN: '2026-03-25', // 2 days
      TOKEN_EXPIRY_META: '2026-05-01',     // safe
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('LinkedIn');
  });

  it('ignores invalid date strings', () => {
    const warnings = checkTokenExpiry({
      TOKEN_EXPIRY_LINKEDIN: 'not-a-date',
    });
    expect(warnings).toEqual([]);
  });
});
