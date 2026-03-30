// bot-actions.js
// Business logic for Telegram bot — extracted from dashboard/server.js
// All functions are framework-agnostic (no Telegraf dependency) for testability.

import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import db, { queries } from './db.js';
import { renderPostSlides, closeBrowser } from './render-helper.js';
import { generateCarouselContent } from './content-generator.js';
import { publishToAllPlatforms } from './poster.js';
import { CONFIG } from './config.js';
import { checkTokenExpiry } from './utils/token-expiry.js';
import { getNextAvailableSlots } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

// ── Helpers ──

function cleanupPostFiles(postId) {
  const postDir = path.join(DATA_DIR, 'posts', String(postId));
  fs.rm(postDir, { recursive: true }).catch((err) => {
    if (err.code !== 'ENOENT') console.warn(`Cleanup failed for post ${postId}:`, err.message);
  });
}

export function parsePost(row) {
  if (!row) return null;
  return {
    ...row,
    slides: JSON.parse(row.slides || '[]'),
    platforms: JSON.parse(row.platforms || '[]'),
  };
}

// ── Post actions ──

export function approvePost(postId) {
  queries.updatePostStatus.run('approved', postId);
  return parsePost(queries.getPost.get(postId));
}

export function rejectPost(postId) {
  queries.updatePostStatus.run('rejected', postId);
  return parsePost(queries.getPost.get(postId));
}

export function schedulePost(postId, scheduledAt) {
  queries.updatePostSchedule.run(scheduledAt, postId);
  return parsePost(queries.getPost.get(postId));
}

export function deletePost(postId) {
  queries.deletePost.run(postId);
  const postDir = path.join(DATA_DIR, 'posts', String(postId));
  fs.rm(postDir, { recursive: true }).catch(() => {});
}

export function updateCaption(postId, caption, platform) {
  const post = parsePost(queries.getPost.get(postId));
  if (!post) return null;

  if (!platform || platform === 'all') {
    post.caption = caption;
  } else {
    post[`caption_${platform}`] = caption;
  }

  queries.updatePost.run({
    ...post,
    slides: JSON.stringify(post.slides),
    platforms: JSON.stringify(post.platforms),
    rendered: post.rendered,
  });

  return parsePost(queries.getPost.get(postId));
}

// ── Rendering ──

export async function reRenderPost(postId) {
  const post = parsePost(queries.getPost.get(postId));
  if (!post) throw new Error('Post not found');

  await renderPostSlides(post.id, post.slides, post.template);

  queries.updatePost.run({
    ...post,
    slides: JSON.stringify(post.slides),
    platforms: JSON.stringify(post.platforms),
    rendered: 1,
  });
  queries.clearPostError.run(post.id);

  return parsePost(queries.getPost.get(postId));
}

// ── Publishing ──

export async function publishPost(postId) {
  const post = parsePost(queries.getPost.get(postId));
  if (!post) throw new Error('Post not found');

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
    // Clean up rendered files — they're no longer needed after publishing
    cleanupPostFiles(post.id);
  } else {
    queries.updatePostStatus.run('failed', post.id);
    queries.updatePostError.run(`Failed platforms: ${result.failedPlatforms.join(', ')}`, post.id);
  }

  return result;
}

/**
 * Check for and publish any scheduled posts that are due.
 * @param {function} notifyFn - Called with (post, success, error) after each publish attempt
 */
let isPublishing = false;

