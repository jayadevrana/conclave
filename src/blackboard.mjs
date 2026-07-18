import fs from 'node:fs';
import path from 'node:path';

/**
 * The shared "blackboard": a single structured record of everything that
 * happened in a run. Persisted continuously to transcript.json (so a crash
 * still leaves a full trail) and rendered to a human-readable report.md at
 * the end. This structured record is also what Hermes consumes to learn.
 */
export class Blackboard {
  constructor(runDir, meta) {
    this.runDir = runDir;
    this.data = {
      ...meta,
      startedAt: new Date().toISOString(),
      proposals: [],
      critiques: [],
      plan: null,
      attempts: [],
      finalVerdict: null,
      events: [],
    };
    fs.mkdirSync(runDir, { recursive: true });
    this.flush();
  }

  event(type, payload = {}) {
    this.data.events.push({ at: new Date().toISOString(), type, ...payload });
    this.flush();
  }

  set(key, value) {
    this.data[key] = value;
    this.flush();
  }

  push(key, value) {
    (this.data[key] ||= []).push(value);
    this.flush();
  }

  flush() {
    fs.writeFileSync(path.join(this.runDir, 'transcript.json'), JSON.stringify(this.data, null, 2));
  }

  writeReport() {
    const d = this.data;
    const lines = [];
    lines.push(`# Conclave run — ${d.runId}`, '');
    lines.push(`**Task:** ${d.task}`, '');
    lines.push(`**Council:** ${d.council?.join(', ')}  `);
    lines.push(`**Orchestrator:** ${d.orchestrator} · **Builder:** ${d.builder} · **Verifier:** ${d.verifier}  `);
    lines.push(`**Result:** ${d.finalVerdict?.verdict ?? 'incomplete'}`, '');

    lines.push('## Proposals');
    for (const p of d.proposals) lines.push(`### ${p.name}`, '', codeblock(p.text), '');

    lines.push('## Critiques');
    for (const c of d.critiques) lines.push(`### ${c.name}`, '', codeblock(c.text), '');

    if (d.plan) {
      lines.push('## Agreed plan', '', codeblock(typeof d.plan === 'string' ? d.plan : JSON.stringify(d.plan, null, 2)), '');
    }

    if (d.taskResults && d.taskResults.length) {
      lines.push('## Sub-tasks (parallel build & cross-verify)', '');
      d.taskResults.forEach((t) => {
        lines.push(
          `### ${t.id} — ${t.title}`, '',
          `**Builder:** ${t.builder} · **Cross-verifier:** ${t.verifier} · **Verdict:** ${t.verdict}  `,
          `**Files:** ${(t.changedFiles || []).join(', ') || '(none)'}`, '',
          '**Builder report:**', '', codeblock(t.buildText || ''), '',
          '**Cross-verify:**', '', codeblock(t.verifyText || ''), ''
        );
      });
      if (d.mergeReport) lines.push('### Merge', '', codeblock(JSON.stringify(d.mergeReport, null, 2)), '');
    }

    if (d.attempts && d.attempts.length) {
      lines.push('## Build & verify attempts');
      d.attempts.forEach((a, i) => {
        lines.push(`### Attempt ${i + 1}`, '');
        lines.push('**Builder:**', '', codeblock(a.buildText || ''), '');
        lines.push(`**Verifier verdict:** ${a.verdict?.verdict ?? 'n/a'}`, '', codeblock(a.verifyText || ''), '');
      });
    }

    const p = path.join(this.runDir, 'report.md');
    fs.writeFileSync(p, lines.join('\n'));
    return p;
  }
}

function codeblock(s) {
  return '```\n' + String(s ?? '').trim() + '\n```';
}
