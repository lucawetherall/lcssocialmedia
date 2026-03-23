#!/usr/bin/env node
// dashboard/server.js
// Express server for the LCS Post Approval Dashboard

import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import db, { queries } from './db.js';
import { renderPostSlides, renderSingleSlide, closeBrowser } from './render-helper.js';
import { generateCarouselContent } from '../content-generator.js';
import { publishToAllPlatforms } from '../poster.js';
import { CONFIG } from '../config.js';
import { cfAccessAuth, apiKeyAuth } from './auth.js';
import { checkTokenExpiry } from '../utils/token-expiry.js';
import { getNextAvailableSlots } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const PORT = process.env.DASHBOARD_PORT || 3000;

const app = express();
app.use(express.json({ limit: '10mb' }));

// ── Health endpoint (no auth) ──
app.get('/health', (req, res) => {
  try {
    const lastPublished = db.prepare(
      "SELECT updated_at FROM posts WHERE status = 'published' ORDER BY updated_at DESC LIMIT 1"
    ).get();
    const pendingPosts = db.prepare(
      "SELECT COUNT(*) as count FROM posts WHERE status IN ('approved', 'scheduled')"
    ).get();
    const nextScheduled = db.prepare(
      "SELECT scheduled_at FROM posts WHERE status = 'scheduled' ORDER BY scheduled_at ASC LIMIT 1"
    ).get();
    const failedPosts = db.prepare(
      "SELECT COUNT(*) as count FROM posts WHERE status = 'failed'"
    ).get();

    res.json({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      lastPublished: lastPublished?.updated_at || null,
      pendingPosts: pendingPosts?.count || 0,
      nextScheduled: nextScheduled?.scheduled_at || null,
      failedPosts: failedPosts?.count || 0,
      tokenWarnings: checkTokenExpiry(),
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ── Auto-generate endpoint (API key auth for GitHub Actions) ──
app.post('/api/auto-generate', apiKeyAuth, async (req, res) => {
  try {
    const batchSizeSetting = queries.getSetting.get('batch_size');
    const batchSize = Math.min(
      parseInt(req.body?.count) || parseInt(batchSizeSetting?.value) || 5,
      20
    );

    // Get available topics (exclude recently used)
    const recentTopics = queries.getRecentTopics.all().map(r => r.topic);
    const availableTopics = CONFIG.topics.filter(t => !recentTopics.includes(t));
    const topicPool = availableTopics.length > 0 ? availableTopics : CONFIG.topics;

    // Get next available schedule slots
    const scheduledPosts = queries.getPostsByStatus.all('scheduled');
    const scheduledDates = scheduledPosts.map(p => p.scheduled_at).filter(Boolean);

    const settingsRows = queries.getAllSettings.all();
    const settings = {};
    for (const row of settingsRows) {
      try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
    }

    const slots = getNextAvailableSlots(batchSize, {
      recurringDays: settings.recurring_days || ['monday', 'thursday'],
      recurringTime: settings.recurring_time || '09:00',
      existingScheduledDates: scheduledDates,
    });

    const results = [];

    for (let i = 0; i < batchSize; i++) {
      const topic = topicPool[Math.floor(Math.random() * topicPool.length)];
      const template = CONFIG.templates[Math.floor(Math.random() * CONFIG.templates.length)];

      try {
        const content = await generateCarouselContent(topic, template);

        const result = queries.createPost.run({
          topic: content.topic,
          template,
          caption: content.caption,
          slides: JSON.stringify(content.slides),
          status: 'approved',
          platforms: JSON.stringify(['linkedin', 'instagram', 'facebook']),
        });

        const postId = result.lastInsertRowid;
        await renderPostSlides(postId, content.slides, template);

        // Mark as rendered
        const post = queries.getPost.get(postId);
        if (post) {
          const parsed = parsePost(post);
          queries.updatePost.run({
            ...parsed,
            slides: JSON.stringify(parsed.slides),
            platforms: JSON.stringify(parsed.platforms),
            rendered: 1,
          });
        }

        // Schedule
        if (slots[i]) {
          queries.updatePostSchedule.run(slots[i], postId);
        }

        // Record topic usage
        queries.recordTopicUsage.run(content.topic);

        results.push({
          id: postId,
          topic: content.topic,
          template,
          status: slots[i] ? 'scheduled' : 'approved',
          scheduled_at: slots[i] || null,
        });

        console.log(`✓ Auto-generated post ${i + 1}/${batchSize}: "${content.topic}" → ${slots[i] || 'unscheduled'}`);
      } catch (err) {
        console.error(`✗ Failed to generate post ${i + 1}:`, err.message);
        results.push({ error: err.message });
      }
    }

    res.json({ generated: results.length, scheduled: slots.slice(0, results.length), results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Apply CF Access to all /api/* routes EXCEPT auto-generate (uses API key auth instead)
app.use('/api', (req, res, next) => {
  if (req.path === '/auto-generate') return next();
  cfAccessAuth(req, res, next);
});

app.use(express.static(path.join(__dirname, 'public')));

// Serve rendered slide images
app.use('/slides', express.static(path.join(DATA_DIR, 'posts')));

// ── Helper ──

function parsePost(row) {
  if (!row) return null;
  return {
    ...row,
    slides: JSON.parse(row.slides || '[]'),
    platforms: JSON.parse(row.platforms || '[]'),
  };
}

// ── API: Posts ──

// List all posts (optional ?status= filter)
app.get('/api/posts', (req, res) => {
  try {
    const { status } = req.query;
    const rows = status
      ? queries.getPostsByStatus.all(status)
      : queries.getAllPosts.all();
    res.json(rows.map(parsePost));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single post
app.get('/api/posts/:id', (req, res) => {
  try {
    const post = parsePost(queries.getPost.get(req.params.id));
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update post (text edits, captions, schedule, platforms)
app.put('/api/posts/:id', async (req, res) => {
  try {
    const existing = parsePost(queries.getPost.get(req.params.id));
    if (!existing) return res.status(404).json({ error: 'Post not found' });

    const updated = {
      id: existing.id,
      topic: req.body.topic ?? existing.topic,
      template: req.body.template ?? existing.template,
      caption: req.body.caption ?? existing.caption,
      caption_linkedin: req.body.caption_linkedin ?? existing.caption_linkedin,
      caption_instagram: req.body.caption_instagram ?? existing.caption_instagram,
      caption_facebook: req.body.caption_facebook ?? existing.caption_facebook,
      slides: JSON.stringify(req.body.slides ?? existing.slides),
      status: req.body.status ?? existing.status,
      scheduled_at: req.body.scheduled_at ?? existing.scheduled_at,
      platforms: JSON.stringify(req.body.platforms ?? existing.platforms),
      rendered: req.body.rendered ?? existing.rendered,
    };

    queries.updatePost.run(updated);

    // If template changed, re-render
    const templateChanged = req.body.template && req.body.template !== existing.template;
    const slidesChanged = req.body.slides && JSON.stringify(req.body.slides) !== JSON.stringify(existing.slides);

    if (templateChanged || slidesChanged) {
      const slides = req.body.slides ?? existing.slides;
      const template = req.body.template ?? existing.template;
      await renderPostSlides(existing.id, slides, template);
      queries.updatePost.run({ ...updated, rendered: 1 });
    }

    res.json(parsePost(queries.getPost.get(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a single slide
app.put('/api/posts/:id/slides/:slideIndex', async (req, res) => {
  try {
    const post = parsePost(queries.getPost.get(req.params.id));
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const idx = parseInt(req.params.slideIndex);
    if (idx < 0 || idx >= post.slides.length) {
      return res.status(400).json({ error: 'Invalid slide index' });
    }

    // Merge slide updates
    post.slides[idx] = { ...post.slides[idx], ...req.body };

    queries.updatePost.run({
      ...post,
      slides: JSON.stringify(post.slides),
      platforms: JSON.stringify(post.platforms),
      rendered: post.rendered,
    });

    // Re-render the changed slide
    await renderSingleSlide(post.id, idx, post.slides[idx], post.template);

    res.json(parsePost(queries.getPost.get(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change post status
app.post('/api/posts/:id/approve', (req, res) => {
  try {
    queries.updatePostStatus.run('approved', req.params.id);
    res.json(parsePost(queries.getPost.get(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/posts/:id/reject', (req, res) => {
  try {
    queries.updatePostStatus.run('rejected', req.params.id);
    res.json(parsePost(queries.getPost.get(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/posts/:id/draft', (req, res) => {
  try {
    queries.updatePostStatus.run('draft', req.params.id);
    res.json(parsePost(queries.getPost.get(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Schedule a post
app.post('/api/posts/:id/schedule', (req, res) => {
  try {
    const { scheduled_at } = req.body;
    if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at required' });
    queries.updatePostSchedule.run(scheduled_at, req.params.id);
    res.json(parsePost(queries.getPost.get(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a post
app.delete('/api/posts/:id', async (req, res) => {
  try {
    queries.deletePost.run(req.params.id);
    // Clean up rendered files
    const postDir = path.join(DATA_DIR, 'posts', req.params.id);
    try { await fs.rm(postDir, { recursive: true }); } catch {}
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Generate batch ──

app.post('/api/generate', async (req, res) => {
  try {
    const count = Math.min(parseInt(req.body.count) || 5, 20);
    const results = [];

    for (let i = 0; i < count; i++) {
      // Pick random topic and template
      const topic = CONFIG.topics[Math.floor(Math.random() * CONFIG.topics.length)];
      const template = CONFIG.templates[Math.floor(Math.random() * CONFIG.templates.length)];

      try {
        const content = await generateCarouselContent(topic, template);

        const result = queries.createPost.run({
          topic: content.topic,
          template,
          caption: content.caption,
          slides: JSON.stringify(content.slides),
          status: 'draft',
          platforms: JSON.stringify(['linkedin', 'instagram', 'facebook']),
        });

        const postId = result.lastInsertRowid;

        // Render slides
        await renderPostSlides(postId, content.slides, template);
        queries.updatePostStatus.run('draft', postId);
        // Mark as rendered
        const post = queries.getPost.get(postId);
        if (post) {
          const parsed = parsePost(post);
          queries.updatePost.run({
            ...parsed,
            slides: JSON.stringify(parsed.slides),
            platforms: JSON.stringify(parsed.platforms),
            rendered: 1,
          });
        }

        results.push({
          id: postId,
          topic: content.topic,
          template,
          status: 'draft',
        });

        console.log(`✓ Generated post ${i + 1}/${count}: "${content.topic}" (${template})`);
      } catch (genErr) {
        console.error(`✗ Failed to generate post ${i + 1}:`, genErr.message);
        results.push({ error: genErr.message });
      }
    }

    res.json({ generated: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Regenerate a single slide ──

app.post('/api/posts/:id/regenerate-slide/:slideIndex', async (req, res) => {
  try {
    const post = parsePost(queries.getPost.get(req.params.id));
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const idx = parseInt(req.params.slideIndex);
    if (idx < 0 || idx >= post.slides.length) {
      return res.status(400).json({ error: 'Invalid slide index' });
    }

    // Generate new content for the whole carousel, then take just the one slide
    const content = await generateCarouselContent(post.topic, post.template);
    const newSlide = content.slides[idx];

    if (!newSlide) return res.status(500).json({ error: 'Regeneration produced no slide at this index' });

    post.slides[idx] = newSlide;

    queries.updatePost.run({
      ...post,
      slides: JSON.stringify(post.slides),
      platforms: JSON.stringify(post.platforms),
      rendered: post.rendered,
    });

    // Re-render the slide
    await renderSingleSlide(post.id, idx, newSlide, post.template);

    res.json(parsePost(queries.getPost.get(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Re-render all slides ──

app.post('/api/posts/:id/render', async (req, res) => {
  try {
    const post = parsePost(queries.getPost.get(req.params.id));
    if (!post) return res.status(404).json({ error: 'Post not found' });

    await renderPostSlides(post.id, post.slides, post.template);

    queries.updatePost.run({
      ...post,
      slides: JSON.stringify(post.slides),
      platforms: JSON.stringify(post.platforms),
      rendered: 1,
    });

    res.json(parsePost(queries.getPost.get(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Publish a post now ──

app.post('/api/posts/:id/publish', async (req, res) => {
  try {
    const post = parsePost(queries.getPost.get(req.params.id));
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const postDir = path.join(DATA_DIR, 'posts', String(post.id));
    const imagePaths = post.slides.map(
      (_, i) => path.join(postDir, `slide-${String(i + 1).padStart(2, '0')}.png`)
    );
    const pdfPath = path.join(postDir, 'carousel.pdf');

    const captionFor = (platform) => post[`caption_${platform}`] || post.caption;

    const publishResult = await publishToAllPlatforms({
      pdfPath,
      imagePaths,
      captions: {
        linkedin: captionFor('linkedin'),
        instagram: captionFor('instagram'),
        facebook: captionFor('facebook'),
        default: post.caption,
      },
    }, post.platforms);

    queries.updatePostStatus.run('published', post.id);
    res.json({ status: 'published', results: publishResult.results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Settings ──

app.get('/api/settings', (req, res) => {
  try {
    const rows = queries.getAllSettings.all();
    const settings = {};
    for (const row of rows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      const strValue = typeof value === 'string' ? value : JSON.stringify(value);
      queries.setSetting.run(key, strValue);
    }
    // Return updated settings
    const rows = queries.getAllSettings.all();
    const settings = {};
    for (const row of rows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Config info (templates, topics) ──

app.get('/api/config', (req, res) => {
  res.json({
    templates: CONFIG.templates,
    topics: CONFIG.topics,
    platforms: Object.keys(CONFIG.platforms),
    slideCount: CONFIG.slideCount,
  });
});

// ── Scheduled post publisher (runs every 60 seconds) ──

let isPublishing = false;

async function publishScheduledPosts() {
  if (isPublishing) return; // Guard: skip if previous cycle still running
  isPublishing = true;
  try {
    // Check if publishing is paused
    const pausedSetting = queries.getSetting.get('paused');
    if (pausedSetting?.value === 'true') return;

    const duePosts = queries.getDuePosts.all();

    // Process sequentially to avoid rate-limit spikes
    for (const row of duePosts) {
      const post = parsePost(row);

      // Set 'publishing' lock to prevent re-pickup on next interval tick
      queries.updatePostStatus.run('publishing', post.id);
      console.log(`⏰ Publishing scheduled post: "${post.topic}"`);

      try {
        const postDir = path.join(DATA_DIR, 'posts', String(post.id));
        const imagePaths = post.slides.map(
          (_, i) => path.join(postDir, `slide-${String(i + 1).padStart(2, '0')}.png`)
        );
        const pdfPath = path.join(postDir, 'carousel.pdf');

        const captionFor = (platform) => post[`caption_${platform}`] || post.caption;

        const result = await publishToAllPlatforms({
          pdfPath,
          imagePaths,
          captions: {
            linkedin: captionFor('linkedin'),
            instagram: captionFor('instagram'),
            facebook: captionFor('facebook'),
            default: post.caption,
          },
        }, post.platforms);

        if (result.allSucceeded) {
          queries.updatePostStatus.run('published', post.id);
          queries.clearPostError.run(post.id);
          console.log(`✓ Scheduled post published: "${post.topic}"`);
        } else {
          throw new Error(`Failed platforms: ${result.failedPlatforms.join(', ')}`);
        }
      } catch (err) {
        const retryCount = (post.retry_count || 0) + 1;
        const maxRetries = 3;

        if (retryCount >= maxRetries) {
          queries.updatePostStatus.run('failed', post.id);
          queries.updatePostError.run(err.message, post.id);
          console.error(`✗ Post permanently failed after ${maxRetries} retries: "${post.topic}" — ${err.message}`);
        } else {
          // Back to scheduled for retry on next tick
          queries.updatePostStatus.run('scheduled', post.id);
          queries.updatePostError.run(err.message, post.id);
          console.warn(`⚠ Post failed (attempt ${retryCount}/${maxRetries}), will retry: "${post.topic}" — ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.error('Scheduler error:', err.message);
  } finally {
    isPublishing = false;
  }
}

setInterval(publishScheduledPosts, 60_000);

// ── SPA fallback ──
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──

app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   LCS Post Approval Dashboard                ║');
  console.log(`║   Running on http://localhost:${PORT}             ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await closeBrowser();
  db.close();
  process.exit(0);
});
