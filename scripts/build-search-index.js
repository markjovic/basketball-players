// scripts/build-search-index.js
//
// Rebuilds search/players/{prefix}.json shards from player index + detail files.
//
// Sharding v2 (2026-08-02): FOLD accents to base letters (normName-v2-style
// NFKC + NFD strip), THEN strip remaining non a-z, THEN take the first 2 chars.
// e.g. "Sam Burdan" -> "sa", "Burdan, Sam" -> "bu", "Álvarez" -> "al",
// "O'Brien" -> "ob". The old rule DELETED accented characters instead of
// folding them ("Álvarez" -> "lv"), while the client sliced the raw query
// ("álvarez" -> shard "ál", a file that never existed) — so accented names
// were unfindable by ANY query. StatTrack 0.68's searchPlayers applies this
// exact fold+strip to the query; the two must stay identical.
// DEPLOY ORDER: run this rebuild BEFORE committing the 0.68 client — with the
// new index, even the old client's raw "al" slice finds Álvarez.
//
// Each shard: { "Name": [{ id, c, t }, ...], "Last, First": [...] }
// where c = most recent club, t = most recent team name.
//
// Usage:
//   node scripts/build-search-index.js            # rebuild all shards
//   node scripts/build-search-index.js --dry-run  # no writes or commits
//
// 2026-07-10: entry.id is truncated to a 10-char uuid prefix (see
// scripts/lib/uuid-prefix.cjs) — part of the UUID-storage migration. The
// source uuid always comes from players/indexes/{shard}.json keys, which
// are full-length, so no resolve step is needed here — only truncate at
// write time.

'use strict';

const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');
const { truncateUuid } = require('./lib/uuid-prefix.cjs');

const ROOT       = path.join(__dirname, '..');
const DRY_RUN    = process.argv.includes('--dry-run');

const INDEX_DIR  = path.join(ROOT, 'players', 'indexes');
const PLAYER_DIR = path.join(ROOT, 'players');
const SEARCH_DIR = path.join(ROOT, 'search', 'players');
const SPORTS_INDEX = path.join(ROOT, 'data', 'sports-index.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function gitCommit(message) {
  if (DRY_RUN) { console.log(`  [dry-run] ${message}`); return; }
  try {
    // Explicit path, never -A — this repo is multi-GB with 370k+ player
    // files; -A walks the whole index and risks ENOBUFS on a run like this
    // one that also touches search/.
    execSync('git add search/', { stdio: 'pipe', cwd: ROOT });
    // --shortstat, not --stat: --stat prints a per-file line and scales with
    // file count (confirmed empirically 2026-07-10 — real ENOBUFS risk on a
    // repo this size), --shortstat stays a single small summary line.
    const staged = execSync('git diff --staged --shortstat', { stdio: 'pipe', cwd: ROOT }).toString().trim();
    if (!staged) { console.log('  Nothing to commit'); return; }
    execSync(`git commit -q -m "${message.replace(/"/g, "'")}"`, { stdio: 'pipe', cwd: ROOT });
    execSync('git fetch origin main', { stdio: 'pipe', cwd: ROOT });
    // --no-stat: git merge prints a full diffstat by default (same ENOBUFS
    // class as --stat above) — scales with what's landed on main since the
    // last fetch, not with what this run is committing.
    execSync('git merge -X ours FETCH_HEAD --no-edit --no-stat', { stdio: 'pipe', cwd: ROOT });
    execSync('git push origin main', { stdio: 'pipe', cwd: ROOT });
    console.log(`  ✓ ${message}`);
    return;
  } catch (e) {
    // ⚠️ 2026-09-08: this used to print and return, so a failed add, commit, merge
    // or push exited ZERO and the job showed green having written nothing — the
    // same fault found the same day in build-venue-indexes.js and
    // update-team-index.js. A lost run must show red.
    const detail = (e.stderr || e.stdout || '').toString().trim() || e.message;
    console.error(`  git error on the first attempt: ${detail}`);
  }

  // Push contention against the matrix storm is normal and is not a failure until
  // the loop gives up. 60 attempts with random jitter, then THROW.
  for (let attempt = 2; attempt <= 60; attempt++) {
    try {
      execSync('git fetch origin main', { stdio: 'pipe', cwd: ROOT });
      execSync('git merge -X ours FETCH_HEAD --no-edit --no-stat', { stdio: 'pipe', cwd: ROOT });
      execSync('git push origin main', { stdio: 'pipe', cwd: ROOT });
      console.log(`  ✓ pushed (attempt ${attempt}): ${message}`);
      return;
    } catch (e) {
      const detail = (e.stderr || e.stdout || '').toString().trim() || e.message;
      if (attempt === 60) throw new Error(`push failed after 60 attempts: ${detail}`);
      const wait = 1 + Math.floor(Math.random() * 90);
      console.log(`  … push contention (attempt ${attempt}) — retry in ${wait}s`);
      execSync(`sleep ${wait}`, { stdio: 'ignore' });
    }
  }
}

