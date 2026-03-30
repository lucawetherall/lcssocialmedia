#!/usr/bin/env node
// telegram-bot.js
// Telegram bot interface for LCS Carousel Pipeline
// Replaces the Express dashboard — sole UI for previewing, approving, and publishing posts.

import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import cron from 'node-cron';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

import {
  parsePost,
  approvePost,
  rejectPost,
  schedulePost,
  deletePost,
  updateCaption,
  reRenderPost,
  publishPost,
  publishScheduledPosts,
  autoGenerate,
  getStatus,
  getNextSlot,
  db,
  queries,
  closeBrowser,
  DATA_DIR,
} from './bot-actions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is required. Get one from @BotFather on Telegram.');
  process.exit(1);
}
if (!CHAT_ID) {
  console.error('TELEGRAM_CHAT_ID is required. Message @userinfobot on Telegram to get your chat ID.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ── Security: only respond to the configured chat ──

bot.use((ctx, next) => {
  if (String(ctx.chat?.id) !== String(CHAT_ID)) return;
  return next();
});

// ── Conversation state (single user, in-memory, auto-expires after 10 min) ──

const CONVERSATION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const conversationState = new Map();

function setConversationState(key, value) {
  conversationState.set(key, { ...value, _ts: Date.now() });
}

function getConversationState(key) {
  const entry = conversationState.get(key);
  if (!entry) return null;
  if (Date.now() - entry._ts > CONVERSATION_TTL_MS) {
    conversationState.delete(key);
    return null;
  }
  return entry;
}

// ── Send post preview ──

async function sendPostPreview(postId) {
  const post = parsePost(queries.getPost.get(postId));
  if (!post) {
    await bot.telegram.sendMessage(CHAT_ID, `Post #${postId} not found.`);
    return;
  }

  const postDir = path.join(DATA_DIR, 'posts', String(postId));

  // Collect rendered slide images
  const mediaGroup = [];
  for (let i = 0; i < post.slides.length; i++) {
    const filename = `slide-${String(i + 1).padStart(2, '0')}.png`;
    const filepath = path.join(postDir, filename);
    try {
      await fs.access(filepath);
      mediaGroup.push({
        type: 'photo',
        media: { source: filepath },
      });
    } catch {
      // slide not rendered
    }
  }

  if (mediaGroup.length > 0) {
    try {
      await bot.telegram.sendMediaGroup(CHAT_ID, mediaGroup);
    } catch (err) {
      await bot.telegram.sendMessage(CHAT_ID, `Failed to send slides: ${err.message}`);
    }
  } else {
    await bot.telegram.sendMessage(CHAT_ID, '(No rendered slides available)');
  }

  // Send caption and action buttons
  const caption = post.caption || '(no caption)';
  const statusLabel = post.status.toUpperCase();
  const text = [
    `Post #${postId} — ${statusLabel}`,
    `Topic: ${post.topic}`,
    `Template: ${post.template}`,
    '',
    caption.slice(0, 3500),
  ].join('\n');

  const keyboard = buildKeyboard(postId, post.status);

  await bot.telegram.sendMessage(CHAT_ID, text, keyboard);
}

function buildKeyboard(postId, status) {
  if (status === 'published' || status === 'rejected') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('Delete', `delete:${postId}`)],
    ]);
  }

  if (status === 'approved') {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('Schedule', `schedule:${postId}`),
        Markup.button.callback('Publish Now', `publish_now:${postId}`),
      ],
      [
        Markup.button.callback('Edit Caption', `edit_caption:${postId}`),
        Markup.button.callback('Re-render', `rerender:${postId}`),
      ],
      [Markup.button.callback('Reject', `reject:${postId}`)],
    ]);
  }

  if (status === 'scheduled') {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('Publish Now', `publish_now:${postId}`),
        Markup.button.callback('Edit Caption', `edit_caption:${postId}`),
      ],
      [Markup.button.callback('Reject', `reject:${postId}`)],
    ]);
  }

  // Default: draft or failed
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Approve', `approve:${postId}`),
      Markup.button.callback('Reject', `reject:${postId}`),
    ],
    [
      Markup.button.callback('Edit Caption', `edit_caption:${postId}`),
      Markup.button.callback('Re-render', `rerender:${postId}`),
    ],
    [
      Markup.button.callback('Schedule', `schedule:${postId}`),
      Markup.button.callback('Publish Now', `publish_now:${postId}`),
    ],
  ]);
}

