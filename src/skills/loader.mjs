import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packsDir = path.join(here, 'packs');
const registryPath = path.join(here, 'registry.json');

/** All registered skills (metadata only). */
export function listSkills() {
  try { return JSON.parse(fs.readFileSync(registryPath, 'utf8')).skills || []; }
  catch { return []; }
}

/** One skill with its guidance body, or null if unknown. */
export function loadSkill(id) {
  const entry = listSkills().find((s) => s.id === id);
  if (!entry) return null;
  let body = '';
  try { body = fs.readFileSync(path.join(packsDir, entry.file), 'utf8'); } catch { body = ''; }
  return { ...entry, body };
}

/** Combine several skill packs into one prompt-ready block + the ids that loaded. */
export function loadSkills(ids = []) {
  const packs = ids.map((id) => loadSkill(id)).filter(Boolean);
  if (!packs.length) return { text: '', loaded: [], missing: ids };
  const loaded = new Set(packs.map((p) => p.id));
  const text = ['## Loaded skills — apply these playbooks',
    ...packs.map((p) => `\n${p.body.trim()}`)].join('\n');
  return { text, loaded: [...loaded], missing: ids.filter((id) => !loaded.has(id)) };
}

/**
 * Match registry skills against a free-form task description via each entry's
 * `keywords` (word-boundary match, case-insensitive). This is how skills load
 * AUTOMATICALLY — the client just types their task; no flags needed.
 */
export function matchSkills(task) {
  const text = String(task || '').toLowerCase();
  return listSkills().filter((s) =>
    (s.keywords || []).some((k) => new RegExp(`\\b${escapeRe(k.toLowerCase())}\\b`).test(text))
  );
}

const GITHUB_ALLOWLIST = ['raw.githubusercontent.com', 'github.com', 'gist.githubusercontent.com'];

/**
 * Import ANY skill into the registry — from a local markdown file or a GitHub
 * URL (allowlisted hosts only). The library is open-ended by design: pine/EA/
 * fullstack are just seed examples, not a fixed set.
 */
export async function addSkill(id, source, { name, description, keywords = [] } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(`Invalid skill id '${id}' — use lowercase letters, digits, hyphens.`);
  }
  let body;
  if (/^https?:\/\//i.test(source)) {
    const host = new URL(source).host;
    if (!GITHUB_ALLOWLIST.includes(host)) {
      throw new Error(`Refusing to fetch skill from untrusted host: ${host}`);
    }
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${source}`);
    body = await res.text();
  } else {
    body = fs.readFileSync(source, 'utf8');
  }

  fs.mkdirSync(packsDir, { recursive: true });
  fs.writeFileSync(path.join(packsDir, `${id}.md`), body);

  const entry = {
    id,
    name: name || firstHeading(body) || id,
    description: description || firstHeading(body) || '',
    file: `${id}.md`,
    keywords,
  };
  const skills = listSkills().filter((s) => s.id !== id); // replace on re-add
  skills.push(entry);
  fs.writeFileSync(registryPath, JSON.stringify({ skills }, null, 2) + '\n');
  return entry;
}

/** Remove a skill from the registry (and its pack file). */
export function removeSkill(id) {
  const skills = listSkills();
  const entry = skills.find((s) => s.id === id);
  if (!entry) return false;
  try { fs.unlinkSync(path.join(packsDir, entry.file)); } catch { /* already gone */ }
  fs.writeFileSync(registryPath, JSON.stringify({ skills: skills.filter((s) => s.id !== id) }, null, 2) + '\n');
  return true;
}

function firstHeading(md) {
  const m = String(md || '').match(/^#\s*(?:Skill:\s*)?(.+)$/m);
  return m ? m[1].trim() : '';
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
