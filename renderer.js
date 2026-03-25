// scripts/renderer.js
// Renders carousel slides to PNG images and a combined PDF using Puppeteer

import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

export async function renderCarousel(content, templateName = 'listicle') {
  // Ensure output directory exists
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const templatePath = path.join(TEMPLATE_DIR, `${templateName}.html`);
  const templateHtml = await fs.readFile(templatePath, 'utf-8');

  console.log(`⎔ Launching Puppeteer...`);
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
    ],
  });

  const imagePaths = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: CONFIG.slide.width,
      height: CONFIG.slide.height,
      deviceScaleFactor: 2, // 2x for crisp rendering
    });

    // Load the template — 30s timeout guards against slow/unavailable Google Fonts CDN
    // Use networkidle2 (allows 2 outstanding connections) — networkidle0 hangs
    // when Google Fonts keeps connections alive for woff2 downloads
    await page.setContent(templateHtml, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for Google Fonts to load (with 5s timeout fallback)
    await Promise.race([
      page.evaluate(() => document.fonts.ready),
      new Promise((r) => setTimeout(r, 5000)),
    ]);

    // Render each slide
    for (let i = 0; i < content.slides.length; i++) {
      const slide = content.slides[i];

      // Inject slide data and render
      await page.evaluate(
        (slideData, idx, total) => {
          renderSlide(slideData, idx, total);
        },
        slide,
        i,
        content.slides.length
      );

      // Small delay for any CSS transitions/reflows
      await new Promise((r) => setTimeout(r, 200));

      // Screenshot
      const filename = `slide-${String(i + 1).padStart(2, '0')}.png`;
      const filepath = path.join(OUTPUT_DIR, filename);

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

      imagePaths.push(filepath);
      console.log(`  ✓ Rendered ${filename}`);
    }
  } finally {
    await browser.close();
  }

  // Generate combined PDF for LinkedIn
  const pdfPath = await generatePdf(imagePaths, content.topic);

  console.log(`✓ All ${imagePaths.length} slides rendered`);
  console.log(`✓ PDF generated: ${pdfPath}`);

  return { imagePaths, pdfPath };
}

async function generatePdf(imagePaths, title) {
  const pdfDoc = await PDFDocument.create();

  for (const imgPath of imagePaths) {
    const imgBytes = await fs.readFile(imgPath);
    const img = await pdfDoc.embedPng(imgBytes);

    // Page size matches slide aspect ratio (in points: 1pt = 1/72 inch)
    // Using a reasonable size that preserves quality
    const pageWidth = 540;  // ~7.5 inches
    const pageHeight = 675; // maintains 4:5 ratio
    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    page.drawImage(img, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    });
  }

  pdfDoc.setTitle(title || 'The London Choral Service');
  pdfDoc.setAuthor('The London Choral Service');

  const pdfBytes = await pdfDoc.save();
  const pdfPath = path.join(OUTPUT_DIR, 'carousel.pdf');
  await fs.writeFile(pdfPath, pdfBytes);

  return pdfPath;
}
