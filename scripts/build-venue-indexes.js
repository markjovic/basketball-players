// scripts/build-venue-indexes.js
//
// ⚠️ data/venue-index.json HAD NO WRITER AT ALL UNTIL 2026-09-08.
// It was created once, on 2026-06-13, by the Phase 1 migration — 532 entries against
// the 532 venue directories that existed that day. Nothing updated it since, because
// no ongoing writer was ever built. REPO_MANIFEST's writer→reader graph recorded it
// as "(venue build)", a placeholder nobody resolved, and this script — the obvious
// candidate — never touched it. By 2026-09-08 it held 532 entries against 537 venue
// directories, and StatTrack reads it to name venues. Five venues existed in the data
// and could not be named.
//
// It is rebuilt here because this script ALREADY opens every file in games/bv for
// part 3, and every game carries BOTH `vid` and `vn`. The name was one field away
// from the id already being collected.
//
// Generates four index files from venue-lookup/ and games/bv/:
//
//   1. venue-lookup/{vid}/dates.json
//      Array of YYYY-MM-DD strings for every date with at least one game at this venue.
//
//   2. date-venue-index/{YYYY-MM-DD}.json
//      Array of venue IDs active on that date (at least one game).
//
//   3. data/season-venue-index.json
//      { seasonId: [venueId, ...] } — venues used in each season.
//      Derived from games/bv/{sid}.json (vid field on game entries).
//
//   4. data/venue-index.json
//      [{ id, n }] — venue id and display name, read by StatTrack.
//      Derived from games/bv/{sid}.json (vid + vn). A renamed venue takes the name
//      from its MOST RECENT game.
//
//      IT MERGES, IT DOES NOT REPLACE. Entries already present that no game mentions
//      are KEPT and reported as orphans, never dropped. A rebuild that silently
//      deletes rows StatTrack may still reference is worse than a stale file.
//
// Run: node scripts/build-venue-indexes.js
// Dry run: node scripts/build-venue-indexes.js --dry-run

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT    = path.join(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data), 'utf8');
}

// ⚠️ REWRITTEN 2026-09-08. THE PREVIOUS VERSION HAD TWO FAULTS, BOTH DOCUMENTED
// ELSEWHERE IN THIS REPO AS ALREADY-FIXED BUGS.
//
// 1. ONE COMBINED `git add` ACROSS THREE PATHSPECS. If any single pathspec matches
//    nothing, git stages NOTHING — atomically, silently, exit 0. This is the exact
//    failure that discarded a green run of 30,426 games from `discover-fixtures.js`
//    on 2026-07-19 (REPO_MANIFEST §2.2). That script was fixed with per-path adds on
//    2026-07-21. This one was never touched.
//
// 2. THE WHOLE THING WAS WRAPPED IN A try/catch THAT PRINTED AND RETURNED.
//    A failed add, commit, merge or push printed "✗ git error" and the process
//    exited ZERO. The job showed green having written nothing. That is the same class
//    as the weekly sweep reporting success for a month while doing nothing.
//
// Now on the house pattern: per-path `git add`, staged shortstat printed before the
// commit, commit before merge, 60-attempt push retry with random jitter, and it
// THROWS when attempts are exhausted. A lost run must show red.
const GIT_OPTS      = { cwd: ROOT, stdio: 'pipe', timeout: 10 * 60 * 1000, maxBuffer: 512 * 1024 * 1024 };
const PUSH_ATTEMPTS = 60;

function gitCommit(message, paths) {
  let staged = 0;
  for (const p of paths) {
    // Per path, so one unmatched pathspec cannot silently discard the others.
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
      const wait = 1000 + Math.floor(Math.random() * 90000);
      console.log(`  … push contention (attempt ${attempt}) — retry in ${Math.round(wait / 1000)}s`);
      execSync(`sleep ${Math.round(wait / 1000)}`, { stdio: 'ignore' });
    }
  }
}

// ─── part 1 & 2: scan venue-lookup directory ────────────────────────────────
// Build:  vid → Set<date>   (for dates.json per venue)
//         date → Set<vid>   (for date-venue-index)

console.log('Scanning venue-lookup/ directory...');
const venueLookupDir = path.join(ROOT, 'venue-lookup');

// vid → sorted date array
const venueDates = new Map();
// date → Set of vids
const dateVenues = new Map();

const venueIds = fs.readdirSync(venueLookupDir).filter(name => {
  return fs.statSync(path.join(venueLookupDir, name)).isDirectory();
});

let totalDateFiles = 0;

for (const vid of venueIds) {
  const venueDir = path.join(venueLookupDir, vid);
  const dateFiles = fs.readdirSync(venueDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)); // YYYY-MM-DD.json only

  const dates = dateFiles.map(f => f.replace('.json', '')).sort();
  totalDateFiles += dates.length;

  if (dates.length > 0) {
    venueDates.set(vid, dates);
    for (const d of dates) {
      if (!dateVenues.has(d)) dateVenues.set(d, new Set());
      dateVenues.get(d).add(vid);
    }
  }
}

console.log(`  ${venueIds.length} venues, ${totalDateFiles} date files`);
console.log(`  ${dateVenues.size} distinct dates`);

// ─── write venue dates.json files ───────────────────────────────────────────

console.log('\nWriting venue-lookup/{vid}/dates.json...');
let venueIndexCount = 0;

for (const [vid, dates] of venueDates) {
  const outPath = path.join(venueLookupDir, vid, 'dates.json');
  if (!DRY_RUN) writeJson(outPath, dates);
  venueIndexCount++;
}

console.log(`  ${venueIndexCount} dates.json files written`);

