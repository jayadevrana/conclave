import path from 'node:path';
import { resolveProvider } from './config.mjs';
import * as log from './util/log.mjs';
import * as wt from './worktree.mjs';
import { taskBuildPrompt, taskVerifyPrompt, mergeResolvePrompt } from './prompts.mjs';

/**
 * M2 — divide & conquer.
 * After the council converges on a plan, split it into sub-tasks and:
 *   • assign each to a builder (round-robin across the builder pool)
 *   • build every sub-task IN PARALLEL, each in its own git worktree/branch
 *   • cross-verify each (a DIFFERENT model than the one that built it), with retries
 *   • merge the passed branches back into the workspace (a model resolves conflicts)
 *   • run one final integration verify on the merged result
 */
export async function runParallelBuild({ task, plan, config, blackboard, workspace, rootDir, dryRun, call, skills }) {
  const tasks = normalizeTasks(plan.tasks);
  const acceptance = Array.isArray(plan.acceptanceCriteria) ? plan.acceptanceCriteria : [];

  const builders = poolFor(config, 'builders', 'builder');
  const verifiers = poolFor(config, 'verifiers', 'verifier');
  const integrator = resolveProvider(config, config.roles.orchestrator);

  // Assign a builder and a distinct cross-verifier to each sub-task.
  tasks.forEach((t, i) => {
    t.builder = builders[i % builders.length];
    t.verifier = pickVerifier(verifiers, builders, t.builder, i);
    t.branch = `conclave/${String(t.id).toLowerCase()}`;
    t.wtPath = path.join(rootDir, '.conclave', 'wt', blackboard.data.runId, String(t.id));
  });

  log.info(`Split into ${tasks.length} sub-task(s): ${tasks.map((t) => `${t.id}→${t.builder.id}/verify:${t.verifier.id}`).join('  ')}`);

  // Prepare the workspace as a git repo so worktrees have a common base.
  let base = null;
  if (!dryRun) {
    await wt.ensureRepo(workspace);
    base = await wt.baseRef(workspace);
  }

  // ── Parallel build + cross-verify (each sub-task is fully independent) ────
  log.phase(4, `Build — ${tasks.length} sub-task(s) in parallel worktrees`);
  const taskResults = await Promise.all(
    tasks.map((t) => buildAndVerifyTask({ t, task, plan, acceptance, config, blackboard, workspace, base, dryRun, call, skills }))
  );
  taskResults.forEach((r) => blackboard.push('taskResults', summarizeTask(r)));

  // ── Merge passed branches back into the workspace ────────────────────────
  log.phase(5, 'Integrate — merge passed sub-tasks into the workspace');
  const mergeReport = [];
  if (!dryRun) {
    for (const r of taskResults) {
      if (!isPass(r.verdict)) {
        log.warn(`Skip merge of ${r.t.id} (verdict ${r.verdict?.verdict ?? '?'})`);
        mergeReport.push({ id: r.t.id, merged: false, reason: 'sub-task did not pass' });
        continue;
      }
      const m = await wt.mergeBranch(workspace, r.t.branch);
      if (m.ok) {
        log.ok(`Merged ${r.t.id} (${r.t.branch})`);
        mergeReport.push({ id: r.t.id, merged: true });
        continue;
      }
      // Conflict → have the integrator resolve it, then commit.
      log.warn(`Merge conflict on ${r.t.id}: ${m.conflicted.join(', ')} — ${integrator.id} resolving…`);
      await call(integrator, 'integrator',
        mergeResolvePrompt({ name: integrator.id, task, branch: r.t.branch, conflictedFiles: m.conflicted, repoDir: workspace }),
        workspace);
      const committed = await wt.commitMerge(workspace, `conclave: resolve merge of ${r.t.branch}`);
      if (committed.ok) {
        log.ok(`Resolved & merged ${r.t.id}`);
        mergeReport.push({ id: r.t.id, merged: true, conflictResolved: true });
      } else {
        await wt.abortMerge(workspace);
        log.err(`Could not resolve ${r.t.id} — merge aborted`);
        mergeReport.push({ id: r.t.id, merged: false, reason: 'unresolved conflict' });
      }
    }
  } else {
    tasks.forEach((t) => mergeReport.push({ id: t.id, merged: isPass(taskResults.find((r) => r.t.id === t.id).verdict), dry: true }));
    log.info('(dry-run: merges simulated)');
  }
  blackboard.set('mergeReport', mergeReport);

  // ── Final integration verify on the merged whole ─────────────────────────
  log.phase(6, `Integration verify — ${verifiers[0].displayName} checks the merged result`);
  const finalVerify = await call(verifiers[0], 'verifier',
    integrationVerifyPrompt({ name: verifiers[0].id, task, acceptance, workspace }),
    workspace);
  const finalVerdict = finalVerify.json || { verdict: 'UNKNOWN', issues: [] };

  // Overall pass requires: every sub-task passed, every merge landed, final verify PASS.
  const allTasksPassed = taskResults.every((r) => isPass(r.verdict));
  const allMerged = mergeReport.every((m) => m.merged);
  const overall = allTasksPassed && allMerged && isPass(finalVerdict) ? 'PASS' : 'PARTIAL';
  const result = { ...finalVerdict, verdict: overall === 'PASS' ? 'PASS' : finalVerdict.verdict, overall };
  blackboard.set('finalVerdict', result);

  // Clean up worktree checkouts (branches are kept for inspection).
  if (!dryRun) {
    for (const t of tasks) await wt.removeWorktree(workspace, t.wtPath);
  }

  (overall === 'PASS' ? log.ok : log.warn)(
    `Sub-tasks: ${taskResults.filter((r) => isPass(r.verdict)).length}/${taskResults.length} passed · merged: ${mergeReport.filter((m) => m.merged).length}/${mergeReport.length} · integration: ${finalVerdict.verdict}`
  );
  return { finalVerdict: result, taskResults, mergeReport };
}

