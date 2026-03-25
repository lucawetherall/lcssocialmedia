import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateCarouselContent } from './content-generator.js';

describe('generateCarouselContent', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const validContent = {
    topic: 'Test topic',
    caption: 'Test caption #music',
    slides: Array.from({ length: 6 }, (_, i) => ({
      type: i === 0 ? 'hook' : i === 5 ? 'cta' : 'content',
      icon: '\ud83c\udfb5',
      headline: `Slide ${i + 1} headline`,
      body: i === 0 ? '' : 'Some body text here',
    })),
  };

  function mockGeminiResponse(content) {
    return {
      ok: true,
      json: () => Promise.resolve({
        candidates: [{ content: { parts: [{ text: JSON.stringify(content) }] } }],
      }),
    };
  }

  it('returns structured content with 6 slides', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockGeminiResponse(validContent));
    const result = await generateCarouselContent('Test topic', 'listicle');
    expect(result.slides).toHaveLength(6);
    expect(result.topic).toBe('Test topic');
    expect(result.caption).toBeDefined();
  });

  it('throws on missing API key', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(generateCarouselContent('topic')).rejects.toThrow('GEMINI_API_KEY');
  });

  it('throws on API error response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 500, text: () => Promise.resolve('Internal error'),
    });
    await expect(generateCarouselContent('topic')).rejects.toThrow('Gemini API error 500');
  });

  it('throws on malformed JSON response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        candidates: [{ content: { parts: [{ text: 'not json' }] } }],
      }),
    });
    await expect(generateCarouselContent('topic')).rejects.toThrow();
  });

  it('throws on wrong slide count', async () => {
    const bad = { ...validContent, slides: validContent.slides.slice(0, 3) };
    globalThis.fetch = vi.fn().mockResolvedValue(mockGeminiResponse(bad));
    await expect(generateCarouselContent('topic')).rejects.toThrow('Expected 6 slides');
  });

  it('throws on invalid slide type', async () => {
    const bad = { ...validContent, slides: validContent.slides.map((s, i) => i === 2 ? { ...s, type: 'invalid' } : s) };
    globalThis.fetch = vi.fn().mockResolvedValue(mockGeminiResponse(bad));
    await expect(generateCarouselContent('topic')).rejects.toThrow('invalid type');
  });

  it('skips thinking parts in response and extracts JSON from non-thinking part', async () => {
    const responseWithThinking = {
      ok: true,
      json: () => Promise.resolve({
        candidates: [{
          content: {
            parts: [
              { thought: true, text: 'Let me think about this carousel...' },
              { text: JSON.stringify(validContent) },
            ],
          },
        }],
      }),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(responseWithThinking);
    const result = await generateCarouselContent('Test topic', 'listicle');
    expect(result.slides).toHaveLength(6);
    expect(result.topic).toBe('Test topic');
  });

  it('sends thinkingConfig inside generationConfig per Gemini API docs', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockGeminiResponse(validContent));
    await generateCarouselContent('Test topic', 'listicle');
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(body.thinkingConfig).toBeUndefined();
  });

  it('defaults empty body to empty string', async () => {
    const content = { ...validContent, slides: validContent.slides.map(s => ({ ...s, body: null })) };
    globalThis.fetch = vi.fn().mockResolvedValue(mockGeminiResponse(content));
    const result = await generateCarouselContent('topic');
    expect(result.slides.every(s => typeof s.body === 'string')).toBe(true);
  });
});