// Extract the most recent club and team from a player detail file.
//
// ⚠️ REWRITTEN 2026-09-08. THE PREVIOUS VERSION LEFT MOST PLAYERS WITH NO CLUB.
// StatTrack renders `${h.c||'—'} · ${h.t||''}` (index.html L935), so a null `c` is
// the em-dash in player search. It was walking seasons backwards and returning at
// the FIRST season holding a team name — with THAT season's club, even when the
// field was absent — and never looking further back for one.
//
// Measured on Toby Jovic (0afc7690): 9 seasons, 6 of them carrying a club. The last
// array entry is Spring 2026, which has a team ("Coyotes") and NO club field, so the
// function returned {c: null, t: "Coyotes"} and StatTrack showed "— · Coyotes" —
// exactly the row in the screenshot — while "Spirit Magic Basketball Club" sat in
// seasons[0].
//
// Second fault: "most recent" meant "last in the array". That order is not
// chronological. Toby's seasons run newest-first for entries 0-6 and then have two
// appended on the end. Same assumption that made the update-team-index rewrite treat
// reg order as chronology (T57) — array position is not a date.
//
// The rule now: order by the season's real endDate (from sports-index, present on
// ~77% of seasons after the 2026-09-08 backfill), newest first, with array order as
// the tie-break for seasons that have no date. Then PREFER THE MOST RECENT SEASON
// HOLDING BOTH a club and a team, so the pair stays coherent — a club from one
// season stitched onto a team from another reads as a real pairing and is not one.
// Only if no season has both does it fall back to taking each independently.
function extractClubTeam(player, endDates) {
  const seasons = (player.seasons || []).map((s, i) => {
    const regs = s.regs || [];
    const last = regs[regs.length - 1];
    return { club: s.club || null, team: (last && last.tn) || null, end: (endDates && endDates[s.sid]) || null, i };
  });

  // Newest first. Seasons with no endDate sort last, keeping their array order
  // among themselves — never guessed at from the season name.
  seasons.sort((a, b) => {
    if (a.end && b.end) return a.end < b.end ? 1 : a.end > b.end ? -1 : b.i - a.i;
    if (a.end) return -1;
    if (b.end) return 1;
    return b.i - a.i;
  });

  const both = seasons.find(s => s.club && s.team);
  if (both) return { c: both.club, t: both.team, paired: true };

  const withTeam = seasons.find(s => s.team);
  const withClub = seasons.find(s => s.club);
  return { c: (withClub && withClub.club) || null, t: (withTeam && withTeam.team) || null, paired: false };
}

