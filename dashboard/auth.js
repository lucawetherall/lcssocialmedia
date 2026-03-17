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
