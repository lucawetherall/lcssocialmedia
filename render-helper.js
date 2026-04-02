// render-helper.js
// Renders carousel slides to PNG images for preview
// Uses Puppeteer with the existing HTML templates

import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = __dirname;
const DATA_DIR = path.join(__dirname, 'data');

// Find Chrome/Chromium binary (cached after first lookup)
let cachedChromePath = undefined;
let chromePathResolved = false;

async function findChromePath() {
  if (chromePathResolved) return cachedChromePath;

  const candidates = [
    '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    // macOS paths
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const p of candidates) {
    try {
      await fs.access(p);
      cachedChromePath = p;
      chromePathResolved = true;
      return cachedChromePath;
    } catch {}
  }
  chromePathResolved = true;
  return undefined; // let Puppeteer find its own
}

// Low-memory Chromium flags for background/always-on use
const CHROME_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--font-render-hinting=none',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-default-apps',
  '--disable-sync',
  '--disable-translate',
  '--metrics-recording-only',
  '--no-first-run',
  '--mute-audio',
  '--hide-scrollbars',
  '--single-process',
];

let browserInstance = null;
let browserLaunchPromise = null;

async function getBrowser() {
  if (browserInstance && browserInstance.connected) return browserInstance;

  // Guard against concurrent callers both launching a browser simultaneously.
  // If a launch is already in progress, wait for it instead of starting another.
  if (browserLaunchPromise) return browserLaunchPromise;

  browserLaunchPromise = (async () => {
    const executablePath = await findChromePath();
    browserInstance = await puppeteer.launch({
      headless: true,
      executablePath,
      args: CHROME_ARGS,
    });

    browserInstance.on('disconnected', () => {
      browserInstance = null;
    });

    return browserInstance;
  })().finally(() => {
    browserLaunchPromise = null;
  });

  return browserLaunchPromise;
}

export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

/**
 * Render all slides for a post and save images to data/posts/{postId}/
 * Returns array of image filenames
 */
export async function renderPostSlides(postId, slides, templateName = 'listicle') {
  const postDir = path.join(DATA_DIR, 'posts', String(postId));
  await fs.mkdir(postDir, { recursive: true });

  // Load template HTML
  const templatePath = path.join(PROJECT_ROOT, `${templateName}.html`);
  let templateHtml;
  try {
    templateHtml = await fs.readFile(templatePath, 'utf-8');
  } catch {
    // Fallback to listicle
    templateHtml = await fs.readFile(path.join(PROJECT_ROOT, 'listicle.html'), 'utf-8');
  }

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({
      width: CONFIG.slide.width,
      height: CONFIG.slide.height,
      deviceScaleFactor: 2,
    });

    // Use networkidle2 (allows 2 outstanding connections) — networkidle0 hangs
    // when Google Fonts keeps connections alive for woff2 downloads
    await page.setContent(templateHtml, { waitUntil: 'networkidle2', timeout: 30000 });
    // Wait for fonts with a timeout — don't block forever if fonts fail to load
    await Promise.race([
      page.evaluate(() => document.fonts.ready),
      new Promise((r) => setTimeout(r, 5000)),
    ]);

    const imagePaths = [];
    const failedSlides = [];

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const filename = `slide-${String(i + 1).padStart(2, '0')}.png`;
      const filepath = path.join(postDir, filename);

      try {
        await page.evaluate(
          (slideData, idx, total) => {
            renderSlide(slideData, idx, total);
          },
          slide,
          i,
          slides.length
        );

        await new Promise((r) => setTimeout(r, 200));

        await page.screenshot({
          path: filepath,
          type: 'png',
          clip: {
            x: 0,
            y: 0,
            width: CONFIG.slide.width,
            height: CONFIG.slide.height,
          },
        });

        imagePaths.push(filename);
      } catch (slideErr) {
        console.error(`Failed to render slide ${i + 1} for post ${postId}:`, slideErr.message);
        failedSlides.push(i + 1);
      }
    }

    if (imagePaths.length === 0) {
      throw new Error(`All ${slides.length} slides failed to render`);
    }

    if (failedSlides.length > 0) {
      console.warn(`Post ${postId}: ${failedSlides.length} slide(s) failed to render (slides ${failedSlides.join(', ')})`);
    }

    // Generate PDF
    await generatePdf(
      imagePaths.map((f) => path.join(postDir, f)),
      postDir,
      slides[0]?.headline || 'The London Choral Service'
    );

    return imagePaths;
  } finally {
    await page.close();
  }
}

async function generatePdf(imagePaths, outputDir, title) {
  const pdfDoc = await PDFDocument.create();

  for (const imgPath of imagePaths) {
    const imgBytes = await fs.readFile(imgPath);
    const img = await pdfDoc.embedPng(imgBytes);
    const pageWidth = 540;
    const pageHeight = 675;
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    page.drawImage(img, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  }

  pdfDoc.setTitle(title);
  pdfDoc.setAuthor('The London Choral Service');

  const pdfBytes = await pdfDoc.save();
  await fs.writeFile(path.join(outputDir, 'carousel.pdf'), pdfBytes);
}

/**
 * Render a single slide (for preview after editing)
 */
export async function renderSingleSlide(postId, slideIndex, slide, templateName = 'listicle', total = CONFIG.slideCount) {
  const postDir = path.join(DATA_DIR, 'posts', String(postId));
  await fs.mkdir(postDir, { recursive: true });

  const templatePath = path.join(PROJECT_ROOT, `${templateName}.html`);
  let templateHtml;
  try {
    templateHtml = await fs.readFile(templatePath, 'utf-8');
  } catch {
    templateHtml = await fs.readFile(path.join(PROJECT_ROOT, 'listicle.html'), 'utf-8');
  }

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({
      width: CONFIG.slide.width,
      height: CONFIG.slide.height,
      deviceScaleFactor: 2,
    });

    await page.setContent(templateHtml, { waitUntil: 'networkidle2', timeout: 30000 });
    await Promise.race([
      page.evaluate(() => document.fonts.ready),
      new Promise((r) => setTimeout(r, 5000)),
    ]);

    await page.evaluate(
      (slideData, idx, total) => {
        renderSlide(slideData, idx, total);
      },
      slide,
      slideIndex,
      total
    );

    await new Promise((r) => setTimeout(r, 200));

    const filename = `slide-${String(slideIndex + 1).padStart(2, '0')}.png`;
    const filepath = path.join(postDir, filename);

    await page.screenshot({
      path: filepath,
      type: 'png',
      clip: {
        x: 0,
        y: 0,
        width: CONFIG.slide.width,
        height: CONFIG.slide.height,
      },
    });

    return filename;
  } finally {
    await page.close();
  }
}
