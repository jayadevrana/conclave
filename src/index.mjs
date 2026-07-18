#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { loadConfig, defaultConfigPath } from './config.mjs';
import { runTask } from './run.mjs';
import { startChat } from './tui.mjs';
import { listSkills, addSkill, removeSkill } from './skills/loader.mjs';
import * as log from './util/log.mjs';

const HELP = `
conclave — a council of AI coding CLIs that brainstorm, converge, build, and verify.

USAGE
  conclave                       open the interactive chat (default — just talk to it)
  conclave "<task>" [options]    one-shot mode (for scripts/automation)

OPTIONS (one-shot)
  --config <path>        Config file (default: ./conclave.config.json)
  --workspace <dir>      Where code is built (default: from config)
  --orchestrator <id>    Provider that synthesizes the plan
  --council <a,b,...>    Providers on the brainstorm/critique panel
  --builders <a,b,...>   Builder pool (tasks split round-robin across them)
  --verifiers <a,b,...>  Cross-verifier pool
  --builder <id>         Single builder (sequential mode)
  --verifier <id>        Single verifier (sequential mode)
  --parallel             Divide into sub-tasks, build in parallel worktrees (default)
  --sequential           One builder does the whole task
  --rounds <n>           Debate rounds
  --max-build <n>        Max build↔verify attempts (sequential)
  --max-task <n>         Max attempts per sub-task (parallel)
  --timeout <ms>         Per-model-call timeout
  --skill <a,b|none>     Override skill packs (default: auto-matched from your task text)
  --dry-run              Simulate every model call (no CLIs, no cost)
  -h, --help             Show this help

SKILLS (open-ended library — auto-matched to whatever you're building)
  conclave skills                                  list registered skills
  conclave skills add <id> <file-or-github-url> [--name "..."] [--desc "..."] [--keywords a,b]
  conclave skills remove <id>
`;

async function skillsCommand(opts) {
  const sub = opts._[1] || 'list';
  if (sub === 'list') {
    const skills = listSkills();
    if (!skills.length) { console.log('No skills registered.'); return; }
    for (const s of skills) {
      console.log(`${s.id.padEnd(14)} ${s.name}  —  ${s.description}${s.keywords?.length ? `  [auto: ${s.keywords.join(', ')}]` : ''}`);
    }
    return;
  }
  if (sub === 'add') {
    const [, , id, source] = opts._;
    if (!id || !source) {
      console.log('Usage: conclave skills add <id> <file-or-github-url> [--name "..."] [--desc "..."] [--keywords a,b,c]');
      process.exit(1);
    }
    const entry = await addSkill(id, source, {
      name: opts.name,
      description: opts.desc,
      keywords: opts.keywords ? opts.keywords.split(',').map((s) => s.trim()) : [],
    });
    console.log(`Added skill '${entry.id}' (${entry.name})${entry.keywords.length ? ` — auto-matches on: ${entry.keywords.join(', ')}` : ''}`);
    return;
  }
  if (sub === 'remove') {
    const id = opts._[2];
    console.log(removeSkill(id) ? `Removed skill '${id}'.` : `No such skill '${id}'.`);
    return;
  }
  console.log(`Unknown skills subcommand '${sub}'. Use: list | add | remove`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--parallel') opts.parallel = true;
    else if (a === '--sequential') opts.sequential = true;
    else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i];
    else opts._.push(a);
  }
  return opts;
}

function applyOverrides(config, opts) {
  if (opts.orchestrator) config.roles.orchestrator = opts.orchestrator;
  if (opts.builder) config.roles.builder = opts.builder;
  if (opts.verifier) config.roles.verifier = opts.verifier;
  if (opts.builders) config.roles.builders = opts.builders.split(',').map((s) => s.trim());
  if (opts.verifiers) config.roles.verifiers = opts.verifiers.split(',').map((s) => s.trim());
  if (opts.council) config.roles.council = opts.council.split(',').map((s) => s.trim());
  if (opts.rounds) config.loop.debateRounds = Number(opts.rounds);
  if (opts['max-build']) config.loop.maxBuildAttempts = Number(opts['max-build']);
  if (opts['max-task']) config.loop.maxTaskAttempts = Number(opts['max-task']);
  if (opts.timeout) config.timeoutMs = Number(opts.timeout);
  if (opts.sequential) config.loop.parallelBuild = false;
  if (opts.parallel) config.loop.parallelBuild = true;
  if (opts.workspace) config.workspace = opts.workspace;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts._[0] === 'skills') {
    await skillsCommand(opts);
    process.exit(0);
  }
  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  const configPath = opts.config || defaultConfigPath();
  const config = loadConfig(configPath);
  applyOverrides(config, opts);
  const rootDir = process.cwd();

  // No task given → open the interactive chat (the default experience).
  if (opts._.length === 0) {
    await startChat({ config, rootDir });
    process.exit(0);
  }

  // One-shot mode (scripts/automation).
  const task = opts._.join(' ');
  const workspace = path.resolve(rootDir, config.workspace);

  log.banner('CONCLAVE');
  log.info(`Task:         ${task}`);
  log.info(`Council:      ${config.roles.council.join(', ')}`);
  log.info(`Orchestrator: ${config.roles.orchestrator}   Builder: ${config.roles.builder}   Verifier: ${config.roles.verifier}`);
  log.info(`Workspace:    ${workspace}`);
  if (opts.dryRun) log.warn('DRY RUN — simulating all model calls (no CLIs invoked, no cost).');

  const res = await runTask({ task, config, rootDir, dryRun: !!opts.dryRun, skillCsv: opts.skill });

  log.banner('RESULT');
  if (res.verdict === 'ERROR') {
    log.err(`Run failed: ${res.error}`);
    process.exit(1);
  }
  (res.verdict === 'PASS' ? log.ok : log.warn)(`Final verdict: ${res.verdict}`);
  log.info(`Transcript: ${path.relative(rootDir, path.join(res.runDir, 'transcript.json'))}`);
  log.info(`Report:     ${path.relative(rootDir, res.reportPath)}`);
  log.info(`Hermes:     recorded run to .conclave/hermes/ (${res.filesLearned} file(s) learned)`);
  process.exit(res.verdict === 'PASS' ? 0 : 2);
}

main();
