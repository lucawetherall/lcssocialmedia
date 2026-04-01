// scripts/install-service.js
// Installs the LCS Carousel Bot as a macOS launchd service.
// Idempotent — safe to run multiple times.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PLIST_LABEL = 'com.lcs.carousel-bot';
const LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents');
const PLIST_DEST = join(LAUNCH_AGENTS_DIR, `${PLIST_LABEL}.plist`);
const PLIST_TEMPLATE = join(ROOT, 'com.lcs.carousel-bot.plist');
const ENV_PATH = join(ROOT, '.env');
const LOGS_DIR = join(ROOT, 'logs');

if (process.platform !== 'darwin') {
  console.error('\n  This script is for macOS only.');
  console.error('  For Linux/VPS deployment, see DEPLOYMENT.md — use pm2.\n');
  process.exit(1);
}

if (!existsSync(ENV_PATH)) {
  console.error('\n  No .env file found. Run the setup wizard first:\n');
  console.error('    npm run setup\n');
  process.exit(1);
}

let nodeBin;
try {
  nodeBin = execSync('which node', { encoding: 'utf8' }).trim();
} catch {
  console.error('\n  Could not locate the node binary. Is Node.js in your PATH?\n');
  process.exit(1);
}

console.log('\n  LCS Carousel Bot — Service Installer');
console.log('  ─────────────────────────────────────');
console.log(`  Project root : ${ROOT}`);
console.log(`  Node binary  : ${nodeBin}`);
console.log(`  Logs dir     : ${LOGS_DIR}`);
console.log(`  Plist dest   : ${PLIST_DEST}\n`);

// [1/5] Create logs directory
mkdirSync(LOGS_DIR, { recursive: true });
console.log('  [1/5] Created logs/ directory');

// [2/5] Configure plist from template
// Strategy: scan lines; when a "<!-- CHANGE THIS" comment appears,
// replace the <string> value on the immediately following line.
const lines = readFileSync(PLIST_TEMPLATE, 'utf8').split('\n');
const replacements = [
  ROOT,                          // WorkingDirectory
  nodeBin,                       // ProgramArguments[0] (node binary)
  `${LOGS_DIR}/stdout.log`,      // StandardOutPath
];
let replacementIdx = 0;
const out = [];

for (const line of lines) {
  // Hardcoded stderr placeholder (no CHANGE THIS comment in template)
  if (line.includes('/Users/YOU/lcssocialmedia/logs/stderr.log')) {
    const indent = line.match(/^(\s*)/)[1];
    out.push(`${indent}<string>${LOGS_DIR}/stderr.log</string>`);
    continue;
  }
  // When previous line was a CHANGE THIS comment, replace the <string> value
  if (
    out.length > 0 &&
    out[out.length - 1].includes('CHANGE THIS') &&
    line.trim().startsWith('<string>') &&
    replacementIdx < replacements.length
  ) {
    const indent = line.match(/^(\s*)/)[1];
    out.push(`${indent}<string>${replacements[replacementIdx]}</string>`);
    replacementIdx++;
    continue;
  }
  out.push(line);
}

console.log('  [2/5] Configured plist from template');

// [3/5] Unload existing (idempotency)
try {
  execSync(`launchctl unload "${PLIST_DEST}" 2>/dev/null`, { stdio: 'ignore' });
  console.log('  [3/5] Unloaded existing service (if any)');
} catch {
  console.log('  [3/5] No existing service to unload');
}

// [4/5] Write plist
mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
writeFileSync(PLIST_DEST, out.join('\n'));
console.log(`  [4/5] Wrote plist to ${PLIST_DEST}`);

// [5/5] Load service
try {
  execSync(`launchctl load "${PLIST_DEST}"`, { encoding: 'utf8' });
  console.log('  [5/5] Service loaded\n');
} catch (err) {
  console.error(`\n  Failed to load service: ${err.message}`);
  console.error(`  Try manually: launchctl load "${PLIST_DEST}"\n`);
  process.exit(1);
}

// Verify
try {
  const list = execSync('launchctl list', { encoding: 'utf8' });
  const match = list.split('\n').find(l => l.includes(PLIST_LABEL));
  if (match) {
    const [pid] = match.trim().split(/\s+/);
    console.log(pid !== '-'
      ? `  Service is running (PID ${pid})`
      : '  Service registered — will start momentarily');
  } else {
    console.log('  Warning: service not found in launchctl list — check logs');
  }
} catch { /* non-fatal */ }

// Success banner
console.log('');
console.log('  ╔══════════════════════════════════════════════════╗');
console.log('  ║   LCS Bot installed as a background service!     ║');
console.log('  ║   It starts automatically on every login.        ║');
console.log('  ╚══════════════════════════════════════════════════╝');
console.log('');
console.log('  Manage the service:');
console.log('    npm run service:status   — check if running');
console.log('    npm run service:logs     — tail stdout log');
console.log('    npm run service:stop     — stop the bot');
console.log('    npm run service:start    — start the bot');
console.log('');
console.log('  Note: if you switch Node versions (nvm), re-run `npm run install-service`');
console.log('  to update the plist with the new node binary path.\n');
