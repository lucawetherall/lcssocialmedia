// dashboard/render-helper.js
// Renders carousel slides to PNG images for dashboard preview
// Uses Puppeteer with the existing HTML templates

import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');

// Find Chrome/Chromium binary
async function findChromePath() {
  const candidates = [
    '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ];
  for (const p of candidates) {
    try {
      await fs.access(p);
      return p;
    } catch {}
  }
  return undefined; // let Puppeteer find its own
}

let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.connected) return browserInstance;

  const executablePath = await findChromePath();
  browserInstance = await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
    ],
  });

  browserInstance.on('disconnected', () => {
    browserInstance = null;
  });

  return browserInstance;
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

    await page.setContent(templateHtml, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);

    const imagePaths = [];

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];

      await page.evaluate(
        (slideData, idx, total) => {
          renderSlide(slideData, idx, total);
        },
        slide,
        i,
        slides.length
      );

      await new Promise((r) => setTimeout(r, 200));

      const filename = `slide-${String(i + 1).padStart(2, '0')}.png`;
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

      imagePaths.push(filename);
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
export async function renderSingleSlide(postId, slideIndex, slide, templateName = 'listicle') {
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

    await page.setContent(templateHtml, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);

    await page.evaluate(
      (slideData, idx, total) => {
        renderSlide(slideData, idx, total);
      },
      slide,
      slideIndex,
      6
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
