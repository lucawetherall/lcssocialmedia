#!/usr/bin/env node
// scripts/setup-env.js
// Interactive setup wizard for configuring .env with all required API keys.
// Uses only built-in Node.js modules — no additional dependencies.

import { createInterface } from 'readline';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { arch } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ENV_PATH = join(ROOT, '.env');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

// ── Validation helpers ──

const isNonEmpty = (s) => s.trim().length > 0;
const isNumeric = (s) => /^\d+$/.test(s.trim());
const isUrn = (s) => /^urn:li:organization:\d+$/.test(s.trim());
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s.trim()) && !isNaN(Date.parse(s.trim()));
const isAny = () => true;

function defaultExpiryDate() {
  const d = new Date();
  d.setDate(d.getDate() + 60);
  return d.toISOString().split('T')[0];
}

// ── Key definitions ──

const keys = [
  {
    name: 'GEMINI_API_KEY',
    section: 'Content Generation (FREE)',
    description: 'Google Gemini API key for AI content generation.',
    url: 'https://aistudio.google.com/apikey',
    hint: 'Free — no credit card required. 15 requests/min.',
    validate: isNonEmpty,
    required: true,
  },
  {
    name: 'LINKEDIN_ACCESS_TOKEN',
    section: 'LinkedIn',
    description: 'OAuth token for LinkedIn posting.',
    url: 'https://www.linkedin.com/developers/',
    hint: 'Create app → request "Community Management API" → generate OAuth token.\nScopes: w_member_social, w_organization_social. Expires in ~60 days.',
    validate: isNonEmpty,
    required: true,
  },
  {
    name: 'LINKEDIN_ORG_ID',
    section: 'LinkedIn',
    description: 'LinkedIn Company Page URN.',
    hint: 'Format: urn:li:organization:XXXXXXXX — get the number from your Company Page URL.',
    validate: isUrn,
    validateMsg: 'Must be in format: urn:li:organization:12345678',
    required: true,
  },
  {
    name: 'FB_PAGE_ACCESS_TOKEN',
    section: 'Meta (Facebook + Instagram)',
    description: 'Page Access Token for Facebook and Instagram.',
    url: 'https://developers.facebook.com/',
    hint: 'Create app → add "Instagram Graph API" → generate Page Access Token.\nPermissions: pages_manage_posts, instagram_basic, instagram_content_publish.\nExpires in ~60 days.',
    validate: isNonEmpty,
    required: true,
  },
  {
    name: 'FB_PAGE_ID',
    section: 'Meta (Facebook + Instagram)',
    description: 'Facebook Page ID.',
    hint: 'Facebook Page → About → Page ID (numeric).',
    validate: isNumeric,
    validateMsg: 'Must be a numeric ID',
    required: true,
  },
  {
    name: 'IG_USER_ID',
    section: 'Meta (Facebook + Instagram)',
    description: 'Instagram Professional Account User ID.',
    hint: 'GET /{page-id}?fields=instagram_business_account in Graph API Explorer.',
    validate: isNumeric,
    validateMsg: 'Must be a numeric ID',
    required: true,
  },
  {
    name: 'IMGBB_API_KEY',
    section: 'Image Hosting (FREE)',
    description: 'imgbb API key for temporary image hosting (Instagram/Facebook need public URLs).',
    url: 'https://api.imgbb.com/',
    hint: 'Free — sign up and get your API key from the dashboard.',
    validate: isNonEmpty,
    required: true,
  },
  {
    name: 'TOKEN_EXPIRY_LINKEDIN',
    section: 'Token Expiry Tracking',
    description: 'LinkedIn token expiry date.',
    hint: 'YYYY-MM-DD format. /status command warns 7 days before expiry.',
    validate: isDate,
    validateMsg: 'Must be YYYY-MM-DD format',
    required: false,
    default: defaultExpiryDate,
  },
  {
    name: 'TOKEN_EXPIRY_META',
    section: 'Token Expiry Tracking',
    description: 'Meta (Facebook/Instagram) token expiry date.',
    hint: 'YYYY-MM-DD format. /status command warns 7 days before expiry.',
    validate: isDate,
    validateMsg: 'Must be YYYY-MM-DD format',
    required: false,
    default: defaultExpiryDate,
  },
  {
    name: 'TELEGRAM_BOT_TOKEN',
    section: 'Telegram Bot',
    description: 'Telegram bot token for post previews and approval.',
    hint: 'Message @BotFather on Telegram → /newbot → follow the prompts → copy the token.',
    validate: isNonEmpty,
    required: true,
  },
  {
    name: 'TELEGRAM_CHAT_ID',
    section: 'Telegram Bot',
    description: 'Your Telegram chat ID (the bot only responds to this chat).',
    hint: 'Message @userinfobot on Telegram to find your numeric chat ID.',
    validate: isNumeric,
    validateMsg: 'Must be a numeric chat ID',
    required: true,
  },
];

// ── Helpers ──

