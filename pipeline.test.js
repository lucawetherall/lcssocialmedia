import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────
// Module-level mocks (same pattern as poster.test.js)
// ─────────────────────────────────────────────

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue(Buffer.from('fake-data')),
  },
}));

vi.mock('./utils/retry.js', () => ({
  fetchWithRetry: vi.fn(),
}));

import { publishToAllPlatforms } from './poster.js';
import { fetchWithRetry } from './utils/retry.js';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

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

const ALL_ENV = {
  LINKEDIN_ACCESS_TOKEN: 'test-token',
  LINKEDIN_ORG_ID: 'urn:li:organization:123',
  FB_PAGE_ACCESS_TOKEN: 'test-fb-token',
  FB_PAGE_ID: 'page123',
  IG_USER_ID: 'ig123',
  IMGBB_API_KEY: 'imgbb-key',
};

const ALL_ENV_KEYS = Object.keys(ALL_ENV);

let savedEnv;

beforeEach(() => {
  savedEnv = {};
  for (const key of ALL_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }

  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  fetchWithRetry.mockReset();
});

afterEach(() => {
  for (const key of ALL_ENV_KEYS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }
});

// ─────────────────────────────────────────────
// Pipeline integration tests
// ─────────────────────────────────────────────

describe('pipeline integration', () => {
  it('publishToAllPlatforms handles the full multi-platform flow', async () => {
    Object.assign(process.env, ALL_ENV);

    fetchWithRetry
      // LinkedIn: register upload
      .mockResolvedValueOnce(mockResponse(200, {
        value: {
          uploadUrl: 'https://api.linkedin.com/upload/12345',
          document: 'urn:li:document:12345',
        },
      }))
      // LinkedIn: upload PDF
      .mockResolvedValueOnce(mockResponse(200))
      // LinkedIn: create post
      .mockResolvedValueOnce(mockResponse(201))
      // Instagram: imgbb upload
      .mockResolvedValueOnce(mockResponse(200, {
        success: true,
        data: { url: 'https://i.ibb.co/img1.png' },
      }))
      // Instagram: container creation
      .mockResolvedValueOnce(mockResponse(200, { id: 'container-1' }))
      // Instagram: carousel creation
      .mockResolvedValueOnce(mockResponse(200, { id: 'carousel-1' }))
      // Instagram: publish
      .mockResolvedValueOnce(mockResponse(200, { id: 'media-9999' }))
      // Facebook: imgbb upload
      .mockResolvedValueOnce(mockResponse(200, {
        success: true,
        data: { url: 'https://i.ibb.co/img2.png' },
      }))
      // Facebook: unpublished photo
      .mockResolvedValueOnce(mockResponse(200, { id: 'photo-1' }))
      // Facebook: multi-photo post
      .mockResolvedValueOnce(mockResponse(200, { id: 'post-42' }));

    const result = await publishToAllPlatforms({
      pdfPath: '/fake/carousel.pdf',
      imagePaths: ['/fake/slide-01.png'],
      captions: {
        linkedin: 'LinkedIn caption',
        instagram: 'Instagram caption',
        facebook: 'Facebook caption',
        default: 'Default caption',
      },
    }, ['linkedin', 'instagram', 'facebook']);

    expect(result.results).toHaveLength(3);
    expect(result.allSucceeded).toBe(true);
    expect(result.failedPlatforms).toEqual([]);

    // Verify every result has the expected structure
    for (const r of result.results) {
      expect(r).toHaveProperty('platform');
      expect(r).toHaveProperty('success');
      expect(r.success).toBe(true);
    }

    // Verify platform order matches input
    expect(result.results[0].platform).toBe('linkedin');
    expect(result.results[1].platform).toBe('instagram');
    expect(result.results[2].platform).toBe('facebook');

    // Verify all 10 API calls were made (3 LI + 4 IG + 3 FB)
    expect(fetchWithRetry).toHaveBeenCalledTimes(10);
  });

  it('handles mixed success/failure across platforms', async () => {
    // Only set Instagram and Facebook credentials — LinkedIn will fail
    Object.assign(process.env, {
      FB_PAGE_ACCESS_TOKEN: 'test-fb-token',
      FB_PAGE_ID: 'page123',
      IG_USER_ID: 'ig123',
      IMGBB_API_KEY: 'imgbb-key',
    });

    fetchWithRetry
      // Instagram: imgbb upload
      .mockResolvedValueOnce(mockResponse(200, {
        success: true,
        data: { url: 'https://i.ibb.co/img1.png' },
      }))
      // Instagram: container creation
      .mockResolvedValueOnce(mockResponse(200, { id: 'container-1' }))
      // Instagram: carousel creation
      .mockResolvedValueOnce(mockResponse(200, { id: 'carousel-1' }))
      // Instagram: publish
      .mockResolvedValueOnce(mockResponse(200, { id: 'media-9999' }))
      // Facebook: imgbb upload
      .mockResolvedValueOnce(mockResponse(200, {
        success: true,
        data: { url: 'https://i.ibb.co/img2.png' },
      }))
      // Facebook: unpublished photo
      .mockResolvedValueOnce(mockResponse(200, { id: 'photo-1' }))
      // Facebook: multi-photo post
      .mockResolvedValueOnce(mockResponse(200, { id: 'post-42' }));

    const result = await publishToAllPlatforms({
      pdfPath: '/fake/carousel.pdf',
      imagePaths: ['/fake/slide-01.png'],
      captions: { default: 'Caption' },
    }, ['linkedin', 'instagram', 'facebook']);

    expect(result.allSucceeded).toBe(false);
    expect(result.failedPlatforms).toContain('linkedin');
    expect(result.failedPlatforms).toHaveLength(1);

    // LinkedIn failed but Instagram and Facebook succeeded
    expect(result.results).toHaveLength(3);
    expect(result.results[0]).toMatchObject({
      platform: 'linkedin',
      success: false,
    });
    expect(result.results[1]).toMatchObject({
      platform: 'instagram',
      success: true,
    });
    expect(result.results[2]).toMatchObject({
      platform: 'facebook',
      success: true,
    });
  });

  it('uses platform-specific captions with fallback to default', async () => {
    // Only LinkedIn to keep the test focused
    Object.assign(process.env, {
      LINKEDIN_ACCESS_TOKEN: 'test-token',
      LINKEDIN_ORG_ID: 'urn:li:organization:123',
    });

    fetchWithRetry
      .mockResolvedValueOnce(mockResponse(200, {
        value: {
          uploadUrl: 'https://api.linkedin.com/upload/12345',
          document: 'urn:li:document:12345',
        },
      }))
      .mockResolvedValueOnce(mockResponse(200))
      .mockResolvedValueOnce(mockResponse(201));

    await publishToAllPlatforms({
      pdfPath: '/fake/carousel.pdf',
      imagePaths: ['/fake/slide-01.png'],
      captions: {
        linkedin: 'LinkedIn-specific caption',
        default: 'Fallback caption',
      },
    }, ['linkedin']);

    // The post creation call (3rd call) should contain the LinkedIn-specific caption
    const postBody = JSON.parse(fetchWithRetry.mock.calls[2][1].body);
    expect(postBody.commentary).toBe('LinkedIn-specific caption');
  });

  it('falls back to default caption when platform-specific not provided', async () => {
    Object.assign(process.env, {
      LINKEDIN_ACCESS_TOKEN: 'test-token',
      LINKEDIN_ORG_ID: 'urn:li:organization:123',
    });

    fetchWithRetry
      .mockResolvedValueOnce(mockResponse(200, {
        value: {
          uploadUrl: 'https://api.linkedin.com/upload/12345',
          document: 'urn:li:document:12345',
        },
      }))
      .mockResolvedValueOnce(mockResponse(200))
      .mockResolvedValueOnce(mockResponse(201));

    await publishToAllPlatforms({
      pdfPath: '/fake/carousel.pdf',
      imagePaths: ['/fake/slide-01.png'],
      captions: {
        default: 'Fallback caption',
      },
    }, ['linkedin']);

    const postBody = JSON.parse(fetchWithRetry.mock.calls[2][1].body);
    expect(postBody.commentary).toBe('Fallback caption');
  });

  it('returns empty results for empty platform list', async () => {
    const result = await publishToAllPlatforms({
      pdfPath: '/fake/carousel.pdf',
      imagePaths: ['/fake/slide-01.png'],
      captions: { default: 'Caption' },
    }, []);

    expect(result.results).toHaveLength(0);
    expect(result.allSucceeded).toBe(true);
    expect(result.failedPlatforms).toEqual([]);
  });
});