// ── Commands ──

bot.command('start', (ctx) => {
  ctx.reply([
    'LCS Carousel Bot',
    '',
    '/generate — Generate 1 new post',
    '/generate N — Generate N posts (max 5)',
    '/pending — Show draft/approved/scheduled posts',
    '/status — Post counts & token warnings',
    '/help — Show this message',
  ].join('\n'));
});

bot.command('help', (ctx) => {
  ctx.reply([
    'LCS Carousel Bot',
    '',
    '/generate — Generate 1 new post',
    '/generate N — Generate N posts (max 5)',
    '/pending — Show draft/approved/scheduled posts',
    '/status — Post counts & token warnings',
  ].join('\n'));
});

bot.command('generate', async (ctx) => {
  const args = ctx.message.text.split(/\s+/);
  const count = Math.min(Math.max(parseInt(args[1]) || 1, 1), 5);

  await ctx.reply(`Generating ${count} post(s)...`);

  try {
    const results = await autoGenerate(count);
    const successes = results.filter(r => r.id);

    if (successes.length === 0) {
      await ctx.reply('All generation attempts failed. Check logs.');
      return;
    }

    for (const post of successes) {
      await sendPostPreview(post.id);
    }

    const failures = results.filter(r => r.error);
    if (failures.length > 0) {
      await ctx.reply(`${failures.length} post(s) failed to generate.`);
    }
  } catch (err) {
    await ctx.reply(`Generation error: ${err.message}`);
  }
});

bot.command('pending', async (ctx) => {
  const drafts = queries.getPostsByStatus.all('draft').map(parsePost);
  const approved = queries.getPostsByStatus.all('approved').map(parsePost);
  const scheduled = queries.getPostsByStatus.all('scheduled').map(parsePost);
  const failed = queries.getPostsByStatus.all('failed').map(parsePost);

  const all = [...drafts, ...approved, ...scheduled, ...failed];

  if (all.length === 0) {
    await ctx.reply('No pending posts.');
    return;
  }

  for (const post of all.slice(0, 10)) {
    const label = `#${post.id} [${post.status.toUpperCase()}] ${post.topic}`;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('View', `view:${post.id}`)],
    ]);
    await ctx.reply(label, keyboard);
  }

  if (all.length > 10) {
    await ctx.reply(`...and ${all.length - 10} more.`);
  }
});

bot.command('status', async (ctx) => {
  const s = getStatus();
  const lines = [
    'Status:',
    `  Drafts: ${s.drafts}`,
    `  Pending (approved/scheduled): ${s.pending}`,
    `  Failed: ${s.failed}`,
    `  Last published: ${s.lastPublished || 'never'}`,
    `  Next scheduled: ${s.nextScheduled || 'none'}`,
  ];

  if (s.tokenWarnings && s.tokenWarnings.length > 0) {
    lines.push('');
    lines.push('Token warnings:');
    for (const w of s.tokenWarnings) {
      lines.push(`  ${w}`);
    }
  }

  await ctx.reply(lines.join('\n'));
});

// ── Callback handlers ──

bot.action(/^view:(\d+)$/, async (ctx) => {
  const postId = parseInt(ctx.match[1]);
  await ctx.answerCbQuery();
  await sendPostPreview(postId);
});

bot.action(/^approve:(\d+)$/, async (ctx) => {
  const postId = parseInt(ctx.match[1]);
  try {
    const post = approvePost(postId);
    if (!post) {
      await ctx.answerCbQuery('Post not found');
      return;
    }
    await ctx.answerCbQuery('Approved');

    const keyboard = buildKeyboard(postId, 'approved');
    await ctx.editMessageText(
      `Post #${postId} — APPROVED\nTopic: ${post.topic}\n\n${(post.caption || '').slice(0, 3500)}`,
      keyboard
    );
  } catch (err) {
    await ctx.answerCbQuery('Error');
    await ctx.reply(`Failed to approve: ${err.message}`);
  }
});

