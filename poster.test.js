import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────
// Module-level mocks
// ─────────────────────────────────────────────

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue(Buffer.from('fake-data')),
  },
}));

vi.mock('./utils/retry.js', () => ({
  fetchWithRetry: vi.fn(),
}));

// Import after mocks are declared
import { postToLinkedIn, postToInstagram, postToFacebook, publishToAllPlatforms } from './poster.js';
import { fetchWithRetry } from './utils/retry.js';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Create a minimal Response-like object for fetchWithRetry mock returns. */
function mockResponse(status, body = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    headers: new Headers(),
  };
}

// ─────────────────────────────────────────────
// Environment setup / teardown
// ─────────────────────────────────────────────

const LINKEDIN_ENV = {
  LINKEDIN_ACCESS_TOKEN: 'test-token',
  LINKEDIN_ORG_ID: 'urn:li:organization:12345',
};

const INSTAGRAM_ENV = {
  FB_PAGE_ACCESS_TOKEN: 'test-fb-token',
  IG_USER_ID: 'ig-user-123',
  IMGBB_API_KEY: 'imgbb-key-123',
};

const FACEBOOK_ENV = {
  FB_PAGE_ACCESS_TOKEN: 'test-fb-token',
  FB_PAGE_ID: 'fb-page-123',
  IMGBB_API_KEY: 'imgbb-key-123',
};

const ALL_ENV_KEYS = [
  'LINKEDIN_ACCESS_TOKEN',
  'LINKEDIN_ORG_ID',
  'FB_PAGE_ACCESS_TOKEN',
  'IG_USER_ID',
  'FB_PAGE_ID',
  'IMGBB_API_KEY',
];

let savedEnv;

beforeEach(() => {
  // Save and clear relevant env vars
  savedEnv = {};
  for (const key of ALL_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }

  // Silence console output in tests
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  fetchWithRetry.mockReset();
});

afterEach(() => {
  // Restore env vars
  for (const key of ALL_ENV_KEYS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }
});

// ─────────────────────────────────────────────
// postToLinkedIn
// ─────────────────────────────────────────────

describe('postToLinkedIn', () => {
  it('throws when credentials not set', async () => {
    // env vars are cleared in beforeEach — no LINKEDIN_ACCESS_TOKEN or LINKEDIN_ORG_ID
    await expect(postToLinkedIn('/tmp/test.pdf', 'Hello LinkedIn'))
      .rejects.toThrow('LinkedIn credentials not set');
  });

  it('returns { platform: "linkedin", success: true } on successful 3-step flow', async () => {
    Object.assign(process.env, LINKEDIN_ENV);

    // Step 1: register upload — returns uploadUrl and document URN
    fetchWithRetry
      .mockResolvedValueOnce(mockResponse(200, {
        value: {
          uploadUrl: 'https://api.linkedin.com/upload/12345',
          document: 'urn:li:document:12345',
        },
      }))
      // Step 2: upload PDF — 200 OK
      .mockResolvedValueOnce(mockResponse(200))
      // Step 3: create post — 201 Created
      .mockResolvedValueOnce(mockResponse(201));

    const result = await postToLinkedIn('/tmp/test.pdf', 'Hello LinkedIn');

    expect(result).toEqual({ platform: 'linkedin', success: true });
    expect(fetchWithRetry).toHaveBeenCalledTimes(3);

    // Verify the register call URL
    expect(fetchWithRetry.mock.calls[0][0]).toContain('initializeUpload');
  });

  it('throws on API failure (500 response after retries)', async () => {
    Object.assign(process.env, LINKEDIN_ENV);

    // Step 1 register succeeds
    fetchWithRetry
      .mockResolvedValueOnce(mockResponse(200, {
        value: {
          uploadUrl: 'https://api.linkedin.com/upload/12345',
          document: 'urn:li:document:12345',
        },
      }))
      // Step 2: upload fails with 500 (fetchWithRetry already retried internally and still returned 500)
      .mockResolvedValueOnce(mockResponse(500));

    await expect(postToLinkedIn('/tmp/test.pdf', 'Hello LinkedIn'))
      .rejects.toThrow('LinkedIn upload failed: 500');
  });
});

