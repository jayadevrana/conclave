/**
 * Prompt templates for every phase of the council. Each returns a single
 * self-contained string (these CLIs take one prompt), with the role's system
 * instructions inlined so the templates are provider-agnostic.
 */

const JSON_RULE =
  'IMPORTANT: End your response with a single fenced ```json code block containing ' +
  'ONLY the structured object described. No prose after it.';

export function proposePrompt({ name, task, workspace, primer }) {
  return `You are ${name}, an elite software engineer on a multi-AI council convened to solve ONE task together.
${primer ? `\n${primer}\n` : ''}
TASK:
${task}

Working directory: ${workspace}

Produce YOUR OWN independent, concrete technical approach. Think about architecture, the key files, the tricky parts, and how you would verify success. Do not defer to other models — this is your genuine best plan.

${JSON_RULE}
Schema:
{
  "summary": "one-paragraph description of your approach",
  "steps": ["ordered, concrete implementation steps"],
  "risks": ["real risks or failure modes"],
  "openQuestions": ["anything genuinely ambiguous about the task"],
  "confidence": 0.0
}`;
}

export function critiquePrompt({ name, task, proposals }) {
  const bundle = proposals
    .map((p) => `### Proposal from ${p.name}\n${p.text}`)
    .join('\n\n');

  return `You are ${name} on a multi-AI engineering council. Below are ALL members' independent proposals for this task.

TASK:
${task}

PROPOSALS:
${bundle}

Critique them RIGOROUSLY and honestly. Your job is to catch what is wrong, risky, over-engineered, or missing — including flaws in your own proposal. Do NOT be agreeable for its own sake; a useless "looks good" helps no one. Then state which approach (or blend) should win and why.

${JSON_RULE}
Schema:
{
  "agreements": ["points the council clearly agrees on"],
  "disagreements": ["specific technical disagreements, with your reasoning"],
  "mustFix": ["concrete things any final plan MUST address"],
  "recommendedApproach": "which proposal or blend should be adopted, and why"
}`;
}

export function convergePrompt({ task, proposals, critiques, builderName, acceptanceHint, primer, skills }) {
  const props = proposals.map((p) => `### ${p.name} proposed\n${p.text}`).join('\n\n');
  const crits = critiques.map((c) => `### ${c.name} critiqued\n${c.text}`).join('\n\n');

  return `You are the ORCHESTRATOR of a multi-AI engineering council. You have every member's proposal and critique. Your job is to resolve disagreements and produce ONE agreed, buildable plan for the builder (${builderName}) to implement.
${primer ? `\n${primer}\n` : ''}${skills ? `\n${skills}\n` : ''}
TASK:
${task}

PROPOSALS:
${props}

CRITIQUES:
${crits}

Synthesize the strongest single plan. Where members disagreed, DECIDE with a one-line rationale. Break the work into concrete BUILD tasks, then write crisp, testable acceptance criteria the verifier can objectively check.

Rules for tasks (they are built IN PARALLEL by different models, each in an isolated git worktree, then merged and verified automatically):
- Every task MUST produce concrete file changes (create/edit specific named files).
- Do NOT create tasks whose purpose is to run, test, verify, integrate, review, or "tie it all together" — the council does verification and integration itself. Never emit a "Run and verify" style task.
- Make tasks as independent as possible — ideally each owns DIFFERENT files — to avoid merge conflicts.
- Prefer few, self-contained tasks (1–4). If the whole job is tiny, ONE task is correct.${acceptanceHint ? `\n\nExtra guidance: ${acceptanceHint}` : ''}

${JSON_RULE}
Schema:
{
  "plan": "the agreed approach, incorporating the best ideas and resolving disagreements",
  "decisions": ["how each major disagreement was resolved, and why"],
  "tasks": [{ "id": "T1", "title": "...", "detail": "what to build, concretely" }],
  "acceptanceCriteria": ["objective, checkable pass/fail conditions"]
}`;
}

export function buildPrompt({ name, task, plan, workspace, priorIssues, skills }) {
  const fixes = priorIssues && priorIssues.length
    ? `\n\nThis is a RE-ATTEMPT. The verifier rejected the previous build. You MUST fix:\n${priorIssues.map((i) => `- ${i}`).join('\n')}`
    : '';

  return `You are ${name}, the BUILDER on a multi-AI council. Implement the agreed plan by writing REAL, WORKING code and files into the working directory. You have write access to this workspace.
${skills ? `\n${skills}\n` : ''}
TASK:
${task}

AGREED PLAN:
${typeof plan === 'string' ? plan : JSON.stringify(plan, null, 2)}

Working directory (write here): ${workspace}
${fixes}

Actually create/edit the files. Make it run. Do not stop at describing — implement it. When finished, report what you changed.

${JSON_RULE}
Schema:
{
  "summary": "what you built and how it satisfies the plan",
  "filesChanged": ["relative paths you created or modified"],
  "howToRun": "exact command(s) to run or test it",
  "notes": "anything the verifier should know"
}`;
}

