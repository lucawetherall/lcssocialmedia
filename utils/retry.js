/**
 * Fetch wrapper with retry logic and exponential backoff.
 *
 * Retries on network errors and transient HTTP status codes (429, 5xx).
 * Returns immediately for client errors (4xx other than 429).
 */

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/**
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {object} [retryOptions]
 * @param {number} [retryOptions.maxRetries=3]
 * @param {number} [retryOptions.baseDelay=1000]  — milliseconds
 * @param {number} [retryOptions.timeout=30000]   — milliseconds
 * @param {Function} [retryOptions.fetch]          — injectable fetch (for testing)
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    timeout = 30000,
    fetch: fetchFn = globalThis.fetch,
  } = retryOptions;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Merge any caller-provided signal with our timeout signal
    const mergedSignal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;

    try {
      const response = await fetchFn(url, {
        ...options,
        signal: mergedSignal,
      });

      clearTimeout(timeoutId);

      // Non-retryable status — return immediately
      if (!RETRYABLE_STATUS_CODES.has(response.status)) {
        return response;
      }

      // Retryable status but we've exhausted attempts
      if (attempt === maxRetries) {
        return response;
      }

      // Determine backoff delay
      let delay = baseDelay * 2 ** attempt;

      // Respect Retry-After header on 429
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter) {
          const retryAfterSeconds = Number(retryAfter);
          if (!Number.isNaN(retryAfterSeconds)) {
            delay = retryAfterSeconds * 1000;
          }
        }
      }

      console.warn(
        `fetchWithRetry: attempt ${attempt + 1}/${maxRetries + 1} failed with status ${response.status} for ${url} — retrying in ${delay}ms`,
      );

      await sleep(delay);
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;

      if (attempt === maxRetries) {
        throw new Error(
          `fetchWithRetry: all ${maxRetries + 1} attempts failed for ${url}: ${error.message}`,
        );
      }

      const delay = baseDelay * 2 ** attempt;

      console.warn(
        `fetchWithRetry: attempt ${attempt + 1}/${maxRetries + 1} threw for ${url} — retrying in ${delay}ms: ${error.message}`,
      );

      await sleep(delay);
    }
  }

  // Should not be reachable, but just in case
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
