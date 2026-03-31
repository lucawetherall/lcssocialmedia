// utils/token-refresh.js
// Automatic token refresh for LinkedIn and Meta.
// Reads credentials from .env, refreshes tokens before they expire,
// writes updated values back to .env, and notifies via callback.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '..', '.env');

const REFRESH_BUFFER_DAYS = 7; // refresh this many days before expiry

// ── .env read/write ──

function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const env = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

function updateEnvValue(key, value) {
  if (!existsSync(ENV_PATH)) return;
  let content = readFileSync(ENV_PATH, 'utf8');
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  writeFileSync(ENV_PATH, content);

  // Also update process.env so the running bot picks it up
  process.env[key] = value;
}

// ── Refresh logic ──

function daysUntilExpiry(expiryStr) {
  if (!expiryStr) return Infinity;
  const expiry = new Date(expiryStr);
  if (isNaN(expiry.getTime())) return Infinity;
  return Math.ceil((expiry - new Date()) / (1000 * 60 * 60 * 24));
}

function expiryDateFromSeconds(seconds) {
  const d = new Date();
  d.setSeconds(d.getSeconds() + seconds);
  return d.toISOString().split('T')[0];
}

async function refreshLinkedIn(env) {
  const { LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_REFRESH_TOKEN } = env;

  if (!LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET || !LINKEDIN_REFRESH_TOKEN) {
    return { skipped: true, reason: 'Missing LinkedIn OAuth credentials (client ID, secret, or refresh token)' };
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: LINKEDIN_REFRESH_TOKEN,
    client_id: LINKEDIN_CLIENT_ID,
    client_secret: LINKEDIN_CLIENT_SECRET,
  });

  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(`LinkedIn refresh failed: ${data.error_description || data.error}`);
  }

  const newExpiry = expiryDateFromSeconds(data.expires_in);
  updateEnvValue('LINKEDIN_ACCESS_TOKEN', data.access_token);
  updateEnvValue('TOKEN_EXPIRY_LINKEDIN', newExpiry);

  if (data.refresh_token) {
    updateEnvValue('LINKEDIN_REFRESH_TOKEN', data.refresh_token);
  }

  return { refreshed: true, newExpiry };
}

async function refreshMeta(env) {
  const { FB_PAGE_ACCESS_TOKEN, META_APP_ID, META_APP_SECRET } = env;

  if (!META_APP_ID || !META_APP_SECRET || !FB_PAGE_ACCESS_TOKEN) {
    return { skipped: true, reason: 'Missing Meta OAuth credentials (app ID, secret, or page token)' };
  }

  // Extend the existing long-lived token
  const url =
    `https://graph.facebook.com/v25.0/oauth/access_token` +
    `?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(META_APP_ID)}` +
    `&client_secret=${encodeURIComponent(META_APP_SECRET)}` +
    `&fb_exchange_token=${encodeURIComponent(FB_PAGE_ACCESS_TOKEN)}`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    throw new Error(`Meta refresh failed: ${data.error.message}`);
  }

  // Now get updated page tokens using the refreshed user token
  const pagesRes = await fetch(
    `https://graph.facebook.com/v25.0/me/accounts?access_token=${data.access_token}`
  );
  const pagesData = await pagesRes.json();

  if (pagesData.error) {
    throw new Error(`Meta pages fetch failed: ${pagesData.error.message}`);
  }

  // Find the matching page by ID
  const currentPageId = env.FB_PAGE_ID;
  const matchingPage = (pagesData.data || []).find(p => p.id === currentPageId);

  if (matchingPage) {
    const newExpiry = expiryDateFromSeconds(data.expires_in || 5184000); // default 60 days
    updateEnvValue('FB_PAGE_ACCESS_TOKEN', matchingPage.access_token);
    updateEnvValue('TOKEN_EXPIRY_META', newExpiry);
    return { refreshed: true, newExpiry };
  }

  // If no matching page found, just update the token we have
  const newExpiry = expiryDateFromSeconds(data.expires_in || 5184000);
  updateEnvValue('FB_PAGE_ACCESS_TOKEN', data.access_token);
  updateEnvValue('TOKEN_EXPIRY_META', newExpiry);
  return { refreshed: true, newExpiry, warning: 'Could not match page ID — used user token instead' };
}

/**
 * Check and refresh tokens that are expiring soon.
 * @param {function} notify - Callback (platform, message) for sending notifications
 * @returns {object} Results for each platform
 */
export async function checkAndRefreshTokens(notify) {
  const env = loadEnv();
  const results = {};

  // LinkedIn
  const linkedInDays = daysUntilExpiry(env.TOKEN_EXPIRY_LINKEDIN);
  if (linkedInDays <= REFRESH_BUFFER_DAYS) {
    try {
      results.linkedin = await refreshLinkedIn(env);
      if (results.linkedin.refreshed && notify) {
        notify('LinkedIn', `Token refreshed. New expiry: ${results.linkedin.newExpiry}`);
      }
    } catch (err) {
      results.linkedin = { error: err.message };
      if (notify) {
        notify('LinkedIn', `Token refresh FAILED: ${err.message}. Use /reauth to reconnect.`);
      }
    }
  } else {
    results.linkedin = { ok: true, daysRemaining: linkedInDays };
  }

  // Meta
  const metaDays = daysUntilExpiry(env.TOKEN_EXPIRY_META);
  if (metaDays <= REFRESH_BUFFER_DAYS) {
    try {
      results.meta = await refreshMeta(env);
      if (results.meta.refreshed && notify) {
        notify('Meta', `Token refreshed. New expiry: ${results.meta.newExpiry}`);
      }
    } catch (err) {
      results.meta = { error: err.message };
      if (notify) {
        notify('Meta', `Token refresh FAILED: ${err.message}. Use /reauth to reconnect.`);
      }
    }
  } else {
    results.meta = { ok: true, daysRemaining: metaDays };
  }

  return results;
}