async function buildAndVerifyTask({ t, task, plan, acceptance, config, blackboard, workspace, base, dryRun, call, skills }) {
  const workDir = dryRun ? workspace : t.wtPath;
  if (!dryRun) await wt.addWorktree(workspace, t.wtPath, t.branch, base);

  let priorIssues = [];
  let build = null;
  let verify = null;
  let verdict = { verdict: 'UNKNOWN' };

  for (let attempt = 1; attempt <= config.loop.maxTaskAttempts; attempt++) {
    log.step(`${t.builder.displayName}`, `building ${t.id} (${t.title}) [attempt ${attempt}]`);
    build = await call(t.builder, 'builder',
      taskBuildPrompt({ name: t.builder.id, task, taskItem: t, plan: plan.plan ?? plan, workspace: workDir, priorIssues, skills }),
      workDir);
    if (!dryRun) await wt.commitAll(t.wtPath, `conclave ${t.id}: attempt ${attempt}`);

    log.step(`${t.verifier.displayName}`, `cross-verifying ${t.id}`);
    verify = await call(t.verifier, 'verifier',
      taskVerifyPrompt({ name: t.verifier.id, task, taskItem: t, acceptanceCriteria: acceptance, buildReport: build.text, workspace: workDir }),
      workDir);
    verdict = verify.json || { verdict: 'UNKNOWN', requiredFixes: [], issues: [] };

    if (isPass(verdict)) { log.ok(`${t.id} PASSED (built by ${t.builder.id}, verified by ${t.verifier.id})`); break; }

    priorIssues = (verdict.requiredFixes && verdict.requiredFixes.length ? verdict.requiredFixes
      : verdict.issues && verdict.issues.length ? verdict.issues
      : verify.text ? [`Verifier rejected it. Full review:\n${verify.text.trim()}`] : []);
    log.warn(`${t.id} ${verdict.verdict} (attempt ${attempt}) — ${priorIssues.length} fix(es) fed back`);
  }

  const changed = dryRun ? (build.json?.filesChanged || []) : await wt.changedFiles(t.wtPath, base);
  return { t, build, buildText: build.text, verify, verifyText: verify.text, verdict, changedFiles: changed };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function integrationVerifyPrompt({ name, task, acceptance, workspace }) {
  return `You are ${name}, the final INTEGRATION VERIFIER on a multi-AI council. Several sub-tasks were built in parallel and merged together into one workspace. Inspect the ACTUAL merged files and — you have EXECUTE access — actually RUN the merged project and any tests end-to-end to confirm the parts fit together (you cannot edit files). Judge whether the WHOLE task is correctly and coherently done (nothing half-merged or contradictory). Be adversarial.

OVERALL TASK:
${task}

ACCEPTANCE CRITERIA:
${(acceptance || []).map((a, i) => `${i + 1}. ${a}`).join('\n')}

Merged working directory to inspect: ${workspace}

IMPORTANT: End your response with a single fenced \`\`\`json code block, no prose after it.
Schema:
{
  "verdict": "PASS" or "FAIL",
  "issues": ["integration problems: parts that don't fit, missing glue, conflicts left behind"],
  "severity": "low | med | high"
}`;
}

function normalizeTasks(tasks) {
  const arr = Array.isArray(tasks) && tasks.length ? tasks : [{ id: 'T1', title: 'Implement the plan', detail: '' }];
  return arr.map((t, i) => ({
    id: t.id || `T${i + 1}`,
    title: t.title || t.detail || `Task ${i + 1}`,
    detail: t.detail || '',
  }));
}

function poolFor(config, pluralKey, singularKey) {
  const ids = config.roles[pluralKey]?.length ? config.roles[pluralKey] : [config.roles[singularKey]];
  return ids.map((id) => resolveProvider(config, id));
}

function pickVerifier(pool, builders, taskBuilder, i) {
  const notBuilder = pool.filter((p) => p.id !== taskBuilder.id);
  if (notBuilder.length) return notBuilder[i % notBuilder.length];
  const otherBuilders = builders.filter((b) => b.id !== taskBuilder.id);
  if (otherBuilders.length) return otherBuilders[i % otherBuilders.length];
  return pool[0] || taskBuilder;
}

function isPass(v) {
  return v && String(v.verdict).toUpperCase() === 'PASS';
}

function summarizeTask(r) {
  return {
    id: r.t.id,
    title: r.t.title,
    builder: r.t.builder.id,
    verifier: r.t.verifier.id,
    verdict: r.verdict?.verdict ?? 'UNKNOWN',
    changedFiles: r.changedFiles,
    buildText: r.buildText,
    verifyText: r.verifyText,
  };
}
