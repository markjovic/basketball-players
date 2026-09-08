// scripts/audit-finished-unlocked-seasons.js
//
// READ-ONLY. Measures every season that is FINISHED but still unlocked, against
// the game data actually on disk, so a locking rule can be written from a measured
// picture instead of a guess.
//
// WRITES NOTHING. No fs.writeFileSync, no git, no network. Safe to run twice.
//
// THE PROBLEM
// ───────────
// nightly-crawl.js selects seasons at locked:false (L768) and builds its work list
// from their grades. It reads data/sports-index.json and NEVER writes it - there is
// no writeFileSync for INDEX_FILE anywhere in that file. So nothing locks a season,
// ever. A COMPLETED season left unlocked is re-fetched every night for an answer
// that cannot change.
//
// Measured 2026-09-08: 138 COMPLETED seasons sit at locked:false holding ~850
// grades, against a nightly total of ~9,755 across 755 unlocked seasons. Roughly
// nine percent of every run re-reads finished history. 86 of the 138 predate
// 2026-09-07; 52 arrived with the removed:true repair.
//
// WHY MEASURE BEFORE BUILDING
// ───────────────────────────
// Locking a finished season whose games were never fetched buries it permanently -
// the same class of mistake as writing removed:true off a CloudFront block, just
// from the other direction. So the locking rule needs a test for "this season is
// genuinely captured", and that test has to be checked against what is really on
// disk. Some of these have been unlocked for months and may be complete; the 52
// from the repair have had at most one nightly and may hold nothing at all.
//
// WHAT "CAPTURED" MEANS HERE
// ──────────────────────────
// Three buckets that must not be collapsed:
//
//   captured   file exists, every grade in the index is represented in the games,
//              and no game is still UPCOMING       → safe to lock
//   partial    file exists but a grade has no games, or games remain UPCOMING
//              → NOT safe to lock; something is still missing
//   empty      no games file, or a file with zero games
//              → NOT safe to lock; nothing was ever fetched
//
// A season carrying grades:[] in the index cannot have grade coverage checked at
// all, so it is reported separately rather than being quietly called captured.
//
// A game carries h/a OR t1/t2, never both (README). This tool reads neither - only
// gid and st - so that trap does not apply here. Do not add team logic without
// handling both pairs.
//
// Run:
//   node scripts/audit-finished-unlocked-seasons.js --list-paths   (phase 1)
//   node scripts/audit-finished-unlocked-seasons.js                (phase 2)

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..');
const INDEX_FILE = path.join(ROOT, 'data', 'sports-index.json');
const GAMES_DIR  = path.join(ROOT, 'games', 'bv');

const args       = process.argv.slice(2);
const LIST_PATHS = args.includes('--list-paths');

const log = (m) => console.log(`[finished-unlocked] ${new Date().toISOString()} ${m}`);

// Terminal states. A game in any of these will never change again. UPCOMING is the
// only one that means "not yet played", and a season holding one is not finished
// in practice however its status reads.
const TERMINAL = new Set(['FINAL', 'CANCELLED', 'ABANDONED', 'FORFEIT']);

function selectSeasons() {
  const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  const all = Object.values(index.seasons || {});
  return {
    all,
    targets: all.filter(s => s.status === 'COMPLETED' && s.locked === false),
  };
}

// ── Phase 1 ─────────────────────────────────────────────────────────────────
// Emits the explicit games/bv paths for a non-cone sparse checkout. games/bv is
// 1.94 GB across 2,939 files, so a cone-mode pattern on `games` would pull all of
// it. Naming ~138 files directly is about 90 MB. The reduce job in
// discover-seasons-matrix.yml uses this same two-phase shape.
if (LIST_PATHS) {
  const { targets } = selectSeasons();
  const out = process.env.GITHUB_OUTPUT;
  const paths = targets.map(s => `games/bv/${s.id}.json`);
  console.error(`[finished-unlocked] ${targets.length} finished-but-unlocked season(s) to fetch`);
  if (out) {
    fs.appendFileSync(out, `game_files<<SPARSEEOF\n${paths.length ? paths.join('\n') + '\n' : ''}SPARSEEOF\n`);
    fs.appendFileSync(out, `season_count=${targets.length}\n`);
  }
  console.log(paths.join('\n'));
  process.exit(0);
}

