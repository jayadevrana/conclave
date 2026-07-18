import fs from 'node:fs';
import path from 'node:path';

/**
 * Hermes recall (M3) — turn what past runs learned into a compact primer the
 * council reads BEFORE planning, so it matches the user's established stack,
 * conventions, and prior decisions. Returns '' when there is no prior memory.
 */
export function buildPrimer(rootDir, { maxRuns = 5 } = {}) {
  const dir = path.join(rootDir, '.conclave', 'hermes');
  const profile = readJson(path.join(dir, 'profile.json'));
  const recent = readRecent(path.join(dir, 'memory.jsonl'), maxRuns);
  if (!profile && recent.length === 0) return '';

  const lines = ['## What we know about how you work (Hermes memory)'];

  if (profile) {
    const verdicts = Object.entries(profile.verdicts || {}).map(([k, v]) => `${k}:${v}`).join(', ');
    lines.push(`- Past runs: ${profile.runs ?? 0}${verdicts ? ` (verdicts — ${verdicts})` : ''}.`);
    const hot = Object.entries(profile.fileHotspots || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (hot.length) lines.push(`- Frequently-touched files: ${hot.map(([f, n]) => `${f} (${n}x)`).join(', ')}.`);
  }

  if (recent.length) {
    lines.push('- Recent tasks & decisions:');
    for (const r of recent) {
      const files = r.filesTouched?.length ? ` [${r.filesTouched.slice(0, 5).join(', ')}]` : '';
      lines.push(`  • "${truncate(r.task, 100)}" → ${r.verdict}${files}`);
      for (const d of (r.decisions || []).slice(0, 2)) lines.push(`      - decided: ${truncate(String(d), 120)}`);
    }
  }

  lines.push('Match this established stack, conventions, and prior decisions; do not contradict them without reason.');
  return lines.join('\n');
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function readRecent(p, n) {
  let txt = '';
  try { txt = fs.readFileSync(p, 'utf8'); } catch { return []; }
  const rows = txt.trim().split('\n').filter(Boolean);
  return rows.slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