bot.action(/^reject:(\d+)$/, async (ctx) => {
  const postId = parseInt(ctx.match[1]);
  try {
    rejectPost(postId);
    await ctx.answerCbQuery('Rejected');

    await ctx.editMessageText(
      `Post #${postId} rejected.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Generate replacement', `replace:${postId}`)],
      ])
    );
  } catch (err) {
    await ctx.answerCbQuery('Error');
    await ctx.reply(`Failed to reject: ${err.message}`);
  }
});

bot.action(/^replace:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery('Generating...');
  await ctx.editMessageText('Generating replacement...');
  try {
    const results = await autoGenerate(1);
    const success = results.find(r => r.id);
    if (success) {
      await sendPostPreview(success.id);
    } else {
      await bot.telegram.sendMessage(CHAT_ID, 'Failed to generate replacement.');
    }
  } catch (err) {
    await bot.telegram.sendMessage(CHAT_ID, `Error: ${err.message}`);
  }
});

bot.action(/^edit_caption:(\d+)$/, async (ctx) => {
  const postId = parseInt(ctx.match[1]);
  await ctx.answerCbQuery();
  setConversationState(String(CHAT_ID), { action: 'awaiting_caption', postId });
  await ctx.reply(`Send the new caption for post #${postId}:`);
});

bot.action(/^caption_apply:(\d+):(.+)$/, async (ctx) => {
  const postId = parseInt(ctx.match[1]);
  const platform = ctx.match[2];
  const state = getConversationState(String(CHAT_ID));

  if (!state || !state.pendingCaption || state.postId !== postId) {
    await ctx.answerCbQuery('Session expired. Try again.');
    return;
  }

  updateCaption(postId, state.pendingCaption, platform);
  conversationState.delete(String(CHAT_ID));

  const label = platform === 'all' ? 'all platforms' : platform;
  await ctx.answerCbQuery(`Caption updated for ${label}`);
  await ctx.editMessageText(`Caption updated for ${label}.`);
});

bot.action(/^rerender:(\d+)$/, async (ctx) => {
  const postId = parseInt(ctx.match[1]);
  await ctx.answerCbQuery('Re-rendering...');

  try {
    await reRenderPost(postId);
    await sendPostPreview(postId);
  } catch (err) {
    await ctx.reply(`Re-render failed: ${err.message}`);
  }
});

bot.action(/^schedule:(\d+)$/, async (ctx) => {
  const postId = parseInt(ctx.match[1]);
  await ctx.answerCbQuery();

  const nextSlot = getNextSlot();
  if (!nextSlot) {
    await ctx.reply('No available slots in the next 90 days.');
    return;
  }

  await ctx.reply(
    `Next available slot: ${nextSlot}\nSchedule post #${postId}?`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('Confirm', `confirm_schedule:${postId}:${nextSlot.replace(' ', 'T')}`),
        Markup.button.callback('Custom time', `custom_schedule:${postId}`),
      ],
    ])
  );
});

bot.action(/^confirm_schedule:(\d+):(.+)$/, async (ctx) => {
  const postId = parseInt(ctx.match[1]);
  const slot = ctx.match[2].replace('T', ' ');
  try {
    schedulePost(postId, slot);
    await ctx.answerCbQuery('Scheduled');
    await ctx.editMessageText(`Post #${postId} scheduled for ${slot}`);
  } catch (err) {
    await ctx.answerCbQuery('Error');
    await ctx.reply(`Failed to schedule: ${err.message}`);
  }
});

bot.action(/^custom_schedule:(\d+)$/, async (ctx) => {
  const postId = parseInt(ctx.match[1]);
  await ctx.answerCbQuery();
  setConversationState(String(CHAT_ID), { action: 'awaiting_schedule', postId });
  await ctx.reply(`Send the date/time for post #${postId} (format: YYYY-MM-DD HH:MM):`);
});

