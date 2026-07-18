import fs from 'node:fs';
import path from 'node:path';
import { runCommand } from './util/spawn.mjs';

/**
 * Thin git layer for M2 "divide & conquer": the workspace becomes a git repo,
 * each parallel task gets its own worktree on its own branch off a common base,
 * and completed branches merge back into the workspace. Isolation by
 * construction — parallel builders can't clobber each other's files.
 */

async function git(cwd, args, timeoutMs = 120000) {
  return runCommand(
    'git',
    ['-c', 'user.email=conclave@local', '-c', 'user.name=Conclave', ...args],
    { cwd, timeoutMs }
  );
}

export async function isGitRepo(dir) {
  const r = await runCommand('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, timeoutMs: 30000 });
  return r.ok && r.stdout.trim() === 'true';
}

/** Make `dir` a git repo with at least one commit (idempotent). */
export async function ensureRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  if (!(await isGitRepo(dir))) {
    await git(dir, ['init', '-q']);
  }
  await ensureExclude(dir);
  const head = await git(dir, ['rev-parse', '--verify', 'HEAD']);
  if (!head.ok) {
    await git(dir, ['add', '-A']);
    const status = await git(dir, ['status', '--porcelain']);
    if (!status.stdout.trim()) {
      fs.writeFileSync(path.join(dir, '.conclave-baseline'), 'conclave baseline\n');
      await git(dir, ['add', '-A']);
    }
    await git(dir, ['commit', '-qm', 'conclave: baseline', '--allow-empty']);
  }
}

/**
 * Write ignore patterns to .git/info/exclude — shared by ALL worktrees, needs
 * no commit. Critical on exFAT/macOS, which litters AppleDouble `._*` sidecar
 * files that `git add -A` would otherwise sweep into every builder's commit.
 */
async function ensureExclude(dir) {
  const r = await git(dir, ['rev-parse', '--git-common-dir']);
  const raw = r.stdout.trim() || '.git';
  const gitDir = path.isAbsolute(raw) ? raw : path.join(dir, raw);
  const infoDir = path.join(gitDir, 'info');
  fs.mkdirSync(infoDir, { recursive: true });
  const p = path.join(infoDir, 'exclude');
  let existing = '';
  try { existing = fs.readFileSync(p, 'utf8'); } catch { /* none yet */ }
  const needed = ['._*', '.DS_Store', '.conclave/'];
  const have = new Set(existing.split('\n').map((s) => s.trim()));
  const missing = needed.filter((n) => !have.has(n));
  if (missing.length) {
    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(p, prefix + missing.join('\n') + '\n');
  }
}

export async function baseRef(dir) {
  const r = await git(dir, ['rev-parse', 'HEAD']);
  return r.stdout.trim();
}

export async function currentBranch(dir) {
  const r = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.stdout.trim();
}

export async function addWorktree(repoDir, wtPath, branch, baseSha) {
  fs.mkdirSync(path.dirname(wtPath), { recursive: true });
  await removeWorktree(repoDir, wtPath); // clear any stale worktree at this path
  await git(repoDir, ['branch', '-D', branch]).catch(() => {});
  return git(repoDir, ['worktree', 'add', '-q', '-b', branch, wtPath, baseSha]);
}

export async function commitAll(wtDir, message) {
  await git(wtDir, ['add', '-A']);
  const status = await git(wtDir, ['status', '--porcelain']);
  if (!status.stdout.trim()) return { ok: true, empty: true };
  const r = await git(wtDir, ['commit', '-qm', message]);
  return { ok: r.ok, empty: false };
}

export async function changedFiles(wtDir, baseSha) {
  const r = await git(wtDir, ['diff', '--name-only', baseSha, 'HEAD']);
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Merge `branch` into the current branch of `repoDir`. Reports conflicts. */
export async function mergeBranch(repoDir, branch) {
  const r = await git(repoDir, ['merge', '--no-edit', branch]);
  if (r.ok) return { ok: true, conflicted: [] };
  const c = await git(repoDir, ['diff', '--name-only', '--diff-filter=U']);
  const conflicted = c.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  return { ok: false, conflicted, raw: r.stderr };
}

export async function abortMerge(repoDir) {
  await git(repoDir, ['merge', '--abort']).catch(() => {});
}

/** After a model resolves conflict markers, stage + commit the merge. */
export async function commitMerge(repoDir, message) {
  await git(repoDir, ['add', '-A']);
  // `git add -A` clears git's "unmerged" index flag even when the file still
  // contains conflict markers, so detect leftover markers by CONTENT instead.
  const markers = await runCommand(
    'git',
    ['grep', '-lE', '^(<<<<<<< |\\|\\|\\|\\|\\|\\|\\| |=======$|>>>>>>> )'],
    { cwd: repoDir, timeoutMs: 60000 }
  );
  if (markers.stdout.trim()) return { ok: false, stillConflicted: true };
  const r = await git(repoDir, ['commit', '-qm', message, '--no-edit']);
  return { ok: r.ok, stillConflicted: false };
}

export async function removeWorktree(repoDir, wtPath) {
  await git(repoDir, ['worktree', 'remove', '--force', wtPath]).catch(() => {});
}

export async function listWorktrees(repoDir) {
  const r = await git(repoDir, ['worktree', 'list', '--porcelain']);
  return r.stdout;
}
