// scripts/verify-outstanding-claims.js
//
// READ-ONLY. No PlayHQ calls, no writes to players/. One pass over players/,
// one over games/bv. Prints every measurable claim in OUTSTANDING_TASKS.md
// beside what the database actually says today.
//
// WHY THIS EXISTS
// ───────────────
// The docs carry numbers. Numbers go stale the moment anything runs, and a stale
// number in a document reads exactly like a current one. Worse, several of the
// figures those documents were built on turned out to be artefacts of bugs -
// player.u sat at 1,115,172 for weeks and 96.5% of it was a wrong field name.
//
// So every claim below is DECLARED with its source and the date it was measured,
// and re-measured here. Drift is printed as drift, not silently absorbed.
//
// A claim this cannot measure from files says so rather than being left out. An
// omitted claim looks verified.
//
// Run:
//   node scripts/verify-outstanding-claims.js
//   node scripts/verify-outstanding-claims.js --json

'use strict';

const fs   = require('fs');
const path = require('path');
const { isPlaceholderName, looksLikeSeasonName } = require('./lib/namespace-resolve.cjs');

const ROOT        = path.join(__dirname, '..');
const PLAYERS_DIR = path.join(ROOT, 'players');
const GAMES_DIR   = path.join(ROOT, 'games', 'bv');
const REPORT      = path.join(ROOT, 'reports', 'misrouted-appearances.json');
const FORFEITS    = path.join(ROOT, 'data', 'forfeit-games.json');

// sports.Basketball.c and .x were added to fetch-profile-stats.js on this date.
// A player last fetched before it has neither, by design.
const DIFF_SHIPPED = Date.parse('2026-09-05T00:00:00Z');

const JSON_OUT = process.argv.includes('--json');
const log = (m) => { if (!JSON_OUT) console.log(m); };

// ─── The claims, as the docs state them ──────────────────────────────────────
// Every entry names where it is written down and when it was measured. A claim
// with no `expect` is one this script surfaces but cannot check.
const CLAIMS = [
  // Figures re-baselined 2026-09-07 from a full measurement. The x and c numbers
  // that were in README.md (~80,000 and ~224,000) were extrapolations from shard
  // 00 and both ran about 8% high; these are counted, not scaled.
  { id: 'u_entries',      expect: 39034,  src: 'measured 2026-09-07',           what: 'player.u entries repo-wide' },
  { id: 'u_players',      expect: 7500,   src: 'measured 2026-09-07',           what: 'players carrying a u array' },
  { id: 'x_entries',      expect: 73571,  src: 'measured 2026-09-07',           what: 'player.x entries repo-wide' },
  { id: 'c_entries',      expect: 205946, src: 'measured 2026-09-07',           what: 'player.c entries repo-wide' },
  // NOT a whole-database claim. The cross-check only holds for a player fetched
  // SINCE the diff shipped - a file last fetched before then has no c/x at all, so
  // gp - games gets compared against 0-0 and any real difference reads as a
  // failure. The fixture proved it: a legitimate merged/gp-0 player was reported
  // as a cross-check failure purely for predating the field. Scope is therefore
  // players with statsChecked on or after DIFF_SHIPPED; the rest are counted apart.
  // The identity is gp - games == c - x - F, with F the forfeits the player holds.
  // Omitting F reported 40,926 failures on 2026-09-07 that were not failures.
  // ⚠️ THE ARITHMETIC IDENTITY IS NOT A CLAIM AND MUST NOT BE ONE.
  //
  // It was chased three times on 2026-09-07 and over-reported every time:
  //   gp - games == c - x            40,926 "failures"
  //   ... - F  (forfeits held)       39,282
  //   ... and only where c/x are self-consistent   2,618
  //
  // The last 2,618 fail by exactly F, because THE FORFEIT TERM IS ITSELF STALE.
  // data/forfeit-games.json has grown 26,470 -> 28,372; a game added to it after a
  // player was fetched was credited at fetch time and sits in c/x as an ordinary
  // game, while a count taken today calls it a forfeit. Every term in that equation
  // is measured at a different moment from the fields it is being checked against.
  //
  // SELF-CONSISTENCY IS THE CHECK. c means "PlayHQ credits it, games[] does not
  // hold it" - so a c entry present in games[] is stale, full stop. No dates, no
  // forfeit list, no arithmetic. The identity is still computed below and printed,
  // but as an observation, not a pass/fail.
  { id: 'staleC',         expect: null,   src: 'expected drift, clears on re-fetch', what: 'c entries the player now holds' },
  { id: 'staleX',         expect: null,   src: 'expected drift, clears on re-fetch', what: 'x entries the player no longer holds' },
  { id: 'merged_gp0',     expect: 43,     src: 'measured 2026-09-07',           what: 'merged, public, checked, gp 0, with games' },
  // Was 158 as of 2026-08-23. The heal_names matrix runs since have cleared most.
  { id: 'bad_names',      expect: 18,     src: 'measured 2026-09-07',           what: 'placeholder / season-label names' },
];

