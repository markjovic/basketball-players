// scripts/audit-nonfinal-games.js
// REVISION 2026-09-10b — instruments the ask phase; 10a reported a conclusion from
// zero questions.
//
// READ-ONLY. Counts every game that has not reached a terminal state, splits them by
// whether their season is locked, and then asks PlayHQ what it says about the worst
// locked ones today.
//
// WRITES NOTHING. No fs.writeFileSync, no git, no commit. Safe to run twice.
//
// WHY THIS EXISTS
// ───────────────
// db-audit.js was fixed on 2026-09-09 to count every game status; before that, five
// of them were excluded from every counter and roughly 64,000 games were tallied
// nowhere. The first corrected run surfaced this:
//
//   LIVE          47,807
//   PENDING       14,722
//   PRE_GAME       1,269
//   IN_PROGRESS       515
//   ──────────────────────
//   not yet final 64,313   of 2,425,863 games
//
// LIVE was the third-largest status in the database and had never been displayed.
//
// AND IT MATTERS NOW BECAUSE OF THE LOCKING. lock-quiet-seasons.js closed 307 seasons
// on 2026-09-09 and locked seasons are skipped by the nightly, so any non-final game
// inside one is frozen in that state permanently. Nobody has checked whether the
// 47,807 sit in locked seasons or active ones.
//
// LIVE IS NOT PENDING, AND THE DIFFERENCE IS THE WHOLE POINT.
// audit-pending-games-vs-playhq.js established that PENDING games are never coming
// back — 685 asked, 0 finished at PlayHQ, across seasons ending 2020 to 2025. Those
// competitions were run and never scored. LIVE is the opposite claim: PlayHQ WAS
// scoring the game at the moment we read it. A finished season full of LIVE games is
// far more likely to be a capture gap than a dead competition, so the same answer
// must not be assumed.
//
// TWO PHASES IN ONE RUN
// ─────────────────────
//   1. COUNT — every file in games/bv, every status, split locked vs unlocked. No
//      network. This alone answers "is the locking freezing anything".
//   2. ASK — for the worst LOCKED seasons, the nightly's own gradeRounds ->
//      discoverFixtureByRound pair, comparing what we hold against what PlayHQ says
//      now. Skipped with --count-only.
//
// Three outcomes, never collapsed: still non-final at PlayHQ; FINISHED at PlayHQ and
// we missed it; and no answer, which is not a finding either way.
//
// FULL CHECKOUT, NOT SPARSE. It reads every file in games/bv — 1.94 GB across 2,966
// files. Sparse checkout fetches roughly one blob per second, so naming them is worse
// than cloning. A full checkout takes about seven minutes on a runner.
//
// Queries and headers are copied from audit-pending-games-vs-playhq.js, which took
// them verbatim from nightly-crawl.js. The pacing is copied from
// close-empty-seasons.js — a fixed sleep with no retry got that script walled after
// five seasons on 2026-09-08 (T52).
//
// Run:
//   node scripts/audit-nonfinal-games.js --count-only
//   node scripts/audit-nonfinal-games.js
//   node scripts/audit-nonfinal-games.js --max-seasons=12 --max-grades=6

'use strict';

const fs     = require('fs');
const path   = require('path');
const https  = require('https');
const crypto = require('crypto');

const ROOT       = path.join(__dirname, '..');
const INDEX_FILE = path.join(ROOT, 'data', 'sports-index.json');
const GAMES_DIR  = path.join(ROOT, 'games', 'bv');
const API_URL    = 'https://api.playhq.com/graphql';

const args   = process.argv.slice(2);
const argVal = (n, d) => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const COUNT_ONLY  = args.includes('--count-only');
const MAX_SEASONS = Math.max(1, parseInt(argVal('max-seasons', '8'), 10) || 8);
const MAX_GRADES  = Math.max(1, parseInt(argVal('max-grades', '4'), 10) || 4);
const ONLY_STATUS = argVal('status', '').trim();

