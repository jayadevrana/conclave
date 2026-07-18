import fs from 'node:fs';
import path from 'node:path';

/**
 * Hermes — the memory/learning layer (v0 stub).
 *
 * After every run it distills the structured transcript into one compact
 * "workflow memory" record and appends it to .conclave/hermes/memory.jsonl,
 * plus maintains a rolling profile.json. Future runs will read this back to
 * prime the council with "how this user works" (their stack, conventions,
 * recurring decisions). For now it captures the signal; the recall/injection
 * side is the next milestone.
 */
export function recordToHermes(rootDir, blackboardData) {
  const dir = path.join(rootDir, '.conclave', 'hermes');
  fs.mkdirSync(dir, { recursive: true });

  const record = {
    at: new Date().toISOString(),
    runId: blackboardData.runId,
    task: blackboardData.task,
    roles: {
      orchestrator: blackboardData.orchestrator,
      builder: blackboardData.builder,
      verifier: blackboardData.verifier,
      council: blackboardData.council,
    },
    decisions: safe(() => blackboardData.plan?.decisions) || [],
    acceptanceCriteria: safe(() => blackboardData.plan?.acceptanceCriteria) || [],
    filesTouched: dedupe([
      ...(blackboardData.attempts || []).flatMap((a) => safe(() => a.build?.filesChanged) || []),
      ...(blackboardData.taskResults || []).flatMap((t) => t.changedFiles || []),
    ]),
    subTasks: (blackboardData.taskResults || []).map((t) => ({
      id: t.id, title: t.title, builder: t.builder, verifier: t.verifier, verdict: t.verdict,
    })),
    verdict: blackboardData.finalVerdict?.verdict ?? 'incomplete',
    attempts: (blackboardData.attempts || []).length,
  };

  fs.appendFileSync(path.join(dir, 'memory.jsonl'), JSON.stringify(record) + '\n');
  updateProfile(dir, record);
  return record;
}

function updateProfile(dir, record) {
  const p = path.join(dir, 'profile.json');
  let profile = { runs: 0, verdicts: {}, fileHotspots: {}, updatedAt: null };
  try { profile = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* first run */ }

  profile.runs = (profile.runs || 0) + 1;
  profile.verdicts[record.verdict] = (profile.verdicts[record.verdict] || 0) + 1;
  for (const f of record.filesTouched) {
    profile.fileHotspots[f] = (profile.fileHotspots[f] || 0) + 1;
  }
  profile.updatedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(profile, null, 2));
}

function safe(fn) { try { return fn(); } catch { return undefined; } }
function dedupe(arr) { return [...new Set(arr.filter(Boolean))]; }
