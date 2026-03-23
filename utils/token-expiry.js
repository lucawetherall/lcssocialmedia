// utils/token-expiry.js
// Check OAuth token expiry dates and return warnings

const TOKEN_MAP = {
  TOKEN_EXPIRY_LINKEDIN: 'LinkedIn',
  TOKEN_EXPIRY_META: 'Meta (Facebook + Instagram)',
};

const WARNING_DAYS = 7;

export function checkTokenExpiry(env = process.env) {
  const warnings = [];
  const now = new Date();

  for (const [envVar, platformName] of Object.entries(TOKEN_MAP)) {
    const expiryStr = env[envVar];
    if (!expiryStr) continue;

    const expiry = new Date(expiryStr);
    if (isNaN(expiry.getTime())) continue;

    const daysRemaining = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

    if (daysRemaining <= 0) {
      warnings.push(`${platformName} token EXPIRED ${Math.abs(daysRemaining)} days ago — regenerate immediately`);
    } else if (daysRemaining <= WARNING_DAYS) {
      warnings.push(`${platformName} token expires in ${daysRemaining} days — regenerate soon`);
    }
  }

  return warnings;
}