export function verifyPrompt({ name, task, acceptanceCriteria, buildReport, workspace }) {
  return `You are ${name}, the VERIFIER on a multi-AI council. The builder claims to have implemented the plan. Independently inspect the ACTUAL files AND — you have EXECUTE access — actually RUN the code and any tests (e.g. \`node <file>\`, the stated run/test command) to confirm real behavior. You CANNOT edit files. Judge whether each acceptance criterion is truly met. Be adversarial — actively try to find where it breaks. Do not take the builder's word for it.

TASK:
${task}

ACCEPTANCE CRITERIA:
${(acceptanceCriteria || []).map((a, i) => `${i + 1}. ${a}`).join('\n')}

BUILDER'S REPORT:
${typeof buildReport === 'string' ? buildReport : JSON.stringify(buildReport, null, 2)}

Working directory to inspect: ${workspace}

${JSON_RULE}
Schema:
{
  "verdict": "PASS" or "FAIL",
  "criteriaResults": [{ "criterion": "...", "pass": true, "note": "evidence you actually checked" }],
  "issues": ["concrete problems found"],
  "severity": "low | med | high",
  "requiredFixes": ["specific, actionable fixes the builder must make (empty if PASS)"]
}`;
}

// ── M2: divide & conquer ────────────────────────────────────────────────────

export function taskBuildPrompt({ name, task, taskItem, plan, workspace, priorIssues, skills }) {
  const fixes = priorIssues && priorIssues.length
    ? `\n\nThis is a RE-ATTEMPT. The cross-verifier rejected your previous work. You MUST fix:\n${priorIssues.map((i) => `- ${i}`).join('\n')}`
    : '';

  return `You are ${name}, a BUILDER on a multi-AI council. The overall job was split into independent sub-tasks and handed to different builders working IN PARALLEL, each in an isolated git worktree. Implement ONLY your assigned sub-task.
${skills ? `\n${skills}\n` : ''}
OVERALL TASK (context):
${task}

AGREED PLAN (context):
${typeof plan === 'string' ? plan : JSON.stringify(plan, null, 2)}

YOUR SUB-TASK — ${taskItem.id}: ${taskItem.title}
${taskItem.detail || ''}

Your isolated working directory (write here): ${workspace}
${fixes}

RULES:
- Implement your sub-task fully with real, working code.
- Stay in your lane: create/edit only the files your sub-task needs. Do NOT rewrite files that clearly belong to another sub-task — that causes merge conflicts.
- Make it runnable.

${'IMPORTANT: End your response with a single fenced ```json code block, no prose after it.'}
Schema:
{
  "summary": "what you built for this sub-task",
  "filesChanged": ["relative paths you created or modified"],
  "howToRun": "how to run/test just this part",
  "notes": "anything the verifier or integrator should know"
}`;
}

export function taskVerifyPrompt({ name, task, taskItem, acceptanceCriteria, buildReport, workspace }) {
  return `You are ${name}, a cross-VERIFIER on a multi-AI council. A DIFFERENT model built the sub-task below. Independently inspect the ACTUAL files and — you have EXECUTE access — RUN the code/tests to confirm it works (you cannot edit files). Judge whether this sub-task is correctly done. Be adversarial — try to find where it breaks. Do not trust the builder's report.

OVERALL TASK (context):
${task}

SUB-TASK UNDER REVIEW — ${taskItem.id}: ${taskItem.title}
${taskItem.detail || ''}

RELEVANT ACCEPTANCE CRITERIA:
${(acceptanceCriteria || []).map((a, i) => `${i + 1}. ${a}`).join('\n')}

BUILDER'S REPORT:
${typeof buildReport === 'string' ? buildReport : JSON.stringify(buildReport, null, 2)}

Working directory to inspect: ${workspace}

${'IMPORTANT: End your response with a single fenced ```json code block, no prose after it.'}
Schema:
{
  "verdict": "PASS" or "FAIL",
  "issues": ["concrete problems found"],
  "severity": "low | med | high",
  "requiredFixes": ["specific fixes the builder must make (empty if PASS)"]
}`;
}

export function mergeResolvePrompt({ name, task, branch, conflictedFiles, repoDir }) {
  return `You are ${name}, the INTEGRATOR on a multi-AI council. Merging a completed sub-task branch (${branch}) into the main workspace produced GIT CONFLICT MARKERS in the files below. Resolve every conflict by editing the files so the combined result is correct and coherent — keep the intent of BOTH sides where possible.

OVERALL TASK (context):
${task}

Repository / working directory: ${repoDir}

CONFLICTED FILES (contain <<<<<<< ======= >>>>>>> markers):
${(conflictedFiles || []).map((f) => `- ${f}`).join('\n')}

Edit each file to remove ALL conflict markers and leave a correct merged version. Do not leave any <<<<<<<, =======, or >>>>>>> behind. Do not commit — just fix the files.

${'IMPORTANT: End your response with a single fenced ```json code block, no prose after it.'}
Schema:
{
  "resolved": true,
  "filesFixed": ["paths you edited"],
  "notes": "how you resolved the conflicts"
}`;
}