const log   = (m) => console.log(`[nonfinal] ${new Date().toISOString()} ${m}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Allowlist, never a test for a specific non-terminal value. Real data uses statuses
// no one anticipated, and testing for `st === 'UPCOMING'` once counted zero unplayed
// games in a season holding three (T53).
const TERMINAL = new Set(['FINAL', 'CANCELLED', 'ABANDONED', 'FORFEIT']);

// ─── Request machinery: copied from audit-pending-games-vs-playhq.js, which took
//     it verbatim from nightly-crawl.js. ────────────────────────────────────────
function doFetch(url, bodyObj, headers) {
  return new Promise((resolve, reject) => {
    const body   = JSON.stringify(bodyObj);
    const parsed = new URL(url);
    const h      = { ...headers, 'request-id': crypto.randomUUID(), 'content-length': Buffer.byteLength(body) };
    const req = https.request(
      { hostname: parsed.hostname, path: parsed.pathname, method: 'POST', headers: h, agent: new https.Agent({ keepAlive: false }) },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const rawText = Buffer.concat(chunks).toString('utf8');
          let body = null;
          try { body = JSON.parse(rawText); } catch (_) { body = null; }
          resolve({ status: res.statusCode, rawCookies: res.headers['set-cookie'], body, rawText });
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const HEADERS_MAIN = {
  'accept': '*/*', 'origin': 'https://www.playhq.com',
  'user-agent': 'PlayHQ/1.47.2 Android/28 (Android SDK built for x86)',
  'tenant': 'basketball-victoria', 'content-type': 'application/json',
};

let sessionCookie = null;

async function refreshSession() {
  const body = { operationName: 'TenantConfig', variables: {}, query: 'query TenantConfig { tenantConfiguration { label } }' };
  for (let attempt = 1; attempt <= 10; attempt++) {
    if (attempt > 1) await sleep(attempt * 3000);
    try {
      const { rawCookies } = await doFetch(API_URL, body, HEADERS_MAIN);
      if (!rawCookies) continue;
      const arr = (Array.isArray(rawCookies) ? rawCookies : [rawCookies]).map(c => c.split(';')[0].trim());
      const get = n => arr.find(p => p.startsWith(n + '=')) || null;
      const tier = get('phq_tier'), session = get('phq_session'), sub = get('phq_sub');
      if (tier && session && sub) { sessionCookie = `${tier}; ${session}; ${sub}`; console.log(`  Session refreshed (attempt ${attempt})`); return; }
    } catch (_) {}
  }
  throw new Error('Failed to obtain session after 10 attempts');
}

async function gqlMain(operationName, query, variables) {
  if (!sessionCookie) await refreshSession();
  for (let attempt = 1; attempt <= 2; attempt++) {
    let status, body, rawText;
    try {
      ({ status, body, rawText } = await doFetch(API_URL, { operationName, variables, query }, { ...HEADERS_MAIN, 'Cookie': sessionCookie }));
    } catch (_) {
      if (attempt < 2) { await sleep(1000); continue; }
      return { kind: 'transient', data: null };
    }
    if (status === 403) {
      const isWaf = rawText && (rawText.includes('DOCTYPE') || rawText.includes('Request blocked'));
      if (isWaf) return { kind: 'blocked', data: null };
      await refreshSession();
      continue;
    }
    if (status === 429 || status === 503) return { kind: 'transient', data: null };
    if (status !== 200) { if (attempt < 2) { await sleep(1000); continue; } return { kind: 'transient', data: null }; }
    if (body && body.errors) return { kind: 'transient', data: null };
    return { kind: 'ok', data: (body && body.data) || null };
  }
  return { kind: 'transient', data: null };
}

// ─── Pacing: copied from close-empty-seasons.js. A fixed sleep with no retry got
//     that script walled after five seasons on 2026-09-08 (T52). ───────────────
const PACE_MIN_MS = 150, PACE_MAX_MS = 4000;
const BLOCK_RETRIES = 6, BLOCK_BACKOFF_MS = 5000, BLOCK_BACKOFF_CAP_MS = 60000;
let paceMs = PACE_MIN_MS, consecutiveBlocks = 0, cleanRun = 0, totalBlocks = 0;

async function gqlPaced(operationName, query, variables) {
  for (let attempt = 1; attempt <= BLOCK_RETRIES; attempt++) {
    const r = await gqlMain(operationName, query, variables);
    if (r.kind !== 'blocked') {
      consecutiveBlocks = 0;
      if (++cleanRun >= 25 && paceMs > PACE_MIN_MS) { paceMs = Math.max(PACE_MIN_MS, Math.floor(paceMs * 0.75)); cleanRun = 0; }
      await sleep(paceMs);
      return r;
    }
    totalBlocks++; consecutiveBlocks++; cleanRun = 0;
    if (consecutiveBlocks >= 2) paceMs = Math.min(PACE_MAX_MS, Math.max(PACE_MIN_MS * 2, paceMs * 2));
    if (attempt < BLOCK_RETRIES) {
      const backoff = Math.min(BLOCK_BACKOFF_CAP_MS, attempt * BLOCK_BACKOFF_MS);
      console.log(`    ⚠ blocked (${operationName}) — retry ${attempt}/${BLOCK_RETRIES - 1} in ${backoff / 1000}s, pace now ${paceMs}ms`);
      await sleep(backoff);
    }
  }
  return { kind: 'blocked', data: null };
}

// ─── Queries: verbatim from nightly-crawl.js ────────────────────────────────
const Q_GRADE_ROUNDS = `query gradeRounds($gradeID: ID!) {
  discoverGrade(gradeID: $gradeID) {
    id name hideScores
    rounds { id name abbreviatedName current number isFinalsRound }
    season { id competition { id organisation { id name } } }
  }
}`;

const Q_FIXTURE_BY_ROUND = `query discoverFixtureByRound($roundID: ID!) {
  discoverFixtureByRound(roundID: $roundID) {
    games {
      id date __typename
      status { value }
      result {
        outcome { name value }
        home { outcome { name value } statistics { count type { value } } }
        away { outcome { name value } statistics { count type { value } } }
      }
    }
  }
}`;

async function main() {
  log(`audit-nonfinal-games  READ-ONLY${COUNT_ONLY ? '  (COUNT ONLY — no API calls)' : ''}${ONLY_STATUS ? `  status=${ONLY_STATUS}` : ''}`);
  console.log('─'.repeat(92));

  const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  const meta  = index.seasons || {};

  // ── Phase 1: count ────────────────────────────────────────────────────────
  const files = fs.readdirSync(GAMES_DIR).filter(f => f.endsWith('.json'));
  let totalGames = 0, filesRead = 0, noMeta = 0;
  const byStatus = new Map();                 // status -> { locked, unlocked, unknown }
  const perSeason = [];                       // { sid, locked, nonFinal, total, statuses }

  for (const fname of files) {
    const sid = fname.replace('.json', '');
    let gf;
    try { gf = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, fname), 'utf8')); } catch { continue; }
    filesRead++;
    const games = Object.values(gf.games || {});
    totalGames += games.length;

    const s = meta[sid];
    const bucket = !s ? 'unknown' : (s.locked === true ? 'locked' : 'unlocked');
    if (!s) noMeta++;

    let nonFinal = 0;
    const statuses = {};
    for (const g of games) {
      const st = g.st === undefined ? '(absent)' : String(g.st);
      if (!byStatus.has(st)) byStatus.set(st, { locked: 0, unlocked: 0, unknown: 0 });
      byStatus.get(st)[bucket]++;
      if (TERMINAL.has(st)) continue;
      if (ONLY_STATUS && st !== ONLY_STATUS) continue;
      nonFinal++;
      statuses[st] = (statuses[st] || 0) + 1;
    }
    if (nonFinal) perSeason.push({ sid, locked: bucket === 'locked', unknown: bucket === 'unknown', nonFinal, total: games.length, statuses, s });
  }

  console.log(`  games files read      : ${filesRead} of ${files.length}`);
  console.log(`  games                 : ${totalGames}`);
  if (noMeta) console.log(`  ⚠ games files with NO season in the index : ${noMeta}`);

  console.log(`\n─── EVERY STATUS, SPLIT BY WHETHER ITS SEASON IS LOCKED ────────────────────────`);
  console.log(`    ${'status'.padEnd(14)} ${'locked'.padStart(10)} ${'unlocked'.padStart(10)} ${'no season'.padStart(10)} ${'total'.padStart(11)}`);
  const rows = [...byStatus].sort((a, b) => (b[1].locked + b[1].unlocked + b[1].unknown) - (a[1].locked + a[1].unlocked + a[1].unknown));
  let frozen = 0, recoverable = 0;
  for (const [st, c] of rows) {
    const t = c.locked + c.unlocked + c.unknown;
    const flag = TERMINAL.has(st) ? '' : (c.locked ? '   ← FROZEN: the nightly will never revisit these' : '   (still crawled)');
    console.log(`    ${st.padEnd(14)} ${String(c.locked).padStart(10)} ${String(c.unlocked).padStart(10)} ${String(c.unknown).padStart(10)} ${String(t).padStart(11)}${flag}`);
    if (!TERMINAL.has(st)) { frozen += c.locked; recoverable += c.unlocked + c.unknown; }
  }

  console.log(`\n${'═'.repeat(92)}`);
  console.log(`  non-final in LOCKED seasons   : ${frozen}   ← frozen; only unlocking or a targeted fetch reaches them`);
  console.log(`  non-final in unlocked seasons : ${recoverable}   ← tonight's nightly still covers these`);
  console.log(`${'═'.repeat(92)}`);

  const lockedSeasons = perSeason.filter(x => x.locked).sort((a, b) => b.nonFinal - a.nonFinal);
  console.log(`\n─── WORST LOCKED SEASONS ───────────────────────────────────────────────────────`);
  if (!lockedSeasons.length) console.log('    (none — nothing is frozen)');
  for (const x of lockedSeasons.slice(0, 25)) {
    const st = Object.entries(x.statuses).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`    ${x.sid}  ${String(x.nonFinal).padStart(6)}/${String(x.total).padEnd(6)} non-final  ended ${String(x.s?.endDate || '?').padEnd(10)}  ${st.slice(0, 30).padEnd(30)}  ${(x.s?.fullName || '').slice(0, 34)}`);
  }
  if (lockedSeasons.length > 25) console.log(`    … and ${lockedSeasons.length - 25} more`);

  if (COUNT_ONLY || !lockedSeasons.length) {
    if (COUNT_ONLY) log('count only — PlayHQ was not asked. Drop --count-only to check the worst locked seasons.');
    else log('nothing frozen — nothing to ask PlayHQ about.');
    return;
  }

  // ── Phase 2: ask PlayHQ about the worst locked seasons ────────────────────
  const queue = lockedSeasons.slice(0, MAX_SEASONS);
  console.log(`\n─── ASKING PLAYHQ ABOUT THE ${queue.length} WORST LOCKED SEASON(S) ─────────────────────────`);
  console.log(`    grades capped at ${MAX_GRADES} per season; a season whose grades are not ALL queried`);
  console.log(`    reports coverage instead of a count, because a game in a grade we never asked`);
  console.log(`    about is not a game PlayHQ has left non-final.`);
  await refreshSession();

  let stillNonFinal = 0, nowFinished = 0, noAnswer = 0, partialCoverage = 0, unanswered = 0;
  const examples = [];

  for (const x of queue) {
    const gradesTotal = (x.s?.grades || []).length;
    const grades = (x.s?.grades || []).slice(0, MAX_GRADES);
    if (!grades.length) { console.log(`  ${x.sid}: no grades in the index — cannot ask`); noAnswer++; continue; }

    let gf;
    try { gf = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, `${x.sid}.json`), 'utf8')); } catch { continue; }
    const ours = new Map(Object.entries(gf.games || {}).filter(([, g]) => !TERMINAL.has(String(g.st))));

    // ⚠️ INSTRUMENTED 2026-09-10. REVISION a REPORTED A CONCLUSION FROM ZERO
    // QUESTIONS. It printed "still non-final 0 / FINISHED at PlayHQ 0 / failures 0"
    // for all eight seasons and then concluded "nothing PlayHQ has finished is
    // frozen here" — on the basis of nothing having been asked. Every counter was a
    // real zero and the sentence read them as an answer, which is precisely the
    // failure this whole family of tools exists to prevent.
    //
    // The coverage gate did not catch it because gradesOk === gradesTotal is
    // satisfied when both are zero. So the pipeline is now counted at every stage:
    // grades in the index, rounds returned, games PlayHQ served, and how many of
    // those matched an id we hold. A stage that reports zero names itself.
    //
    // The likeliest cause is the last stage. `ours` is keyed by the game ids in
    // games/bv, and the uuid-truncation migration rewrote ids in those files. If we
    // hold truncated ids and PlayHQ serves full ones, `ours.has(g.id)` is false for
    // every game and the loop skips everything in silence. Both id forms are sampled
    // below so the shapes can be compared rather than guessed at.
    let asked = 0, sStill = 0, sDone = 0, gradesOk = 0, sFail = 0;
    let roundsSeen = 0, gamesServed = 0, matched = 0, gradesGone = 0;
    const idSamples = [];
    for (const gr of grades) {
      const r1 = await gqlPaced('gradeRounds', Q_GRADE_ROUNDS, { gradeID: gr.id });
      if (r1.kind !== 'ok') { sFail++; continue; }

      // ⚠️ A GRADE PLAYHQ NO LONGER SERVES RETURNS ok WITH discoverGrade: null.
      // Revision a treated that as a covered grade: `rounds` came out empty, the
      // round loop never ran, roundsOk stayed true and gradesOk incremented — so
      // eight seasons reported FULL COVERAGE, zero failures and zero questions, and
      // the summary read that as "nothing is frozen". An absent grade is a failure
      // to ASK, not an answer, and it is now counted as one.
      if (!r1.data || !r1.data.discoverGrade) { gradesGone++; continue; }

      const rounds = (r1.data.discoverGrade.rounds) || [];
      roundsSeen += rounds.length;
      let roundsOk = true;
      for (const rd of rounds) {
        const r2 = await gqlPaced('discoverFixtureByRound', Q_FIXTURE_BY_ROUND, { roundID: rd.id });
        if (r2.kind !== 'ok') { roundsOk = false; sFail++; continue; }
        const served = (r2.data?.discoverFixtureByRound?.games) || [];
        gamesServed += served.length;
        for (const g of served) {
          if (idSamples.length < 3) idSamples.push(g.id);
          if (!ours.has(g.id)) continue;
          matched++;
          asked++;
          const theirs = g.status?.value || '(none)';
          const hasResult = !!(g.result && ((g.result.home?.statistics?.length) || g.result.outcome?.value));
          if (TERMINAL.has(String(theirs)) || hasResult) {
            sDone++; nowFinished++;
            if (examples.length < 15) examples.push({ sid: x.sid, gid: g.id, ours: ours.get(g.id).st, theirs, hasResult });
          } else { sStill++; stillNonFinal++; }
          ours.delete(g.id);
        }
      }
      if (roundsOk) gradesOk++;
    }
    // Zero grades, zero rounds and zero served games are three different failures
    // and must never share a line with a real answer.
    const full = gradesTotal > 0 && gradesOk === gradesTotal;
    if (!full) partialCoverage++;
    if (asked === 0) {
      unanswered++;
      const why = gradesTotal === 0 ? 'NO GRADES in the index for this season'
                : gradesGone === grades.length ? `PlayHQ NO LONGER SERVES any of the ${grades.length} grade(s) asked — discoverGrade returned null`
                : gradesGone > 0    ? `${gradesGone} of ${grades.length} grade(s) no longer served by PlayHQ`
                : gradesOk === 0    ? `all ${gradesTotal} grade lookup(s) failed`
                : roundsSeen === 0  ? `${gradesOk} grade(s) returned but NO ROUNDS`
                : gamesServed === 0 ? `${roundsSeen} round(s) returned but NO GAMES`
                :                     `PlayHQ served ${gamesServed} game(s), NONE matched an id we hold`;
      console.log(`  ${x.sid}  ⚠ NOTHING ASKED — ${why}`);
      console.log(`      grades ${gradesOk}/${gradesTotal} covered, ${gradesGone} no longer served  rounds ${roundsSeen}  games served ${gamesServed}  matched ${matched}  failures ${sFail}`);
      if (idSamples.length) {
        const oursSample = [...ours.keys()].slice(0, 3);
        console.log(`      PlayHQ game ids : ${idSamples.join(', ')}`);
        console.log(`      our game ids    : ${oursSample.join(', ')}`);
        const pl = idSamples[0] ? idSamples[0].length : 0;
        const ol = oursSample[0] ? oursSample[0].length : 0;
        if (pl && ol && pl !== ol) console.log(`      ⚠ ID LENGTHS DIFFER: PlayHQ ${pl} chars, ours ${ol} — the ids cannot match`);
      }
      continue;
    }
    console.log(`  ${x.sid}  asked ${String(asked).padStart(5)}  →  still non-final ${String(sStill).padStart(5)}   FINISHED at PlayHQ ${String(sDone).padStart(5)}   failures ${sFail}   grades ${gradesOk}/${gradesTotal}${gradesGone ? ` (${gradesGone} gone)` : ''}  served ${gamesServed}  matched ${matched}${full ? '' : '   [PARTIAL COVERAGE]'}`);
  }

  console.log(`\n${'═'.repeat(92)}`);
  console.log(`  still non-final at PlayHQ : ${stillNonFinal}   → the game really was left mid-scoring; nothing to recover`);
  console.log(`  FINISHED at PlayHQ        : ${nowFinished}   → WE MISSED IT. A real capture gap.`);
  console.log(`  seasons we could not ask  : ${noAnswer}`);
  console.log(`  seasons where NOTHING was asked : ${unanswered}   ← NOT a finding; see the reason on each line above`);
  console.log(`  seasons partially covered : ${partialCoverage}   (raise --max-grades to close these)`);
  console.log(`  CloudFront blocks absorbed: ${totalBlocks}`);
  console.log(`${'═'.repeat(92)}`);

  if (examples.length) {
    console.log(`\n  games PlayHQ has finished and we hold as non-final:`);
    for (const e of examples) console.log(`    season ${e.sid}  game ${e.gid}   ours=${e.ours}  playhq=${e.theirs}  result=${e.hasResult ? 'yes' : 'no'}`);
  }

  // A conclusion may only be drawn from questions that were actually put.
  if (stillNonFinal + nowFinished === 0) {
    console.log(`\n  \u26a0 NO GAME WAS ASKED ABOUT. This run establishes NOTHING about whether those`);
    console.log(`    games are finished at PlayHQ — do not read the zeros above as an answer.`);
    console.log(`    Revision a printed a conclusion here from exactly this state. Read the`);
    console.log(`    per-season reasons: no grades, no rounds, no games served, or ids that`);
    console.log(`    cannot match. Fix that before drawing anything from this tool.`);
  } else if (nowFinished > 0) {
    console.log(`\n  \u26a0 ${nowFinished} game(s) are finished at PlayHQ and non-final here, inside LOCKED`);
    console.log(`    seasons the nightly will never revisit. Locking those was premature. Reopen by`);
    console.log(`    clearing locked/lockedAt/lockedReason on the affected ids, let a nightly run,`);
    console.log(`    and consider whether lock-quiet-seasons should refuse a season holding`);
    console.log(`    non-final games at all.`);
  } else {
    console.log(`\n  Nothing PlayHQ has finished is frozen here. LIVE/PENDING in a locked season is`);
    console.log(`  a game PlayHQ itself never completed, the same finding as the PENDING work on`);
    console.log(`  2026-09-08 (685 asked, 0 finished).`);
  }
  log('read-only — nothing written, nothing committed.');
}

main().catch(err => { console.error(`FATAL: ${err.stack || err.message}`); process.exit(1); });