// The previous behaviour, kept ONLY so a run can report how many players actually
// gain a club. A counter without a before-and-after is a number nobody can check.
function extractClubTeamOld(player) {
  const seasons = player.seasons || [];
  for (let i = seasons.length - 1; i >= 0; i--) {
    const s    = seasons[i];
    const club = s.club || null;
    const regs = s.regs || [];
    const lastReg = regs[regs.length - 1];
    if (lastReg?.tn) return { c: club, t: lastReg.tn };
    if (club) return { c: club, t: null };
  }
  return { c: null, t: null };
}

// Name -> shard key v2: fold accents to base letters, then letters-only,
// first 2 chars, '_'-padded fallback. MUST match StatTrack searchPlayers.
function shardKey(name) {
  const folded = String(name)
    .normalize('NFKC')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const clean = folded.replace(/[^a-z]/g, '');
  return clean.length >= 2 ? clean.slice(0, 2) : (clean + '_').slice(0, 2);
}

async function main() {
  const startTime = Date.now();
  console.log('build-search-index.js');
  if (DRY_RUN) console.log('  ⚠  DRY RUN');
  console.log('─'.repeat(50));

  if (!DRY_RUN) fs.mkdirSync(SEARCH_DIR, { recursive: true });

  // Season end dates, for ordering a player's seasons by when they actually
  // finished rather than by array position. Present on ~77% of seasons after the
  // 2026-09-08 backfill; the rest fall back to array order and are never guessed
  // at from the season name.
  const endDates = {};
  let datedSeasons = 0;
  try {
    const si = JSON.parse(fs.readFileSync(SPORTS_INDEX, 'utf8'));
    for (const [sid, s] of Object.entries(si.seasons || {})) {
      if (s.endDate) { endDates[sid] = s.endDate; datedSeasons++; }
    }
    console.log(`  Season end dates loaded: ${datedSeasons} of ${Object.keys(si.seasons || {}).length}`);
  } catch (e) {
    console.log(`  ⚠ could not read sports-index.json (${e.message}) — falling back to array order for every season`);
  }

  // Build the full shard map in memory — keyed by 2-char name prefix
  // Memory: ~369k players × ~150 bytes/entry = ~55MB, manageable
  const shards = new Map();  // "sa" → { "Sam Burdan": [{id, c, t}], "Burdan, Sam": [...] }

  function addEntry(nameKey, entry) {
    const sk = shardKey(nameKey);
    if (!shards.has(sk)) shards.set(sk, {});
    const shard = shards.get(sk);
    if (!shard[nameKey]) shard[nameKey] = [];
    if (!shard[nameKey].some(e => e.id === entry.id)) {
      shard[nameKey].push(entry);
    }
  }

  // Read all UUID prefix shards (00-ff) from the player index
  let totalPlayers = 0;
  // Before-and-after on the club fix. A counter without a comparison is a number
  // nobody can check.
  let hadClubBefore = 0, hasClubAfter = 0, gainedClub = 0, pairedFromBoth = 0, stillNoClub = 0;
  const gainedSamples = [];

  for (let i = 0; i < 256; i++) {
    const prefix    = i.toString(16).padStart(2, '0');
    const indexFile = path.join(INDEX_DIR, `${prefix}.json`);
    if (!fs.existsSync(indexFile)) continue;

    let index;
    try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); }
    catch (_) { continue; }

    for (const [uuid, indexEntry] of Object.entries(index)) {
      totalPlayers++;
      const playerName = (indexEntry.name || '').trim();
      if (!playerName) continue;

      // Read player detail file for club/team. `player` is hoisted to this
      // scope because the reversed-name guard below needs player.private —
      // 2026-07-16: it was previously declared const INSIDE this try block,
      // making the guard a guaranteed ReferenceError on the first
      // non-placeholder player (the bug that broke every run for days).
      let c = null, t = null;
      let player = null;
      const playerFile = path.join(PLAYER_DIR, prefix, `${uuid}.json`);
      if (fs.existsSync(playerFile)) {
        try {
          player = JSON.parse(fs.readFileSync(playerFile, 'utf8'));
          const ct  = extractClubTeam(player, endDates);
          const old = extractClubTeamOld(player);
          c = ct.c; t = ct.t;
          if (old.c) hadClubBefore++;
          if (ct.c)  hasClubAfter++;
          if (ct.paired) pairedFromBoth++;
          if (!old.c && ct.c) {
            gainedClub++;
            if (gainedSamples.length < 15) gainedSamples.push(`    ${playerName.slice(0, 26).padEnd(26)} — · ${old.t || ''}   ->   ${ct.c} · ${ct.t || ''}`);
          }
          if (!ct.c) stillNoClub++;
        } catch (_) { player = null; }
      }

      const entry = { id: truncateUuid(uuid), c: c || null, t: t || null };

      // Forward: "Sam Burdan"
      addEntry(playerName, entry);

      // Reversed: "Burdan, Sam" (skip private player stubs). player may be
      // null (missing/unparseable detail file) — treat that as not-private.
      if (!playerName.startsWith('Player #') && !(player && player.private === true)) {
        const parts = playerName.split(/\s+/);
        if (parts.length >= 2) {
          const lastName  = parts[parts.length - 1];
          const firstPart = parts.slice(0, -1).join(' ');
          const reversed  = `${lastName}, ${firstPart}`;
          if (reversed !== playerName) addEntry(reversed, entry);
        }
      }
    }

    if ((i + 1) % 32 === 0 || i === 255)
      process.stdout.write(`  ${i + 1}/256 UUID shards scanned (${totalPlayers} players)\r`);
  }

  console.log(`\n  Players indexed: ${totalPlayers}`);
  console.log(`  ── club coverage in player search ──`);
  console.log(`    had a club before : ${hadClubBefore}`);
  console.log(`    have one now      : ${hasClubAfter}`);
  console.log(`    GAINED a club     : ${gainedClub}   ← these showed "—" in StatTrack`);
  console.log(`    club+team from one season : ${pairedFromBoth}   (a coherent pairing)`);
  console.log(`    still no club     : ${stillNoClub}   (no season on record carries one)`);
  if (gainedSamples.length) { console.log(`    examples:`); gainedSamples.forEach(x => console.log(x)); }
  console.log(`  Name-prefix shards to write: ${shards.size}`);

  // Write shards
  let totalKeys = 0;
  for (const [prefix, data] of shards) {
    totalKeys += Object.keys(data).length;
    if (!DRY_RUN) {
      fs.writeFileSync(path.join(SEARCH_DIR, `${prefix}.json`), JSON.stringify(data));
    }
  }

  // Remove ANY shard file this rebuild didn't produce. Generalized 2026-08-02
  // from the old hex-only cleanup: the shardKey v2 fold MOVES keys between
  // shards (Álvarez: lv -> al), and a source shard left unrewritten would keep
  // serving its stale pre-fold contents forever. A full rebuild owns the whole
  // directory, so absence from `shards` is the definition of stale.
  let staleRemoved = 0;
  if (!DRY_RUN) {
    for (const file of fs.readdirSync(SEARCH_DIR)) {
      if (!file.endsWith('.json')) continue;
      if (!shards.has(file.replace('.json', ''))) {
        fs.unlinkSync(path.join(SEARCH_DIR, file));
        staleRemoved++;
      }
    }
  }

  console.log(`  Name-based shards written: ${shards.size}`);
  console.log(`  Total search keys: ${totalKeys}`);
  if (staleRemoved > 0) console.log(`  Stale shard files removed: ${staleRemoved}`);

  await gitCommit(
    `build-search-index: ${totalPlayers} players, ${shards.size} shards, ${totalKeys} keys`
  );

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log('─'.repeat(50));
  console.log(`  Elapsed: ${elapsed}s`);
  if (DRY_RUN) console.log('  ⚠  DRY RUN — nothing written');
}

main().catch(e => { console.error('\nFATAL:', e.message, '\n', e.stack); process.exit(1); });
