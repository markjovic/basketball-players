#!/usr/bin/env node
// scripts/top-stats.js
//
// READ-ONLY report of records across every stored season: biggest winning
// margin, most points and most goals in a single quarter, most goals by a player
// in a season, most goals by a player across all seasons. Prints tables to the
// log; writes nothing, calls nothing.
//
// What the data can and cannot answer (measured 2026-09-09 against the stored
// shapes): match records carry team scores (hScore/aScore, hG/hB, aG/aB) and
// per-quarter points hQ/aQ with goals-and-behinds hQGB/aQGB — so team records
// are exact. Player records in <season>-players.json are SEASON TOTALS per
// person per age group (gp, goals); no per-game player line is stored there.
//
// SECTION 6 CHANGED ON 2026-09-11. It used to say "most goals by a player in one
// game" was not answerable. Since the career sweep of 10 September every walked
// player carries records.goalsHeld and records.goalsAny in
// players/<xx>/<uuid>.json — the best single game we store and the best anywhere
// — so it now reads them. career_stats_design.md revision 4.
//
// ⚠️ THE OTHER FOUR SECTIONS ARE NOT SUPERSEDED BY THE LEADERBOARDS. Sections 1
// to 3 are team and quarter records and sections 4 and 5 are scoped to OUR
// stored seasons, which is a different question from a PlayHQ career.
//
// A quarter array may hold nulls (a partial breakdown is kept, not discarded);
// null quarters are skipped, never treated as zero. Scheduled records and byes
// are excluded from everything.
//
// Env: TOP (rows per table, default 10). COMP ("EFNL 2026") restricts to one
// competition; AGE ("U12") restricts to one age group — both optional.

'use strict';

const fs = require('fs');
const path = require('path');
const store = require('./lib/store');

const VERSION = 'top-stats v4 2026-09-11 single-game-from-careers';
const TOP = Math.max(1, Math.min(100, Number(process.env.TOP || 10)));
const COMP = (process.env.COMP || '').trim();
const AGE = (process.env.AGE || '').trim();

