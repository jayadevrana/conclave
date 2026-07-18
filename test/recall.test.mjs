// Unit test for Hermes recall (M3). Run: node test/recall.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { buildPrimer } from '../src/hermes/recall.mjs';

const root = '/Volumes/NO NAME/conclave/.recalltest';
const hdir = path.join(root, '.conclave', 'hermes');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(hdir, { recursive: true });

let pass = 0, fail = 0;
const check = (n, c) => { (c ? pass++ : fail++); console.log(`${c ? 'OK  ' : 'FAIL'} | ${n}`); };

// No memory → empty primer.
check('no memory → empty primer', buildPrimer(path.join(root, 'nope')) === '');

fs.writeFileSync(path.join(hdir, 'profile.json'), JSON.stringify({
  runs: 3, verdicts: { PASS: 2, FAIL: 1 },
  fileHotspots: { 'src/strategy.pine': 4, 'src/ea.mq5': 2 },
}));
fs.writeFileSync(path.join(hdir, 'memory.jsonl'),
  JSON.stringify({ task: 'Build a Pine breakout indicator', verdict: 'PASS', filesTouched: ['src/strategy.pine'], decisions: ['use request.security lookahead_off'] }) + '\n' +
  JSON.stringify({ task: 'Write an MQL5 EA', verdict: 'FAIL', filesTouched: ['src/ea.mq5'], decisions: [] }) + '\n');

const primer = buildPrimer(root);
check('primer non-empty with memory', primer.length > 0);
check('primer names hotspot file', primer.includes('src/strategy.pine'));
check('primer shows verdict counts', primer.includes('PASS:2'));
check('primer names a recent task', primer.includes('Pine breakout'));
check('primer surfaces a decision', primer.includes('lookahead_off'));

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
