#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { loadConfig, defaultConfigPath } from './config.mjs';
import { runTask } from './run.mjs';
import { routeMessage } from './chat.mjs';

/**
 * conclave-serve — exposes the Conclave council as an OpenAI-compatible API
 * so any polished chat frontend (OpenCode, etc.) can be its face.
 *
 *   GET  /v1/models            → [{ id: "council" }]
 *   POST /v1/chat/completions  → routes the last user message:
 *        question → answered by the front desk (fast claude, read-only)
 *        build    → full council run; progress streamed live as tokens
 *
 * Start it in the folder you want to build in:  conclave-serve
 * Then in OpenCode pick the model  conclave/council  and just chat.
 */

const PORT = Number(process.env.CONCLAVE_PORT || 4747);
const DRY = process.env.CONCLAVE_DRY === '1';
const rootDir = process.cwd();
const config = loadConfig(process.env.CONCLAVE_CONFIG || defaultConfigPath(rootDir));
const workspace = path.resolve(rootDir, config.workspace);

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
      return json(res, {
        object: 'list',
        data: [{ id: 'council', object: 'model', owned_by: 'conclave' }],
      });
    }
    if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
      const body = JSON.parse(await readBody(req));
      return handleChat(body, res);
    }
    json(res, { error: 'not found' }, 404);
  } catch (e) {
    try { json(res, { error: { message: e.message } }, 500); } catch { /* headers sent */ }
  }
});

async function handleChat(body, res) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const userMsg = lastUserText(messages);
  const history = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-12)
    .map((m) => `${m.role === 'user' ? 'User' : 'Conclave'}: ${textOf(m.content).slice(0, 500)}`);

  if (!userMsg) return json(res, completion('Say what you want built — or ask me anything.'));

  const stream = body.stream !== false;
  const send = stream ? sseWriter(res) : null;

  // 1) Front desk: answer questions directly; only real build requests convene the council.
  let route;
  if (DRY) {
    route = { action: 'build', task: userMsg }; // offline wiring test mode
  } else {
    send?.('\u{1F914} thinking…\n\n');
    route = await routeMessage({ message: userMsg, history, config, workspace, rootDir });
  }

  if (route.action === 'answer') {
    if (send) { send(route.reply); return send.done(); }
    return json(res, completion(route.reply));
  }

  // 2) Build: run the council, mirroring engine log lines into the chat stream.
  send?.(`**Convening the council** — task:\n> ${route.task}\n\n\`\`\`\n`);
  const restore = mirrorConsole((line) => send?.(line + '\n'));
  let result;
  try {
    result = await runTask({ task: route.task, config, rootDir, dryRun: DRY });
  } finally {
    restore();
  }

  const summary =
    result.verdict === 'PASS'
      ? `\`\`\`\n\n✅ **Done — verified PASS.** Code is in \`${result.workspace}\`\n\nReport: \`${result.reportPath}\`\nAsk for changes in plain words — the council continues in the same workspace.`
      : result.verdict === 'ERROR'
        ? `\`\`\`\n\n❌ **Run failed:** ${result.error}`
        : `\`\`\`\n\n⚠️ **Finished with verdict ${result.verdict}** — see the report for what the verifier flagged: \`${result.reportPath ?? ''}\``;

  if (send) { send(summary); return send.done(); }
  return json(res, completion(summary));
}

// ── helpers ─────────────────────────────────────────────────────────────────

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const t = textOf(messages[i].content).trim();
      if (t) return t;
    }
  }
  return '';
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  }
  return '';
}

/** Mirror console output (the engine's progress log) to the chat stream, ANSI-stripped. */
function mirrorConsole(emit) {
  const orig = console.log;
  console.log = (...args) => {
    orig(...args);
    const line = args.join(' ').replace(/\x1b\[[0-9;]*m/g, '');
    if (line.trim()) emit(line);
  };
  return () => { console.log = orig; };
}

function sseWriter(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const id = `chatcmpl-${Date.now()}`;
  const send = (content) => {
    res.write(`data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'council',
      choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
    })}\n\n`);
  };
  send.done = () => {
    res.write(`data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'council',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  };
  return send;
}

function completion(text) {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'council',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function json(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (d) => (data += d));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`conclave-serve — council API on http://127.0.0.1:${PORT}/v1`);
  console.log(`  building into: ${workspace}${DRY ? '   [DRY-RUN MODE]' : ''}`);
  console.log('  point OpenCode at provider "conclave", model "council", and chat.');
});