function openUrl(url) {
  try {
    const platform = process.platform;
    if (platform === 'darwin') execSync(`open "${url}"`, { stdio: 'ignore' });
    else if (platform === 'win32') execSync(`start "" "${url}"`, { stdio: 'ignore' });
    else execSync(`xdg-open "${url}" 2>/dev/null || true`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function loadExistingEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const env = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
  }
  return env;
}

function detectPuppeteerPath() {
  const cpuArch = arch();
  if (cpuArch === 'arm64' || cpuArch === 'arm') {
    const paths = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/snap/bin/chromium'];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return '/usr/bin/chromium-browser';
  }
  return '';
}

// ── Main ──

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   LCS Social Media — Environment Setup Wizard    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  // Check for existing .env
  const existing = loadExistingEnv();
  let merge = false;
  if (Object.keys(existing).length > 0) {
    console.log(`Found existing .env with ${Object.keys(existing).length} values.`);
    const choice = await ask('Merge with existing values? (Y/n) ');
    merge = choice.trim().toLowerCase() !== 'n';
    if (merge) console.log('Existing values will be kept as defaults.\n');
    else console.log('Starting fresh.\n');
  }

  const values = merge ? { ...existing } : {};
  let currentSection = '';

  for (const key of keys) {
    // Print section header
    if (key.section !== currentSection) {
      currentSection = key.section;
      console.log(`\n── ${currentSection} ──`);
    }

    console.log(`\n${key.description}`);
    if (key.hint) console.log(`  ${key.hint.replace(/\n/g, '\n  ')}`);

    // Offer to open URL
    if (key.url) {
      const open = await ask(`  Open ${key.url} in browser? (y/N) `);
      if (open.trim().toLowerCase() === 'y') {
        if (openUrl(key.url)) console.log('  Opened!');
        else console.log(`  Could not open browser. Visit: ${key.url}`);
      }
    }

    // Determine default value
    const existingVal = merge ? existing[key.name] : undefined;
    const defaultVal = existingVal || (key.default ? key.default() : '');
    const defaultDisplay = defaultVal ? ` [${defaultVal}]` : '';
    const requiredTag = key.required ? ' (required)' : ' (optional)';

    // Prompt loop with validation
    let value = '';
    while (true) {
      const input = await ask(`  ${key.name}${requiredTag}${defaultDisplay}: `);
      value = input.trim() || defaultVal;

      if (!value && !key.required) break;
      if (!value && key.required) {
        console.log('  This field is required.');
        continue;
      }
      if (key.validate && !key.validate(value)) {
        console.log(`  Invalid: ${key.validateMsg || 'check the format and try again'}`);
        continue;
      }
      break;
    }

    if (value) values[key.name] = value;
  }

  // Detect Puppeteer path for ARM
  const puppeteerPath = detectPuppeteerPath();
  if (puppeteerPath) {
    values.PUPPETEER_EXECUTABLE_PATH = puppeteerPath;
    console.log(`\n  ARM detected — using system Chromium: ${puppeteerPath}`);
  }

  // Write .env file
  console.log('\n── Writing .env ──');

  const envContent = [
    '# ═══════════════════════════════════════════════',
    '# LCS Social Media Automation — Environment Config',
    '# Generated by setup wizard',
    '# ═══════════════════════════════════════════════',
    '',
    '# ── Content Generation ──',
    `GEMINI_API_KEY=${values.GEMINI_API_KEY || ''}`,
    '',
    '# ── LinkedIn ──',
    `LINKEDIN_ACCESS_TOKEN=${values.LINKEDIN_ACCESS_TOKEN || ''}`,
    `LINKEDIN_ORG_ID=${values.LINKEDIN_ORG_ID || ''}`,
    '',
    '# ── Meta (Facebook + Instagram) ──',
    `FB_PAGE_ACCESS_TOKEN=${values.FB_PAGE_ACCESS_TOKEN || ''}`,
    `FB_PAGE_ID=${values.FB_PAGE_ID || ''}`,
    `IG_USER_ID=${values.IG_USER_ID || ''}`,
    '',
    '# ── Image Hosting ──',
    `IMGBB_API_KEY=${values.IMGBB_API_KEY || ''}`,
    '',
    '# ── Token Expiry Dates ──',
    `TOKEN_EXPIRY_LINKEDIN=${values.TOKEN_EXPIRY_LINKEDIN || ''}`,
    `TOKEN_EXPIRY_META=${values.TOKEN_EXPIRY_META || ''}`,
    '',
    '# ── Telegram Bot ──',
    `TELEGRAM_BOT_TOKEN=${values.TELEGRAM_BOT_TOKEN || ''}`,
    `TELEGRAM_CHAT_ID=${values.TELEGRAM_CHAT_ID || ''}`,
    '',
    ...(values.PUPPETEER_EXECUTABLE_PATH
      ? ['# ── Puppeteer (ARM) ──', `PUPPETEER_EXECUTABLE_PATH=${values.PUPPETEER_EXECUTABLE_PATH}`, '']
      : []),
  ].join('\n');

  writeFileSync(ENV_PATH, envContent);
  console.log(`  Written to ${ENV_PATH}`);

  // Summary
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Setup Complete!                                ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log('Next steps:');
  console.log('');
  console.log('  1. Start the Telegram bot:');
  console.log('     npm start');
  console.log('');
  console.log('  2. Open Telegram and send /generate to your bot');
  console.log('');
  console.log('  3. For always-on deployment, use pm2:');
  console.log('     npx pm2 start telegram-bot.js --name lcs-bot');
  console.log('     npx pm2 startup');
  console.log('     npx pm2 save');
  console.log('');

  rl.close();
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  rl.close();
  process.exit(1);
});
