import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { runTask } from './run.mjs';
import { routeMessage } from './chat.mjs';
import { listSkills } from './skills/loader.mjs';
import { adapters } from './providers/registry.mjs';
import * as log from './util/log.mjs';
import { c } from './util/log.mjs';

const CHAT_HELP = `
Just type what you want built, in plain English. The council debates it,
agrees a plan, builds it (in parallel), and cross-verifies by running the code.

  examples:
    build a discord moderation bot with slash commands
    scrape rss headlines into sqlite and email me a daily digest
    now add user login to it            (follow-ups work — same workspace)

Commands:
  /status                who's on the council, mode, workspace, skills
  /skills                list skill packs (they auto-load from your words)
  /council a,b,...       set the brainstorm panel        e.g. /council claude,codex
  /orchestrator <id>     who synthesizes the plan
  /builders a,b,...      builder pool (parallel mode)
  /verifiers a,b,...     cross-verifier pool
  /sequential | /parallel  one builder vs divide-&-conquer (default: parallel)
  /dry                   toggle dry-run (simulate, zero cost)
  /workspace <dir>       where code is written
  /help                  this help
  /exit                  leave (Ctrl+C works too)
`;

export async function startChat({ config, rootDir }) {
  let dryRun = false;

  log.banner('CONCLAVE');
  console.log(c.dim('  A council of AIs — they debate, plan, build, and verify each other.'));
  console.log(c.dim(`  Providers ready: ${Object.keys(adapters).join(', ')} (using your own CLI logins)`));
  console.log(c.dim(`  Workspace: ${path.resolve(rootDir, config.workspace)}`));
  console.log(c.dim('  Type what you want built — or /help for commands.\n'));

  const rl = readline.createInterface({ input, output });
  rl.on('SIGINT', () => { console.log('\n' + c.dim('bye — your work is saved in the workspace.')); process.exit(0); });

  // Async line iteration (not question()) so buffered/piped input isn't lost
  // and interactive typing works identically.
  const history = [];
  const lines = rl[Symbol.asyncIterator]();
  for (;;) {
    output.write(c.cyan(c.bold('conclave ❯ ')));
    let next;
    try {
      next = await lines.next();
    } catch {
      break; // stdin closed (Ctrl+D)
    }
    if (next.done) break;
    const line = next.value.trim();
    if (!line) continue;

    if (line.startsWith('/')) {
      if (handleCommand(line, config, rootDir, { get dry() { return dryRun; }, toggleDry: () => (dryRun = !dryRun) }) === 'exit') break;
      continue;
    }

    // Front desk (Claude Code-style): answer questions directly; only real
    // build requests convene the council. Input is paused while we work so
    // stray typing can't garble the output.
    history.push(`User: ${line}`);
    rl.pause();
    try {
      const workspace = path.resolve(rootDir, config.workspace);
      let route;
      if (dryRun) {
        route = { action: 'build', task: line }; // dry mode = wiring test, skip routing
      } else {
        console.log(c.dim('  thinking…'));
        route = await routeMessage({ message: line, history, config, workspace, rootDir });
      }

      if (route.action === 'answer') {
        console.log(`\n${route.reply}\n`);
        history.push(`Conclave: ${route.reply.slice(0, 400)}`);
        continue;
      }

      console.log(c.dim(`\n  Convening the council${dryRun ? ' (dry-run)' : ''} — this genuinely debates, builds, and runs code, so give it a few minutes…`));
      const res = await runTask({ task: route.task, config, rootDir, dryRun });

      console.log('');
      if (res.verdict === 'PASS') {
        log.ok(`Done — verified PASS. Your code is in: ${res.workspace}`);
      } else if (res.verdict === 'ERROR') {
        log.err(`Run failed: ${res.error}`);
      } else {
        log.warn(`Finished with verdict ${res.verdict} — see the report for what the verifier flagged.`);
      }
      if (res.reportPath) log.info(`Full debate & report: ${res.reportPath}`);
      console.log(c.dim('  Ask for changes in plain words (e.g. "now add ...") — the council continues in the same workspace.\n'));
      history.push(`Conclave: built "${route.task.slice(0, 200)}" → ${res.verdict}`);
    } finally {
      rl.resume();
    }
  }

  rl.close();
}

function handleCommand(line, config, rootDir, dry) {
  const [cmd, ...rest] = line.split(/\s+/);
  const arg = rest.join(' ').trim();
  const csv = () => arg.split(',').map((s) => s.trim()).filter(Boolean);

  switch (cmd) {
    case '/exit': case '/quit': case '/q':
      console.log(c.dim('bye — your work is saved in the workspace.'));
      return 'exit';
    case '/help': case '/?':
      console.log(CHAT_HELP);
      return;
    case '/status':
      console.log(`  Council:      ${config.roles.council.join(', ')}`);
      console.log(`  Orchestrator: ${config.roles.orchestrator}`);
      console.log(`  Builders:     ${(config.roles.builders || [config.roles.builder]).join(', ')}   Verifiers: ${(config.roles.verifiers || [config.roles.verifier]).join(', ')}`);
      console.log(`  Mode:         ${config.loop.parallelBuild === false ? 'sequential (one builder)' : 'parallel (divide & conquer)'}${dry.dry ? '   [DRY-RUN]' : ''}`);
      console.log(`  Workspace:    ${path.resolve(rootDir, config.workspace)}`);
      console.log(`  Skills:       ${listSkills().map((s) => s.id).join(', ') || '(none)'} — auto-matched from your words`);
      return;
    case '/skills':
      for (const s of listSkills()) console.log(`  ${s.id.padEnd(14)} ${s.name} — ${s.description}`);
      console.log(c.dim('  Add more: conclave skills add <id> <file-or-github-url> --keywords a,b'));
      return;
    case '/council':      if (arg) { config.roles.council = csv(); } return void console.log(`  Council → ${config.roles.council.join(', ')}`);
    case '/orchestrator': if (arg) { config.roles.orchestrator = arg; } return void console.log(`  Orchestrator → ${config.roles.orchestrator}`);
    case '/builders':     if (arg) { config.roles.builders = csv(); config.roles.builder = csv()[0]; } return void console.log(`  Builders → ${(config.roles.builders || []).join(', ')}`);
    case '/verifiers':    if (arg) { config.roles.verifiers = csv(); config.roles.verifier = csv()[0]; } return void console.log(`  Verifiers → ${(config.roles.verifiers || []).join(', ')}`);
    case '/sequential':   config.loop.parallelBuild = false; return void console.log('  Mode → sequential (one builder does the whole task)');
    case '/parallel':     config.loop.parallelBuild = true;  return void console.log('  Mode → parallel (divide & conquer in worktrees)');
    case '/dry':          dry.toggleDry(); return void console.log(`  Dry-run → ${dry.dry ? 'ON (simulated, zero cost)' : 'OFF (real runs)'}`);
    case '/workspace':    if (arg) { config.workspace = arg; } return void console.log(`  Workspace → ${path.resolve(rootDir, config.workspace)}`);
    default:
      console.log(c.dim(`  Unknown command ${cmd} — /help for the list.`));
  }
}
