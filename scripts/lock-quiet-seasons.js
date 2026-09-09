// scripts/lock-quiet-seasons.js
// REVISION 2026-09-08a — first version. Check this line against the delivery note.
//
// The season lifecycle rule. Locks finished seasons that have provably stopped
// changing, so the nightly stops re-fetching answers that cannot move.
//
// WHY: NOTHING HAS EVER LOCKED A SEASON
// ─────────────────────────────────────
// nightly-crawl.js selects seasons at locked:false and builds its work list from
// their grades. It reads data/sports-index.json and NEVER writes it — there is no
// writeFileSync for INDEX_FILE anywhere in that file. So no season has ever been
// locked by any tool. claude_context claimed the nightly locked a COMPLETED season
// on sight; that was wrong and is now corrected.
//
// Measured 2026-09-08, after the date backfill made the scale visible:
//   419 COMPLETED seasons still unlocked, holding 5,873 grades
//   = 59% of the 9,950 grades the nightly fetches every single night
//   334 of them ended MORE THAN THREE MONTHS AGO — 5,021 grades
//   41 ended more than three years ago; one in December 2019
//
// WHY NOT A TIMER ALONE
// ─────────────────────
// Age does not predict completeness. a9fcd2a0 ended 2020-09-20 and 387 of its 387
// games are still unresolved. A rule that locked on date alone would have sealed it
// years ago with everything missing. So age is a NECESSARY condition, never a
// sufficient one: the season must also have provably stopped changing.
//
// THE FINGERPRINT
// ───────────────
// A sha1 over every game's id, status and both scores, sorted. It moves if a game
// is added, removed, finalised, scored or rescored. It does not move for a season
// that is genuinely finished. Each run compares the current fingerprint to the one
// recorded in data/season-activity.json:
//   different → record the new one, reset the streak to 1, never lock
//   identical → streak + 1
// A season locks only once its streak reaches --quiet-checks (default 3). With the
// daily cron that is three consecutive days of stillness on top of the age gate.
//
// FOUR CONDITIONS, ALL REQUIRED
// ─────────────────────────────
//   1. status === 'COMPLETED'        PlayHQ says the season is over
//   2. locked === false              not already locked
//   3. endDate older than --min-age-months (default 3)
//   4. games on disk AND the fingerprint unchanged for --quiet-checks runs
//
// AND ONE FLOOR THAT IS NOT NEGOTIABLE: a season with ZERO games is never locked
// here. Locking one would bury it permanently, which is the same failure as writing
// removed:true off a CloudFront block. Establishing that an empty season is truly
// empty requires ASKING PlayHQ, and that is close-empty-seasons.js's job — it did
// exactly that for 26 seasons on 2026-09-08 and refused the rest.
//
// A season with no endDate or no status is skipped and counted. After the
// 2026-09-08 backfill that is 2 seasons out of 777 unlocked, but it must never be
// guessed at from the season name.
//
// WHAT IT WRITES
//   data/season-activity.json  the fingerprint + streak state (always, even dry)
//   data/sports-index.json     locked:true, lockedAt, lockedReason (apply only)
//
// NOT removed:true — that means a grades:[] stub that must never be re-examined.
// These hold real grades and real games. lockedAt/lockedReason are the selector if
// this ever has to be reversed, exactly as discoveredBy:'org' made the repair of 80
// damaged seasons possible on 2026-09-08.
//
// Run:
//   node scripts/lock-quiet-seasons.js --list-paths            (phase 1)
//   node scripts/lock-quiet-seasons.js --dry-run               (report, write nothing)
//   node scripts/lock-quiet-seasons.js --record-only           (update streaks, lock nothing)
//   node scripts/lock-quiet-seasons.js                         (record and lock)
//   node scripts/lock-quiet-seasons.js --min-age-months=6 --quiet-checks=5

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT            = path.join(__dirname, '..');
const INDEX_FILE      = path.join(ROOT, 'data', 'sports-index.json');
const INDEX_REL       = 'data/sports-index.json';
const ACTIVITY_FILE   = path.join(ROOT, 'data', 'season-activity.json');
const ACTIVITY_REL    = 'data/season-activity.json';
const GAMES_DIR       = path.join(ROOT, 'games', 'bv');

const args   = process.argv.slice(2);
const argVal = (n, d) => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const DRY_RUN     = args.includes('--dry-run');
const RECORD_ONLY = args.includes('--record-only');
const LIST_PATHS  = args.includes('--list-paths');
const MIN_AGE_MONTHS = Math.max(0, parseInt(argVal('min-age-months', '3'), 10) || 0);
const QUIET_CHECKS   = Math.max(1, parseInt(argVal('quiet-checks', '3'), 10) || 3);
const MAX_LOCK       = Math.max(0, parseInt(argVal('max-lock', '0'), 10) || 0);   // 0 = no cap

const GIT_OPTS      = { cwd: ROOT, stdio: 'pipe', timeout: 10 * 60 * 1000, maxBuffer: 512 * 1024 * 1024 };
const PUSH_ATTEMPTS = 60;

