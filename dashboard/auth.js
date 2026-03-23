// dashboard/auth.js
// Cloudflare Access JWT validation middleware
// Verifies the Cf-Access-Jwt-Assertion header on every request.
// When CF_ACCESS_ENABLED is not 'true', all requests are allowed (for local dev).

import { createRemoteJWKSet, jwtVerify } from 'jose';

const CF_ACCESS_ENABLED = process.env.CF_ACCESS_ENABLED === 'true';
const CF_TEAM_DOMAIN = process.env.CF_ACCESS_TEAM_DOMAIN;  // e.g. "myteam"
const CF_AUD = process.env.CF_ACCESS_AUD;                  // Application Audience (AUD) tag

let jwks = null;

function getJWKS() {
  if (!jwks) {
    const certsUrl = new URL(`https://${CF_TEAM_DOMAIN}.cloudflareaccess.com/cdn-cgi/access/certs`);
    jwks = createRemoteJWKSet(certsUrl);
  }
  return jwks;
}

export function apiKeyAuth(req, res, next) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API_KEY not configured on server' });
  }
  const provided = req.headers['x-api-key'];
  if (!provided || provided !== apiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}

export async function cfAccessAuth(req, res, next) {
  if (!CF_ACCESS_ENABLED) return next();

  const token = req.headers['cf-access-jwt-assertion'];
  if (!token) {
    return res.status(403).json({ error: 'Access denied — no Cloudflare Access token' });
  }

  try {
    await jwtVerify(token, getJWKS(), {
      audience: CF_AUD,
      issuer: `https://${CF_TEAM_DOMAIN}.cloudflareaccess.com`,
    });
    next();
  } catch (err) {
    console.error('CF Access JWT verification failed:', err.message);
    return res.status(403).json({ error: 'Access denied — invalid token' });
  }
}
