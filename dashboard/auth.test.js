import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiKeyAuth } from './auth.js';

describe('apiKeyAuth', () => {
  beforeEach(() => {
    delete process.env.API_KEY;
  });

  it('returns 401 when no API key header', () => {
    process.env.API_KEY = 'test-secret';
    const req = { headers: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    apiKeyAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when API key is wrong', () => {
    process.env.API_KEY = 'test-secret';
    const req = { headers: { 'x-api-key': 'wrong-key' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    apiKeyAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when API key matches', () => {
    process.env.API_KEY = 'test-secret';
    const req = { headers: { 'x-api-key': 'test-secret' } };
    const res = {};
    const next = vi.fn();
    apiKeyAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 500 when API_KEY env var not set', () => {
    delete process.env.API_KEY;
    const req = { headers: { 'x-api-key': 'any' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    apiKeyAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });
});