const log = (m) => console.log(`[lock-quiet] ${new Date().toISOString()} ${m}`);

// ─── git: the house pattern. Per-path adds, shortstat, retry, THROWS. ────────
function gitCommit(message, paths) {
  let staged = 0;
  for (const p of paths) {
    try { execSync(`git add -- ${p}`, GIT_OPTS); staged++; }
    catch (e) {
      const detail = (e.stderr || e.stdout || '').toString().trim() || e.message;
      console.error(`  ⚠ git add FAILED "${p}": ${detail}`);
    }
  }
  if (!staged) throw new Error('git add staged NOTHING for every path — refusing to continue');

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

// Candidates: COMPLETED and unlocked. The age and quiet gates are applied later so
// that every candidate's fingerprint is recorded, including ones too young to lock —
// a streak has to start somewhere.
function candidates(index) {
  return Object.values(index.seasons || {}).filter(s => s.status === 'COMPLETED' && s.locked === false);
}

if (LIST_PATHS) {
  const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  const paths = candidates(index).map(s => `games/bv/${s.id}.json`);
  const out = process.env.GITHUB_OUTPUT;
  console.error(`[lock-quiet] ${paths.length} COMPLETED+unlocked season(s)`);
  if (out) {
    fs.appendFileSync(out, `game_files<<SPARSEEOF\n${paths.length ? paths.join('\n') + '\n' : ''}SPARSEEOF\n`);
    fs.appendFileSync(out, `season_count=${paths.length}\n`);
  }
  console.log(paths.join('\n'));
  process.exit(0);
}

// Moves if a game is added, removed, finalised, scored or rescored. Sorted, so map
// iteration order can never change it.
function fingerprint(games) {
  const parts = games
    .map(g => `${g.id || ''}:${g.st || ''}:${g.hs == null ? '' : g.hs}:${g.as == null ? '' : g.as}`)
    .sort();
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

function monthsSince(dateStr) {
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60 * 24 * 30.44);
}

function main() {
  log(`lock-quiet-seasons${DRY_RUN ? '  (DRY RUN)' : ''}${RECORD_ONLY ? '  (RECORD ONLY)' : ''}  min-age-months=${MIN_AGE_MONTHS}  quiet-checks=${QUIET_CHECKS}`);
  console.log('─'.repeat(92));

  const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  let activity = {};
  if (fs.existsSync(ACTIVITY_FILE)) {
    try { activity = JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8')) || {}; } catch { activity = {}; }
  }
  const firstRun = !Object.keys(activity).length;

  const all = Object.values(index.seasons);
  const lockedBefore  = all.filter(s => s.locked === true).length;
  const removedBefore = all.filter(s => s.removed === true).length;
  const gradesBefore  = all.reduce((t, s) => t + (s.grades || []).length, 0);
  const countBefore   = all.length;
  const unlocked      = all.filter(s => s.locked === false);
  const nightlyGrades = unlocked.reduce((t, s) => t + (s.grades || []).length, 0);

  const cands = candidates(index);
  console.log(`  seasons in index              : ${countBefore}`);
  console.log(`  unlocked (crawled nightly)    : ${unlocked.length}  holding ${nightlyGrades} grades`);
  console.log(`  COMPLETED + unlocked          : ${cands.length}`);
  console.log(`  activity file                 : ${firstRun ? 'ABSENT — this run only starts the streaks, nothing can lock yet' : `${Object.keys(activity).length} seasons tracked`}`);
  if (!cands.length) { log('nothing to consider.'); return; }

  const now = new Date().toISOString();
  const lock = [], tooYoung = [], notQuiet = [], changed = [], noGames = [], noDate = [];

  for (const s of cands) {
    // 1. Zero games is NEVER locked here. Proving an empty season is truly empty
    //    means asking PlayHQ, which is close-empty-seasons.js's job.
    const file = path.join(GAMES_DIR, `${s.id}.json`);
    let games = [];
    if (fs.existsSync(file)) {
      try { games = Object.values(JSON.parse(fs.readFileSync(file, 'utf8')).games || {}); } catch { games = []; }
    }
    if (!games.length) { noGames.push(s); continue; }

    // 2. Fingerprint and streak. Recorded for EVERY candidate, even ones that can
    //    never lock, so the streak is already running when they become eligible.
    const fp   = fingerprint(games);
    const prev = activity[s.id];
    let streak;
    if (prev && prev.fp === fp) { streak = (prev.seen || 1) + 1; }
    else                        { streak = 1; if (prev) changed.push({ s, from: prev.fp, to: fp }); }
    activity[s.id] = { fp, seen: streak, at: now, games: games.length };

    // 3. Age. Never guessed from the season name — no endDate means no decision.
    const age = s.endDate ? monthsSince(s.endDate) : null;
    if (age === null) { noDate.push(s); continue; }
    if (age < MIN_AGE_MONTHS) { tooYoung.push({ s, age }); continue; }
    if (streak < QUIET_CHECKS) { notQuiet.push({ s, streak }); continue; }

    lock.push({ s, streak, games: games.length, age });
  }

  lock.sort((a, b) => (b.s.grades || []).length - (a.s.grades || []).length);
  const toLock = MAX_LOCK ? lock.slice(0, MAX_LOCK) : lock;

  for (const x of toLock) {
    const e = index.seasons[x.s.id];
    e.locked = true;
    e.lockedAt = now;
    e.lockedReason = `quiet-${QUIET_CHECKS} (ended ${x.s.endDate}, ${x.games} games unchanged for ${x.streak} checks)`;
  }

  // ── Assertions. Locking must move ONE thing, by exactly this many. ──────────
  const after = Object.values(index.seasons);
  if (after.length !== countBefore)                                           throw new Error(`ABORT: season count changed ${countBefore} → ${after.length}. Nothing committed.`);
  if (after.filter(s => s.removed === true).length !== removedBefore)         throw new Error(`ABORT: removed count changed. This tool must never set removed. Nothing committed.`);
  if (after.reduce((t, s) => t + (s.grades || []).length, 0) !== gradesBefore) throw new Error(`ABORT: grade total changed. Nothing committed.`);
  const lockedAfter = after.filter(s => s.locked === true).length;
  if (lockedAfter - lockedBefore !== toLock.length)                           throw new Error(`ABORT: locked rose by ${lockedAfter - lockedBefore} but ${toLock.length} were locked. Nothing committed.`);

  const g = (arr) => arr.reduce((t, x) => t + ((x.s || x).grades || []).length, 0);
  const row = (x, extra) => `    ${(x.s || x).id}  ended ${String((x.s || x).endDate || '?').padEnd(10)}  ${String(((x.s || x).grades || []).length).padStart(3)}gr  ${String(extra).padEnd(30)}  ${((x.s || x).fullName || '').slice(0, 40)}`;

  console.log(`\n─── LOCKING — finished, old enough, and provably unchanged ─────────────────────`);
  if (!toLock.length) console.log('    (none)');
  for (const x of toLock.slice(0, 40)) console.log(row(x, `${x.games} games, quiet ${x.streak} checks`));
  if (toLock.length > 40) console.log(`    … and ${toLock.length - 40} more`);

  if (changed.length) {
    console.log(`\n─── CHANGED SINCE LAST CHECK — streak reset to 1 ───────────────────────────────`);
    for (const x of changed.slice(0, 15)) console.log(row(x, `${x.from} → ${x.to}`));
    if (changed.length > 15) console.log(`    … and ${changed.length - 15} more`);
  }

  console.log(`\n${'═'.repeat(92)}`);
  console.log(`  LOCKED               : ${String(toLock.length).padStart(4)}   ${g(toLock)} grades off the nightly`);
  console.log(`  still settling       : ${String(notQuiet.length).padStart(4)}   ${g(notQuiet)} grades — old enough, not yet quiet for ${QUIET_CHECKS} checks`);
  console.log(`  too young            : ${String(tooYoung.length).padStart(4)}   ${g(tooYoung)} grades — ended less than ${MIN_AGE_MONTHS} months ago`);
  console.log(`  changed this run     : ${String(changed.length).padStart(4)}   still active, streak reset`);
  console.log(`  no games on disk     : ${String(noGames.length).padStart(4)}   ${g(noGames)} grades — NEVER locked here; run close-empty-seasons`);
  console.log(`  no endDate           : ${String(noDate.length).padStart(4)}   ${g(noDate)} grades — cannot judge age, never guessed`);
  console.log(`  ${'-'.repeat(88)}`);
  console.log(`  locked               : ${lockedBefore} → ${lockedAfter}`);
  console.log(`  nightly grades       : ${nightlyGrades} → ${nightlyGrades - g(toLock)}`);
  console.log(`  assertions           : PASSED — count, removed and grades all unchanged`);
  console.log(`${'═'.repeat(92)}`);

  if (firstRun) console.log(`\n  First run: every streak starts at 1, so nothing can reach ${QUIET_CHECKS} yet.\n  Run it again on ${QUIET_CHECKS - 1} more days and the eligible seasons will lock.`);
  if (noGames.length) console.log(`\n  ${noGames.length} season(s) hold no games. They are NOT locked here — proving an empty\n  season is truly empty means asking PlayHQ. Run close-empty-seasons.yml for those.`);

  if (DRY_RUN) { log('dry run — nothing written.'); return; }

  fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(activity));
  if (RECORD_ONLY || !toLock.length) {
    gitCommit(`lock-quiet-seasons: recorded activity for ${cands.length} season(s), locked 0`, [ACTIVITY_REL]);
    log('streaks recorded; nothing locked.');
    return;
  }
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index));
  gitCommit(`lock-quiet-seasons: locked ${toLock.length} quiet season(s), ${g(toLock)} grades off the nightly`, [INDEX_REL, ACTIVITY_REL]);
  log('reopen by clearing locked/lockedAt/lockedReason on the affected ids.');
}

main();
