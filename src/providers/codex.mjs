import fs from 'node:fs';
import { runCommand } from '../util/spawn.mjs';
import { dryResponse, permTier, tmpFile } from './base.mjs';

/**
 * Adapter for the OpenAI Codex CLI (ChatGPT subscription login).
 * Prompt is fed via stdin (no positional prompt) so length/escaping never bite.
 * `-o <file>` captures ONLY the agent's final message, which we read back.
 * Read roles use the read-only sandbox; the builder uses workspace-write.
 */
export const codex = {
  id: 'codex',
  displayName: 'Codex (OpenAI GPT)',

  async ask({ role, prompt, cwd, model, timeoutMs, dryRun }) {
    const tier = permTier(role);
    const outFile = tmpFile('codex-out', '');
    // read-only sandbox still lets codex RUN commands (e.g. `node app.mjs`) — it
    // just can't write to disk — which is exactly the 'exec' verifier tier.
    const args = [
      'exec',
      '--skip-git-repo-check',
      '-C', cwd,
      '--sandbox', tier === 'write' ? 'workspace-write' : 'read-only',
      '-o', outFile,
    ];
    if (model) args.push('-m', model);

    const cmd = `codex ${args.join(' ')}`;
    if (dryRun) {
      safeUnlink(outFile);
      return dryResponse('codex', role, cmd);
    }

    const res = await runCommand('codex', args, { cwd, input: prompt, timeoutMs });

    let text = '';
    try { text = fs.readFileSync(outFile, 'utf8'); } catch { /* fall through */ }
    if (!text.trim()) text = res.stdout;
    safeUnlink(outFile);

    return { ok: res.ok, text, raw: res.stdout, stderr: res.stderr, cmd, code: res.code, timedOut: res.timedOut };
  },
};

function safeUnlink(p) {
  try { fs.unlinkSync(p); } catch { /* ignore */ }
}
