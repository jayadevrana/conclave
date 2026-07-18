import { runCommand } from '../util/spawn.mjs';
import { dryResponse, permTier } from './base.mjs';

/**
 * Adapter for cloud models via the OpenCode CLI (`opencode run`) — including
 * OpenCode Zen's FREE hosted models (big-pickle, nemotron, deepseek, mimo…).
 * Nothing to install or key-manage: they run in the cloud through OpenCode's
 * own auth. OpenCode is itself an agent with file tools, so tiers map to its
 * agents: write → `build` (can edit files), read/exec → `plan` (no edits).
 *
 * Configure any model as a council member:
 *   "nemotron": { "adapter": "opencode", "model": "opencode/nemotron-3-ultra-free" }
 */
export const opencode = {
  id: 'opencode',
  displayName: 'OpenCode cloud',

  async ask({ role, prompt, cwd, model, timeoutMs, dryRun }) {
    const tier = permTier(role);
    const args = ['run', '--agent', tier === 'write' ? 'build' : 'plan'];
    if (model) args.push('--model', model);
    args.push(prompt);

    const cmd = `opencode run --agent ${tier === 'write' ? 'build' : 'plan'} --model ${model ?? '(default)'} "<prompt>"`;
    if (dryRun) return dryResponse(model || 'opencode', role, cmd);

    const res = await runCommand('opencode', args, { cwd, timeoutMs });
    return {
      ok: res.ok,
      text: clean(res.stdout),
      raw: res.stdout,
      stderr: res.stderr,
      cmd,
      code: res.code,
      timedOut: res.timedOut,
    };
  },
};

/** Strip ANSI codes and opencode's "> agent · model" header line. */
function clean(stdout) {
  const lines = String(stdout ?? '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n');
  while (lines.length && (lines[0].trim() === '' || /^>\s/.test(lines[0]))) lines.shift();
  return lines.join('\n').trim();
}