// ─────────────────────────────────────────────
// postToInstagram
// ─────────────────────────────────────────────

describe('postToInstagram', () => {
  it('returns { platform: "instagram", success: true, postId } on success', async () => {
    Object.assign(process.env, INSTAGRAM_ENV);

    fetchWithRetry
      // imgbb upload for image 1
      .mockResolvedValueOnce(mockResponse(200, {
        success: true,
        data: { url: 'https://i.ibb.co/img1.png' },
      }))
      // IG container creation for image 1
      .mockResolvedValueOnce(mockResponse(200, { id: 'container-1' }))
      // IG carousel creation
      .mockResolvedValueOnce(mockResponse(200, { id: 'carousel-1' }))
      // IG publish
      .mockResolvedValueOnce(mockResponse(200, { id: 'media-9999' }));

    const result = await postToInstagram(['/tmp/img1.png'], 'Hello IG');

    expect(result).toEqual({
      platform: 'instagram',
      success: true,
      postId: 'media-9999',
    });
    expect(fetchWithRetry).toHaveBeenCalledTimes(4);
  });

  it('throws when all container creations fail', async () => {
    Object.assign(process.env, INSTAGRAM_ENV);

    fetchWithRetry
      // imgbb upload succeeds
      .mockResolvedValueOnce(mockResponse(200, {
        success: true,
        data: { url: 'https://i.ibb.co/img1.png' },
      }))
      // IG container creation fails (no id in response)
      .mockResolvedValueOnce(mockResponse(200, { error: 'bad image' }));

    await expect(postToInstagram(['/tmp/img1.png'], 'Hello IG'))
      .rejects.toThrow('all container creations failed');
  });

  it('throws when credentials not set', async () => {
    // env vars cleared in beforeEach
    await expect(postToInstagram(['/tmp/img1.png'], 'Hello IG'))
      .rejects.toThrow('Instagram credentials not set');
  });
});

// ─────────────────────────────────────────────
// postToFacebook
// ─────────────────────────────────────────────

describe('postToFacebook', () => {
  it('returns { platform: "facebook", success: true, postId } on success', async () => {
    Object.assign(process.env, FACEBOOK_ENV);

    fetchWithRetry
      // imgbb upload for image 1
      .mockResolvedValueOnce(mockResponse(200, {
        success: true,
        data: { url: 'https://i.ibb.co/img1.png' },
      }))
      // FB unpublished photo upload
      .mockResolvedValueOnce(mockResponse(200, { id: 'photo-1' }))
      // FB multi-photo post
      .mockResolvedValueOnce(mockResponse(200, { id: 'post-42' }));

    const result = await postToFacebook(['/tmp/img1.png'], 'Hello FB');

    expect(result).toEqual({
      platform: 'facebook',
      success: true,
      postId: 'post-42',
    });
    expect(fetchWithRetry).toHaveBeenCalledTimes(3);
  });

  it('throws when credentials not set', async () => {
    // env vars cleared in beforeEach
    await expect(postToFacebook(['/tmp/img1.png'], 'Hello FB'))
      .rejects.toThrow('Facebook credentials not set');
  });
});

// ─────────────────────────────────────────────
// publishToAllPlatforms
// ─────────────────────────────────────────────