// ─── write date-venue-index files ───────────────────────────────────────────

console.log('\nWriting date-venue-index/{date}.json...');
const dateVenueDir = path.join(ROOT, 'date-venue-index');
if (!DRY_RUN) fs.mkdirSync(dateVenueDir, { recursive: true });

let dateIndexCount = 0;

for (const [date, vids] of dateVenues) {
  const sorted = [...vids].sort();
  const outPath = path.join(dateVenueDir, `${date}.json`);
  if (!DRY_RUN) writeJson(outPath, sorted);
  dateIndexCount++;
}

console.log(`  ${dateIndexCount} date-venue-index files written`);

// ─── part 3: season-venue-index from games files ────────────────────────────

console.log('\nBuilding season-venue-index from games/bv/...');
const gamesDir = path.join(ROOT, 'games', 'bv');
const gameFiles = fs.readdirSync(gamesDir).filter(f => f.endsWith('.json'));

// sid → Set<vid>
const seasonVenues = new Map();
// vid → { n, d }  — the name from the venue's MOST RECENT game. A venue that has
// been renamed should read as whatever it is called now, not whatever it was
// called the first time a game landed there.
const venueNames = new Map();
let gamesWithVid = 0, gamesWithVn = 0;

for (const fname of gameFiles) {
  const sid = fname.replace('.json', '');
  let gf;
  try { gf = readJson(path.join(gamesDir, fname)); } catch { continue; }

  const vids = new Set();
  for (const g of Object.values(gf.games || {})) {
    if (!g.vid) continue;
    vids.add(g.vid);
    gamesWithVid++;
    if (!g.vn) continue;
    gamesWithVn++;
    const prev = venueNames.get(g.vid);
    const d = g.d || '';
    if (!prev || d > prev.d) venueNames.set(g.vid, { n: g.vn, d });
  }
  if (vids.size > 0) {
    seasonVenues.set(sid, vids);
  }
}

// serialise: { sid: [vid, ...] } sorted
const seasonVenueIndex = {};
for (const [sid, vids] of [...seasonVenues].sort(([a], [b]) => a.localeCompare(b))) {
  seasonVenueIndex[sid] = [...vids].sort();
}

const svPath = path.join(ROOT, 'data', 'season-venue-index.json');
if (!DRY_RUN) writeJson(svPath, seasonVenueIndex);
console.log(`  ${Object.keys(seasonVenueIndex).length} seasons in season-venue-index.json`);

// ─── part 4: venue-index.json ───────────────────────────────────────────────
// MERGE, never replace. Anything already in the file that no game mentions is kept
// and reported as an orphan. A rebuild that silently deletes rows StatTrack may
// still reference is worse than a stale file — and this file has been stale since
// the day it was created, so the first run of this will move a lot at once.

console.log('\nBuilding data/venue-index.json...');
const viPath = path.join(ROOT, 'data', 'venue-index.json');

let existing = [];
if (fs.existsSync(viPath)) {
  try { existing = readJson(viPath); } catch { existing = []; }
}
if (!Array.isArray(existing)) existing = [];
const byId = new Map(existing.filter(e => e && e.id).map(e => [e.id, e]));
const beforeCount = byId.size;

let added = 0, renamed = 0, unchanged = 0;
const renames = [];
for (const [vid, { n }] of venueNames) {
  const prev = byId.get(vid);
  if (!prev)            { byId.set(vid, { id: vid, n }); added++; continue; }
  if (prev.n === n)     { unchanged++; continue; }
  if (renames.length < 20) renames.push(`    ${vid}  ${JSON.stringify(prev.n)} → ${JSON.stringify(n)}`);
  prev.n = n; renamed++;
}

// Named by no game: either the venue only appears in venue-lookup, or every game
// there predates the vn field. Kept, and stated, so the number is visible.
const orphans = [...byId.keys()].filter(id => !venueNames.has(id));

const venueIndex = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
if (!DRY_RUN) writeJson(viPath, venueIndex);

console.log(`  games with vid: ${gamesWithVid}, of which ${gamesWithVn} also carry vn`);
console.log(`  venues named by games   : ${venueNames.size}`);
console.log(`  entries before          : ${beforeCount}`);
console.log(`  added                   : ${added}`);
console.log(`  renamed                 : ${renamed}`);
console.log(`  unchanged               : ${unchanged}`);
console.log(`  kept, named by no game  : ${orphans.length}   ← never dropped`);
console.log(`  entries after           : ${venueIndex.length}`);
if (renames.length) { console.log('  renames:'); renames.forEach(r => console.log(r)); if (renamed > renames.length) console.log(`    … and ${renamed - renames.length} more`); }
if (venueIndex.length < beforeCount) throw new Error(`ABORT: venue-index shrank ${beforeCount} → ${venueIndex.length}. This file must never lose entries.`);

// ─── commit ─────────────────────────────────────────────────────────────────

if (!DRY_RUN) {
  gitCommit(
    `build-venue-indexes: dates.json per venue, date-venue-index, season-venue-index, venue-index`,
    ['venue-lookup/', 'date-venue-index/', 'data/season-venue-index.json', 'data/venue-index.json']
  );
}

// ─── summary ────────────────────────────────────────────────────────────────

console.log('\n─── Summary ────────────────────────────────────────────────');
console.log(`  venue dates.json files   : ${venueIndexCount}`);
console.log(`  date-venue-index files   : ${dateIndexCount}`);
console.log(`  season-venue-index.json  : ${Object.keys(seasonVenueIndex).length} seasons`);
console.log(`  venue-index.json         : ${venueIndex.length} venues (+${added} new, ${renamed} renamed)`);
console.log(`  Mode                     : ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
