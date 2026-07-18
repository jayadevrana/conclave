import fs from 'node:fs';
import path from 'node:path';
import { getAdapter } from './providers/registry.mjs';

const DEFAULTS = {
  providers: {
    claude: { adapter: 'claude', model: null },
    codex: { adapter: 'codex', model: null },
    grok: { adapter: 'grok', model: null },
    // Free cloud models via OpenCode Zen — nothing to install, no API keys.
    bigpickle: { adapter: 'opencode', model: 'opencode/big-pickle', displayName: 'Big Pickle (free cloud)' },
    nemotron: { adapter: 'opencode', model: 'opencode/nemotron-3-ultra-free', displayName: 'Nemotron 3 Ultra (free cloud)' },
    deepseek: { adapter: 'opencode', model: 'opencode/deepseek-v4-flash-free', displayName: 'DeepSeek V4 Flash (free cloud)' },
    mimo: { adapter: 'opencode', model: 'opencode/mimo-v2.5-free', displayName: 'MiMo V2.5 (free cloud)' },
    northmini: { adapter: 'opencode', model: 'opencode/north-mini-code-free', displayName: 'North Mini Code (free cloud)' },
  },
  roles: {
    orchestrator: 'claude',
    council: ['claude', 'codex'],
    builder: 'codex',
    builders: ['codex', 'claude'],
    verifier: 'claude',
    verifiers: ['claude', 'codex'],
  },
  loop: { debateRounds: 1, maxBuildAttempts: 2, parallelBuild: true, maxTaskAttempts: 2 },
  skills: [],
  timeoutMs: 900000,
  workspace: './workspace',
};

export function loadConfig(configPath) {
  let fileCfg = {};
  if (configPath && fs.existsSync(configPath)) {
    fileCfg = stripComments(JSON.parse(fs.readFileSync(configPath, 'utf8')));
  }
  return deepMerge(DEFAULTS, fileCfg);
}

/**
 * Resolve a provider id (e.g. "codex") into a live handle:
 * { id, adapter, model, displayName }. Throws with a helpful message if the
 * provider isn't declared or its adapter is unknown.
 */
export function resolveProvider(config, id) {
  const decl = config.providers[id];
  if (!decl) {
    throw new Error(
      `Role references provider '${id}', which is not in "providers". ` +
      `Declared: ${Object.keys(config.providers).join(', ')}`
    );
  }
  const adapter = getAdapter(decl.adapter);
  return { id, adapter, model: decl.model ?? null, displayName: decl.displayName || adapter.displayName };
}

function stripComments(obj) {
  if (Array.isArray(obj)) return obj.map(stripComments);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === '//' || k.startsWith('//')) continue;
      out[k] = stripComments(v);
    }
    return out;
  }
  return obj;
}

function deepMerge(base, override) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function defaultConfigPath(cwd = process.cwd()) {
  return path.join(cwd, 'conclave.config.json');
}
