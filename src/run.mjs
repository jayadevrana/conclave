import fs from 'node:fs';
import path from 'node:path';
import { Blackboard } from './blackboard.mjs';
import { runCouncil } from './council.mjs';
import { recordToHermes } from './hermes/index.mjs';
import { loadSkills, matchSkills } from './skills/loader.mjs';
import * as log from './util/log.mjs';

/**
 * Resolve which skill packs apply: explicit ids (CSV / config.skills) win;
 * otherwise AUTO-match the task text against the open-ended registry.
 * 'none' disables skills entirely.
 */
export function resolveSkills(task, config, skillCsv) {
  const explicit = [
    ...(skillCsv ? skillCsv.split(',').map((s) => s.trim()) : []),
    ...(Array.isArray(config.skills) ? config.skills : []),
  ].filter(Boolean);

  let ids = [];
  let auto = false;
  if (explicit.includes('none')) ids = [];
  else if (explicit.length) ids = explicit;
  else {
    ids = matchSkills(task).map((s) => s.id);
    auto = ids.length > 0;
  }
  return { ...loadSkills([...new Set(ids)]), auto };
}

/**
 * Run one council task end-to-end: skills → blackboard → council →
 * report + Hermes memory. Shared by the one-shot CLI and the interactive chat.
 * Never calls process.exit — returns a result object instead.
 */
export async function runTask({ task, config, rootDir, dryRun = false, skillCsv }) {
  const workspace = path.resolve(rootDir, config.workspace);
  fs.mkdirSync(workspace, { recursive: true });

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const runDir = path.join(rootDir, '.conclave', 'runs', runId);

  const skillsPack = resolveSkills(task, config, skillCsv);
  if (skillsPack.loaded.length) {
    log.info(`Skills:       ${skillsPack.loaded.join(', ')}${skillsPack.auto ? '  (auto-matched)' : ''}${skillsPack.missing.length ? `  (unknown: ${skillsPack.missing.join(', ')})` : ''}`);
  } else if (skillsPack.missing.length) {
    log.warn(`Skills: none loaded — unknown skill id(s): ${skillsPack.missing.join(', ')}`);
  }

  const blackboard = new Blackboard(runDir, {
    runId,
    task,
    council: config.roles.council,
    orchestrator: config.roles.orchestrator,
    builder: config.roles.builder,
    verifier: config.roles.verifier,
    workspace,
    dryRun,
  });

  let result;
  try {
    result = await runCouncil({ task, config, blackboard, cwd: workspace, rootDir, dryRun, skills: skillsPack.text });
  } catch (e) {
    blackboard.event('fatal', { message: e.message });
    blackboard.writeReport();
    return { verdict: 'ERROR', error: e.message, workspace, runDir };
  }

  const reportPath = blackboard.writeReport();
  const mem = recordToHermes(rootDir, blackboard.data);
  const verdict = result.finalVerdict?.verdict ?? 'incomplete';

  return { verdict, workspace, runDir, reportPath, filesLearned: mem.filesTouched.length };
}
