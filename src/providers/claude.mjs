import { runCommand } from '../util/spawn.mjs';
import { dryResponse, permTier } from './base.mjs';

const NO_EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

// exec-tier (verifier) allowlist: run programs/tests + read-only inspection.
// Deliberately NOT blanket Bash — Claude runs on the real filesystem with no OS
// sandbox, so we only pre-approve safe run/test/inspect commands. Anything else
// would need approval (and simply won't run headlessly), which is the safe default.
const SAFE_EXEC_TOOLS = [
  'Bash(node *)', 'Bash(npm test)', 'Bash(npm run *)', 'Bash(npx *)',
  'Bash(python *)', 'Bash(python3 *)', 'Bash(pytest *)',
  'Bash(go test *)', 'Bash(cargo test *)',
  'Bash(ls *)', 'Bash(cat *)', 'Bash(head *)', 'Bash(tail *)',
  'Bash(grep *)', 'Bash(rg *)', 'Bash(od *)', 'Bash(find *)',
  'Read', 'Grep', 'Glob',
];

/**
 * Adapter for the Claude Code CLI (Anthropic subscription login).
 *   read  → plan mode (inspect only)
 *   exec  → acceptEdits but edit tools disallowed (can RUN bash/tests, can't edit)
 *   write → acceptEdits with the workspace writable
 */
export const claude = {
  id: 'claude',
  displayName: 'Claude Code (Anthropic)',

  async ask({ role, prompt, cwd, model, timeoutMs, dryRun }) {
    const tier = permTier(role);
    const args = ['-p', '--output-format', 'json'];
    if (tier === 'write') {
      args.push('--permission-mode', 'acceptEdits', '--add-dir', cwd);
    } else if (tier === 'exec') {
      // Verifier: may RUN the built code/tests (safe allowlist) but not edit files.
      args.push('--add-dir', cwd, '--allowedTools', ...SAFE_EXEC_TOOLS, '--disallowedTools', ...NO_EDIT_TOOLS);
    } else {
      args.push('--permission-mode', 'plan');
    }
    if (model) args.push('--model', model);

    const cmd = `claude ${args.join(' ')}`;
    if (dryRun) return dryResponse('claude', role, cmd);

    const res = await runCommand('claude', args, { cwd, input: prompt, timeoutMs });

    // Print mode returns a JSON envelope: { type, subtype, result, ... }
    let text = res.stdout;
    try {
      const j = JSON.parse(res.stdout);
      text = j.result ?? j.text ?? res.stdout;
    } catch {
      /* keep raw stdout */
    }
    return { ok: res.ok, text, raw: res.stdout, stderr: res.stderr, cmd, code: res.code, timedOut: res.timedOut };
  },
};