// ─── The cross-check identity, derived rather than assumed ───────────────────
// gp counts distinct CREDITED games, and seenGameKeys skips forfeits at the parse
// (fetch-profile-stats.js L393). games[] is built from rosters and INCLUDES any
// forfeit that has one. x is captured-minus-credited with forfeits removed.
//
//   |credited| - |captured| = |credited\captured| - |captured\credited|
//   gp - games              = c - (x + F)
//
// where F is the forfeits the player holds. The first version of this check used
// gp - games == c - x and reported 40,926 failures on 2026-09-07, nine of every
// ten with the same shape: gp == games, c = 1, x = 0 - which is exactly one held
// forfeit. The identity was wrong, not the data.
const forfeitIds = (() => {
  try {
    const a = JSON.parse(fs.readFileSync(FORFEITS, 'utf8'));
    return new Set(Array.isArray(a) ? a : []);
  } catch (_) { return null; }   // null, not empty: absent must not read as zero
})();

function main() {
  log(`\nverify-outstanding-claims   ${new Date().toISOString()}`);
  log('─'.repeat(76));

  const R = {
    scanned: 0, unreadable: 0,
    u_entries: 0, u_players: 0,
    x_entries: 0, x_players: 0,
    c_entries: 0, c_players: 0,
    fetched: 0, withheld: 0, neverFetched: 0,
    crosscheck_ok: 0, crosscheck_fail: 0, crosscheck_examples: [], preDiff: 0,
    withForfeits: 0, forfeitsHeld: 0,
    staleC: 0, staleX: 0, stalePlayers: 0, selfConsistent: 0, stale_examples: [],
    merged_gp0: 0, merged_gp0_examples: [],
    bad_names: 0, bad_name_examples: [],
    gamesNeGp: 0,
    merged: 0,
  };

  for (const prefix of fs.readdirSync(PLAYERS_DIR).filter(d => /^[0-9a-f]{2}$/.test(d)).sort()) {
    let files;
    try { files = fs.readdirSync(path.join(PLAYERS_DIR, prefix)).filter(f => f.endsWith('.json')); }
    catch { continue; }
    for (const fname of files) {
      R.scanned++;
      if (R.scanned % 100000 === 0) log(`  scanned ${R.scanned.toLocaleString()}…`);
      let p;
      try { p = JSON.parse(fs.readFileSync(path.join(PLAYERS_DIR, prefix, fname), 'utf8')); }
      catch { R.unreadable++; continue; }

      const bk    = p.sports && p.sports.Basketball;
      const games = Array.isArray(p.games) ? p.games.length : 0;
      const spec  = Array.isArray(p.spectatorIds) ? p.spectatorIds.length : 0;
      if (spec > 1) R.merged++;

      // Names. A placeholder or a season label stored as a person's name.
      const nm = p.name;
      if (nm && (isPlaceholderName(nm) || looksLikeSeasonName(nm))) {
        R.bad_names++;
        if (R.bad_name_examples.length < 10) R.bad_name_examples.push({ uuid: fname.slice(0, 8), name: nm });
      }

      if (Array.isArray(p.u) && p.u.length) { R.u_players++; R.u_entries += p.u.length; }
      if (!bk) continue;

      if (Array.isArray(bk.x) && bk.x.length) { R.x_players++; R.x_entries += bk.x.length; }
      if (Array.isArray(bk.c) && bk.c.length) { R.c_players++; R.c_entries += bk.c.length; }

      if (!bk.statsChecked)      { R.neverFetched++; continue; }
      if (p.private === true)    { R.withheld++;     continue; }
      R.fetched++;

      // Only players fetched since the diff shipped can be cross-checked. Before
      // that date the fields did not exist, so their absence is not a fault.
      const preDiff = Date.parse(bk.statsChecked) < DIFF_SHIPPED;
      if (preDiff) R.preDiff++;

      const gp = Number(bk.gp) || 0;
      if (gp !== games) R.gamesNeGp++;

      // gp - games[] must equal c - x for any player who has been fetched and is
      // not withheld: both sides derive from the same two sets.
      // ── SELF-CONSISTENCY, which needs no arithmetic at all ──────────────────
      // c means "PlayHQ credits it, games[] does not hold it". If a c entry IS in
      // games[] now, the gap closed after the fetch and the entry is stale. x is
      // the mirror: an x entry absent from games[] means the game left.
      //
      // This is exact. The arithmetic identity is not: it needs forfeits, and it
      // needs games[] to be unchanged since the fetch, which it usually is not -
      // c/x are written at fetch time and build-player-games rebuilds games[]
      // afterwards. Chasing that with gp - games == c - x, then == c - x - F,
      // reported 40,926 then 39,282 "failures" that were mostly just snapshots
      // taken before a rebuild.
      const gset = new Set(Array.isArray(p.games) ? p.games : []);
      let sc = 0, sx = 0;
      for (const gid of (Array.isArray(bk.c) ? bk.c : [])) if (gset.has(gid))  sc++;
      for (const gid of (Array.isArray(bk.x) ? bk.x : [])) if (!gset.has(gid)) sx++;
      if (sc || sx) {
        R.stalePlayers++;
        R.staleC += sc; R.staleX += sx;
        if (R.stale_examples.length < 10) R.stale_examples.push({ uuid: fname.slice(0, 8), name: p.name || null, gp, games, c: Array.isArray(bk.c) ? bk.c.length : 0, x: Array.isArray(bk.x) ? bk.x.length : 0, sc, sx, checked: String(bk.statsChecked).slice(0, 10) });
      } else {
        R.selfConsistent++;
      }

      // Forfeits held by THIS player, counted from their own games list.
      let F = 0;
      if (forfeitIds && Array.isArray(p.games)) {
        for (const gid of p.games) if (forfeitIds.has(gid)) F++;
      }
      if (F) R.withForfeits++;
      R.forfeitsHeld += F;

      const lhs = gp - games;
      const rhs = (Array.isArray(bk.c) ? bk.c.length : 0) - (Array.isArray(bk.x) ? bk.x.length : 0) - F;
      // The arithmetic identity is only meaningful where c/x are not stale.
      if (preDiff || sc || sx) { /* out of scope */ }
      else if (lhs === rhs) R.crosscheck_ok++;
      else {
        R.crosscheck_fail++;
        if (R.crosscheck_examples.length < 10) {
          R.crosscheck_examples.push({ uuid: fname.slice(0, 8), name: p.name || null, gp, games, c: Array.isArray(bk.c) ? bk.c.length : 0, x: Array.isArray(bk.x) ? bk.x.length : 0, F });
        }
      }

      // Merged, PlayHQ answered, and it credited nothing - while we hold real
      // captured games. Never a repair target; counted because nobody has looked.
      if (spec > 1 && gp === 0 && games > 0) {
        R.merged_gp0++;
        if (R.merged_gp0_examples.length < 10) {
          R.merged_gp0_examples.push({ uuid: fname.slice(0, 8), name: p.name || null, games, statsChecked: String(bk.statsChecked).slice(0, 10) });
        }
      }
    }
  }

  // ─── The misroute report, if one is on disk ────────────────────────────────
  let mis = null;
  try {
    const j = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
    mis = {
      generatedAt: j.generatedAt || null,
      misrouted: j.misrouted, genuineGap: j.genuineGap,
      gapInBox: j.gapInBox, gapOutBox: j.gapOutBox, gapNoBox: j.gapNoBox,
      heldBack: (j.heldBack || []).length, partials: (j.partials || []).length,
      suspect: (j.suspectAliases || []).length,
    };
  } catch (_) { /* absent is fine, it is a report not a source of truth */ }

  const got = {
    u_entries: R.u_entries, u_players: R.u_players,
    x_entries: R.x_entries, c_entries: R.c_entries,
    staleC: R.staleC, staleX: R.staleX,
    merged_gp0: R.merged_gp0,
    bad_names: R.bad_names,
  };

  if (JSON_OUT) { console.log(JSON.stringify({ measuredAt: new Date().toISOString(), ...R, misrouteReport: mis }, null, 2)); return; }

  console.log(`\n  player files scanned : ${R.scanned.toLocaleString()}  (${R.unreadable} unreadable)`);
  console.log(`    fetched and public : ${R.fetched.toLocaleString()}`);
  console.log(`    withheld (private) : ${R.withheld.toLocaleString()}`);
  console.log(`    never fetched      : ${R.neverFetched.toLocaleString()}`);
  console.log(`    merged (spectatorIds > 1) : ${R.merged.toLocaleString()}`);

  console.log('\n  ── CLAIMS ──');
  console.log('  ' + 'claim'.padEnd(44) + 'documented'.padStart(12) + 'measured'.padStart(12) + '   verdict');
  for (const c of CLAIMS) {
    const v = got[c.id];
    const shown = (v === undefined || v === null) ? '—' : v.toLocaleString();
    let verdict;
    if (c.expect === null)      verdict = 'no figure documented';
    else if (v === c.expect)    verdict = 'MATCHES';
    else {
      const d = v - c.expect;
      const pctv = c.expect ? ` (${d > 0 ? '+' : ''}${((d / c.expect) * 100).toFixed(1)}%)` : '';
      verdict = `DRIFT ${d > 0 ? '+' : ''}${d.toLocaleString()}${pctv}`;
    }
    console.log('  ' + c.what.padEnd(44) + String(c.expect === null ? '—' : c.expect.toLocaleString()).padStart(12) + shown.padStart(12) + '   ' + verdict);
    console.log('  ' + ' '.repeat(44) + `source: ${c.src}`);
  }

  console.log('\n  ── DERIVED, no documented figure ──');
  console.log(`    players carrying x : ${R.x_players.toLocaleString()}`);
  console.log(`    players carrying c : ${R.c_players.toLocaleString()}`);
  console.log(`    arithmetic identity holds for : ${R.crosscheck_ok.toLocaleString()} of ${(R.crosscheck_ok + R.crosscheck_fail).toLocaleString()} self-consistent, post-diff players`);
  console.log('      OBSERVATION ONLY. Every term is measured at a different moment from the');
  console.log('      fields it checks - the forfeit list alone grew 26,470 -> 28,372. Use the');
  console.log('      self-consistency figures above it, not this.');
  console.log(`    (unused) cross-check passes : ${R.crosscheck_ok.toLocaleString()}  (${R.crosscheck_ok + R.crosscheck_fail > 0 ? ((R.crosscheck_ok / (R.crosscheck_ok + R.crosscheck_fail)) * 100).toFixed(2) : '—'}%)`);
  console.log(`    games !== gp       : ${R.gamesNeGp.toLocaleString()} of ${R.fetched.toLocaleString()} fetched-and-public`);
  console.log(`\n  ── ARE c AND x STILL TRUE OF THIS PLAYER'S games[]? ──`);
  console.log(`    self-consistent  : ${R.selfConsistent.toLocaleString()}`);
  console.log(`    stale            : ${R.stalePlayers.toLocaleString()}  (${R.staleC.toLocaleString()} c entries the player now HOLDS, ${R.staleX.toLocaleString()} x entries they no longer hold)`);
  console.log('      c and x are written at fetch time. build-player-games rebuilds games[]');
  console.log('      afterwards, so a c entry whose game has since been captured is expected');
  console.log('      drift, not corruption. It clears when that player is next fetched.');
  console.log(`\n    players holding a forfeit game  : ${R.withForfeits.toLocaleString()}  (${R.forfeitsHeld.toLocaleString()} forfeits held in total)`);
  if (!forfeitIds) console.log('      \u26a0 data/forfeit-games.json unreadable - F is 0 for everyone and the cross-check will over-report.');
  console.log(`    fetched BEFORE the diff shipped : ${R.preDiff.toLocaleString()}  (no c/x by design, out of cross-check scope)`);
  if (R.preDiff > 0) console.log('      \u2192 a forced re-fetch is what brings these into scope.');

  if (R.stale_examples.length) {
    console.log('\n  stale c/x — the fetch predates a games[] rebuild:');
    for (const e of R.stale_examples) {
      console.log(`    ${e.uuid}  gp=${e.gp} games=${e.games} c=${e.c} x=${e.x}  ${e.sc} c-entries now held, ${e.sx} x-entries now absent  fetched ${e.checked}  ${(e.name || '').slice(0, 20)}`);
    }
  }
  if (R.crosscheck_examples.length) {
    console.log('\n  arithmetic mismatches (observation only — most differ by exactly the forfeit count):');
    for (const e of R.crosscheck_examples) {
      console.log(`    ${e.uuid}  gp=${e.gp} games=${e.games} c=${e.c} x=${e.x} forfeits=${e.F}  gp-games=${e.gp - e.games} but c-x-F=${e.c - e.x - e.F}  ${(e.name || '').slice(0, 22)}`);
    }
  }
  if (R.merged_gp0_examples.length) {
    console.log('\n  merged, public, checked, gp 0 — PlayHQ answered and credited nothing:');
    for (const e of R.merged_gp0_examples) console.log(`    ${e.uuid}  ${String(e.games).padStart(4)} games  checked ${e.statsChecked}  ${(e.name || '').slice(0, 26)}`);
  }
  if (R.bad_name_examples.length) {
    console.log('\n  names that are a placeholder or a season label:');
    for (const e of R.bad_name_examples) console.log(`    ${e.uuid}  ${e.name}`);
  }

  if (mis) {
    console.log(`\n  ── reports/misrouted-appearances.json (${String(mis.generatedAt).slice(0, 19)}) ──`);
    console.log(`    misrouted ${Number(mis.misrouted || 0).toLocaleString()} | genuine gap ${Number(mis.genuineGap || 0).toLocaleString()}`);
    const dec = (mis.gapInBox || 0) + (mis.gapOutBox || 0);
    console.log(`    of the gaps: ${Number(mis.gapInBox || 0).toLocaleString()} in PlayHQ's own box score${dec ? ` (${((mis.gapInBox / dec) * 100).toFixed(1)}% of decidable)` : ''}, ${Number(mis.gapOutBox || 0).toLocaleString()} no box row, ${Number(mis.gapNoBox || 0).toLocaleString()} undecidable`);
    console.log(`    aliases: ${mis.suspect} to repoint, ${mis.heldBack} held back | ${mis.partials} partial claimants`);
    console.log('    NOTE: a report reflects the state when it was written, not now. Re-run');
    console.log('    find-misrouted-appearances in report-only mode to refresh it.');
  } else {
    console.log('\n  reports/misrouted-appearances.json not present — misroute figures unavailable.');
  }

  console.log('\n  ── NOT MEASURABLE FROM FILES ──');
  console.log('    The 62,753 x entries with no stored box score. Whether PlayHQ holds the player');
  console.log('    for those games needs the box scores fetched through the Worker.');
  console.log('    Whether leaderboards reflect the corrected win/loss records. Compare a rebuilt');
  console.log('    leaderboard against the live one; nothing on disk records when it last ran.');
  console.log('');
}

main();
