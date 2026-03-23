import { describe, it, expect } from 'vitest';
import { CONFIG } from './config.js';

describe('CONFIG', () => {
  it('has valid 4:5 slide dimensions', () => {
    expect(CONFIG.slide.width).toBe(1080);
    expect(CONFIG.slide.height).toBe(1350);
  });

  it('has 6 slides per carousel', () => {
    expect(CONFIG.slideCount).toBe(6);
  });

  it('has at least 20 topics', () => {
    expect(CONFIG.topics.length).toBeGreaterThanOrEqual(20);
  });

  it('has all unique topics', () => {
    const unique = new Set(CONFIG.topics);
    expect(unique.size).toBe(CONFIG.topics.length);
  });

  it('has exactly 4 templates', () => {
    expect(CONFIG.templates).toHaveLength(4);
    expect(CONFIG.templates).toContain('listicle');
    expect(CONFIG.templates).toContain('seasonal');
    expect(CONFIG.templates).toContain('did-you-know');
    expect(CONFIG.templates).toContain('testimonial');
  });

  it('has no TikTok in platforms', () => {
    expect(CONFIG.platforms.tiktok).toBeUndefined();
  });

  it('has LinkedIn, Instagram, Facebook platforms', () => {
    expect(CONFIG.platforms.linkedin).toBeDefined();
    expect(CONFIG.platforms.instagram).toBeDefined();
    expect(CONFIG.platforms.facebook).toBeDefined();
  });

  it('has brand colors defined', () => {
    expect(CONFIG.brand.primary).toBeDefined();
    expect(CONFIG.brand.secondary).toBeDefined();
  });
});