bot.action(/^publish_now:(\d+)$/, async (ctx) => {
  const postId = parseInt(ctx.match[1]);
  await ctx.answerCbQuery('Publishing...');
  await ctx.editMessageText(`Publishing post #${postId}...`);

  try {
    const result = await publishPost(postId);
    const header = result.allSucceeded
      ? `Post #${postId} published.`
      : `Post #${postId} partially failed.`;
    const lines = [header];
    for (const r of result.results) {
      const icon = r.success !== false ? 'OK' : 'FAIL';
      lines.push(`  ${r.platform || 'unknown'}: ${icon}${r.error ? ' — ' + r.error : ''}`);
    }
    await bot.telegram.sendMessage(CHAT_ID, lines.join('\n'));
  } catch (err) {
    await bot.telegram.sendMessage(CHAT_ID, `Publish failed: ${err.message}`);
  }
});

bot.action(/^delete:(\d+)$/, async (ctx) => {
  const postId = parseInt(ctx.match[1]);
  try {
    deletePost(postId);
    await ctx.answerCbQuery('Deleted');
    await ctx.editMessageText(`Post #${postId} deleted.`);
  } catch (err) {
    await ctx.answerCbQuery('Error');
    await ctx.reply(`Failed to delete: ${err.message}`);
  }
});

// ── Text message handler (conversation state) ──

bot.on('text', async (ctx) => {
  // Ignore commands (they're handled above)
  if (ctx.message.text.startsWith('/')) return;

  const state = getConversationState(String(CHAT_ID));
  if (!state) return;

  const text = ctx.message.text.trim();

  if (state.action === 'awaiting_caption') {
    // Store pending caption, ask which platform(s)
    setConversationState(String(CHAT_ID), { ...state, action: 'choosing_platform', pendingCaption: text });

    await ctx.reply(
      'Apply caption to:',
      Markup.inlineKeyboard([
        [Markup.button.callback('All platforms', `caption_apply:${state.postId}:all`)],
        [
          Markup.button.callback('LinkedIn', `caption_apply:${state.postId}:linkedin`),
          Markup.button.callback('Instagram', `caption_apply:${state.postId}:instagram`),
          Markup.button.callback('Facebook', `caption_apply:${state.postId}:facebook`),
        ],
      ])
    );
    return;
  }

  if (state.action === 'awaiting_schedule') {
    // Parse datetime
    const match = text.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/);
    if (!match) {
      await ctx.reply('Invalid format. Use: YYYY-MM-DD HH:MM');
      return;
    }

    const scheduledAt = `${match[1]} ${match[2]}:00`;
    const date = new Date(scheduledAt.replace(' ', 'T') + 'Z');
    if (isNaN(date.getTime())) {
      await ctx.reply('Invalid date. Use: YYYY-MM-DD HH:MM');
      return;
    }

    schedulePost(state.postId, scheduledAt);
    conversationState.delete(String(CHAT_ID));
    await ctx.reply(`Post #${state.postId} scheduled for ${scheduledAt} UTC`);
    return;
  }
});

// ── Cron: auto-generate on schedule ──

cron.schedule('0 9 * * 1,4', async () => {
  console.log('Cron: auto-generating posts...');
  try {
    const results = await autoGenerate(5);
    const successes = results.filter(r => r.id);
    for (const post of successes) {
      await sendPostPreview(post.id);
    }
    if (successes.length > 0) {
      await bot.telegram.sendMessage(CHAT_ID,
        `Auto-generated ${successes.length} post(s). Review above.`
      );
    }
  } catch (err) {
    console.error('Auto-generation failed:', err.message);
    await bot.telegram.sendMessage(CHAT_ID, `Auto-generation failed: ${err.message}`);
  }
});

// ── Cron: publish scheduled posts every 5 minutes ──
// Posts are scheduled hours/days in advance; minute-level precision is unnecessary.

cron.schedule('*/5 * * * *', async () => {
  await publishScheduledPosts((post, success, error) => {
    const msg = success
      ? `Published: "${post.topic}"`
      : `Failed: "${post.topic}" — ${error}`;
    bot.telegram.sendMessage(CHAT_ID, msg).catch(console.error);
  });
});

// ── Graceful shutdown ──

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`\n${signal} received. Shutting down...`);
    bot.stop(signal);
    await closeBrowser();
    db.close();
    process.exit(0);
  });
}

// ── Launch ──

bot.launch();
console.log('LCS Telegram bot started.');
console.log(`Listening for chat ID: ${CHAT_ID}`);
console.log('Cron: auto-generate Mon & Thu at 09:00 UTC');
console.log('Cron: publish scheduler running every 5 minutes');
