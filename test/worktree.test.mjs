// Integration test for the git worktree layer (real git, no model calls).
// Run: node test/worktree.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as wt from '../src/worktree.mjs';

const root = '/Volumes/NO NAME/conclave/.wttest';
const ws = path.join(root, 'workspace');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(ws, { recursive: true });

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { (cond ? pass++ : fail++); console.log(`${cond ? 'OK  ' : 'FAIL'} | ${name}${extra ? '  ' + extra : ''}`); };

// 1) clean parallel merge
await wt.ensureRepo(ws);
const base = await wt.baseRef(ws);
check('baseRef non-empty', !!base);

const wtA = path.join(root, 'wt', 'T1');
const wtB = path.join(root, 'wt', 'T2');
await wt.addWorktree(ws, wtA, 'conclave/t1', base);
await wt.addWorktree(ws, wtB, 'conclave/t2', base);
fs.writeFileSync(path.join(wtA, 'routes.js'), 'export const routes = 1;\n');
fs.writeFileSync(path.join(wtB, 'store.js'), 'export const store = 1;\n');
await wt.commitAll(wtA, 't1');
await wt.commitAll(wtB, 't2');
const cfA = await wt.changedFiles(wtA, base);
check('T1 changedFiles = [routes.js]', cfA.length === 1 && cfA[0] === 'routes.js', JSON.stringify(cfA));

check('merge T1 ok', (await wt.mergeBranch(ws, 'conclave/t1')).ok);
check('merge T2 ok', (await wt.mergeBranch(ws, 'conclave/t2')).ok);
check('routes.js merged into workspace', fs.existsSync(path.join(ws, 'routes.js')));
check('store.js merged into workspace', fs.existsSync(path.join(ws, 'store.js')));

// 2) conflict path — two branches edit the SAME file
const base2 = await wt.baseRef(ws);
const wtC = path.join(root, 'wt', 'T3');
const wtD = path.join(root, 'wt', 'T4');
await wt.addWorktree(ws, wtC, 'conclave/t3', base2);
await wt.addWorktree(ws, wtD, 'conclave/t4', base2);
fs.writeFileSync(path.join(wtC, 'shared.js'), 'export const v = "C";\n');
fs.writeFileSync(path.join(wtD, 'shared.js'), 'export const v = "D";\n');
await wt.commitAll(wtC, 't3');
await wt.commitAll(wtD, 't4');
check('merge T3 ok', (await wt.mergeBranch(ws, 'conclave/t3')).ok);
const afterT3 = await wt.baseRef(ws); // HEAD advanced past base2 when T3 merged
const md = await wt.mergeBranch(ws, 'conclave/t4');
check('merge T4 detects conflict', !md.ok && md.conflicted.includes('shared.js'), JSON.stringify(md.conflicted));
const stillBad = await wt.commitMerge(ws, 'try'); // no resolution → must stay conflicted
check('commitMerge blocks commit while markers remain', stillBad.stillConflicted === true);
await wt.abortMerge(ws);
check('abortMerge restores clean tree', (await wt.baseRef(ws)) === afterT3);

// resolver fixes the file, then commit succeeds
await wt.mergeBranch(ws, 'conclave/t4');
fs.writeFileSync(path.join(ws, 'shared.js'), 'export const v = "C+D";\n');
check('commitMerge succeeds after resolution', (await wt.commitMerge(ws, 'resolved')).ok === true);

for (const p of [wtA, wtB, wtC, wtD]) await wt.removeWorktree(ws, p);
fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
