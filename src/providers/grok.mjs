import fs from 'node:fs';
import { runCommand } from '../util/spawn.mjs';
import { dryResponse, permTier, tmpFile } from './base.mjs';

/**
 * Adapter for the xAI Grok CLI (X Premium subscription login).
 * Prompt is passed via `--prompt-file` (single-turn headless mode).
 * Read roles run in `plan` permission mode; the builder in `acceptEdits`.
 */
export const grok = {
  id: 'grok',
  displayName: 'Grok (xAI)',

  async ask({ role, prompt, cwd, model, timeoutMs, dryRun }) {
    const tier = permTier(role);
    const pf = tmpFile('grok-prompt', prompt);
    const args = [
      '--prompt-file', pf,
      '--output-format', 'json',
      '--permission-mode', tier === 'read' ? 'plan' : 'acceptEdits',
      '--cwd', cwd,
    ];
    if (tier === 'exec') args.push('--disallowed-tools', 'edit,write,multiedit');
    if (model) args.push('-m', model);

    const cmd = `grok ${args.join(' ')}`;
    if (dryRun) {
      safeUnlink(pf);
      return dryResponse('grok', role, cmd);
    }

    const res = await runCommand('grok', args, { cwd, timeoutMs });
    safeUnlink(pf);

    const parsed = parseGrok(res.stdout);
    return {
      ok: res.ok && parsed.ok,
      text: parsed.text,
      raw: res.stdout,
      stderr: parsed.ok ? res.stderr : `${parsed.text}\n${res.stderr}`,
      cmd,
      code: res.code,
      timedOut: res.timedOut,
    };
  },
};

/**
 * Grok's `--output-format json` wraps its result in a typed envelope.
 * Errors look like `{"type":"error","message":"...403 spending-limit..."}`.
 * Successful responses are also enveloped; the assistant text lives in one of
 * a few fields depending on version, so we probe them in order. (The exact
 * success field is inferred — confirm once the account has credits.)
 */
function parseGrok(stdout) {
  let obj = null;
  try { obj = JSON.parse((stdout || '').trim()); } catch { /* not a clean single object */ }

  if (!obj || typeof obj !== 'object') {
    return { ok: true, text: stdout || '' };
  }
  if (obj.type === 'error') {
    const msg = typeof obj.message === 'string' ? obj.message : JSON.stringify(obj.message);
    return { ok: false, text: `grok CLI error: ${msg}` };
  }

  const candidates = [obj.response, obj.result, obj.output, obj.text, obj.message, obj.content];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return { ok: true, text: c };
    if (Array.isArray(c)) {
      const joined = c.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('').trim();
      if (joined) return { ok: true, text: joined };
    }
  }
  return { ok: true, text: JSON.stringify(obj) };
}

function safeUnlink(p) {
  try { fs.unlinkSync(p); } catch { /* ignore */ }
}
