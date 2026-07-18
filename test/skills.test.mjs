// Unit test for the skills library (M4 + dynamic skills). Run: node test/skills.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listSkills, loadSkill, loadSkills, matchSkills, addSkill, removeSkill } from '../src/skills/loader.mjs';

let pass = 0, fail = 0;
const check = (n, c) => { (c ? pass++ : fail++); console.log(`${c ? 'OK  ' : 'FAIL'} | ${n}`); };

const skills = listSkills();
check('registry lists >= 3 skills', skills.length >= 3);
check('pine skill registered', skills.some((s) => s.id === 'pine'));

const pine = loadSkill('pine');
check('loadSkill(pine) has guidance body', !!pine && pine.body.includes('lookahead'));
check('loadSkill(unknown) → null', loadSkill('nope') === null);

const combo = loadSkills(['pine', 'mql5-ea', 'nope']);
check('loadSkills merges both pack bodies', combo.text.includes('lookahead') && combo.text.includes('MagicNumber'));
check('loadSkills reports loaded ids', combo.loaded.includes('pine') && combo.loaded.includes('mql5-ea'));
check('loadSkills reports missing ids', combo.missing.includes('nope'));

// Auto-matching: the client just types a task — relevant skills self-select.
check('auto-match: pine task → pine skill', matchSkills('Build an RSI divergence strategy in Pine Script').some((s) => s.id === 'pine'));
check('auto-match: MT5 task → mql5-ea skill', matchSkills('Port this to an MT5 expert advisor').some((s) => s.id === 'mql5-ea'));
check('auto-match: web task → fullstack skill', matchSkills('Build a todo web app with an API').some((s) => s.id === 'fullstack'));
check('auto-match: unrelated task → no skills', matchSkills('Write a haiku about autumn leaves').length === 0);

// Open-ended library: import any skill from a local file, then remove it.
const tmp = path.join(os.tmpdir(), `skill-${Date.now()}.md`);
fs.writeFileSync(tmp, '# Skill: Solidity audits\nAlways check reentrancy.\n');
const added = await addSkill('solidity-test', tmp, { keywords: ['solidity', 'smart contract'] });
check('addSkill imports a new skill', added.id === 'solidity-test' && added.name.includes('Solidity'));
check('added skill is loadable', loadSkill('solidity-test').body.includes('reentrancy'));
check('added skill auto-matches', matchSkills('audit my solidity contract').some((s) => s.id === 'solidity-test'));
check('removeSkill deletes it', removeSkill('solidity-test') === true && loadSkill('solidity-test') === null);
fs.unlinkSync(tmp);

// Untrusted-source guard.
let refused = false;
try { await addSkill('evil', 'https://evil.example.com/x.md'); } catch { refused = true; }
check('addSkill refuses untrusted host', refused);
check('bad id rejected', await addSkill('Bad Id!', tmp).then(() => false).catch(() => true));

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
