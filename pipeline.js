#!/usr/bin/env node
// scripts/pipeline.js
// Main orchestrator — generates content, renders slides, posts to all platforms

import 'dotenv/config';
import { generateCarouselContent } from './content-generator.js';
import { renderCarousel } from './renderer.js';
import { postToLinkedIn, postToInstagram, postToFacebook } from './poster.js';
import { CONFIG } from './config.js';

// ── Parse CLI flags ──
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const RENDER_ONLY = args.includes('--render-only');
const topicFlag = args.find((a) => a.startsWith('--topic='));
const topicOverride = topicFlag?.split('=').slice(1).join('=') || process.env.TOPIC_OVERRIDE;

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   The London Choral Service                  ║');
  console.log('║   Carousel Pipeline                          ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // ── Step 2 prep: Pick template first so content generation can match its format ──
  const template = CONFIG.templates[Math.floor(Math.random() * CONFIG.templates.length)];

  // Validate template exists, fall back to listicle if not
  let templateName = template;
  try {
    const { access } = await import('fs/promises');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    await access(path.join(__dirname, '..', 'templates', `${template}.html`));
  } catch {
    console.log(`│  ⚠ Template "${template}" not found, using "listicle"`);
    templateName = 'listicle';
  }

  // ── Step 1: Generate content ──
  console.log('┌─ Step 1: Content Generation ─────────────────');
  console.log(`│  Template: ${templateName}`);
  const content = await generateCarouselContent(topicOverride, templateName);
  console.log(`│  Topic: "${content.topic}"`);
  console.log(`│  Slides: ${content.slides.length}`);
  console.log(`│  Caption: ${content.caption.substring(0, 80)}...`);
  console.log('└──────────────────────────────────────────────');
  console.log('');

  if (DRY_RUN) {
    console.log('── DRY RUN: Content generated, skipping render + post ──');
    console.log(JSON.stringify(content, null, 2));
    return;
  }

  // ── Step 2: Render slides ──
  console.log('┌─ Step 2: Rendering Slides ───────────────────');
  console.log(`│  Template: ${templateName}`);

  const { imagePaths, pdfPath } = await renderCarousel(content, templateName);
  console.log(`│  Images: ${imagePaths.length} PNGs`);
  console.log(`│  PDF: ${pdfPath}`);
  console.log('└──────────────────────────────────────────────');
  console.log('');

  if (RENDER_ONLY) {
    console.log('── RENDER ONLY: Slides rendered, skipping post ──');
    console.log('Output files in ./output/');
    return;
  }

  // ── Step 3: Post to platforms ──
  console.log('┌─ Step 3: Posting to Platforms ────────────────');

  const caption = content.caption;

  // LinkedIn: upload PDF
  await postToLinkedIn(pdfPath, caption);

  // Instagram: upload carousel images
  await postToInstagram(imagePaths, caption);

  // Facebook: multi-image post
  await postToFacebook(imagePaths, caption);

  console.log('└──────────────────────────────────────────────');
  console.log('');
  console.log('✓ Pipeline complete');
}

main().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
