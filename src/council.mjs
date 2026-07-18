import { resolveProvider } from './config.mjs';
import { extractJson } from './util/json.mjs';
import * as log from './util/log.mjs';
import {
  proposePrompt, critiquePrompt, convergePrompt, buildPrompt, verifyPrompt,
} from './prompts.mjs';
import { runParallelBuild } from './parallel.mjs';
import { buildPrimer } from './hermes/recall.mjs';

/**
 * Run the full council loop for a single task:
 *   1. Propose   — every council member drafts an independent approach (parallel)
 *   2. Critique  — each member reviews all proposals, adversarially (parallel)
 *   3. Converge  — the orchestrator synthesizes ONE agreed plan
 *   4. Build     — the builder implements it (write access)
 *   5. Verify    — the verifier checks it against acceptance criteria (read-only)
 *   6. Repeat 4–5 up to maxBuildAttempts until the verifier returns PASS
 */
export async function runCouncil({ task, config, blackboard, cwd, rootDir, dryRun, skills }) {
  const council = config.roles.council.map((id) => resolveProvider(config, id));
  const orchestrator = resolveProvider(config, config.roles.orchestrator);
  const builder = resolveProvider(config, config.roles.builder);
  const verifier = resolveProvider(config, config.roles.verifier);
  const timeoutMs = config.timeoutMs;

  // call() runs one model. callCwd lets M2 point each builder at its own worktree.
  const call = async (provider, role, prompt, callCwd = cwd) => {
    const t0 = Date.now();
    const res = await provider.adapter.ask({ role, prompt, cwd: callCwd, model: provider.model, timeoutMs, dryRun });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (!res.ok) {
      log.err(`${provider.id} (${role}) exited ${res.code}${res.timedOut ? ' [timeout]' : ''} — ${firstLine(res.stderr)}`);
    } else {
      log.ok(`${provider.id} (${role}) responded in ${secs}s`);
    }
    blackboard.event('model_call', { provider: provider.id, role, ok: res.ok, code: res.code, secs, dry: !!res.dry });
    return { ...res, json: extractJson(res.text) };
  };

  // Hermes recall (M3): prime the council with what past runs learned.
  const primer = buildPrimer(rootDir || process.cwd());
  if (primer) {
    log.info('Hermes: primed the council with memory from past runs');
    blackboard.set('primer', primer);
  }

  // ── Phase 1: Propose ────────────────────────────────────────────────────
  log.phase(1, `Propose — ${council.length} council member(s) brainstorm independently`);
  const proposals = await Promise.all(
    council.map(async (p) => {
      log.step(p.displayName, 'drafting an approach…');
      const r = await call(p, 'proposer', proposePrompt({ name: p.id, task, workspace: cwd, primer }));
      return { name: p.id, text: r.text, json: r.json };
    })
  );
  proposals.forEach((p) => blackboard.push('proposals', p));

  // ── Phase 2: Critique ───────────────────────────────────────────────────
  log.phase(2, 'Critique — members challenge each other');
  const critiques = await Promise.all(
    council.map(async (p) => {
      log.step(p.displayName, 'critiquing proposals…');
      const r = await call(p, 'critic', critiquePrompt({ name: p.id, task, proposals }));
      return { name: p.id, text: r.text, json: r.json };
    })
  );
  critiques.forEach((c) => blackboard.push('critiques', c));

  // ── Phase 3: Converge ───────────────────────────────────────────────────
  log.phase(3, `Converge — ${orchestrator.displayName} synthesizes one agreed plan`);
  log.step(orchestrator.displayName, 'resolving disagreements…');
  const conv = await call(
    orchestrator,
    'orchestrator',
    convergePrompt({ task, proposals, critiques, builderName: builder.id, primer, skills })
  );
  const plan = conv.json || { plan: conv.text, tasks: [], acceptanceCriteria: [] };
  blackboard.set('plan', plan);
  const acceptance = Array.isArray(plan.acceptanceCriteria) ? plan.acceptanceCriteria : [];
  log.info(`Agreed on ${plan.tasks?.length ?? 0} task(s), ${acceptance.length} acceptance criteria`);

  // ── Phase 4+: Build & verify ─────────────────────────────────────────────
  // M2 (divide & conquer) when enabled and the plan has sub-tasks; otherwise
  // fall through to the M1 single-builder sequential loop below.
  if (config.loop.parallelBuild !== false && (plan.tasks?.length ?? 0) > 0) {
    const parallelResult = await runParallelBuild({
      task, plan, config, blackboard, workspace: cwd, rootDir, dryRun, call, skills,
    });
    return { plan, finalVerdict: parallelResult.finalVerdict, blackboard };
  }

  // ── M1 fallback: sequential build ↔ verify loop ──────────────────────────
  let priorIssues = [];
  let finalVerdict = null;

  for (let attempt = 1; attempt <= config.loop.maxBuildAttempts; attempt++) {
    log.phase(4, `Build (attempt ${attempt}/${config.loop.maxBuildAttempts}) — ${builder.displayName} implements`);
    log.step(builder.displayName, 'writing code…');
    const build = await call(
      builder,
      'builder',
      buildPrompt({ name: builder.id, task, plan: plan.plan ?? plan, workspace: cwd, priorIssues, skills })
    );

    log.phase(5, `Verify — ${verifier.displayName} adversarially checks the work`);
    log.step(verifier.displayName, 'inspecting files & criteria…');
    const verify = await call(
      verifier,
      'verifier',
      verifyPrompt({ name: verifier.id, task, acceptanceCriteria: acceptance, buildReport: build.text, workspace: cwd })
    );

    const verdict = verify.json || { verdict: 'UNKNOWN', requiredFixes: [], issues: [] };
    blackboard.push('attempts', {
      attempt,
      build: build.json, buildText: build.text,
      verify: verdict, verifyText: verify.text,
      verdict,
    });

    finalVerdict = verdict;
    if (String(verdict.verdict).toUpperCase() === 'PASS') {
      log.ok(`Verifier PASSED on attempt ${attempt}`);
      break;
    }

    // Feed the verifier's concrete fixes back into the next build. If its
    // structured output didn't parse, fall back to the raw review text so the
    // builder still gets the rejection reasoning instead of rebuilding blind.
    if (verdict.requiredFixes && verdict.requiredFixes.length) priorIssues = verdict.requiredFixes;
    else if (verdict.issues && verdict.issues.length) priorIssues = verdict.issues;
    else if (verify.text && verify.text.trim()) priorIssues = [`The verifier rejected the build. Full review:\n${verify.text.trim()}`];
    else priorIssues = [];
    log.warn(`Verifier ${verdict.verdict} (severity: ${verdict.severity ?? '?'}) — ${priorIssues.length} fix(es) fed back to builder`);
    if (attempt === config.loop.maxBuildAttempts) {
      log.err('Reached max build attempts without a PASS.');
    }
  }

  blackboard.set('finalVerdict', finalVerdict);
  return { plan, finalVerdict, blackboard };
}

function firstLine(s) {
  return String(s ?? '').split('\n').find((l) => l.trim()) ?? '';
}