const log = (...a) => console.log(...a);
const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const rpad = (s, n) => String(s ?? '').padStart(n);

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function main() {
  log(`=== ${VERSION} ===`);
  log('READ-ONLY — no writes, no PlayHQ calls.');
  if (COMP) log(`filter: competition "${COMP}"`);
  if (AGE) log(`filter: age "${AGE}"`);

  const core = readJson(store.CORE_PATH);
  const manifest = (core.manifest || []).filter(m => m.seasonId && m.compName);
  const files = fs.readdirSync(store.SEASONS_DIR);

  // ── Load ───────────────────────────────────────────────────────────────────
  const matches = [];
  const playerRows = [];      // { uuid, name, compName, team, age, goals, gp }
  let seasonsRead = 0;
  for (const m of manifest) {
    if (COMP && m.compName !== COMP) continue;
    const coreFile = `${m.seasonId}-core.json`;
    const playersFile = `${m.seasonId}-players.json`;
    if (files.includes(coreFile)) {
      seasonsRead++;
      for (const x of readJson(path.join(store.SEASONS_DIR, coreFile)).matches || []) {
        if (x.scheduled || x.isBye || x.hScore == null || x.aScore == null) continue;
        if (AGE && x.age !== AGE) continue;
        matches.push(x);
      }
    }
    if (files.includes(playersFile)) {
      for (const p of readJson(path.join(store.SEASONS_DIR, playersFile)).players || []) {
        if (!p.uuid) continue;
        if (AGE && p.age !== AGE) continue;
        playerRows.push({ uuid: p.uuid, name: p.name, compName: p.compName || m.compName, team: p.team, age: p.age,
          grade: p.rawGrade || '', goals: Number(p.goals) || 0, gp: Number(p.gp) || 0 });
      }
    }
  }
  log(`seasons read: ${seasonsRead}; matches with a result: ${matches.length}; player-season rows: ${playerRows.length}\n`);
  if (!matches.length && !playerRows.length) { log('Nothing matched the filters.'); process.exit(2); }

  const where = (x) => `${x.compName} · ${x.age} ${x.rawGrade || ''} · R${x.round} · ${x.date || ''}`;

  // ── 1. Biggest winning margin ─────────────────────────────────────────────
  log(`1  BIGGEST WINNING MARGIN (top ${TOP})`);
  log('─'.repeat(110));
  const margins = matches.map(x => {
    const diff = x.hScore - x.aScore;
    const win = diff >= 0 ? x.home : x.away, lose = diff >= 0 ? x.away : x.home;
    const ws = Math.max(x.hScore, x.aScore), ls = Math.min(x.hScore, x.aScore);
    const wg = diff >= 0 ? x.hG : x.aG, wb = diff >= 0 ? x.hB : x.aB;
    return { margin: Math.abs(diff), win, lose, ws, ls, wg, wb, x };
  }).sort((a, b) => b.margin - a.margin).slice(0, TOP);
  for (const r of margins) {
    log(`  ${rpad(r.margin, 4)}  ${pad(r.win, 28)} ${rpad(r.ws, 3)}${r.wg != null ? ` (${r.wg}.${r.wb})` : ''}  def  ${pad(r.lose, 28)} ${rpad(r.ls, 3)}   ${where(r.x)}`);
  }

  // ── 2 & 3. Most points / most goals in a quarter ───────────────────────────
  // A team whose whole game was entered in one quarter — [0,0,0,205] — is a data
  // entry habit, not a record. Measured 2026-09-09 on EFNL 2026: 261 team-quarter
  // arrays hold the full score in a single quarter, most of them honestly (a team
  // that kicked 1.0 scored its six points in one quarter). The dishonest ones are
  // the big totals with three RECORDED zeros around them; those are set aside and
  // counted, not ranked.
  const WHOLE_GAME_MIN = 40;
  const quarters = [];
  let setAside = 0;
  for (const x of matches) {
    for (const side of ['h', 'a']) {
      const q = x[`${side}Q`];
      if (!Array.isArray(q)) continue;
      const total = x[`${side}Score`];
      // Whole game in one quarter, whether the other three are recorded zeros
      // ([0,0,0,205]) or absent ([null,null,null,216] — Mount Eliza SEJ 2022 R2,
      // the first full run's "record"). Either way one quarter holds the total.
      const nonZero = q.filter(v => v != null && v !== 0);
      const wholeGameInOne = total >= WHOLE_GAME_MIN && nonZero.length === 1 && nonZero[0] === total;
      // Quarters that cannot be true: one bigger than the final score, or four that
      // do not add up to it. Measured 2026-09-09: Bulleen Templestowe R5 stored
      // [null,null,null,205] against a full-time 181.
      const known = q.filter(v => v != null);
      const inconsistent = known.some(v => v > total) || (known.length === q.length && known.reduce((a, b) => a + b, 0) !== total);
      if (wholeGameInOne || inconsistent) { setAside++; continue; }
      const gb = x[`${side}QGB`];
      for (let i = 0; i < q.length; i++) {
        if (q[i] == null) continue;                       // partial breakdown: skip, never zero
        const g = Array.isArray(gb) && Array.isArray(gb[i]) ? gb[i][0] : null;
        const b = Array.isArray(gb) && Array.isArray(gb[i]) ? gb[i][1] : null;
        quarters.push({ pts: q[i], g, b, qn: i + 1, team: side === 'h' ? x.home : x.away, opp: side === 'h' ? x.away : x.home, x });
      }
    }
  }
  const withQ = matches.filter(x => Array.isArray(x.hQ) || Array.isArray(x.aQ)).length;
  log(`\n2  MOST POINTS IN A QUARTER (top ${TOP}) — from ${withQ} of ${matches.length} matches that carry a quarter breakdown` +
      (setAside ? `; ${setAside} team-quarter set(s) set aside — whole game in one quarter, a quarter above the final score, or four quarters that do not add up` : ''));
  log('─'.repeat(110));
  for (const r of quarters.slice().sort((a, b) => b.pts - a.pts).slice(0, TOP)) {
    log(`  ${rpad(r.pts, 4)}${r.g != null ? ` (${r.g}.${r.b})` : '      '}  Q${r.qn}  ${pad(r.team, 28)} v ${pad(r.opp, 28)}   ${where(r.x)}`);
  }
  const withGB = quarters.filter(r => r.g != null);
  log(`\n3  MOST GOALS IN A QUARTER (top ${TOP}) — from ${withGB.length} quarters that carry goals and behinds`);
  log('─'.repeat(110));
  for (const r of withGB.sort((a, b) => b.g - a.g || b.pts - a.pts).slice(0, TOP)) {
    log(`  ${rpad(r.g, 3)} goals (${r.pts} pts)  Q${r.qn}  ${pad(r.team, 28)} v ${pad(r.opp, 28)}   ${where(r.x)}`);
  }

  // ── 4. Most goals by a player in a season ──────────────────────────────────
  // Rows are per person per age group with disjoint appearances (measured: 1,100
  // people with two rows in WFNL 2026, zero overlapping grades), so a season
  // total is the sum of a person's rows in that season.
  const bySeason = new Map();
  for (const r of playerRows) {
    const k = `${r.uuid}|${r.compName}`;
    const cur = bySeason.get(k) || { uuid: r.uuid, name: r.name, compName: r.compName, teams: new Set(), ages: new Set(), where: [], goals: 0, gp: 0 };
    cur.goals += r.goals; cur.gp += r.gp; cur.teams.add(r.team); cur.ages.add(r.age);
    // One "age grade (team) goals" per row, so a person who turned out in two
    // grades in one season shows both and can be looked up in either.
    const grade = r.grade && r.grade !== r.age ? ' ' + r.grade : '';   // seniors repeat the age as the grade
    cur.where.push(`${r.age}${grade} (${r.team}) ${r.goals}`);
    bySeason.set(k, cur);
  }
  log(`\n4  MOST GOALS BY A PLAYER IN ONE SEASON (top ${TOP})`);
  log('─'.repeat(110));
  for (const r of [...bySeason.values()].sort((a, b) => b.goals - a.goals).slice(0, TOP)) {
    log(`  ${rpad(r.goals, 4)}  ${pad(r.name, 26)} ${r.compName}  ${r.gp} games, ${(r.goals / Math.max(1, r.gp)).toFixed(1)}/game  —  ${r.where.join('; ')}`);
  }

  // ── 5. Most goals by a player, all seasons ─────────────────────────────────
  const career = new Map();
  for (const r of bySeason.values()) {
    const cur = career.get(r.uuid) || { uuid: r.uuid, name: r.name, goals: 0, gp: 0, seasons: [] };
    cur.goals += r.goals; cur.gp += r.gp; cur.seasons.push(`${r.compName} ${r.where.join('; ')}`);
    career.set(r.uuid, cur);
  }
  log(`\n5  MOST GOALS BY A PLAYER ACROSS ALL STORED SEASONS (top ${TOP})`);
  log('─'.repeat(110));
  for (const r of [...career.values()].sort((a, b) => b.goals - a.goals).slice(0, TOP)) {
    // Sort by the year at the end of the competition name, so two competitions in
    // one year sit together and the list reads chronologically.
    const yearOf = (l) => (l.match(/\b(\d{4})\b/) || ['', ''])[1];
    const bySeasonYear = (a, b) => yearOf(a).localeCompare(yearOf(b)) || a.localeCompare(b);
    log(`  ${rpad(r.goals, 4)}  ${pad(r.name, 26)} ${r.gp} games over ${r.seasons.length} season(s)`);
    for (const line of r.seasons.sort(bySeasonYear)) log(`          ${line}`);
  }

  // ── 6. Most goals by a player in one game ──────────────────────────────────
  // From the career store, not from the season files. fetch-career-stats.js
  // computes the record per player as it walks, deduplicating by game.id, and
  // keeps {v, gameId, sid}. Reading ~70,000 small files is a few seconds.
  //
  // ⚠️ COMP AND AGE CANNOT FILTER THIS. The record carries a season id and a game
  // id, not an age group, so a filtered run says so rather than silently
  // reporting an unfiltered board — a number that ignores the filter it was asked
  // for is worse than no number.
  log(`\n6  MOST GOALS BY A PLAYER IN ONE GAME (top ${TOP})`);
  log('─'.repeat(110));
  const PLAYERS_DIR = path.join(__dirname, '..', 'players');
  if (!fs.existsSync(PLAYERS_DIR)) {
    log('  The career store does not exist yet. Dispatch Build career stubs and a career sweep.');
  } else if (AGE) {
    log(`  NOT SHOWN: a single-game record carries no age group, so the AGE="${AGE}" filter`);
    log('  cannot be applied. Run without AGE to see it.');
  } else {
    // sid -> compName, so a record can say where it happened. Only OUR seasons
    // have one; a record set in a league we do not store keeps its season id.
    const compOfSid = new Map(manifest.map(m => [m.seasonId, m.compName]));
    const heldGames = new Map();
    for (const m of manifest) {
      const f = path.join(store.SEASONS_DIR, `${m.seasonId}-core.json`);
      if (!files.includes(`${m.seasonId}-core.json`)) continue;
      for (const x of readJson(f).matches || []) {
        if (x.gameId && !x.isBye && !x.scheduled) heldGames.set(x.gameId, x);
      }
    }
    const rows = [];
    let read = 0, noRecord = 0;
    for (const shard of fs.readdirSync(PLAYERS_DIR).sort()) {
      const dir = path.join(PLAYERS_DIR, shard);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.json')) continue;
        read++;
        let p;
        try { p = readJson(path.join(dir, name)); } catch (e) { continue; }
        const rec = (p.records && (p.records.goalsAny || p.records.goalsHeld)) || null;
        if (!rec || !rec.v) { noRecord++; continue; }
        const comp = compOfSid.get(rec.sid) || null;
        if (COMP && comp !== COMP) continue;
        rows.push({ name: p.name, v: rec.v, comp, game: heldGames.get(rec.gameId) || null, sid: rec.sid });
      }
    }
    log(`  from ${read} career file(s); ${noRecord} carry no single-game record`);
    if (COMP) log(`  restricted to "${COMP}" — records set outside it are excluded`);
    for (const r of rows.sort((a, b) => b.v - a.v).slice(0, TOP)) {
      const g = r.game;
      const where = g ? `${r.comp} · R${g.round}${g.isFinals ? ' (finals)' : ''} · ${g.home} v ${g.away}` +
                        (g.hScore != null ? ` ${g.hScore}-${g.aScore}` : '')
                      : `${r.comp || 'a season we do not store'} (game not held)`;
      log(`  ${rpad(r.v, 4)}  ${pad(r.name, 26)} ${where}`);
    }
    // ⚠️ Per-game lines begin at each league's own adoption date — EFNL 2024,
    // others 2022 — so this is not all-time however it is labelled.
    log('  Single-game records only exist from each league\u2019s own adoption date:');
    log('  EFNL from 2024, other leagues from 2022. Season totals go back much further.');
  }

  log(`\n=== ${VERSION} complete — nothing was changed ===`);
}

main();