// ── Phase 2 ─────────────────────────────────────────────────────────────────
function main() {
  log('audit-finished-unlocked-seasons  READ-ONLY');
  console.log('─'.repeat(86));

  const { all, targets } = selectSeasons();
  const unlocked = all.filter(s => s.locked === false);
  const nightlyGrades = unlocked.reduce((t, s) => t + (s.grades || []).length, 0);

  console.log(`  seasons in index                 : ${all.length}`);
  console.log(`  unlocked (crawled every night)   : ${unlocked.length}  holding ${nightlyGrades} grades`);
  console.log(`  SELECTED (COMPLETED + unlocked)  : ${targets.length}`);
  if (!targets.length) { log('nothing selected.'); return; }

  const byOrigin = { org: 0, other: 0 };
  for (const s of targets) (s.discoveredBy === 'org' ? byOrigin.org++ : byOrigin.other++);
  console.log(`    from the org route             : ${byOrigin.org}`);
  console.log(`    pre-existing                   : ${byOrigin.other}`);
  console.log('');

  const captured = [], partial = [], empty = [], noGrades = [];

  for (const s of targets) {
    const file = path.join(GAMES_DIR, `${s.id}.json`);
    const idxGrades = (s.grades || []).map(g => g.id).filter(Boolean);

    let data = null, unreadable = false;
    if (fs.existsSync(file)) {
      try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch { unreadable = true; }
    }
    const games = (data && data.games) ? Object.values(data.games) : [];

    if (unreadable || !games.length) {
      empty.push({ s, why: unreadable ? 'games file UNREADABLE' : (data ? 'games file has zero games' : 'no games file on disk'), gradeN: idxGrades.length });
      continue;
    }

    const gidsSeen  = new Set(games.map(g => g.gid).filter(Boolean));
    const upcoming  = games.filter(g => g.st === 'UPCOMING').length;
    const nonTermN  = games.filter(g => g.st && !TERMINAL.has(g.st)).length;
    const scored    = games.filter(g => g.hs != null || g.as != null).length;
    const missing   = idxGrades.filter(g => !gidsSeen.has(g));

    const row = { s, games: games.length, gids: gidsSeen.size, gradeN: idxGrades.length, missing: missing.length, upcoming, nonTermN, scored };

    // No grades in the index means grade coverage is unmeasurable. Reported on its
    // own rather than counted as captured on the strength of a check not performed.
    if (!idxGrades.length) { noGrades.push(row); continue; }
    if (missing.length || upcoming > 0) { partial.push(row); continue; }
    captured.push(row);
  }

  const fmt = (r, extra) =>
    `    ${r.s.id}  ${String(r.s.endDate || '?').padEnd(10)}  ${String(r.games || 0).padStart(6)}g  ${String(r.gradeN).padStart(3)}gr  ${String(extra).padEnd(26)}  ${(r.s.fullName || r.s.name || '').slice(0, 44)}`;

  console.log(`─── CAPTURED — every grade represented, nothing still to play ─────────────────`);
  console.log(`    safe to lock`);
  if (!captured.length) console.log('    (none)');
  for (const r of captured.sort((a, b) => b.gradeN - a.gradeN)) console.log(fmt(r, `${r.gids} gids, ${r.scored} scored`));

  console.log(`\n─── PARTIAL — a grade has no games, or games remain UPCOMING ──────────────────`);
  console.log(`    NOT safe to lock — something is still missing`);
  if (!partial.length) console.log('    (none)');
  for (const r of partial.sort((a, b) => b.missing - a.missing)) console.log(fmt(r, `${r.missing} grades absent, ${r.upcoming} upcoming`));

  console.log(`\n─── EMPTY — nothing was ever fetched ──────────────────────────────────────────`);
  console.log(`    NOT safe to lock — locking these would bury them permanently`);
  if (!empty.length) console.log('    (none)');
  for (const r of empty) console.log(fmt(r, r.why));

  console.log(`\n─── NO GRADES IN INDEX — coverage cannot be checked ───────────────────────────`);
  console.log(`    reported separately; NOT counted as captured`);
  if (!noGrades.length) console.log('    (none)');
  for (const r of noGrades) console.log(fmt(r, `${r.gids} gids, ${r.upcoming} upcoming`));

  // ── The saving ─────────────────────────────────────────────────────────────
  const g = (arr) => arr.reduce((t, r) => t + r.gradeN, 0);
  const savedGrades = g(captured);
  const savedGames  = captured.reduce((t, r) => t + r.games, 0);

  console.log(`\n${'═'.repeat(86)}`);
  console.log(`  captured (lockable)  : ${String(captured.length).padStart(4)}   ${String(g(captured)).padStart(5)} grades   ${savedGames} games already on disk`);
  console.log(`  partial              : ${String(partial.length).padStart(4)}   ${String(g(partial)).padStart(5)} grades`);
  console.log(`  empty                : ${String(empty.length).padStart(4)}   ${String(g(empty)).padStart(5)} grades`);
  console.log(`  no grades in index   : ${String(noGrades.length).padStart(4)}   ${String(g(noGrades)).padStart(5)} grades`);
  console.log(`  ${'-'.repeat(82)}`);
  console.log(`  NIGHTLY SAVING       : ${savedGrades} of ${nightlyGrades} grades  (${(savedGrades / Math.max(1, nightlyGrades) * 100).toFixed(1)}% of every run)`);
  console.log(`  left unlocked after  : ${unlocked.length - captured.length} seasons, ${nightlyGrades - savedGrades} grades`);
  console.log(`${'═'.repeat(86)}`);
  console.log(`\n  Only the CAPTURED bucket is safe for a locking rule to act on. The partial and`);
  console.log(`  empty buckets are the reason the rule cannot simply be "COMPLETED means lock":`);
  console.log(`  a season locked before its games were fetched is hidden for good, which is the`);
  console.log(`  same failure as writing removed:true off a block, from the other direction.`);
  log('read-only — nothing written, nothing committed.');
}

main();
