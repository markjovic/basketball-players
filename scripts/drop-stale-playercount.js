// scripts/drop-stale-playercount.js
// REVISION 2026-09-09a — one-off. DELETE THIS SCRIPT AND ITS WORKFLOW AFTER RUNNING.
//
// Removes the `playerCount` field from data/sports-index.json.
//
// WHY A SCRIPT FOR ONE KEY. data/sports-index.json is about 4 MB and GitHub's web
// editor refuses files over 1 MB, so it cannot be edited by hand. This repository is
// operated entirely through the GitHub web UI — there is no console — so a one-line
// change to a large JSON file needs a workflow.
//
// WHY REMOVE IT RATHER THAN FIX IT. Nothing writes it. Every script in the repo and
// every reference in the documentation was searched on 2026-09-09 and no writer
// exists; the only mentions are notes recording that it is stale. It read 369,428
// against 417,971 actual player files — short by roughly 48,500 — and it sits in a
// file that everything else treats as authoritative.
//
// That is the same shape as data/venue-index.json, which was created once by the
// Phase 1 migration on 2026-06-13 and never updated because no writer was ever built,
// while REPO_MANIFEST's writer→reader graph listed a placeholder that was read back
// as fact for three months (T56). A number that looks maintained and is not is worse
// than no number.
//
// The real count is the key count of players/indexes/{00-ff}.json, which db-audit.js
// already reports. Nothing needs this field.
//
// IT TOUCHES ONE KEY AND ASSERTS THAT. Season count, locked count, removed count and
// the grade total are all captured before and compared after; any drift aborts before
// anything is committed.
//
// Run:
//   node scripts/drop-stale-playercount.js --dry-run
//   node scripts/drop-stale-playercount.js

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT       = path.join(__dirname, '..');
const INDEX_FILE = path.join(ROOT, 'data', 'sports-index.json');
const INDEX_REL  = 'data/sports-index.json';
const DRY_RUN    = process.argv.includes('--dry-run');

const GIT_OPTS      = { cwd: ROOT, stdio: 'pipe', timeout: 10 * 60 * 1000, maxBuffer: 512 * 1024 * 1024 };
const PUSH_ATTEMPTS = 60;
const log = (m) => console.log(`[drop-playercount] ${new Date().toISOString()} ${m}`);

// House pattern: per-path add, shortstat, commit before merge, retry with jitter,
// THROW on exhaustion. A lost run must show red.
function gitCommit(message, paths) {
  let staged = 0;
  for (const p of paths) {
    try { execSync(`git add -- ${p}`, GIT_OPTS); staged++; }
    catch (e) { console.error(`  ⚠ git add FAILED "${p}": ${(e.stderr || e.stdout || '').toString().trim() || e.message}`); }
  }
  if (!staged) throw new Error('git add staged NOTHING — refusing to continue');

  const shortstat = execSync('git diff --staged --shortstat', GIT_OPTS).toString().trim();
  if (!shortstat) { console.log('  staging: no changes — nothing to commit'); return; }
  console.log(`  staging: ${shortstat}`);
  execSync(`git commit -m "${message.replace(/"/g, "'")}"`, GIT_OPTS);

  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
    try {
      execSync('git fetch origin main', GIT_OPTS);
      execSync('git merge -X ours FETCH_HEAD --no-edit --no-stat', GIT_OPTS);
      execSync('git push origin main', GIT_OPTS);
      console.log(`  ✔ pushed (attempt ${attempt}): ${message}`);
      return;
    } catch (e) {
      const detail = (e.stderr || e.stdout || '').toString().trim() || e.message;
      if (attempt === PUSH_ATTEMPTS) throw new Error(`push failed after ${PUSH_ATTEMPTS} attempts: ${detail}`);
      const wait = 1 + Math.floor(Math.random() * 90);
      console.log(`  … push contention (attempt ${attempt}) — retry in ${wait}s`);
      execSync(`sleep ${wait}`, { stdio: 'ignore' });
    }
  }
}

function main() {
  log(`drop-stale-playercount${DRY_RUN ? '  (DRY RUN)' : ''}`);
  console.log('─'.repeat(70));

  const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  const before = Object.values(index.seasons || {});
  const snapshot = {
    seasons: before.length,
    locked:  before.filter(s => s.locked === true).length,
    removed: before.filter(s => s.removed === true).length,
    grades:  before.reduce((t, s) => t + (s.grades || []).length, 0),
  };

  console.log(`  top-level keys        : ${Object.keys(index).join(', ')}`);
  console.log(`  seasons               : ${snapshot.seasons}`);
  console.log(`  playerCount currently : ${'playerCount' in index ? index.playerCount : '(already absent)'}`);

  if (!('playerCount' in index)) { log('playerCount is not present — nothing to do.'); return; }

  const was = index.playerCount;
  delete index.playerCount;

  // One key removed, nothing else. Anything else moving is a bug, not a surprise.
  const after = Object.values(index.seasons || {});
  if (after.length !== snapshot.seasons)                                        throw new Error(`ABORT: season count changed ${snapshot.seasons} → ${after.length}. Nothing committed.`);
  if (after.filter(s => s.locked === true).length !== snapshot.locked)           throw new Error('ABORT: locked count changed. Nothing committed.');
  if (after.filter(s => s.removed === true).length !== snapshot.removed)         throw new Error('ABORT: removed count changed. Nothing committed.');
  if (after.reduce((t, s) => t + (s.grades || []).length, 0) !== snapshot.grades) throw new Error('ABORT: grade total changed. Nothing committed.');
  if ('playerCount' in index)                                                    throw new Error('ABORT: playerCount is still present after delete. Nothing committed.');

  console.log(`\n  removed playerCount   : ${was}`);
  console.log(`  remaining top-level   : ${Object.keys(index).join(', ')}`);
  console.log(`  assertions            : PASSED — seasons, locked, removed and grades all unchanged`);
  console.log(`\n  The real player count is the key count of players/indexes/{00-ff}.json,`);
  console.log(`  which db-audit.js already reports. Nothing reads this field.`);

  if (DRY_RUN) { log('dry run — sports-index.json not written.'); return; }
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index));
  gitCommit(`drop-stale-playercount: removed unmaintained playerCount (was ${was})`, [INDEX_REL]);
  log('done — now delete this script and .github/workflows/drop-stale-playercount.yml.');
}

main();
