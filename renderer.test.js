import { describe, it, expect, vi } from 'vitest';
import { CONFIG } from './config.js';

// Mock puppeteer to avoid launching real browser
vi.mock('puppeteer', () => ({
  default: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        setViewport: vi.fn(),
        setContent: vi.fn(),
        evaluate: vi.fn(),
        screenshot: vi.fn(),
      }),
      close: vi.fn(),
    }),
  },
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn(),
    readFile: vi.fn().mockResolvedValue(Buffer.from('<html></html>')),
    writeFile: vi.fn(),
  },
}));

// Mock pdf-lib
vi.mock('pdf-lib', () => ({
  PDFDocument: {
    create: vi.fn().mockResolvedValue({
      embedPng: vi.fn().mockResolvedValue({ width: 1080, height: 1350 }),
      addPage: vi.fn().mockReturnValue({ drawImage: vi.fn() }),
      setTitle: vi.fn(),
      setAuthor: vi.fn(),
      save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }),
  },
}));

describe('renderer', () => {
  it('exports renderCarousel function', async () => {
    const mod = await import('./renderer.js');
    expect(typeof mod.renderCarousel).toBe('function');
  });

  it('CONFIG has correct slide dimensions for rendering', () => {
    expect(CONFIG.slide.width).toBe(1080);
    expect(CONFIG.slide.height).toBe(1350);
    // 4:5 aspect ratio
    expect(CONFIG.slide.width / CONFIG.slide.height).toBeCloseTo(0.8);
  });
});
