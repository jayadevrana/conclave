import { claude } from './providers/claude.mjs';
import { extractJson } from './util/json.mjs';
import { listSkills } from './skills/loader.mjs';
import { buildPrimer } from './hermes/recall.mjs';

/**
 * The conversational front desk (Claude Code-style). Every user message goes
 * through a fast Claude call (read-only tier) that either ANSWERS directly
 * (questions, chit-chat, "what did you build?") or dispatches a BUILD task to
 * the council. It can read the workspace to answer questions about the code.
 */
export async function routeMessage({ message, history, config, workspace, rootDir }) {
  const skills = listSkills()
    .map((s) => `- ${s.id}: ${s.name} — ${s.description}`)
    .join('\n');
  const convo = history.slice(-12).join('\n');
  const primer = buildPrimer(rootDir);

  const prompt = `You are Conclave — a friendly AI coding assistant that fronts a council of AI models (claude, codex, grok). You chat with the user; when they want something BUILT, the council (multiple AIs that debate, build in parallel, and cross-verify each other) does the heavy work.

FACTS you can use:
- Installed skill packs (auto-load when relevant):
${skills || '(none)'}
- Council roles: council=${config.roles.council.join(',')} orchestrator=${config.roles.orchestrator} builders=${(config.roles.builders || []).join(',')} verifiers=${(config.roles.verifiers || []).join(',')}
- Workspace (you may READ files there to answer questions): ${workspace}
${primer ? `- ${primer.split('\n').join('\n  ')}` : ''}
${convo ? `\nRECENT CONVERSATION:\n${convo}` : ''}

USER MESSAGE:
${message}

Decide ONE action:
- "answer" — the user asked a question, wants info/advice, or is chatting. Reply helpfully and concisely (you may read workspace files first if the question is about the code).
- "build" — the user wants code created, changed, or fixed. Write a clear, self-contained task brief for the council, folding in any relevant conversation context.

End your response with ONLY one fenced json block:
{"action":"answer","reply":"..."}  OR  {"action":"build","task":"..."}`;

  const res = await claude.ask({
    role: 'chat', // read tier — can inspect, cannot edit or run
    prompt,
    cwd: workspace,
    model: config.chatModel || null,
    timeoutMs: 120000,
    dryRun: false,
  });

  const j = extractJson(res.text);
  if (j && j.action === 'build' && j.task) return { action: 'build', task: j.task };
  if (j && j.action === 'answer' && j.reply) return { action: 'answer', reply: j.reply };
  // Routing failed → fall back to showing whatever the model said.
  return { action: 'answer', reply: res.text?.trim() || `(front desk error: ${firstLine(res.stderr)})` };
}

function firstLine(s) {
  return String(s ?? '').split('\n').find((l) => l.trim()) ?? 'unknown';
}
