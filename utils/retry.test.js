import { describe, it, expect, vi } from 'vitest';
import { fetchWithRetry } from './retry.js';

/** Helper: create a minimal Response-like object. */
function mockResponse(status, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
  };
}

describe('fetchWithRetry', () => {
  it('returns response on success (single call)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(200));

    const res = await fetchWithRetry('https://example.com/api', {}, {
      fetch: mockFetch,
      baseDelay: 10,
    });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and succeeds', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(429))
      .mockResolvedValueOnce(mockResponse(200));

    const res = await fetchWithRetry('https://example.com/api', {}, {
      fetch: mockFetch,
      maxRetries: 3,
      baseDelay: 10,
    });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on 502', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(502))
      .mockResolvedValueOnce(mockResponse(200));

    const res = await fetchWithRetry('https://example.com/api', {}, {
      fetch: mockFetch,
      maxRetries: 3,
      baseDelay: 10,
    });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on 503', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(200));

    const res = await fetchWithRetry('https://example.com/api', {}, {
      fetch: mockFetch,
      maxRetries: 3,
      baseDelay: 10,
    });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on 504', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(504))
      .mockResolvedValueOnce(mockResponse(200));

    const res = await fetchWithRetry('https://example.com/api', {}, {
      fetch: mockFetch,
      maxRetries: 3,
      baseDelay: 10,
    });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on 500', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(500))
      .mockResolvedValueOnce(mockResponse(200));

    const res = await fetchWithRetry('https://example.com/api', {}, {
      fetch: mockFetch,
      maxRetries: 3,
      baseDelay: 10,
    });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 400', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(400));

    const res = await fetchWithRetry('https://example.com/api', {}, {
      fetch: mockFetch,
      maxRetries: 3,
      baseDelay: 10,
    });

    expect(res.status).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 401', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(401));

    const res = await fetchWithRetry('https://example.com/api', {}, {
      fetch: mockFetch,
      maxRetries: 3,
      baseDelay: 10,
    });

    expect(res.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 403', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(403));

    const res = await fetchWithRetry('https://example.com/api', {}, {
      fetch: mockFetch,
      maxRetries: 3,
      baseDelay: 10,
    });

    expect(res.status).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 404', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(404));

    const res = await fetchWithRetry('https://example.com/api', {}, {
      fetch: mockFetch,
      maxRetries: 3,
      baseDelay: 10,
    });

    expect(res.status).toBe(404);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting retries (call count = 1 + maxRetries)', async () => {
    const maxRetries = 2;
    const mockFetch = vi.fn().mockRejectedValue(new Error('network failure'));

    await expect(
      fetchWithRetry('https://example.com/api', {}, {
        fetch: mockFetch,
        maxRetries,
        baseDelay: 10,
      }),
    ).rejects.toThrow(/all 3 attempts failed/);

    expect(mockFetch).toHaveBeenCalledTimes(1 + maxRetries);
  });

  it('returns last retryable response when retries exhausted on HTTP errors', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(503));

    const res = await fetchWithRetry('https://example.com/api', {}, {
      fetch: mockFetch,
      maxRetries: 2,
      baseDelay: 10,
    });

    expect(res.status).toBe(503);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('retries on network errors (fetch rejection) and succeeds', async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(mockResponse(200));

    const res = await fetchWithRetry('https://example.com/api', {}, {
      fetch: mockFetch,
      maxRetries: 3,
      baseDelay: 10,
    });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('respects Retry-After header on 429', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(429, { 'Retry-After': '1' }))
      .mockResolvedValueOnce(mockResponse(200));

    const start = Date.now();

    const res = await fetchWithRetry('https://example.com/api', {}, {
      fetch: mockFetch,
      maxRetries: 3,
      baseDelay: 10,
    });

    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('times out via AbortSignal', async () => {
    const mockFetch = vi.fn().mockImplementation((_url, opts) => {
      return new Promise((_resolve, reject) => {
        const onAbort = () => reject(new Error('The operation was aborted'));
        if (opts?.signal?.aborted) {
          onAbort();
          return;
        }
        opts?.signal?.addEventListener('abort', onAbort);
      });
    });

    await expect(
      fetchWithRetry('https://example.com/api', {}, {
        fetch: mockFetch,
        maxRetries: 0,
        baseDelay: 10,
        timeout: 100,
      }),
    ).rejects.toThrow(/aborted|all 1 attempts failed/);
  });

  it('logs warnings on each retry', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(200));

    await fetchWithRetry('https://example.com/api', {}, {
      fetch: mockFetch,
      maxRetries: 3,
      baseDelay: 10,
    });

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0][0]).toContain('attempt 1/');
    expect(warnSpy.mock.calls[1][0]).toContain('attempt 2/');
  });
});
