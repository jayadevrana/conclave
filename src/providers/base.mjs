import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/** Write content to a unique temp file and return its path. */
export function tmpFile(prefix, content) {
  const name = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  const p = path.join(os.tmpdir(), name);
  fs.writeFileSync(p, content);
  return p;
}

/**
 * A canned, offline response so the full council loop can run with --dry-run
 * (no model calls, no subscription cost). Each role returns a plausibly-shaped
 * JSON block the loop can parse and move forward on.
 */
export function dryResponse(providerId, role, cmd) {
  const stub = STUBS[role] ? STUBS[role](providerId) : '{}';
  const text =
    `[DRY-RUN] ${providerId} would run:\n${cmd}\n\n` +
    `This is a simulated ${role} response from ${providerId}.\n\n` +
    '```json\n' + stub + '\n```';
  return { ok: true, text, raw: text, stderr: '', cmd, code: 0, timedOut: false, dry: true };
}

const STUBS = {
  proposer: (p) => JSON.stringify({
    summary: `${p}'s proposed approach`,
    steps: ['Understand requirements', 'Design modules', 'Implement', 'Test'],
    risks: ['Edge cases', 'Integration complexity'],
    openQuestions: ['Which framework?'],
    confidence: 0.7,
  }, null, 2),
  critic: (p) => JSON.stringify({
    agreements: ['Overall structure is sound'],
    disagreements: [`${p} thinks the data model should be normalized`],
    mustFix: ['Add input validation'],
    recommendedApproach: 'Blend of both proposals, favoring simplicity',
  }, null, 2),
  orchestrator: () => JSON.stringify({
    plan: 'Agreed synthesized plan combining the strongest ideas.',
    tasks: [
      { id: 'T1', title: 'Scaffold project', detail: 'Create base files and structure' },
      { id: 'T2', title: 'Implement core logic', detail: 'Write the main feature' },
    ],
    acceptanceCriteria: ['Code runs without errors', 'Meets the stated task'],
  }, null, 2),
  builder: (p) => JSON.stringify({
    summary: `${p} implemented the plan (simulated).`,
    filesChanged: ['src/example.mjs'],
    howToRun: 'node src/example.mjs',
    notes: 'Dry-run: no files were actually written.',
  }, null, 2),
  verifier: () => JSON.stringify({
    verdict: 'PASS',
    criteriaResults: [
      { criterion: 'Code runs without errors', pass: true, note: 'Simulated pass' },
      { criterion: 'Meets the stated task', pass: true, note: 'Simulated pass' },
    ],
    issues: [],
    severity: 'low',
    requiredFixes: [],
  }, null, 2),
  integrator: () => JSON.stringify({
    resolved: true,
    filesFixed: ['src/example.mjs'],
    notes: 'Dry-run: no conflicts actually resolved.',
  }, null, 2),
};

/** True only for roles that are allowed to modify files. */
export function isWriteRole(role) {
  return permTier(role) === 'write';
}

/**
 * Permission tier for a role (H1 — verification hardening):
 *   read  — inspect only (no writes, no command execution beyond read-only)
 *   exec  — may RUN code/tests to verify, but must NOT edit files
 *   write — may create/edit files
 * The verifier is 'exec' so it can actually run the built code instead of
 * judging it statically.
 */
export function permTier(role) {
  if (role === 'builder' || role === 'integrator') return 'write';
  if (role === 'verifier' || role === 'tester') return 'exec';
  return 'read'; // proposer, critic, orchestrator
}