describe('publishToAllPlatforms', () => {
  it('collects results from all platforms', async () => {
    Object.assign(process.env, { ...LINKEDIN_ENV, ...INSTAGRAM_ENV, ...FACEBOOK_ENV });

    fetchWithRetry
      // LinkedIn: register, upload, post
      .mockResolvedValueOnce(mockResponse(200, {
        value: {
          uploadUrl: 'https://api.linkedin.com/upload/12345',
          document: 'urn:li:document:12345',
        },
      }))
      .mockResolvedValueOnce(mockResponse(200))
      .mockResolvedValueOnce(mockResponse(201))
      // Instagram: imgbb, container, carousel, publish
      .mockResolvedValueOnce(mockResponse(200, {
        success: true,
        data: { url: 'https://i.ibb.co/img1.png' },
      }))
      .mockResolvedValueOnce(mockResponse(200, { id: 'container-1' }))
      .mockResolvedValueOnce(mockResponse(200, { id: 'carousel-1' }))
      .mockResolvedValueOnce(mockResponse(200, { id: 'media-9999' }))
      // Facebook: imgbb, photo, post
      .mockResolvedValueOnce(mockResponse(200, {
        success: true,
        data: { url: 'https://i.ibb.co/img1.png' },
      }))
      .mockResolvedValueOnce(mockResponse(200, { id: 'photo-1' }))
      .mockResolvedValueOnce(mockResponse(200, { id: 'post-42' }));

    const post = {
      pdfPath: '/tmp/test.pdf',
      imagePaths: ['/tmp/img1.png'],
      captions: {
        linkedin: 'LI caption',
        instagram: 'IG caption',
        facebook: 'FB caption',
        default: 'Default caption',
      },
    };

    const { results, allSucceeded, failedPlatforms } = await publishToAllPlatforms(
      post,
      ['linkedin', 'instagram', 'facebook'],
    );

    expect(allSucceeded).toBe(true);
    expect(failedPlatforms).toEqual([]);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ platform: 'linkedin', success: true });
    expect(results[1]).toEqual({ platform: 'instagram', success: true, postId: 'media-9999' });
    expect(results[2]).toEqual({ platform: 'facebook', success: true, postId: 'post-42' });
  });

  it('captures individual platform failures without stopping others', async () => {
    // LinkedIn fails (no credentials), Facebook succeeds
    Object.assign(process.env, FACEBOOK_ENV);

    fetchWithRetry
      // Facebook: imgbb, photo, post
      .mockResolvedValueOnce(mockResponse(200, {
        success: true,
        data: { url: 'https://i.ibb.co/img1.png' },
      }))
      .mockResolvedValueOnce(mockResponse(200, { id: 'photo-1' }))
      .mockResolvedValueOnce(mockResponse(200, { id: 'post-42' }));

    const post = {
      pdfPath: '/tmp/test.pdf',
      imagePaths: ['/tmp/img1.png'],
      captions: { default: 'caption' },
    };

    const { results, allSucceeded, failedPlatforms } = await publishToAllPlatforms(
      post,
      ['linkedin', 'facebook'],
    );

    expect(allSucceeded).toBe(false);
    expect(failedPlatforms).toEqual(['linkedin']);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      platform: 'linkedin',
      success: false,
      error: 'LinkedIn credentials not set',
    });
    expect(results[1]).toEqual({
      platform: 'facebook',
      success: true,
      postId: 'post-42',
    });
  });

  it('returns allSucceeded: false and correct failedPlatforms on partial failure', async () => {
    // All credentials missing — both will fail
    const post = {
      pdfPath: '/tmp/test.pdf',
      imagePaths: ['/tmp/img1.png'],
      captions: { default: 'caption' },
    };

    const { results, allSucceeded, failedPlatforms } = await publishToAllPlatforms(
      post,
      ['linkedin', 'instagram'],
    );

    expect(allSucceeded).toBe(false);
    expect(failedPlatforms).toEqual(['linkedin', 'instagram']);
    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(false);
    expect(results[1].success).toBe(false);
  });

  it('handles unknown platforms gracefully', async () => {
    const post = {
      pdfPath: '/tmp/test.pdf',
      imagePaths: ['/tmp/img1.png'],
      captions: { default: 'caption' },
    };

    const { results, allSucceeded } = await publishToAllPlatforms(
      post,
      ['tiktok'],
    );

    expect(allSucceeded).toBe(true); // unknown platforms don't throw, they return a result
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      platform: 'tiktok',
      success: false,
      error: 'Unknown platform: tiktok',
    });
  });
});