export async function publishScheduledPosts(notifyFn) {
  if (isPublishing) return;
  isPublishing = true;

  try {
    const pausedSetting = queries.getSetting.get('paused');
    if (pausedSetting?.value === 'true') return;

    const duePosts = queries.getDuePosts.all();

    for (const row of duePosts) {
      const post = parsePost(row);

      queries.updatePostStatus.run('publishing', post.id);
      console.log(`Publishing scheduled post: "${post.topic}"`);

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
          cleanupPostFiles(post.id);
          console.log(`Scheduled post published: "${post.topic}"`);
          if (notifyFn) notifyFn(post, true, null);
        } else {
          throw new Error(`Failed platforms: ${result.failedPlatforms.join(', ')}`);
        }
      } catch (err) {
        const retryCount = (post.retry_count || 0) + 1;
        const maxRetries = 3;

        if (retryCount >= maxRetries) {
          queries.updatePostStatus.run('failed', post.id);
          queries.updatePostError.run(err.message, post.id);
          console.error(`Post permanently failed after ${maxRetries} retries: "${post.topic}" — ${err.message}`);
          if (notifyFn) notifyFn(post, false, err.message);
        } else {
          queries.updatePostStatus.run('scheduled', post.id);
          queries.updatePostError.run(err.message, post.id);
          console.warn(`Post failed (attempt ${retryCount}/${maxRetries}), will retry: "${post.topic}" — ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.error('Scheduler error:', err.message);
  } finally {
    isPublishing = false;
  }
}

// ── Auto-generation ──

/**
 * Generate new posts with content and rendered slides.
 * @param {number} count - Number of posts to generate
 * @returns {Array} Array of { id, topic, template, status } or { error }
 */
export async function autoGenerate(count) {
  const batchSize = Math.min(count || 5, 20);

  const recentTopics = queries.getRecentTopics.all().map(r => r.topic);
  const availableTopics = CONFIG.topics.filter(t => !recentTopics.includes(t));
  const topicPool = availableTopics.length > 0 ? availableTopics : CONFIG.topics;

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
        status: 'draft',
        platforms: JSON.stringify(['linkedin', 'instagram', 'facebook']),
      });

      const postId = Number(result.lastInsertRowid);

      try {
        await renderPostSlides(postId, content.slides, template);
        const post = queries.getPost.get(postId);
        if (post) {
          const parsed = parsePost(post);
          queries.updatePost.run({
            ...parsed,
            slides: JSON.stringify(parsed.slides),
            platforms: JSON.stringify(parsed.platforms),
            rendered: 1,
          });
          queries.clearPostError.run(postId);
        }
      } catch (renderErr) {
        console.error(`Rendering failed for post ${postId}:`, renderErr.message);
        queries.updatePostError.run(`Rendering failed: ${renderErr.message}`, postId);
      }

      queries.recordTopicUsage.run(content.topic);

      results.push({
        id: postId,
        topic: content.topic,
        template,
        status: 'draft',
      });

      console.log(`Generated post ${i + 1}/${batchSize}: "${content.topic}" (${template})`);
    } catch (err) {
      console.error(`Failed to generate post ${i + 1}:`, err.message);
      results.push({ error: err.message });
    }
  }

  return results;
}

// ── Status / health ──

export function getStatus() {
  return {
    drafts: queries.getDraftCount.get()?.count || 0,
    pending: queries.getPendingCount.get()?.count || 0,
    failed: queries.getFailedCount.get()?.count || 0,
    lastPublished: queries.getLastPublished.get()?.updated_at || null,
    nextScheduled: queries.getNextScheduled.get()?.scheduled_at || null,
    tokenWarnings: checkTokenExpiry(),
  };
}

/**
 * Get the next available scheduling slot.
 */
export function getNextSlot() {
  const scheduledPosts = queries.getPostsByStatus.all('scheduled');
  const scheduledDates = scheduledPosts.map(p => p.scheduled_at).filter(Boolean);

  const settingsRows = queries.getAllSettings.all();
  const settings = {};
  for (const row of settingsRows) {
    try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
  }

  const slots = getNextAvailableSlots(1, {
    recurringDays: settings.recurring_days || ['monday', 'thursday'],
    recurringTime: settings.recurring_time || '09:00',
    existingScheduledDates: scheduledDates,
  });

  return slots[0] || null;
}

export { db, queries, closeBrowser, DATA_DIR };
