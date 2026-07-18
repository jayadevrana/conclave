import { claude } from './claude.mjs';
import { codex } from './codex.mjs';
import { grok } from './grok.mjs';
import { opencode } from './opencode.mjs';

export const adapters = { claude, codex, grok, opencode };

export function getAdapter(id) {
  const a = adapters[id];
  if (!a) {
    throw new Error(`Unknown adapter '${id}'. Available: ${Object.keys(adapters).join(', ')}`);
  }
  return a;
}
